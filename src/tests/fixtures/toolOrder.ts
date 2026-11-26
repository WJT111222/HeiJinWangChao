export type OrderProtocol = 'openai' | 'deepseek' | 'gemini' | 'anthropic';
type Block = 'tool' | 'space' | 'newline' | 'prose' | 'thought' | 'plain';
export type OrderOutcome = 'tool' | 'text' | 'unproven' | 'competing';
export interface OrderSample {
  name: string;
  // Each group is a provider packet. Anthropic SSE encodes blocks as individual lifecycles.
  packets: Block[][];
  expected: OrderOutcome;
}

export const scene = ' \n<正文>林舟核对藏品。\n\n  目录上还有一行。</正文><短期记忆>核对目录。</短期记忆><变量规划>[]</变量规划>\n\t ';
export const publicThought = '正在核对。';
export const callId = 'fixture-ordered-call';
const textBlocks = { space: ' \t', newline: '\r\n', prose: '另一份正文。', thought: publicThought, plain: scene };

export function orderSamples(protocol: OrderProtocol, stream: boolean): OrderSample[] {
  const ordered = protocol === 'gemini' || protocol === 'anthropic';
  const samples: OrderSample[] = [
    { name: 'tool', packets: [['tool']], expected: 'tool' },
    { name: 'text–tool', packets: [['space', 'tool']], expected: ordered ? 'tool' : 'unproven' },
    { name: 'tool–text', packets: [['tool', 'space']], expected: 'unproven' },
    { name: 'text–tool–text', packets: [['space', 'tool', 'newline']], expected: 'unproven' },
    { name: 'prose–tool', packets: [['prose', 'tool']], expected: 'competing' },
    { name: 'tool–prose', packets: [['tool', 'prose']], expected: 'competing' },
    { name: 'thought–tool', packets: [['thought', 'tool']], expected: 'tool' },
    { name: 'thought–plain', packets: [['thought', 'plain']], expected: 'text' },
  ];
  if (stream) {
    samples.push(
      { name: 'two earlier events', packets: [['space'], ['newline'], ['tool']], expected: 'tool' },
      { name: 'later event', packets: [['tool'], ['space']], expected: 'unproven' },
      { name: 'events on both sides', packets: [['space'], ['tool'], ['newline']], expected: 'unproven' },
    );
    if (protocol === 'gemini') samples.push({
      name: 'same tool snapshot', packets: [['space', 'tool'], ['tool']], expected: 'tool',
    });
  }
  return samples;
}

export function companionText(sample: OrderSample): string {
  return sample.packets.flat().map(block => block === 'tool' || block === 'thought' ? '' : textBlocks[block]).join('');
}

function anthropicBlock(block: Block) {
  if (block === 'tool') return { type: 'tool_use', id: callId, name: 'submit_scene', input: { content: scene } };
  if (block === 'thought') return { type: 'thinking', thinking: publicThought };
  return { type: 'text', text: textBlocks[block] };
}

function anthropicEvents(block: Block, index: number): unknown[] {
  const content = anthropicBlock(block);
  const deltas = block === 'tool'
    ? [JSON.stringify(content.input).slice(0, 8), JSON.stringify(content.input).slice(8)]
      .map(partial_json => ({ type: 'input_json_delta', partial_json }))
    : block === 'thought' ? [{ type: 'thinking_delta', thinking: publicThought }] : [{ type: 'text_delta', text: textBlocks[block] }];
  return [
    { type: 'content_block_start', index, content_block: { ...content, ...(block === 'tool' ? { input: {} }
      : block === 'thought' ? { thinking: '' } : { text: '' }) } },
    ...deltas.map(delta => ({ type: 'content_block_delta', index, delta })),
    { type: 'content_block_stop', index },
  ];
}

function openAiMessage(blocks: Block[], stream: boolean) {
  const message: Record<string, unknown> = { role: 'assistant' };
  for (const block of blocks) {
    if (block === 'tool') message.tool_calls = [{ ...(stream && { index: 0 }), type: 'function', id: callId,
      function: { name: 'submit_scene', arguments: JSON.stringify({ content: scene }) } }];
    else if (block === 'thought') message.reasoning_content = publicThought;
    else message.content = String(message.content ?? '') + textBlocks[block];
  }
  return message;
}

export function orderResponse(protocol: OrderProtocol, stream: boolean, sample: OrderSample) {
  const blocks = sample.packets.flat(), tool = blocks.includes('tool');
  let frames: unknown[];
  if (protocol === 'anthropic') {
    const stop_reason = tool ? 'tool_use' : 'end_turn';
    frames = stream ? [
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      ...blocks.flatMap((b, i) => anthropicEvents(b, 3 + i)),
      { type: 'message_delta', delta: { stop_reason } }, { type: 'message_stop' },
    ] : [{ role: 'assistant', type: 'message', content: blocks.map(anthropicBlock), stop_reason }];
  } else if (protocol === 'gemini') {
    frames = sample.packets.map((packet, i) => ({ candidates: [{ content: { role: 'model',
      parts: packet.map(b => b === 'tool' ? { functionCall: { id: callId, name: 'submit_scene', args: { content: scene } } }
        : { ...(b === 'thought' && { thought: true }), text: textBlocks[b] }) },
      ...(i === sample.packets.length - 1 && { finishReason: 'STOP' }) }] }));
  } else {
    frames = sample.packets.map((packet, i) => ({ choices: [{ [stream ? 'delta' : 'message']: openAiMessage(packet, stream),
      ...(i === sample.packets.length - 1 && { finish_reason: tool ? 'tool_calls' : 'stop' }) }] }));
  }
  const done = protocol === 'openai' || protocol === 'deepseek' ? 'data: [DONE]\n\n' : '';
  return { mime: stream ? 'text/event-stream' : 'application/json',
    body: stream ? frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join('') + done : JSON.stringify(frames[0]) };
}
