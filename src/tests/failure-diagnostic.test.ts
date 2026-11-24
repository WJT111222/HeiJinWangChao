import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { AiClient } from '../services/ai/client';
import { AiError, manualRetryOnly } from '../services/ai/errors';
import { channelSnapshot } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel, saveAiConfig } from '../services/ai/configuration';
import { setRelayMode } from '../services/ai/corsRelay';
import {
  attachFailureDiagnostic, classifyUpstreamPayload, failureDiagnosticSummary,
  markRetryIssued, noteRetryDecision, publishDiagnosticModel, safeFailureDiagnostic, scanStoryTags,
} from '../services/ai/failureDiagnostic';
import { requestInspections } from '../services/ai/inspection';
import { runStageRequest, storyFailureText } from '../services/ai/runtime';
import { splitLeadingThink } from '../services/ai/compat';
import { mergeContinuation } from '../domain/storyContinuation';
import { createTurnDraft } from '../domain/drafts';
import { game } from './fixtures/game';
import { installTavernFetch } from '../presets/tavern/fetch';
import { tavernTools } from '../presets/tavern/events';
import { newTrace, normalizeUpstream } from '../presets/tavern/upstream';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultSettings } from '../ui/settings/model';
import { executeWithAutoRetry, retryDelays } from '../workflows/stageRetry';
import { markRecoveredFailures, runtimeLogEvent, type RuntimeLogEntry } from '../ui/game/runtimeLog';
import { prepareErrorPayload, FeedbackCorrelation } from '../services/feedback/report';
import { feedbackSchema } from '../services/feedback/contract';

const secret = 'sk-live-SECRET-KEY';
const leak = `${secret} https://evil.example/raw ${'超长供应商说明'.repeat(40)}`;
const messages = [{ role: 'user' as const, content: '合成行动' }];
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
};
function snapshot(stage: 'story' | 'variables' | 'world' | 'memory' = 'story') {
  const store = memory();
  const channel = { ...newChannel(), baseUrl: 'https://diag.example/v1', defaultModel: 'diag-model' };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'synthetic-not-a-real-key');
  return channelSnapshot(channel, vault, channel.defaultModel, stage);
}
async function fail(run: Promise<unknown>) {
  try { await run; } catch (error) { return error; }
  throw new Error('应当失败');
}
function asErrorReport(value: unknown) {
  const parsed = feedbackSchema.parse(value);
  if (parsed.kind !== 'error') throw new Error('应当是错误报告');
  return parsed;
}
function classifyOnto(error: AiError, body: unknown, httpStatus: number) {
  attachFailureDiagnostic(error, classifyUpstreamPayload(body, { transport: 'json', httpStatus }));
}
const settingsFor = (patch?: Partial<ReturnType<typeof defaultSettings>['runtime']>) => {
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 20;
  settings.prompts.actionOptions = false;
  settings.runtime = { ...settings.runtime, ...patch };
  return settings;
};

beforeAll(() => { installTavernFetch(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  retryDelays.scale = 1;
  stageResponses.clear();
  requestInspections.clear();
});

it('HTTP 200 的错误对象和 HTTP 500 分开记录，玩家错误码不变', async () => {
  const body = { error: { code: 'rate_limit_exceeded', type: 'rate_limit_error', message: leak } };
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(body))
    .mockResolvedValueOnce(new Response('unavailable', { status: 500, headers: { 'content-type': 'text/plain' } }));
  const client = new AiClient(send);
  const successBody = await fail(client.generate(snapshot(), messages, { stream: false }));
  const httpFailure = await fail(client.generate(snapshot(), messages, { stream: false }));
  expect(successBody).toMatchObject({ code: 'rejected', status: undefined });
  expect(httpFailure).toMatchObject({ code: 'server', status: 500 });
  const inBody = safeFailureDiagnostic(successBody);
  const http = safeFailureDiagnostic(httpFailure);
  expect(inBody).toMatchObject({ upstreamClass: 'rate_limit', upstreamCode: 'rate_limit_exceeded', errorInBody: true, httpStatus: 200, httpError: false, phase: 'upstream_error', stream: false, relayUsed: false });
  expect(http).toMatchObject({ httpStatus: 500, httpError: true, stream: false });
  expect(http?.errorInBody).toBeUndefined();
  expect(http?.upstreamClass).toBeUndefined();
  expect(inBody?.timeoutSeconds).toBeUndefined();
  expect(inBody?.bytes).toBeUndefined();
  expect(http?.bytes).toBeUndefined();
  expect(failureDiagnosticSummary(inBody!)).toContain('HTTP 成功响应里带有错误对象');
  expect(failureDiagnosticSummary(inBody!)).toContain('临时限流');
  for (const value of [secret, 'evil.example', '超长供应商说明']) {
    expect(JSON.stringify(inBody)).not.toContain(value);
    expect(JSON.stringify(http)).not.toContain(value);
  }
});

it('SSE error 事件保留结构化代码；不是 JSON 时记为未知，不留下原文', async () => {
  const sse = (data: string) => new Response(`event: error\ndata: ${data}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(sse(JSON.stringify({ error: { code: 'insufficient_quota', message: leak } })))
    .mockResolvedValueOnce(sse(`不是 JSON ${leak}`));
  const client = new AiClient(send);
  const quota = await fail(client.generate(snapshot('variables'), messages, { stream: true }));
  const unknown = await fail(client.generate(snapshot('world'), messages, { stream: true }));
  expect(quota).toMatchObject({ code: 'rejected' });
  expect(unknown).toMatchObject({ code: 'rejected' });
  expect(quota).not.toMatchObject({ details: { fieldPath: 'tavern.upstream.error' } });
  expect(safeFailureDiagnostic(quota)).toMatchObject({ upstreamClass: 'quota', errorInBody: true, httpStatus: 200, httpError: false, stream: true });
  expect(safeFailureDiagnostic(unknown)).toMatchObject({ upstreamClass: 'unknown', errorInBody: true });
  expect(safeFailureDiagnostic(unknown)?.upstreamCode).toBeUndefined();
  expect(JSON.stringify(safeFailureDiagnostic(quota))).not.toContain(secret);
  expect(JSON.stringify(safeFailureDiagnostic(unknown))).not.toContain(secret);
  expect(JSON.stringify(safeFailureDiagnostic(unknown))).not.toContain('不是 JSON');
});

it('无法识别的代码只留短标记；像密钥的 code 和超长文本都不入库', () => {
  const odd = classifyUpstreamPayload({ error: { code: 'weird_vendor_code', message: leak, url: 'https://evil.example/a' } }, { transport: 'json', httpStatus: 200 });
  const hidden = classifyUpstreamPayload({ error: { code: secret, message: leak } }, { transport: 'sse', errorEvent: true });
  const empty = classifyUpstreamPayload(undefined, { transport: 'sse', errorEvent: true });
  const typed = classifyUpstreamPayload({ type: 'error' }, { transport: 'json' });
  expect(odd).toMatchObject({ upstreamClass: 'unrecognized', errorInBody: true, httpError: false });
  expect(odd.upstreamCode).toBeUndefined();
  expect(odd.upstreamType).toBeUndefined();
  expect(hidden).toMatchObject({ upstreamClass: 'unrecognized', errorInBody: true });
  expect(hidden.upstreamCode).toBeUndefined();
  expect(empty).toMatchObject({ upstreamClass: 'unknown' });
  expect(typed).toMatchObject({ upstreamClass: 'unrecognized', errorInBody: true });
  expect(typed.upstreamCode).toBeUndefined();
  const prototype = classifyUpstreamPayload({ error: { code: 'constructor', type: 'toString', message: leak } }, { transport: 'json', httpStatus: 200 });
  expect(prototype).toMatchObject({ upstreamClass: 'unrecognized', errorInBody: true, httpStatus: 200, httpError: false });
  expect(prototype.upstreamCode).toBeUndefined();
  expect(prototype.upstreamType).toBeUndefined();
  expect(JSON.stringify({ odd, hidden, empty, typed, prototype })).not.toContain(secret);
  expect(JSON.stringify({ odd, prototype })).not.toContain('evil.example');
  expect(JSON.stringify(prototype)).not.toContain('constructor');
  expect(JSON.stringify(prototype)).not.toContain('toString');
});

it('直连失败标记未经过中转；真正走了中转才记为已使用', async () => {
  const store = memory();
  vi.stubGlobal('window', { location: new URL('https://game.example') });
  vi.stubGlobal('localStorage', store);
  setRelayMode('auto');
  const direct = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('down', { status: 503 }));
  const directError = await fail(new AiClient(direct).generate(snapshot(), messages, { stream: true }));
  expect(safeFailureDiagnostic(directError)).toMatchObject({ relayEnabled: true, relayUsed: false, httpStatus: 503, httpError: true });
  expect(manualRetryOnly.has(directError as AiError)).toBe(false);
  const relayed = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response('down', { status: 502, headers: { 'X-Heijin-Relay-Upstream': '1' } }));
  const relayError = await fail(new AiClient(relayed).generate(snapshot(), messages, { stream: true }));
  expect(relayError).toMatchObject({ code: 'server', status: 502 });
  expect(safeFailureDiagnostic(relayError)).toMatchObject({ relayEnabled: true, relayUsed: true, httpStatus: 502 });
  expect(manualRetryOnly.has(relayError as AiError)).toBe(true);
  expect(String(relayed.mock.calls[1]?.[0])).toContain('/api/ai-relay?target=');
});

it('酒馆上游错误对象仍是 rejected / tavern.upstream.error，并带上观察到的类别', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    error: { code: 'overloaded', message: leak, type: 'server_error' },
  }));
  const error = await fail(new AiClient(send).generate(snapshot(), messages, { tavernType: 'normal', stream: false, validateStoryOutputLimit: true }));
  expect(error).toMatchObject({ code: 'rejected', details: { fieldPath: 'tavern.upstream.error' } });
  expect(safeFailureDiagnostic(error)).toMatchObject({
    upstreamClass: 'overload', upstreamCode: 'overloaded', errorInBody: true, httpStatus: 200, httpError: false, phase: 'upstream_error',
  });
  expect(safeFailureDiagnostic(error)?.upstreamType).toBeUndefined();
  expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(secret);
  expect((error as AiError).message).not.toContain(secret);
});

it('工具结果无法解析时只记环节，不把参数正文写进诊断', async () => {
  const trace = newTrace();
  const response = Response.json({ choices: [{ message: { tool_calls: { name: 'deliver', arguments: leak } }, finish_reason: 'tool_calls' }] });
  const error = await fail(normalizeUpstream(response, 'openai', false, new AbortController().signal, trace));
  expect(error).toMatchObject({ code: 'invalid_output', details: { fieldPath: 'tavern.upstream.tool' } });
  expect(safeFailureDiagnostic(error)?.phase).toBe('tool_parse');
  expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(secret);
});

it('正文缺开始标签、缺结束标签和恢复失败都扫描全部标签', () => {
  const settings = settingsFor();
  const missing = () => parseStoryEnvelope('只有说明，没有结构。', 'regular', settings);
  const unclosed = () => parseStoryEnvelope('<正文>经过一分钟，主角把事情看完。</正文><短期记忆>主角还在原地', 'regular', settings);
  const repaired = () => parseStoryEnvelope('<正文>经过一分钟，主角把事情看完。<短期记忆>主角还在原地。</短期记忆>', 'regular', settings);
  let missingError: unknown, unclosedError: unknown, repairedError: unknown;
  try { missing(); } catch (error) { missingError = error; }
  try { unclosed(); } catch (error) { unclosedError = error; }
  try { repaired(); } catch (error) { repairedError = error; }
  expect(missingError).toMatchObject({ code: 'invalid_output', details: { storyRule: 'tag_missing', storyTag: '正文' } });
  expect(safeFailureDiagnostic(missingError)?.recovery).toMatchObject({ attempted: true, succeeded: false, reason: 'not_applicable' });
  expect(safeFailureDiagnostic(missingError)?.storyTags?.map(tag => tag.tag)).toEqual(['thinking', '正文', '短期记忆', '变量规划', '行动选项']);
  expect(safeFailureDiagnostic(missingError)?.storyTags?.find(tag => tag.tag === '正文')).toMatchObject({ required: true, open: false, close: false });
  expect(unclosedError).toMatchObject({ details: { storyRule: 'tag_unclosed', storyTag: '短期记忆' } });
  expect(safeFailureDiagnostic(unclosedError)?.recovery).toMatchObject({ attempted: true, succeeded: false, reason: 'not_applicable' });
  expect(safeFailureDiagnostic(unclosedError)?.storyTags?.find(tag => tag.tag === '短期记忆')).toMatchObject({ open: true, close: false });
  expect(safeFailureDiagnostic(unclosedError)?.storyTags?.find(tag => tag.tag === '正文')).toMatchObject({ open: true, close: true });
  expect(repairedError).toMatchObject({ details: { storyRule: 'narrative_short' } });
  expect(safeFailureDiagnostic(repairedError)?.recovery).toMatchObject({ attempted: true, succeeded: true, rule: 'unclosed_tags' });
  expect(safeFailureDiagnostic(repairedError)?.storyTags?.find(tag => tag.tag === '正文')).toMatchObject({ close: false });
  expect(JSON.stringify(safeFailureDiagnostic(repairedError))).not.toContain('主角把事情看完');
});

it('自动重试诊断区分未开启、次数、额度、中转、酒馆和程序异常', async () => {
  retryDelays.scale = 0;
  const signal = () => new AbortController().signal;
  const once = async (settings: ReturnType<typeof settingsFor>, error: unknown) => {
    let seen: ReturnType<typeof safeFailureDiagnostic>;
    await expect(executeWithAutoRetry({
      settings, signal: signal(), run: async () => { throw error; }, onRetry: () => {}, onFailure: failure => { seen = safeFailureDiagnostic(failure); },
    })).rejects.toBe(error);
    return seen;
  };
  expect((await once(settingsFor({ failureAutoRetry: false }), new AiError('invalid_output')))?.retry).toMatchObject({ extended: false, scheduled: false, stop: 'disabled', eligible: false, attempt: 1 });
  expect((await once(settingsFor({ failureAutoRetry: true, maxAutoRetries: 3 }), new AiError('rate_limit', 429, { quota: true })))?.retry).toMatchObject({ stop: 'quota', eligible: false, scheduled: false });
  const relay = new AiError('server', 500, { fieldPath: 'channel.relay' });
  manualRetryOnly.add(relay);
  expect((await once(settingsFor({ failureAutoRetry: true }), relay))?.retry).toMatchObject({ stop: 'relay_manual', eligible: false });
  const tavern = new AiError('rejected', undefined, { fieldPath: 'tavern.upstream.error' });
  manualRetryOnly.add(tavern);
  expect((await once(settingsFor({ failureAutoRetry: true }), tavern))?.retry).toMatchObject({ stop: 'tavern_manual' });
  const relayOff = new AiError('server', 502);
  manualRetryOnly.add(relayOff);
  attachFailureDiagnostic(relayOff, { relayUsed: true, relayEnabled: true, preset: 'off' });
  const relayOffDiagnostic = await once(settingsFor({ failureAutoRetry: true }), relayOff);
  expect(relayOffDiagnostic?.retry).toMatchObject({ stop: 'relay_manual' });
  expect(relayOffDiagnostic).toMatchObject({ relayUsed: true, preset: 'off' });
  const scripted = new AiError('invalid_output');
  manualRetryOnly.add(scripted);
  attachFailureDiagnostic(scripted, { preset: 'script', relayUsed: false });
  expect((await once(settingsFor({ failureAutoRetry: true }), scripted))?.retry).toMatchObject({ stop: 'tavern_manual' });
  const both = new AiError('rejected', undefined, { fieldPath: 'tavern.upstream.error' });
  manualRetryOnly.add(both);
  attachFailureDiagnostic(both, { preset: 'script', relayUsed: true });
  const bothDiagnostic = await once(settingsFor({ failureAutoRetry: true }), both);
  expect(bothDiagnostic?.retry).toMatchObject({ stop: 'tavern_manual' });
  expect(bothDiagnostic?.relayUsed).toBe(true);
  expect((await once(settingsFor({ failureAutoRetry: true }), new AiError('permission')))?.retry).toMatchObject({ stop: 'program', eligible: false });
  const retries: NonNullable<ReturnType<typeof safeFailureDiagnostic>>['retry'][] = [];
  await expect(executeWithAutoRetry({
    settings: settingsFor({ failureAutoRetry: true, maxAutoRetries: 1 }), signal: signal(),
    run: async () => { throw new AiError('server', 500); },
    onRetry: () => {},
    onFailure: failure => { retries.push(safeFailureDiagnostic(failure)?.retry); },
  })).rejects.toMatchObject({ code: 'server' });
  expect(retries.map(item => item?.scheduled)).toEqual([true, false]);
  expect(retries[0]).toMatchObject({ attempt: 1, max: 1, eligible: true, extended: true, scheduled: true, issued: true });
  expect(retries[1]).toMatchObject({ attempt: 2, stop: 'budget', scheduled: false });
  const off: NonNullable<ReturnType<typeof safeFailureDiagnostic>>['retry'][] = [];
  await expect(executeWithAutoRetry({
    settings: settingsFor({ failureAutoRetry: false }), signal: signal(),
    run: async () => { throw new AiError('server', 503); },
    onRetry: () => {},
    onFailure: failure => { off.push(safeFailureDiagnostic(failure)?.retry); },
  })).rejects.toMatchObject({ code: 'server' });
  expect(off[0]).toMatchObject({ extended: false, scheduled: true, eligible: true, waitMs: 0, attempt: 1, max: 1 });
  expect(off[1]).toMatchObject({ stop: 'budget', scheduled: false, attempt: 2 });
});

it('后续成功把先前失败标成已恢复，原文缓存淘汰后诊断还在，未勾选附件就不上传原文', () => {
  const first = new AiError('rejected');
  const second = new AiError('server', 500);
  const scope = { saveRef: 'local-ref', turnRef: 'local-turn' };
  classifyOnto(first, { error: { code: 'model_not_found', message: leak } }, 200);
  const early = runtimeLogEvent(1, 'story', 'failed', first, scope, { retain: true });
  const later = runtimeLogEvent(2, 'story', 'failed', second, scope, { retain: true });
  const done = runtimeLogEvent(3, 'story', 'completed', undefined, scope);
  const recovered = markRecoveredFailures([early, later], done);
  expect(recovered[0]).toBe(early);
  expect(recovered[0]?.diagnostic?.upstreamClass).toBe('model_missing');
  expect(recovered[0]?.diagnostic?.retry?.recovered).toBeUndefined();
  expect(recovered[1]?.httpStatus).toBe(500);
  expect(recovered[1]?.diagnostic).toBeUndefined();
  attachFailureDiagnostic(first, { retry: { extended: true, attempt: 1, max: 3, eligible: true, scheduled: true, issued: false } });
  const waiting = runtimeLogEvent(4, 'story', 'failed', first, scope, { retain: true });
  expect(markRecoveredFailures([waiting], done)[0]).toBe(waiting);
  expect(waiting.diagnostic?.retry?.recovered).toBeUndefined();
  waiting.diagnostic!.retry!.issued = true;
  const marked = markRecoveredFailures([waiting], done);
  expect(marked[0]).toBe(waiting);
  expect(waiting.diagnostic?.retry?.recovered).toBe(true);
  expect(failureDiagnosticSummary(waiting.diagnostic!)).toContain('同一次自动重试已恢复');
  const manual = runtimeLogEvent(5, 'story', 'started', undefined, scope);
  const laterRun = new AiError('rejected');
  attachFailureDiagnostic(laterRun, { retry: { extended: true, attempt: 1, max: 3, eligible: true, scheduled: true, issued: true } });
  const manualFailure = runtimeLogEvent(6, 'story', 'failed', laterRun, scope, { retain: true });
  markRecoveredFailures([manualFailure, manual], done);
  expect(manualFailure.diagnostic?.retry?.recovered).toBeUndefined();
  stageResponses.clear();
  for (let index = 0; index < 8; index += 1) {
    const id = stageResponses.begin({ saveId: 'save', turnId: 'turn', stage: 'story' });
    stageResponses.update(id, { status: 'failed', text: `模型原文 ${secret} ${index}`, nativeReasoning: `思考 ${secret}` }, []);
  }
  expect(stageResponses.getSnapshot().length).toBeLessThanOrEqual(6);
  const report = prepareErrorPayload([early], stageResponses.getSnapshot(), { content: false, reasoning: false })('玩家补充');
  expect(report.attachments).toBeUndefined();
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(JSON.stringify(report)).not.toContain('模型原文');
  expect(report.errors[0]?.code).toBe('rejected');
  expect(report.errors[0]?.diagnostic).toMatchObject({ upstreamClass: 'model_missing', errorInBody: true, httpStatus: 200, httpError: false });
  expect(asErrorReport(report).errors[0]?.diagnostic?.upstreamClass).toBe('model_missing');
});

it('旧版匿名反馈没有诊断字段时仍可读取', () => {
  const legacy = { version: 'V1.0 Beta', browser: 'chrome' as const, device: 'desktop' as const, kind: 'error' as const, errors: [
    { ref: 1, time: '2026-11-24T03:00:00.000Z', stage: 'story' as const, code: 'rejected', fieldPath: 'tavern.upstream.error' },
  ] };
  expect(asErrorReport(legacy).errors[0]?.diagnostic).toBeUndefined();
});

it('模拟酒馆上游错误的匿名反馈保留原错误码，并带上脱敏诊断', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'invalid_parameter', message: leak } }));
  const error = await fail(new AiClient(send).generate(snapshot(), messages, { tavernType: 'normal', stream: true, validateStoryOutputLimit: true }));
  const entry = runtimeLogEvent(1, 'story', 'failed', error, { saveRef: 'page-save', turnRef: 'page-turn' });
  const report = prepareErrorPayload([entry], stageResponses.getSnapshot(), { content: false, reasoning: false })('');
  expect(report.errors[0]).toMatchObject({
    code: 'rejected', fieldPath: 'tavern.upstream.error', stage: 'story',
    diagnostic: { upstreamClass: 'invalid_parameter', upstreamCode: 'invalid_parameter', errorInBody: true, phase: 'upstream_error' },
  });
  expect(report.attachments).toBeUndefined();
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.errors[0]?.diagnostic).not.toHaveProperty('timeoutSeconds');
  expect(asErrorReport(report).errors[0]?.code).toBe('rejected');
  writeFileSync('/tmp/tavern-upstream-feedback.json', JSON.stringify(report, null, 2));
});

it('连接失败和流读取失败落在不同环节，不留下套接字原文', async () => {
  const refused = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  const offline = await fail(new AiClient(refused).generate(snapshot(), messages, { stream: false }));
  expect(offline).toMatchObject({ code: 'network' });
  expect(safeFailureDiagnostic(offline)).toMatchObject({ phase: 'upstream_connect', relayUsed: false });
  expect(safeFailureDiagnostic(offline)?.upstreamClass).toBeUndefined();
  expect(safeFailureDiagnostic(offline)?.httpStatus).toBeUndefined();
  const broken = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"甲"}}]}\n\n'));
      controller.error(new Error(`socket ${secret}`));
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const reading = await fail(new AiClient(broken).generate(snapshot('variables'), messages, { stream: true }));
  expect(reading).toMatchObject({ code: 'stream_interrupted' });
  expect(safeFailureDiagnostic(reading)?.phase).toBe('upstream_read');
  expect(safeFailureDiagnostic(reading)?.upstreamClass).toBeUndefined();
  expect(JSON.stringify(safeFailureDiagnostic(reading))).not.toContain(secret);
  expect(String((reading as AiError).message)).not.toContain(secret);
});

it('酒馆超时分别落在等响应头、等首个数据和上游读取', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const lifetime = new AbortController();
  try {
    const phaseOf = async (kind: 'headers' | 'bytes' | 'read') => {
      let incoming: ReadableStreamDefaultController<Uint8Array> | undefined;
      let started!: () => void;
      const sent = new Promise<void>(resolve => { started = resolve; });
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
        started();
        if (kind === 'headers') await new Promise<void>(resolve => { setTimeout(resolve, 5_000); });
        return new Response(new ReadableStream({ start(controller) { incoming = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
      });
      const pending = fail(new AiClient(transport).generate(snapshot(), messages, {
        tavernType: 'normal', stream: true, timeoutSeconds: 1, validateStoryOutputLimit: true, signal: lifetime.signal,
      }));
      await sent;
      if (kind !== 'headers') await vi.advanceTimersByTimeAsync(80);
      if (kind === 'read') incoming?.enqueue(new TextEncoder().encode(': ping\n\n'));
      await vi.advanceTimersByTimeAsync(1_100);
      const error = await pending;
      expect(error).toMatchObject({ code: 'timeout' });
      return safeFailureDiagnostic(error)?.phase;
    };
    expect(await phaseOf('headers')).toBe('awaiting_headers');
    expect(await phaseOf('bytes')).toBe('awaiting_bytes');
    expect(await phaseOf('read')).toBe('upstream_read');
  } finally {
    lifetime.abort();
    vi.useRealTimers();
  }
});

it('酒馆包装还原失败和预设初始化失败各自留下环节，不上传脚本异常', async () => {
  const dispatch = globalThis.fetch;
  const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ message: { content: '包装前正文' }, finish_reason: 'stop' }],
  }));
  const intercepted = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    await dispatch(input, init);
    return new Response(`wrapper ${secret}`, { status: 502 });
  });
  try {
    const error = await fail(new AiClient(upstream).generate(snapshot(), messages, {
      tavernType: 'normal', stream: false, validateStoryOutputLimit: true,
    }));
    expect(error).toMatchObject({ code: 'rejected', details: { fieldPath: 'tavern.wrapper.http' } });
    expect(safeFailureDiagnostic(error)).toMatchObject({ phase: 'wrapper_restore', httpStatus: 502, httpError: true });
    expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(secret);
    expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain('包装前正文');
  } finally { intercepted.mockRestore(); }
  tavernTools.register({
    name: 'diag_probe', description: '诊断探针',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    shouldRegister: () => { throw new Error(`script ${secret}`); },
  });
  try {
    const error = await fail(new AiClient(vi.fn<typeof fetch>()).generate(snapshot(), messages, { tavernType: 'normal', stream: false }));
    expect(error).toMatchObject({ code: 'configuration', details: { fieldPath: 'tavern.shouldRegister' } });
    expect(safeFailureDiagnostic(error)?.phase).toBe('preset_init');
    expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(secret);
  } finally { tavernTools.unregister('diag_probe'); }
});

it('连续自动重试各自保留诊断，勾选原文时也不会串到另一次请求', async () => {
  retryDelays.scale = 0;
  const correlation = new FeedbackCorrelation();
  const scope = { saveRef: 'retry-save-ref', turnRef: 'retry-turn-ref' };
  const ids = { saveId: 'synthetic-retry-save', turnId: 'synthetic-retry-turn', stage: 'story' as const };
  correlation.record(runtimeLogEvent(1, 'story', 'started', undefined, scope), ids.saveId, ids.turnId);
  const texts = ['第一次模型原文 ALPHA', '第二次模型原文 BETA'];
  let index = 0;
  const logs: RuntimeLogEntry[] = [];
  await expect(executeWithAutoRetry({
    settings: settingsFor({ failureAutoRetry: true, maxAutoRetries: 1 }),
    signal: new AbortController().signal,
    run: async () => {
      const id = stageResponses.begin(ids);
      stageResponses.update(id, {
        status: 'failed', text: texts[index], nativeReasoning: `思考 ${texts[index]}`,
        error: { code: 'server', message: 'server' },
      }, []);
      index += 1;
      throw new AiError('server', 500);
    },
    onRetry: () => {},
    onFailure: failure => {
      const entry = runtimeLogEvent(logs.length + 2, 'story', 'failed', failure, scope, { retain: true });
      logs.push(entry);
      correlation.record(entry, ids.saveId, ids.turnId);
    },
  })).rejects.toMatchObject({ code: 'server' });
  expect(logs.map(entry => entry.diagnostic?.retry?.attempt)).toEqual([1, 2]);
  expect(logs[0]?.diagnostic?.retry).toMatchObject({ scheduled: true, eligible: true });
  expect(logs[1]?.diagnostic?.retry).toMatchObject({ stop: 'budget', scheduled: false });
  const report = prepareErrorPayload(logs, stageResponses.getSnapshot(), { content: true, reasoning: false })('');
  expect(report.attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ errorRef: 1, content: texts[0] }),
    expect.objectContaining({ errorRef: 2, content: texts[1] }),
  ]));
  expect(report.errors.map(error => error.diagnostic?.retry?.attempt)).toEqual([1, 2]);
  expect(JSON.stringify(report.errors[0])).not.toContain('BETA');
  expect(JSON.stringify(report.errors[1])).not.toContain('ALPHA');
  const hidden = prepareErrorPayload(logs, stageResponses.getSnapshot(), { content: false, reasoning: false })('');
  expect(hidden.attachments).toBeUndefined();
  expect(JSON.stringify(hidden)).not.toContain('ALPHA');
  expect(JSON.stringify(hidden)).not.toContain('BETA');
});

it('脱敏只丢掉不合格字段，中文模型名保留，密钥、URL 和未知代码不进复制日志或反馈', () => {
  expect(publishDiagnosticModel('深夜剧场')).toBe('深夜剧场');
  expect(publishDiagnosticModel('https://evil.example/v1/models/leak')).toBeUndefined();
  expect(publishDiagnosticModel('sk-live-SECRET-KEY-EXTRA')).toBeUndefined();
  const oddSecret = 'pw_8f-not-a-standard-key';
  const store = memory();
  vi.stubGlobal('window', { localStorage: store, sessionStorage: store });
  const channel = newChannel();
  const config = defaultAiConfig();
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '深夜剧场' };
  saveAiConfig(store, config);
  new CredentialVault(store, store).set(channel.id, oddSecret);
  expect(publishDiagnosticModel(`route-${oddSecret}`)).toBeUndefined();
  expect(publishDiagnosticModel('深夜剧场')).toBe('深夜剧场');
  const localId = requestInspections.start(snapshot(), JSON.stringify({ model: 'diag-model', messages: [{ role: 'user', content: 'hello' }] }));
  const error = new AiError('server', 500);
  attachFailureDiagnostic(error, {
    model: `echo-${oddSecret}-${localId}`,
    httpStatus: 500,
    elapsedMs: 8,
    phase: 'upstream_error',
    upstreamClass: 'unrecognized',
    upstreamCode: 'not-a-standard-key',
    upstreamType: 'toString',
    finishReason: `${secret} https://evil.example/raw`,
  });
  const diagnostic = safeFailureDiagnostic(error);
  expect(diagnostic?.model).toBeUndefined();
  expect(diagnostic?.upstreamCode).toBeUndefined();
  expect(diagnostic?.upstreamType).toBeUndefined();
  expect(diagnostic?.finishReason).toBeUndefined();
  expect(diagnostic).toMatchObject({ httpStatus: 500, elapsedMs: 8, phase: 'upstream_error', upstreamClass: 'unrecognized' });
  const kept = new AiError('invalid_output');
  attachFailureDiagnostic(kept, { model: '深夜剧场', httpStatus: 200, phase: 'story_validation', upstreamCode: 'weird_vendor_code' });
  expect(safeFailureDiagnostic(kept)).toMatchObject({ model: '深夜剧场', httpStatus: 200, phase: 'story_validation' });
  expect(safeFailureDiagnostic(kept)?.upstreamCode).toBeUndefined();
  const entry = runtimeLogEvent(1, 'story', 'failed', error, { saveRef: 'copy-ref', turnRef: 'copy-turn' });
  const copied = JSON.stringify(entry);
  const report = prepareErrorPayload([entry], [], { content: false, reasoning: false })('');
  for (const value of [secret, oddSecret, 'evil.example', 'not-a-standard-key', localId, 'toString']) {
    expect(copied).not.toContain(value);
    expect(JSON.stringify(report)).not.toContain(value);
  }
  expect(report.errors[0]?.diagnostic).toMatchObject({ httpStatus: 500, elapsedMs: 8, upstreamClass: 'unrecognized' });
  expect(report.errors[0]?.diagnostic?.model).toBeUndefined();
  requestInspections.clear();
});

it('模型名同时对照本次请求快照的凭证，本地密钥删掉后也不会留下', async () => {
  const snapshotSecret = 'snap+shot/key-99';
  const encoded = encodeURIComponent(snapshotSecret);
  const model = `vendor-${encoded}`;
  expect(model.includes(snapshotSecret)).toBe(false);
  expect(publishDiagnosticModel(model)).toBe(model);
  const isolated = memory();
  const channel = { ...newChannel(), baseUrl: 'https://diag.example/v1', defaultModel: 'diag-model' };
  const vault = new CredentialVault(isolated, isolated);
  vault.set(channel.id, snapshotSecret);
  const snap = channelSnapshot(channel, vault, model, 'story');
  vi.stubGlobal('window', { localStorage: memory(), sessionStorage: memory() });
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 500 }));
  const error = await fail(new AiClient(send).generate(snap, messages, { stream: false }));
  expect(error).toMatchObject({ code: 'server', status: 500 });
  expect(safeFailureDiagnostic(error)?.model).toBeUndefined();
  expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(snapshotSecret);
  expect(JSON.stringify(safeFailureDiagnostic(error))).not.toContain(encoded);
  const kept = new AiError('rejected');
  attachFailureDiagnostic(kept, { model: '深夜剧场' }, [snapshotSecret]);
  expect(safeFailureDiagnostic(kept)?.model).toBe('深夜剧场');
});

it('开闭边界能分开单侧、嵌套、重复和交叉标签', () => {
  expect(scanStoryTags('<正文>只有开头', false).find(tag => tag.tag === '正文')).toMatchObject({ open: true, close: false, malformed: true, duplicate: false, nested: false });
  expect(scanStoryTags('<正文>外<短期记忆>内</短期记忆>外</正文>', false).find(tag => tag.tag === '短期记忆')).toMatchObject({ nested: true, open: true, close: true, order: 'ok' });
  expect(scanStoryTags('<正文>一</正文><正文>二</正文>', false).find(tag => tag.tag === '正文')).toMatchObject({ duplicate: true, open: true, close: true });
  expect(scanStoryTags('</正文>颠倒<正文>', false).find(tag => tag.tag === '正文')).toMatchObject({ order: 'early', open: true, close: true });
  expect(scanStoryTags('<正文>头<短期记忆>记</正文></短期记忆>', false).find(tag => tag.tag === '短期记忆')).toMatchObject({ order: 'early', nested: false, open: true, close: true });
  expect(scanStoryTags('<正文>头</正文><短期记忆>记</短期记忆>', false).find(tag => tag.tag === '短期记忆')).toMatchObject({ order: 'ok', nested: false, malformed: false });
});

it('取消等待时只记下已计划，下一次尝试还没开始', async () => {
  retryDelays.scale = 0;
  const controller = new AbortController();
  let seen: unknown;
  await expect(executeWithAutoRetry({
    settings: settingsFor({ failureAutoRetry: true, maxAutoRetries: 3 }),
    signal: controller.signal,
    run: async () => { throw new AiError('server', 500); },
    onRetry: () => { controller.abort(); },
    onFailure: failure => { seen = failure; },
  })).rejects.toMatchObject({ code: 'cancelled' });
  const diagnostic = safeFailureDiagnostic(seen);
  expect(diagnostic?.retry).toMatchObject({ scheduled: true, issued: false });
  expect(failureDiagnosticSummary(diagnostic!)).toContain('已计划自动重试，下一次尝试尚未开始');
  expect(failureDiagnosticSummary(diagnostic!)).not.toContain('已发出');
  const saved = new AiError('server', 500);
  noteRetryDecision(saved, settingsFor({ failureAutoRetry: true, maxAutoRetries: 3 }), 1, { action: 'wait', ms: 0, retryIndex: 1, max: 3, reason: '生成失败' }, true);
  expect(markRetryIssued(saved)).toBeUndefined();
  expect(safeFailureDiagnostic(saved)?.retry?.issued).toBe(true);
  expect(failureDiagnosticSummary(safeFailureDiagnostic(saved)!)).toContain('已开始重试尝试，本次是第 1 次');
  expect(failureDiagnosticSummary(safeFailureDiagnostic(saved)!)).not.toContain('已发出');
});

it('两次失败被同一次自动重试恢复后，原文和公开思考仍分别挂在各自记录上', () => {
  const correlation = new FeedbackCorrelation();
  const scope = { saveRef: 'recover-save-ref', turnRef: 'recover-turn-ref' };
  const ids = { saveId: 'synthetic-recover-save', turnId: 'synthetic-recover-turn', stage: 'story' as const };
  correlation.record(runtimeLogEvent(1, 'story', 'started', undefined, scope), ids.saveId, ids.turnId);
  const texts = ['第一次失败原文', '第二次失败原文'];
  const thoughts = ['第一次公开思考', '第二次公开思考'];
  const responseIds: string[] = [];
  const logs = texts.map((text, index) => {
    const id = stageResponses.begin(ids);
    responseIds.push(id);
    stageResponses.update(id, { status: 'failed', text, nativeReasoning: thoughts[index], error: { code: 'server', message: 'server' } }, []);
    const error = new AiError('server', 500);
    attachFailureDiagnostic(error, {
      model: '深夜剧场',
      retry: { extended: true, attempt: index + 1, max: 3, eligible: true, scheduled: true, issued: true },
    });
    const entry = runtimeLogEvent(index + 2, 'story', 'failed', error, scope, { retain: true });
    correlation.record(entry, ids.saveId, ids.turnId);
    return entry;
  });
  const done = runtimeLogEvent(4, 'story', 'completed', undefined, scope);
  const stored = markRecoveredFailures(logs, done);
  expect(stored[0]).toBe(logs[0]);
  expect(stored[1]).toBe(logs[1]);
  expect(logs.every(entry => entry.diagnostic?.retry?.recovered)).toBe(true);
  const report = prepareErrorPayload(stored, stageResponses.getSnapshot(), { content: true, reasoning: true })('');
  expect(report.attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ errorRef: 1, content: texts[0], reasoning: thoughts[0] }),
    expect.objectContaining({ errorRef: 2, content: texts[1], reasoning: thoughts[1] }),
  ]));
  expect(report.attachments).toHaveLength(2);
  const uploaded = JSON.stringify(report);
  for (const id of [...responseIds, ids.saveId, ids.turnId]) expect(uploaded).not.toContain(id);
  expect(JSON.stringify(logs[0])).not.toContain(responseIds[0]);
  expect(JSON.stringify(logs[1])).not.toContain(responseIds[1]);
  expect(report.errors[0]?.diagnostic?.model).toBe('深夜剧场');
});

it('成功响应之后的正文校验仍保留请求事实，并分开原文、提取结果和续写解析输入', async () => {
  async function failedStory(text: string, partial?: string) {
    const config = defaultAiConfig();
    const channel = newChannel();
    channel.defaultModel = '深夜剧场';
    channel.baseUrl = 'https://diag.example/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: '' };
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const vault = new CredentialVault(storage, storage);
    vault.set(channel.id, 'synthetic-not-a-real-key');
    const state = game();
    const draft = createTurnDraft(state.saveId, state.revision, 'diag-turn', 'regular', '');
    const fetcher = vi.fn<typeof fetch>(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    return fail(runStageRequest(
      { stage: 'story', mode: 'regular', state, draft, userInput: '继续', settings: settingsFor() },
      config, vault, partial ? { continuation: { partial } } : {}, new AiClient(fetcher),
    ));
  }
  const raw = '<think><thinking>不该算正文</thinking></think><正文>短</正文><短期记忆>还在原地。</短期记忆>';
  const extracted = splitLeadingThink(raw).content;
  const plain = await failedStory(raw);
  expect(plain).toMatchObject({ code: 'invalid_output', details: { storyRule: 'narrative_short' } });
  const plainDiagnostic = safeFailureDiagnostic(plain);
  expect(plainDiagnostic).toMatchObject({
    model: '深夜剧场', protocol: 'openai', stream: true, preset: 'off', relayUsed: false,
    httpStatus: 200, httpError: false, phase: 'story_validation',
    contentChars: raw.length, extractedChars: extracted.length,
  });
  expect(raw).not.toBe(extracted);
  expect(plainDiagnostic?.bytes).toBeUndefined();
  expect(plainDiagnostic?.elapsedMs).toEqual(expect.any(Number));
  expect(plainDiagnostic?.parseTags).toBeUndefined();
  expect(plainDiagnostic?.storyTags?.find(tag => tag.tag === 'thinking')).toMatchObject({ open: true, close: true });
  expect(plainDiagnostic?.extractedTags?.find(tag => tag.tag === 'thinking')).toMatchObject({ open: false, close: false });
  expect(storyFailureText.get(plain as object)?.text).toBe(extracted);
  expect(JSON.stringify(plainDiagnostic)).not.toContain('不该算正文');

  const partial = '<正文>甲乙丙丁戊己庚辛';
  const addition = '<think>补记</think></正文><短期记忆>还在原地等候。</短期记忆>';
  const additionText = splitLeadingThink(addition).content;
  const parsed = mergeContinuation(partial, additionText);
  const continued = await failedStory(addition, partial);
  expect(continued).toMatchObject({ code: 'invalid_output', details: { storyRule: 'narrative_short' } });
  const continuedDiagnostic = safeFailureDiagnostic(continued);
  expect(continuedDiagnostic?.contentChars).toBe(addition.length);
  expect(continuedDiagnostic?.extractedChars).toBe(additionText.length);
  expect(continuedDiagnostic?.parseInputChars).toBe(parsed.length);
  expect(new Set([addition.length, additionText.length, parsed.length]).size).toBe(3);
  expect(continuedDiagnostic?.storyTags?.find(tag => tag.tag === '正文')).toMatchObject({ open: false, close: true, malformed: true });
  expect(continuedDiagnostic?.parseTags?.find(tag => tag.tag === '正文')).toMatchObject({ open: true, close: true, malformed: false });
  expect(continuedDiagnostic?.bytes).toBeUndefined();
  expect(continuedDiagnostic?.model).toBe('深夜剧场');
  expect(continuedDiagnostic?.httpStatus).toBe(200);
  expect(continuedDiagnostic?.phase).toBe('story_validation');
  const saved = storyFailureText.get(continued as object);
  expect(saved?.text).toBe(parsed);
  expect(saved?.text).not.toContain('<think>');
  expect(JSON.stringify(continuedDiagnostic)).not.toContain('补记');
});

