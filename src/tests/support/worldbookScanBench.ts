import type { WorldbookEntry } from '../../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../../domain/worldbook/timedEffects';
import { runWorldbookTrigger, type TriggerSettings } from '../../domain/worldbook/trigger';
import { GROUP_BENCH_CASES } from './worldbookGroupBench';

/**
 * 扫描工作量权重标定基准：在极大上限下跑完每个负载，用 实际耗时 ÷ 工作量 检查权重。
 * 设计目标：每个负载 ≤ 约 1 纳秒 / 单位（在参照机器上），即 1 亿单位 ≈ 0.1 秒以内。
 * 只用虚构数据；不读写任何存储。
 */
export interface ScanBenchRow { name: string; used: number; ms: number; nsPerUnit: number; exhausted: boolean }

export function benchEntry(partial: Partial<WorldbookEntry>): WorldbookEntry {
  return {
    entryId: 'e', sourceUid: null, sourceKey: null, comment: '', content: '内容', keys: [], secondaryKeys: [],
    selective: true, selectiveLogic: 0, constant: false, disabled: false, order: 100, position: 0, depth: 4, role: 0,
    outletName: '', probability: 100, useProbability: true, group: '', groupOverride: false, groupWeight: 100,
    useGroupScoring: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null, ignoreBudget: false,
    triggers: [], inert: {}, extensions: {}, ...partial,
  };
}
const words = (i: number, count: number) => Array.from({ length: count }, (_, k) => `词${i}_${k}`);
const longText = (n: number) => Array.from({ length: n }, (_, i) => `码头茶楼夜市${i}的词${i}_3出现在这里。`).join('');

export interface ScanBenchCase {
  name: string;
  build: () => { entries: WorldbookEntry[]; messages: string[]; settings?: Partial<TriggerSettings> };
}
export const SCAN_BENCH_CASES: ScanBenchCase[] = [
  { name: '典型：300 条 × 5 词，短文本', build: () => ({ entries: Array.from({ length: 300 }, (_, i) => benchEntry({ entryId: `t${i}`, keys: words(i, 5) })), messages: ['码头 茶楼'] }) },
  { name: '2000 条 × 20 词，约 1 万字', build: () => ({ entries: Array.from({ length: 2000 }, (_, i) => benchEntry({ entryId: `m${i}`, keys: words(i, 20) })), messages: [longText(400)] }) },
  { name: '20000 条 × 20 词（40 万个不同关键词）', build: () => ({ entries: Array.from({ length: 20_000 }, (_, i) => benchEntry({ entryId: `w${i}`, keys: words(i, 20) })), messages: [longText(400)] }) },
  { name: '20000 条 × 20 个长关键词（每词 40 字）', build: () => ({ entries: Array.from({ length: 20_000 }, (_, i) => benchEntry({ entryId: `l${i}`, keys: words(i, 20).map((w) => w.repeat(8)) })), messages: ['码头'] }) },
  { name: '完整词 2000 × 20（英文）', build: () => ({ entries: Array.from({ length: 2000 }, (_, i) => benchEntry({ entryId: `x${i}`, keys: Array.from({ length: 20 }, (_, k) => `word${i}x${k}`) })), messages: [Array.from({ length: 3000 }, (_, i) => `word${i}x3 and more`).join(' ')], settings: { matchWholeWords: true } }) },
  { name: '大量命中（关键词互为后缀）', build: () => ({ entries: Array.from({ length: 300 }, (_, i) => benchEntry({ entryId: `h${i}`, keys: ['a'.repeat(1 + (i % 60))] })), messages: ['a'.repeat(20_000)] }) },
  { name: '20000 条常驻、无关键词', build: () => ({ entries: Array.from({ length: 20_000 }, (_, i) => benchEntry({ entryId: `c${i}`, constant: true })), messages: ['码头'], settings: { budgetCap: 1e9 } }) },
  { name: '正则 300 条 × 10 个', build: () => ({ entries: Array.from({ length: 300 }, (_, i) => benchEntry({ entryId: `r${i}`, keys: Array.from({ length: 10 }, (_, k) => `/词${i}_${k}[^。]{0,20}出现/`) })), messages: [longText(400)] }) },
  { name: '5000 条带计时设置、每条 2 千字', build: () => ({ entries: Array.from({ length: 5000 }, (_, i) => benchEntry({ entryId: `s${i}`, sticky: 2, keys: [`词${i}`], content: '设'.repeat(2000) })), messages: ['码头'] }) },
  ...GROUP_BENCH_CASES.map(({ name, build }) => ({ name: `分组：${name}`, build: () => ({ entries: build(), messages: ['码头'], settings: { budgetCap: 1e9 } }) })),
];

export function runScanBench(limit: number, only?: readonly string[]): ScanBenchRow[] {
  return SCAN_BENCH_CASES.filter((c) => !only || only.includes(c.name)).map(({ name, build }) => {
    const { entries, messages, settings } = build();
    const started = performance.now();
    const r = runWorldbookTrigger({
      books: [{ bookId: 'bench', versionId: 'v', entries }], messages, contextTokens: 1e9, storyRemainingTokens: 1e9,
      trigger: 'normal', messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 'bench', settings: { ...settings, maxScanWork: limit },
    });
    const ms = performance.now() - started;
    return { name, used: r.work.used, ms: Math.round(ms * 10) / 10, nsPerUnit: Math.round(ms * 1e6 / Math.max(1, r.work.used) * 100) / 100, exhausted: Boolean(r.work.exhausted) };
  });
}
