import { describe, expect, it } from 'vitest';
import type { WorldbookEntry } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { runWorldbookTrigger, type TriggerInput, type TriggerResult } from '../domain/worldbook/trigger';
import { conservativeTokens, parseDecorators } from '../domain/worldbook/triggerSupport';

let uid = 0;
function entry(partial: Partial<WorldbookEntry> = {}): WorldbookEntry {
  const id = partial.entryId ?? `e${++uid}`;
  return {
    entryId: id, sourceUid: null, sourceKey: null, comment: id, content: `内容${id}`, keys: [], secondaryKeys: [],
    selective: true, selectiveLogic: 0, constant: false, disabled: false, order: 100, position: 0, depth: 4, role: 0,
    outletName: '', probability: 100, useProbability: true, group: '', groupOverride: false, groupWeight: 100,
    useGroupScoring: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null, ignoreBudget: false,
    triggers: [], inert: {}, extensions: {}, ...partial,
  };
}
function run(entries: WorldbookEntry[], messages: string[], extra: Partial<TriggerInput> = {}): TriggerResult {
  return runWorldbookTrigger({
    books: [{ bookId: 'book', versionId: 'v1', entries }], messages, contextTokens: 100_000, storyRemainingTokens: 50_000,
    trigger: 'normal', messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 'seed', ...extra,
  });
}
const ids = (result: TriggerResult) => result.activated.map((a) => a.entryId);
const reason = (result: TriggerResult, id: string) => result.decisions.find((d) => d.entryId === id)!.reason;

describe('关键词匹配', () => {
  it('主关键词命中即激活；默认不区分大小写；条目可单独区分大小写', () => {
    const r = run([entry({ entryId: 'a', keys: ['Harbor'] }), entry({ entryId: 'b', keys: ['Harbor'], caseSensitive: true }), entry({ entryId: 'c', keys: ['码头'] })], ['去 harbor 看看']);
    expect(ids(r)).toEqual(['a']);
    expect(reason(r, 'b')).toBe('no_primary_match');
  });

  it('常驻、停用、无关键词', () => {
    const r = run([entry({ entryId: 'k', constant: true }), entry({ entryId: 'off', constant: true, disabled: true }), entry({ entryId: 'nokey' })], ['任何']);
    expect(ids(r)).toEqual(['k']);
    expect([reason(r, 'off'), reason(r, 'nokey')]).toEqual(['disabled', 'no_keys']);
  });

  it('副关键词四种逻辑', () => {
    const text = ['茶馆里很热闹'];
    const make = (logic: number, secondary: string[]) => entry({ keys: ['茶馆'], secondaryKeys: secondary, selectiveLogic: logic });
    const cases: Array<[number, string[], boolean]> = [
      [0, ['热闹', '冷清'], true], [0, ['冷清'], false],
      [1, ['热闹', '冷清'], true], [1, ['热闹'], false],
      [2, ['冷清', '安静'], true], [2, ['冷清', '热闹'], false],
      [3, ['热闹', '里'], true], [3, ['热闹', '冷清'], false],
    ];
    for (const [logic, secondary, expected] of cases) expect(run([make(logic, secondary)], text).activated.length === 1).toBe(expected);
    // selective 为假时忽略副关键词
    expect(run([entry({ keys: ['茶馆'], secondaryKeys: ['冷清'], selectiveLogic: 3, selective: false })], text).activated).toHaveLength(1);
  });

  it('完整词：英文看边界，中文基本等同包含（与参照版本一致）', () => {
    const r = run([entry({ entryId: 'cat', keys: ['cat'], matchWholeWords: true }), entry({ entryId: 'cn', keys: ['码头'], matchWholeWords: true })], ['concatenate 去码头工作']);
    expect(ids(r)).toEqual(['cn']);
    expect(ids(run([entry({ keys: ['cat'], matchWholeWords: true })], ['a cat.']))).toHaveLength(1);
  });

  it('只由空白组成的关键词匹配任何文本（参照版本行为）', () => {
    expect(run([entry({ keys: ['  '] })], ['随便']).activated).toHaveLength(1);
  });

  it('正则关键词：安全子集内正常匹配；不在子集内的不运行、按不命中处理并报告', () => {
    const r = run([entry({ entryId: 're', keys: ['/港口\\d+号/'] }), entry({ entryId: 'bad', keys: ['/(?=港)港/'] })], ['港口12号']);
    expect(ids(r)).toEqual(['re']);
    expect(reason(r, 'bad')).toBe('no_primary_match');
    expect(r.unsupportedKeys).toEqual([{ key: '/(?=港)港/', reason: 'lookaround' }]);
  });

  it('宏默认不替换：钩子传入后关键词与正文都会替换', () => {
    const e = entry({ keys: ['{{user}}'], content: '{{user}}的家' });
    expect(run([e], ['阿强回家']).activated).toHaveLength(0);
    const r = run([e], ['阿强回家'], { substitute: (t) => t.replaceAll('{{user}}', '阿强') });
    expect(r.activated[0].content).toBe('阿强的家');
  });
});

describe('扫描窗口', () => {
  const messages = ['最新一条', '第二条', '第三条提到码头'];
  it('默认只扫描最近 2 条；条目可单独设置深度；深度 0 不扫描', () => {
    expect(run([entry({ keys: ['码头'] })], messages).activated).toHaveLength(0);
    expect(run([entry({ keys: ['码头'], scanDepth: 3 })], messages).activated).toHaveLength(1);
    expect(run([entry({ keys: ['最新'], scanDepth: 0 })], messages).activated).toHaveLength(0);
    expect(run([entry({ keys: ['码头'] })], messages, { settings: { scanDepth: 3 } }).activated).toHaveLength(1);
  });

  it('最少激活数未满足时逐条加深扫描', () => {
    const r = run([entry({ entryId: 'far', keys: ['码头'] })], messages, { settings: { minActivations: 1 } });
    expect(ids(r)).toEqual(['far']);
    expect(r.loops).toBe(2);
  });

  it('触发模式筛选', () => {
    const e = entry({ keys: ['码头'], triggers: ['continue'] });
    expect(run([e], ['码头']).activated).toHaveLength(0);
    expect(run([e], ['码头'], { trigger: 'continue' }).activated).toHaveLength(1);
  });
});

describe('递归', () => {
  const a = () => entry({ entryId: 'a', keys: ['码头'], content: '码头归搬运帮管' });
  const b = (extra: Partial<WorldbookEntry> = {}) => entry({ entryId: 'b', keys: ['搬运帮'], content: '搬运帮的头目叫老七', ...extra });
  it('默认关闭：已激活条目的正文不会再触发别的条目', () => {
    expect(ids(run([a(), b()], ['去码头']))).toEqual(['a']);
  });
  it('开启后由已激活正文触发，按轮次记录', () => {
    const r = run([a(), b()], ['去码头'], { settings: { recursive: true } });
    expect(ids(r)).toEqual(['a', 'b']);
    expect(r.activated.map((x) => x.loop)).toEqual([1, 2]);
  });
  it('阻止继续递归、不可被递归、延迟到递归', () => {
    expect(ids(run([entry({ ...a(), preventRecursion: true }), b()], ['去码头'], { settings: { recursive: true } }))).toEqual(['a']);
    expect(ids(run([a(), b({ excludeRecursion: true })], ['去码头'], { settings: { recursive: true } }))).toEqual(['a']);
    const delayed = run([a(), b({ delayUntilRecursion: true, keys: ['码头'] })], ['去码头'], { settings: { recursive: true } });
    expect(delayed.activated.map((x) => [x.entryId, x.loop])).toEqual([['a', 1], ['b', 2]]);
    // 递归关闭时（参照版本行为）：只有一个层级时第一层被预先占用，条目不会激活；
    // 有更高层级时会追加一轮层级扫描，层级不超过当前层的条目在那一轮激活。
    const single = run([b({ delayUntilRecursion: 1, keys: ['码头'] })], ['去码头']);
    expect(single.activated).toEqual([]);
    expect(reason(single, 'b')).toBe('delay_until_recursion');
    const levels = run([b({ delayUntilRecursion: 1, keys: ['码头'] }), entry({ entryId: 'c', keys: ['码头'], delayUntilRecursion: 2 })], ['去码头']);
    expect(levels.activated.map((x) => [x.entryId, x.loop])).toEqual([['b', 2], ['c', 2]]);
  });
  it('最大递归步数', () => {
    const c = entry({ entryId: 'c', keys: ['老七'] });
    expect(ids(run([a(), b(), c], ['去码头'], { settings: { recursive: true } }))).toEqual(['a', 'b', 'c']);
    expect(ids(run([a(), b(), c], ['去码头'], { settings: { recursive: true, maxRecursionSteps: 2 } }))).toEqual(['a', 'b']);
  });
  it('回归：无视软预算但超出硬上限而被拒绝的条目，不能通过递归间接激活其他条目', () => {
    const small = entry({ entryId: 'small', constant: true, order: 300, content: '无关' });
    const rejected = entry({ entryId: 'big', constant: true, order: 200, ignoreBudget: true, content: `老七${'字'.repeat(200)}` });
    const target = entry({ entryId: 'target', keys: ['老七'], content: '老七的情报' });
    const r = run([small, rejected, target], ['开场'], { settings: { recursive: true }, storyRemainingTokens: 40 });
    expect(ids(r)).toEqual(['small']);
    expect(reason(r, 'big')).toBe('hard_budget_exceeded');
    expect(reason(r, 'target')).toBe('no_primary_match');
    expect(r.loops).toBe(2); // 第二轮只扫描到“无关”，没有被拒绝条目的正文
  });

  it('回归：超出软预算被拒绝的条目，在延迟层级的追加扫描中也不提供递归文本', () => {
    const big = entry({ entryId: 'big', constant: true, content: `老七${'字'.repeat(200)}` });
    const delayed = entry({ entryId: 'delayed', keys: ['老七'], delayUntilRecursion: 1, ignoreBudget: true });
    const level2 = entry({ entryId: 'level2', delayUntilRecursion: 2 });
    const r = run([big, delayed, level2], ['无关'], { contextTokens: 400 });
    expect(r.budget.overflowed).toBe(true);
    expect(r.activated).toEqual([]);
    expect(reason(r, 'delayed')).toBe('no_primary_match');
  });

  it('互相触发的条目不会无限循环', () => {
    const x = entry({ entryId: 'x', keys: ['甲'], content: '乙' }), y = entry({ entryId: 'y', keys: ['乙'], content: '甲' });
    const r = run([x, y], ['甲'], { settings: { recursive: true } });
    expect(ids(r)).toEqual(['x', 'y']);
    expect(r.loops).toBe(3);
  });
});

describe('前缀指令', () => {
  it('@@activate 强制激活、@@dont_activate 抑制，指令行不进入正文', () => {
    const r = run([entry({ entryId: 'on', content: '@@activate\n真正的正文' }), entry({ entryId: 'no', keys: ['码头'], content: '@@dont_activate\n正文' })], ['码头']);
    expect(r.activated.map((x) => [x.entryId, x.content])).toEqual([['on', '真正的正文']]);
    expect(reason(r, 'no')).toBe('decorator_suppress');
  });
  it('解析细节', () => {
    expect(parseDecorators('普通正文')).toEqual({ decorators: [], content: '普通正文' });
    expect(parseDecorators('@@activate\n@@unknown\n@@@dont_activate\n正文')).toEqual({ decorators: ['@@activate', '@@dont_activate'], content: '正文' });
    expect(parseDecorators('@@@activate\n正文')).toEqual({ decorators: [], content: '正文' });
    expect(parseDecorators('@@activate')).toEqual({ decorators: ['@@activate'], content: '@@activate' });
  });
});

describe('分组互斥', () => {
  const group = (id: string, extra: Partial<WorldbookEntry> = {}) => entry({ entryId: id, keys: ['码头'], group: '码头', ...extra });
  it('同组只留一个：按权重抽选，同一种子结果固定，不同种子覆盖各个条目', () => {
    const entries = [group('a'), group('b'), group('c')];
    const first = ids(run(entries, ['码头'], { seed: 's1' }));
    expect(first).toHaveLength(1);
    expect(ids(run(entries, ['码头'], { seed: 's1' }))).toEqual(first);
    const winners = new Set(Array.from({ length: 60 }, (_, i) => ids(run(entries, ['码头'], { seed: `s${i}` }))[0]));
    expect([...winners].sort()).toEqual(['a', 'b', 'c']);
  });
  it('权重为 0 的条目不会被抽中', () => {
    for (let i = 0; i < 40; i++) expect(ids(run([group('a', { groupWeight: 0 }), group('b')], ['码头'], { seed: `w${i}` }))).toEqual(['b']);
  });
  it('有优先条目时取 order 最高的优先条目', () => {
    const r = run([group('a', { groupOverride: true, order: 10 }), group('b', { groupOverride: true, order: 50 }), group('c')], ['码头']);
    expect(ids(r)).toEqual(['b']);
    expect(reason(r, 'a')).toBe('group_priority');
  });
  it('分组评分：只留命中关键词最多的条目', () => {
    const r = run([group('one', { keys: ['码头'] }), group('two', { keys: ['码头', '夜里'] })], ['码头夜里'], { settings: { useGroupScoring: true } });
    expect(ids(r)).toEqual(['two']);
    expect(reason(r, 'one')).toBe('group_scoring');
  });
  it('同组已有条目激活时，后续轮次的同组条目全部作废；多组条目按完整组字符串比较（参照版本行为）', () => {
    const settings = { recursive: true };
    const first = entry({ entryId: 'first', keys: ['码头'], group: 'x', content: '夜班' });
    const later = entry({ entryId: 'later', keys: ['夜班'], group: 'x' });
    expect(ids(run([first, later], ['码头'], { settings }))).toEqual(['first']);
    const multi = entry({ entryId: 'first', keys: ['码头'], group: 'x,y', content: '夜班' });
    expect(ids(run([multi, later], ['码头'], { settings }))).toEqual(['first', 'later']);
  });
  it('有意修正：多组条目被重复移出时，不会误删列表里无关的条目', () => {
    // 组 a 留 P、组 b 留 R，Q 属于两组会被移出两次；参照版本第二次会误删最后一个条目 Z。
    const r = run([
      entry({ entryId: 'P', keys: ['码头'], group: 'a', groupOverride: true }),
      entry({ entryId: 'Q', keys: ['码头'], group: 'a,b' }),
      entry({ entryId: 'R', keys: ['码头'], group: 'b', groupOverride: true }),
      entry({ entryId: 'Z', keys: ['码头'] }),
    ], ['码头']);
    expect(ids(r)).toEqual(['P', 'R', 'Z']);
  });
});

describe('概率', () => {
  it('同一种子结果固定；整体比例接近设置值；关闭概率或 100% 时总是通过', () => {
    const e = entry({ keys: ['码头'], probability: 30 });
    const once = run([e], ['码头'], { seed: 'p' }).activated.length;
    expect(run([e], ['码头'], { seed: 'p' }).activated.length).toBe(once);
    let hit = 0;
    for (let i = 0; i < 1000; i++) hit += run([e], ['码头'], { seed: `p${i}` }).activated.length;
    expect(hit).toBeGreaterThan(240);
    expect(hit).toBeLessThan(360);
    expect(run([entry({ keys: ['码头'], probability: 0, useProbability: false })], ['码头']).activated).toHaveLength(1);
  });
  it('概率失败会记录掷出的数值', () => {
    const r = run([entry({ entryId: 'p', keys: ['码头'], probability: 0 })], ['码头']);
    expect(reason(r, 'p')).toBe('probability_failed');
    expect(r.decisions[0].detail).toMatch(/掷出 .*需要 ≤ 0/);
  });
});

describe('预算', () => {
  const long = (id: string, order: number, extra: Partial<WorldbookEntry> = {}) => entry({ entryId: id, constant: true, order, content: '字'.repeat(100), ...extra });
  it('软预算 = 上下文 × 25%：超出后停止，后面的条目不再进入', () => {
    // 每条约 151 Token；上下文 1200 → 预算 300，只放得下一条（判断为“达到即超出”）。
    const r = run([long('a', 300), long('b', 200), long('c', 100)], [], { contextTokens: 1200 });
    expect(r.budget).toMatchObject({ soft: 300, limit: 300, overflowed: true });
    expect(ids(r)).toEqual(['a']);
    expect([reason(r, 'b'), reason(r, 'c')]).toEqual(['budget_exceeded', 'budget_exceeded']);
  });
  it('合计上限 4096 与 Story 剩余预算取小，任何情况下注入量都不超过它', () => {
    const many = Array.from({ length: 60 }, (_, i) => long(`m${i}`, 1000 - i));
    const capped = run(many, [], { contextTokens: 1_000_000, storyRemainingTokens: 100_000 });
    expect(capped.budget.hard).toBe(4096);
    expect(capped.budget.used <= 4096).toBe(true);
    const tight = run(many, [], { contextTokens: 1_000_000, storyRemainingTokens: 500 });
    expect(tight.budget.hard).toBe(500);
    expect(tight.budget.used <= 500).toBe(true);
    const none = run(many, [], { storyRemainingTokens: 0 });
    expect(none.activated).toEqual([]);
  });
  it('“无视预算”只绕过软预算，不绕过王朝硬上限', () => {
    const r = run([long('a', 300), long('free', 200, { ignoreBudget: true }), long('c', 100)], [], { contextTokens: 1200 });
    expect(ids(r)).toEqual(['a', 'free']);
    const hardOnly = run([long('free', 200, { ignoreBudget: true })], [], { storyRemainingTokens: 100 });
    expect(hardOnly.activated).toEqual([]);
    expect(reason(hardOnly, 'free')).toBe('hard_budget_exceeded');
  });
  it('保守估算：中文每字 1.5、英文每 3 个字符 1', () => {
    expect(conservativeTokens('码头')).toBe(3);
    expect(conservativeTokens('abcdef')).toBe(2);
  });
});

describe('插入计划', () => {
  it('同一位置内 order 越大越靠后（越接近生成点）；各位置分开；空正文不插入', () => {
    const r = run([
      entry({ entryId: 'low', constant: true, order: 1, content: '低' }),
      entry({ entryId: 'high', constant: true, order: 9, content: '高' }),
      entry({ entryId: 'after', constant: true, position: 1, content: '后' }),
      entry({ entryId: 'd1', constant: true, position: 4, depth: 2, role: 1, order: 5, content: '深1' }),
      entry({ entryId: 'd2', constant: true, position: 4, depth: 2, role: 1, order: 7, content: '深2' }),
      entry({ entryId: 'out', constant: true, position: 7, outletName: '码头', content: '出口' }),
      entry({ entryId: 'nameless', constant: true, position: 7, content: '无名' }),
      entry({ entryId: 'empty', constant: true, content: '' }),
    ], []);
    expect(r.plan.before).toEqual(['低', '高']);
    expect(r.plan.after).toEqual(['后']);
    expect(r.plan.atDepth).toEqual([{ depth: 2, role: 1, contents: ['深1', '深2'] }]);
    expect(r.plan.outlets).toEqual({ 码头: ['出口'] });
    expect(r.activated.filter((a) => !a.placed).map((a) => a.entryId).sort()).toEqual(['empty', 'nameless']);
  });
  it('多本书按 order 合并扫描', () => {
    const r = runWorldbookTrigger({
      books: [{ bookId: 'A', versionId: '1', entries: [entry({ entryId: 'a', constant: true, order: 1, content: 'A' })] },
        { bookId: 'B', versionId: '1', entries: [entry({ entryId: 'b', constant: true, order: 2, content: 'B' })] }],
      messages: [], contextTokens: 100_000, storyRemainingTokens: 10_000, trigger: 'normal', messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 's',
    });
    expect(r.decisions.map((d) => d.key)).toEqual(['B#b', 'A#a']);
    expect(r.plan.before).toEqual(['A', 'B']);
  });
});

describe('特殊 Outlet 与分组名称（独立审查 P2-2）', () => {
  const SPECIAL = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'isPrototypeOf'];

  it('特殊 Outlet 名称：不抛错、各自独立收集、不影响对象原型', () => {
    const entries = SPECIAL.flatMap((name, i) => [
      entry({ entryId: `o${i}a`, constant: true, position: 7, outletName: name, order: 1, content: `${name}-1` }),
      entry({ entryId: `o${i}b`, constant: true, position: 7, outletName: name, order: 2, content: `${name}-2` }),
    ]);
    const r = run(entries, []);
    expect(Object.keys(r.plan.outlets).sort()).toEqual([...SPECIAL].sort());
    for (const name of SPECIAL) {
      expect(Object.hasOwn(r.plan.outlets, name)).toBe(true);
      expect([...r.plan.outlets[name]].sort()).toEqual([`${name}-1`, `${name}-2`]);
    }
    expect(r.activated.every((a) => a.placed)).toBe(true);
    // 普通对象的原型没有被改动
    const probe: Record<string, unknown> = {};
    expect(Object.getPrototypeOf(probe)).toBe(Object.prototype);
    expect(typeof probe.toString).toBe('function');
    expect(Object.hasOwn(Object.prototype, 'push')).toBe(false);
  });

  it('插入计划可以 JSON 序列化并原样还原（包括 "__proto__" 名称）', () => {
    const r = run(SPECIAL.map((name, i) => entry({ entryId: `j${i}`, constant: true, position: 7, outletName: name, content: name })), []);
    const back = JSON.parse(JSON.stringify(r.plan)) as typeof r.plan;
    for (const name of SPECIAL) {
      expect(Object.hasOwn(back.outlets, name)).toBe(true);
      expect(back.outlets[name]).toEqual([name]);
    }
    expect(JSON.parse(JSON.stringify(r))).toEqual(JSON.parse(JSON.stringify(run(SPECIAL.map((name, i) => entry({ entryId: `j${i}`, constant: true, position: 7, outletName: name, content: name })), []))));
  });

  it('特殊名称组合：书 ID、条目 ID、分组、Outlet、计时效果同时使用特殊名称', () => {
    const book = (entries: WorldbookEntry[]) => [{ bookId: '__proto__', versionId: 'constructor', entries }];
    const entries = [
      entry({ entryId: 'constructor', comment: 'toString', keys: ['码头'], group: '__proto__, toString', position: 7, outletName: 'constructor', content: '甲', sticky: 2 }),
      entry({ entryId: '__proto__', comment: 'valueOf', keys: ['码头'], group: '__proto__,constructor', position: 7, outletName: '__proto__', content: '乙' }),
      entry({ entryId: 'toString', constant: true, group: 'prototype', position: 7, outletName: 'hasOwnProperty', content: '丙' }),
    ];
    const first = run([], [], { books: book(entries), messages: ['码头'] });
    // 同组「__proto__」只留一条；「prototype」组只有一条，照常激活
    expect(first.activated.filter((a) => a.entryId !== 'toString')).toHaveLength(1);
    expect(first.activated.map((a) => a.entryId)).toContain('toString');
    expect(Object.getOwnPropertyDescriptor(first.plan.outlets, 'hasOwnProperty')?.value).toEqual(['丙']);
    expect(first.decisions.map((d) => d.reason).filter((x) => x === 'group_weighted')).toHaveLength(1);
    const again = run([], [], { books: book(entries), messages: ['茶馆'], messageCount: 3, timedState: first.nextTimedState });
    expect(JSON.parse(JSON.stringify(again.nextTimedState))).toEqual(again.nextTimedState);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('纯函数：预览不改变任何东西', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); }
    return value;
  }
  it('输入全部冻结也能运行；重复运行结果完全相同', () => {
    const input = deepFreeze({
      books: [{ bookId: 'book', versionId: 'v', entries: [entry({ keys: ['码头'], probability: 50, sticky: 2, group: 'g' }), entry({ keys: ['码头'], group: 'g', cooldown: 3 })] }],
      messages: ['码头'], contextTokens: 10_000, storyRemainingTokens: 5_000, trigger: 'normal' as const, messageCount: 5,
      timedState: { sticky: {}, cooldown: {} }, seed: 'freeze',
    });
    const a = runWorldbookTrigger(input), b = runWorldbookTrigger(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('2000 条 × 每条 20 个关键词、长文本，耗时可控', () => {
    const entries = Array.from({ length: 2000 }, (_, i) => entry({ keys: Array.from({ length: 20 }, (_, k) => `词${i}_${k}`) }));
    const started = Date.now();
    run(entries, ['码头'.repeat(5000), '茶馆'.repeat(5000)]);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
