import { expect } from 'vitest';
import { array, record } from '../../services/ai/protocols';
import type { AiMessage } from '../../services/ai/protocols';
import type { GameState } from '../../domain/state';
import { rawNpcMemories } from '../../domain/memories/npcMemory';

export function sentContext(messages: readonly AiMessage[]) {
  const data = messages.filter((m) => m.role === 'user' && m.content.startsWith('<GAME_CONTEXT>'));
  expect(data).toHaveLength(1);
  return record(JSON.parse(data[0].content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)));
}
export function expectFullState(context: Record<string, unknown>, state: GameState) {
  const { journal, appliedCommands, ...expected } = state;
  void journal; void appliedCommands;
  expect(context.SAVE_STATE).toEqual(expected);
  expect(array(context.NPC_KNOWLEDGE)).toEqual(Object.values(state.npc).map(npc => ({
    ownerNpcId: npc.id, raw: rawNpcMemories(npc), summaries: state.memories.npcSummaries[npc.id] ?? [], knownInformation: npc.knownInformation,
  })));
}

