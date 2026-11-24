import { z } from 'zod';
import { DataError } from '../domain/common';
import { memoryDiagnosticSchema } from '../domain/memories/diagnostics';
import type { MemoryDiagnostic } from '../domain/memories/diagnostics';
import { summaryKinds } from '../domain/memories/configuration';
import type { SummaryKind } from '../domain/memories/configuration';
import type { GameState } from '../domain/state';
import { AiError, safeAiError } from '../services/ai/errors';

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
const scope = { kind: z.enum(summaryKinds), npcId: z.string().optional(), identityKey: z.string().optional(), diagnostic: memoryDiagnosticSchema.optional().catch(undefined) };
const code = z.string().regex(/^[a-z_]+$/i);
const pendingSchema = z.strictObject({
  ...scope, status: z.literal('pending'), code, manual: z.boolean().optional(), retryId: z.string(), resultId: z.string(),
  sourceIds: z.array(z.string()), previousIds: z.array(z.string()).optional(),
  turnIds: z.array(z.string()).optional(), previousTurnIds: z.array(z.string()).optional(), legacyRetryId: z.string().optional(),
});
const preflightSchema = z.strictObject({ ...scope, status: z.literal('preflight'), code, manual: z.boolean().optional() });
const recordsSchema = z.array(z.discriminatedUnion('status', [pendingSchema, preflightSchema])).refine(entries =>
  entries.every(item => item.status !== 'pending' || item.sourceIds.length > 0 || Boolean(item.turnIds?.length)));
const legacySchema = z.array(z.object({ kind: z.enum(summaryKinds), code, npcId: z.string().optional() }));
export type SummaryRecord = z.infer<typeof recordsSchema>[number];
export type PendingSummary = Omit<z.infer<typeof pendingSchema>, 'sourceIds' | 'resultId'> & {
  sourceIds?: string[]; resultId?: string; legacy?: true;
};

export type SummaryIssue = {
  kind: SummaryKind; code: string; message: string; diagnostic?: MemoryDiagnostic; npcId?: string; identityKey?: string; pending?: boolean; retryId?: string; legacy?: true; manual?: boolean;
};

export const unconfirmedSummaryMessage = '有未确认保存的请求，可能已计费。发送行动不会自动重试，须由你确认重新生成。';
export const legacyBatchUnverifiableMessage = '旧记录缺少可核验的结果 ID，无法安全恢复原批。待确认记录仍保留。';
export const legacyBatchMismatchMessage = '当前批次与旧记录不一致，未发送请求。请核对原批条数和来源，待确认记录仍保留。';
export const hasLegacySummaryFingerprint = (id?: string) => id !== undefined && /^memory-[0-9a-f]{64}$/.test(id);
export const summaryAttemptKey = (state: GameState, kind: SummaryKind) =>
  `heijin.summary.attempt:${state.saveId}:${state.createdAt}:${kind}`;
export const summaryRecordsKey = (state: GameState) => `heijin.summary.records:${state.saveId}:${state.createdAt}`;
const legacyKey = (state: GameState) => `heijin.summary.failures:${state.saveId}`;
const fingerprintDiagnostic = (diagnostic?: MemoryDiagnostic) => JSON.stringify(diagnostic && { ...diagnostic, requestedAt: undefined });
const storageError = () => new DataError('MEMORY_STORAGE', '无法核对总结请求记录，未发起新请求。');

function read<T>(storage: StorageAccess, key: string, schema: z.ZodType<T>) {
  try { return schema.parse(JSON.parse(storage.getItem(key) ?? '[]')); }
  catch { throw storageError(); }
}
function put(storage: StorageAccess, key: string, value: unknown) {
  try { storage.setItem(key, JSON.stringify(value)); }
  catch { throw storageError(); }
}
function legacyFailureIsPreflight(code: string) {
  return ['MEMORY_BUDGET', 'MEMORY_LOCK_UNAVAILABLE', 'MEMORY_SOURCE', 'MEMORY_PERMISSION'].includes(code);
}
function storedLegacy(storage: StorageAccess, state: GameState, kind: SummaryKind, failures: z.infer<typeof legacySchema>): PendingSummary | undefined {
  const resultId = storage.getItem(summaryAttemptKey(state, kind)) || undefined;
  const failure = failures.find(item => item.kind === kind);
  if (!resultId && (!failure || legacyFailureIsPreflight(failure.code))) return;
  return {
    status: 'pending', kind, npcId: failure?.npcId, code: 'MEMORY_PREVIOUS', resultId, legacy: true,
    retryId: JSON.stringify(resultId ? ['legacy', kind, resultId] : ['legacy', kind, failure?.npcId, failure?.code]),
  };
}
function hasResult(state: GameState, item: PendingSummary) {
  const id = item.resultId;
  if (!id || (item.legacy && !hasLegacySummaryFingerprint(id))) return false;
  if (item.kind !== 'npc') return [...state.memories.medium, ...state.memories.long].some(entry => entry.id === id);
  return Object.entries(state.memories.npcSummaries).some(([npcId, entries]) =>
    (!item.npcId || npcId === item.npcId) && entries.some(entry => entry.id.startsWith(id + '-') &&
      (!item.identityKey || entry.npcProvenance?.identityKey === item.identityKey)));
}

/** Writes are confined to the per-save memory lock. Read-only callers receive snapshots. */
export class SummaryRecords {
  private entries: SummaryRecord[];
  private oldFailures: z.infer<typeof legacySchema>;
  constructor(private storage: StorageAccess, private state: GameState) {
    this.entries = read(storage, summaryRecordsKey(state), recordsSchema);
    this.oldFailures = read(storage, legacyKey(state), legacySchema);
  }
  get pending(): PendingSummary[] {
    const legacy = summaryKinds.map(kind => storedLegacy(this.storage, this.state, kind, this.oldFailures)).filter(item => item !== undefined);
    const recorded = this.entries.filter(item => item.status === 'pending');
    return [...recorded, ...legacy.filter(item => !recorded.some(entry => entry.legacyRetryId === item.retryId))];
  }
  get unresolved() { return this.pending.filter(item => !hasResult(this.state, item)); }
  get issues() {
    const pending = this.unresolved.filter(item => {
      const entries = item.kind === 'npc' ? Object.values(this.state.npc).flatMap(person => person.memories) : this.state.memories[item.kind];
      return intersectsSources(item, entries);
    });
    const legacyPreflight = this.oldFailures.filter(item => legacyFailureIsPreflight(item.code) && !pending.some(entry => entry.kind === item.kind));
    return [...pending, ...this.entries.filter(item => item.status === 'preflight'), ...legacyPreflight].map(item => summaryIssue(item));
  }
  private write(entries: SummaryRecord[]) {
    put(this.storage, summaryRecordsKey(this.state), entries);
    this.entries = entries;
  }
  clearPreflight(kind: SummaryKind, npcId?: string) {
    const entries = this.entries.filter(item => item.status !== 'preflight' || item.kind !== kind || item.npcId !== npcId);
    if (entries.length !== this.entries.length) this.write(entries);
    const old = this.oldFailures.find(item => item.kind === kind && legacyFailureIsPreflight(item.code));
    if (old && (!old.npcId || old.npcId === npcId) && !this.storage.getItem(summaryAttemptKey(this.state, kind))) this.clearLegacyFailure(kind);
  }
  preflight(item: z.infer<typeof preflightSchema>) {
    if (this.entries.some(entry => entry.status === 'preflight' && entry.kind === item.kind && entry.npcId === item.npcId && entry.code === item.code && entry.identityKey === item.identityKey &&
      fingerprintDiagnostic(entry.diagnostic) === fingerprintDiagnostic(item.diagnostic))) return;
    this.write([...this.entries.filter(entry => entry.status !== 'preflight' || entry.kind !== item.kind || entry.npcId !== item.npcId), item]);
  }
  begin(item: z.infer<typeof pendingSchema>, previous?: PendingSummary) {
    this.write([...this.entries.filter(entry => entry.status === 'pending' ? entry.retryId !== previous?.retryId :
      entry.kind !== item.kind || entry.npcId !== item.npcId), item]);
  }
  fail(retryId: string, code: string, diagnostic?: MemoryDiagnostic) {
    this.write(this.entries.map(item => item.status === 'pending' && item.retryId === retryId ? { ...item, code, diagnostic } : item));
  }
  recover() {
    for (const item of this.pending) if (hasResult(this.state, item)) this.confirm(item);
  }
  confirm(item: PendingSummary) {
    const legacy = storedLegacy(this.storage, this.state, item.kind, this.oldFailures);
    if (legacy && (item.retryId === legacy.retryId || item.legacyRetryId === legacy.retryId)) {
      // Keep at least one blocker if acknowledging either legacy key is interrupted.
      this.clearLegacyFailure(item.kind);
      this.storage.setItem(summaryAttemptKey(this.state, item.kind), '');
    }
    if (!item.legacy) this.clearPreflight(item.kind, item.npcId);
    if (!item.legacy) this.write(this.entries.flatMap(entry => {
      if (entry.status !== 'pending' || entry.retryId !== item.retryId) return [entry];
      // A rewind can temporarily remove part of a paid batch. Retain those IDs if they reappear.
      if (entry.previousIds?.length || entry.previousTurnIds?.length) return [{
        ...entry, sourceIds: entry.previousIds ?? [], turnIds: entry.previousTurnIds,
        previousIds: undefined, previousTurnIds: undefined, resultId: '', legacyRetryId: undefined,
      }];
      return [];
    }));
  }
  private clearLegacyFailure(kind: SummaryKind) {
    const failures = this.oldFailures.filter(item => item.kind !== kind);
    if (failures.length !== this.oldFailures.length) put(this.storage, legacyKey(this.state), failures);
    this.oldFailures = failures;
  }
}

type SourceEntry = { id: string; sourceTurnIds: string[] };
function intersectsSources(item: PendingSummary, entries: readonly SourceEntry[]) {
  if (!item.sourceIds) return true; // A legacy record cannot prove a different batch.
  const ids = new Set([...item.sourceIds, ...(item.previousIds ?? [])]);
  const turns = new Set(item.kind === 'npc' ? [] : [...(item.turnIds ?? []), ...(item.previousTurnIds ?? [])]);
  return entries.some(entry => ids.has(entry.id) || entry.sourceTurnIds.some(turn => turns.has(turn)));
}
export function pendingFor(records: SummaryRecords, kind: SummaryKind, entries: readonly SourceEntry[]) {
  return records.unresolved.filter(item => item.kind === kind && intersectsSources(item, entries));
}
export function authorizedSources(retry: PendingSummary, entries: readonly SourceEntry[]) {
  if (!retry.sourceIds) return;
  const ids = new Set([...retry.sourceIds, ...(retry.previousIds ?? [])]);
  const turns = new Set([...(retry.turnIds ?? []), ...(retry.previousTurnIds ?? [])]);
  return entries.filter(entry => retry.kind === 'npc' || !turns.size ? ids.has(entry.id) :
    entry.sourceTurnIds.length > 0 && entry.sourceTurnIds.every(turn => turns.has(turn))).map(entry => entry.id);
}

export function summaryIssue(item: { kind: SummaryKind; code: string; npcId?: string; identityKey?: string; status?: string; retryId?: string; resultId?: string; legacy?: true; manual?: boolean; diagnostic?: MemoryDiagnostic }): SummaryIssue {
  const reasons: Partial<Record<string, string>> = {
    MEMORY_STORAGE: '无法核对本地总结记录。请检查存储权限，再刷新重试。',
    MEMORY_LOCK_UNAVAILABLE: '浏览器不支持安全跨标签互斥，未发送请求。',
    MEMORY_OUTPUT: '模型返回的总结格式不完整或不合法。',
    MEMORY_BUDGET: '完整批次超出安全预算。请减少每批条数或缩短总结提示词。',
    MEMORY_CONFLICT: '记忆来源已改变或已被整理。',
    NPC_MEMORY_CONFLICT: '人物身份或记忆来源已改变。',
    MEMORY_PREVIOUS: unconfirmedSummaryMessage,
    MEMORY_TIMELINE_CHANGED: '时间线已变化，旧结果未保存。',
    MEMORY_PERMISSION: '总结输入未通过凭证保护检查。请检查总结提示词及渠道配置。',
    MEMORY_SOURCE: '记忆来源无法安全核对。',
    MEMORY_CHANGED: '配置或来源在准备期间更新，将在下次调度重新检查。',
    MEMORY_RETRY_CHANGED: '待处理请求已变化。请核对当前状态，再决定是否重新生成。',
    MEMORY_LEGACY_BATCH_UNVERIFIABLE: legacyBatchUnverifiableMessage,
    MEMORY_LEGACY_BATCH_MISMATCH: legacyBatchMismatchMessage,
  };
  const fallback = safeAiError(new AiError(item.code as ConstructorParameters<typeof AiError>[0])).message;
  const canCheckOriginal = !item.legacy || hasLegacySummaryFingerprint(item.resultId);
  const message = item.legacy
    ? '有未确认保存的请求，可能已计费。' + (canCheckOriginal ? '只有核对到原批后才会发送重试。' : legacyBatchUnverifiableMessage)
    : reasons[item.code] ?? (fallback && fallback !== 'undefined' ? fallback : '总结未完成，请检查设置和存档状态。');
  return {
    kind: item.kind, code: item.code, npcId: item.npcId, identityKey: item.identityKey,
    ...(item.diagnostic ? { diagnostic: item.diagnostic } : {}),
    message: message + (item.status === 'pending' && item.code !== 'MEMORY_PREVIOUS' ? ' 发送行动不会自动重试。' : ''),
    pending: item.status === 'pending', retryId: canCheckOriginal ? item.retryId : undefined, legacy: item.legacy, manual: item.manual,
  };
}
export const summaryErrorCode = (error: unknown) => error instanceof DataError ? error.code : safeAiError(error).code;
