import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft } from '../domain/drafts';
import { AiClient } from '../services/ai/client';
import { safeAiError } from '../services/ai/errors';
import type { AiErrorCode } from '../services/ai/errors';
import { requestInspections } from '../services/ai/inspection';
import { stageResponses, storyToolDiagnosticExport } from '../services/ai/stageResponses';
import { storyInspections } from '../services/ai/storyInspection';
import { STORY_OUTPUT_TOOL } from '../services/ai/storyToolContract';
import { StoryToolTraceRecorder } from '../services/ai/storyToolTrace';
import type { StoryToolTrace } from '../services/ai/storyToolTrace';
import { SaveRepository } from '../services/storage/saveRepository';
import { StoryStage } from '../workflows/storyStage';
import { game } from './fixtures/game';
import { compatibilitySetup } from './fixtures/storyCompatibility';
import { toolFrame, toolStoryText } from './fixtures/storyTools';

const encoder = new TextEncoder();
const begin = toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'PRIVATE_TOOL_ID',
  function: { name: STORY_OUTPUT_TOOL, arguments: JSON.stringify({ content: toolStoryText }) },
}] } }] });
const finish = toolFrame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
const done = 'data: [DONE]\n\n';

type Scenario = {
  name: string;
  chunks: readonly (string | Uint8Array)[];
  tail?: 'error' | 'open';
  noBody?: boolean;
  contentType?: string | null;
  mimeClass?: StoryToolTrace['contentType'];
  interrupt?: 'cancelled' | 'timeout';
  code: AiErrorCode | 'ok';
  expected: Partial<NonNullable<StoryToolTrace['sse']>>;
};

const scenarios: Scenario[] = [
  { name: 'reader 拒绝，半个 UTF-8 字符尚未 flush', chunks: ['data: ', Uint8Array.of(0xe4, 0xb8)],
    tail: 'error', code: 'stream_interrupted', expected: { readerEof: false, failureSite: 'reader_read',
      reads: 2, bytes: 8, bufferedTail: true, pendingData: false } },
  { name: '非法 UTF-8 块', chunks: [Uint8Array.of(0xff)], code: 'stream_interrupted',
    expected: { readerEof: false, failureSite: 'utf8_chunk', reads: 1 } },
  { name: '正常 EOF 刷新 UTF-8 解码器时失败', chunks: [Uint8Array.of(0xe4, 0xb8)], code: 'stream_interrupted',
    expected: { readerEof: true, failureSite: 'utf8_eof', reads: 1 } },
  { name: '正常 EOF 时残留 HTML', chunks: ['<!doctype html>\n<div>PRIVATE_HTML</div>'],
    contentType: 'TEXT/HTML; fixture=PRIVATE_HEADER_PARAM', mimeClass: 'html', code: 'stream_interrupted',
    expected: { readerEof: true, failureSite: 'unrecognized_eof_tail', unrecognizedLines: 2, bufferedTail: true } },
  { name: 'JSON 后缀媒体类型仅用于诊断，仍走原 SSE 分支', chunks: ['{"error":"PRIVATE_RELAY_ERROR"}'],
    contentType: 'application/problem+json; fixture=PRIVATE_HEADER_PARAM', mimeClass: 'other_json', code: 'stream_interrupted',
    expected: { readerEof: true, failureSite: 'unrecognized_eof_tail', unrecognizedLines: 1 } },
  { name: '纯注释正常 EOF', chunks: [': PRIVATE_HEARTBEAT\n\n'], code: 'tool_response',
    expected: { readerEof: true, failureSite: null, commentLines: 1, blankLines: 1, unrecognizedLines: 0 } },
  { name: '纯注释后读取抛错', chunks: [': PRIVATE_HEARTBEAT\n\n'], tail: 'error', code: 'stream_interrupted',
    expected: { readerEof: false, failureSite: 'reader_read', commentLines: 1, unrecognizedLines: 0 } },
  { name: '有数据行但无分隔，随后读取抛错', chunks: [begin.slice(0, -1)], tail: 'error', code: 'stream_interrupted',
    expected: { readerEof: false, failureSite: 'reader_read', dataLines: 1, blankLines: 0, pendingData: true, delimitedDataEvents: 0 } },
  { name: '兼容路径交出 EOF 残留的数据，坏 JSON 仍拒绝', chunks: ['data: {'],
    code: 'invalid_json', expected: { readerEof: true, failureSite: null, dataLines: 1, eofDataEvents: 1, delimitedDataEvents: 0 } },
  { name: '无响应体', chunks: [], noBody: true, contentType: null, mimeClass: 'missing', code: 'stream_interrupted',
    expected: { readerEof: false, failureSite: 'missing_body', firstReadHadBytes: null, reads: 0 } },
  { name: '单 reader 收到真实 DONE 后关闭，忽略 cancel 拒绝', chunks: [new Uint8Array(), begin + finish + done],
    tail: 'open', code: 'ok', expected: { readerEof: false, failureSite: null, firstReadHadBytes: false, reads: 2, nonEmptyReads: 1,
      dataLines: 3, blankLines: 3, delimitedDataEvents: 3, eofDataEvents: 0 } },
  { name: '真实 EOF 补交 finish，任意 UTF-8 分块和 CRLF', chunks: [...encoder.encode(
    (begin + finish.trimEnd()).replaceAll('\n', '\r\n'))].map(byte => Uint8Array.of(byte)),
    code: 'ok', expected: { readerEof: true, failureSite: null, firstReadHadBytes: true,
      delimitedDataEvents: 1, eofDataEvents: 1, dataLines: 2 } },
  { name: '玩家取消不能伪造 EOF', chunks: [': ping\n\ndata: {'], tail: 'open', interrupt: 'cancelled',
    code: 'cancelled', expected: { readerEof: false, failureSite: null, bufferedTail: true } },
  { name: '心跳和无分隔数据不重置 120 秒计时', chunks: [': ping\n\n', begin.slice(0, -1)],
    tail: 'open', interrupt: 'timeout', code: 'timeout', expected: { readerEof: false, failureSite: null, pendingData: true } },
];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  requestInspections.clear();
  storyInspections.clear();
  stageResponses.clear();
});

function plannedResponse(scenario: Scenario) {
  let pulls = 0;
  const cancel = vi.fn(() => { throw Error('PRIVATE_CANCEL_ERROR'); });
  const body = scenario.noBody ? null : new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = scenario.chunks[pulls++];
      if (chunk !== undefined) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      else if (scenario.tail === 'error') controller.error(new TypeError('PRIVATE_READ_ERROR'));
      else if (scenario.tail !== 'open') controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  const mime = scenario.contentType === undefined ? 'text/event-stream' : scenario.contentType;
  const response = new Response(body, { headers: mime ? { 'Content-Type': mime } : {} });
  return { response, cancel, get pulls() { return pulls; }, getReader: body && vi.spyOn(body, 'getReader'),
    tee: body && vi.spyOn(body, 'tee'), clone: vi.spyOn(response, 'clone'), json: vi.spyOn(response, 'json') };
}

it.each(scenarios)('$name：三种观察器状态与 Repository 结果一致', async scenario => {
  async function run(mode: 'off' | 'on' | 'throws') {
    stageResponses.clear();
    const fixture = compatibilitySetup('openai', true, true);
    fixture.settings.runtime.timeoutSeconds = 120;
    fixture.settings.prompts.minNarrativeChars = 1;
    const repo = await SaveRepository.open('sse-observation-fixture', new IDBFactory());
    const time = '2026-10-18T00:00:00.000Z';
    const state = { ...game(), createdAt: time, updatedAt: time };
    await repo.create(state);
    const draft = await repo.saveDraft(createTurnDraft(state.saveId, 0, 'PRIVATE_TURN', 'opening', ''), null);
    const before = await repo.loadGame(state.saveId);
    const save = vi.spyOn(repo, 'saveDraft'), commit = vi.spyOn(repo, 'commitTurn');
    const plan = plannedResponse(scenario);
    const outbound: string[] = [];
    let signal: AbortSignal | null | undefined;
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      outbound.push(createHash('sha256').update(JSON.stringify({ url: String(url), method: init?.method,
        headers: [...new Headers(init?.headers)], body: init?.body })).digest('hex'));
      return plan.response;
    });
    const client = new AiClient(transport);
    if (mode === 'off') {
      const generate = client.generate.bind(client);
      vi.spyOn(client, 'generate').mockImplementation((snapshot, messages, options) =>
        generate(snapshot, messages, { ...options, onStoryToolTrace: undefined }));
    }
    const observations = mode === 'throws' ? (['opened', 'sseRead', 'sseBuffer', 'sseCount', 'sseFailure'] as const)
      .map(method => vi.spyOn(StoryToolTraceRecorder.prototype, method).mockImplementation(() => { throw Error('PRIVATE_OBSERVER_ERROR'); })) : [];
    const stage = new StoryStage(repo, client);
    const failureSaved = vi.fn();
    try {
      if (scenario.interrupt === 'timeout') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const pending = stage.generate({ ...fixture, draft, onFailureSaved: failureSaved }).then(() => ({ code: 'ok' }), safeAiError);
      if (scenario.interrupt) {
        await vi.waitFor(() => expect(plan.pulls).toBeGreaterThan(scenario.chunks.length));
        if (scenario.interrupt === 'cancelled') stage.cancel();
        else await vi.advanceTimersByTimeAsync(120000);
        expect(signal?.aborted).toBe(true);
      }
      const result = await pending;
      expect(result.code).toBe(scenario.code);
      expect(transport).toHaveBeenCalledTimes(1);
      if (plan.getReader) expect(plan.getReader).toHaveBeenCalledTimes(1);
      if (plan.tee) expect(plan.tee).not.toHaveBeenCalled();
      expect(plan.clone).not.toHaveBeenCalled();
      expect(plan.json).not.toHaveBeenCalled();
      if (scenario.tail === 'open') expect(plan.cancel).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
      const after = await repo.loadGame(state.saveId);
      expect(after.state).toEqual(before.state);
      if (scenario.code === 'ok') {
        expect(save).toHaveBeenCalledTimes(1);
        expect(after.draft?.story?.narrative).toBe('中文🙂，3<5。');
        expect(failureSaved).not.toHaveBeenCalled();
      } else if (scenario.code === 'cancelled') {
        expect(save).not.toHaveBeenCalled();
        expect(after).toEqual(before);
      } else {
        expect(save).toHaveBeenCalledTimes(1);
        expect(failureSaved).toHaveBeenCalledTimes(1);
        expect(after.draft?.story).toBeUndefined();
        expect(after.draft?.storyPartial).toBeUndefined();
        expect(after.draft?.failures.at(-1)).toMatchObject({ stage: 'story', errorCode: scenario.code });
      }
      if (mode === 'throws') {
        expect(observations[0]).toHaveBeenCalledTimes(1);
        if (!scenario.noBody) expect(observations[1]).toHaveBeenCalled();
        if (scenario.expected.failureSite) expect(observations[4]).toHaveBeenCalledExactlyOnceWith(scenario.expected.failureSite);
      }
      const summary = storyToolDiagnosticExport(stageResponses.getSnapshot()[0]);
      if (mode === 'off') expect(summary).toBeUndefined();
      if (mode === 'on') {
        const contentType = scenario.mimeClass ?? 'event_stream';
        const boundary = scenario.code === 'ok' ? scenario.tail === 'open' ? 'done-marker' : 'eof'
          : scenario.code === 'tool_response' ? 'eof' : null;
        expect(summary).toMatchObject({ contentType, boundary, sse: scenario.expected });
        if (scenario.code === 'stream_interrupted' && !scenario.noBody)
          expect(summary).toMatchObject({ firstBodyChunkMs: expect.any(Number), firstSseFrameMs: null, outcome: { frame: 0 } });
        expect(JSON.stringify(summary)).not.toMatch(/PRIVATE_|[\u4e00-\u9fff]|fictional-phase3-key|https?:\/\//);
      }
      return { result, outbound, after };
    } finally {
      for (const observer of observations) observer.mockRestore();
      vi.useRealTimers();
      stage.dispose();
      repo.close();
    }
  }

  const off = await run('off');
  expect(await run('on')).toEqual(off);
  expect(await run('throws')).toEqual(off);
});

it('逐次累计有界，封存后忽略迟到观测', () => {
  const trace = StoryToolTraceRecorder.start('openai', 'synthetic', 'https://relay.example/v1', true, 120);
  trace.opened('sse', 'application/problem+json; fixture=PRIVATE_HEADER_PARAM');
  trace.sseRead(2 ** 30);
  trace.sseRead(2 ** 30);
  trace.sseRead(1);
  trace.sseCount('unrecognizedLines', 2 ** 31);
  const summary = trace.seal({ code: 'stream_interrupted' });
  expect(summary).toMatchObject({ contentType: 'other_json', sse: {
    firstReadHadBytes: true, reads: 3, nonEmptyReads: 3, bytes: 2 ** 31 - 1, saturated: true, failureSite: null, readerEof: false,
    unrecognizedLines: 2 ** 31 - 1,
  } });
  trace.sseRead(null);
  trace.sseFailure('reader_read');
  expect(trace.seal({ code: 'stream_interrupted' }).sse).toEqual(summary.sse);
});
