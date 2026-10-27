import { fingerprint } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { parseVariableText } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import type { VariableExecutionContext } from '../../executors/variableText';
import { checkedSnapshots, makeBasis } from './basis';
import { bridgeFailure, previewError, previewOnly, PreviewBasisSchema, progress } from './model';
import type { PreviewPhase, TextVariablePreviewBasis, TextVariablePreviewResult, TextVariablePreviewState } from './model';
export { captureVariableTextPreviewBasis } from './basis';
export type { PreviewBasisResult, PreviewError, PreviewErrorCode, PreviewPhase, PreviewProgress,
  TextVariablePreviewBasis, TextVariablePreviewResult, TextVariablePreviewState } from './model';

/** 纯离线解析、编译和内存模拟，不写候选或正式存档。 */
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
    const context: VariableExecutionContext = { draft, expectedRevision: state.revision };
    phase = 'compilation';
    const compiled = await compileVariableCommands(parsed.value, state, context);
    if (changed()) return bridgeFailure(phase, previewError('revision_conflict'));
    if (!compiled.ok) return { ...previewOnly, ok: false, failedAt: phase, origin: 'executor', error: compiled.error, progress: progress(phase) };
    phase = 'simulation';
    const simulated = await simulateVariablePlan(compiled.value, state, context);
    if (changed()) return bridgeFailure(phase, previewError('revision_conflict'));
    if (!simulated.ok) return { ...previewOnly, ok: false, failedAt: phase, origin: 'executor', error: simulated.error, progress: progress(phase) };
    // 保留原只读文本摘要，避免返回整份存档和未涉及人物的私人资料。
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
