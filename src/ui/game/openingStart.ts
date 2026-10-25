import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';

// 仅由创角确认创建，留在当前 App 内存中。不是存档标志，也不能从 URL/草稿恢复收费授权。
export interface OpeningStart {
  readonly saveId: string;
  claim: (state: GameState, draft: TurnDraft | undefined) => boolean;
  revoke: () => void;
}
export function authorizeOpening(state: GameState): OpeningStart {
  const { saveId, revision } = state;
  let available = true;
  return {
    saveId,
    claim(current, draft) {
      const granted = available;
      available = false;
      return Boolean(granted && current.saveId === saveId && current.revision === revision &&
        current.turnNumber === 0 && current.journal.length === 0 && draft &&
        draft.saveId === saveId && draft.turnId === `opening-${saveId}` &&
        draft.baseSaveRevision === revision && draft.turnKind === 'opening' &&
        draft.draftRevision === 0 && draft.storyRevision === 0 && !draft.story &&
        draft.stageStatus.story === 'pending');
    },
    revoke() { available = false; },
  };
}
