import type { TurnDraft } from '../../domain/drafts';

// This is only the player's manual entry policy. Stage runners and atomic
// settlement still validate their own inputs and keep their version protocol.
export function mayStartStory(draft?: TurnDraft): boolean {
  return Boolean(draft && (!draft.story || draft.stageStatus.story !== 'ready' || !draft.story.summary.trim()));
}
