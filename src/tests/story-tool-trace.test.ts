import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import type { RequestOptions } from '../services/ai/client';
import { safeAiError } from '../services/ai/errors';
import { requestInspections } from '../services/ai/inspection';
import { runStageRequest } from '../services/ai/runtime';
import { stageResponses, storyToolDiagnosticExport } from '../services/ai/stageResponses';
import { storyInspections } from '../services/ai/storyInspection';
import { channelSnapshot } from '../services/ai/snapshot';
import { STORY_OUTPUT_TOOL } from '../services/ai/storyToolContract';
import { StoryToolTraceRecorder } from '../services/ai/storyToolTrace';
import type { StoryToolTrace } from '../services/ai/storyToolTrace';
import { createTurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { compatibilityProtocols, compatibilitySetup, storyEnvelope } from './fixtures/storyCompatibility';
import { splitResponse } from './fixtures/responseEvents';
import { carrierResponse, toolFrame, toolStoryText } from './fixtures/storyTools';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { variableReply } from './fixtures/variableReply';

const prompt = [{ role: 'user' as const, content: 'PRIVATE_FIXTURE_PROMPT' }];
const done = 'data: [DONE]\n\n';
const finish = toolFrame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
const usage = toolFrame({ choices: [], usage: { completion_tokens: 12 } });
const args = JSON.stringify({ content: toolStoryText });
const begin = toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'PRIVATE_TOOL_ID',
  function: { name: STORY_OUTPUT_TOOL, arguments: args } }] } }] });
const additionalArgs = toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'late' } }] } }] });
const reasoning = toolFrame({ choices: [{ delta: { reasoning_content: 'PRIVATE_FIXTURE_THOUGHT' } }] });
const relayId = 'PRIVATE_SYNTHETIC_COMPLETION_ID';
const relayTail = (choice: Record<string, unknown> = {}, root: Record<string, unknown> = {}) =>
  toolFrame({ id: relayId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls', ...choice }], ...root });
function relayFrames(raw = args) {
  // The first 15 frames and frame 17 are synthetic padding/usage. Only the
  // observed combined finish (16) and repeated finish (18) are reconstructed.
  return reasoning + toolFrame({ choices: [{ delta: {} }] }).repeat(14)
    + relayTail({ delta: { tool_calls: [{ index: 0, id: 'PRIVATE_TOOL_ID', type: 'function',
      function: { name: STORY_OUTPUT_TOOL, arguments: raw } }] } }) + usage;
}
const snapshot = (protocol = 'openai' as typeof compatibilityProtocols[number]) => {
  const { channel, vault } = compatibilitySetup(protocol, true, true);
  return channelSnapshot(channel, vault);
};

async function capture(makeResponse: () => Response, options: RequestOptions = {}, enabled = true, protocol = snapshot().channel.protocol) {
  const outbound: unknown[] = [];
  const traces: StoryToolTrace[] = [];
  const deltas: string[] = [];
  const client = new AiClient(async (url, init) => {
    outbound.push({ url, body: init?.body, headers: init?.headers });
    return makeResponse();
  });
  const result = await client.generate(snapshot(protocol), prompt, {
    stream: true, storyToolOutput: true, onDelta: value => deltas.push(value),
    onStoryToolTrace: enabled ? value => { traces.push(value); } : undefined, ...options,
  }).catch(safeAiError);
  return { result, outbound, deltas, traces };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  requestInspections.clear();
  storyInspections.clear();
  stageResponses.clear();
});

it.each(compatibilityProtocols.flatMap(protocol => [true, false].map(stream => ({ protocol, stream }))))(
  '$protocol SSE=$stream：有无观察器的出站、结果、回调一致，记录真实边界', async ({ protocol, stream }) => {
    const response = () => carrierResponse(protocol, stream);
    const on = await capture(response, { stream }, true, protocol);
    const off = await capture(response, { stream }, false, protocol);
    const { traces, ...observed } = on;
    expect({ ...observed, traces: [] }).toEqual(off);
    expect(on.outbound).toHaveLength(1);
    expect(on.result).toMatchObject({ text: toolStoryText });
    const trace = traces[0];
    expect(traces).toHaveLength(1);
    expect(trace).toMatchObject({ protocol, requestedStream: stream, observedTransport: stream ? 'sse' : 'json', httpStatus: 200,
      counts: { 'tool-start': 1, 'tool-end': 1, 'provider-finish': 1 },
      outcome: { code: 'received' }, boundary: !stream ? 'json-body' : protocol === 'openai' || protocol === 'deepseek' ? 'done-marker' : 'eof' });
    if (stream) expect(trace.firstBodyChunkMs).toBeLessThanOrEqual(trace.firstSseFrameMs!);
    else expect(trace.firstBodyChunkMs).toBeNull();
  },
);

it.each([
  ['duplicate_provider_finish', begin + finish + toolFrame({ choices: [{ delta: { role: 'assistant' }, finish_reason: 'tool_calls' }] })],
  ['tool_event_after_finish', reasoning + finish + begin],
  ['projector_reopened_slot', begin + finish + additionalArgs],
  ['reasoning_after_finish', begin + finish + reasoning],
  ['projector_reopened_slot', begin + finish + begin],
] as const)('OpenAI 中转 %s 保持原错误、精确记录分支', async (orderingSite, frames) => {
  const response = () => splitResponse(frames + done, 3);
  const on = await capture(response);
  const off = await capture(response, {}, false);
  expect(on.result).toEqual(off.result);
  expect(on.result).toMatchObject({ code: 'tool_response', details: { fieldPath: 'storyTool.ordering' } });
  expect(on.traces[0].outcome).toMatchObject({ orderingSite, toolRule: 'ordering', frame: 3 });
  expect(on.traces[0].boundary).toBeNull();
  expect(on.deltas).toEqual([]);
  expect(on.outbound).toEqual(off.outbound);
  expect(on.outbound).toHaveLength(1);
  if (orderingSite === 'duplicate_provider_finish') expect(on.traces[0].counts['provider-finish']).toBe(2);
  if (orderingSite === 'reasoning_after_finish') expect(on.traces[0].events.at(-1)).toMatchObject({ reasoningPresent: true });
});

it.each([
  ['done-marker', done, relayTail()],
  ['eof', '', relayTail({ delta: { content: null, reasoning_content: '', refusal: null }, logprobs: null }, { usage: null })],
] as const)('第 16–18 帧纯结束重报，仍须收到真实 %s', async (boundary, end, repeated) => {
  const response = () => splitResponse(relayFrames() + repeated + end, 3);
  const { traces, ...withObservation } = await capture(response);
  const withoutObservation = await capture(response, {}, false);
  expect({ ...withObservation, traces: [] }).toEqual(withoutObservation);
  expect(withObservation.outbound).toHaveLength(1);
  expect(withObservation.result).toMatchObject({ text: toolStoryText, usage: { outputTokens: 12 } });
  expect(withObservation.deltas).toEqual([toolStoryText]);
  expect(traces[0]).toMatchObject({
    endpointKind: 'relay', observedTransport: 'sse', httpStatus: 200, boundary,
    firstProviderFinish: { frame: 16, reason: 'tool_calls' },
    counts: { 'provider-finish': 2, 'tolerated-provider-finish': 1, 'tool-end': 1 },
    outcome: { code: 'received' },
  });
  expect(traces[0].events).toContainEqual(expect.objectContaining({ kind: 'tolerated-provider-finish', frame: 18 }));
  expect(JSON.stringify(traces[0])).not.toMatch(/PRIVATE_|中文|fictional-phase3-key|https:\/\//);
});

it.each([
  ['重复帧携带参数', relayTail({ delta: { tool_calls: [{ index: 0, function: { arguments: 'late' } }] } }), 'tool_response', 'storyTool.ordering'],
  ['另开工具调用', begin, 'tool_response', 'storyTool.ordering'],
  ['独立迟到参数', additionalArgs, 'tool_response', 'storyTool.ordering'],
  ['重复帧携带推理', relayTail({ delta: { reasoning_content: 'late' } }), 'tool_response', 'storyTool.ordering'],
  ['独立迟到文字', toolFrame({ choices: [{ delta: { content: 'late' } }] }), 'tool_response', 'storyTool.mixed_text'],
  ['独立迟到多段文字', toolFrame({ choices: [{ delta: { content: [{ type: 'text', text: 'late' }] } }] }), 'tool_response', 'storyTool.mixed_text'],
  ['重复帧携带空白文字', relayTail({ delta: { content: ' ' } }), 'tool_response', 'storyTool.mixed_text'],
  ['矛盾结束', relayTail({ finish_reason: 'stop' }), 'tool_response', 'storyTool.finish'],
  ['截断结束', relayTail({ finish_reason: 'length' }), 'output_limit', undefined],
  ['拒绝结束', relayTail({ finish_reason: 'content_filter' }), 'content_filter', undefined],
  ['不同响应 ID', relayTail({}, { id: 'other' }), 'tool_response', 'storyTool.ordering'],
  ['重复帧另报用量', relayTail({}, { usage: { completion_tokens: 999 } }), 'tool_response', 'storyTool.ordering'],
  ['重复帧携带其他选择字段', relayTail({ message: { content: 'late' } }), 'tool_response', 'storyTool.ordering'],
  ['服务商错误', relayTail({}, { error: { message: 'PRIVATE_RELAY_ERROR' } }), 'rejected', undefined],
  ['error 事件伪装 DONE', 'event: error\ndata: [DONE]\n\n', 'rejected', undefined],
] as const)('已容忍纯尾帧仍拒绝%s', async (_name, tail, code, fieldPath) => {
  const { result, traces, outbound, deltas } = await capture(() => splitResponse(relayFrames() + relayTail() + tail + done, 7));
  expect(result).toMatchObject({ code, ...(fieldPath && { details: { fieldPath } }) });
  expect(traces[0]).toMatchObject({ boundary: null, counts: { 'tolerated-provider-finish': 1 }, outcome: { code } });
  expect(outbound).toHaveLength(1);
  expect(deltas).toEqual([]);
});

it.each(['aborted-body', 'cancelled', 'incomplete-json'] as const)(
  '第 18 帧后 %s：不保存 Story 候选、草稿或正式世界', async failure => {
    const input = compatibilitySetup('openai', true, true);
    const repo = await SaveRepository.open('relay-tail-safety', new IDBFactory());
    await repo.create(worldState());
    const draft = await repo.saveDraft(createTurnDraft('save-a', 0, 'relay-tail-draft', 'opening', ''), null);
    const before = await repo.loadGame('save-a');
    const save = vi.spyOn(repo, 'saveDraft'), commit = vi.spyOn(repo, 'commitTurn');
    let wire!: ReadableStreamDefaultController<Uint8Array>;
    const cancelReader = vi.fn();
    const transport = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        wire = c;
        const body = relayFrames(failure === 'incomplete-json' ? '{"content":' : args) + relayTail();
        c.enqueue(new TextEncoder().encode(body + (failure === 'incomplete-json' ? done : '')));
        if (failure === 'incomplete-json') c.close();
      },
      cancel: cancelReader,
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const stage = new StoryStage(repo, new AiClient(transport));
    try {
      let frames = 0;
      const recordPayload = StoryToolTraceRecorder.prototype.payload;
      vi.spyOn(StoryToolTraceRecorder.prototype, 'payload').mockImplementation(function (this: StoryToolTraceRecorder, ...event) {
        recordPayload.apply(this, event);
        frames = event[0].source.sequence;
      });
      const result = stage.generate({ ...input, draft }).catch(safeAiError);
      await vi.waitFor(() => expect(frames).toBe(18));
      if (failure === 'aborted-body') wire.error(new Error('synthetic disconnect before transport boundary'));
      if (failure === 'cancelled') stage.cancel();
      expect(await result).toMatchObject(failure === 'incomplete-json'
        ? { code: 'tool_response', details: { fieldPath: 'storyTool.arguments' } }
        : { code: failure === 'cancelled' ? 'cancelled' : 'stream_interrupted' });
      if (failure === 'cancelled') expect(cancelReader).toHaveBeenCalledTimes(1);
      const exported = storyToolDiagnosticExport(stageResponses.getSnapshot()[0]);
      expect(exported).toMatchObject({ counts: { 'tolerated-provider-finish': 1 },
        boundary: failure === 'incomplete-json' ? 'done-marker' : null });
      expect(save).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(await repo.loadGame('save-a')).toEqual(before);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally { stage.dispose(); repo.close(); }
  },
);

it('保留同一帧的最后参数、供应商结束与派生 tool-end，接受纯 usage 尾帧', async () => {
  const combined = toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'PRIVATE_TOOL_ID',
    function: { name: STORY_OUTPUT_TOOL, arguments: args } }] }, finish_reason: 'tool_calls' }] });
  const { traces, result } = await capture(() => splitResponse(combined + usage + done, 1));
  expect(result).toMatchObject({ text: toolStoryText, usage: { outputTokens: 12 } });
  expect(traces[0].events.map(event => [event.frame, event.kind])).toEqual([
    [1, 'sse-frame'], [1, 'provider-finish'], [1, 'tool-start'], [1, 'tool-arguments'], [1, 'tool-end'],
    [2, 'sse-frame'], [3, 'sse-frame'], [3, 'done-marker'],
  ]);
  expect(traces[0].events.find(event => event.kind === 'tool-end')?.derivedFrom).toBe('choice-finish');
});

it('Anthropic 原生停止顺序诊断与 OpenAI 分支独立', async () => {
  const body = toolFrame({ type: 'message_stop' });
  const { traces, result } = await capture(() => splitResponse(body, 1), {}, true, 'anthropic');
  expect(result).toMatchObject({ code: 'tool_response', details: { fieldPath: 'storyTool.ordering' } });
  expect(traces[0].outcome.orderingSite).toBe('message_stop_before_required_boundaries');
  expect(traces[0].events[0]).toMatchObject({ providerType: 'message_stop' });
  expect(traces[0].counts['message-stop']).toBe(1);
});

it('HTTP 失败和 JSON 回退保留实际传输，错误体只消费一次', async () => {
  const response = Response.json({ error: { message: 'PRIVATE_FIXTURE_ERROR' } }, { status: 400 });
  const json = vi.spyOn(response, 'json');
  const { traces, result } = await capture(() => response);
  expect(json).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ code: 'rejected' });
  expect(traces[0]).toMatchObject({ observedTransport: 'http', httpStatus: 400, firstBodyChunkMs: null,
    outcome: { code: 'rejected' } });
  const fallback = await capture(() => carrierResponse('openai', false));
  expect(fallback.traces[0]).toMatchObject({ requestedStream: true, observedTransport: 'json', firstBodyChunkMs: null });
  expect(fallback.result).toMatchObject({ text: toolStoryText });
});

it('诊断回调故障不改变请求结果', async () => {
  const on = await capture(() => splitResponse(begin + finish + done, 3), { onStoryToolTrace: () => { throw Error('synthetic observer fault'); } });
  expect(on.result).toMatchObject({ text: toolStoryText });
  expect(on.outbound).toHaveLength(1);
});

it.each(['timeout', 'cancelled'] as const)('持续有字节和工具参数仍受总超时/取消保护：%s', async code => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  const results = [];
  for (const enabled of [false, true]) {
    const controller = new AbortController();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    let release!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const collected: StoryToolTrace[] = [];
    const delta = vi.fn();
    const response = new AiClient(transport).generate(snapshot(), prompt, { storyToolOutput: true, stream: true,
      timeoutSeconds: 120, signal: controller.signal, onDelta: delta,
      onStoryToolTrace: enabled ? trace => { collected.push(trace); } : undefined }).catch(safeAiError);
    const emit = (text: string) => body.enqueue(new TextEncoder().encode(text));
    await vi.advanceTimersByTimeAsync(1000);
    release(new Response(new ReadableStream({ start(c) { body = c; } }), { headers: { 'content-type': 'text/event-stream' } }));
    await vi.advanceTimersByTimeAsync(1000);
    emit(': ping\n\n');
    await vi.advanceTimersByTimeAsync(1000);
    emit(begin);
    await vi.advanceTimersByTimeAsync(1000);
    emit(finish + finish);
    if (code === 'timeout') await vi.advanceTimersByTimeAsync(116000);
    else {
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
    }
    results.push(await response);
    expect(results.at(-1)).toMatchObject({ code });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(delta).not.toHaveBeenCalled();
    if (enabled) {
      expect(collected).toHaveLength(1);
      expect(collected[0]).toMatchObject({
        httpMs: 1000, firstBodyChunkMs: 2000, firstSseFrameMs: 3000,
        firstToolEventMs: 3000, firstArgumentsMs: 3000, lastArgumentsMs: 3000,
        firstProviderFinishMs: 4000, boundaryMs: null, totalMs: code === 'timeout' ? 120000 : 4000,
        counts: { 'tolerated-provider-finish': 1 },
        outcome: { code, step: 'waiting-boundary' },
      });
    }
  }
  expect(results[0]).toEqual(results[1]);
});

it.each(['waiting-http', 'waiting-body', 'waiting-sse-frame'] as const)('不虚报未观测的超时里程碑：%s', async step => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const controller = new AbortController();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new Response(new ReadableStream({ start(c) { body = c; } }), { headers: { 'content-type': 'text/event-stream' } });
  let release!: (response: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  const traces: StoryToolTrace[] = [];
  const result = new AiClient(transport).generate(snapshot(), prompt, {
    storyToolOutput: true, stream: true, signal: controller.signal, timeoutSeconds: 120,
    onStoryToolTrace: value => { traces.push(value); },
  }).catch(safeAiError);
  await vi.advanceTimersByTimeAsync(1000);
  if (step !== 'waiting-http') release(stream);
  await vi.advanceTimersByTimeAsync(1000);
  if (step === 'waiting-sse-frame') body.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
  await vi.advanceTimersByTimeAsync(118000);
  expect(await result).toMatchObject({ code: 'timeout' });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(traces).toHaveLength(1);
  expect(traces[0]).toMatchObject({
    outcome: { step }, httpMs: step === 'waiting-http' ? null : 1000,
    firstBodyChunkMs: step === 'waiting-sse-frame' ? 2000 : null,
    firstSseFrameMs: null, firstToolEventMs: null, boundaryMs: null, totalMs: 120000,
  });
  if (step === 'waiting-http') {
    release(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(traces).toHaveLength(1);
    expect(traces[0].httpStatus).toBeNull();
    body.close();
  }
});

it('阶段开关只控制观察，导出明确区分工具接收成功和 Story 严格校验失败', async () => {
  const input = compatibilitySetup('openai', true, true);
  const state = worldState(), draft = createTurnDraft(state.saveId, 0, 'trace-rule', 'opening', '');
  // Complete tool JSON, with a Story that deliberately fails its guide JSON rule.
  const text = toolStoryText.replace('>[]</变量规划>', '>oops</变量规划>');
  input.settings.prompts.minNarrativeChars = 1;
  const results = [];
  for (const observeStoryTool of [true, false]) {
    const transport = vi.fn(async () => carrierResponse('openai', false, JSON.stringify({ content: text })));
    const result = await runStageRequest({ stage: 'story', mode: 'opening', state, draft, userInput: '', settings: input.settings },
      input.config, input.vault, { stream: false, observeStoryTool }, new AiClient(transport)).catch(safeAiError);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ code: 'invalid_json', details: { storyRule: 'guide_json' } });
    const exported = storyToolDiagnosticExport(stageResponses.getSnapshot()[0]);
    if (observeStoryTool) expect(exported).toMatchObject({
      outcome: { code: 'received' }, stage: { status: 'failed', errorCode: 'invalid_json', storyRule: 'guide_json' },
    });
    else expect(exported).toBeUndefined();
    results.push(result);
  }
  expect(results[0]).toEqual(results[1]);
});

it('有界事件保留头尾，计数保留全部，忽略供应商任意字符串', async () => {
  const tail = toolFrame({ choices: [{ delta: {}, finish_reason: 'PRIVATE_FIXTURE_REASON' }] });
  const { traces } = await capture(() => splitResponse(reasoning + begin + usage.repeat(200) + tail, 31));
  const trace = traces[0];
  expect(trace.counts['sse-frame']).toBe(203);
  expect(trace.events).toHaveLength(64);
  expect(trace.omittedEvents).toBe(Object.values(trace.counts).reduce((sum, count) => sum + count, 0) - 64);
  expect(trace.events[0]).toMatchObject({ frame: 1, reasoningPresent: true });
  expect(trace.events.at(-1)).toMatchObject({ frame: 203, kind: 'provider-finish', reason: 'unrecognized' });
  expect(JSON.stringify(trace)).not.toMatch(/PRIVATE_|中文|fictional-phase3-key|https:\/\//);
  expect(JSON.stringify(trace).length).toBeLessThan(16000);
});

it('同回合隔离两次请求，导出匿名分组，已清除请求的迟到摘要无法恢复', async () => {
  const input = compatibilitySetup('openai', true, true);
  const state = worldState(), draft = createTurnDraft(state.saveId, 0, 'private-draft-id', 'opening', '');
  const options = { stage: 'story' as const, mode: 'opening' as const, state, draft, userInput: '', settings: input.settings };
  const response = () => splitResponse(reasoning + begin + finish + additionalArgs + done, 3);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(runStageRequest(options, input.config, input.vault, { stream: true }, new AiClient(async () => response())))
      .rejects.toMatchObject({ code: 'tool_response' });
  }
  const first = storyToolDiagnosticExport(stageResponses.getSnapshot()[0])!;
  const second = storyToolDiagnosticExport(stageResponses.getSnapshot()[1])!;
  expect(first.attemptId).not.toBe(second.attemptId);
  expect(first.turnGroup).toBe(second.turnGroup);
  expect(first.turnGroup).toBeTruthy();
  expect(JSON.stringify(first)).not.toMatch(/save-a|private-draft-id|PRIVATE_|fictional-phase3-key|中文|http:\/\/|https:\/\//);
  let release!: (response: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  const request = runStageRequest(options, input.config, input.vault, { stream: true }, new AiClient(transport)).catch(safeAiError);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  stageResponses.clearSave(state.saveId);
  release(response());
  await request;
  expect(stageResponses.getSnapshot()).toHaveLength(0);
});

it.each([false, true])('开启或关闭观察时原子流程与写入等价，拒绝失败候选=%s', async fail => {
  async function generate(enabled: boolean) {
    stageResponses.clear();
    const input = compatibilitySetup('openai', true, true);
    const time = '2026-10-18T00:00:00.000Z';
    const state = { ...worldState(), createdAt: time, updatedAt: time };
    const repo = await SaveRepository.open('trace-workflow', new IDBFactory());
    await repo.create(state);
    await repo.saveDraft(createTurnDraft(state.saveId, 0, 'trace-turn', 'opening', ''), null);
    const bodies: string[] = [];
    const client = new AiClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(createHash('sha256').update(String(init?.body)).digest('hex'));
      if (body.model === input.channel.defaultModel) return fail ? splitResponse(relayFrames() + relayTail() + additionalArgs + done, 5)
        : splitResponse(relayFrames(JSON.stringify({ content: storyEnvelope() })) + relayTail() + done, 5);
      const content = body.model === 'variables' ? variableReply(worldDraft().variables!.result) : JSON.stringify(worldResult());
      return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    });
    if (!enabled) {
      const real = client.generate.bind(client);
      vi.spyOn(client, 'generate').mockImplementation((route, messages, options) => real(route, messages, { ...options, onStoryToolTrace: undefined }));
    }
    const coordinator = new TurnCoordinator(repo, client);
    const commit = vi.spyOn(repo, 'commitTurn');
    try {
      const result = await generateAndSettleTurn(coordinator, repo, { ...input, draft: (await repo.loadDraft(state.saveId))! },
        { check: () => undefined, onSettling: () => undefined }).catch(safeAiError);
      const saved = await repo.loadGame(state.saveId);
      expect(commit).toHaveBeenCalledTimes(fail ? 0 : 1);
      expect(bodies).toHaveLength(fail ? 1 : 3);
      const storyRecord = stageResponses.getSnapshot().find(record => record.stage === 'story');
      expect(Boolean(storyRecord?.toolTrace)).toBe(enabled);
      if (fail) {
        expect(result).toMatchObject({ code: 'tool_response', details: { fieldPath: 'storyTool.ordering' } });
        expect(saved.state).toEqual(state);
        expect(saved.draft?.story).toBeUndefined();
        expect(saved.draft?.storyPartial).toBeUndefined();
      } else expect(saved.state.turnNumber).toBe(1);
      return { bodies, state: { ...saved.state, updatedAt: '' }, draft: { ...saved.draft, turnId: '' } };
    } finally { coordinator.dispose(); repo.close(); }
  }
  const on = await generate(true);
  const off = await generate(false);
  expect(on).toEqual(off);
});
