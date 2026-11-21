import type { Settings } from '../ui/settings/model';
import type { GameState } from '../domain/state';
import { summaryKinds, summaryNames } from '../domain/memories/configuration';
import type { SummaryKind } from '../domain/memories/configuration';
import { compressionCandidates } from '../domain/memories/compression';
import { npcSummaryCandidates, npcMemoryIdCounts } from '../domain/memories/npcMemory';
import { pendingFor, SummaryRecords, summaryErrorCode, summaryIssue } from './memorySummaryRecords';
import type { SummaryIssue } from './memorySummaryRecords';

export type SummaryFailure = SummaryIssue;
export type SummaryQueueSnapshot = { state?: GameState; paused: boolean; failures: SummaryIssue[]; busy?: boolean };
export interface SummaryQueueOptions {
  saveId: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  settings: () => Settings;
  load: () => Promise<{ state: GameState; paused: boolean; busy?: boolean }>;
  reconcile?: () => Promise<void>;
  execute: (kind: SummaryKind, immediate: boolean, npcId?: string, retryId?: string) => Promise<void>;
  changed: (snapshot: SummaryQueueSnapshot) => void;
}

/** The queue orders work; only the runner can authorize requests or modify the ledger. */
export class MemorySummaryQueue {
  private tail = Promise.resolve();
  private queued = new Set<string>();
  private stopped = false;
  constructor(private options: SummaryQueueOptions) {}
  stop() { this.stopped = true; }
  private enqueue(key: string, work: () => Promise<void>) {
    if (this.stopped || this.queued.has(key)) return this.tail;
    this.queued.add(key);
    this.tail = this.tail.then(async () => { if (!this.stopped) await work(); })
      .catch(() => { if (!this.stopped) this.options.changed({ paused: false, failures: summaryKinds.map(kind => summaryIssue({ kind, code: 'MEMORY_STORAGE' })) }); })
      .finally(() => { this.queued.delete(key); });
    return this.tail;
  }
  private async publish(extra: SummaryIssue[] = []) {
    if (this.stopped) return;
    let current = await this.options.load();
    if (this.stopped) return;
    let records = new SummaryRecords(this.options.storage, current.state);
    if (this.options.reconcile && !current.busy && records.pending.length !== records.unresolved.length) {
      try { await this.options.reconcile(); }
      catch (error) { if (summaryErrorCode(error) !== 'MEMORY_BUSY') throw error; }
      current = await this.options.load();
      records = new SummaryRecords(this.options.storage, current.state);
    }
    if (this.stopped) return;
    const issues = records.issues;
    this.options.changed({ ...current, failures: [...issues, ...extra.filter(issue =>
      !issues.some(stored => stored.kind === issue.kind && stored.npcId === issue.npcId && stored.code === issue.code))] });
  }
  private async attempt(kind: SummaryKind, immediate: boolean, npcId?: string, retryId?: string) {
    try {
      await this.options.execute(kind, immediate, npcId, retryId);
    } catch (error) {
      const code = summaryErrorCode(error);
      if (['MEMORY_BUSY', 'MEMORY_THROTTLED', 'MEMORY_CHANGED', 'MEMORY_PREVIOUS', 'cancelled'].includes(code)) return;
      return summaryIssue({ kind, code, npcId, manual: immediate });
    }
  }
  refresh() { return this.enqueue('read', () => this.publish()); }
  immediate(kind: SummaryKind, npcId?: string, retryId?: string) {
    return this.enqueue(`manual:${kind}:${npcId ?? ''}`, async () => {
      const issue = await this.attempt(kind, true, npcId, retryId);
      await this.publish(issue ? [issue] : []);
    });
  }
  wake() {
    return this.enqueue('automatic', async () => {
      const scheduleKey = `heijin.summary.schedule:${this.options.saveId}`;
      const schedule = JSON.parse(this.options.storage.getItem(scheduleKey) || '{}') as { cursor?: number; npcCursor?: string };
      const cursor = Number.isInteger(schedule.cursor) ? Math.abs(schedule.cursor!) % summaryKinds.length : 0;
      const npcCursor = typeof schedule.npcCursor === 'string' ? schedule.npcCursor : '';
      const order = summaryKinds.map((_, index) => summaryKinds[(cursor + index) % summaryKinds.length]);
      const next = { cursor: (cursor + 1) % summaryKinds.length, npcCursor };
      this.options.storage.setItem(scheduleKey, JSON.stringify(next));
      const issues: SummaryIssue[] = [];
      for (const kind of order) {
        if (this.stopped) break;
        if (!this.options.settings().memory.summaries[kind].automatic) continue;
        const { state, paused } = await this.options.load();
        if (this.stopped) break;
        if (paused) continue;
        const config = this.options.settings().memory.summaries[kind];
        if (!config.automatic) continue;
        const records = new SummaryRecords(this.options.storage, state);
        let npcId: string | undefined;
        if (kind === 'npc') {
          const counts = npcMemoryIdCounts(state);
          const eligible = Object.keys(state.npc).sort().filter(id => {
            const candidates = npcSummaryCandidates(state, id, counts);
            return candidates.length >= config.threshold && !pendingFor(records, kind, candidates).length;
          });
          npcId = eligible.find(id => id > npcCursor) ?? eligible[0];
          if (!npcId) continue;
          next.npcCursor = npcId;
          this.options.storage.setItem(scheduleKey, JSON.stringify(next));
        } else {
          const candidates = compressionCandidates(state, kind);
          if (candidates.length <= config.threshold || pendingFor(records, kind, candidates).length) continue;
        }
        const issue = await this.attempt(kind, false, npcId);
        if (issue) issues.push(issue);
      }
      await this.publish(issues);
    });
  }
}
export const summaryFailureTitle = (failure: SummaryFailure) =>
  `${summaryNames[failure.kind]}总结${failure.pending ? '待确认' : '失败'}`;
