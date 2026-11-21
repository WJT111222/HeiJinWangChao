import { fingerprint } from './commands';
import { requireData } from './common';
import type { TurnDraft } from './drafts';
import { ProtagonistEventEntrySchema } from './events/schema';
import { validateStoryEventInteractions } from './events/interactions';
import { legacyPresentedEntry, LegacyNotificationSelectionSchema } from './events/legacyNotification';
import type { LegacyNotificationRecovery, LegacyNotificationSelection } from './events/legacyNotification';
import type { GameState } from './state';
import { historicalPerspective } from './timePreflight';
import { projectTurn } from './turnProjection';

type Story = NonNullable<TurnDraft['story']>;

export function legacyNotificationRecoveryOptions(state: GameState, draft?: TurnDraft) {
  // Older drafts only store a generic failure code. Eligibility means a plausible
  // recovery target is present, not that every invalid World result has this cause.
  if (!draft?.story || draft.legacyNotificationRecovery || draft.turnKind !== 'regular'
    || draft.saveId !== state.saveId || draft.baseSaveRevision !== state.revision
    || state.journal.some(entry => entry.turnId === draft.turnId)
    || draft.stageStatus.story !== 'ready' || draft.stageStatus.variables !== 'ready'
    || !draft.useVariableStage || !draft.useWorldStage || draft.variables?.validation !== 'validated'
    || draft.stageStatus.world !== 'failed'
    || !draft.failures.some(failure => failure.stage === 'world' && failure.storyRevision === draft.storyRevision
      && ['invalid_output', 'event_entry'].includes(failure.errorCode))) return [];
  try {
    if (historicalPerspective(state,draft)) return [];
    const projected = projectTurn(state,draft);
    return Object.values(state.events).flatMap(event => {
      const entry = event.protagonistEntry;
      if (!entry) return [];
      const target = { eventId:event.id, entryId:entry.id };
      const stillOpen = legacyPresentedEntry(projected,target);
      return legacyPresentedEntry(state,target) && stillOpen?.fixedEndAt
        && Date.parse(stillOpen.fixedEndAt) <= Date.parse(projected.worldClock)
        ? [{ ...target,title:event.title,cue:entry.cue }] : [];
    });
  } catch { return []; }
}

export function authorizeLegacyNotificationRecovery(state: GameState, draft: TurnDraft, input: LegacyNotificationSelection): LegacyNotificationRecovery {
  const selection = LegacyNotificationSelectionSchema.parse(input);
  requireData(legacyNotificationRecoveryOptions(state,draft).some(candidate =>
    candidate.eventId === selection.eventId && candidate.entryId === selection.entryId),
  'DRAFT_CONFLICT', '此旧通知已不符合恢复条件，请重新读取当前草稿');
  return { ...selection, saveId:draft.saveId, baseSaveRevision:draft.baseSaveRevision, turnId:draft.turnId,
    storyRevision:draft.storyRevision+1, authorizedDraftRevision:draft.draftRevision+1 };
}

export function validateRecoveredStory(state: GameState, original: Story, story: Story, recovery: LegacyNotificationRecovery) {
  validateStoryEventInteractions(state,story,recovery);
  const otherEvents = (value: Story) => value.variableGuide.flatMap(guide =>
    guide.eventNarration || (guide.eventInteraction && guide.eventInteraction.eventId !== recovery.eventId) ? [guide] : []);
  const receipt = story.variableGuide.find(guide => guide.eventInteraction?.eventId === recovery.eventId
    && guide.eventInteraction.entryId === recovery.entryId && guide.eventInteraction.action === 'acknowledged');
  requireData(receipt && ProtagonistEventEntrySchema.shape.textEvidence.safeParse(receipt.textEvidence).success
    && fingerprint(otherEvents(story)) === fingerprint(otherEvents(original)),
  'LEGACY_RECOVERY_RECEIPT', '新正文未包含所选通知的合法收悉，或改动了其他事件裁定。原草稿保持不变。');
}
