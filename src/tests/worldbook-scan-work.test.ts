import { describe, expect, it } from 'vitest';
import { WorkMeter } from '../domain/worldbook/keyMatch';
import { PlainIndex } from '../domain/worldbook/plainIndex';
import type { WorldbookEntry } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { DEFAULT_TRIGGER_SETTINGS, runWorldbookTrigger, type TriggerInput, type TriggerResult } from '../domain/worldbook/trigger';
import { runGroupBench } from './support/worldbookGroupBench';

function entry(partial: Partial<WorldbookEntry>): WorldbookEntry {
  return {
    entryId: 'e', sourceUid: null, sourceKey: null, comment: '', content: '内容', keys: [], secondaryKeys: [],
    selective: true, selectiveLogic: 0, constant: false, disabled: false, order: 100, position: 0, depth: 4, role: 0,
    outletName: '', probability: 100, useProbability: true, group: '', groupOverride: false, groupWeight: 100,
    useGroupScoring: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null, ignoreBudget: false,
    triggers: [], inert: {}, extensions: {}, ...partial,
  };
}
function run(entries: WorldbookEntry[], messages: string[], extra: Partial<TriggerInput> = {}): TriggerResult {
  return runWorldbookTrigger({
    books: [{ bookId: 'b', versionId: 'v', entries }], messages, contextTokens: 100_000, storyRemainingTokens: 50_000,
    trigger: 'normal', messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 's', ...extra,
  });
}

describe('一次扫描索引与逐个判断结果一致', () => {
  const isWord = (c: number) => c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;
  const naiveWhole = (text: string, key: string) => {
    for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
      const end = at + key.length;
      if ((at === 0 || !isWord(text.charCodeAt(at - 1))) && (end === text.length || !isWord(text.charCodeAt(end)))) return true;
      if (at + 1 > text.length) break;
    }
    return false;
  };
  it('随机关键词集合（含互为前后缀、重复字符）× 随机文本', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const alphabet = 'aab_1 中码头.';
    for (let round = 0; round < 300; round++) {
      const keys = Array.from({ length: 1 + rand(12) }, () => Array.from({ length: 1 + rand(5) }, () => alphabet[rand(alphabet.length)]).join(''));
      const index = new PlainIndex();
      keys.forEach((k) => index.add(k));
      const meter = new WorkMeter(Number.MAX_SAFE_INTEGER);
      for (let t = 0; t < 6; t++) {
        const text = Array.from({ length: rand(40) }, () => alphabet[rand(alphabet.length)]).join('');
        for (const key of keys) {
          const hits = index.lookup(text, key, meter);
          if (hits.any !== text.includes(key) || hits.whole !== naiveWhole(text, key)) throw new Error(`${JSON.stringify(key)} @ ${JSON.stringify(text)}`);
        }
      }
    }
  });
  it('空关键词：包含恒真，完整词看边界', () => {
    const index = new PlainIndex();
    const meter = new WorkMeter(1e9);
    expect(index.lookup('\u0001码头', '', meter)).toEqual({ any: true, whole: true });
    expect(index.lookup('ab', '', meter)).toEqual({ any: true, whole: false }); // 每个位置都挨着字母（与正则 (?:^|\W)()(?:$|\W) 一致）
    expect(index.lookup('', '', meter)).toEqual({ any: true, whole: true });
  });
});

describe('单次扫描工作量上限', () => {
  it('默认上限与结果中的工作量信息', () => {
    const r = run([entry({ keys: ['码头'] })], ['码头']);
    expect(r.work.limit).toBe(DEFAULT_TRIGGER_SETTINGS.maxScanWork);
    expect(r.work.used).toBeGreaterThan(0);
    expect(r.work.exhausted).toBeUndefined();
  });

  it('超限时停止扫描：已判断的结果保留，未判断的条目逐条标明原因，结果可复现', () => {
    const entries = Array.from({ length: 400 }, (_, i) => entry({ entryId: `e${i}`, order: 1000 - i, keys: [`/码头${i}/`], content: `第${i}条` }));
    entries[0] = entry({ entryId: 'e0', order: 2000, keys: ['码头'], content: '最优先' });
    const text = '码头'.repeat(2000);
    const r = run(entries, [text], { settings: { maxScanWork: 3_000_000 } });
    expect(r.work.exhausted).toBeDefined();
    expect(r.work.used <= 3_000_000).toBe(true);
    expect(r.activated.map((a) => a.entryId)).toEqual(['e0']);
    const limited = r.decisions.filter((d) => d.reason === 'scan_limit_reached');
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].key).toBe(r.work.exhausted!.key);
    // 每个条目都有判定，没有“既未激活也没有原因”的条目
    expect(r.decisions.every((d) => d.reason !== 'not_scanned')).toBe(true);
    expect(JSON.stringify(run(entries, [text], { settings: { maxScanWork: 3_000_000 } }))).toBe(JSON.stringify(r));
  });

  it('超限后不再进入递归等后续轮次', () => {
    const a = entry({ entryId: 'a', order: 300, keys: ['码头'], content: '搬运帮' });
    const b = entry({ entryId: 'b', order: 200, keys: ['搬运帮'] });
    const filler = Array.from({ length: 200 }, (_, i) => entry({ entryId: `f${i}`, order: 100, keys: [`/x{1,40}${i}/`] }));
    const r = run([a, b, ...filler], ['码头'], { settings: { recursive: true, maxScanWork: 150_000 } });
    expect(r.work.exhausted?.loop).toBe(1);
    expect(r.loops).toBe(1);
    expect(r.activated.map((x) => x.entryId)).toEqual(['a']);
  });

  it('准备阶段就超限时不扫描，计时状态原样返回', () => {
    const state = { sticky: { 'b#x': { fingerprint: 'f', start: 0, end: 9, protected: false } }, cooldown: {} };
    const r = run([entry({ entryId: 'x', sticky: 3, content: '字'.repeat(5000) })], ['码头'], { settings: { maxScanWork: 100 }, timedState: state });
    expect(r.activated).toEqual([]);
    expect(r.work.exhausted).toEqual({ loop: 0, key: 'b#x' });
    expect(r.decisions[0]).toMatchObject({ reason: 'scan_limit_reached', detail: '准备阶段' });
    expect(r.nextTimedState).toEqual(state);
  });

  it('分组评分时超限：该组条目移出并标明原因', () => {
    const group = Array.from({ length: 3 }, (_, i) => entry({ entryId: `g${i}`, keys: ['码头'], group: 'g', useGroupScoring: true, secondaryKeys: ['/码{1,30}头/'] }));
    const full = run(group, ['码头'.repeat(500)]);
    expect(full.activated).toHaveLength(1); // 不受限时三条都进入评分，同分后按权重留一条
    const budget = full.work.used - 1;
    const r = run(group, ['码头'.repeat(500)], { settings: { maxScanWork: budget } });
    expect(r.activated).toEqual([]);
    expect(r.decisions.map((d) => [d.reason, d.detail])).toEqual(Array(3).fill(['scan_limit_reached', '组「g」评分未完成']));
  });
});

describe('规模边界：默认上限内的典型与极端负载', () => {
  const story = '他走进码头附近的茶馆，点了一壶茶。'.repeat(600); // 约 1 万字的长正文
  it('2000 条 × 每条 10 个普通关键词、扫描约 1 万字正文：不触发上限', () => {
    const entries = Array.from({ length: 2000 }, (_, i) => entry({ entryId: `e${i}`, keys: Array.from({ length: 10 }, (_, k) => `词${i}_${k}`) }));
    const started = Date.now();
    const r = run(entries, ['我去码头', story]);
    expect(r.work.exhausted).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it('递归链：每轮只激活一条、共 1500 条，工作量与耗时都受上限约束', () => {
    const chain = Array.from({ length: 1500 }, (_, i) => entry({ entryId: `c${i}`, keys: [`k${i}`], content: `k${i + 1}` }));
    const started = Date.now();
    const r = run(chain, ['k0'], { settings: { recursive: true, budgetCap: 1e9 }, storyRemainingTokens: 1e9 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.work.used <= DEFAULT_TRIGGER_SETTINGS.maxScanWork).toBe(true);
    if (r.work.exhausted) expect(r.decisions.some((d) => d.reason === 'scan_limit_reached')).toBe(true);
  });
  it('对抗性正则与大量命中：耗时受上限约束', () => {
    const regexes = Array.from({ length: 300 }, (_, i) => entry({ entryId: `r${i}`, keys: Array.from({ length: 10 }, (_, k) => `/(.*码.*头){1,3}${i}_${k}/`) }));
    const frequent = Array.from({ length: 500 }, (_, i) => entry({ entryId: `w${i}`, matchWholeWords: true, keys: ['a', 'aa', 'a a'.repeat(1 + (i % 3))] }));
    const started = Date.now();
    const r = run([...regexes, ...frequent], [story, 'aaaa '.repeat(4000)]);
    expect(r.work.exhausted).toBeDefined();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('分组处理计入单次扫描工作量（独立审查 P2-5）', () => {
  const names = (count: number, prefix = 'g') => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(',');
  const grouped = (count: number, group: string, extra: Partial<WorldbookEntry> = {}) =>
    Array.from({ length: count }, (_, i) => entry({ entryId: `m${i}`, constant: true, group, content: `成员${i}`, ...extra }));

  it('大量分组名不能绕过上限：分组构建在耗尽前停止，组内候选不激活，诊断明确且结果可复现', () => {
    const entries = [...grouped(300, names(400)), entry({ entryId: 'solo', constant: true, order: 50, content: '无分组' })];
    // 上限够判断全部条目，但不够处理 300 × 400 个分组成员
    const limit = 2_000_000;
    const r = run(entries, ['码头'], { settings: { maxScanWork: limit } });
    expect(r.work.exhausted).toBeDefined();
    expect(r.work.used <= limit).toBe(true);
    expect(r.activated.map((a) => a.entryId)).toEqual(['solo']); // 不属于任何分组的条目照常处理
    const members = r.decisions.filter((d) => d.entryId.startsWith('m'));
    expect(members.every((d) => d.status === 'not_activated' && d.reason === 'scan_limit_reached' && d.detail === '分组处理未完成')).toBe(true);
    expect(JSON.stringify(run(entries, ['码头'], { settings: { maxScanWork: limit } }))).toBe(JSON.stringify(r));
  });

  it('同一组名重复出现：每次出现都计入工作量', () => {
    const once = run(grouped(20, 'g'), ['码头']);
    const repeated = run(grouped(20, Array(2000).fill('g').join(',')), ['码头']);
    expect(repeated.work.used - once.work.used).toBeGreaterThan(20 * 2000 * 50);
    expect(repeated.activated).toHaveLength(1);
  });

  it('评估阶段耗尽：已找到但同组成员未判断完的候选，不作为正常候选激活', () => {
    const first = entry({ entryId: 'first', order: 300, keys: ['码头'], group: 'g', content: '先判断的组员' });
    const plain = entry({ entryId: 'plain', order: 290, keys: ['码头'], content: '无分组' });
    const filler = Array.from({ length: 200 }, (_, i) => entry({ entryId: `f${i}`, order: 200, keys: [`/x{1,40}${i}/`] }));
    const last = entry({ entryId: 'last', order: 100, keys: ['码头'], group: 'g', content: '没轮到的组员' });
    const r = run([first, plain, ...filler, last], ['码头'], { settings: { maxScanWork: 150_000 } });
    expect(r.work.exhausted?.loop).toBe(1);
    expect(r.activated.map((a) => a.entryId)).toEqual(['plain']);
    expect(r.decisions.find((d) => d.entryId === 'first')).toMatchObject({ reason: 'scan_limit_reached', detail: '同组条目未判断完' });
    expect(r.decisions.find((d) => d.entryId === 'last')!.reason).toBe('scan_limit_reached');
  });

  it('分组评分时耗尽：后面的分组也停止处理，不留下不完整的抽选结果', () => {
    const scored = Array.from({ length: 3 }, (_, i) => entry({ entryId: `s${i}`, keys: ['码头'], group: 'a', useGroupScoring: true, secondaryKeys: ['/码{1,30}头/'], order: 200 }));
    const weighted = Array.from({ length: 3 }, (_, i) => entry({ entryId: `w${i}`, keys: ['码头'], group: 'b', order: 100 }));
    const entries = [...scored, ...weighted];
    const text = ['码头'.repeat(500)];
    const full = run(entries, text);
    expect(full.activated).toHaveLength(2);
    // 找到恰好在评分中耗尽的上限
    let limit = full.work.used - 1;
    let r = run(entries, text, { settings: { maxScanWork: limit } });
    while (!r.decisions.some((d) => d.detail?.includes('评分未完成')) && limit > 0) {
      limit -= 1000;
      r = run(entries, text, { settings: { maxScanWork: limit } });
    }
    expect(r.work.exhausted).toBeDefined();
    expect(r.activated).toEqual([]);
    for (const id of ['w0', 'w1', 'w2']) expect(r.decisions.find((d) => d.entryId === id)).toMatchObject({ reason: 'scan_limit_reached', detail: '分组处理未完成' });
  });

  it('对抗性多组（大量条目 × 大量组名）：默认上限内停止，耗时受约束', () => {
    const entries = grouped(1000, names(3000, 'gg'));
    const started = Date.now();
    const r = run(entries, ['码头']);
    const elapsed = Date.now() - started;
    expect(r.work.exhausted).toBeDefined();
    expect(r.work.used <= DEFAULT_TRIGGER_SETTINGS.maxScanWork).toBe(true);
    expect(r.activated).toEqual([]);
    expect(elapsed).toBeLessThan(3000);
  });

  it('默认上限内的正常分组规模不受影响', () => {
    const entries = Array.from({ length: 500 }, (_, i) => entry({ entryId: `n${i}`, constant: true, group: `组${i % 50}`, content: `${i}` }));
    const r = run(entries, ['码头']);
    expect(r.work.exhausted).toBeUndefined();
    expect(r.activated).toHaveLength(50); // 每组留一条
    expect(r.decisions.filter((d) => d.reason === 'group_weighted')).toHaveLength(450);
  });

  it('分组基准（默认上限）：每个对抗负载都在上限内结束，记录工作量、耗尽位置与耗时', () => {
    const rows = runGroupBench(DEFAULT_TRIGGER_SETTINGS.maxScanWork);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.used <= row.limit).toBe(true);
      expect(row.ms).toBeLessThan(3000);
      if (row.exhausted !== '未耗尽') expect(row.activated).toBe(0);
    }
    expect(rows.filter((row) => row.exhausted.includes('分组处理未完成')).length).toBeGreaterThanOrEqual(4);
  });
});
