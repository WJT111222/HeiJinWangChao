import { relayTarget, relayUpstreamHeader } from './services/ai/relayTarget';

const limit = 2 * 1024 * 1024;
const safetyHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
};
const failure = (status: number, message: string) =>
  Response.json(
    { error: message },
    { status, headers: { ...safetyHeaders, 'X-Heijin-Relay-Error': '1' } },
  );

async function boundedBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (Number(request.headers.get('Content-Length')) > limit) return;
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        return;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

export async function aiRelay(request: Request, send: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin'),
    site = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== url.origin) || (site && site !== 'same-origin' && site !== 'none'))
    return failure(403, '仅允许本站中转请求');
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: { ...safetyHeaders, Allow: 'GET, POST, OPTIONS' },
    });
  if (!['GET', 'POST'].includes(request.method)) return failure(405, '仅支持 GET 和 POST');
  const target = relayTarget(url.searchParams.get('target') ?? '', url.origin, request.method);
  if (!target) return failure(400, '目标地址或端点不支持中转');
  const headers = new Headers();
  for (const name of [
    'Authorization',
    'api-key',
    'x-api-key',
    'x-goog-api-key',
    'Content-Type',
    'Accept',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const body = request.method === 'POST' ? await boundedBody(request) : undefined;
    if (request.method === 'POST' && !body) return failure(413, '中转请求超过 2 MB');
    const upstream = await send(target.href, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: request.signal,
      cache: 'no-store',
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      void upstream.body?.cancel().catch(() => {});
      return failure(502, '中转不跟随重定向');
    }
    const result = new Headers(safetyHeaders);
    result.set(relayUpstreamHeader, '1');
    // A user-selected upstream must not serve active web content under the game's origin.
    const mime = upstream.headers.get('Content-Type') ?? '';
    result.set(
      'Content-Type',
      /^(application\/json|text\/event-stream)(?:\s*;|$)/i.test(mime)
        ? mime
        : 'text/plain; charset=utf-8',
    );
    return new Response(upstream.body, { status: upstream.status, headers: result });
  } catch {
    return failure(502, '中转未能完成上游请求');
  }
}
