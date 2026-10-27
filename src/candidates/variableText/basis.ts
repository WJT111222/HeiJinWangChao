import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { fingerprint } from '../../domain/commands';
import { candidateFailure } from './model';
import type { CandidateResult, TextVariableRequestBasis } from './model';
import { sealValue } from './hash';

export function readCandidateInputs(state: GameState, draft: TurnDraft): CandidateResult<{ state: GameState; draft: TurnDraft }> {
  const s = GameStateSchema.safeParse(state);
  if (!s.success) return candidateFailure('invalid_state');
  if (!draft || typeof draft !== 'object') return candidateFailure('invalid_draft');
  if (!draft.story || draft.stageStatus?.story !== 'ready' || draft.storyRevision === 0) return candidateFailure('story_not_ready');
  const d = TurnDraftSchema.safeParse(draft);
  if (!d.success) return candidateFailure('invalid_draft');
  if (s.data.saveId !== d.data.saveId || s.data.revision !== d.data.baseSaveRevision
    || d.data.turnKind !== (s.data.turnNumber === 0 ? 'opening' : 'regular')
    || s.data.journal.some((entry) => entry.turnId === d.data.turnId)
    || s.data.appliedCommands.some((entry) => entry.turnId === d.data.turnId)) return candidateFailure('revision_conflict');
  return { ok: true, value: { state: s.data, draft: d.data } };
}
export function requestBasisFor(state: GameState, draft: TurnDraft): TextVariableRequestBasis {
  return { kind: 'text-v1-request', saveId: state.saveId, turnId: draft.turnId, baseSaveRevision: state.revision,
    storyRevision: draft.storyRevision, executionRevision: draft.executionRevision, requestRevision: draft.stageRequestRevisions.variables,
    requestDraftRevision: draft.draftRevision, stateDigest: sealValue(state), storyDigest: sealValue(draft.story),
    contextDigest: sealValue({ turnKind: draft.turnKind, userInput: draft.userInput }) };
}
export function variableRequestActive(draft: TurnDraft): boolean {
  return draft.useVariableStage && draft.stageStatus.variables === 'pending'
    && (draft.executionRevision === 0
      ? draft.stageRequestRevisions.variables === 0 && draft.requestedStages.length === 0
      : draft.stageRequestRevisions.variables === draft.executionRevision && draft.requestedStages.includes('variables'));
}
export function captureTextVariableRequestBasis(state: GameState, draft: TurnDraft): CandidateResult<TextVariableRequestBasis> {
  try {
    const input = readCandidateInputs(state, draft);
    if (!input.ok) return input;
    if (!variableRequestActive(input.value.draft)) return candidateFailure('permission_denied');
    return { ok: true, value: requestBasisFor(input.value.state, input.value.draft) };
  } catch { return candidateFailure('preparation_failed'); }
}
export function sameRequest(request: TextVariableRequestBasis, state: GameState, draft: TurnDraft, preparing: boolean): boolean {
  const now = requestBasisFor(state, draft);
  if (preparing) return fingerprint(request) === fingerprint(now);
  // 保存候选/运行世界会推进draftRevision。世界专属重试还会推进全局executionRevision，
  // 但不得改变量请求身份；未按world尝试协议推进的execution变化仍拒绝。
  const worldOnly = draft.executionRevision > request.executionRevision && draft.requestedStages.length === 1
    && draft.requestedStages[0] === 'world' && draft.stageRequestRevisions.world === draft.executionRevision
    && draft.stageRequestRevisions.variables === request.requestRevision;
  return draft.draftRevision >= request.requestDraftRevision
    && (draft.executionRevision === request.executionRevision || worldOnly)
    && fingerprint({ ...now, requestDraftRevision: request.requestDraftRevision, executionRevision: request.executionRevision }) === fingerprint(request);
}
