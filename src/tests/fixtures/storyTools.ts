import type { Protocol } from '../../services/ai/configuration';
import { STORY_OUTPUT_TOOL } from '../../services/ai/storyToolContract';
import { splitResponse } from './responseEvents';

export const toolStoryText = '<正文>中文🙂，3<5。</正文><短期记忆>事实</短期记忆><变量规划>[]</变量规划>';
export const toolStoryArgs = JSON.stringify({ content: toolStoryText });
export const toolFrame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
export function carrierResponse(protocol: Protocol, stream: boolean, value = toolStoryArgs) {
  if (protocol === 'openai' || protocol === 'deepseek') {
    if (!stream) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call-1', type: 'function', function: { name: STORY_OUTPUT_TOOL, arguments: value } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } });
    return splitResponse(toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: STORY_OUTPUT_TOOL } }] } }] })
      + [...value].map(text => toolFrame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: text } }] } }] })).join('')
      + toolFrame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n', 1);
  }
  if (protocol === 'anthropic') {
    if (!stream) return new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'call-1', name: STORY_OUTPUT_TOOL, input: JSON.parse(value) }], stop_reason: 'tool_use' }), { headers: { 'content-type': 'application/json' } });
    return splitResponse(toolFrame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: STORY_OUTPUT_TOOL, input: {} } })
      + [...value].map(partial_json => toolFrame({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })).join('')
      + toolFrame({ type: 'content_block_stop', index: 0 }) + toolFrame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) + toolFrame({ type: 'message_stop' }), 1);
  }
  const data = { candidates: [{ content: { parts: [{ functionCall: { name: STORY_OUTPUT_TOOL, args: JSON.parse(value) } }] }, finishReason: 'STOP' }] };
  return stream ? splitResponse(toolFrame(data), 1) : new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}
