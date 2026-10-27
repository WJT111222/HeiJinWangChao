import { fingerprint } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { parseVariableText } from '../../parsers/variableText';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import type { VariableExecutionContext } from '../../executors/variableText';
import { checkedSnapshots, makeBasis } from './basis';
import { bridgeFailure, previewError, previewOnly, PreviewBasisSchema, progress } from './model';
import type { PreviewError, PreviewPhase, TextVariablePreviewBasis, TextVariablePreviewResult, TextVariablePreviewState } from './model';
export { captureVariableTextPreviewBasis } from './basis';
export type { PreviewBasisResult, PreviewError, PreviewErrorCode, PreviewPhase, PreviewProgress,
  TextVariablePreviewBasis, TextVariablePreviewResult, TextVariablePreviewState } from './model';

/** 仅检查正式快照中的访问前提；不阅读小说来证明事件，不接受AI自建交互授权。 */
function previewPermission(command: ParsedVariableCommand, state: GameState, index: number): PreviewError | undefined {
  const [root, middle, last] = command.path.nodes;
  const fail = (code: PreviewError['code']) => previewError(code, index + 1, command.source);
  if (root.name === 'npc' && middle?.kind === 'index') return fail('unsupported_path');
  if (root.name === 'economy' || root.name === 'items'
    || (root.name === 'npc' && last?.kind === 'field' && last.name === 'memories')) return fail('missing_provenance');
  const protagonist = command.path.nodes.length === 2 && root.name === 'protagonist' && middle?.kind === 'field'
    && ['healthText', 'emotionText'].includes(middle.name);
  const npc = command.path.nodes.length === 3 && root.name === 'npc' && middle?.kind === 'id' && last?.kind === 'field'
    && ['healthText', 'relationshipText'].includes(last.name);
  if (!protagonist && !npc) return fail('offline_authorization_unsupported');
  if (command.operation !== 'set') return fail('unsupported_operation');
  if (npc && middle?.kind === 'id') {
    if (!Object.hasOwn(state.npc, middle.id)) return fail('entity_not_found');
    const person = state.npc[middle.id];
    if (!person.onScene || !person.locationId || person.locationId !== state.protagonist.locationId)
      return fail('permission_denied');
  }
}

/** 该结果及合成审计文字只供离线预演；不会产出正式VariableResult、保存候选或提交授权。 */
export async function previewVariableTextReply(text: string, inputState: GameState, inputDraft: TurnDraft,
  expectedBasis: TextVariablePreviewBasis): Promise<TextVariablePreviewResult> {
  let phase: PreviewPhase = 'input';
  try {
    const checked = checkedSnapshots(inputState, inputDraft);
    if (!checked.ok) return bridgeFailure(phase, checked.error);
    const basisCheck = PreviewBasisSchema.safeParse(expectedBasis);
    if (!basisCheck.success) return bridgeFailure(phase, previewError('revision_conflict'));
    const { state, draft } = checked;
    const beforeState = fingerprint(inputState), beforeDraft = fingerprint(inputDraft);
    const changed = () => beforeState !== fingerprint(inputState) || beforeDraft !== fingerprint(inputDraft);
    const basis = await makeBasis(state, draft);
    if (changed() || fingerprint(basisCheck.data) !== fingerprint(basis)) return bridgeFailure(phase, previewError('revision_conflict'));
    phase = 'parsing';
    const parsed = parseVariableText(text);
    if (!parsed.ok) return { ...previewOnly, ok: false, failedAt: phase, origin: 'parser', error: parsed.error, progress: progress(phase) };
    phase = 'authorization';
    for (let i = 0; i < parsed.value.length; i++) {
      const denied = previewPermission(parsed.value[i], state, i);
      if (denied) return bridgeFailure(phase, denied);
    }
    // 此处没有memorySource、expense或互动凭据。审计文字不是事件真实性证明，不对外暴露context。
    const context: VariableExecutionContext = { draft, expectedRevision: state.revision, interactions: [],
      proofs: parsed.value.map((_, i) => ({ commandIndex: i + 1,
        evidence: `preview_only:audit_not_fact:${draft.turnId}:story${draft.storyRevision}:command${i + 1}` })) };
    phase = 'compilation';
    const compiled = await compileVariableCommands(parsed.value, state, context);
    if (changed()) return bridgeFailure(phase, previewError('revision_conflict'));
    if (!compiled.ok) return { ...previewOnly, ok: false, failedAt: phase, origin: 'executor', error: compiled.error, progress: progress(phase) };
    phase = 'simulation';
    const simulated = await simulateVariablePlan(compiled.value, state, context);
    if (changed()) return bridgeFailure(phase, previewError('revision_conflict'));
    if (!simulated.ok) return { ...previewOnly, ok: false, failedAt: phase, origin: 'executor', error: simulated.error, progress: progress(phase) };
    // 只投影实际获准路径，避免把私人资料、appliedCommands里的审计proof或整份状态带到调用方。
    const npcIds = new Set(parsed.value.flatMap((command) => {
      const [root, id] = command.path.nodes;
      return root.name === 'npc' && id?.kind === 'id' ? [id.id] : [];
    }));
    const previewState: TextVariablePreviewState = { worldClock: simulated.value.worldClock,
      clockKind: state.openingTimePending ? 'opening_candidate' as const : 'unchanged' as const,
      protagonist: { healthText: simulated.value.protagonist.healthText, emotionText: simulated.value.protagonist.emotionText },
      npc: Object.fromEntries([...npcIds].map((id) => [id, { healthText: simulated.value.npc[id].healthText,
        relationshipText: simulated.value.npc[id].relationshipText }])) };
    return { ...previewOnly, ok: true, basis, commandCount: parsed.value.length, previewState, progress: progress() };
  } catch { return bridgeFailure(phase, previewError('preview_failed')); }
}
