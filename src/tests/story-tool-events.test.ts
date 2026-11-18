import { describe, expect, it } from 'vitest';
import type { Protocol } from '../services/ai/configuration';
import { readAiResponseEvents } from '../services/ai/responseEvents';
import type { AiResponseEvent } from '../services/ai/responseEvents';
import { StoryToolAssembler } from '../services/ai/storyToolAssembler';
import { parseStoryToolArguments, STORY_OUTPUT_TOOL } from '../services/ai/storyToolContract';
import { splitResponse } from './fixtures/responseEvents';

import { toolStoryText as content, toolStoryArgs as args, toolFrame as frame, carrierResponse } from './fixtures/storyTools';

async function assemble(protocol: Protocol, response: Response, stream: boolean) {
  const assembler = new StoryToolAssembler(protocol), events: AiResponseEvent[] = [];
  for await (const event of readAiResponseEvents(async () => response, protocol, stream, new AbortController().signal, true)) {
    events.push(event);
    if (event.type === 'error') throw event.error;
    if (event.type === 'aborted') throw new Error('aborted');
    if (event.type === 'response') assembler.response(event);
    if (event.type === 'end') assembler.boundary(event);
    if (event.type.startsWith('tool-')) assembler.event(event as Parameters<StoryToolAssembler['event']>[0]);
  }
  return { text: assembler.complete(), events };
}
describe('原生工具事件与单一 Story 载体', () => {
  for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) for (const stream of [false, true]) {
    it(`${protocol} / stream=${stream}：原生开始、参数与结束；UTF-8任意分块`, async () => {
      const result = await assemble(protocol, carrierResponse(protocol, stream), stream);
      expect(result.text).toBe(content);
      expect(result.events.filter(e => e.type === 'tool-start')).toHaveLength(1);
      expect(result.events.filter(e => e.type === 'tool-end')).toHaveLength(1);
      expect(result.events.filter(e => e.type === 'tool-arguments').map(e => e.text).join('')).toBe(args);
      const response = result.events.filter(e => e.type === 'response').filter(e => e.finishReason !== undefined);
      expect(response.at(-1)?.finishReason).toBe(protocol === 'anthropic' ? 'tool_use' : protocol === 'gemini' ? 'STOP' : 'tool_calls');
    });
  }
  it.each(['{}', '{"content":null}', '{"content":"x","extra":1}', '{"content":"first","content":"last"}', '{"content":"x"', '{"content":7}', '[]', '{"content":""}'])('严格拒绝参数：%s', raw => {
    expect(() => parseStoryToolArguments(raw)).toThrow();
  });
  it('合法字符串内的引号、冒号和转义不被当成额外键', () => {
    const text = '他说："content": "不是键"。\\路径\n中文';
    expect(parseStoryToolArguments(JSON.stringify({ content: text }))).toBe(text);
    expect(parseStoryToolArguments('{"\\u0063ontent":"中文"}')).toBe('中文');
  });
  it.each(['missing-id', 'wrong-name', 'multiple', 'mixed', 'length', 'filter', 'unknown', 'no-finish', 'bad-arguments'])('兼容协议负例：%s', async mode => {
    const call = { id: mode === 'missing-id' ? undefined : 'call-1', type: 'function', function: { name: mode === 'wrong-name' ? 'external_tool' : STORY_OUTPUT_TOOL, arguments: mode === 'bad-arguments' ? '{"content":' : args } };
    const data = { choices: [{ message: { content: mode === 'mixed' ? '额外文本' : null, tool_calls: mode === 'multiple' ? [call, { ...call, id: 'call-2' }] : [call] }, finish_reason: mode === 'length' ? 'length' : mode === 'filter' ? 'content_filter' : mode === 'unknown' ? 'unknown' : mode === 'no-finish' ? undefined : 'tool_calls' }] };
    await expect(assemble('openai', new Response(JSON.stringify(data)), false)).rejects.toBeDefined();
  });
  it('无真实工具结束的 EOF 或 DONE 不补全参数', async () => {
    const start = frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: STORY_OUTPUT_TOOL, arguments: args } }] } }] });
    for (const suffix of ['', 'data: [DONE]\n\n']) await expect(assemble('deepseek', splitResponse(start + suffix, 1), true)).rejects.toMatchObject({ code: 'tool_response' });
  });
  it('名称、ID和转义Unicode按实际delta拼接，不反复解转义', async () => {
    const chunks = [{ id: 'call-', function: { name: 'heijin_' } }, { id: '1', function: { name: 'story_output', arguments: '{"content":"\\u4' } }, { function: { arguments: 'e2d\\u6587"}' } }];
    const body = chunks.map(call => frame({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] })).join('') + frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    expect((await assemble('openai', splitResponse(body, 1), true)).text).toBe('中文');
  });
  it('Anthropic 非空快照后不能再追加参数delta', async () => {
    const body = frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'c', name: STORY_OUTPUT_TOOL, input: { content: '一' } } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '二' } });
    await expect(assemble('anthropic', splitResponse(body, 5), true)).rejects.toMatchObject({ code: 'tool_response' });
  });
  it('Anthropic block stop、stop reason 与 message_stop 均必须真实存在', async () => {
    const body = frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'c', name: STORY_OUTPUT_TOOL, input: { content: '完整' } } })
      + frame({ type: 'content_block_stop', index: 0 }) + frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
    await expect(assemble('anthropic', splitResponse(body, 1), true)).rejects.toMatchObject({ code: 'tool_response' });
  });
  it.each([{ name: STORY_OUTPUT_TOOL, partialArgs: [{ stringValue: 'x' }] }, { name: STORY_OUTPUT_TOOL }, { name: 'external_tool', args: { content: 'x' } }])('Gemini不猜测非标准参数或其他工具：%j', async functionCall => {
    const data = { candidates: [{ content: { parts: [{ functionCall }] }, finishReason: 'STOP' }] };
    await expect(assemble('gemini', new Response(JSON.stringify(data)), false)).rejects.toMatchObject({ code: 'tool_response' });
  });
});

it('大段文本与大量转义保持线性扫描；展示不改变参数或正文', () => {
  const text = '中文\\路径\n"content":仍然是文字。'.repeat(20000);
  expect(parseStoryToolArguments(JSON.stringify({content:text}))).toBe(text);
});
it('参数容量超限明确拒绝，不截短后继续校验', () => {
  expect(() => parseStoryToolArguments('x'.repeat(8_000_001))).toThrow();
});
it.each(['early-message-stop','early-stop-reason'])('Anthropic结束顺序损坏不能被之后的合法参数掩盖：%s', async mode => {
  const stop=frame({type:'message_stop'}), reason=frame({type:'message_delta',delta:{stop_reason:'tool_use'}});
  const call=frame({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'c',name:STORY_OUTPUT_TOOL,input:{content:'合法内容'}}})+frame({type:'content_block_stop',index:0});
  const body=mode==='early-message-stop'?stop+call+reason:reason+call+stop;
  await expect(assemble('anthropic',splitResponse(body,1),true)).rejects.toMatchObject({code:'tool_response'});
});
