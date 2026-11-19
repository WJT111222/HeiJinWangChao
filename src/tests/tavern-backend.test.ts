import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('Anthropic 收到正文后、message_stop 前取消', async () => {
    const cancel = vi.fn();
    const fragment = frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
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
      : Response.json(geminiCandidate([noop, repeated, ...other], true));
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
