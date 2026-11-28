import { describe, expect, it } from 'vitest';
import { newTrace, normalizeUpstream } from '../presets/tavern/upstream';

const tool = { type: 'tool_use', id: 'a', name: 'deliver', input: {} };
const text = { type: 'text', text: '港口' };
const thinking = { type: 'thinking', thinking: '' };
const input = { type: 'input_json_delta', partial_json: '{"content":"交班"}' };
const words = { type: 'text_delta', text: '交班' };
const thought = { type: 'thinking_delta', thinking: '核对' };
const signature = { type: 'signature_delta', signature: 'signature-fixture' };

const start = (index: unknown, content_block: object) => ({ type: 'content_block_start', index, content_block });
const delta = (index: unknown, delta: object) => ({ type: 'content_block_delta', index, delta });
const stop = (index: unknown) => ({ type: 'content_block_stop', index });
async function read(blocks: object[], reason = 'tool_use', deliveryTool?: string) {
  const trace = newTrace();
  const events = [...blocks, { type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' }];
  const source = new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } });
  const response = await normalizeUpstream(source, 'anthropic', true, new AbortController().signal, trace, deliveryTool);
  const wire = await response.text();
  if (trace.error) {
    expect(trace.complete).toBe(false);
    throw trace.error;
  }
  expect(trace.complete).toBe(true);
  return { wire, trace };
}

for (const field of ['start', 'delta', 'stop'] as const) describe('Anthropic ' + field, () => {
  it.each([null, undefined, '0', '', false, true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝非原生合法索引 %j', async bad => {
      const blocks = [start(field === 'start' ? bad : 0, tool), delta(field === 'delta' ? bad : 0, input),
        stop(field === 'stop' ? bad : 0)];
      await expect(read(blocks)).rejects.toMatchObject({ code: 'invalid_output' });
    },
  );
});
it.each([0, 7, Number.MAX_SAFE_INTEGER])('合法块索引 %s 的分片只还原一次正文', async index => {
  const { trace } = await read([start(index, tool),
    delta(index, { ...input, partial_json: '{"content":' }), delta(index, { ...input, partial_json: '"交班"}' }),
    stop(index)], 'tool_use', tool.name);
  expect(trace.matchesDelivery?.('交班')).toBe(true);
});
it.each([
  ['未开始的增量', [delta(2, words)]],
  ['未开始的关闭', [stop(2)]],
  ['重复开始', [start(2, text), start(2, text), stop(2)]],
  ['关闭后重用同一索引', [start(2, text), stop(2), start(2, thinking), stop(2)]],
  ['重复关闭', [start(2, text), stop(2), stop(2)]],
  ['关闭后追加', [start(2, text), stop(2), delta(2, words)]],
  ['未闭合文本块', [start(2, text)]],
  ['未闭合思考块', [start(2, thinking)]],
  ['文本块收到工具参数', [start(2, text), delta(2, input), stop(2)]],
  ['工具块收到文本增量', [start(2, tool), delta(2, words), delta(2, input), stop(2)]],
  ['思考块收到文本增量', [start(2, thinking), delta(2, words), stop(2)]],
  ['文本块收到思考签名', [start(2, text), delta(2, signature), stop(2)]],
] as const)('%s 不能随其他合法块完成', async (_label, bad) => {
  await expect(read([start(0, tool), delta(0, input), stop(0), ...bad])).rejects.toMatchObject({ code: 'invalid_output' });
});
it('文本、引用、思考、签名与 redacted_thinking 各自在原块关闭', async () => {
  const { wire } = await read([start(0, thinking), delta(0, thought), delta(0, signature), stop(0),
    start(1, { type: 'redacted_thinking', data: 'redacted-fixture' }), stop(1),
    start(2, text), delta(2, words), delta(2, { type: 'citations_delta', citation: {} }), stop(2)], 'end_turn');
  expect(wire).toContain('"reasoning_content":"核对"');
  expect(wire).toContain('"content":"交班"');
  expect(wire).not.toContain('signature-fixture');
  expect(wire).not.toContain('redacted-fixture');
});
it('通用多工具按原块索引分别拼接，第二个无参调用仍保留', async () => {
  const { wire } = await read([start(7, tool), start(9, { ...tool, id: 'b', name: 'noop' }), stop(9), delta(7, input), stop(7)]);
  const calls = wire.split('\n').filter(line => line.startsWith('data: {'))
    .flatMap(line => JSON.parse(line.slice(6)).choices[0].delta.tool_calls ?? []);
  expect(calls.filter(call => call.id).map(call => call.id)).toEqual(['a', 'b']);
  expect(calls.filter(call => call.index === 0).map(call => call.function.arguments).join('')).toBe(input.partial_json);
  expect(calls.filter(call => call.index === 1).map(call => call.function.arguments).join('')).toBe('{}');
});

it.each([true, false])('交错块按实际 text_delta 的到达位置证明空白（工具前=%s）', async before => {
  const padding = delta(9, { type: 'text_delta', text: ' \t' });
  const { trace } = await read([
    start(9, { type: 'text', text: '' }), ...(before ? [padding] : []),
    start(2, tool), delta(2, input), ...(before ? [] : [padding]), stop(2), stop(9),
  ], 'tool_use', 'deliver');
  expect(trace.matchesDelivery?.('交班', ' \t')).toBe(before);
  expect(trace.matchesDelivery?.('交班', '\t ')).toBe(false);
});
