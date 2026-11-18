import { KeyMatcher, type MatchOptions } from './keyMatch';
import type { SafeRegexReason } from './safeRegex';
import { ENTRY_POSITIONS, type WorldbookEntry } from './schema';
import { evaluateTimed, recordActivations, type TimedEntry, type TimedState } from './timedEffects';
import { conservativeTokens, entryFingerprint, parseDecorators, seededRandom } from './triggerSupport';

/**
 * 世界书触发引擎（阶段 B）：纯函数，不读写存档、不联网、不调用模型。
 *
 * 行为以 SillyTavern 1.19.0 为兼容参照，按 docs/WORLDBOOK_COMPATIBILITY.md「阶段 B」的行为说明独立实现。
 * 王朝适配的差异（计时单位、安全正则、硬预算上限、预览也读取计时状态）同样记录在该文档里。
 * 同一输入（含 seed）永远得到同一结果，因此触发预览与正式生成一致，且预览不会改变任何状态。
 */
export interface TriggerSettings {
  /** 默认扫描最近几条逻辑消息。 */
  scanDepth: number;
  /** 预算占模型上下文窗口的百分比。 */
  budgetPercent: number;
  /** 所有新增可选世界书合计的 Token 上限。 */
  budgetCap: number;
  recursive: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useGroupScoring: boolean;
  /** 0 表示不限（仍受引擎内部安全上限约束）。 */
  maxRecursionSteps: number;
  minActivations: number;
  minActivationsDepthMax: number;
}
export const DEFAULT_TRIGGER_SETTINGS: TriggerSettings = {
  scanDepth: 2, budgetPercent: 25, budgetCap: 4096, recursive: false, caseSensitive: false, matchWholeWords: false,
  useGroupScoring: false, maxRecursionSteps: 0, minActivations: 0, minActivationsDepthMax: 0,
};

export type TriggerMode = 'normal' | 'continue' | 'regenerate' | 'swipe' | 'impersonate' | 'quiet';
export interface TriggerBook { bookId: string; versionId: string; entries: readonly WorldbookEntry[] }
export interface TriggerInput {
  books: readonly TriggerBook[];
  /** 可扫描的逻辑消息，最新的在前（玩家行动、已结算正文等；不含隐藏状态）。 */
  messages: readonly string[];
  settings?: Partial<TriggerSettings>;
  /** 模型上下文窗口（Token）。 */
  contextTokens: number;
  /** Story 请求在基础提示词装配后实际剩余的输入预算（Token）。 */
  storyRemainingTokens: number;
  trigger: TriggerMode;
  /** 当前逻辑消息数，见 logicalMessageCount。 */
  messageCount: number;
  timedState: TimedState;
  /** 随机种子，例如“存档 + 回合 + 第几次尝试”。 */
  seed: string;
  estimateTokens?: (text: string) => number;
  /** 宏替换钩子；阶段 B 默认原样（宏解析与白名单在正文集成阶段设计）。 */
  substitute?: (text: string) => string;
}

export interface ActivatedEntry {
  key: string; bookId: string; versionId: string; entryId: string; comment: string;
  content: string; order: number; position: number; depth: number; role: number; outletName: string;
  tokens: number; loop: number; reason: DecisionReason; detail?: string;
  /** 是否进入了插入计划（正文为空、未知位置、Outlet 无名称时不进入）。 */
  placed: boolean;
}
export interface InjectionPlan {
  before: string[]; after: string[]; authorNoteTop: string[]; authorNoteBottom: string[];
  exampleMessages: Array<{ position: 'before' | 'after'; content: string }>;
  atDepth: Array<{ depth: number; role: number; contents: string[] }>;
  outlets: Record<string, string[]>;
}
export type DecisionReason =
  | 'constant' | 'sticky' | 'decorator_activate' | 'primary_match' | 'secondary_match'
  | 'disabled' | 'trigger_filtered' | 'delay' | 'cooldown' | 'delay_until_recursion' | 'exclude_recursion'
  | 'decorator_suppress' | 'no_keys' | 'no_primary_match' | 'secondary_failed'
  | 'group_sticky' | 'group_timed' | 'group_scoring' | 'group_already_active' | 'group_priority' | 'group_weighted'
  | 'probability_failed' | 'budget_exceeded' | 'hard_budget_exceeded' | 'not_scanned';
export const DECISION_TEXT: Record<DecisionReason, string> = {
  constant: '常驻条目', sticky: 'Sticky 持续中', decorator_activate: '正文开头 @@activate 强制激活',
  primary_match: '命中主关键词', secondary_match: '命中主关键词且满足副关键词逻辑',
  disabled: '条目已停用', trigger_filtered: '触发模式不符', delay: '延迟期内', cooldown: '冷却期内',
  delay_until_recursion: '等待递归层级', exclude_recursion: '不可被递归激活', decorator_suppress: '正文开头 @@dont_activate 抑制',
  no_keys: '没有关键词', no_primary_match: '未命中主关键词', secondary_failed: '副关键词逻辑不满足',
  group_sticky: '同组有 Sticky 条目', group_timed: '冷却或延迟中，被移出分组', group_scoring: '分组评分较低',
  group_already_active: '同组已有条目激活', group_priority: '同组有优先条目', group_weighted: '分组按权重抽选未中',
  probability_failed: '概率检定未通过', budget_exceeded: '超出世界书预算', hard_budget_exceeded: '超出王朝硬性 Token 上限',
  not_scanned: '扫描已结束，未轮到该条目',
};
export interface EntryDecision {
  key: string; bookId: string; entryId: string; comment: string;
  status: 'activated' | 'not_activated';
  reason: DecisionReason; detail?: string; loop?: number;
}
export interface TriggerResult {
  activated: ActivatedEntry[];
  plan: InjectionPlan;
  /** 每个条目一条，按扫描顺序。 */
  decisions: EntryDecision[];
  budget: { soft: number; hard: number; limit: number; used: number; overflowed: boolean };
  loops: number;
  /** 不在安全子集内、因此未运行的正则关键词。 */
  unsupportedKeys: Array<{ key: string; reason: SafeRegexReason }>;
  /** 本次生成若正式结算，应保存的计时状态。预览、失败、取消、重试时丢弃即可。 */
  nextTimedState: TimedState;
}

const Scan = { None: 0, Initial: 1, Recursion: 2, MinActivations: 3 } as const;
type Scan = typeof Scan[keyof typeof Scan];
const MAX_SCAN_MESSAGES = 1000;

interface Item {
  key: string; bookId: string; versionId: string; entry: WorldbookEntry;
  content: string; decorators: string[]; index: number; fingerprint: string; level: number;
}
const levelOf = (value: boolean | number) => value === true ? 1 : value === false ? 0 : value;

export function runWorldbookTrigger(input: TriggerInput): TriggerResult {
  const settings: TriggerSettings = { ...DEFAULT_TRIGGER_SETTINGS, ...input.settings };
  const estimate = input.estimateTokens ?? conservativeTokens;
  const substitute = input.substitute ?? ((text: string) => text);
  const rng = seededRandom(input.seed);
  const matcher = new KeyMatcher();

  // 1. 合并所有书的条目，按 order 从高到低稳定排序；解析正文开头的前缀指令。
  const merged: Item[] = [];
  for (const book of input.books) for (const entry of book.entries) {
    const parsed = parseDecorators(entry.content);
    merged.push({
      key: `${book.bookId}#${entry.entryId}`, bookId: book.bookId, versionId: book.versionId, entry,
      content: parsed.content, decorators: parsed.decorators, index: 0,
      fingerprint: entryFingerprint(book.bookId, entry), level: levelOf(entry.delayUntilRecursion),
    });
  }
  const items = merged.map((item, i) => ({ item, i })).sort((a, b) => b.item.entry.order - a.item.entry.order || a.i - b.i).map(({ item }) => item);
  items.forEach((item, index) => { item.index = index; });
  const timedEntries = new Map<string, TimedEntry>(items.map((item) => [item.key, {
    key: item.key, fingerprint: item.fingerprint, sticky: item.entry.sticky, cooldown: item.entry.cooldown, delay: item.entry.delay,
  }]));

  // 2. 计时效果（只读输入状态）。
  const timed = evaluateTimed(input.timedState, [...timedEntries.values()], input.messageCount);
  const isSticky = (item: Item) => timed.sticky.has(item.key);

  // 3. 预算：酒馆语义的软预算 + 王朝硬上限（合计上限与 Story 剩余预算取小）。
  const soft = Math.round(settings.budgetPercent * input.contextTokens / 100) || 1;
  const hard = Math.max(0, Math.floor(Math.min(settings.budgetCap, input.storyRemainingTokens)));
  const budget = Math.min(soft, hard);
  let used = 0, overflowed = false;

  const decisions = new Map<string, EntryDecision>();
  const decide = (item: Item, reason: DecisionReason, loop: number, detail?: string, status: EntryDecision['status'] = 'not_activated') => {
    decisions.set(item.key, {
      key: item.key, bookId: item.bookId, entryId: item.entry.entryId, comment: item.entry.comment,
      status, reason, loop, ...(detail !== undefined ? { detail } : {}),
    });
  };
  for (const item of items) decide(item, 'not_scanned', 0);

  const messages = input.messages.slice(0, MAX_SCAN_MESSAGES).map((m) => m.trim());
  const recurse: string[] = [];
  let skew = 0;
  const scanText = (item: Item, state: Scan) => {
    let depth = item.entry.scanDepth ?? settings.scanDepth + skew;
    if (depth <= 0) return '';
    depth = Math.min(depth, MAX_SCAN_MESSAGES);
    let text = `\u0001${messages.slice(0, depth).join('\n\u0001')}`;
    if (recurse.length && state !== Scan.MinActivations) text += `\n\u0001${recurse.join('\n\u0001')}`;
    return text;
  };
  const optionsOf = (item: Item): MatchOptions => ({
    caseSensitive: item.entry.caseSensitive ?? settings.caseSensitive,
    matchWholeWords: item.entry.matchWholeWords ?? settings.matchWholeWords,
  });
  const keyHits = (text: string, key: string, options: MatchOptions) => {
    const substituted = substitute(key);
    return !!substituted && matcher.matches(text, substituted.trim(), options);
  };
  /** 分组评分：命中的主关键词数（满足条件时加上副关键词数）。不做宏替换与去空白，与参照版本一致。 */
  const score = (item: Item, state: Scan) => {
    const text = scanText(item, state), options = optionsOf(item), { keys, secondaryKeys, selectiveLogic } = item.entry;
    if (!keys.length) return 0;
    const primary = keys.filter((k) => matcher.matches(text, k, options)).length;
    const secondary = secondaryKeys.filter((k) => matcher.matches(text, k, options)).length;
    if (secondaryKeys.length) {
      if (selectiveLogic === 0) return primary + secondary;
      if (selectiveLogic === 3) return secondary === secondaryKeys.length ? primary + secondary : primary;
    }
    return primary;
  };

  const activated = new Map<string, { item: Item; content: string; tokens: number; loop: number; reason: DecisionReason; detail?: string }>();
  const failedProbability = new Set<string>();
  let allActivatedText = '';
  const delayLevels = [...new Set(items.filter((i) => i.entry.delayUntilRecursion).map((i) => i.level))].sort((a, b) => a - b);
  let currentLevel = delayLevels.shift() ?? 0;
  const safetyLimit = items.length + delayLevels.length + messages.length + 5;

  let state: Scan = Scan.Initial;
  let loop = 0;
  while (state !== Scan.None) {
    if (settings.maxRecursionSteps && settings.maxRecursionSteps <= loop) break;
    if (loop >= safetyLimit) break;
    loop++;
    let next: Scan = Scan.None;
    const found: Array<{ item: Item; reason: DecisionReason; detail?: string }> = [];

    // 4. 找出本轮可以激活的条目。
    for (const item of items) {
      if (failedProbability.has(item.key) || activated.has(item.key)) continue;
      const e = item.entry;
      if (e.disabled) { decide(item, 'disabled', loop); continue; }
      if (e.triggers.length && !e.triggers.includes(input.trigger)) { decide(item, 'trigger_filtered', loop); continue; }
      const sticky = isSticky(item);
      if (timed.delay.has(item.key)) { decide(item, 'delay', loop); continue; }
      if (timed.cooldown.has(item.key) && !sticky) { decide(item, 'cooldown', loop); continue; }
      if (state !== Scan.Recursion && e.delayUntilRecursion && !sticky) { decide(item, 'delay_until_recursion', loop); continue; }
      if (state === Scan.Recursion && e.delayUntilRecursion && item.level > currentLevel && !sticky) { decide(item, 'delay_until_recursion', loop, `层级 ${item.level}`); continue; }
      if (state === Scan.Recursion && settings.recursive && e.excludeRecursion && !sticky) { decide(item, 'exclude_recursion', loop); continue; }
      if (item.decorators.includes('@@activate')) { found.push({ item, reason: 'decorator_activate' }); continue; }
      if (item.decorators.includes('@@dont_activate')) { decide(item, 'decorator_suppress', loop); continue; }
      if (e.constant) { found.push({ item, reason: 'constant' }); continue; }
      if (sticky) { found.push({ item, reason: 'sticky' }); continue; }
      if (!e.keys.length) { decide(item, 'no_keys', loop); continue; }
      const text = scanText(item, state), options = optionsOf(item);
      const primary = e.keys.find((k) => keyHits(text, k, options));
      if (primary === undefined) { decide(item, 'no_primary_match', loop); continue; }
      if (!(e.selective && e.secondaryKeys.length)) { found.push({ item, reason: 'primary_match', detail: primary }); continue; }
      const hits = e.secondaryKeys.map((k) => keyHits(text, k, options));
      const ok = e.selectiveLogic === 0 ? hits.some(Boolean)
        : e.selectiveLogic === 1 ? hits.some((hit) => !hit)
        : e.selectiveLogic === 2 ? !hits.some(Boolean)
        : e.selectiveLogic === 3 ? hits.every(Boolean)
        : false;
      if (!ok) { decide(item, 'secondary_failed', loop, primary); continue; }
      found.push({ item, reason: 'secondary_match', detail: primary });
    }

    // 5. 排序（Sticky 优先，其余保持扫描顺序）→ 分组互斥 → 概率与预算。
    const candidates = found.slice().sort((a, b) => Number(isSticky(b.item)) - Number(isSticky(a.item)) || a.item.index - b.item.index);
    const why = new Map(candidates.map((c) => [c.item.key, c]));
    const list = candidates.map((c) => c.item);
    filterGroups(list, state);

    const allTokens = estimate(allActivatedText);
    let pending = '';
    let ignoresLeft = list.filter((i) => i.entry.ignoreBudget).length;
    for (let k = 0; k < list.length; k++) {
      const item = list[k], e = item.entry;
      if (e.ignoreBudget) ignoresLeft--;
      if (overflowed && !e.ignoreBudget) {
        decide(item, 'budget_exceeded', loop);
        if (ignoresLeft > 0) continue;
        for (const rest of list.slice(k + 1)) decide(rest, 'budget_exceeded', loop);
        break;
      }
      if (e.useProbability && e.probability !== 100 && !isSticky(item)) {
        const roll = rng() * 100;
        if (!(roll <= e.probability)) { failedProbability.add(item.key); decide(item, 'probability_failed', loop, `掷出 ${roll.toFixed(2)}，需要 ≤ ${e.probability}`); continue; }
      }
      item.content = substitute(item.content);
      pending += `${item.content}\n`;
      if (!e.ignoreBudget && allTokens + estimate(pending) >= budget) {
        overflowed = true;
        decide(item, 'budget_exceeded', loop, `预算 ${budget}`);
        continue;
      }
      const tokens = estimate(item.content) + 1;
      if (used + tokens > hard) {
        if (!e.ignoreBudget) overflowed = true;
        decide(item, 'hard_budget_exceeded', loop, `上限 ${hard}，已用 ${used}，本条约 ${tokens}`);
        continue;
      }
      used += tokens;
      const reason = why.get(item.key)!;
      activated.set(item.key, { item, content: item.content, tokens, loop, reason: reason.reason, ...(reason.detail !== undefined ? { detail: reason.detail } : {}) });
      decide(item, reason.reason, loop, reason.detail, 'activated');
    }

    // 6. 决定是否继续扫描（递归、最少激活数、延迟到递归的层级）。
    const successful = list.filter((i) => !failedProbability.has(i.key));
    const forRecursion = successful.filter((i) => !i.entry.preventRecursion);
    if (settings.recursive && !overflowed && forRecursion.length) next = Scan.Recursion;
    if (settings.recursive && !overflowed && state === Scan.MinActivations && recurse.length) next = Scan.Recursion;
    if (next === Scan.None && !overflowed && settings.minActivations > 0 && activated.size < settings.minActivations) {
      const depth = settings.scanDepth + skew;
      const overMax = settings.minActivationsDepthMax > 0 && depth > settings.minActivationsDepthMax || depth > input.messages.length;
      if (!overMax) { next = Scan.MinActivations; skew++; }
    }
    if (next === Scan.None && delayLevels.length) { next = Scan.Recursion; currentLevel = delayLevels.shift()!; }
    state = next;
    if (state !== Scan.None) {
      const text = forRecursion.map((i) => i.content).join('\n');
      if (text) { recurse.push(text); allActivatedText = `${text}\n${allActivatedText}`; }
    }
  }

  // 7. 插入计划：按 order 从高到低处理，各位置内越靠后越接近生成点（与参照版本一致）。
  const plan: InjectionPlan = { before: [], after: [], authorNoteTop: [], authorNoteBottom: [], exampleMessages: [], atDepth: [], outlets: {} };
  const placed = new Set<string>();
  const ordered = [...activated.values()].map((a, i) => ({ a, i })).sort((x, y) => y.a.item.entry.order - x.a.item.entry.order || x.i - y.i).map(({ a }) => a);
  for (const { item, content } of ordered) {
    if (!content) continue;
    const e = item.entry;
    switch (e.position) {
      case ENTRY_POSITIONS.before: plan.before.unshift(content); break;
      case ENTRY_POSITIONS.after: plan.after.unshift(content); break;
      case ENTRY_POSITIONS.authorNoteTop: plan.authorNoteTop.unshift(content); break;
      case ENTRY_POSITIONS.authorNoteBottom: plan.authorNoteBottom.unshift(content); break;
      case ENTRY_POSITIONS.exampleTop: plan.exampleMessages.unshift({ position: 'before', content }); break;
      case ENTRY_POSITIONS.exampleBottom: plan.exampleMessages.unshift({ position: 'after', content }); break;
      case ENTRY_POSITIONS.atDepth: {
        const group = plan.atDepth.find((g) => g.depth === e.depth && g.role === e.role);
        if (group) group.contents.unshift(content); else plan.atDepth.push({ depth: e.depth, role: e.role, contents: [content] });
        break;
      }
      case ENTRY_POSITIONS.outlet:
        if (!e.outletName) continue;
        (plan.outlets[e.outletName] ??= []).push(content);
        break;
      default: continue;
    }
    placed.add(item.key);
  }

  const activatedList: ActivatedEntry[] = [...activated.values()].map(({ item, content, tokens, loop: at, reason, detail }) => ({
    key: item.key, bookId: item.bookId, versionId: item.versionId, entryId: item.entry.entryId, comment: item.entry.comment,
    content, order: item.entry.order, position: item.entry.position, depth: item.entry.depth, role: item.entry.role,
    outletName: item.entry.outletName, tokens, loop: at, reason, ...(detail !== undefined ? { detail } : {}), placed: placed.has(item.key),
  }));
  const nextTimedState = recordActivations(timed.working, [...activated.keys()].map((key) => timedEntries.get(key)!), input.messageCount);

  return {
    activated: activatedList,
    plan,
    decisions: items.map((item) => decisions.get(item.key)!),
    budget: { soft, hard, limit: budget, used, overflowed },
    loops: loop,
    unsupportedKeys: [...matcher.unsupported].map(([key, reason]) => ({ key, reason })),
    nextTimedState,
  };

  /**
   * 分组互斥（就地修改 list）。组名按逗号拆分，一个条目可属于多个组。
   * 有意与参照版本不同的一处：移出列表时如果条目已经不在列表里，什么也不做
   * （参照版本此时会误删列表最后一个无关条目）。
   */
  function filterGroups(list: Item[], scanState: Scan) {
    const groups: Record<string, Item[]> = Object.create(null);
    for (const item of list) {
      if (!item.entry.group) continue;
      for (const name of item.entry.group.split(/,\s*/).filter(Boolean)) (groups[name] ??= []).push(item);
    }
    const names = Object.keys(groups);
    if (!names.length) return;
    const remove = (item: Item, reason: DecisionReason, detail?: string) => {
      const at = list.indexOf(item);
      if (at < 0) return;
      list.splice(at, 1);
      decide(item, reason, loop, detail);
    };
    const removeAllBut = (group: Item[], keep: Item | null, reason: DecisionReason, name: string) => {
      for (const item of group) if (item !== keep) remove(item, reason, `组「${name}」`);
    };
    // 计时效果：有 Sticky 的组只留 Sticky 条目；冷却、延迟中的条目移出。
    const hasSticky = new Map<string, boolean>();
    for (const name of names) {
      const group = groups[name];
      const stickies = group.filter(isSticky);
      hasSticky.set(name, stickies.length > 0);
      if (stickies.length) for (const item of group) if (!stickies.includes(item)) remove(item, 'group_sticky', `组「${name}」`);
      for (const item of group) if (timed.cooldown.has(item.key) || timed.delay.has(item.key)) remove(item, 'group_timed', `组「${name}」`);
    }
    // 分组评分：只保留得分最高的条目（仅对开启评分的条目生效）。
    for (const name of names) {
      const group = groups[name];
      if (!settings.useGroupScoring && !group.some((i) => i.entry.useGroupScoring)) continue;
      if (hasSticky.get(name)) continue;
      const scores = group.map((item) => score(item, scanState));
      const max = Math.max(...scores);
      for (let k = 0; k < group.length; k++) {
        if (!(group[k].entry.useGroupScoring ?? settings.useGroupScoring)) continue;
        if (scores[k] < max) {
          remove(group[k], 'group_scoring', `组「${name}」得分 ${scores[k]} < ${max}`);
          group.splice(k, 1); scores.splice(k, 1); k--;
        }
      }
    }
    for (const name of names) {
      const group = groups[name];
      if (hasSticky.get(name)) continue;
      // 与参照版本一致：拿已激活条目的完整组字符串与组名比较（多组条目因此可能不被识别）。
      if ([...activated.values()].some((a) => a.item.entry.group === name)) { removeAllBut(group, null, 'group_already_active', name); continue; }
      if (group.length <= 1) continue;
      const priority = group.filter((i) => i.entry.groupOverride).map((item, i) => ({ item, i }))
        .sort((a, b) => b.item.entry.order - a.item.entry.order || a.i - b.i).map(({ item }) => item);
      if (priority.length) { removeAllBut(group, priority[0], 'group_priority', name); continue; }
      const total = group.reduce((sum, item) => sum + (item.entry.groupWeight ?? 100), 0);
      const roll = rng() * total;
      let acc = 0, winner: Item | null = null;
      for (const item of group) {
        acc += item.entry.groupWeight ?? 100;
        if (roll <= acc) { winner = item; break; }
      }
      if (!winner) continue;
      removeAllBut(group, winner, 'group_weighted', name);
    }
  }
}
