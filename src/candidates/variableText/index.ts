import { fingerprint } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { variableCommandsForTurn } from '../../domain/turnProjection';
import { parseVariableText } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import { TextVariableCandidateSchema, TextVariableRequestBasisSchema, candidateFailure } from './model';
import type { PreparationResult, TextVariableRequestBasis, TextVariablePreparationSeal } from './model';
import { readCandidateInputs, sameRequest, variableRequestActive } from './basis';
import { candidateClock, deriveTextCommands, normalizeTextInstructions } from './policy';
import { assessTextVariableCoverage } from './coverage';
import { sealValue } from './hash';
import { verifyTextVariableCandidateSync } from './verify';
export { captureTextVariableRequestBasis } from './basis';
export { verifyTextVariableCandidateSync } from './verify';
export { TextVariableCandidateSchema, TextVariableRequestBasisSchema, TextVariablePreparationSealSchema } from './model';
export type { CandidateResult, CandidateError, CandidateErrorCode, PreparationResult, TextInstruction, TextAccess,
  TextVariableCandidate, TextVariableRequestBasis, TextVariablePreparationSeal, TextCoverage } from './model';
export type { VerifiedTextVariableCommands } from './verify';

export async function prepareTextVariableCandidate(text: string, inputState: GameState, inputDraft: TurnDraft,
  inputRequest: TextVariableRequestBasis): Promise<PreparationResult> {
  let phase: Extract<PreparationResult, { ok: false }>['failedAt'] = 'input';
  try {
    const checked = readCandidateInputs(inputState, inputDraft), requestCheck = TextVariableRequestBasisSchema.safeParse(inputRequest);
    if (!checked.ok) return { ...checked, failedAt: phase, origin: 'candidate' };
    if (!requestCheck.success) return { ...candidateFailure('revision_conflict'), failedAt: phase, origin: 'candidate' };
    const { state, draft } = checked.value, request = requestCheck.data;
    if (!variableRequestActive(draft)) return { ...candidateFailure('permission_denied'), failedAt: phase, origin: 'candidate' };
    if (!sameRequest(request, state, draft, true) || request.requestRevision >= Number.MAX_SAFE_INTEGER)
      return { ...candidateFailure('revision_conflict'), failedAt: phase, origin: 'candidate' };
    const beforeState = fingerprint(inputState), beforeDraft = fingerprint(inputDraft);
    const changed = () => beforeState !== fingerprint(inputState) || beforeDraft !== fingerprint(inputDraft);
    phase = 'parsing';
    const parsed = parseVariableText(text);
    if (!parsed.ok) return { ...parsed, failedAt: phase, origin: 'parser' };
    phase = 'authorization';
    const normalized = normalizeTextInstructions(parsed.value);
    if (!normalized.ok) return { ...normalized, failedAt: phase, origin: 'candidate' };
    const derived = deriveTextCommands(normalized.value, state, draft, request), clock = candidateClock(state, draft);
    if (!derived.ok) return { ...derived, failedAt: phase, origin: 'candidate' };
    if (!clock.ok) return { ...clock, failedAt: phase, origin: 'candidate' };
    phase = 'compilation';
    const compiled = await compileVariableCommands(derived.value.ast, state, derived.value.context);
    if (changed()) return { ...candidateFailure('revision_conflict'), failedAt: phase, origin: 'candidate' };
    if (!compiled.ok) return { ...compiled, failedAt: phase, origin: 'executor' };
    if (fingerprint(compiled.value.commands) !== fingerprint(variableCommandsForTurn(state, draft, derived.value.commands)))
      return { ...candidateFailure('candidate_tampered'), failedAt: phase, origin: 'candidate' };
    phase = 'simulation';
    const simulated = await simulateVariablePlan(compiled.value, state, derived.value.context);
    if (changed()) return { ...candidateFailure('revision_conflict'), failedAt: phase, origin: 'candidate' };
    if (!simulated.ok) return { ...simulated, failedAt: phase, origin: 'executor' };
    phase = 'verification';
    const candidate = TextVariableCandidateSchema.parse({ protocol: 'text-v1', status: 'prepared', candidateRevision: request.requestRevision + 1,
      request, instructions: normalized.value, accesses: derived.value.accesses, commands: derived.value.commands,
      clock: clock.value, coverage: assessTextVariableCoverage(state, draft, derived.value.commands) });
    const seal: TextVariablePreparationSeal = { kind: 'text-v1-preparation-seal', requestDigest: sealValue(request),
      candidateRevision: candidate.candidateRevision, payloadDigest: sealValue(candidate) };
    const verified = verifyTextVariableCandidateSync(candidate, state, draft, seal);
    if (!verified.ok) return { ...verified, failedAt: phase, origin: 'candidate' };
    return { ok: true, value: { candidate, seal, checks: { parsed: true, accessAuthorized: true, domainSimulated: true, syncReviewable: true }, committed: false } };
  } catch { return { ...candidateFailure('preparation_failed'), failedAt: phase, origin: 'candidate' }; }
}
