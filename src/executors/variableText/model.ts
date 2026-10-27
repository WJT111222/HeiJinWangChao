import { z } from 'zod';
import { CountSchema, IdSchema, TextSchema } from '../../domain/common';
import type { DomainCommand } from '../../domain/commands';
import { TurnDraftSchema } from '../../domain/drafts';
import type { ParsedVariableCommand, SourceSpan } from '../../parsers/variableText';

const note = TextSchema.max(8192);
const identity = { npcId: IdSchema, identityKey: note };
const MemorySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scene'), ...identity }),
  z.strictObject({ kind: z.literal('npc_memory'), ...identity, memoryId: IdSchema }),
]);
export const ExecutionContextSchema = z.strictObject({
  draft: TurnDraftSchema,
  expectedRevision: CountSchema,
  // 来自调用方已确认的本回合互动，不可从AST自己的状态更新或记忆中生成授权。
  interactions: z.array(z.strictObject({ ...identity, turnId: IdSchema, storyRevision: CountSchema })).max(128),
  proofs: z.array(z.strictObject({
    commandIndex: CountSchema.refine((n) => n > 0 && n <= 128), evidence: note,
    expense: z.strictObject({ account: z.enum(['cash', 'onlineBalance']), amount: CountSchema.refine((n) => n > 0), purpose: note }).optional(),
    memorySource: MemorySourceSchema.optional(),
  })).max(128),
});
export type VariableExecutionContext = z.infer<typeof ExecutionContextSchema>;
export type CommandProof = VariableExecutionContext['proofs'][number];
export interface CommandOrigin { commandIndex: number; source: SourceSpan }
export interface VariableExecutionPlan {
  readonly version: 1;
  readonly stateDigest: string;
  readonly contextDigest: string;
  readonly ast: readonly ParsedVariableCommand[];
  readonly commands: readonly DomainCommand[];
  /** 程序产生的开局时钟没有文本命令来源，使用null。 */
  readonly origins: readonly (CommandOrigin | null)[];
}
export type ExecutionErrorCode = 'unsupported_path' | 'unsupported_operation' | 'entity_not_found'
  | 'permission_denied' | 'type_mismatch' | 'missing_provenance' | 'invalid_amount' | 'invalid_quantity'
  | 'revision_conflict' | 'duplicate_or_conflicting_command' | 'domain_validation_failed' | 'transaction_failed';
export interface ExecutionError {
  code: ExecutionErrorCode;
  commandIndex: number | null;
  source: SourceSpan | null;
  message: string;
  /** 终态整批一致性错误无法确定归因时保留所有来源，不虚构失败的单条命令。 */
  relatedCommands: CommandOrigin[];
}
export type ExecutionResult<T> = { ok: true; value: T } | { ok: false; error: ExecutionError };
const messages: Record<ExecutionErrorCode, string> = {
  unsupported_path: '此路径未注册，或实体路径未使用稳定ID。',
  unsupported_operation: '此路径不支持该操作。', entity_not_found: '目标实体不存在。',
  permission_denied: '缺少目标实体、归属或知识访问权限。', type_mismatch: '值或输入结构不符合要求。',
  missing_provenance: '缺少本回合所需的可信来源、用途或身份依据。',
  invalid_amount: '资金金额、余额或人民币分精度不合法。', invalid_quantity: '物品数量、前值或安全整数范围不合法。',
  revision_conflict: '正式版本、草稿或正文版本已变化。',
  duplicate_or_conflicting_command: '命令重放内容冲突或出现重复身份。',
  domain_validation_failed: '领域Schema或整体状态一致性校验失败。', transaction_failed: '整批内存模拟失败，未返回部分状态。',
};
export function failed(code: ExecutionErrorCode, origin: CommandOrigin | null = null,
  relatedCommands: readonly CommandOrigin[] = []): { ok: false; error: ExecutionError } {
  return { ok: false, error: { code, commandIndex: origin?.commandIndex ?? null,
    source: origin ? structuredClone(origin.source) : null, message: messages[code],
    relatedCommands: structuredClone([...relatedCommands]) } };
}
// 只调用标准确定性摘要，不调用网络、数据库、时钟或随机数。Node24和现代浏览器均支持。
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
