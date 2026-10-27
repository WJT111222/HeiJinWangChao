import { z } from 'zod';
import { CountSchema, IdSchema } from '../../domain/common';
import type { ExecutionError } from '../../executors/variableText';
import type { ParseError, SourceSpan } from '../../parsers/variableText';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** 只绑定离线样本的基线，不是生产授权签名，也不属于存档Schema。 */
export const PreviewBasisSchema = z.strictObject({
  kind: z.literal('text_variable_preview_basis'), version: z.literal(1),
  saveId: IdSchema, turnId: IdSchema, baseSaveRevision: CountSchema,
  draftRevision: CountSchema, storyRevision: CountSchema.min(1), executionRevision: CountSchema,
  stageRequestRevisions: z.strictObject({ variables: CountSchema, world: CountSchema }),
  stateDigest: hash, draftDigest: hash,
});
export type TextVariablePreviewBasis = z.infer<typeof PreviewBasisSchema>;
export type PreviewPhase = 'input' | 'parsing' | 'authorization' | 'compilation' | 'simulation';
type Status = 'not_run' | 'passed' | 'failed';
export interface PreviewProgress {
  input: Status; parsing: Status;
  authorization: 'not_run' | 'sufficient_for_preview' | 'failed';
  compilation: Status; simulation: Status;
}
export type PreviewErrorCode = 'invalid_state' | 'invalid_draft' | 'revision_conflict' | 'story_not_ready'
  | 'entity_not_found' | 'permission_denied' | 'unsupported_path' | 'unsupported_operation'
  | 'missing_provenance' | 'offline_authorization_unsupported' | 'preview_failed';
export interface PreviewError {
  code: PreviewErrorCode; commandIndex: number | null; source: SourceSpan | null; message: string;
}
interface PreviewOnly {
  mode: 'preview_only'; audience: 'internal'; commitAllowed: false; contextKind: 'preview_audit_only';
  progress: PreviewProgress;
}
/** 只读输出投影：不含journal、经济、私人记忆、命令指纹或可持久化GameState形状。 */
export interface TextVariablePreviewState {
  readonly worldClock: string;
  readonly clockKind: 'opening_candidate' | 'unchanged';
  readonly protagonist: { readonly healthText: string; readonly emotionText: string };
  readonly npc: Readonly<Record<string, { readonly healthText?: string; readonly relationshipText: string }>>;
}
export type TextVariablePreviewResult = PreviewOnly & (
  | { ok: true; basis: TextVariablePreviewBasis; commandCount: number; previewState: TextVariablePreviewState }
  | { ok: false; failedAt: PreviewPhase; origin: 'bridge'; error: PreviewError }
  | { ok: false; failedAt: 'parsing'; origin: 'parser'; error: ParseError }
  | { ok: false; failedAt: 'compilation' | 'simulation'; origin: 'executor'; error: ExecutionError }
);
export type PreviewBasisResult = { ok: true; value: TextVariablePreviewBasis } | { ok: false; error: PreviewError };
export const previewOnly = { mode: 'preview_only', audience: 'internal', commitAllowed: false, contextKind: 'preview_audit_only' } as const;
const phases: PreviewPhase[] = ['input', 'parsing', 'authorization', 'compilation', 'simulation'];
export function progress(failedAt?: PreviewPhase): PreviewProgress {
  const index = failedAt === undefined ? phases.length : phases.indexOf(failedAt);
  const status = (phase: PreviewPhase): Status => phases.indexOf(phase) < index ? 'passed'
    : phases.indexOf(phase) === index ? 'failed' : 'not_run';
  const auth = status('authorization');
  return { input: status('input'), parsing: status('parsing'), authorization: auth === 'passed' ? 'sufficient_for_preview' : auth,
    compilation: status('compilation'), simulation: status('simulation') };
}
const messages: Record<PreviewErrorCode, string> = {
  invalid_state: '正式状态结构或整体引用不合法。', invalid_draft: '草稿结构或候选依赖不合法。',
  revision_conflict: '预演基线、存档或正文版本不一致，请重新捕获当前基线。',
  story_not_ready: '离线预演需要已选定且版本有效的正文。', entity_not_found: '目标NPC不存在。',
  permission_denied: 'NPC必须在正式状态中已在场且与主角地点一致。',
  unsupported_path: '实体路径必须使用稳定ID。', unsupported_operation: '文本状态预演只支持set操作。',
  missing_provenance: '当前没有此类操作的独立可信来源，不能自动补造证明。',
  offline_authorization_unsupported: '此路径不支持当前离线预演授权。', preview_failed: '离线预演未能完成，没有返回部分状态。',
};
export function previewError(code: PreviewErrorCode, commandIndex: number | null = null, source: SourceSpan | null = null): PreviewError {
  return { code, commandIndex, source: source ? structuredClone(source) : null, message: messages[code] };
}
export function bridgeFailure(phase: PreviewPhase, error: PreviewError): TextVariablePreviewResult {
  return { ...previewOnly, ok: false, failedAt: phase, origin: 'bridge', error, progress: progress(phase) };
}
