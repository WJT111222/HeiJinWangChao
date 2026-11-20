import { contextMessage } from '../prompts/contextMessage';
import type { AiMessage } from '../services/ai/protocols';
import { AiError } from '../services/ai/errors';

// The two delimiters belong to the bundled peinture adapter, never to player input.
const begin = '[[WAVE_CONTEXT_BEGIN_07_8d2c91]]';
const end = '[[WAVE_CONTEXT_END_07_8d2c91]]';

export const nativeOutputTool = 'actual_content';

export function deliveryContext(context: Record<string, unknown>): AiMessage[] {
  const { NPC_CONTEXT, MEMORY_CONTEXT, PLAYER_ACTION, ...current } = context;
  const { policy, ...npcIndex } = NPC_CONTEXT as Record<string, unknown>;
  const { recalledTurns, recallDiagnostics, ...memory } = MEMORY_CONTEXT as Record<string, unknown>;
  return [
    { role: 'user', content: contextMessage({ ...current, NPC_CONTEXT: { policy }, MEMORY_CONTEXT: memory }) },
    { role: 'user', content: begin },
    { role: 'user', content: contextMessage({ NPC_CONTEXT: npcIndex, MEMORY_CONTEXT: { recalledTurns, recallDiagnostics } }) },
    { role: 'user', content: end },
    { role: 'user', content: contextMessage({ PLAYER_ACTION }) },
  ];
}

/** Called after the page script has appended its delivery instructions, before protocol conversion. */
export function finalizeNativeDelivery(messages: AiMessage[], tools: ReadonlySet<string>, action: string): AiMessage[] {
  if (!tools.has('wave_context_reference') || !tools.has(nativeOutputTool))
    throw new AiError('unsupported', undefined, { fieldPath: 'tavern.native_delivery.tools' });
  const content = contextMessage({ PLAYER_ACTION: action });
  const others = messages.filter(message => !(message.role === 'user' && message.content === content));
  if (others.length !== messages.length - 1)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.native_delivery.action' });
  const closing = others.pop();
  if (!closing || closing !== messages.at(-1) || closing.role !== 'user' || !closing.content.includes(nativeOutputTool))
    throw new AiError('unsupported', undefined, { fieldPath: 'tavern.native_delivery.tools' });
  // The pinned script refers to an action inside its reference tool. Native Story keeps that action here.
  const delivery = closing.content.replace('回应其中最新的真实用户输入', '回应本消息 PLAYER_ACTION 中的玩家行动');
  const binding = '本回合玩家行动以以下 PLAYER_ACTION 为准。资料工具只补充背景，时间预检只判断时间安排。按既定正文协议回应。';
  return [...others, { role: 'user', content: [binding, content, delivery].join('\n\n') }];
}

export function checkDeliveryBoundaries(messages: readonly AiMessage[]) {
  const text = messages.map(message => message.content).join('\n');
  if (text.split(begin).length !== 2 || text.split(end).length !== 2)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.context_boundary' });
}
