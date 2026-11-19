import { z } from 'zod';
import { CountSchema, IdSchema, requireData } from '../common';
import type { TurnDraft } from '../drafts';
import type { GameState } from '../state';

export const LegacyNotificationSelectionSchema = z.strictObject({
  eventId: IdSchema, entryId: IdSchema, notificationOnly: z.literal(true), finishReading: z.literal(true),
});
export type LegacyNotificationSelection = z.infer<typeof LegacyNotificationSelectionSchema>;
export const LegacyNotificationRecoverySchema = LegacyNotificationSelectionSchema.extend({
  saveId: IdSchema, baseSaveRevision: CountSchema, turnId: IdSchema,
  storyRevision: CountSchema, authorizedDraftRevision: CountSchema,
});
export type LegacyNotificationRecovery = z.infer<typeof LegacyNotificationRecoverySchema>;

export function legacyPresentedEntry(state: GameState, target: Pick<LegacyNotificationSelection, 'eventId' | 'entryId'>) {
  const event = Object.hasOwn(state.events, target.eventId) ? state.events[target.eventId] : undefined;
  return event?.eventKind === 'sub' && event.entryIntent === undefined && event.status !== 'resolved' && event.status !== 'cancelled'
    && event.protagonistEntry?.status === 'presented' && event.protagonistEntry.id === target.entryId ? event : undefined;
}
export function recoveryMatchesDraft(recovery: LegacyNotificationRecovery, draft: TurnDraft) {
  return recovery.saveId === draft.saveId && recovery.baseSaveRevision === draft.baseSaveRevision
    && recovery.turnId === draft.turnId && recovery.storyRevision === draft.storyRevision
    && recovery.authorizedDraftRevision <= draft.draftRevision;
}
export function existingLegacyRecovery(state: GameState, draft: TurnDraft) {
  const recovery = draft.legacyNotificationRecovery;
  if (!recovery) return undefined;
  requireData(recoveryMatchesDraft(recovery, draft) && state.saveId === recovery.saveId
    && state.revision === recovery.baseSaveRevision && legacyPresentedEntry(state, recovery),
  'DRAFT_CONFLICT', '旧通知恢复授权与当前存档或入场不符');
  return recovery;
}
