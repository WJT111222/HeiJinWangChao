import { z } from 'zod';
import { GENERATION_TRIGGERS, IdentifierSchema } from './schema';
import { DEFAULT_TRIGGER_SETTINGS, type TriggerSettings } from './trigger';

/**
 * 触发请求（跨 Worker 边界的消息格式）与资源上限。
 *
 * 引擎本身（runWorldbookTrigger）接受任意设置，单元测试会用极大的工作量上限；
 * 正式生成一律经过这里：书按（书 ID、版本 ID、内容哈希）引用，由 Worker 从本地书库读取；
 * 工作量上限封顶；书数、条目数、消息量都有上限；超时有范围。
 * 函数类钩子（自定义 Token 估算、宏替换）不能跨越 Worker 边界，正式请求不支持（宏在正文集成阶段另行设计）。
 */
export const TRIGGER_RESOURCE_LIMITS = {
  /** 工作量上限的封顶值：重标定后约 0.5 秒（桌面）；建索引结点 ≤ 约 77 万个，内存有界。 */
  maxScanWorkCeiling: 500_000_000,
  maxBooks: 16,
  maxTotalEntries: 200_000,
  maxMessages: 1_000,
  maxMessageChars: 1_000_000,
  timeoutMs: { min: 200, default: 5_000, max: 30_000 },
} as const;

/**
 * 无法创建 Worker 时，允许在主线程运行的规模（已做 CPU 降速 6× 实测，见 docs/WORLDBOOK_COMPATIBILITY.md）。
 * 超过任何一项就暂停世界书触发，不在主线程运行。
 */
export const MAIN_THREAD_FALLBACK_LIMITS = {
  maxTotalEntries: 100,
  maxKeyChars: 10_000,
  maxContentChars: 50_000,
  maxMessageChars: 10_000,
  maxScanWork: 2_000_000,
} as const;

export const BookRefSchema = z.strictObject({
  keywordsOnly: z.boolean().optional(),
  bookId: IdentifierSchema,
  versionId: IdentifierSchema,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BookRef = z.infer<typeof BookRefSchema>;

const TimedRecordSchema = z.strictObject({ fingerprint: z.string().max(64), start: z.number().int(), end: z.number().int(), protected: z.boolean() });
const SettingsSchema = z.strictObject({
  scanDepth: z.number().int().optional(), budgetPercent: z.number().optional(), budgetCap: z.number().optional(), recursive: z.boolean().optional(),
  caseSensitive: z.boolean().optional(), matchWholeWords: z.boolean().optional(), useGroupScoring: z.boolean().optional(),
  maxRecursionSteps: z.number().int().optional(), minActivations: z.number().int().optional(), minActivationsDepthMax: z.number().int().optional(),
  maxScanWork: z.number().positive().optional(),
}).optional();

export const WorkerTriggerRequestSchema = z.strictObject({
  books: z.array(BookRefSchema).max(TRIGGER_RESOURCE_LIMITS.maxBooks),
  messages: z.array(z.string()).max(TRIGGER_RESOURCE_LIMITS.maxMessages),
  contextTokens: z.number().nonnegative(),
  storyRemainingTokens: z.number().nonnegative(),
  trigger: z.enum(GENERATION_TRIGGERS),
  messageCount: z.number().int().nonnegative(),
  timedState: z.strictObject({ sticky: z.record(z.string(), TimedRecordSchema), cooldown: z.record(z.string(), TimedRecordSchema) }),
  seed: z.string().max(500),
  settings: SettingsSchema,
});
export type WorkerTriggerRequest = z.infer<typeof WorkerTriggerRequestSchema>;

export type RequestCheck =
  | { ok: true; request: WorkerTriggerRequest; maxScanWork: number }
  | { ok: false; reason: 'invalid' | 'too_large'; detail: string };

/** 校验请求格式与资源上限，并算出实际使用的工作量上限（封顶）。 */
export function checkTriggerRequest(raw: unknown): RequestCheck {
  const parsed = WorkerTriggerRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((issue) => issue.code === 'too_big');
    return { ok: false, reason: tooMany ? 'too_large' : 'invalid', detail: parsed.error.issues[0]?.path.join('.') ?? '' };
  }
  const request = parsed.data;
  let chars = 0;
  for (const message of request.messages) chars += message.length;
  if (chars > TRIGGER_RESOURCE_LIMITS.maxMessageChars) return { ok: false, reason: 'too_large', detail: 'messages' };
  const keys = new Set<string>();
  for (const ref of request.books) {
    if (keys.has(ref.bookId)) return { ok: false, reason: 'invalid', detail: `books：重复的书 ${ref.bookId}` };
    keys.add(ref.bookId);
  }
  const wanted = request.settings?.maxScanWork ?? DEFAULT_TRIGGER_SETTINGS.maxScanWork;
  return { ok: true, request, maxScanWork: Math.min(wanted, TRIGGER_RESOURCE_LIMITS.maxScanWorkCeiling) };
}

/** 超时毫秒数限定在允许范围内。 */
export function clampTimeout(ms: number | undefined): number {
  const { min, max } = TRIGGER_RESOURCE_LIMITS.timeoutMs;
  if (ms === undefined || !Number.isFinite(ms)) return TRIGGER_RESOURCE_LIMITS.timeoutMs.default;
  return Math.min(max, Math.max(min, Math.round(ms)));
}

/** 正式请求的引擎设置：工作量上限已封顶。 */
export function engineSettings(check: Extract<RequestCheck, { ok: true }>): Partial<TriggerSettings> {
  return { ...check.request.settings, maxScanWork: check.maxScanWork };
}
