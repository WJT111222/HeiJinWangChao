import type { TurnDraft } from '../domain/drafts';
import { contextMessage } from '../prompts/contextMessage';
import type { AiMessage } from '../services/ai/protocols';
import { AiError } from '../services/ai/errors';

// The two delimiters belong to the bundled peinture adapter, never to player input.
const begin = '[[WAVE_CONTEXT_BEGIN_07_8d2c91]]';
const end = '[[WAVE_CONTEXT_END_07_8d2c91]]';

export const nativeOutputTool = 'actual_content';

export const referenceTool = 'wave_context_reference';
const scriptActionHint = '回应其中最新的真实用户输入';
const nativeActionHint = '以资料数组末项 GAME_CONTEXT 中的 PLAYER_ACTION 为本回合行动，CURRENT_TURN 标明来源。历史记录和时间预检只作参考；行动为空时遵循原有开局或回合规则';

export function deliveryContext(context: Record<string, unknown>, draft?: TurnDraft): AiMessage[] {
  const { SAVE_STATE, NPC_CONTEXT, CREATION_PROFILE, MEMORY_CONTEXT, OPENING_TIME, PLAYER_ACTION, ...instructions } = context;
  if (draft && draft.userInput !== PLAYER_ACTION)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.native_delivery.action' });
  const { summaryPolicy, ...memories } = MEMORY_CONTEXT as Record<string, unknown>;
  // A pending opening's playerPreference also contains the verbatim input. Keep its clock rules in messages.
  const { playerPreference, ...openingRules } = (OPENING_TIME ?? {}) as Record<string, unknown>;
  const currentTurn = draft
    ? { source: 'draft.userInput', turnId: draft.turnId, draftRevision: draft.draftRevision, turnKind: draft.turnKind }
    : { source: 'preview' };
  return [
    { role: 'user', content: contextMessage({ ...instructions, MEMORY_CONTEXT: { summaryPolicy },
      OPENING_TIME: OPENING_TIME ? openingRules : undefined }) },
    { role: 'user', content: begin },
    { role: 'user', content: contextMessage({ SAVE_STATE, NPC_CONTEXT, CREATION_PROFILE, MEMORY_CONTEXT: memories,
      OPENING_TIME: OPENING_TIME ? { playerPreference } : undefined }) },
    { role: 'user', content: contextMessage({ CURRENT_TURN: currentTurn, PLAYER_ACTION }) },
    { role: 'user', content: end },
  ];
}

/** Keep the composed records before any page-script hooks run. Only this request can use them. */
export function nativeReferenceRecords(messages: readonly AiMessage[]) {
  const start = messages.findIndex(m => m.content === begin);
  const stop = messages.findIndex(m => m.content === end);
  if (start < 0 || stop <= start + 1)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.context_boundary' });
  return messages.slice(start + 1, stop);
}

export function finalizeNativeDelivery(messages: AiMessage[], tools: readonly { function: { name: string; description?: string } }[],
  expected: readonly AiMessage[]): AiMessage[] {
  const reference = tools.find(tool => tool.function.name === referenceTool);
  const closing = messages.at(-1);
  if (!reference || !tools.some(tool => tool.function.name === nativeOutputTool) || closing?.role !== 'user' ||
    !closing.content.includes(scriptActionHint) || !closing.content.includes(nativeOutputTool))
    throw new AiError('unsupported', undefined, { fieldPath: 'tavern.native_delivery.tools' });

  // transformRequest serializes the moved array on the last line, after its own description header.
  if (!expected.length || !reference.function.description?.endsWith('\n' + JSON.stringify(expected)) ||
    messages.some(m => m.role === 'user' && expected.some(record => m.content.includes(record.content))))
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.native_delivery.action' });

  return [...messages.slice(0, -1), { ...closing, content: closing.content.replace(scriptActionHint, nativeActionHint) }];
}

export function checkDeliveryBoundaries(messages: readonly AiMessage[]) {
  const text = messages.map(message => message.content).join('\n');
  if (text.split(begin).length !== 2 || text.split(end).length !== 2)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.context_boundary' });
}
