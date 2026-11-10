import { GameStateSchema } from '../state';
import type { GameState } from '../state';
import { requireData } from '../common';
import { SpecialProfileSchema } from './schema';

/** Pure profile transitions. Player persistence uses the repository management CAS;
 * AI promotion uses its versioned command. These helpers never request a model. */
export function hibernateNpcProfile(state: GameState, npcId: string, identityKey: string): GameState {
  const next = GameStateSchema.parse(state), npc = next.npc[npcId];
  requireData(npc?.kind === 'special' && npc.identityKey === identityKey, 'NPC_IDENTITY', '人物专属身份已改变');
  const { detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds, privateProfile, relationshipNetwork, profilePending, ...ordinary } = npc;
  const profile = SpecialProfileSchema.parse({ profilePending, detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds,
    ...(privateProfile === undefined ? {} : { privateProfile }),
    ...(relationshipNetwork === undefined ? {} : { relationshipNetwork }) });
  next.dormantNpcProfiles = { ...next.dormantNpcProfiles, [npcId]: { id: npcId, identityKey, profile } };
  next.npc[npcId] = { ...ordinary, kind: 'ordinary', ...(ordinary.importancePreference ? {importancePreference:'ordinary' as const} : {}) };
  return GameStateSchema.parse(next);
}

export function restoreNpcProfile(state: GameState, npcId: string, identityKey: string): GameState {
  const next = GameStateSchema.parse(state), npc = next.npc[npcId], archive = next.dormantNpcProfiles?.[npcId];
  requireData(npc?.kind === 'ordinary' && npc.identityKey === identityKey && archive?.identityKey === identityKey,
    'NPC_IDENTITY', '没有属于当前人物身份的专属档案');
  requireData(!archive.profile.privateProfile || npc.gender === 'female' && (npc.age === undefined || npc.age >= 18),
    'NPC_KIND', '当前人物不符合私密档案恢复资格，原档案继续保留');
  next.npc[npcId] = { ...npc, ...archive.profile, kind: 'special', ...(npc.importancePreference ? {importancePreference:'special' as const} : {}) };
  delete next.dormantNpcProfiles![npcId];
  return GameStateSchema.parse(next);
}


/** Player management only; no narrative action, memory generation or clock change. */
export function setNpcImportance(state: GameState, npcId: string, identityKey: string, choice: 'ordinary' | 'special'): GameState {
  let next = GameStateSchema.parse(state);
  const npc = next.npc[npcId];
  requireData(npc?.identityKey === identityKey, 'NPC_IDENTITY', '人物身份已改变');
  if (choice === 'ordinary' && npc.kind === 'special') next = hibernateNpcProfile(next,npcId,identityKey);
  if (choice === 'special' && npc.kind === 'ordinary') {
    if (next.dormantNpcProfiles?.[npcId]) next = restoreNpcProfile(next,npcId,identityKey);
    else next.npc[npcId] = {...npc,kind:'special',detailedBackground:'',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[],profilePending:true};
  }
  next.npc[npcId].importancePreference = choice;
  return GameStateSchema.parse(next);
}

/** Preserve current player choices across undo without copying future profile facts. */
export function retainNpcChoices(before: GameState, current: GameState): GameState {
  let next = before;
  for (const npc of Object.values(current.npc)) if (npc.importancePreference && next.npc[npc.id]?.identityKey === npc.identityKey)
    next = setNpcImportance(next,npc.id,npc.identityKey,npc.importancePreference);
  return GameStateSchema.parse({...next,...(current.npcManagementRevision === undefined ? {} : {npcManagementRevision:current.npcManagementRevision})});
}
