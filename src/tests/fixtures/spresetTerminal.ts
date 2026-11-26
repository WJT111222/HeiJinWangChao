import type { Protocol } from '../../services/ai/configuration';

const content = '<正文>在馆内核对展柜。</正文><短期记忆>核对展柜。</短期记忆><变量规划>[]</变量规划>';
type Fault = 'duplicate' | 'foreign-end' | 'null-block-stop';

export function terminalFaults(protocol: Protocol, streaming: boolean): Fault[] {
  const faults: Fault[] = ['duplicate', 'foreign-end'];
  if (protocol === 'anthropic' && streaming) faults.push('null-block-stop');
  return faults;
}

export function malformedSceneResponse(protocol: Protocol, stream: boolean, invalid: Fault) {
  const duplicate = invalid === 'duplicate';
  const args = { content }, name = 'submit_scene', id = 'synthetic-call';
  let events: unknown[];
  if (protocol === 'gemini') {
    const part = { functionCall: { id, name, args } };
    events = [{ candidates: [{ content: { role: 'model', parts: duplicate ? [part, part] : [part] },
      finishReason: duplicate ? 'STOP' : 'tool_use' }] }];
  } else if (protocol === 'anthropic') {
    const tool = { type: 'tool_use', id, name, input: args };
    const reason = invalid === 'foreign-end' ? 'tool_calls' : 'tool_use';
    events = stream ? [{ type: 'message_start', message: { role: 'assistant', content: [] } },
      ...(duplicate ? [tool, tool] : [tool]).flatMap((content_block, index) => [
        { type: 'content_block_start', index, content_block }, { type: 'content_block_stop', index: invalid === 'null-block-stop' ? null : index }]),
      { type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' }]
      : [{ type: 'message', content: duplicate ? [tool, tool] : [tool], stop_reason: reason }];
  } else {
    const tool = { type: 'function', id, function: { name, arguments: JSON.stringify(args) } };
    const calls = (duplicate ? [tool, tool] : [tool]).map((call, index) => stream ? { ...call, index } : call);
    events = [{ choices: [{ [stream ? 'delta' : 'message']: { role: 'assistant', tool_calls: calls },
      finish_reason: duplicate ? 'tool_calls' : 'tool_use' }] }];
  }
  return stream ? new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') +
    (['openai', 'deepseek'].includes(protocol) ? 'data: [DONE]\n\n' : '')) : Response.json(events[0]);
}
