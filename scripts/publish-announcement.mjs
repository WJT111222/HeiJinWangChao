// 把 announcements/current.json 写入 Cloudflare KV 的 current 键。由 GitHub Actions「发布王朝公告」调用。
//   node scripts/publish-announcement.mjs            发布（仅 main，且仍是 main 上的最新公告）
//   node scripts/publish-announcement.mjs --dry-run  只做全部检查并打印计划，不写 KV
//   node scripts/publish-announcement.mjs --verify   读取线上接口，确认已由 KV 提供该版本（失败只警告）
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const announcementFile = 'announcements/current.json';
export const announcementBinding = 'ANNOUNCEMENTS';
export const announcementUrl = 'https://heijinwangchao.de5.net/api/announcement';

/** 去掉 JSONC 的注释与尾逗号，字符串内容原样保留。 */
export function stripJsonc(text) {
  let out = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') { out += next ?? ''; i++; } else if (char === '"') inString = false;
    } else if (char === '"') { inString = true; out += char; }
    else if (char === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (char === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += char;
  }
  // 第二遍：去掉对象/数组末尾的逗号，同样跳过字符串。
  let result = '';
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const char = out[i];
    if (inString) {
      result += char;
      if (char === '\\') { result += out[i + 1] ?? ''; i++; } else if (char === '"') inString = false;
    } else if (char === '"') { inString = true; result += char; }
    else if (char === ',' && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    else result += char;
  }
  return result;
}

/** 按 binding 名精确取 KV Namespace ID；缺失、重复或格式不对一律报错，绝不猜测写入哪个库。 */
export function announcementNamespace(jsoncText, binding = announcementBinding) {
  const config = JSON.parse(stripJsonc(jsoncText));
  const namespaces = Array.isArray(config?.kv_namespaces) ? config.kv_namespaces : [];
  const matches = namespaces.filter((item) => item?.binding === binding);
  if (matches.length !== 1) throw new Error(`wrangler.jsonc 中 ${binding} 绑定应恰好 1 个，实际 ${matches.length} 个。`);
  const id = matches[0].id;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new Error(`wrangler.jsonc 中 ${binding} 的 id 不是 32 位 Namespace ID。`);
  return id;
}

/**
 * 写入前的决定。只允许 main；本次运行检出的公告必须与「此刻」main 上的公告逐字相同，
 * 否则说明有更新的提交（它会由排在后面的运行发布），本次跳过、不写旧内容。
 *
 * 这不是原子操作：concurrency 组只保证发布运行彼此串行，不能阻止 Git 在「检查」与「写入」之间收到新提交。
 * 因此写入前先装好 wrangler，把窗口缩到一次写入调用；写入后再查一次 main，若期间有新公告提交，
 * 线上可能短暂是本次内容，随后排队的那次运行会写入更新内容（最终一致，而非严格原子一致）。
 */
export function publishDecision({ ref, current, latest }) {
  if (ref !== 'refs/heads/main') return { publish: false, fail: true, reason: `只能从 main 发布公告（当前 ${ref || '未知分支'}），未写入。` };
  if (latest === undefined) return { publish: false, fail: true, reason: `最新 main 上没有 ${announcementFile}，未写入。` };
  if (current !== latest) return { publish: false, fail: false, reason: '本次运行检出的公告已不是 main 上的最新内容，跳过，不写入旧公告（更新的提交会自行发布）。' };
  return { publish: true, fail: false, reason: '与最新 main 上的公告一致。' };
}

/** 读取线上接口：只有来源为 kv 且版本一致才算「线上已可读取」。 */
export async function checkOnline({ version, url = announcementUrl, fetcher = globalThis.fetch, attempts = 6, wait = 20_000 }) {
  let last = { source: '无', version: '无' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { cache: 'no-store' });
      const source = response.headers.get('x-announcement-source') ?? '无';
      const body = await response.json().catch(() => ({}));
      last = { source, version: typeof body?.version === 'string' ? body.version : '无' };
      if (response.ok && source === 'kv' && last.version === version) return { ok: true, ...last };
    } catch { /* 网络错误按未读取处理，继续重试 */ }
    if (attempt < attempts) await delay(wait);
  }
  return { ok: false, ...last };
}

function say(text) { process.stdout.write(`${text}\n`); }
function fail(text) { process.stdout.write(`::error::${text}\n`); process.exit(1); }
function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const marker = `EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${marker}\n${value}\n${marker}\n`);
}

function latestOnMain(cwd) {
  execFileSync('git', ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', 'main'], { cwd, stdio: 'inherit' });
  try { return execFileSync('git', ['show', `FETCH_HEAD:${announcementFile}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return undefined; }
}

async function publish(dryRun) {
  const cwd = process.cwd();
  const ref = process.env.GITHUB_REF ?? '';
  const current = readFileSync(resolve(cwd, announcementFile), 'utf8');
  // 先排除非 main，再做耗时准备。
  const early = publishDecision({ ref, current, latest: current });
  if (early.fail) fail(early.reason);
  const [command, ...prefix] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '--yes', 'wrangler@4'];
  if (!dryRun) {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)
      fail('缺少 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID，见 docs/REMOTE_ANNOUNCEMENTS.md「一次性配置」。未写入。');
    // 预先下载、初始化 wrangler，避免 npx 安装耗时落在「最新检查」与「写入」之间。
    const warm = spawnSync(command, [...prefix, '--version'], { cwd: tmpdir(), stdio: 'inherit' });
    if (warm.status !== 0) fail('wrangler 无法启动，未写入。');
  }
  const latest = latestOnMain(cwd);
  const decision = publishDecision({ ref, current, latest });
  if (!decision.publish) {
    if (decision.fail) fail(decision.reason);
    say(`::notice::${decision.reason}`);
    return;
  }
  const { parseAnnouncement } = await import('../src/services/notices/announcement.ts');
  const announcement = parseAnnouncement(current);
  if (!announcement) fail(`${announcementFile} 不是合法公告，未写入。`);
  const namespace = announcementNamespace(readFileSync(resolve(cwd, 'wrangler.jsonc'), 'utf8'));
  if (dryRun) { say(`[演练] 将把 ${announcement.version} 写入 KV ${namespace} 的 current 键；未写入。`); return; }
  // 在临时目录运行，避免 wrangler 解析整份部署配置。
  const result = spawnSync(command, [...prefix, 'kv', 'key', 'put', 'current', '--namespace-id', namespace,
    '--path', resolve(cwd, announcementFile), '--remote'], { cwd: tmpdir(), stdio: 'inherit' });
  if (result.status !== 0) fail('wrangler 写入 KV 失败，线上公告未更新。');
  say(`KV 写入成功：${announcement.version}（跨地区同步可能需要约 1 分钟，线上可读取另见下一步）。`);
  output('version', announcement.version);
  // 写入后复查：检查与写入之间若有新公告提交，本次内容会被排在后面的运行覆盖为最新。
  if (latestOnMain(cwd) !== current)
    say('::notice::写入期间 main 上的公告又有新提交；线上可能短暂显示本次内容，排在后面的发布运行会写入最新公告。');
}

async function verify() {
  const version = process.env.ANNOUNCEMENT_VERSION;
  if (!version) { say('没有需要检查的版本（本次未写入）。'); return; }
  const result = await checkOnline({ version });
  if (result.ok) say(`线上已可读取：来源 kv，版本 ${version}。`);
  else say(`::warning::KV 已写入，但约两分钟内线上接口仍未由 KV 返回 ${version}（当前来源 ${result.source}，版本 ${result.version}）。KV 跨地区同步可能更慢，稍后刷新确认。`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  await (args.includes('--verify') ? verify() : publish(args.includes('--dry-run')));
}
export const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
