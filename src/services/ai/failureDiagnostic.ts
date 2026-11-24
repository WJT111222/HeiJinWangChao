import { z } from 'zod';
import { PRODUCT_VERSION } from '../../app/product';
import { manualRetryOnly, AiError } from './errors';
import type { Settings } from '../../ui/settings/model';

/** 只记录实际看见的结构化标记。对不上白名单就是无法识别，没有字段就是未知。 */
export const upstreamClasses = [
  'overload', 'rate_limit', 'quota', 'authorization', 'model_missing', 'invalid_parameter',
  'tool_incompatible', 'content_filter', 'internal', 'unrecognized', 'unknown',
] as const;
export const failurePhases = [
  'request_build', 'preset_init', 'upstream_connect', 'awaiting_headers', 'awaiting_bytes',
  'upstream_read', 'upstream_error', 'tool_parse', 'wrapper_restore', 'story_validation',
  'candidate_save', 'unknown',
] as const;
export const retryStops = [
  'disabled', 'budget', 'cancelled', 'quota', 'relay_manual', 'tavern_manual', 'program',
  'retry_after', 'not_retryable',
] as const;
const storyTagNames = ['thinking', '正文', '短期记忆', '变量规划', '行动选项'] as const;
const token = /^[A-Za-z0-9_.:-]{1,64}$/;
const finishToken = /^(?:stop|end_turn|stop_sequence|eos|eos_token|length|max_tokens|content_filter|sensitive|safety|refusal|prohibited_content|blocklist|spii|recitation|image_safety|tool_calls|tool_use|unrecognized)$/;
const classByToken: Record<string, (typeof upstreamClasses)[number]> = {
  overloaded: 'overload', overloaded_error: 'overload', over_capacity: 'overload', server_overloaded: 'overload',
  rate_limit: 'rate_limit', rate_limit_exceeded: 'rate_limit', rate_limit_error: 'rate_limit', too_many_requests: 'rate_limit',
  insufficient_quota: 'quota', insufficient_quota_error: 'quota', billing_hard_limit_reached: 'quota',
  exceeded_current_quota_error: 'quota', insufficient_balance: 'quota', arrearage: 'quota',
  invalid_api_key: 'authorization', authentication_error: 'authorization', permission_error: 'authorization',
  model_not_found: 'model_missing', modelnotfound: 'model_missing', 'invalidendpointormodel.notfound': 'model_missing',
  invalid_parameter: 'invalid_parameter', unsupported_parameter: 'invalid_parameter',
  content_filter: 'content_filter', content_filter_error: 'content_filter',
  internal_error: 'internal', internal_server_error: 'internal', api_error: 'internal',
};
const programCodes = new Set([
  'configuration', 'credentials', 'authorization', 'not_found', 'unsupported', 'parameter_adjusted',
  'resource', 'placeholder', 'storage', 'variable_runtime', 'candidate_conflict', 'permission',
  'concurrency_unavailable',
]);
const phaseNames: Record<(typeof failurePhases)[number], string> = {
  request_build: '请求构建', preset_init: '预设脚本初始化', upstream_connect: '上游连接',
  awaiting_headers: '等待响应头', awaiting_bytes: '等待首个响应数据', upstream_read: '上游响应读取',
  upstream_error: '上游错误对象或 SSE 错误事件', tool_parse: '工具调用结果解析',
  wrapper_restore: '预设包装与正文还原', story_validation: '正文结构校验', candidate_save: '候选保存',
  unknown: '未知',
};
const classNames: Record<(typeof upstreamClasses)[number], string> = {
  overload: '服务过载', rate_limit: '临时限流', quota: '明确额度不足', authorization: '鉴权失败',
  model_missing: '模型不存在', invalid_parameter: '请求参数不合法', tool_incompatible: '工具调用不兼容',
  content_filter: '内容过滤', internal: '上游内部异常', unrecognized: '无法识别的上游错误', unknown: '未知',
};
const stopNames: Record<(typeof retryStops)[number], string> = {
  disabled: '扩展自动重试未开启', budget: '自动重试次数已用完', cancelled: '玩家取消',
  quota: '明确额度不足', relay_manual: '必须手动处理的中转异常', tavern_manual: '必须手动处理的酒馆异常',
  program: '配置、权限或存档异常', retry_after: 'Retry-After 等待时间过长', not_retryable: '不符合自动重试条件',
};

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const tagScan = z.strictObject({
  tag: z.enum(storyTagNames),
  required: z.boolean(),
  open: z.boolean(),
  close: z.boolean(),
  duplicate: z.boolean(),
  malformed: z.boolean(),
  order: z.enum(['ok', 'early', 'missing', 'unknown']),
});
export const failureDiagnosticSchema = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9 ._+-]{1,40}$/),
  build: z.union([z.string().regex(/^[0-9a-f]{40}$/), z.enum(['development', 'unavailable', 'unknown'])]).optional(),
  model: z.union([z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,199}$/), z.literal('unknown')]).optional(),
  protocol: z.enum(['openai', 'deepseek', 'gemini', 'anthropic']).optional(),
  stream: z.boolean().optional(),
  preset: z.enum(['off', 'native', 'script']).optional(),
  relayEnabled: z.boolean().optional(),
  relayUsed: z.boolean().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  httpError: z.boolean().optional(),
  errorInBody: z.boolean().optional(),
  timeoutSeconds: count.optional(),
  elapsedMs: count.optional(),
  bytes: count.optional(),
  finishReason: z.string().regex(finishToken).optional(),
  contentChars: count.optional(),
  reasoningChars: count.optional(),
  parseInputChars: count.optional(),
  complete: z.boolean().optional(),
  phase: z.enum(failurePhases).optional(),
  upstreamClass: z.enum(upstreamClasses).optional(),
  upstreamCode: z.string().regex(token).optional(),
  upstreamType: z.string().regex(token).optional(),
  storyTags: z.array(tagScan).max(5).optional(),
  parseTags: z.array(tagScan).max(5).optional(),
  reasoningTags: z.array(z.strictObject({ tag: z.enum(storyTagNames), present: z.boolean() })).max(5).optional(),
  recovery: z.strictObject({
    attempted: z.boolean(),
    rule: z.enum(['missing_body_delimiters', 'unclosed_tags']).optional(),
    succeeded: z.boolean(),
    reason: z.enum(['not_needed', 'not_applicable', 'rule_mismatch', 'unknown']).optional(),
  }).optional(),
  retry: z.strictObject({
    extended: z.boolean(),
    attempt: z.number().int().min(1).max(20),
    max: z.number().int().min(0).max(3),
    eligible: z.boolean(),
    scheduled: z.boolean(),
    stop: z.enum(retryStops).optional(),
    waitMs: count.optional(),
    recovered: z.boolean().optional(),
  }).optional(),
});
export type FailureDiagnostic = z.infer<typeof failureDiagnosticSchema>;
type RetryDecision = { action: 'wait'; ms: number; retryIndex: number; max: number; reason: string }
  | { action: 'stop'; reason: 'budget' | 'not_retryable' | 'retry_after' };

const attached = new WeakMap<object, FailureDiagnostic>();

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}
function observedBuild(): NonNullable<FailureDiagnostic['build']> {
  const value = import.meta.env.VITE_FEEDBACK_BUILD;
  if (value === 'development' || value === 'unavailable' || value === 'unknown') return value;
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : 'unknown';
}
export function readFailureDiagnostic(error: unknown) {
  return typeof error === 'object' && error !== null ? attached.get(error) : undefined;
}
export function carryFailureDiagnostic(from: unknown, to: unknown) {
  const diagnostic = readFailureDiagnostic(from);
  if (diagnostic && typeof to === 'object' && to !== null && to !== from) attached.set(to, diagnostic);
}
export function attachFailureDiagnostic(error: unknown, patch: Partial<FailureDiagnostic>) {
  if (typeof error !== 'object' || error === null) return;
  const previous = attached.get(error);
  const retry = patch.retry || previous?.retry ? { ...previous?.retry, ...defined(patch.retry ?? {}) } : undefined;
  const merged = failureDiagnosticSchema.safeParse({
    version: PRODUCT_VERSION,
    build: observedBuild(),
    ...previous,
    ...defined(patch),
    ...(retry ? { retry } : {}),
    ...(patch.storyTags ? { storyTags: patch.storyTags } : {}),
    ...(patch.parseTags ? { parseTags: patch.parseTags } : {}),
    ...(patch.reasoningTags ? { reasoningTags: patch.reasoningTags } : {}),
    ...(patch.recovery ? { recovery: patch.recovery } : {}),
  });
  if (merged.success) attached.set(error, merged.data);
}
export function safeFailureDiagnostic(error: unknown) {
  const parsed = failureDiagnosticSchema.safeParse(readFailureDiagnostic(error));
  return parsed.success ? parsed.data : undefined;
}

function tokenOf(value: unknown) {
  return typeof value === 'string' && token.test(value) ? value : undefined;
}
const secretLike = /sk-|api[_-]?key|secret|password|bearer|authorization/i;
function publishable(code: string) {
  if (secretLike.test(code) || code.length > 32) return false;
  if (code.length >= 16 && !/[_.:-]/.test(code)) return false;
  return true;
}
/** 从已经拿到的 JSON 里摘安全字段。不读 message、URL 或任意长文本。 */
export function classifyUpstreamPayload(value: unknown, observed: { transport: 'json' | 'sse' | 'http'; httpStatus?: number; errorEvent?: boolean }): Partial<FailureDiagnostic> {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const error = data?.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : undefined;
  const tokens = [error?.code, error?.type, data?.code, data?.type].map(tokenOf).filter((item): item is string => Boolean(item));
  let upstreamClass: (typeof upstreamClasses)[number] | undefined;
  let upstreamCode: string | undefined;
  for (const item of tokens) {
    const known = classByToken[item.toLowerCase()];
    if (known) { upstreamClass = known; upstreamCode = item; break; }
  }
  const errorInBody = Boolean(error || data?.error || data?.type === 'error' || observed.errorEvent);
  const visible = tokens.filter(publishable);
  if (!upstreamClass && errorInBody) upstreamClass = tokens.length ? 'unrecognized' : 'unknown';
  if (!upstreamCode && upstreamClass === 'unrecognized') upstreamCode = visible[0];
  const upstreamType = tokens.filter(item => item !== upstreamCode && publishable(item))[0];
  const httpStatus = typeof observed.httpStatus === 'number' && observed.httpStatus >= 100 && observed.httpStatus <= 599 ? observed.httpStatus : undefined;
  return {
    ...(upstreamClass ? { upstreamClass, phase: 'upstream_error' as const } : {}),
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(upstreamType ? { upstreamType } : {}),
    ...(errorInBody ? { errorInBody: true } : {}),
    ...(httpStatus !== undefined ? { httpStatus, httpError: httpStatus < 200 || httpStatus >= 300 } : {}),
  };
}

const safeCount = (value: number | undefined) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** 补上这次请求已经观察到的事实。已有的上游分类和环节不被后来的笼统信息覆盖。 */
export function attachObservedRequest(error: unknown, observed: {
  model?: string; protocol?: FailureDiagnostic['protocol']; stream?: boolean; preset?: FailureDiagnostic['preset'];
  relayEnabled?: boolean; relayUsed?: boolean; httpStatus?: number; timeoutSeconds?: number; elapsedMs?: number;
  bytes?: number; finishReason?: string; complete?: boolean; phase?: FailureDiagnostic['phase']; errorInBody?: boolean;
  contentChars?: number; reasoningChars?: number; parseInputChars?: number;
}) {
  const existing = readFailureDiagnostic(error);
  const model = observed.model === undefined ? undefined
    : /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,199}$/.test(observed.model) ? observed.model : 'unknown';
  const finish = observed.finishReason?.toLowerCase();
  const finishReason = finish && finishToken.test(finish) ? finish : finish ? 'unrecognized' as const : undefined;
  const httpStatus = typeof observed.httpStatus === 'number' && observed.httpStatus >= 100 && observed.httpStatus <= 599
    ? Math.trunc(observed.httpStatus) : undefined;
  attachFailureDiagnostic(error, {
    ...(model ? { model } : {}),
    ...(observed.protocol ? { protocol: observed.protocol } : {}),
    ...(observed.stream !== undefined ? { stream: observed.stream } : {}),
    ...(observed.preset ? { preset: observed.preset } : {}),
    ...(observed.relayEnabled !== undefined ? { relayEnabled: observed.relayEnabled } : {}),
    ...(observed.relayUsed !== undefined ? { relayUsed: observed.relayUsed } : {}),
    ...(httpStatus !== undefined && existing?.httpStatus === undefined ? { httpStatus, httpError: httpStatus < 200 || httpStatus >= 300 } : {}),
    ...(safeCount(observed.timeoutSeconds) !== undefined ? { timeoutSeconds: safeCount(observed.timeoutSeconds) } : {}),
    ...(safeCount(observed.elapsedMs) !== undefined ? { elapsedMs: safeCount(observed.elapsedMs) } : {}),
    ...(safeCount(observed.bytes) !== undefined ? { bytes: safeCount(observed.bytes) } : {}),
    ...(finishReason && !existing?.finishReason ? { finishReason } : {}),
    ...(observed.complete !== undefined && existing?.complete === undefined ? { complete: observed.complete } : {}),
    ...(observed.phase && !existing?.phase ? { phase: observed.phase } : {}),
    ...(observed.errorInBody !== undefined && existing?.errorInBody === undefined ? { errorInBody: observed.errorInBody } : {}),
    ...(safeCount(observed.contentChars) !== undefined && existing?.contentChars === undefined ? { contentChars: safeCount(observed.contentChars) } : {}),
    ...(safeCount(observed.reasoningChars) !== undefined && existing?.reasoningChars === undefined ? { reasoningChars: safeCount(observed.reasoningChars) } : {}),
    ...(safeCount(observed.parseInputChars) !== undefined && existing?.parseInputChars === undefined ? { parseInputChars: safeCount(observed.parseInputChars) } : {}),
  });
}

const tags = storyTagNames;
function tagFacts(text: string, tag: (typeof tags)[number], required: boolean, previous: number) {
  const open = text.indexOf(`<${tag}>`);
  const close = text.indexOf(`</${tag}>`);
  const duplicate = text.split(`<${tag}>`).length > 2 || text.split(`</${tag}>`).length > 2;
  const malformed = new RegExp(`<[^<>\\p{L}\\p{N}]*${tag}`, 'iu').test(text) && open < 0 && close < 0;
  const order = open < 0 ? 'missing' as const : previous >= 0 && open < previous ? 'early' as const : 'ok' as const;
  return { tag, required, open: open >= 0, close: close >= 0, duplicate, malformed, order, at: open };
}
export function scanStoryTags(text: string, actions: boolean) {
  let previous = -1;
  return tags.map(tag => {
    const required = tag === '正文' || tag === '短期记忆' || (tag === '行动选项' && actions);
    const fact = tagFacts(text, tag, required, previous);
    const { at, ...scan } = fact;
    if (fact.open && at > previous) previous = at;
    return scan;
  });
}
export function reasoningTagPresence(text: string) {
  return tags.map(tag => ({ tag, present: text.includes(`<${tag}>`) || text.includes(`</${tag}>`) }));
}

export function noteRetryDecision(error: unknown, settings: Settings, attempt: number, plan: RetryDecision, eligible: boolean) {
  const extended = settings.runtime.failureAutoRetry === true;
  const max = extended ? Math.min(3, settings.runtime.maxAutoRetries) : 1;
  let stop: (typeof retryStops)[number] | undefined;
  if (plan.action === 'stop') {
    const field = error instanceof AiError ? error.details?.fieldPath : undefined;
    if (plan.reason === 'budget') stop = 'budget';
    else if (plan.reason === 'retry_after') stop = 'retry_after';
    else if (error instanceof AiError && error.code === 'cancelled') stop = 'cancelled';
    else if (error instanceof AiError && error.details?.quota === true) stop = 'quota';
    else if (error instanceof AiError && manualRetryOnly.has(error) && field?.startsWith('channel.relay')) stop = 'relay_manual';
    else if (error instanceof AiError && (manualRetryOnly.has(error) || field?.startsWith('tavern.'))) stop = 'tavern_manual';
    else if (error instanceof AiError && programCodes.has(error.code)) stop = 'program';
    else if (!extended) stop = 'disabled';
    else stop = 'not_retryable';
  }
  attachFailureDiagnostic(error, {
    retry: {
      extended, attempt, max, eligible, scheduled: plan.action === 'wait', stop,
      ...(plan.action === 'wait' ? { waitMs: plan.ms } : {}),
    },
  });
}

export function failurePhase(fieldPath?: string, deadline?: string): (typeof failurePhases)[number] | undefined {
  if (deadline === 'request_preparation') return 'request_build';
  if (deadline === 'awaiting_headers') return 'awaiting_headers';
  if (deadline === 'awaiting_bytes') return 'awaiting_bytes';
  if (deadline === 'upstream_read' || deadline === 'upstream_incomplete') return 'upstream_read';
  if (deadline === 'wrapper_restore') return 'wrapper_restore';
  if (!fieldPath) return undefined;
  if (fieldPath.startsWith('tavern.initialization') || fieldPath === 'tavern.shouldRegister' || fieldPath === 'tavern.refresh_required') return 'preset_init';
  if (fieldPath === 'tavern.upstream.error') return 'upstream_error';
  if (fieldPath.startsWith('tavern.upstream.tool') || fieldPath === 'tavern.unhandled_tool' || fieldPath === 'tavern.upstream.tool') return 'tool_parse';
  if (fieldPath.startsWith('tavern.upstream.') || fieldPath === 'tavern.wrapper.missing_finish') return 'upstream_read';
  if (fieldPath.startsWith('tavern.wrapper') || fieldPath.startsWith('tavern.native_delivery')) return 'wrapper_restore';
  if (fieldPath.startsWith('channel.relay')) return 'upstream_connect';
  if (fieldPath.startsWith('text.') || fieldPath.startsWith('story')) return 'story_validation';
  return undefined;
}

export function failureDiagnosticSummary(diagnostic: FailureDiagnostic) {
  const parts = [
    diagnostic.phase ? `环节：${phaseNames[diagnostic.phase]}` : '环节：未知',
    diagnostic.upstreamClass ? `上游：${classNames[diagnostic.upstreamClass]}` : undefined,
    diagnostic.httpStatus ? `HTTP ${diagnostic.httpStatus}` : undefined,
    diagnostic.errorInBody === true && diagnostic.httpError === false ? 'HTTP 成功响应里带有错误对象' : undefined,
    diagnostic.errorInBody === true && diagnostic.httpError === true ? 'HTTP 错误响应里带有错误对象' : undefined,
    diagnostic.errorInBody === true && diagnostic.httpError === undefined ? '看到错误对象，HTTP 状态未知' : undefined,
    diagnostic.relayUsed === true ? '本次经过中转' : diagnostic.relayEnabled === true ? '允许中转，本次未经过中转' : diagnostic.relayEnabled === false ? '未开启自动中转' : undefined,
    diagnostic.retry ? (diagnostic.retry.scheduled
      ? `已安排自动重试，本次是第 ${diagnostic.retry.attempt} 次请求`
      : `未再自动重试：${diagnostic.retry.stop ? stopNames[diagnostic.retry.stop] : '未知'}`) : undefined,
    diagnostic.retry?.recovered === true ? '后续重试已恢复' : undefined,
  ];
  return parts.filter(Boolean).join('。') + '。';
}

export function publicDiagnosticLabels() {
  return { phaseNames, classNames, stopNames };
}
