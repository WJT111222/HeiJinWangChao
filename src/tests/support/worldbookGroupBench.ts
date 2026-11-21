import type { WorldbookEntry } from '../../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../../domain/worldbook/timedEffects';
import { runWorldbookTrigger } from '../../domain/worldbook/trigger';

/**
 * 分组工作量基准（独立审查 P2-5）：对抗性分组负载下的工作量计数、耗尽位置与实际耗时。
 * - maxScanWork 取默认值时，看是否在上限内停止、停在哪里、实际用了多久；
 * - 传入极大的上限时，跑完整个负载，用 实际耗时 ÷ 工作量 检查权重标定（目标：每单位 ≥ 1 纳秒的实际开销不被低估）。
 * 只用虚构数据；不读写任何存储。
 */
export interface GroupBenchRow {
  name: string;
  entries: number;
  memberships: number;
  limit: number;
  used: number;
  exhausted: string;
  activated: number;
  ms: number;
  nsPerUnit: number;
}

function entry(partial: Partial<WorldbookEntry>): WorldbookEntry {
  return {
    entryId: 'e', sourceUid: null, sourceKey: null, comment: '', content: '内容', keys: [], secondaryKeys: [],
    selective: true, selectiveLogic: 0, constant: true, disabled: false, order: 100, position: 0, depth: 4, role: 0,
    outletName: '', probability: 100, useProbability: true, group: '', groupOverride: false, groupWeight: 100,
    useGroupScoring: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null, ignoreBudget: false,
    triggers: [], inert: {}, extensions: {}, ...partial,
  };
}
const names = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(',');

export const GROUP_BENCH_CASES: Array<{ name: string; build: () => WorldbookEntry[] }> = [
  { name: '1000 条 × 3000 个不同组名', build: () => Array.from({ length: 1000 }, (_, i) => entry({ entryId: `a${i}`, group: names(3000, 'g') })) },
  { name: '200 条 × 同一组名重复 20000 次', build: () => Array.from({ length: 200 }, (_, i) => entry({ entryId: `b${i}`, group: Array(20000).fill('g').join(',') })) },
  { name: '20000 条同属一个组（权重抽选）', build: () => Array.from({ length: 20000 }, (_, i) => entry({ entryId: `c${i}`, group: 'g' })) },
  { name: '20000 条优先条目同组（排序）', build: () => Array.from({ length: 20000 }, (_, i) => entry({ entryId: `d${i}`, group: 'g', groupOverride: true, order: i % 997 })) },
  { name: '5000 条 × 每条 40 个组（交错）', build: () => Array.from({ length: 5000 }, (_, i) => entry({ entryId: `e${i}`, group: Array.from({ length: 40 }, (_, k) => `组${(i + k * 131) % 4000}`).join(', ') })) },
  { name: '2000 条 × 组名 2 万字', build: () => Array.from({ length: 2000 }, (_, i) => entry({ entryId: `f${i}`, group: `${'长'.repeat(20000)}${i % 10}` })) },
];

export function runGroupBench(limit: number, only?: readonly string[]): GroupBenchRow[] {
  return GROUP_BENCH_CASES.filter((c) => !only || only.includes(c.name)).map(({ name, build }) => {
    const entries = build();
    const memberships = entries.reduce((sum, e) => sum + e.group.split(/,\s*/).filter(Boolean).length, 0);
    const started = performance.now();
    const r = runWorldbookTrigger({
      books: [{ bookId: 'bench', versionId: 'v', entries }], messages: ['码头'], contextTokens: 1e9, storyRemainingTokens: 1e9,
      trigger: 'normal', messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 'bench',
      settings: { maxScanWork: limit, budgetCap: 1e9 },
    });
    const ms = performance.now() - started;
    const stoppedAt = r.work.exhausted ? r.decisions.find((d) => d.key === r.work.exhausted!.key) : undefined;
    return {
      name, entries: entries.length, memberships, limit, used: r.work.used,
      exhausted: r.work.exhausted ? `第 ${r.work.exhausted.loop} 轮 · ${r.work.exhausted.key} · ${stoppedAt?.detail ?? stoppedAt?.reason ?? ''}` : '未耗尽',
      activated: r.activated.length, ms: Math.round(ms * 10) / 10, nsPerUnit: Math.round(ms * 1e6 / Math.max(1, r.work.used) * 1000) / 1000,
    };
  });
}
