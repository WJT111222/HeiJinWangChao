import { expect } from 'vitest';
import { array, record } from '../../services/ai/protocols';
import type { AiMessage } from '../../services/ai/protocols';
import type { GameState } from '../../domain/state';

export function sentContext(messages: readonly AiMessage[]) {
  const data = messages.filter((m) => m.role === 'user' && m.content.startsWith('<GAME_CONTEXT>'));
  expect(data).toHaveLength(1);
  return record(JSON.parse(data[0].content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)));
}
export function expectWorldWithNpcProjection(context: Record<string, unknown>, state: GameState, baseRevision = state.revision) {
  const { journal, appliedCommands, dormantNpcProfiles, npc, memories, ...expected } = state;
  void journal; void appliedCommands; void dormantNpcProfiles;
  const {npc: projected,memories: projectedMemories,...other}=record(context.SAVE_STATE);
  expect(other).toEqual({...expected,revision:baseRevision});
  const {npcSummaries,...layers}=memories,{npcSummaries:shownSummaries,...shownLayers}=record(projectedMemories);
  expect(shownLayers).toEqual(layers);expect(shownSummaries).toEqual(npcSummaries);
  expect(Object.keys(record(projected))).toEqual(Object.keys(npc));
  for(const person of Object.values(npc)){
    const shown=record(record(projected)[person.id]);
    for(const field of ['id','identityKey','kind','onScene','name','aliases','age','gender','identity','locationId','affinity','affinityConfirmed','relationshipText','healthText','lastInteractionAt','phoneContact','usualLocations','importancePreference','knownInformation'] as const)
      expect(shown[field]).toEqual(person[field]);
    for(const entry of array(shown.memories))expect(person.memories).toContainEqual(entry);
    if(person.kind==='special')for(const field of ['detailedBackground','activeGoals','habits','relationshipNetwork','offscreenTaskIds','profilePending','privateProfile'] as const)expect(shown[field]).toEqual(person[field]);
  }
  expect(context).not.toHaveProperty('NPC_KNOWLEDGE');
  expect(context).not.toHaveProperty('SCENE_NPCS');
}
