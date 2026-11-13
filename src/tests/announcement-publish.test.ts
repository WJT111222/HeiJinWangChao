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
});

describe('真实 git 次序演练（假 wrangler，不连 Cloudflare）', () => {
  let root = '', origin = '', kv = '', wrangler = '';
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
      CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: 'account', GITHUB_OUTPUT: '', ...env } });
  }
  const stored = () => existsSync(kv) ? JSON.parse(readFileSync(kv, 'utf8')).version : undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'announcement-publish-'));
    origin = join(root, 'origin.git'); kv = join(root, 'kv.json'); wrangler = join(root, 'fake-wrangler.mjs');
    writeFileSync(wrangler, `#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.slice(0, 4).join(' ') !== 'kv key put current' || !args.includes('--remote')) process.exit(9);
copyFileSync(args[args.indexOf('--path') + 1], process.env.FAKE_KV);
`);
    chmodSync(wrangler, 0o755);
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
});
