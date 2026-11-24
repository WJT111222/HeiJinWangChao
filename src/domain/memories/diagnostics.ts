import { z } from 'zod';
import { DataError } from '../common';
import { summaryKinds } from './configuration';

export const memorySteps = { preparation: '准备请求', request: '请求模型', output: '校验总结', save: '保存总结' } as const;
export const memoryFailureReasons = {
  preparation_failed: '请求准备失败',
  input_budget: '输入超出预算',
  request_failed: '模型请求失败',
  request_timeout: '模型请求超时',
  stream_interrupted: '流式响应中断',
  unexpected_transport: '非流式请求收到 SSE',
  empty_response: '模型未返回有效内容',
  output_truncated: '模型输出被截断',
  invalid_json: 'JSON 解析失败',
  required_field: '必需字段缺失',
  unknown_field: '存在不允许的字段',
  field_type: '字段类型错误',
  field_value: '字段值不符合要求',
  empty_summary: '总结文本为空',
  missing_groups: 'NPC 认知分组缺失',
  duplicate_groups: 'NPC 认知分组重复',
  group_id_mismatch: 'NPC 认知分组 ID 不匹配',
  unresolved: 'unresolved 非空',
  contradictions: 'contradictions 非空',
  output_capacity: '总结输出超出容量限制',
  source_permission: '来源、身份或权限校验失败',
  timeline_conflict: '时间线冲突',
  save_failed: '保存总结失败',
} as const;
export const memoryRecordCodes = [
  'MEMORY_BUDGET', 'MEMORY_BUSY', 'MEMORY_CHANGED', 'MEMORY_CONFLICT', 'MEMORY_LEGACY_BATCH_MISMATCH',
  'MEMORY_LEGACY_BATCH_UNVERIFIABLE', 'MEMORY_LOCK_UNAVAILABLE', 'MEMORY_OUTPUT', 'MEMORY_PERMISSION',
  'MEMORY_PREVIOUS', 'MEMORY_RETRY_CHANGED', 'MEMORY_SOURCE', 'MEMORY_STORAGE', 'MEMORY_THROTTLED',
  'MEMORY_TIMELINE_CHANGED', 'NPC_MEMORY_CONFLICT',
] as const;

const fieldPaths = ['summary', 'importantEvents', 'importantEvents.*', 'summaries', 'summaries.*',
  'summaries.*.groupId', 'summaries.*.text', 'unresolved', 'unresolved.*', 'contradictions', 'contradictions.*'] as const;
const keys = <T extends string>(value: Record<T, unknown>) => Object.keys(value) as T[];
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const buildVersionSchema = z.union([z.string().regex(/^[0-9a-f]{40}$/), z.enum(['development', 'unavailable'])]);
const detailSchema = z.strictObject({
  reason: z.enum(keys(memoryFailureReasons)),
  fieldPath: z.enum(fieldPaths).optional(),
  expectedGroups: count.optional(),
  actualGroups: count.optional(),
});
export const memoryDiagnosticSchema = detailSchema.extend({
  task: z.enum(summaryKinds),
  step: z.enum(keys(memorySteps)),
  code: z.string().regex(/^[A-Za-z_]{1,64}$/),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,199}$/).optional(),
  protocol: z.enum(['openai', 'deepseek', 'gemini', 'anthropic']).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  outputLength: count.optional(),
  outputTruncated: z.literal(true).optional(),
  requestedAt: z.iso.datetime(),
  build: buildVersionSchema.optional(),
});
export type MemoryDiagnostic = z.infer<typeof memoryDiagnosticSchema>;
type FailureDetail = z.infer<typeof detailSchema>;

export class MemoryValidationError extends DataError {
  constructor(message: string, readonly diagnostic: FailureDetail) { super('MEMORY_OUTPUT', message); }
}

/** Only static schema paths are emitted. Unknown field names and actual values stay private. */
export function memorySchemaFailure(issue: z.ZodIssue, raw: unknown, groups?: number): FailureDetail {
  const path = issue.path.map(key => typeof key === 'number' ? '*' : key).join('.');
  const fieldPath = fieldPaths.find(value => value === path);
  const value = Object.getOwnPropertyDescriptor(raw && typeof raw === 'object' ? raw : {}, 'summaries')?.value;
  const groupCounts = groups === undefined ? {} : {
    expectedGroups: groups, actualGroups: Array.isArray(value) ? value.length : undefined,
  };
  if (issue.code === 'unrecognized_keys') return { reason: 'unknown_field', fieldPath, ...groupCounts };
  if (issue.code === 'invalid_type') {
    const missing = fieldPath && issue.path.reduce<unknown>((object, key) =>
      object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined, raw) === undefined;
    return { reason: missing ? 'required_field' : 'field_type', fieldPath, ...groupCounts };
  }
  if (issue.code === 'too_big') return { reason: 'output_capacity', fieldPath, ...groupCounts };
  if (issue.code === 'too_small' && issue.origin === 'string') return { reason: 'empty_summary', fieldPath, ...groupCounts };
  if (issue.code === 'too_small' && fieldPath === 'summaries') return { reason: 'missing_groups', fieldPath, ...groupCounts };
  return { reason: 'field_value', fieldPath, ...groupCounts };
}
