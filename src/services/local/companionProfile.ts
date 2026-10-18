import { z } from 'zod';
import type { GameState } from '../../domain/state';
import { IdSchema, requireData } from '../../domain/common';
import { readDocument, writeDocument } from './documents';

// 玩家亲自填写的创角档案，不代表 NPC 当前内部状态或当前关系。
const CompanionProfileSchema = z.strictObject({
  version: z.literal(1),
  saveId: IdSchema,
  npcId: IdSchema,
  identityKey: z.string(),
  name: z.string(),
  identity: z.string().optional(),
  relationshipText: z.string(),
  profile: z.strictObject({
    age: z.number().int().nonnegative().optional(),
    appearance: z.string().optional(),
    temperament: z.string().optional(),
    skills: z.array(z.string()),
    background: z.string().optional(),
  }),
});
export type CompanionProfile = z.infer<typeof CompanionProfileSchema>;
export const companionProfileKey = (saveId: string) => `heijin.companion-profile.v1:${saveId}`;
export function matchesCompanion(state: GameState, profile: CompanionProfile) {
  return (
    profile.saveId === state.saveId &&
    profile.npcId === state.initialCompanionId &&
    state.npc[profile.npcId]?.identityKey === profile.identityKey
  );
}
export function initialCompanionProfile(state: GameState): CompanionProfile | undefined {
  // 仅从尚未发生任何提交的 M2 创角快照回填旧存档，不能从后续内部状态重建。
  const person = state.initialCompanionId ? state.npc[state.initialCompanionId] : undefined;
  if (
    !person ||
    person.kind !== 'special' ||
    person.identityKey !== `${state.saveId}:initial-companion` ||
    state.revision !== 0 ||
    state.turnNumber !== 0 ||
    state.journal.length ||
    state.appliedCommands.length
  )
    return undefined;
  return CompanionProfileSchema.parse({
    version: 1,
    saveId: state.saveId,
    npcId: person.id,
    identityKey: person.identityKey,
    name: person.name,
    identity: person.identity,
    relationshipText: person.relationshipText,
    profile: {
      age: person.age,
      appearance: person.appearance,
      temperament: person.temperament,
      skills: person.skills,
      background: person.background,
    },
  });
}
export function loadCompanionProfile(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  state: GameState,
) {
  const key = companionProfileKey(state.saveId);
  const saved = readDocument(storage, key, CompanionProfileSchema);
  if (saved) {
    requireData(matchesCompanion(state, saved), 'COMPANION_PROFILE', '同伴创角档案与存档不匹配');
    return saved;
  }
  const initial = initialCompanionProfile(state);
  if (initial) writeDocument(storage, key, CompanionProfileSchema, initial);
  return initial;
}
