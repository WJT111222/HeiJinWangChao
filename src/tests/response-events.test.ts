import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { readAiResponseEvents } from '../services/ai/responseEvents';
import type { AiResponseEvent } from '../services/ai/responseEvents';
import { captureResponse, mockResponse, responseMatrix, responseCaseKey, responseProtocols, responseModes, responseSnapshot, splitResponse } from './fixtures/responseEvents';
import baseline from './fixtures/ai-response-events-baseline.json';

const message = [{ role: 'user' as const, content: '合成行动' }];
async function collect(receive: () => Promise<Response>, protocol = 'openai' as typeof responseProtocols[number], stream = true, signal = new AbortController().signal) {
  const events: AiResponseEvent[] = [];
  for await (const event of readAiResponseEvents(receive, protocol, stream, signal)) events.push(event);
  return events;
}

describe('与固定 main 的完整请求、回调顺序、响应/失败等价（静态基线，不动态生成期望）', () => {
  it.each(responseMatrix)('$protocol / $mode / $scenario / allowLimit=$allowLimit', async c => {
    const expected = (baseline.captures as Record<string, unknown>)[responseCaseKey(c)];
    expect(expected).toBeDefined();
    expect(await captureResponse(c.protocol, c.mode, c.scenario, c.allowLimit)).toEqual(expected);
  });
});

for (const protocol of responseProtocols) {
  it.each(responseModes)(`${protocol}: %s 保留真实来源、原文顺序、reasoning、finish和usage`, async mode => {
    const events = await collect(async () => mockResponse(protocol, mode, 'normal'), protocol, mode !== 'json');
    const frames = events.filter(e => e.type === 'response');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.map(e => e.rawText).join('')).toContain('你好，中文🙂。');
    expect(frames.map(e => e.nativeReasoning).join('')).toBe('公开原生思考');
    const transports = new Set(frames.map(e => e.source.transport));
    expect([...transports]).toEqual([mode === 'sse' ? 'sse' : 'json']);
    expect(frames.every(e => e.source.protocol === protocol && e.source.requestedStream === (mode !== 'json'))).toBe(true);
    expect(frames.filter(e => e.usage).at(-1)?.usage).toMatchObject({ inputTokens: protocol === 'anthropic' ? 15 : 10, outputTokens: 5, cacheReadTokens: 3 });
    expect(frames.find(e => e.finishReason)?.finishReason).toBe(protocol === 'gemini' ? 'STOP' : protocol === 'anthropic' ? 'end_turn' : 'stop');
    if (mode !== 'sse') {
      expect(frames).toHaveLength(1); expect(frames[0].delivery).toBe('complete');
      expect(frames[0].observation.order).toBe('unknown');
    }
  });
  it.each([1, 2, 5, 7, 13, 97, 65536])(`${protocol}: SSE按%d字节切分与原基线完全一致`, async size => {
    expect(await captureResponse(protocol, 'sse', 'normal', false, size))
      .toEqual((baseline.captures as Record<string, unknown>)[`${protocol}/sse/normal/strict`]);
  });
}

it('同一帧公开字段保持同事件身份，不伪造字段生成先后', async () => {
  const data = { choices: [{ delta: { reasoning_content: '公开思考', content: '中文' }, finish_reason: 'STOP' }] };
  const events = await collect(async () => splitResponse(`event: message\r\ndata: ${JSON.stringify(data)}\r\n\r\n`, 1));
  const frame = events.find(e => e.type === 'response')!;
  expect(frame.observation).toEqual({ text: '公开思考中文', order: 'same-event' });
  expect(frame.source).toMatchObject({ sequence: 1, eventName: 'message', protocol: 'openai', transport: 'sse', httpStatus: 200 });
  expect(frame.finishReason).toBe('STOP'); expect(frame.finishField).toBe('choices.0.finish_reason');
});
it('保留多个真实结束原因；EOF不追加任何stop或DONE', async () => {
  const body = ['length', 'UNRECOGNIZED_REAL_REASON'].map(reason => `data: ${JSON.stringify({ choices: [{ delta: { content: '正文' }, finish_reason: reason }] })}\n\n`).join('');
  const events = await collect(async () => splitResponse(body, 2));
  expect(events.filter(e => e.type === 'response').map(e => e.finishReason)).toEqual(['length', 'UNRECOGNIZED_REAL_REASON']);
  expect(events.at(-1)).toMatchObject({ type: 'end', boundary: 'eof' });
  expect(events.some(e => e.type === 'end' && e.boundary === 'done-marker')).toBe(false);
});
it('未知类型的结束值保持原值，不转字符串或改写为正常完成', async () => {
  const reason = { unexpected: ['MOCK_PRIVATE_VALUE', 4] };
  const events = await collect(async () => new Response(JSON.stringify({ choices: [{ message: { content: '正文' }, finish_reason: reason }] })), 'openai', false);
  expect(events.find(e => e.type === 'response')?.finishReason).toEqual(reason);
  expect(events.at(-1)).toMatchObject({ type: 'end', boundary: 'json-body' });
});
it('多行data与末尾未补空行的真实SSE帧仍可读取', async () => {
  const body = 'event: custom\r\ndata: {"choices":[\r\ndata: {"delta":{"content":"中文🙂"},"finish_reason":"stop"}]}';
  const events = await collect(async () => splitResponse(body, 1));
  expect(events.find(e => e.type === 'response')).toMatchObject({ content: '中文🙂', finishReason: 'stop', source: { eventName: 'custom' } });
  expect(events.at(-1)).toMatchObject({ type: 'end', boundary: 'eof' });
});
it('只有实际收到兼容协议DONE才产生done-marker；后续冗余帧不读取', async () => {
  const events = await collect(async () => splitResponse('data: [DONE]\n\ndata: {bad}\n\n', 1));
  expect(events.map(e => e.type)).toEqual(['opened', 'end']);
  expect(events.at(-1)).toMatchObject({ type: 'end', boundary: 'done-marker' });
});
it('Anthropic message_stop是原始帧信号，传输结束仍单独记录', async () => {
  const events = await collect(async () => splitResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n', 1), 'anthropic');
  expect(events.find(e => e.type === 'response')).toMatchObject({ messageStop: true, finishReason: undefined, source: { eventName: 'message_stop' } });
  expect(events.at(-1)).toMatchObject({ type: 'end', boundary: 'eof' });
});
it('明示过滤、拒绝和错误保留安全结构，不把供应商错误消息当作正文', async () => {
  const events = await collect(async () => splitResponse('event: error\ndata: {"error":{"message":"MOCK_PRIVATE_ERROR"},"choices":[]}\n\n', 4));
  expect(events.find(e => e.type === 'response')).toMatchObject({ providerError: true, content: '', rawText: '', diagnostics: { errorPresent: true } });
  expect(JSON.stringify(events)).not.toContain('MOCK_PRIVATE_ERROR');
});
it.each([false, true])('非法JSON保留错误，不产生完成信号（stream=%s）', async stream => {
  const events = await collect(async () => stream ? splitResponse('data: {\n\n', 1) : new Response('{'), 'openai', stream);
  expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_json' } });
  expect(events.some(e => e.type === 'end')).toBe(false);
});
it('非法UTF-8不能被替换字符悄悄修复', async () => {
  const events = await collect(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xc3, 0x28])); c.close(); } })));
  expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'stream_interrupted' } });
});
it('HTTP和网络失败仅接收一次，保留阶段来源和原有安全错误', async () => {
  const error = new AiError('server', 503), receive = vi.fn(async () => { throw error; });
  const events = await collect(receive);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(events).toEqual([{ type: 'error', source: { protocol: 'openai', requestedStream: true, transport: 'http', sequence: 0, httpStatus: 503 }, error }]);
});
it('预先取消不发送请求', async () => {
  const controller = new AbortController(); controller.abort();
  const receive = vi.fn(async () => new Response('{}'));
  expect(await collect(receive, 'openai', true, controller.signal)).toMatchObject([{ type: 'aborted' }]);
  expect(receive).not.toHaveBeenCalled();
});
it('部分SSE后取消保留已收片段，释放reader且不伪造EOF完成', async () => {
  const controller = new AbortController(), cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已收片段"}}]}\n\n')); }, cancel }));
  const iterator = readAiResponseEvents(async () => response, 'openai', true, controller.signal);
  expect((await iterator.next()).value).toMatchObject({ type: 'opened' });
  expect((await iterator.next()).value).toMatchObject({ type: 'response', content: '已收片段' });
  const pending = iterator.next(); controller.abort();
  expect((await pending).value).toMatchObject({ type: 'aborted' });
  expect((await iterator.next()).done).toBe(true); expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.body!.locked).toBe(false);
});
it('消费方校验失败退出迭代时仍释放底层响应reader', async () => {
  const cancel = vi.fn(), response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"片段"}}]}\n\n')); }, cancel }));
  const iterator = readAiResponseEvents(async () => response, 'openai', true, new AbortController().signal);
  await iterator.next(); await iterator.next(); await iterator.return(undefined);
  expect(cancel).toHaveBeenCalledTimes(1); expect(response.body!.locked).toBe(false);
});
it('取消后迟到的完整JSON不能产生正文回调或复活已取消请求', async () => {
  const controller = new AbortController(); let release!: (value: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  const raw = vi.fn(), delta = vi.fn();
  const result = new AiClient(transport).generate(responseSnapshot('openai'), message, { signal: controller.signal, onRawTextDelta: raw, onDelta: delta }).catch(error => error);
  controller.abort(); expect(await result).toMatchObject({ code: 'cancelled' });
  release(mockResponse('openai', 'json', 'normal')); await new Promise(resolve => setTimeout(resolve, 0));
  expect(raw).not.toHaveBeenCalled(); expect(delta).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledTimes(1);
});
it('超时仍由原operation区分，不能误报普通取消或自动重发', async () => {
  vi.useFakeTimers();
  try {
    const transport = vi.fn(() => new Promise<Response>(() => undefined));
    const result = new AiClient(transport).generate(responseSnapshot('openai'), message, { timeoutSeconds: 1 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({ code: 'timeout' }); expect(transport).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it('未实现的工具响应不执行、不选稿，仍走原有不支持的结束规则', async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null,
    tool_calls: [{ id: 'call-a', type: 'function', function: { name: 'actual_content', arguments: '{"content":"不能越权接受"}' } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'Content-Type': 'application/json' } }));
  await expect(new AiClient(transport).generate(responseSnapshot('openai'), message)).rejects.toMatchObject({ code: 'stream_interrupted' });
  expect(transport).toHaveBeenCalledTimes(1);
});
