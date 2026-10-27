import { fingerprint } from '../../domain/commands';
import { TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { digest } from '../../executors/variableText/model';
import { previewError } from './model';
import type { PreviewBasisResult, PreviewError, TextVariablePreviewBasis } from './model';

export function checkedSnapshots(state: GameState, draft: TurnDraft):
  { ok: true; state: GameState; draft: TurnDraft } | { ok: false; error: PreviewError } {
  const current = GameStateSchema.safeParse(state);
  if (!current.success) return { ok: false, error: previewError('invalid_state') };
  if (!draft || typeof draft !== 'object') return { ok: false, error: previewError('invalid_draft') };
  if (!draft.story || draft.stageStatus?.story !== 'ready' || draft.storyRevision === 0)
    return { ok: false, error: previewError('story_not_ready') };
  const selected = TurnDraftSchema.safeParse(draft);
  if (!selected.success) return { ok: false, error: previewError('invalid_draft') };
  const s = current.data, d = selected.data;
  if (s.saveId !== d.saveId || s.revision !== d.baseSaveRevision
    || d.turnKind !== (s.turnNumber === 0 ? 'opening' : 'regular')
    || s.journal.some((entry) => entry.turnId === d.turnId)
    || s.appliedCommands.some((entry) => entry.turnId === d.turnId))
    return { ok: false, error: previewError('revision_conflict') };
  return { ok: true, state: s, draft: d };
}
export async function makeBasis(state: GameState, draft: TurnDraft): Promise<TextVariablePreviewBasis> {
  return { kind: 'text_variable_preview_basis', version: 1, saveId: state.saveId, turnId: draft.turnId,
    baseSaveRevision: state.revision, draftRevision: draft.draftRevision, storyRevision: draft.storyRevision,
    executionRevision: draft.executionRevision, stageRequestRevisions: { ...draft.stageRequestRevisions },
    stateDigest: await digest(fingerprint(state)), draftDigest: await digest(fingerprint(draft)) };
}
/** 必须在为该正文准备/接收离线回复前捕获，不能拿新正文的基线给旧回复补票。 */
export async function captureVariableTextPreviewBasis(state: GameState, draft: TurnDraft): Promise<PreviewBasisResult> {
  try {
    const checked = checkedSnapshots(state, draft);
    if (!checked.ok) return checked;
    const beforeState = fingerprint(state), beforeDraft = fingerprint(draft);
    const value = await makeBasis(checked.state, checked.draft);
    if (beforeState !== fingerprint(state) || beforeDraft !== fingerprint(draft))
      return { ok: false, error: previewError('revision_conflict') };
    return { ok: true, value };
  } catch { return { ok: false, error: previewError('preview_failed') }; }
}
