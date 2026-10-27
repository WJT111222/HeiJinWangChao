import { z } from 'zod';
import { CountSchema, GameTimeSchema, IdSchema, TextSchema } from '../../domain/common';
import { DomainCommandSchema } from '../../domain/commands';
import type { ExecutionError } from '../../executors/variableText';
import type { ParseError, SourceSpan } from '../../parsers/variableText';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const TextVariableRequestBasisSchema = z.strictObject({
  kind: z.literal('text-v1-request'), saveId: IdSchema, turnId: IdSchema,
  baseSaveRevision: CountSchema, storyRevision: CountSchema.min(1), executionRevision: CountSchema,
  requestRevision: CountSchema, requestDraftRevision: CountSchema,
  stateDigest: digest, storyDigest: digest, contextDigest: digest,
});
export type TextVariableRequestBasis = z.infer<typeof TextVariableRequestBasisSchema>;
const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('protagonist'), field: z.enum(['healthText', 'emotionText']) }),
  z.strictObject({ kind: z.literal('npc'), npcId: IdSchema, field: z.enum(['healthText', 'relationshipText']) }),
]);
const position = z.strictObject({ offset: CountSchema.max(262144), line: CountSchema.min(1), column: CountSchema.min(1) });
export const TextInstructionSchema = z.strictObject({
  operation: z.literal('set'), target, value: TextSchema.max(8192),
  source: z.strictObject({ start: position, end: position }),
});
export type TextInstruction = z.infer<typeof TextInstructionSchema>;
export const TextAccessSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('protagonist_text_access'), commandIndex: CountSchema.min(1), protagonistId: IdSchema,
    field: z.enum(['healthText', 'emotionText']) }),
  z.strictObject({ kind: z.literal('npc_scene_text_access'), commandIndex: CountSchema.min(1), npcId: IdSchema,
    identityKey: TextSchema, locationId: IdSchema, field: z.enum(['healthText', 'relationshipText']) }),
]);
export type TextAccess = z.infer<typeof TextAccessSchema>;
export const ClockSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('established'), worldClock: GameTimeSchema }),
  z.strictObject({ kind: z.literal('opening_story'), storyRevision: CountSchema.min(1), startAt: GameTimeSchema, endAt: GameTimeSchema }),
]);
export type ClockSource = z.infer<typeof ClockSourceSchema>;
const domain = z.enum(['protagonist', 'npc_ordinary', 'npc_special', 'items', 'economy', 'org_gang', 'org_government', 'org_civil', 'org_business']);
export const TextCoverageSchema = z.strictObject({
  status: z.enum(['empty_unconfirmed', 'scope_unconfirmed', 'unsupported_hints']), complete: z.literal(false),
  ruleDomains: z.array(domain), representedDomains: z.array(domain), unsupportedGuideIndices: z.array(CountSchema),
});
export type TextCoverage = z.infer<typeof TextCoverageSchema>;
export const TextVariableCandidateSchema = z.strictObject({
  protocol: z.literal('text-v1'), status: z.literal('prepared'), candidateRevision: CountSchema.min(1),
  request: TextVariableRequestBasisSchema,
  instructions: z.array(TextInstructionSchema).max(128), accesses: z.array(TextAccessSchema).max(128),
  commands: z.array(DomainCommandSchema).max(128), clock: ClockSourceSchema, coverage: TextCoverageSchema,
});
export type TextVariableCandidate = z.infer<typeof TextVariableCandidateSchema>;
// 非执行表示：只绑定准备时的输出。调用方必须独立保留，不能从待验载荷重建以冒充原记录。
export const TextVariablePreparationSealSchema = z.strictObject({
  kind: z.literal('text-v1-preparation-seal'), requestDigest: digest, payloadDigest: digest, candidateRevision: CountSchema.min(1),
});
export type TextVariablePreparationSeal = z.infer<typeof TextVariablePreparationSealSchema>;
export type CandidateErrorCode = 'invalid_state' | 'invalid_draft' | 'invalid_candidate' | 'story_not_ready'
  | 'revision_conflict' | 'missing_provenance' | 'unsupported_path' | 'unsupported_operation' | 'permission_denied'
  | 'entity_not_found' | 'type_mismatch' | 'candidate_tampered' | 'missing_trusted_seal' | 'time_data'
  | 'domain_validation_failed' | 'preparation_failed';
export interface CandidateError { code: CandidateErrorCode; commandIndex: number | null; source: SourceSpan | null; message: string }
export type CandidateResult<T> = { ok: true; value: T } | { ok: false; error: CandidateError };
export type PreparationResult = { ok: true; value: {
  candidate: TextVariableCandidate; seal: TextVariablePreparationSeal;
  checks: { parsed: true; accessAuthorized: true; domainSimulated: true; syncReviewable: true }; committed: false;
} } | { ok: false; failedAt: 'input' | 'parsing' | 'authorization' | 'compilation' | 'simulation' | 'verification';
  origin: 'candidate' | 'parser' | 'executor'; error: CandidateError | ParseError | ExecutionError };
const messages: Record<CandidateErrorCode, string> = {
  invalid_state: '正式状态结构或引用不合法。', invalid_draft: '草稿结构或依赖不合法。', invalid_candidate: '候选不符合唯一文本协议。',
  story_not_ready: '需要已选定且版本有效的正文。', revision_conflict: '请求、正文或正式状态基线不一致。',
  missing_provenance: '当前没有独立可信事实来源，不能准备此类变更。', unsupported_path: '此路径没有生产文本授权。',
  unsupported_operation: '允许的文本字段只接受set操作。', permission_denied: '当前正式状态不满足人物访问前提。',
  entity_not_found: '目标人物不存在。', type_mismatch: '文本指令值或规范化来源不合法。', candidate_tampered: '候选内容、顺序或来源与准备记录不一致。',
  missing_trusted_seal: '缺少独立保留的准备输出绑定。', time_data: '时间来源或只读历史边界不合法。',
  domain_validation_failed: '整批领域模拟失败，没有返回部分状态。', preparation_failed: '候选准备未能完成。',
};
export function candidateFailure(code: CandidateErrorCode, commandIndex: number | null = null, source: SourceSpan | null = null): { ok: false; error: CandidateError } {
  return { ok: false, error: { code, commandIndex, source: source ? structuredClone(source) : null, message: messages[code] } };
}
