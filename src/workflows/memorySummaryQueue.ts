import type { Settings } from '../ui/settings/model';
import type { GameState } from '../domain/state';
import { DataError } from '../domain/common';
import { summaryKinds, summaryNames } from '../domain/memories/configuration';
import type { SummaryKind } from '../domain/memories/configuration';
import { compressionCandidates } from '../domain/memories/compression';
import { npcSummaryCandidates, npcMemoryIdCounts } from '../domain/memories/npcMemory';
import { recoverCompletedSummary } from './memoryMaintenance';
import { safeAiError } from '../services/ai/errors';

export interface SummaryFailure { kind: SummaryKind; code: string; message: string; npcId?: string }
export interface SummaryQueueOptions {
  saveId: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  settings: () => Settings;
  load: () => Promise<GameState>;
  execute: (kind: SummaryKind, immediate: boolean, npcId?: string) => Promise<void>;
  changed: (failures: SummaryFailure[]) => void;
}
const safeReasons: Record<string, string> = {
  MEMORY_LOCK_UNAVAILABLE: '浏览器不支持安全跨标签互斥，未发起记忆请求。',
  MEMORY_OUTPUT: '模型没有返回完整、合法的总结结构，原始记忆保留。', MEMORY_BUDGET: '完整批次超出安全预算，未缩减来源。',
  MEMORY_CONFLICT: '公共来源已改变或已被整理，请重新核对。', NPC_MEMORY_CONFLICT: '人物身份或来源已改变，请重新核对。',
  MEMORY_PREVIOUS: '上次总结中断或未保存，请明确重新生成或暂停本项。',
};
/** Serial, bounded and fair across the three independent kinds. No autonomous retry after failure. */
export class MemorySummaryQueue {
  private failures: SummaryFailure[] = [];
  private tail = Promise.resolve();
  private queued = new Set<string>();
  private stopped = false;
  private cursor = 0;
  private npcCursor = '';
  private initialized = false;
  constructor(private options: SummaryQueueOptions) {}
  private key() { return `heijin.summary.failures:${this.options.saveId}`; }
  private publish() { this.options.changed([...this.failures]); }
  private initialize() {
    if (this.initialized) return;
    const raw = JSON.parse(this.options.storage.getItem(this.key()) || '[]') as unknown;
    if (Array.isArray(raw)) this.failures = raw.filter((entry): entry is SummaryFailure => Boolean(entry && typeof entry === 'object' &&
      summaryKinds.includes((entry as SummaryFailure).kind) && typeof (entry as SummaryFailure).code === 'string'))
      .map(entry => ({ kind: entry.kind, code: 'MEMORY_PREVIOUS', message: safeReasons.MEMORY_PREVIOUS, ...(typeof entry.npcId === 'string' ? { npcId: entry.npcId } : {}) }));
    const schedule = JSON.parse(this.options.storage.getItem(`heijin.summary.schedule:${this.options.saveId}`) || '{}') as { cursor?: number; npcCursor?: string };
    this.cursor = Number.isInteger(schedule.cursor) ? Math.abs(schedule.cursor!) % 3 : 0;
    this.npcCursor = typeof schedule.npcCursor === 'string' ? schedule.npcCursor : '';
    this.initialized = true; this.publish();
  }
  private remember(failure: SummaryFailure) {
    this.failures = [...this.failures.filter(entry => entry.kind !== failure.kind), failure];
    // Persist only type/code/target, never content or provider errors.
    try { this.options.storage.setItem(this.key(), JSON.stringify(this.failures.map(({ kind, code, npcId }) => ({ kind, code, npcId })))); }
    catch { /* The visible failure remains and the paid-attempt ledger fails closed. */ }
    this.publish();
  }
  private remove(kind: SummaryKind) {
    this.failures = this.failures.filter(entry => entry.kind !== kind);
    this.options.storage.setItem(this.key(), JSON.stringify(this.failures.map(({ kind, code, npcId }) => ({ kind, code, npcId }))));
    this.publish();
  }
  dismiss(kind: SummaryKind) { this.remove(kind); }
  stop() { this.stopped = true; }
  private enqueue(key: string, work: () => Promise<void>) {
    if (this.stopped || this.queued.has(key)) return this.tail;
    this.queued.add(key);
    this.tail = this.tail.then(async () => { if (!this.stopped) await work(); }).catch(() => { this.remember({ kind: 'short', code: 'MEMORY_STORAGE', message: '总结调度存储不可用，未发起新的总结。' }); })
      .finally(() => { this.queued.delete(key); });
    return this.tail;
  }
  private async attempt(kind: SummaryKind, immediate: boolean, npcId?: string) {
    try {
      await this.options.execute(kind, immediate, npcId);
      if (!this.stopped) this.remove(kind);
    } catch (error) {
      if (this.stopped || error instanceof DataError && ['MEMORY_BUSY', 'MEMORY_THROTTLED'].includes(error.code)) return;
      const safe = safeAiError(error), code = error instanceof DataError ? error.code : safe.code;
      this.remember({ kind, code, message: safeReasons[code] ?? safe.message, ...(npcId ? { npcId } : {}) });
    }
  }
  immediate(kind: SummaryKind, npcId?: string) {
    return this.enqueue(`manual:${kind}:${npcId ?? ''}`, async () => {
      this.initialize();
      if (kind === 'npc' && !npcId) { this.remember({ kind, code: 'NPC_MEMORY_CONFLICT', message: '请明确选择需要总结的人物。' }); return; }
      const pending = this.failures.find(failure => failure.kind === kind);
      if (kind === 'npc' && pending && pending.npcId !== npcId) {
        pending.message = '此前的人物总结失败尚未处理，当前选择未请求模型。请先处理原失败任务，或暂停本项自动总结后再手动选择其他人物。';
        this.publish(); return;
      }
      await this.attempt(kind, true, npcId);
    });
  }
  wake() {
    return this.enqueue('automatic', async () => {
      this.initialize();
      // At most one job of each kind per wake; the next wake rotates first priority.
      const order = summaryKinds.map((_, index) => summaryKinds[(this.cursor + index) % summaryKinds.length]);
      this.cursor = (this.cursor + 1) % summaryKinds.length;
      this.options.storage.setItem(`heijin.summary.schedule:${this.options.saveId}`, JSON.stringify({ cursor: this.cursor, npcCursor: this.npcCursor }));
      for (const kind of order) {
        if (this.stopped) break;
        let config = this.options.settings().memory.summaries[kind];
        if (!config.automatic) continue;
        let state: GameState;
        try { state = await this.options.load(); } catch { this.remember({ kind, code: 'MEMORY_STORAGE', message: '无法读取有效存档，未发起总结请求。' }); continue; }
        if (this.stopped) break;
        config = this.options.settings().memory.summaries[kind];
        if (!config.automatic) continue;
        if (recoverCompletedSummary(state, kind, this.options.storage)) this.remove(kind);
        if (this.failures.some(failure => failure.kind === kind)) continue;
        let npcId: string | undefined;
        if (kind === 'npc') {
          const counts = npcMemoryIdCounts(state);
          const ids = Object.keys(state.npc).sort().filter(id => npcSummaryCandidates(state, id, counts).length >= Math.max(config.threshold, config.batchSize));
          npcId = ids.find(id => id > this.npcCursor) ?? ids[0];
          if (!npcId) continue;
          this.npcCursor = npcId;
          this.options.storage.setItem(`heijin.summary.schedule:${this.options.saveId}`, JSON.stringify({ cursor: this.cursor, npcCursor: this.npcCursor }));
        } else if (compressionCandidates(state, kind).length <= config.threshold) continue;
        await this.attempt(kind, false, npcId);
      }
    });
  }
}
export const summaryFailureTitle = (failure: SummaryFailure) => `${summaryNames[failure.kind]}总结失败`;
