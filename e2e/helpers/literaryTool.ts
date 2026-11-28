type Protocol = 'openai' | 'deepseek' | 'anthropic' | 'gemini';

export function toolReply(protocol: Protocol, stream: boolean, args: Record<string, string>, name: string, padding: readonly string[] = []) {
  const fn = { name, arguments: JSON.stringify(args) };
  let json: unknown, events: unknown[];
  if (protocol === 'anthropic') {
    const tool = { id: 'fixture-tool', type: 'tool_use', name: fn.name, input: args };
    json = { type: 'message', content: [tool], stop_reason: 'tool_use' };
    const index = padding.length ? 1 : 0;
    const prefix = padding.length ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ...padding.map(text => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
      { type: 'content_block_stop', index: 0 },
    ] : [];
    events = [{ type: 'message_start', message: { role: 'assistant', content: [] } }, ...prefix,
      { type: 'content_block_start', index, content_block: { ...tool, input: {} } },
      ...[fn.arguments.slice(0, 8), fn.arguments.slice(8)].map(partial_json => ({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } })),
      { type: 'content_block_stop', index }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }];
  } else if (protocol === 'gemini') {
    json = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: fn.name, args } }] }, finishReason: 'STOP' }] };
    events = [...padding.map(text => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })), json];
  } else {
    const tool = { id: 'fixture-tool', type: 'function', function: fn };
    json = { choices: [{ message: { role: 'assistant', tool_calls: [tool] }, finish_reason: 'tool_calls' }] };
    events = [...padding.map(text => ({ choices: [{ delta: { content: text } }] })),
      { choices: [{ delta: { tool_calls: [{ ...tool, index: 0, function: { name: fn.name, arguments: fn.arguments.slice(0, 8) } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fn.arguments.slice(8) } }] }, finish_reason: 'tool_calls' }] }];
  }
  return stream ? { contentType: 'text/event-stream', body: events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')
    + (protocol === 'openai' || protocol === 'deepseek' ? 'data: [DONE]\n\n' : '') } : { json };
}
