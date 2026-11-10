import { GameStateSchema } from '../state';
import type { GameState } from '../state';
import { requireData } from '../common';
import { SpecialProfileSchema } from './schema';

/** Internal, pure transitions only. Not a player control or an AI command.
 * Callers cannot use this to persist without the repository's normal transaction boundary. */
export function hibernateNpcProfile(state: GameState, npcId: string, identityKey: string): GameState {
  const next = GameStateSchema.parse(state), npc = next.npc[npcId];
  requireData(npc?.kind === 'special' && npc.identityKey === identityKey, 'NPC_IDENTITY', '人物专属身份已改变');
  requireData(next.initialCompanionId !== npcId, 'NPC_PROTECTED', '本批不改变初始同伴的特殊身份保护');
  const { detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds, privateProfile, relationshipNetwork, ...ordinary } = npc;
  const profile = SpecialProfileSchema.parse({ detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds,
    ...(privateProfile === undefined ? {} : { privateProfile }),
    ...(relationshipNetwork === undefined ? {} : { relationshipNetwork }) });
  next.dormantNpcProfiles = { ...next.dormantNpcProfiles, [npcId]: { id: npcId, identityKey, profile } };
  next.npc[npcId] = { ...ordinary, kind: 'ordinary' };
  return GameStateSchema.parse(next);
}

export function restoreNpcProfile(state: GameState, npcId: string, identityKey: string): GameState {
  const next = GameStateSchema.parse(state), npc = next.npc[npcId], archive = next.dormantNpcProfiles?.[npcId];
  requireData(npc?.kind === 'ordinary' && npc.identityKey === identityKey && archive?.identityKey === identityKey,
    'NPC_IDENTITY', '没有属于当前人物身份的专属档案');
  next.npc[npcId] = { ...npc, ...archive.profile, kind: 'special' };
  delete next.dormantNpcProfiles![npcId];
  return GameStateSchema.parse(next);
}
