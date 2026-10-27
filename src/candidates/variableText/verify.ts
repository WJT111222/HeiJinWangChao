import { commitCommands, fingerprint } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { openingTimeBase } from '../../domain/openingTime';
import { variableCommandsForTurn } from '../../domain/turnProjection';
import { TextVariableCandidateSchema, TextVariablePreparationSealSchema, candidateFailure } from './model';
import type { CandidateResult, TextCoverage, TextVariablePreparationSeal } from './model';
import { readCandidateInputs, sameRequest } from './basis';
import { candidateClock, deriveTextCommands } from './policy';
import { assessTextVariableCoverage } from './coverage';
import { sealValue } from './hash';

export interface VerifiedTextVariableCommands {
  protocol: 'text-v1'; state: 'sync_verified'; commands: DomainCommand[]; coverage: TextCoverage;
  // 本轮无法证明整回合无遗漏，不能把域内可执行误称完整结算许可。
  commitAllowed: false;
}
export function verifyTextVariableCandidateSync(input: unknown, inputState: GameState, inputDraft: TurnDraft,
  expectedSeal: TextVariablePreparationSeal): CandidateResult<VerifiedTextVariableCommands> {
  try {
    const checked = readCandidateInputs(inputState, inputDraft);
    if (!checked.ok) return checked;
    if (!['pending', 'ready'].includes(checked.value.draft.stageStatus.variables)) return candidateFailure('revision_conflict');
    const parsed = TextVariableCandidateSchema.safeParse(input);
    if (!parsed.success) return candidateFailure('invalid_candidate');
    const receipt = TextVariablePreparationSealSchema.safeParse(expectedSeal);
    if (!receipt.success) return candidateFailure('missing_trusted_seal');
    const c = parsed.data, { state, draft } = checked.value;
    if (!sameRequest(c.request, state, draft, false) || c.request.requestRevision >= Number.MAX_SAFE_INTEGER
      || c.candidateRevision !== c.request.requestRevision + 1) return candidateFailure('revision_conflict');
    if (receipt.data.requestDigest !== sealValue(c.request) || receipt.data.payloadDigest !== sealValue(c)
      || receipt.data.candidateRevision !== c.candidateRevision) return candidateFailure('candidate_tampered');
    // 不以摘要作权限证明：重新构造来源及字段白名单命令，恶意自造封印也不能越权。
    const derived = deriveTextCommands(c.instructions, state, draft, c.request);
    if (!derived.ok) return derived;
    if (fingerprint(c.accesses) !== fingerprint(derived.value.accesses) || fingerprint(c.commands) !== fingerprint(derived.value.commands)) return candidateFailure('candidate_tampered');
    const clock = candidateClock(state, draft);
    if (!clock.ok) return clock;
    if (fingerprint(c.clock) !== fingerprint(clock.value)) return candidateFailure('candidate_tampered');
    const coverage = assessTextVariableCoverage(state, draft, derived.value.commands);
    if (fingerprint(c.coverage) !== fingerprint(coverage)) return candidateFailure('candidate_tampered');
    // 当前支持范围内的整批同步复核；程序时钟仅在统一投影时加入，不存入候选commands。
    commitCommands(openingTimeBase(state, draft), draft.turnId, state.revision,
      variableCommandsForTurn(state, draft, derived.value.commands), state.updatedAt);
    return { ok: true, value: { protocol: 'text-v1', state: 'sync_verified', commands: derived.value.commands, coverage, commitAllowed: false } };
  } catch { return candidateFailure('domain_validation_failed'); }
}
