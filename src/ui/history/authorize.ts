import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { OpeningStart } from '../game/openingStart';

/** One-shot, memory-only consent from the history overwrite button. Never reconstructed on reload. */
export function authorizeHistoryStart(state: GameState, draft: TurnDraft): OpeningStart {
  let available = true;
  return { saveId: state.saveId, revoke() { available = false; }, claim(current, next) {
    const grant = available; available = false;
    return Boolean(grant && current.saveId === state.saveId && current.revision === state.revision
      && next?.turnId === draft.turnId && next.draftRevision === draft.draftRevision && next.baseSaveRevision === state.revision
      && next.userInput === draft.userInput && next.turnKind === 'regular' && !next.story && !next.storyPartial
      && next.stageStatus.story === 'pending');
  } };
}
