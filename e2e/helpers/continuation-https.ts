import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from './test';
import { aiRelay } from '../../src/aiRelay';

export const modelHost = 'legacy.mock.invalid';
const endpoint = 'https://' + modelHost + '/v1/chat/completions';
const localhost = '127.0.0.1';
export const completion = {
  choices: [{ message: { content: '电车抵达站台。</正文><短期记忆>候车。</短期记忆><变量规划>[]</变量规划>' }, finish_reason: 'stop' }],
};

async function makeModel() {
  const directory = mkdtempSync(join(tmpdir(), 'continuation-tls-'));
  const key = join(directory, 'key'), cert = join(directory, 'cert');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=' + modelHost, '-addext', 'subjectAltName=DNS:' + modelHost, '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const ca = readFileSync(cert);
    let handler = (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(503); res.end(); };
    const server = createServer({ key: readFileSync(key), cert: ca }, (req, res) => handler(req, res));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, localhost, resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('本地 HTTPS 未监听 TCP');
    const port = address.port;
    const forward: typeof fetch = async (url, init) => {
      if (String(url) !== endpoint || init?.method !== 'POST') throw Error('非预期的测试模型端点');
      return new Promise<Response>((resolve, reject) => {
        const post = request({ hostname: localhost, port, servername: modelHost, ca, method: 'POST',
          path: '/v1/chat/completions', headers: Object.fromEntries(new Headers(init.headers)) }, async response => {
          try {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
              headers: { 'Content-Type': 'application/json' } }));
          } catch (error) { reject(error); }
        });
        post.on('error', reject);
        post.end(Buffer.from(init.body as ArrayBuffer));
      });
    };
    const spki = new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' });
    const pin = createHash('sha256').update(spki).digest('base64');
    return { port, pin, forward, handle(fn: typeof handler) { handler = fn; }, async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    } };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

type Mode = 'success' | 'deny-preflight' | 'opaque' | 'reset';
type Model = Awaited<ReturnType<typeof makeModel>>;
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function capture() {
  return { direct: 0, worker: 0, options: 0, modelPosts: [] as string[], callbacks: 0,
    preflight: barrier(), resume: barrier(), mode: 'success' as Mode };
}
export const test = base.extend<{ network: ReturnType<typeof capture> & { serveRelay(): Promise<unknown> } }, { model: Model }>({
  model: [async ({ browserName }, use) => {
    if (browserName !== 'chromium') throw Error('本探针使用 Chromium 本地域名映射');
    const model = await makeModel();
    try { await use(model); } finally { await model.close(); }
  }, { scope: 'worker' }],
  launchOptions: [async ({ model, launchOptions }, use) => {
    await use({ ...launchOptions, args: [...launchOptions.args ?? [], '--no-proxy-server', '--ignore-certificate-errors-spki-list=' + model.pin,
      '--host-resolver-rules=MAP ' + modelHost + ' ' + localhost + ':' + model.port] });
  }, { scope: 'worker' }],
  network: async ({ model, page }, use) => {
    const log = capture();
    model.handle(async (req, res) => {
      if (req.method === 'OPTIONS') {
        log.options++;
        if (log.mode === 'deny-preflight') {
          log.preflight.resolve();
          await log.resume.promise;
          res.writeHead(403); res.end(); return;
        }
        res.writeHead(204, { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5174', 'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] ?? '') });
        res.end(); return;
      }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const digest = createHash('sha256');
      for await (const chunk of req) digest.update(chunk);
      log.modelPosts.push(digest.digest('hex'));
      if (log.mode === 'reset') { req.socket.destroy(); return; }
      if (log.mode !== 'opaque') res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(completion));
    });
    page.on('request', req => {
      if (req.method() !== 'POST') return;
      if (req.url() === endpoint) log.direct++;
      if (new URL(req.url()).pathname === '/api/ai-relay') log.worker++;
    });
    // Direct CORS probes must use Chromium's own preflight. Enable CDP routing only
    // before a separately authorized relay request, never during an active TLS load.
    const serveRelay = () => page.route('**/api/ai-relay?**', async route => {
      const req = route.request();
      const response = await aiRelay(new Request(req.url(), { method: req.method(), headers: await req.allHeaders(),
        body: req.postData() }), async (url, init) => { log.callbacks++; return model.forward(url, init); });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    try { await use(Object.assign(log, { serveRelay })); } finally { log.resume.resolve(); }
  },
});
