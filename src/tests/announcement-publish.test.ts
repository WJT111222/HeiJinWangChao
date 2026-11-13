import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { announcementNamespace, checkOnline, publishDecision, repoRoot, scriptPath, stripJsonc } from '../../scripts/publish-announcement.mjs';

const realConfig = readFileSync(join(repoRoot, 'wrangler.jsonc'), 'utf8');
const announcement = (version: string) => `${JSON.stringify({ version, title: '王朝公告', theme: `测试公告 ${version}`,
  updates: [`这是 ${version} 的更新。`], message: '测试寄语。' }, null, 2)}\n`;

describe('KV Namespace 按 binding 精确读取', () => {
  it('读出仓库 wrangler.jsonc 中 ANNOUNCEMENTS 的 ID', () => {
    expect(announcementNamespace(realConfig)).toMatch(/^[0-9a-f]{32}$/);
  });
  it('支持注释与尾逗号，字符串里的 // 与 , 原样保留', () => {
    expect(JSON.parse(stripJsonc('{ "a": "http://x,}", // 注释\n /* 块 */ "b": [1, 2,], }'))).toEqual({ a: 'http://x,}', b: [1, 2] });
  });
  it('多个 binding 时只取 ANNOUNCEMENTS，不取第一个', () => {
    const config = `{ "kv_namespaces": [ { "binding": "OTHER", "id": "${'1'.repeat(32)}" }, { "binding": "ANNOUNCEMENTS", "id": "${'a'.repeat(32)}" } ] }`;
    expect(announcementNamespace(config)).toBe('a'.repeat(32));
  });
  it.each([
    ['缺失', `{ "kv_namespaces": [ { "binding": "OTHER", "id": "${'1'.repeat(32)}" } ] }`],
    ['重复', `{ "kv_namespaces": [ { "binding": "ANNOUNCEMENTS", "id": "${'1'.repeat(32)}" }, { "binding": "ANNOUNCEMENTS", "id": "${'2'.repeat(32)}" } ] }`],
    ['ID 格式不对', '{ "kv_namespaces": [ { "binding": "ANNOUNCEMENTS", "id": "not-an-id" } ] }'],
    ['没有 kv_namespaces', '{ "name": "x" }'],
  ])('%s时失败，不猜测写入哪个库', (_label, config) => {
    expect(() => announcementNamespace(config)).toThrow();
  });
});

describe('写入前决定', () => {
  it('只允许 main；内容须与最新 main 一致，否则跳过而不失败', () => {
    expect(publishDecision({ ref: 'refs/heads/main', current: 'B', latest: 'B' })).toMatchObject({ publish: true });
    expect(publishDecision({ ref: 'refs/heads/main', current: 'A', latest: 'B' })).toMatchObject({ publish: false, fail: false });
    expect(publishDecision({ ref: 'refs/heads/feature', current: 'B', latest: 'B' })).toMatchObject({ publish: false, fail: true });
    expect(publishDecision({ ref: '', current: 'B', latest: 'B' })).toMatchObject({ publish: false, fail: true });
    expect(publishDecision({ ref: 'refs/heads/main', current: 'B', latest: undefined })).toMatchObject({ publish: false, fail: true });
  });
});

describe('线上检查区分「KV 已写入」与「线上已由 KV 返回」', () => {
  const reply = (source: string, version: string) => async () =>
    new Response(JSON.stringify({ version }), { headers: { 'x-announcement-source': source } });
  it('来源 kv 且版本一致才算成功', async () => {
    expect(await checkOnline({ version: 'B', fetcher: reply('kv', 'B'), attempts: 1, wait: 0 })).toEqual({ ok: true, source: 'kv', version: 'B' });
  });
  it('内置回退、旧版本或网络错误都不算成功', async () => {
    expect(await checkOnline({ version: 'B', fetcher: reply('builtin', 'B'), attempts: 2, wait: 0 })).toMatchObject({ ok: false, source: 'builtin' });
    expect(await checkOnline({ version: 'B', fetcher: reply('kv', 'A'), attempts: 2, wait: 0 })).toMatchObject({ ok: false, version: 'A' });
    expect(await checkOnline({ version: 'B', fetcher: async () => { throw new Error('offline'); }, attempts: 2, wait: 0 })).toMatchObject({ ok: false });
  });
  it('每次 pending fetch 都会被单独中止，重试耗尽安全返回而不挂住', async () => {
    const signals: AbortSignal[] = [];
    const fetcher: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal) {
        signals.push(init.signal);
        init.signal.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }
    });
    expect(await checkOnline({ version: 'B', fetcher, attempts: 2, wait: 0, timeout: 10 })).toMatchObject({ ok: false });
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('响应头已返回但 body 一直挂起也受每次超时限制', async () => {
    const signals: AbortSignal[] = [], bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.signal) signals.push(init.signal);
      // Deliberately does not reject body reads on abort: the whole attempt,
      // including response.json(), must still have a bounded deadline.
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { bodies.push(controller); } }), {
        headers: { 'x-announcement-source': 'kv' },
      });
    };
    try {
      expect(await checkOnline({ version: 'B', fetcher, attempts: 2, wait: 0, timeout: 10 })).toMatchObject({ ok: false });
      expect(signals).toHaveLength(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);
    } finally { for (const body of bodies) body.close(); }
  });

  it('首轮超时后仍能在下一轮验证成功', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (++calls === 1) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
      return new Response(JSON.stringify({ version: 'B' }), { headers: { 'x-announcement-source': 'kv' } });
    };
    expect(await checkOnline({ version: 'B', fetcher, attempts: 2, wait: 0, timeout: 10 })).toEqual({ ok: true, source: 'kv', version: 'B' });
    expect(calls).toBe(2);
  });

});

describe('真实 git 次序演练（假 wrangler，不连 Cloudflare）', () => {
  let root = '', origin = '', kv = '', wrangler = '', fakeBin = '';
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shas: Record<string, string> = {};
  const git = (cwd: string, ...args: string[]) => execFileSync('git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  function commit(name: string, files: Record<string, string>) {
    const work = join(root, 'work');
    for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content);
    git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', name); git(work, 'push', '-q', 'origin', 'HEAD:main');
    shas[name] = git(work, 'rev-parse', 'HEAD');
  }
  function run(name: string, env: Record<string, string> = {}) {
    const dir = join(root, `run-${name}-${Math.random().toString(36).slice(2)}`);
    git(root, 'clone', '-q', origin, dir); git(dir, 'checkout', '-q', shas[name]);
    return spawnSync(process.execPath, [scriptPath, ...(env.ARGS ? [env.ARGS] : [])], { cwd: dir, encoding: 'utf8', env: {
      ...process.env, GITHUB_REF: 'refs/heads/main', WRANGLER_BIN: wrangler, FAKE_KV: kv,
      CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: 'account', GITHUB_OUTPUT: '',
      PATH: `${fakeBin}:${process.env.PATH}`, FAKE_REAL_GIT: realGit, FAKE_FETCH_COUNT: join(dir, 'fetch-count'), ...env } });
  }
  const stored = () => existsSync(kv) ? JSON.parse(readFileSync(kv, 'utf8')).version : undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'announcement-publish-'));
    origin = join(root, 'origin.git'); kv = join(root, 'kv.json'); wrangler = join(root, 'fake-wrangler.mjs');
    writeFileSync(wrangler, `#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.join(' ') === '--version') process.exit(0);
if (args.slice(0, 4).join(' ') !== 'kv key put current' || !args.includes('--remote')) process.exit(9);
copyFileSync(args[args.indexOf('--path') + 1], process.env.FAKE_KV);
// 模拟「检查之后、写入期间」main 又收到新提交。
if (process.env.FAKE_ON_PUT) execSync(process.env.FAKE_ON_PUT, { stdio: 'ignore' });
`);
    chmodSync(wrangler, 0o755);
    fakeBin = join(root, 'fake-bin'); mkdirSync(fakeBin);
    const fakeGit = join(fakeBin, 'git');
    writeFileSync(fakeGit, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === 'fetch') {
  const count = existsSync(process.env.FAKE_FETCH_COUNT) ? Number(readFileSync(process.env.FAKE_FETCH_COUNT, 'utf8')) + 1 : 1;
  writeFileSync(process.env.FAKE_FETCH_COUNT, String(count));
  if ((process.env.FAKE_FAIL_FETCH === 'before' && count === 1) || (process.env.FAKE_FAIL_FETCH === 'after' && count === 2)) {
    process.stderr.write('Simulated git fetch network failure\\n'); process.exit(71);
  }
}
const result = spawnSync(process.env.FAKE_REAL_GIT, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    chmodSync(fakeGit, 0o755);
    git(root, 'init', '-q', '--bare', origin);
    git(root, 'clone', '-q', origin, 'work');
    mkdirSync(join(root, 'work', 'announcements'), { recursive: true });
    commit('A', { 'wrangler.jsonc': realConfig, 'announcements/current.json': announcement('A') });
    commit('B', { 'announcements/current.json': announcement('B') });
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('A、B 先后合并，B 的运行先执行、A 的旧运行后执行：最终 KV 仍是 B', () => {
    const newer = run('B');
    expect(newer.status).toBe(0);
    expect(stored()).toBe('B');
    const older = run('A');
    expect(older.status).toBe(0);
    expect(older.stdout).toContain('跳过');
    expect(stored()).toBe('B');
  }, 60_000);

  it('手动从非 main 分支运行：失败且不写入', () => {
    const manual = run('B', { GITHUB_REF: 'refs/heads/feature' });
    expect(manual.status).toBe(1);
    expect(manual.stdout).toContain('只能从 main 发布');
    expect(stored()).toBe('B');
  }, 60_000);

  it('之后的提交没动公告：仍按最新 main 的公告写入；演练模式和缺少密钥都不写入', () => {
    commit('C', { 'notes.txt': 'unrelated' });
    rmSync(kv, { force: true });
    expect(run('C', { ARGS: '--dry-run' }).status).toBe(0);
    expect(stored()).toBeUndefined();
    const missing = run('C', { CLOUDFLARE_API_TOKEN: '' });
    expect(missing.status).toBe(1);
    expect(stored()).toBeUndefined();
    expect(run('C').status).toBe(0);
    expect(stored()).toBe('B');
  }, 60_000);

  it('写入期间 main 又收到新公告：本次如实提示，线上短暂是旧内容，排在后面的运行写入最新（最终一致）', () => {
    rmSync(kv, { force: true });
    const work = join(root, 'work');
    writeFileSync(join(root, 'd.json'), announcement('D'));
    writeFileSync(join(root, 'push-d.sh'), `cd ${JSON.stringify(work)} && cp ${JSON.stringify(join(root, 'd.json'))} announcements/current.json`
      + ` && git -c user.name=test -c user.email=test@example.invalid commit -qam D && git push -q origin HEAD:main\n`);
    const racing = run('C', { FAKE_ON_PUT: `sh ${JSON.stringify(join(root, 'push-d.sh'))}` });
    expect(racing.status).toBe(0);
    expect(racing.stdout).toContain('写入期间');
    expect(stored()).toBe('B');
    shas.D = git(work, 'rev-parse', 'HEAD');
    expect(run('D').status).toBe(0);
    expect(stored()).toBe('D');
    expect(run('C').stdout).toContain('跳过');
    expect(stored()).toBe('D');
  }, 60_000);

  it('写入前 fetch 失败必须拒绝，KV 与 version output 都不变', () => {
    commit('BeforeFailure', { 'announcements/current.json': announcement('BeforeFailure') });
    const previous = stored(), output = join(root, 'before-output');
    const result = run('BeforeFailure', { FAKE_FAIL_FETCH: 'before', GITHUB_OUTPUT: output });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Simulated git fetch network failure');
    expect(result.stdout).not.toContain('KV 写入成功');
    expect(stored()).toBe(previous);
    expect(existsSync(output)).toBe(false);
  }, 60_000);

  it('KV 写入成功后 fetch 失败只警告，保留 version 且后续 verify 仍可运行', () => {
    commit('AfterFailure', { 'announcements/current.json': announcement('AfterFailure') });
    const output = join(root, 'after-output');
    const result = run('AfterFailure', { FAKE_FAIL_FETCH: 'after', GITHUB_OUTPUT: output });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('KV 写入成功');
    expect(result.stdout).toContain('::warning::');
    expect(result.stdout).toContain('写入后');
    expect(stored()).toBe('AfterFailure');
    const outputLines = readFileSync(output, 'utf8').trim().split('\n');
    expect(outputLines[0]).toMatch(/^version<<EOF_/);
    expect(outputLines[1]).toBe('AfterFailure');
    const mock = join(root, 'verify-fetch.mjs');
    // A fresh CLI subprocess like the next Actions step, with fetch entirely
    // in memory. It must never contact the real announcement URL or KV.
    writeFileSync(mock, `globalThis.fetch = async () => new Response(JSON.stringify({ version: process.env.ANNOUNCEMENT_VERSION }), { headers: { 'x-announcement-source': 'kv' } });`);
    const verified = spawnSync(process.execPath, ['--import', mock, scriptPath, '--verify'], {
      encoding: 'utf8', env: { ...process.env, ANNOUNCEMENT_VERSION: outputLines[1] },
    });
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('线上已可读取：来源 kv，版本 AfterFailure');
  }, 60_000);

});
