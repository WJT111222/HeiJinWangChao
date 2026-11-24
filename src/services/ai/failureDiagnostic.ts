import { z } from 'zod';
import { PRODUCT_VERSION } from '../../app/product';
import { modelIdSchema } from './configuration';
import { browserCredentials } from './credentials';
import { manualRetryOnly, AiError } from './errors';
import { redactInspection, requestInspections } from './inspection';
import { secretFor, type RequestSnapshot } from './snapshot';
import { cleanFeedbackText, containsPrivateDump } from '../feedback/textSafety';
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
  nested: z.boolean().optional(),
  order: z.enum(['ok', 'early', 'missing', 'unknown']),
});
export const failureDiagnosticSchema = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9 ._+-]{1,40}$/),
  build: z.union([z.string().regex(/^[0-9a-f]{40}$/), z.enum(['development', 'unavailable', 'unknown'])]).optional(),
  model: z.union([modelIdSchema, z.literal('unknown')]).optional(),
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
  extractedChars: count.optional(),
  parseInputChars: count.optional(),
  complete: z.boolean().optional(),
  phase: z.enum(failurePhases).optional(),
  upstreamClass: z.enum(upstreamClasses).optional(),
  upstreamCode: z.string().regex(token).optional(),
  upstreamType: z.string().regex(token).optional(),
  storyTags: z.array(tagScan).max(5).optional(),
  extractedTags: z.array(tagScan).max(5).optional(),
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
    issued: z.boolean().optional(),
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
const urlText = /[a-z][a-z0-9+.-]*:\/\//i;
function knownCode(token: string) {
  const key = token.toLowerCase();
  return Object.hasOwn(classByToken, key) ? key : undefined;
}
/** 模型名沿用配置校验。同时对照当前本地密钥和本次请求快照里的凭证；任一命中就丢掉这一项。 */
export function publishDiagnosticModel(model: string, sanitize?: (value: string) => string | undefined, secrets?: readonly string[]) {
  if (model === 'unknown') return 'unknown';
  if (containsPrivateDump(model) || urlText.test(model) || !modelIdSchema.safeParse(model).success) return undefined;
  const cleaned = redactInspection(cleanFeedbackText(model), [...browserCredentials(), ...(secrets ?? [])]);
  if (cleaned !== model) return undefined;
  const ids = requestInspections.getSnapshot().flatMap(record => [record.scope?.saveId, record.id, record.scope?.responseId])
    .filter((id): id is string => Boolean(id && id.length >= 6));
  if (ids.some(id => model.includes(id))) return undefined;
  if (sanitize && sanitize(model) !== model) return undefined;
  return model;
}
function acceptDiagnostic(value: Record<string, unknown>) {
  const current = { ...value };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const parsed = failureDiagnosticSchema.safeParse(current);
    if (parsed.success) return parsed.data;
    const key = parsed.error.issues[0]?.path?.[0];
    if (typeof key !== 'string' || !Object.hasOwn(current, key)) return undefined;
    delete current[key];
  }
  return undefined;
}
export function readFailureDiagnostic(error: unknown) {
  return typeof error === 'object' && error !== null ? attached.get(error) : undefined;
}
export function carryFailureDiagnostic(from: unknown, to: unknown) {
  const diagnostic = readFailureDiagnostic(from);
  if (!diagnostic || typeof to !== 'object' || to === null || to === from) return;
  if (!readFailureDiagnostic(to)) attached.set(to, diagnostic);
  else attachFailureDiagnostic(to, diagnostic);
}
export function diagnosticSecrets(snapshot: RequestSnapshot) {
  try { return [secretFor(snapshot)]; }
  catch { return []; }
}
export function attachFailureDiagnostic(error: unknown, patch: Partial<FailureDiagnostic>, secrets?: readonly string[]) {
  if (typeof error !== 'object' || error === null) return;
  const previous = attached.get(error);
  const retry = patch.retry || previous?.retry ? { ...previous?.retry, ...defined(patch.retry ?? {}) } : undefined;
  const preferred = typeof patch.model === 'string' ? patch.model : previous?.model;
  const model = typeof preferred === 'string' ? publishDiagnosticModel(preferred, undefined, secrets) : undefined;
  const keptModel = model ?? (preferred !== previous?.model && previous?.model ? publishDiagnosticModel(previous.model, undefined, secrets) : undefined);
  const upstreamCode = knownCode(patch.upstreamCode ?? previous?.upstreamCode ?? '');
  const upstreamType = knownCode(patch.upstreamType ?? previous?.upstreamType ?? '');
  const merged = acceptDiagnostic({
    version: PRODUCT_VERSION,
    build: observedBuild(),
    ...previous,
    ...defined(patch),
    ...(keptModel ? { model: keptModel } : {}),
    ...(retry ? { retry } : {}),
    ...(patch.storyTags ? { storyTags: patch.storyTags } : {}),
    ...(patch.extractedTags ? { extractedTags: patch.extractedTags } : {}),
    ...(patch.parseTags ? { parseTags: patch.parseTags } : {}),
    ...(patch.reasoningTags ? { reasoningTags: patch.reasoningTags } : {}),
    ...(patch.recovery ? { recovery: patch.recovery } : {}),
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(upstreamType && upstreamType !== upstreamCode ? { upstreamType } : {}),
  });
  if (!merged) return;
  if (!keptModel) delete merged.model;
  if (!upstreamCode) delete merged.upstreamCode;
  if (!upstreamType || upstreamType === upstreamCode) delete merged.upstreamType;
  const parsed = failureDiagnosticSchema.safeParse(merged);
  if (parsed.success) attached.set(error, parsed.data);
}
export function safeFailureDiagnostic(error: unknown) {
  const current = readFailureDiagnostic(error);
  return current && failureDiagnosticSchema.safeParse(current).success ? current : undefined;
}
/** 上报前再过一遍脱敏。某个文本字段不合格就去掉它，其余诊断保留。 */
export function presentFailureDiagnostic(diagnostic: FailureDiagnostic | undefined, sanitize?: (value: string) => string | undefined) {
  if (!diagnostic) return undefined;
  const model = diagnostic.model ? publishDiagnosticModel(diagnostic.model, sanitize) : undefined;
  const upstreamCode = diagnostic.upstreamCode ? knownCode(diagnostic.upstreamCode) : undefined;
  const upstreamType = diagnostic.upstreamType ? knownCode(diagnostic.upstreamType) : undefined;
  const next: FailureDiagnostic = { ...diagnostic };
  if (model) next.model = model;
  else delete next.model;
  if (upstreamCode) next.upstreamCode = upstreamCode;
  else delete next.upstreamCode;
  if (upstreamType && upstreamType !== upstreamCode) next.upstreamType = upstreamType;
  else delete next.upstreamType;
  return failureDiagnosticSchema.safeParse(next).success ? next : acceptDiagnostic(next);
}

function tokenOf(value: unknown) {
  return typeof value === 'string' && token.test(value) ? value : undefined;
}
/** 从已经拿到的 JSON 里摘白名单代码。不读 message、URL 或任意长文本。 */
export function classifyUpstreamPayload(value: unknown, observed: { transport: 'json' | 'sse' | 'http'; httpStatus?: number; errorEvent?: boolean }): Partial<FailureDiagnostic> {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const error = data?.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : undefined;
  const tokens = [error?.code, error?.type, data?.code, data?.type].map(tokenOf).filter((item): item is string => Boolean(item));
  let upstreamClass: (typeof upstreamClasses)[number] | undefined;
  let upstreamCode: string | undefined;
  for (const item of tokens) {
    const code = knownCode(item);
    const known = code ? classByToken[code] : undefined;
    if (known) { upstreamClass = known; upstreamCode = code; break; }
  }
  const errorInBody = Boolean(error || data?.error || data?.type === 'error' || observed.errorEvent);
  if (!upstreamClass && errorInBody) upstreamClass = tokens.length ? 'unrecognized' : 'unknown';
  const upstreamType = tokens.map(item => knownCode(item)).find(code => code && code !== upstreamCode);
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
}, secrets?: readonly string[]) {
  const existing = readFailureDiagnostic(error);
  const finish = observed.finishReason?.toLowerCase();
  const finishReason = finish && finishToken.test(finish) ? finish : finish ? 'unrecognized' as const : undefined;
  const httpStatus = typeof observed.httpStatus === 'number' && observed.httpStatus >= 100 && observed.httpStatus <= 599
    ? Math.trunc(observed.httpStatus) : undefined;
  attachFailureDiagnostic(error, {
    ...(observed.model ? { model: observed.model } : {}),
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
  }, secrets);
}

const tags = storyTagNames;
function tagFacts(text: string, tag: (typeof tags)[number], required: boolean, previous: { open: number; close: number }) {
  const open = text.indexOf(`<${tag}>`);
  const close = text.indexOf(`</${tag}>`);
  const duplicate = text.split(`<${tag}>`).length > 2 || text.split(`</${tag}>`).length > 2;
  const spelled = new RegExp(`<[^<>\\p{L}\\p{N}]*${tag}`, 'iu').test(text) && open < 0 && close < 0;
  const oneSided = (open >= 0) !== (close >= 0);
  const bounded = previous.open >= 0 && previous.close > previous.open;
  const inside = bounded && open > previous.open && close > open && close < previous.close;
  const crosses = bounded && open >= 0 && close > open && open < previous.close && close > previous.open && !inside;
  const start = open >= 0 ? open : close;
  let order: 'ok' | 'early' | 'missing' | 'unknown' = 'ok';
  if (start < 0) order = 'missing';
  else if ((previous.open >= 0 && start < previous.open) || crosses || (open >= 0 && close >= 0 && close < open)) order = 'early';
  else if (previous.close >= 0 && !inside && start < previous.close) order = 'early';
  return { tag, required, open: open >= 0, close: close >= 0, duplicate, malformed: oneSided || spelled, nested: inside, order, at: start, end: close >= 0 ? close : open };
}
export function scanStoryTags(text: string, actions: boolean) {
  const previous = { open: -1, close: -1 };
  return tags.map(tag => {
    const required = tag === '正文' || tag === '短期记忆' || (tag === '行动选项' && actions);
    const fact = tagFacts(text, tag, required, previous);
    if (fact.open && fact.close && fact.end >= previous.close) {
      previous.open = fact.at;
      previous.close = fact.end;
    } else if (!fact.nested && fact.end > previous.close) {
      previous.open = fact.at;
      previous.close = fact.end;
    }
    return {
      tag: fact.tag, required: fact.required, open: fact.open, close: fact.close,
      duplicate: fact.duplicate, malformed: fact.malformed, nested: fact.nested, order: fact.order,
    };
  });
}
export function reasoningTagPresence(text: string) {
  return tags.map(tag => ({ tag, present: text.includes(`<${tag}>`) || text.includes(`</${tag}>`) }));
}

export function noteRetryDecision(error: unknown, settings: Settings, attempt: number, plan: RetryDecision, eligible: boolean) {
  const extended = settings.runtime.failureAutoRetry === true;
  const max = extended ? Math.min(3, settings.runtime.maxAutoRetries) : 1;
  const seen = readFailureDiagnostic(error);
  const field = error instanceof AiError ? error.details?.fieldPath : undefined;
  const relayUsed = seen?.relayUsed === true;
  let stop: (typeof retryStops)[number] | undefined;
  if (plan.action === 'stop') {
    const manual = error instanceof AiError && manualRetryOnly.has(error);
    if (plan.reason === 'budget') stop = 'budget';
    else if (plan.reason === 'retry_after') stop = 'retry_after';
    else if (error instanceof AiError && error.code === 'cancelled') stop = 'cancelled';
    else if (error instanceof AiError && error.details?.quota === true) stop = 'quota';
    else if ((field?.startsWith('tavern.') || seen?.preset === 'native' || seen?.preset === 'script') && (manual || Boolean(field?.startsWith('tavern.')))) stop = 'tavern_manual';
    else if (manual && (Boolean(field?.startsWith('channel.relay')) || relayUsed)) stop = 'relay_manual';
    else if (error instanceof AiError && programCodes.has(error.code)) stop = 'program';
    else if (!extended) stop = 'disabled';
    else stop = 'not_retryable';
  }
  const scheduled = plan.action === 'wait';
  attachFailureDiagnostic(error, {
    retry: {
      extended, attempt, max, eligible, scheduled, ...(scheduled ? { issued: false } : {}), stop,
      ...(plan.action === 'wait' ? { waitMs: plan.ms } : {}),
    },
  });
}
/** 下一次重试尝试开始时标记。只表示尝试已经开始，不表示网络请求已经发出。取消或保存失败不会走到这里。 */
export function markRetryIssued(error: unknown) {
  const diagnostic = readFailureDiagnostic(error);
  if (!diagnostic?.retry?.scheduled || diagnostic.retry.issued === true) return;
  diagnostic.retry.issued = true;
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
    diagnostic.retry ? (diagnostic.retry.issued
      ? `已开始重试尝试，本次是第 ${diagnostic.retry.attempt} 次`
      : diagnostic.retry.scheduled
        ? '已计划自动重试，下一次尝试尚未开始'
        : `未再自动重试：${diagnostic.retry.stop ? stopNames[diagnostic.retry.stop] : '未知'}`) : undefined,
    diagnostic.retry?.recovered === true ? '同一次自动重试已恢复' : undefined,
  ];
  return parts.filter(Boolean).join('。') + '。';
}

export function publicDiagnosticLabels() {
  return { phaseNames, classNames, stopNames };
}
