import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiError } from '../services/ai/errors';
import { contextMessage } from '../prompts/context';
import { AiClient } from '../services/ai/client';
import { newChannel, type Protocol } from '../services/ai/configuration';
import { channelSnapshot } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';
import { installTavernFetch, generationPath } from '../presets/tavern/fetch';
import { TavernEvents, tavernEvents, tavernTools, type FunctionTool } from '../presets/tavern/events';
import { transientStageError } from '../workflows/turnCoordinator';
import type { ResponseDiagnostics } from '../services/ai/responseContent';
import { tavernWire } from '../presets/tavern/wire';
import { newTrace, normalizeUpstream } from '../presets/tavern/upstream';

const store = { getItem: () => 'fixture-secret', setItem() {}, removeItem() {} };
const snapshot = (protocol: Protocol, model = 'fixture') => channelSnapshot(newChannel(protocol), new CredentialVault(store, store), model);
const messages = [{ role: 'system' as const, content: '系统甲' }, { role: 'user' as const, content: '行动' },
  { role: 'system' as const, content: '系统乙' }, { role: 'user' as const, content: '末尾' }];
const tool: FunctionTool = { type: 'function', function: { name: 'deliver', description: '测试载体',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } };
const body = { messages, n: 1, stream: false, chat_completion_source: 'custom', custom_prompt_post_processing: '', tools: [tool] };
const text = '中文 "转义"';
const args = JSON.stringify({ text });
const toolCall = { id: 'call1', type: 'function', function: { name: 'deliver', arguments: args } };
const frame = (d: unknown) => 'data: ' + JSON.stringify(d) + '\n\n';
function sse(data: string) {
  const bytes = new TextEncoder().encode(data);
  let offset = 0;
  return new Response(new ReadableStream({ pull(c) {
    if (offset === bytes.length) c.close();
    else c.enqueue(bytes.subarray(offset, ++offset));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function fixture(p: Protocol, stream: boolean, toolMode: boolean) {
  if (p === 'gemini') {
    const d = { candidates: [{ content: { parts: [toolMode ? { functionCall: { id: 'call1', name: 'deliver', args: { text } } } : { text }] }, finishReason: 'STOP' }], usageMetadata: { candidatesTokenCount: 9 } };
    return stream ? sse(frame(d)) : Response.json(d);
  }
  if (p === 'anthropic') {
    const content = toolMode ? { type: 'tool_use', id: 'call1', name: 'deliver', input: { text } } : { type: 'text', text };
    const reason = toolMode ? 'tool_use' : 'end_turn';
    if (!stream) return Response.json({ content: [content], stop_reason: reason, usage: { output_tokens: 9 } });
    return sse(frame({ type: 'content_block_start', index: 0, content_block: toolMode ? { ...content, input: {} } : content })
      + (toolMode ? [args.slice(0, 5), args.slice(5)].map(partial_json => frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })).join('') : '')
      + frame({ type: 'content_block_stop', index: 0 })
      + frame({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 9 } }) + frame({ type: 'message_stop' }));
  }
  const reason = toolMode ? 'tool_calls' : 'stop';
  const usage = { completion_tokens: 9 };
  if (!stream) return Response.json({ choices: [{ message: toolMode ? { tool_calls: [toolCall] } : { content: text }, finish_reason: reason }], usage });
  const deltas = toolMode ? [{ tool_calls: [{ ...toolCall, index: 0, function: { name: 'deliver', arguments: args.slice(0, 5) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }] : [{ content: text }];
  return sse(deltas.map(delta => frame({ choices: [{ delta }] })).join('') + frame({ choices: [{ delta: {}, finish_reason: reason }], usage }) + 'data: [DONE]\n\n');
}
let dispatch: typeof fetch;
beforeAll(() => { installTavernFetch(); dispatch = globalThis.fetch; });
afterEach(() => { vi.restoreAllMocks(); tavernTools.unregister('deliver'); });
function wrap(handle: (r: Response) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => handle(await dispatch(input, init)));
}
describe.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s 虚拟后端', p => {
  it.each([false, true])('stream=%s 正文、工具和错误都经真实序列化与归一化', async stream => {
    const snap = snapshot(p);
    const fetcher = vi.fn<typeof fetch>();
    const client = new AiClient(fetcher);
    const observations: ResponseDiagnostics[] = [];
    const run = () => client.generate(snap, messages, { tavernType: 'normal', stream, validateStoryOutputLimit: true,
      onResponseDiagnostics: d => observations.push(d) });
    fetcher.mockResolvedValueOnce(fixture(p, stream, false));
    expect(await run()).toMatchObject({ text, protocol: p, usage: { outputTokens: 9 } });
    tavernTools.register(tool.function);
    const intercepted = wrap(async response => {
      let received = '';
      if (stream) {
        const data = await response.text();
        expect(data).toContain('data: [DONE]');
        for (const line of data.split('\n').filter(l => l.startsWith('data: {')))
          for (const part of JSON.parse(line.slice(6)).choices[0].delta.tool_calls ?? []) received += part.function.arguments ?? '';
      } else {
        const msg = (await response.json()).choices[0].message;
        expect(msg.tool_calls[0]).toMatchObject({ id: 'call1', function: { name: 'deliver' } });
        received = msg.tool_calls[0].function.arguments;
      }
      return Response.json({ choices: [{ message: { content: JSON.parse(received).text }, finish_reason: 'stop' }], usage: { completion_tokens: 999 } });
    });
    fetcher.mockResolvedValueOnce(fixture(p, stream, true));
    expect(await run()).toMatchObject({ text, usage: { outputTokens: 9 } });
    expect(intercepted).toHaveBeenCalledTimes(1);
    expect(observations.at(-1)?.tavern).toMatchObject({ calls: 1, complete: true, upstreamUsage: { outputTokens: 9 }, normalized: stream ? 'sse' : 'json' });
    const sent = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(JSON.stringify(sent)).toContain('additionalProperties');
    expect(JSON.stringify(sent)).toContain('deliver');
    intercepted.mockRestore();
    fetcher.mockResolvedValueOnce(fixture(p, stream, true));
    await expect(run()).rejects.toMatchObject({ code: 'invalid_output', details: { fieldPath: 'tavern.unhandled_tool' } });
    fetcher.mockResolvedValueOnce(stream ? sse(frame({ error: {} })) : Response.json({ error: {} }));
    await expect(run()).rejects.toMatchObject({ code: 'rejected' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([undefined, 'none', 'auto', 'required', { type: 'function', function: { name: 'deliver' } }])('工具选择 %j', choice => {
    const result = JSON.parse(tavernWire(snapshot(p), { ...body, tool_choice: choice }).init.body);
    const named = typeof choice === 'object';
    if (p === 'gemini') expect(result.toolConfig?.functionCallingConfig).toEqual(choice === undefined ? undefined :
      { mode: named || choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO', ...(named ? { allowedFunctionNames: ['deliver'] } : {}) });
    else if (p === 'anthropic') expect(result.tool_choice).toEqual(choice === undefined ? undefined :
      { type: named ? 'tool' : choice === 'required' ? 'any' : choice, ...(named ? { name: 'deliver' } : {}) });
    else expect(result.tool_choice).toEqual(choice);
  });
});
const action = '联系仓库负责人，核对“手机”与 <货单>。\n 保留空格 ';
const currentTurn = { source: 'draft.userInput', turnId: 'turn-two', turnKind: 'regular', draftRevision: 1 };
const actionMessage = { role: 'user' as const, content: contextMessage({CURRENT_TURN: currentTurn, PLAYER_ACTION: action}) };
const background = { role: 'user' as const, content: contextMessage({ SAVE_STATE: { revision: 2 } }) };
const reference = [background, actionMessage];
const deliveryNames = ['wave_context_reference', 'actual_content'];
function nativeHook(names: string[], choice: 'auto' | 'none' = 'auto', leak = false) {
  return tavernEvents.on('chat_completion_settings_ready', data => {
    const records = data.messages.splice(0);
    data.tools = names.map(name => ({ type: 'function', function: { ...tool.function, name,
      description: name === deliveryNames[0] ? '测试资料\n' + JSON.stringify(records) : tool.function.description } }));
    if (leak) data.messages.push(actionMessage);
    data.tool_choice = choice;
    data.messages.push({role: 'user', content: '回应其中最新的真实用户输入。请使用 actual_content 提交本回合正文。'});
  });
}

it.each([
  { names: ['actual_content'], expected: reference, path: 'tools' },
  { names: ['wave_context_reference'], expected: reference, path: 'tools' },
  { names: deliveryNames, expected: reference, path: 'tools', disabled: true },
  { names: deliveryNames, expected: [actionMessage], path: 'action' },
  { names: deliveryNames, expected: [background, {...actionMessage, content: actionMessage.content.replace('turn-two', 'turn-one')}], path: 'action' },
  { names: deliveryNames, expected: [background, {...actionMessage, content: actionMessage.content.replace('联系', '通知')}], path: 'action' },
  { names: deliveryNames, expected: reference, path: 'action', leak: true },
])('独立交付缺声明、错绑、缺资料或普通消息泄漏行动块时在传输前拒绝 $path', async row => {
  const fetcher = vi.fn<typeof fetch>();
  const hook = nativeHook(row.names, row.disabled ? 'none' : 'auto', row.leak);
  try {
    await expect(new AiClient(fetcher).generate(snapshot('openai'), reference, {
      tavernType: 'normal', nativeDeliveryReference: row.expected,
    })).rejects.toMatchObject({details: {fieldPath: 'tavern.native_delivery.' + row.path}});
    expect(fetcher).not.toHaveBeenCalled();
  } finally { hook.stop(); }
});

it.each([false, true])('独立交付只接受可核对的上游正文；stream=%s', async stream => {
  const fetcher = vi.fn<typeof fetch>();
  const hook = nativeHook(deliveryNames);
  // The wrapper returns the same candidate in every case; only original upstream evidence changes.
  wrap(async response => {
    await response.text();
    return Response.json({choices: [{message: {content: text}, finish_reason: 'stop'}]});
  });
  try {
    const run = () => new AiClient(fetcher).generate(snapshot('openai'), reference, {
      tavernType: 'regenerate', stream, nativeDeliveryReference: reference,
    });
    for (const [name, carried, expected] of [
      [undefined, undefined, false], ['other', text, false], ['actual_content', '不同正文', false],
      ['actual_content', undefined, false], ['actual_content', text, true],
    ] as const) {
      const message = {content: name ? null : text, ...(name ? {tool_calls: [{...toolCall, index: 0,
        function: {name, arguments: JSON.stringify({content: carried})}}]} : {})};
      const choice = { [stream ? 'delta' : 'message']: message, finish_reason: name ? 'tool_calls' : 'stop' };
      fetcher.mockResolvedValueOnce(stream ? sse(frame({choices: [choice]}) + 'data: [DONE]\n\n') : Response.json({choices: [choice]}));
      if (expected) await expect(run()).resolves.toMatchObject({text});
      else if (name === 'other' || (name && carried === undefined)) await expect(run()).rejects.toMatchObject({code:'invalid_output'});
      else await expect(run()).rejects.toMatchObject({code: 'unsupported', details: {fieldPath: 'tavern.native_delivery.response'}});
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [, init] of fetcher.mock.calls) {
      const last = JSON.parse(String(init?.body)).messages.at(-1);
      expect(last.role).toBe('user');
      expect(last.content).toContain('PLAYER_ACTION');
      expect(last.content).not.toContain(actionMessage.content);
    }
  } finally { hook.stop(); }
});

it('独立交付只允许上游工具帧前实际出现的空白，不接受任何额外正文或参数内部差异', async () => {
  const padding = ' \n\t';
  const content = '<正文>第一行\n第二行</正文>';
  const receive = async (prefix: string) => {
    const trace = newTrace();
    const call = {...toolCall, index: 0, function: {name: 'actual_content', arguments: JSON.stringify({content})}};
    const response = await normalizeUpstream(sse(frame({choices: [{delta: {content: prefix}}]})
      + frame({choices: [{delta: {tool_calls: [call]}, finish_reason: 'tool_calls'}]}) + 'data: [DONE]\n\n'),
      'openai', true, new AbortController().signal, trace, 'actual_content');
    await response.text();
    expect(trace.complete).toBe(true);
    return trace.matchesDelivery!;
  };
  const matches = await receive(padding);
  expect(matches(padding + content)).toBe(true);
  expect(matches(content)).toBe(true);
  for (const altered of [padding + content.replace('\n', ' '), '旁白' + content, '\u200b\n\t' + content, content + padding])
    expect(matches(altered)).toBe(false);
  expect((await receive(''))(padding + content)).toBe(false);
});

it('真实上游中断不能被包装器替换为成功；失败不会触发协调器自动重试', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(sse(frame({ choices: [{ delta: { content: '半截' } }] })))
    .mockResolvedValueOnce(Response.json({ error: {} }, { status: 503 }));
  wrap(async r => { await r.text(); return Response.json({ choices: [{ message: { content: '替代' }, finish_reason: 'stop' }] }); });
  const run = () => new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal', stream: true });
  await expect(run()).rejects.toMatchObject({ code: 'stream_interrupted' });
  await run().then(() => { throw Error('expected rejection'); }, error => {
    expect(error).toMatchObject({ code: 'server', status: 503 }); expect(transientStageError(error)).toBe(false);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('每次生成的同源请求只消费一次；第二次调用同一 Request 被拒绝', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(fixture('openai', false, false));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(url).toBe(generationPath);
    const req = new Request('http://localhost' + url, init);
    const duplicate = req.clone();
    const result = await dispatch(req);
    await expect(dispatch(duplicate)).rejects.toMatchObject({ code: 'configuration' });
    return result;
  });
  await new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('注册条件按次等待，READY 的最终工具和采样值在出站生效', async () => {
  tavernTools.register({ ...tool.function, shouldRegister: async () => false });
  const listener = tavernEvents.on('chat_completion_settings_ready', async d => {
    expect(d.tools).toBeUndefined();
    await Promise.resolve(); d.tools = [tool]; d.tool_choice = 'none'; d.top_p = 0;
  });
  const fetcher = vi.fn<typeof fetch>(async () => fixture('openai', false, false));
  try {
    await new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal', presetSampling: { top_p: 0.5 } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ tools: [tool], tool_choice: 'none', top_p: 0 });
  } finally { listener.stop(); }
});
it('first、last、once、重入、删除、同步分派及异步 emit', async () => {
  const events = new TavernEvents(), seen: string[] = [];
  const a = () => { seen.push('a'); }, b = () => { seen.push('b'); };
  events.on('generation_stopped', a); events.on('generation_stopped', b, 'first');
  events.on('generation_stopped', b, 'last');
  events.on('generation_stopped', () => { seen.push('once'); events.emitAndWait('generation_stopped'); }, 'once');
  events.emitAndWait('generation_stopped');
  expect(seen).toEqual(['a', 'b', 'once', 'a', 'b']);
  events.remove('generation_stopped', b);
  events.on('generation_stopped', async () => { await Promise.resolve(); seen.push('async'); });
  events.emitAndWait('generation_stopped'); expect(seen.at(-1)).toBe('a');
  await Promise.resolve(); expect(seen.at(-1)).toBe('async');
  await events.emit('generation_stopped'); expect(seen.slice(-2)).toEqual(['a','async']);
});
it('监听异常交给登记方，保留等待分派和同步分派语义', async () => {
  const events = new TavernEvents();
  const failure = new Error('fixture-private-context');
  const report = vi.fn();
  const next = vi.fn();
  const handle = events.on('generation_stopped', async () => { throw failure; }, undefined, report);
  events.on('generation_stopped', next);
  await expect(events.emit('generation_stopped')).rejects.toMatchObject({
    code: 'configuration', details: { fieldPath: 'tavern.generation_stopped' },
  });
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  expect(next).not.toHaveBeenCalled();

  report.mockClear();
  events.emitAndWait('generation_stopped');
  expect(next).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);

  handle.stop();
  events.on('private-fixture-event', () => { throw failure; }, undefined, report);
  expect(() => events.emitAndWait('private-fixture-event')).toThrow('tavern.script_event');
  expect(report).toHaveBeenCalledTimes(2);
});

it('交错请求独立持有路由、诊断、取消信号，另一次生成仍可完成', async () => {
  let started!: () => void, aborted!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const seenAbort = new Promise<void>(resolve => { aborted = resolve; });
  const abort = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (JSON.parse(String(init?.body)).model === 'first') {
      started();
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
    }
    return fixture('openai', false, false);
  });
  const ai = new AiClient(fetcher);
  const first = ai.generate(snapshot('openai', 'first'), messages, { tavernType: 'normal', signal: abort.signal });
  await pending;
  const second = ai.generate(snapshot('openai', 'second'), messages, { tavernType: 'regenerate' });
  abort.abort();
  await expect(first).rejects.toMatchObject({ code: 'cancelled' });
  await seenAbort;
  expect(await second).toMatchObject({ model: 'second', text });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('两个工具按 index 分片，不能交换参数；提前返回合成 DONE 也不能接受', async () => {
  const delta = (tool_calls: unknown[]) => frame({ choices: [{ delta: { tool_calls } }] });
  const data = delta([0, 1].map(index => ({ index, type: 'function', id: 'id' + index, function: { name: 'tool' + index, arguments: '{"n":' } })))
    + delta([1, 0].map(index => ({ index, function: { arguments: index + '}' } })))
    + frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(sse(data)).mockImplementationOnce(async () =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(delta([{ index: 0, id: 'a', function: { name: 'tool', arguments: '{' } }]))); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const handler = wrap(async r => {
    const byIndex = ['', ''];
    for (const line of (await r.text()).split('\n').filter(l => l.startsWith('data: {'))) {
      for (const call of JSON.parse(line.slice(6)).choices[0].delta.tool_calls ?? []) byIndex[call.index] += call.function.arguments;
    }
    expect(byIndex).toEqual(['{"n":0}', '{"n":1}']);
    return fixture('openai', false, false);
  });
  const run = () => new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal', stream: true });
  expect((await run()).text).toBe(text);
  handler.mockRestore(); wrap(async () => fixture('openai', true, false));
  await expect(run()).rejects.toMatchObject({ code: 'stream_interrupted' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('READY 抛错为零传输，包装器读取后抛错只传输一次', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => fixture('openai', false, false));
  const run = () => new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal' });
  const listener = tavernEvents.on('chat_completion_settings_ready', () => { throw new Error('fixture'); }, 'once');
  await expect(run()).rejects.toMatchObject({ code: 'configuration' }); expect(fetcher).not.toHaveBeenCalled();
  listener.stop();
  wrap(async r => { await r.json(); throw new Error('wrapper'); });
  await expect(run()).rejects.toMatchObject({ details: { fieldPath: 'tavern.wrapper' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('首段已交给正文回调时上游仍未结束；真实 length 独立于包装结果', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(c) {
    stream = c;
    c.enqueue(encoder.encode(frame({ choices: [{ delta: { content: '半段正文' } }] })));
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  let first!: (s: string) => void;
  const seen = new Promise<string>(resolve => { first = resolve; });
  const result = new AiClient(fetcher).generate(snapshot('openai'), messages, { tavernType: 'normal', stream: true,
    validateStoryOutputLimit: true, onDelta: first });
  expect(await seen).toBe('半段正文');
  stream.enqueue(encoder.encode(frame({ choices: [{ delta: { content: '续' }, finish_reason: 'length' }] }) + 'data: [DONE]\n\n'));
  stream.close();
  expect(await result).toMatchObject({ outputLimited: true, text: '半段正文续' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('Gemini 同 ID 完整快照只交出一次，变更快照不拼接；并行与不支持的 Schema 模式明确拒绝', async () => {
  const snap = snapshot('gemini');
  const candidate = (n: number) => frame({ candidates: [{ content: { parts: [{ functionCall: { id: 'g1', name: 'deliver', args: { n } } }] } }] });
  const finish = frame({ candidates: [{ finishReason: 'STOP' }] });
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(sse(candidate(1) + candidate(1) + finish))
    .mockResolvedValueOnce(sse(candidate(1) + candidate(2) + finish));
  const ai = new AiClient(transport);
  wrap(async r => {
    const lines = await r.text();
    expect(lines.match(/"arguments"/g)).toHaveLength(1);
    return fixture('openai', false, false);
  });
  const run = () => ai.generate(snap, messages, { tavernType: 'normal', stream: true });
  expect((await run()).text).toBe(text);
  await expect(run()).rejects.toMatchObject({ code: 'invalid_output' });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(() => tavernWire(snap, { ...body, parallel_tool_calls: false })).toThrow();
  expect(() => tavernWire(snap, { ...body, tools: [{ type: 'function', function: { ...tool.function, strict: true } }] })).toThrow();
});
it.each(['partial-tool','filtered','reasoning-only'] as const)('包装器不能将 %s 替换成正文', async failure => {
  const response = failure === 'partial-tool'
    ? sse(frame({ choices: [{ delta: { tool_calls: [{ index: 0, ...toolCall, function: { name: 'deliver', arguments: '{' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    : Response.json({ choices: [{ message: { reasoning_content: '公开推理' }, finish_reason: failure === 'filtered' ? 'content_filter' : 'stop' }] });
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
  wrap(async r => { await r.text(); return fixture('openai', false, false); });
  await expect(new AiClient(transport).generate(snapshot('openai'), messages, { tavernType: 'normal', stream: true }))
    .rejects.toMatchObject({ code: failure === 'partial-tool' ? 'invalid_json' : failure === 'filtered' ? 'content_filter' : 'empty' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('完整 JSON 的 reasoning-only 仍可观察公开思考，不能作为正文', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: null, reasoning_content: '独立公开思考' }, finish_reason: 'stop' }] }));
  const observed = vi.fn();
  await expect(new AiClient(transport).generate(snapshot('openai'), messages, { tavernType: 'normal', onNativeReasoningDelta: observed }))
    .rejects.toMatchObject({ code: 'empty' });
  expect(observed).toHaveBeenCalledWith('独立公开思考');
  expect(transport).toHaveBeenCalledTimes(1);
});

describe('第二批 P2 响应边界', () => {
  it.each([false, true])('Anthropic 在上游保持打开时按 message_stop 收尾，工具=%s', async toolMode => {
    const events = await fixture('anthropic', true, toolMode).text();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(events)); },
      cancel,
    });
    const trace = newTrace();
    const abort = new AbortController();
    const response = await normalizeUpstream(new Response(source), 'anthropic', true, abort.signal, trace);
    const read = response.text();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('message_stop 后仍等待 EOF')), 1500);
      });
      const lines = (await Promise.race([read, watchdog])).trim().split('\n\n');
      expect(lines.pop()).toBe('data: [DONE]');
      const packets = lines.map(line => JSON.parse(line.slice(6)));
      const deltas = packets.map(p => p.choices[0].delta);
      if (toolMode) {
        const calls = deltas.flatMap(d => d.tool_calls ?? []);
        expect(calls[0]).toMatchObject({ id: 'call1', index: 0, function: { name: 'deliver' } });
        expect(calls.map(c => c.function.arguments).join('')).toBe(args);
      } else {
        expect(deltas.map(d => d.content).join('')).toBe(text);
      }
      expect(packets.flatMap(p => p.choices[0].finish_reason ?? [])).toEqual([toolMode ? 'tool_calls' : 'stop']);
      expect(packets.filter(p => p.usage).map(p => p.usage.completion_tokens)).toEqual([9]);
      expect(trace).toMatchObject({ complete: true, boundary: 'message_stop', finish: toolMode ? 'tool_use' : 'end_turn', usage: { outputTokens: 9 } });
      expect(trace.error).toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    } finally {
      clearTimeout(timer);
      abort.abort();
      await read.catch(() => undefined);
    }
  });

  it.each([
    ['missing-stop', 'stream_interrupted'],
    ['open-block', 'invalid_output'],
    ['bad-json', 'invalid_json'],
    ['prior-error', 'rejected'],
  ])('Anthropic %s 时包装器的成功不能取代上游结果', async (mode, code) => {
    const events = frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'deliver', input: {} } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: mode === 'bad-json' ? '{' : args } })
      + (mode === 'open-block' ? '' : frame({ type: 'content_block_stop', index: 0 }))
      + frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })
      + (mode === 'prior-error' ? frame({ type: 'error' }) : '')
      + frame(mode === 'missing-stop' ? { metadata: { type: 'message_stop' } } : { type: 'message_stop' });
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(sse(events));
    wrap(async r => { await r.text(); return fixture('openai', false, false); });
    await expect(new AiClient(transport).generate(snapshot('anthropic'), messages, { tavernType: 'normal', stream: true }))
      .rejects.toMatchObject({ code });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s 有正文和结束原因后仍须处理上游空错误', async protocol => {
    const complete = await fixture(protocol, true, false).text();
    const terminal = protocol === 'anthropic' ? frame({ type: 'message_stop' }) :
      protocol === 'gemini' ? '' : 'data: [DONE]\n\n';
    const beforeTerminal = terminal ? complete.slice(0, -terminal.length) : complete;
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(sse(beforeTerminal + 'event: error\n\n' + terminal));
    await expect(new AiClient(transport).generate(snapshot(protocol), messages, { tavernType: 'normal', stream: true }))
      .rejects.toMatchObject({ code: 'rejected', details: { fieldPath: 'tavern.upstream.error' } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('Anthropic 收到正文后、message_stop 前取消', async () => {
    const cancel = vi.fn();
    const fragment = frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
    const source = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(fragment)); }, cancel });
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(source));
    const abort = new AbortController();
    const seen = vi.fn(() => abort.abort());
    await expect(new AiClient(transport).generate(snapshot('anthropic'), messages, {
      tavernType: 'normal', stream: true, signal: abort.signal, onDelta: seen,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(seen).toHaveBeenCalledWith(text);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  function geminiCandidate(calls: unknown[], finished: boolean) {
    return { candidates: [{ content: { parts: calls.map(functionCall => ({ functionCall })) },
      ...(finished ? { finishReason: 'STOP' } : {}) }] };
  }

  it.each([false, true])('Gemini stream=%s 无参快照等价并保留无 ID 调用的索引，残留工具不执行', async stream => {
    const noop = { id: 'g', name: 'noop' };
    const other = [{ name: 'empty', args: {} }, { name: 'second', args: { n: 0 } }];
    const repeated = { ...noop, args: {} };
    const source = stream
      ? sse(frame(geminiCandidate([noop], false)) + frame(geminiCandidate([repeated, ...other], true)))
      : Response.json(geminiCandidate([noop, ...other], true));
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(source);
    const observed = vi.fn();
    wrap(async response => {
      const data = await response.text();
      const calls = stream
        ? data.split('\n').filter(line => line.startsWith('data: {'))
          .flatMap(line => JSON.parse(line.slice(6)).choices[0].delta.tool_calls ?? [])
        : JSON.parse(data).choices[0].message.tool_calls;
      observed(calls);
      return new Response(data, { headers: response.headers });
    });
    await expect(new AiClient(transport).generate(snapshot('gemini'), messages, { tavernType: 'normal', stream }))
      .rejects.toMatchObject({ code: 'invalid_output', details: { fieldPath: 'tavern.unhandled_tool' } });
    expect(observed).toHaveBeenCalledWith([
      { index: 0, id: 'g', type: 'function', function: { name: 'noop', arguments: '{}' } },
      { index: 1, id: 'gemini-call-1', type: 'function', function: { name: 'empty', arguments: '{}' } },
      { index: 2, id: 'gemini-call-2', type: 'function', function: { name: 'second', arguments: '{"n":0}' } },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('Gemini stream=%s 拒绝显式非法值、残缺参数、空名称和缺少结束', async stream => {
    const cases = [
      ...[null, [], '', 0].map(args => ({ call: { name: 'noop', args }, code: 'invalid_output', finished: true })),
      { call: { name: 'noop', partialArgs: [] }, code: 'unsupported', finished: true },
      { call: { name: 'noop', willContinue: true }, code: 'unsupported', finished: true },
      { call: { name: '', args: {} }, code: 'invalid_output', finished: true },
      { call: { name: 'noop', args: {} }, code: 'stream_interrupted', finished: false },
    ];
    for (const { call, code, finished } of cases) {
      const data = geminiCandidate([call], finished);
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(stream ? sse(frame(data)) : Response.json(data));
      await expect(new AiClient(transport).generate(snapshot('gemini'), messages, { tavernType: 'normal', stream }))
        .rejects.toMatchObject({ code });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
});

describe('按响应字节选择预设上游解析器', () => {
  const content = '中文 data: [DONE] "引号"\n下一行';
  const json = JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }, null, 2);
  const delta = { choices: [{ delta: { content }, finish_reason: 'stop' }] };
  const cases = [
    ...['application/json; charset=utf-8','Application/JSON','text/plain',undefined,'text/event-stream'].map(mime => ({
      mime, stream:true, source:'\uFEFF \r\n'+json, format:'json',
    })),
    { mime: 'application/json', stream: false, source: frame(delta).trimEnd(), format: 'sse' },
    ...['text/event-stream','text/plain','application/json',undefined].map(mime => ({
      mime, stream:false, source:'\uFEFF\r\n: ping\n\n'+frame(delta), format:'sse',
    })),
  ];
  it.each(cases)('$format, MIME=$mime, stream=$stream', async ({ mime, stream, source, format }) => {
    const response = sse(source);
    if (mime) response.headers.set('Content-Type', mime);
    else response.headers.delete('Content-Type');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const observed: ResponseDiagnostics[] = [];
    const result = await new AiClient(fetcher).generate(snapshot('openai'), messages, {
      tavernType: 'normal', stream, onResponseDiagnostics: d => observed.push(d),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(content);
    expect(observed.at(-1)?.tavern).toMatchObject({ normalized: format, complete: true, bytes: new TextEncoder().encode(source).length });
  });
});

describe('不完整的预设上游响应', () => {
  const choice = (finish: string | null) => ({
    choices: [{ message: { content: '<wave_delivery>合成内容</wave_delivery>' }, finish_reason: finish }],
  });
  it.each([
    ['<html>private</html>', 'invalid_output', 'format'],
    [' '.repeat(4096) + '{}', 'invalid_output', 'format'],
    ['{"choices":', 'invalid_json', 'json'],
    [JSON.stringify(choice(null)), 'stream_interrupted', 'missing_finish'],
    [JSON.stringify(choice('cancelled')), 'stream_interrupted', 'finish_reason'],
    [JSON.stringify(choice('private-upstream-text')), 'stream_interrupted', 'finish_reason'],
    [JSON.stringify(choice('content_filter')), 'content_filter', 'filter'],
    [frame(choice('stop')), 'unsupported', 'sse_message'],
    [frame({ error: { message: 'private-upstream-text' } }), 'rejected', 'error'],
  ])('拒绝并定位 %s', async (source, code, site) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(sse(source));
    const observed: ResponseDiagnostics[] = [];
    await expect(new AiClient(transport).generate(snapshot('openai'), messages, {
      tavernType: 'normal', stream: true, onResponseDiagnostics: value => observed.push(value),
    })).rejects.toMatchObject({ code, details: { fieldPath: 'tavern.upstream.' + site } });
    expect(transport).toHaveBeenCalledTimes(1);
    const trace = observed.at(-1)?.tavern;
    expect(trace?.complete).toBe(false);
    if (source.includes('"cancelled"')) expect(trace?.rawFinish).toBe('cancelled');
    expect(JSON.stringify(trace)).not.toMatch(/private|wave_delivery/);
  });
  it.each(['json', 'sse', 'read'] as const)('区分读取与 UTF-8 解码失败 %s', async mode => {
    let first = true;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(new TextEncoder().encode(mode === 'json' ? '{"text":"' : 'data: '));
        } else if (mode === 'read') controller.error(new Error('private'));
        else { controller.enqueue(Uint8Array.of(0xff)); controller.close(); }
      },
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new AiClient(transport).generate(snapshot('openai'), messages, { tavernType: 'normal' }))
      .rejects.toMatchObject({
        code: mode === 'json' ? 'invalid_json' : 'stream_interrupted',
        details: { fieldPath: mode === 'read' ? 'tavern.upstream.read' : 'tavern.upstream.utf8' },
      });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

it.each(['done', 'malformed'] as const)('包装流 %s：未决的取消清理不能吞掉已确定的结果', async mode => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(fixture('openai', true, false));
  let release!: () => void;
  const pendingCleanup = new Promise<void>(resolve => { release = resolve; });
  const cancel = vi.fn(() => pendingCleanup);
  const encoder = new TextEncoder();
  wrap(async normalized => {
    // Drain the actual upstream first. A script can return its own stream whose
    // cleanup depends on another branch (e.g. a Response clone).
    const result = await normalized.text();
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(mode === 'done' ? result : 'data: malformed\n\n')); }, cancel,
    }), { headers: { 'content-type': 'text/event-stream' } });
  });
  try {
    const result = new AiClient(transport).generate(snapshot('openai'), messages, {
      tavernType: 'normal', stream: true, timeoutSeconds: 0.5,
    });
    if (mode === 'done') await expect(result).resolves.toMatchObject({ text });
    else await expect(result).rejects.toMatchObject({ code: 'invalid_json' });
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally { release(); }
  expect(transport).toHaveBeenCalledTimes(1);
});

const pausedCases = [
  ['json', 'ok'], ['sse', 'ok'], ['heartbeat', 'timeout'], ['partial-frame', 'timeout'],
  ['late-first', 'ok'], ['pauses', 'ok'], ['reasoning', 'timeout'], ['wrapper-stall', 'timeout'],
  ['cancel', 'cancelled'], ['disconnect', 'stream_interrupted'],
  ['cancelled_no_content', 'stream_interrupted'], ['cancelled', 'stream_interrupted'],
  ['length', 'ok'], ['tool', 'ok'], ['wrapper-error', 'invalid_output'], ['await-headers', 'timeout'],
] as const;
describe('相同配置与输入的单次传输稳定性矩阵', () => {
  it.each(pausedCases)('%s → %s', async (scenario, expected) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const snap = snapshot('openai');
      const traces: NonNullable<ResponseDiagnostics['tavern']>[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const lifetime = new AbortController();
        const observations: ResponseDiagnostics[] = [];
        let signalSent!: () => void;
        const sent = new Promise<void>(ok => { signalSent = ok; });
        let incoming!: ReadableStreamDefaultController<Uint8Array>;
        const bytes = (s: string) => incoming.enqueue(new TextEncoder().encode(s));
        const delta = (part: object, reason: string | null = null) => frame({ choices: [{ delta: part, finish_reason: reason }] });
        const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
          signalSent();
          await new Promise<void>(ok => setTimeout(ok, scenario === 'await-headers' ? 1100 : 100));
          if (scenario === 'json') return fixture('openai', false, false);
          return new Response(new ReadableStream({ start(c) { incoming = c; } }), { headers: { 'content-type': 'text/event-stream' } });
        });
        const wrapper = scenario.startsWith('wrapper-') || scenario === 'tool' ? wrap(async normalized => {
          const source = await normalized.text();
          if (scenario === 'wrapper-error') throw Error('synthetic wrapper error');
          if (scenario === 'wrapper-stall') {
            await new Promise<void>(ok => lifetime.signal.addEventListener('abort', () => ok(), { once: true }));
          }
          if (scenario === 'tool') {
            const parts = source.split('\n').filter(line => line.startsWith('data: {'))
              .flatMap(line => JSON.parse(line.slice(6)).choices[0].delta.tool_calls ?? []);
            const restored = JSON.parse(parts.map(part => part.function.arguments ?? '').join('')).body;
            return Response.json({ choices: [{ message: { content: restored }, finish_reason: 'stop' }] });
          }
          return Response.json({});
        }) : undefined;
        const began = performance.now();
        const result = new AiClient(transport).generate(snap, messages, {
          tavernType: 'normal', stream: true, timeoutSeconds: 1, validateStoryOutputLimit: true,
          signal: lifetime.signal, onResponseDiagnostics: d => observations.push(d),
        }).then(value => ({ code: 'ok', text: value.text, limited: value.outputLimited }), (e: AiError) => ({ code: e.code, text: '', limited: false })).then(value => ({ ...value, elapsedMs: performance.now() - began }));
        await sent;
        await vi.advanceTimersByTimeAsync(100);
        if (scenario !== 'json' && scenario !== 'await-headers') {
          await vi.advanceTimersByTimeAsync(50);
          if (scenario === 'partial-frame') bytes('data: {"cho');
          else if (scenario === 'heartbeat' || scenario === 'late-first') bytes(': ping\n\n');
          else if (scenario === 'reasoning') bytes(delta({ reasoning_content: '推演' }));
          else if (scenario === 'tool') bytes(delta({ tool_calls: [{ index: 0, id: 'fixture', function: { name: 'chapter', arguments: '{"body":' } }] }));
          else bytes(delta({ content: text }));
          await vi.advanceTimersByTimeAsync(scenario === 'late-first' ? 680 : 100);
          if (scenario === 'cancel') lifetime.abort();
          else if (scenario === 'disconnect') incoming.error(new Error('private network message'));
          else if (scenario === 'heartbeat') bytes(': ping\n\n');
          else if (!['partial-frame','reasoning'].includes(scenario)) {
            if (scenario === 'pauses') {
              bytes(delta({ content: '乙' }));
              await vi.advanceTimersByTimeAsync(300);
            }
            if (scenario === 'late-first') bytes(delta({ content: text }));
            if (scenario === 'tool') bytes(delta({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(text) + '}' } }] }));
            const finish = ['cancelled', 'cancelled_no_content','length'].includes(scenario) ? scenario : scenario === 'tool' ? 'tool_calls' : 'stop';
            bytes(delta({}, finish) + 'data: [DONE]\n\n');
            incoming.close();
          }
        }
        await vi.advanceTimersByTimeAsync(1100);
        const outcome = await result;
        expect(outcome.code).toBe(expected);
        if (expected === 'ok') expect(outcome.text).toBe(text + (scenario === 'pauses' ? '乙' : ''));
        if (scenario === 'length') expect(outcome.limited).toBe(true);
        expect(transport).toHaveBeenCalledTimes(1);
        const trace = observations.at(-1)?.tavern;
        expect(trace).toBeDefined();
        traces.push(trace!);
        if (process.env.PRESET_MOCK_EVIDENCE) console.info('MOCK_ATTEMPT', JSON.stringify({
          scenario, attempt, outcome: outcome.code, elapsedMs: outcome.elapsedMs, calls: transport.mock.calls.length, timeline: trace?.timeline,
        }));
        lifetime.abort();
        wrapper?.mockRestore();
      }
      for (const trace of traces) {
        const t = trace.timeline;
        expect(t).toMatchObject({ budgetStartMs: 0, sentMs: 0, timeoutSeconds: 1 });
        if (scenario !== 'await-headers') expect(t?.headersMs).toBe(100);
        if (expected === 'timeout') {
          const phase = scenario === 'await-headers' ? 'awaiting_headers' : scenario === 'wrapper-stall' ? 'wrapper_restore' : 'upstream_read';
          expect(t).toMatchObject({ deadlineMs: 1000, deadlinePhase: phase, clientEndMs: 1000 });
        }
        if (scenario === 'cancel') expect(t).toMatchObject({ userCancelMs: 250, userCancelPhase: 'upstream_read' });
        if (scenario === 'heartbeat') expect(t).toMatchObject({ comments: 2, dataEvents: 0, lastByteMs: 250 });
        if (['heartbeat','partial-frame','reasoning'].includes(scenario)) expect(t?.firstContentMs).toBeUndefined();
        if (scenario === 'reasoning') expect(t).toMatchObject({ firstReasoningMs: 150, lastProgressMs: 150, dataEvents: 1 });
        if (scenario === 'tool') expect(t).toMatchObject({ firstArgumentsMs: 150, lastProgressMs: 250, restoredMs: 250 });
        if (scenario === 'late-first') expect(t).toMatchObject({ firstByteMs: 150, firstContentMs: 830, upstreamCompleteMs: 830 });
        if (scenario === 'pauses') expect(t).toMatchObject({ firstContentMs: 150, lastProgressMs: 250, upstreamCompleteMs: 550 });
        if (scenario === 'wrapper-stall' || scenario === 'wrapper-error') expect(t?.upstreamCompleteMs).toBe(250);
        if (scenario === 'cancelled_no_content') expect(trace?.rawFinish).toBe(scenario);
        if (scenario === 'disconnect') expect(trace.readError).toBe(true);
      }
    } finally { vi.useRealTimers(); }
  });
});

describe.each([false, true])('固定渠道、相同超时：预设=%s', preset => {
  it.each(['json', 'sse', 'stall', 'cancel'] as const)('%s 每次传输一次，使用调用者的取消信号和总预算', async mode => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const abort = new AbortController();
      let sent!: () => void;
      const started = new Promise<void>(ok => { sent = ok; });
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
        sent();
        if (mode === 'json' || mode === 'sse') return fixture('openai', mode === 'sse', false);
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(': keep\n\n')); } }),
          { headers: { 'content-type': 'text/event-stream' } });
      });
      // Native transport uses the identical snapshot, inputs and deadline.
      const run = new AiClient(transport).generate(snapshot('openai'), messages.slice(0, 2), {
        ...(preset ? { tavernType: 'normal' as const } : {}), timeoutSeconds: 1,
        signal: abort.signal, stream: mode !== 'json',
      }).then(reply => reply.text, (error: AiError) => error.code);
      await started;
      await vi.advanceTimersByTimeAsync(300);
      if (mode === 'cancel') abort.abort();
      await vi.advanceTimersByTimeAsync(700);
      expect(await run).toBe(mode === 'cancel' ? 'cancelled' : mode === 'stall' ? 'timeout' : text);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
