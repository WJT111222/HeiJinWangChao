import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AiClient, type RequestOptions } from '../services/ai/client';
import { newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { channelSnapshot } from '../services/ai/snapshot';
import { installTavernFetch } from '../presets/tavern/fetch';
import { StoryClock } from '../presets/tavern/timing';
import { withStoryPreparation } from '../services/ai/storyPreparation';
import { readFailureDiagnostic } from '../services/ai/failureDiagnostic';
import { manualRetryOnly } from '../services/ai/errors';
import { defaultSettings, mergeSettingsChanges, SettingsSchema, storyStreamLimits } from '../ui/settings/model';
import { executeWithAutoRetry, retryDelays } from '../workflows/stageRetry';

const store = { getItem: () => 'fixture-secret', setItem() {}, removeItem() {} };
const snap = channelSnapshot(newChannel('openai'), new CredentialVault(store, store), 'fixture');
const messages = [{ role: 'user' as const, content: '本回合' }];
const story = '<正文>潮水退去。</正文><短期记忆>退潮</短期记忆><变量规划>[]</变量规划>';
const frame = (delta: object, reason: string | null = null) =>
  'data: ' + JSON.stringify({ choices: [{ delta, finish_reason: reason }] }) + '\n\n';
const finish = frame({}, 'stop');
const complete = frame({ content: story }) + finish + 'data: [DONE]\n\n';
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }),
    { headers: { 'Content-Type': 'text/event-stream' } });
  return { response, send: (data: string) => controller.enqueue(new TextEncoder().encode(data)), end: () => controller.close() };
}
beforeAll(() => installTavernFetch());
afterEach(() => { vi.useRealTimers(); retryDelays.scale = 1; });
function request(fetcher: typeof fetch, options: RequestOptions = {}) {
  return new AiClient(fetcher).generate(snap, messages, { stream: true, tavernType: 'normal', timeoutSeconds: 120, streamTimeouts: { idle: 120, total: 600 }, retryableTavernHost: true, ...options })
    .then(r => ({ text: r.text, usage: r.usage, code: 'ok' }), e => ({ text: '', usage: undefined, code: e.code }));
}
it.each(['timeout', 'stream_interrupted'])('文学脚本的可恢复 %s 只重试一次', async failure => {
  vi.useFakeTimers(); retryDelays.scale = 0;
  const first = stream();
  const second = stream(); second.send(complete); second.end();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
  const settings = defaultSettings(); settings.runtime.failureAutoRetry = true;
  const client = new AiClient(fetcher);
  const attempts = executeWithAutoRetry({ settings, signal: new AbortController().signal,
    run: () => client.generate(snap, messages, { stream: true, tavernType: 'normal', timeoutSeconds: 120, streamTimeouts: { idle: 120, total: 600 }, retryableTavernHost: true }),
    onFailure: () => {}, onRetry: () => {} }).then(r => r.text, e => e.code);
  first.send(frame({ content: '第一次部分结果' }));
  if (failure === 'stream_interrupted') first.end();
  await vi.advanceTimersByTimeAsync(120_001);
  const result = await attempts;
  console.info('retry', failure, fetcher.mock.calls.length, result === story ? 'ok' : result);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(result).toBe(story);
});
it.each(['content', 'reasoning_content'])('持续有效 %s 超过 120 秒仍可成功', async field => {
  vi.useFakeTimers();
  const feed = stream(); const actual = request(async () => feed.response);
  for (let i = 0; i < 3; i++) {
    feed.send(frame({ [field]: '潮' })); await vi.advanceTimersByTimeAsync(45_000);
  }
  try { feed.send(complete); feed.end(); } catch { /* record the existing timeout */ }
  const result = await actual; console.info('slow', field, result.code); expect(result.code).toBe('ok');
});
it('上游 stop 后保持连接，能在一秒内完成并保留迟到的 usage', async () => {
  vi.useFakeTimers();
  const feed = stream(); const actual = request(async () => feed.response);
  feed.send(frame({ content: story }) + finish); await vi.advanceTimersByTimeAsync(50);
  feed.send('data: {"choices":[],"usage":{"completion_tokens":7}}\n\n');
  let settled = false; void actual.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(950);
  const withinSecond = settled;
  await vi.advanceTimersByTimeAsync(120_000);
  const result = await actual; console.info('open-after-stop', withinSecond, result.code);
  expect(withinSecond).toBe(true); expect(result).toMatchObject({ code: 'ok', usage: { outputTokens: 7 } });
});
it('仅正文标签及 EOF 不能成为成功响应', async () => {
  const feed = stream(); feed.send(frame({ content: story })); feed.end();
  expect((await request(async () => feed.response)).code).toBe('stream_interrupted');
});
it.each([': ping\n\n', frame({})])('仅心跳或空 delta 仍会超时 %#', async packet => {
  vi.useFakeTimers(); const feed = stream(); const actual = request(async () => feed.response);
  for (let i = 0; i < 3; i++) { feed.send(packet); await vi.advanceTimersByTimeAsync(40_000); }
  expect((await actual).code).toBe('timeout');
});

it.each([false, true])('持续生成也受整次硬时限约束，预设=%s', async preset => {
  vi.useFakeTimers();
  const feed = stream();
  const clock = new StoryClock();
  const pending = request(async () => feed.response, { tavernType: preset ? 'normal' : undefined,
    storyClock: clock, streamTimeouts: { idle: 2, total: 3 } });
  for (let i = 0; i < 3; i++) { feed.send(frame({ content: '潮' })); await vi.advanceTimersByTimeAsync(1000); }
  expect(await pending).toMatchObject({ code: 'timeout' });
  expect(clock.marks).toMatchObject({ timeoutKind: 'total', lastProgressMs: 2000 });
  expect(feed.response.body?.locked).toBe(false);
});
it('合法工具参数分片延长空闲时间；不完整 JSON 不能借助开放连接交付', async () => {
  vi.useFakeTimers();
  const clock = new StoryClock(), feed = stream();
  const pending = request(async () => feed.response, { storyClock: clock, streamTimeouts: { idle: 1, total: 6 } });
  const part = (args: string, first = false) => frame({ tool_calls: [{ index: 0, ...(first ? { id: 'one', type: 'function' } : {}),
    function: { ...(first ? { name: 'actual_content' } : {}), arguments: args } }] });
  feed.send(part('{"content":"', true));
  await vi.advanceTimersByTimeAsync(700); feed.send(part('甲'));
  await vi.advanceTimersByTimeAsync(700); feed.send(part('乙') + frame({}, 'tool_calls'));
  await vi.advanceTimersByTimeAsync(300);
  expect(clock.marks.lastProgressMs).toBe(1400);
  expect((await pending).code).toBe('invalid_json');
});
it.each(['error', 'filter', 'partial', 'conflict'])('已观察到的尾帧 %s 不被提前成功掩盖', async kind => {
  vi.useFakeTimers();
  const feed = stream(), result = request(async () => feed.response);
  feed.send(frame({ content: story }) + finish); await vi.advanceTimersByTimeAsync(50);
  const suffix = kind === 'error' ? 'event: error\ndata: {"error":{}}\n\n' : kind === 'filter'
    ? frame({}, 'content_filter') : kind === 'partial' ? 'data: {"error":' : frame({ content: '冲突' });
  feed.send(suffix); await vi.advanceTimersByTimeAsync(400);
  expect((await result).code).not.toBe('ok');
});
it('无 usage 的正常尾帧超时保留未知用量，清理不被永不返回的取消回调卡住', async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame({content: story}) + finish)); }, cancel: cancelled });
  const result = request(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }), { tavernType: undefined });
  await vi.advanceTimersByTimeAsync(300);
  expect(await result).toMatchObject({ code: 'ok', usage: undefined });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
it('旧超时保持原值，导入与跨页合并后的冲突被拒绝', () => {
  const base = defaultSettings(); base.runtime.timeoutSeconds = 750;
  expect(storyStreamLimits(SettingsSchema.parse(base).runtime)).toEqual({ idle: 750, total: 750 });
  const edited = structuredClone(base), latest = structuredClone(base);
  edited.runtime.streamIdleSeconds = 500; latest.runtime.streamTotalSeconds = 800;
  expect(storyStreamLimits(SettingsSchema.parse(mergeSettingsChanges(base, edited, latest)).runtime)).toEqual({ idle: 500, total: 800 });
  edited.runtime.streamIdleSeconds = 900;
  expect(SettingsSchema.safeParse(mergeSettingsChanges(base, edited, latest)).success).toBe(false);
});
it('准备超时在发送前停止，迟到的准备回调看到已取消身份', async () => {
  vi.useFakeTimers();
  const clock = new StoryClock(), send = vi.fn();
  const run = withStoryPreparation(undefined, clock, { idle: 1, total: 5 }, 2, async signal => {
    await new Promise(resolve => setTimeout(resolve, 2200));
    if (!signal.aborted) send();
  }).catch(error => error);
  await vi.advanceTimersByTimeAsync(2300);
  const error = await run;
  expect(error).toMatchObject({ code: 'timeout' });
  expect(readFailureDiagnostic(error)).toMatchObject({ timeoutKind: 'preparation' });
  expect(manualRetryOnly.has(error)).toBe(true); expect(send).not.toHaveBeenCalled();
});
