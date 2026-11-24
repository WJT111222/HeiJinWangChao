import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseConfigFileTextToJson } from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker';
import type { FeedbackDatabase } from '../feedback/database';
import { feedbackPerMinute } from '../feedback/database';
import { feedbackAdminPath, feedbackBytes, feedbackPath } from '../services/feedback/contract';
import type { FeedbackPayload } from '../services/feedback/contract';

const base = 'https://heijin.game';
const password = 'synthetic-local-test-password-only-0X7sd09T';
const admin = 'Basic ' + btoa('developer:' + password);
const runtime = { version: 'V1.0 Beta', browser: 'chrome', device: 'desktop' } as const;
const suggestion: FeedbackPayload = { ...runtime, kind: 'suggestion', category: 'experience', text: '夜间阅读体验' };
const report: FeedbackPayload = { ...runtime, kind: 'error', text: '变量错误合成报告 <script>demo()</script>', errors: [
  { ref: 1, time: '2026-11-24T03:00:00.000Z', stage: 'variables', code: 'empty', model: 'synthetic-model', protocol: 'deepseek' },
  { ref: 2, time: '2026-11-24T03:00:05.000Z', stage: 'story', code: 'invalid_json', fieldPath: 'story.json' },
], attachments: [{ errorRef: 1, content: '</pre><img src=x onerror=demo()> 正文', reasoning: '合成思考' }] };

let sqlite: DatabaseSync, db: FeedbackDatabase;
const asset = vi.fn(async () => new Response('game assets'));
function env(overrides: Partial<Parameters<typeof worker.fetch>[1]> = {}) {
  return { FEEDBACK: db, FEEDBACK_ADMIN_PASSWORD: password, ASSETS: { fetch: asset }, ...overrides };
}
function submit(value: unknown, submissionId: string = crypto.randomUUID(), headers: Record<string, string> = {}, overrides: Parameters<typeof env>[0] = {}) {
  return worker.fetch(new Request(base + feedbackPath, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ submissionId, feedback: value }),
  }), env(overrides));
}
function adminRequest(path = feedbackAdminPath, init: RequestInit = {}, authorization = admin) {
  const headers = new Headers(init.headers);
  if (authorization) headers.set('Authorization', authorization);
  return worker.fetch(new Request(base + path, { ...init, headers }), env());
}
function action(id: string, values: Record<string, string>, origin = base) {
  return adminRequest(feedbackAdminPath + '/' + id, {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams(values),
  });
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/feedback/0001_feedback.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/feedback/0002_feedback_digest.sql', import.meta.url), 'utf8'));
  db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    function bind(...args: Parameters<ReturnType<FeedbackDatabase['prepare']>['bind']>): ReturnType<FeedbackDatabase['prepare']> {
      return {
        bind,
        first: async <T>() => (statement.get(...args) as T | undefined) ?? null,
        all: async <T>() => ({ results: statement.all(...args) as T[] }),
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
      };
    }
    return bind();
  } };
  asset.mockClear();
});
afterEach(() => sqlite.close());

it('只接受明确 POST，将全部脱敏日志和选定附件保存，重复尝试返回同一回执', async () => {
  const nonce = crypto.randomUUID();
  const results = await Promise.all([submit(report, nonce), submit(report, nonce)]);
  expect(results.map(value => value.status).sort()).toEqual([200, 201]);
  const [first, second] = await Promise.all(results.map(value => value.json()));
  expect(second).toEqual(first);
  const stored = sqlite.prepare('SELECT * FROM feedback').all();
  expect(stored).toHaveLength(1);
  expect(JSON.parse(String(stored[0].payload))).toEqual(report);
  expect(stored[0].id).not.toBe(nonce);
  expect(stored[0].created_at).toEqual(expect.any(Number));
  expect(Object.keys(stored[0])).not.toContain('ip');
  expect((await submit(suggestion, nonce)).status).toBe(409);
  expect((await worker.fetch(new Request(base + feedbackPath), env())).status).toBe(405);
});
it('拒绝未声明字段、跨源、超长和正文泄密，缺少 D1 或写入失败时返回安全错误', async () => {
  expect((await submit(suggestion, undefined, { Origin: 'https://elsewhere.test' })).status).toBe(403);
  expect((await submit(suggestion, undefined, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await submit({ ...suggestion, errors: report.errors })).status).toBe(400);
  expect((await submit({ ...report, errors: [{ ...report.errors[0], saveRef: 'private' }] })).status).toBe(400);
  expect((await submit({ ...report, attachments: [{ ...report.attachments![0], errorRef: 3 }] })).status).toBe(400);
  expect((await submit({ ...suggestion, text: 'Authorization: Bearer private-content' })).status).toBe(422);
  expect((await submit({ ...suggestion, text: '<GAME_CONTEXT>private</GAME_CONTEXT>' })).status).toBe(422);
  expect((await submit({ ...suggestion, text: 'b'.repeat(4001) })).status).toBe(400);
  expect((await submit({ ...suggestion, text: 'b'.repeat(feedbackBytes) })).status).toBe(413);
  expect((await submit(suggestion, undefined, { 'Content-Length': String(feedbackBytes + 1) })).status).toBe(413);
  expect((await submit(suggestion, undefined, {}, { FEEDBACK: undefined })).status).toBe(503);
  const unavailable = await submit(suggestion, undefined, {}, { FEEDBACK: { prepare() { throw new Error('private failure'); } } });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private failure');
  expect(sqlite.prepare('SELECT * FROM feedback').all()).toHaveLength(0);
});
it('全局写入窗口不使用请求来源，达到上限时仍能恢复已有回执', async () => {
  const nonce = crypto.randomUUID();
  for (let index = 0; index < feedbackPerMinute; index++) {
    const response = await submit({ ...suggestion, text: '合成内容 ' + index }, index ? undefined : nonce,
      { 'CF-Connecting-IP': index % 2 ? '192.0.2.20' : '192.0.2.21' });
    expect(response.status).toBe(201);
  }
  const denied = await submit(suggestion);
  expect(denied.status).toBe(429);
  expect(denied.headers.get('Retry-After')).toBe('60');
  expect((await submit({ ...suggestion, text: '合成内容 0' }, nonce)).status).toBe(200);
  expect(sqlite.prepare('SELECT * FROM feedback').all()).toHaveLength(feedbackPerMinute);
});
it('后台的页面、列表、详情、读写操作均经过服务端鉴权，未配置凭证时拒绝', async () => {
  for (const path of [feedbackAdminPath, feedbackAdminPath + '/', feedbackAdminPath + '/list', feedbackAdminPath + '/123']) {
    for (const method of ['GET', 'POST']) {
      const response = await adminRequest(path, { method }, '');
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('Basic');
    }
  }
  expect((await adminRequest(feedbackAdminPath, {}, 'Basic !')).status).toBe(401);
  expect((await worker.fetch(new Request(base + feedbackAdminPath), env({ FEEDBACK_ADMIN_PASSWORD: 'short' }))).status).toBe(503);
  expect(asset).not.toHaveBeenCalled();
});
it('后台搜索、筛选、统计、纯文本显示、状态、备注和删除接通真实迁移 SQL', async () => {
  const { id } = await (await submit(report)).json(), { id: second } = await (await submit(suggestion)).json();
  const overview = await (await adminRequest()).text();
  expect(overview).toContain('反馈总数');
  expect(overview).toContain('invalid_json · 1');
  expect(overview).toContain('synthetic-model · 1');
  expect(overview).toContain('变量 · 1');
  const query = (value: string) => adminRequest(feedbackAdminPath + '/list?' + value).then(result => result.text());
  expect(await query('type=experience')).toContain(second);
  for (const filter of ['type=error&code=empty&model=synthetic-model', 'q=' + encodeURIComponent('合成报告')]) {
    const list = await query(filter);
    expect(list).toContain(id);
    expect(list).not.toContain(second);
  }
  expect(await query('q=' + encodeURIComponent("' OR 1=1 --"))).not.toContain(id);
  const detail = await adminRequest(feedbackAdminPath + '/' + id);
  expect(detail.headers.get('Cache-Control')).toContain('no-store');
  expect(detail.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  expect(detail.headers.get('X-Robots-Tag')).toContain('noindex');
  const html = await detail.text();
  expect(html).toContain('&lt;script&gt;demo()&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x onerror=demo()&gt;');
  expect(html).not.toContain('<img src=x onerror=demo()>');
  expect(html).toContain('合成思考');
  expect(html).toContain('复制技术诊断');
  expect((await action(id, { action: 'update', status: 'fixed', note: '处理中' }, 'https://elsewhere.test')).status).toBe(403);
  expect((await action(id, { action: 'update', status: 'fixed', note: '合成内部备注' })).status).toBe(303);
  expect(await (await adminRequest(feedbackAdminPath + '/' + id)).text()).toContain('合成内部备注');
  expect(sqlite.prepare('SELECT status FROM feedback WHERE id = ?').get(id)?.status).toBe('fixed');
  expect((await action(id, { action: 'delete' })).status).toBe(303);
  expect((await adminRequest(feedbackAdminPath + '/' + id)).status).toBe(404);
  expect(sqlite.prepare('SELECT * FROM feedback').all()).toHaveLength(1);
});
it('两个反馈入口均保存构建版本，后台可查看和复制，旧记录仍可读取', async () => {
  const build = '0123456789abcdef0123456789abcdef01234567';
  for (const payload of [suggestion, report]) {
    const response = await submit({ ...payload, build });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const stored = sqlite.prepare('SELECT payload FROM feedback WHERE id = ?').get(id);
    expect(JSON.parse(String(stored?.payload))).toEqual({ ...payload, build });
    const detail = await adminRequest(feedbackAdminPath + '/' + id);
    expect(detail.status).toBe(200);
    const html = await detail.text();
    expect(html).toContain('<p class="muted">产品版本 V1.0 Beta · 构建版本 <code>' + build + '</code></p>');
    expect(html).toContain('&quot;build&quot;: &quot;' + build + '&quot;');
  }

  const legacy = await submit(suggestion);
  const { id } = await legacy.json();
  const oldDetail = await adminRequest(feedbackAdminPath + '/' + id);
  expect(oldDetail.status).toBe(200);
  const oldHtml = await oldDetail.text();
  expect(oldHtml).toContain('构建版本 <code>未记录</code>');
  expect(oldHtml).not.toContain('&quot;build&quot;');
  expect((await submit({ ...suggestion, build: 'unspecified arbitrary value' })).status).toBe(400);
});

it('反馈不可用不会影响公告、静态资产或既有 API 路由', async () => {
  const missing = env({ FEEDBACK: undefined, FEEDBACK_ADMIN_PASSWORD: undefined });
  expect((await worker.fetch(new Request(base + '/api/announcement'), missing)).status).toBe(200);
  expect(await (await worker.fetch(new Request(base + '/'), missing)).text()).toBe('game assets');
  expect((await worker.fetch(new Request(base + '/api/ai-relay'), missing)).status).toBe(400);
});

const end = Date.parse('2026-11-24T12:00:00Z');
const halfDay = 12 * 60 * 60 * 1000;
const recipient = 'maintainer@example.test';
const mail = () => vi.fn<(message: { from: string; to: string; subject: string; text: string }) => Promise<void>>()
  .mockResolvedValue(undefined);
function configured(send = mail()) {
  return env({ FEEDBACK_DIGEST_ENABLED: 'true', FEEDBACK_DIGEST_TO: recipient, FEEDBACK_EMAIL: { send } });
}
function addReceipt(payload: FeedbackPayload, time: number) {
  sqlite.prepare(`INSERT INTO feedback (id, submission_id, digest, created_at, kind, category, payload, note)
    VALUES (?, ?, 'synthetic', ?, ?, ?, ?, 'private admin note')`)
    .run(crypto.randomUUID(), crypto.randomUUID(), time, payload.kind,
      payload.kind === 'suggestion' ? payload.category : null, JSON.stringify(payload));
}
const checkpoint = () => sqlite.prepare('SELECT through_ms, lease_id FROM feedback_digest_checkpoint WHERE id = 1').get();

it('定时邮件统计半开区间，按报告与日志聚合，并只输出白名单字段', async () => {
  const build = '0123456789abcdef0123456789abcdef01234567';
  const secret = 'AnyPrivateTokenInAnAllowedFormat_987654321';
  const error = { ref: 1, time: new Date(end - 1).toISOString(), stage: 'story', code: 'invalid_json', model: 'gpt-5', fieldPath: 'privateFieldPath' } as const;
  addReceipt({ ...report, build, text: 'private reply text', attachments: [
    { errorRef: 1, content: 'private model output', reasoning: 'private reasoning', truncated: true },
  ], errors: [error, { ...error, ref: 2 }, { ...error, ref: 3, stage: 'world', model: secret, code: secret }] }, end - halfDay);
  addReceipt({ ...report, build, errors: [error] }, end - 1);
  for (const category of ['suggestion', 'problem', 'experience', 'other'] as const) {
    addReceipt({ ...suggestion, category, text: 'private player story' }, end - 200);
  }
  addReceipt(suggestion, end - halfDay - 1);
  addReceipt(suggestion, end);
  const before = sqlite.prepare('SELECT * FROM feedback ORDER BY id').all();
  const send = mail(), runtime = configured(send);
  await worker.scheduled({ scheduledTime: end }, runtime);
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    from: 'feedback@heijinwangchao.de5.net', to: recipient, subject: '【黑金王朝】玩家反馈简报',
  }));
  const text = send.mock.calls[0][0].text;
  for (const line of [
    '2026-11-24 08:00 至 2026-11-24 20:00', '新增反馈 6 份', '错误报告 2 份，失败日志 4 条',
    '功能建议 · 1 份', '游戏问题 · 1 份', '游玩体验 · 1 份', '其他反馈 · 1 份',
    '正文生成 · 2 份报告 / 3 条日志', '动态世界 · 1 份报告 / 1 条日志',
    'invalid_json · 2 份报告 / 3 条日志', 'gpt-5 · 2 份报告 / 3 条日志', '其他或未提供 · 1 份报告 / 1 条日志',
    '0123456789ab · 2 份', '未记录 · 4 份', 'https://heijinwangchao.de5.net/admin/feedback',
  ]) expect(text).toContain(line);
  for (const privateValue of [secret, build, recipient, 'private ', 'privateFieldPath', report.text!]) {
    expect(text).not.toContain(privateValue);
  }
  expect(sqlite.prepare('SELECT * FROM feedback ORDER BY id').all()).toEqual(before);
  await worker.scheduled({ scheduledTime: end }, runtime);
  await worker.scheduled({ scheduledTime: end - halfDay }, runtime);
  expect(send).toHaveBeenCalledTimes(1);
  await worker.scheduled({ scheduledTime: end + halfDay }, runtime);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].text).toContain('新增反馈 1 份');
});

it('空窗口不发送邮件并推进检查点，重复及过期定时事件保持幂等', async () => {
  const send = mail(), runtime = configured(send);
  await worker.scheduled({ scheduledTime: end }, runtime);
  expect(send).not.toHaveBeenCalled();
  expect(checkpoint()).toMatchObject({ through_ms: end, lease_id: null });
  addReceipt(suggestion, end - 1);
  for (const scheduledTime of [end, end - halfDay]) await worker.scheduled({ scheduledTime }, runtime);
  expect(send).not.toHaveBeenCalled();
  expect(checkpoint()).toMatchObject({ through_ms: end, lease_id: null });
});

it('并发定时执行只发一次，发送中的检查点保留旧范围', async () => {
  addReceipt(suggestion, end - 1);
  let entered!: () => void, release!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  const send = mail().mockImplementation(async () => { entered(); await paused; });
  const runtime = configured(send);
  const first = worker.scheduled({ scheduledTime: end }, runtime);
  await sending;
  try {
    await worker.scheduled({ scheduledTime: end }, runtime);
    await worker.scheduled({ scheduledTime: end + halfDay }, runtime);
    expect(send).toHaveBeenCalledTimes(1);
    expect(checkpoint()).toMatchObject({ through_ms: end - halfDay, lease_id: expect.any(String) });
  } finally {
    release();
    await first;
  }
  expect(checkpoint()).toMatchObject({ through_ms: end, lease_id: null });
});

it('发送失败后下一时段补报，异常脱敏，反馈和公告照常服务', async () => {
  addReceipt(suggestion, end - 1);
  const send = mail().mockRejectedValueOnce(new Error('private provider error including ' + recipient));
  const runtime = configured(send);
  await expect(worker.scheduled({ scheduledTime: end }, runtime)).rejects.toThrow(/^feedback_digest_failed$/);
  expect(checkpoint()).toMatchObject({ through_ms: end - halfDay, lease_id: null });
  expect((await worker.fetch(new Request(base + '/api/announcement'), runtime)).status).toBe(200);
  addReceipt(suggestion, end + 1);
  await worker.scheduled({ scheduledTime: end + halfDay }, runtime);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].text).toContain('2026-11-24 08:00 至 2026-11-25 08:00');
  expect(send.mock.calls[1][0].text).toContain('新增反馈 2 份');
  expect(checkpoint()).toMatchObject({ through_ms: end + halfDay, lease_id: null });
  expect((await submit(suggestion, undefined, {}, runtime)).status).toBe(201);
});

it('上次执行中断留下的过期租约可恢复', async () => {
  sqlite.prepare('INSERT INTO feedback_digest_checkpoint VALUES (1, ?, ?, ?)').run(end - halfDay, 'expired', Date.now() - 1);
  addReceipt(suggestion, end - 1);
  const send = mail();
  await worker.scheduled({ scheduledTime: end }, configured(send));
  expect(send).toHaveBeenCalledTimes(1);
  expect(checkpoint()).toMatchObject({ through_ms: end, lease_id: null });
});

it('邮件已接收但确认写入失败时，租约到期前不重复发送', async () => {
  addReceipt(suggestion, end - 1);
  const send = mail(), runtime = configured(send);
  sqlite.exec(`CREATE TRIGGER fail_digest_confirmation BEFORE UPDATE OF through_ms ON feedback_digest_checkpoint
    BEGIN SELECT RAISE(ABORT, 'private database error'); END;`);
  await expect(worker.scheduled({ scheduledTime: end }, runtime)).rejects.toThrow(/^feedback_digest_failed$/);
  expect(checkpoint()).toMatchObject({ through_ms: end - halfDay, lease_id: expect.any(String) });
  await worker.scheduled({ scheduledTime: end }, runtime);
  expect(send).toHaveBeenCalledTimes(1);
  sqlite.exec('DROP TRIGGER fail_digest_confirmation');
  sqlite.prepare('UPDATE feedback_digest_checkpoint SET lease_until_ms = ?').run(Date.now() - 1);
  await worker.scheduled({ scheduledTime: end }, runtime);
  expect(send).toHaveBeenCalledTimes(2);
  expect(checkpoint()).toMatchObject({ through_ms: end, lease_id: null });
});

it('构建版本仅输出缩写和有界分布，其余计数仍在邮件中', async () => {
  for (let n = 0; n < 17; n++) {
    addReceipt({ ...suggestion, build: String(n).padStart(12, '0') + 'a'.repeat(28) }, end - 1);
  }
  const send = mail();
  await worker.scheduled({ scheduledTime: end }, configured(send));
  const text = send.mock.calls[0][0].text;
  expect(text).toContain('新增反馈 17 份');
  expect(text.match(/^- \d{12} · 1 份$/gm)).toHaveLength(15);
  expect(text).toContain('其余构建 · 2 份');
});

it('预览和缺少配置时不读取 D1，公开路径不能触发发信', async () => {
  const send = mail(), runtime = configured(send);
  const prepare = vi.fn(() => { throw new Error('must not touch database'); });
  for (const cfg of [
    { FEEDBACK: undefined },
    { FEEDBACK_DIGEST_ENABLED: undefined },
    { FEEDBACK_DIGEST_ENABLED: 'false' },
    { FEEDBACK_EMAIL: undefined },
    { FEEDBACK_DIGEST_TO: undefined },
    { FEEDBACK_DIGEST_TO: 'a@example.test, b@example.test' },
  ]) await worker.scheduled({ scheduledTime: end }, { ...runtime, FEEDBACK: { prepare }, ...cfg });
  await worker.scheduled({ scheduledTime: end - 1 }, { ...runtime, FEEDBACK: { prepare } });
  expect(prepare).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(checkpoint()).toBeUndefined();
  const response = await worker.fetch(new Request(base + '/api/feedback/digest', {
    method: 'POST', body: JSON.stringify({ to: 'player@example.test' }),
  }), runtime);
  expect(response.status).toBe(404);
  expect(send).not.toHaveBeenCalled();

  const parsed = parseConfigFileTextToJson('wrangler.jsonc',
    readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  expect(parsed.error).toBeUndefined();
  expect(parsed.config).toMatchObject({
    triggers: { crons: ['0 0,12 * * *'] }, preview_urls: false,
    send_email: [{ name: 'FEEDBACK_EMAIL', allowed_sender_addresses: ['feedback@heijinwangchao.de5.net'] }],
    previews: { vars: { FEEDBACK_DIGEST_ENABLED: 'false' } },
  });
  for (const field of ['d1_databases', 'send_email', 'triggers']) expect(parsed.config.previews).not.toHaveProperty(field);
  expect(parsed.config.vars).not.toHaveProperty('FEEDBACK_DIGEST_TO');
});
