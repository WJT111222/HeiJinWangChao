import { contextMessage } from '../prompts/context';
import type { AiMessage } from '../services/ai/protocols';
import { AiError } from '../services/ai/errors';

// The two delimiters belong to the bundled peinture adapter, never to player input.
const begin = '[[WAVE_CONTEXT_BEGIN_07_8d2c91]]';
const end = '[[WAVE_CONTEXT_END_07_8d2c91]]';

export function deliveryContext(context: Record<string, unknown>): AiMessage[] {
  const { SAVE_STATE, NPC_CONTEXT, CREATION_PROFILE, MEMORY_CONTEXT, PLAYER_ACTION, ...instructions } = context;
  const { summaryPolicy, ...memories } = MEMORY_CONTEXT as Record<string, unknown>;
  return [
    { role: 'user', content: contextMessage({ ...instructions, MEMORY_CONTEXT: { summaryPolicy } }) },
    { role: 'user', content: begin },
    { role: 'user', content: contextMessage({ SAVE_STATE, NPC_CONTEXT, CREATION_PROFILE, MEMORY_CONTEXT: memories }) },
    { role: 'user', content: contextMessage({ PLAYER_ACTION }) },
    { role: 'user', content: end },
  ];
}

export function checkDeliveryBoundaries(messages: readonly AiMessage[]) {
  const text = messages.map(message => message.content).join('\n');
  if (text.split(begin).length !== 2 || text.split(end).length !== 2)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.context_boundary' });
}
