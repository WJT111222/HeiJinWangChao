import { z } from 'zod';
import { TextSchema } from '../common';
import type { GameState } from '../state';

// 迁移保护与正式联系人含义分离；不能只因为见过面就永久登记，也不能默认删除不确定人物。
export const ContactReviewSchema = z.strictObject({
  conclusion: z.literal('non_contact'), basis: z.enum(['no_known_connection', 'player_confirmed']), reason: TextSchema,
  playerConfirmation: TextSchema.max(4000).optional(),
});
export type ContactReview = z.infer<typeof ContactReviewSchema>;
export function hasKnownPlayerConnection(state: GameState, npcId: string) {
  const npc = state.npc[npcId];
  if (!npc) return true;
  const related = (ref: { kind: string; id: string }) => ref.kind === 'npc' && ref.id === npcId;
  const publicMemories = [...state.memories.short, ...state.memories.medium, ...state.memories.long,
    ...Object.values(state.npc).flatMap((person) => [...person.memories, ...(person.kind === 'special' ? person.longTermMemories : [])])];
  // 旧正文/公开记忆的关联索引并非完整接触证明。无需猜测文字含义，存在历史就保留不确定性。
  const incompleteLegacyHistory = state.contactReviewNpcIds.includes(npcId)
    && (state.journal.length > 0 || publicMemories.some((entry) => entry.visibility === 'player_known'));
  return Boolean(incompleteLegacyHistory || npc.relationshipText !== '尚未与主角接触'
    || [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])].some((entry) => entry.visibility === 'player_known')
    || npc.onScene || npc.lastInteractionAt || npc.affinityConfirmed || state.initialCompanionId === npcId
    || state.journal.some((entry) => entry.relatedActorRefs.some(related))
    || Object.values(state.events).some((event) => event.visibility !== 'hidden' && event.actorRefs.some(related))
    || state.timeline.some((entry) => entry.actorRefs.some(related))
    || publicMemories.some((entry) => entry.visibility === 'player_known' && entry.affectedEntityRefs.some(related)));
}
