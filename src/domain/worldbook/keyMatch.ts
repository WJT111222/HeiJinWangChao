import { classifyKey } from './regexKey';
import { PlainIndex } from './plainIndex';
import { compileSafeRegex, type SafeRegexReason } from './safeRegex';

/**
 * 关键词匹配（行为说明见 docs/WORLDBOOK_COMPATIBILITY.md「关键词匹配」）：
 * - 正则关键词：由安全子集判断，不受大小写与完整词设置影响；不在子集内的视为不命中并记录原因；
 * - 形似正则但无效的、普通文本：不区分大小写时两边转小写；完整词模式下，不含空白的关键词要求两侧
 *   是文本边界或非 [A-Za-z0-9_] 字符（因此对中文基本等同于包含匹配），含空白的关键词直接做包含判断。
 *
 * 所有匹配都先向 WorkMeter 预扣工作量，超出上限时抛出 ScanLimitReached，不执行这次匹配。
 * 工作量是确定性的计数（不是计时），同一输入永远得到同一结果。各类操作按实测耗时加权，
 * 使 1 个单位在参照机器上约等于或高于 1 纳秒（标定见 docs/WORLDBOOK_COMPATIBILITY.md「扫描工作量」）。
 */
export interface MatchOptions { caseSensitive: boolean; matchWholeWords: boolean }

/** 单次扫描工作量超限。由触发引擎捕获并转为可解释的诊断。 */
export class ScanLimitReached extends Error {
  constructor() { super('worldbook scan work limit reached'); }
}

/** 确定性的工作量计数器：先扣再做，超出上限时不做。 */
export class WorkMeter {
  used = 0;
  constructor(readonly limit: number) {}
  charge(units: number) {
    if (this.used + units > this.limit) throw new ScanLimitReached();
    this.used += units;
  }
}

/** 工作量权重（实测标定）。 */
export const WORK_WEIGHTS = {
  /** 未登记到索引的普通关键词（仅分组评分会用到）：逐字符计费，偏保守。 */
  fallbackChar: 4,
  /** 同上，完整词判断每找到一处候选位置。 */
  wholeWordOccurrence: 40,
  /** 文本转小写、拼接扫描文本：每字符 1 单位。 */
  textChar: 1,
  /** 安全正则：每个“字符 × 状态”步 20 单位（实测最坏约 17 纳秒）。 */
  regexStep: 20,
  /** 编译安全正则：每个状态 300 单位（实测约 200 纳秒）。 */
  regexCompileState: 300,
  /** 每判断一个条目的固定开销（实测约 1.6 微秒）。 */
  entry: 2_000,
  /** 每次关键词判断的固定开销（分类、转小写、查索引）。 */
  keyCheck: 800,
  /** 扫描前登记一个关键词。 */
  register: 300,
  /** 计算计时效果指纹：每个正文字符（实测约 14 纳秒）。 */
  fingerprintChar: 16,
  /** 分组：拆分组名字符串，每个字符。 */
  groupChar: 8,
  /** 分组：每个“条目 × 组名”成员（重复的组名每次出现都算），预付登记、Sticky / 计时筛选、移出与抽选的开销。 */
  groupMember: 800,
  /** 分组：每个不同的组名。 */
  group: 1_000,
  /** 分组：优先条目排序，每个比较步。 */
  groupSortStep: 100,
} as const;

const isWordCode = (c: number) => c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;

function wholeWordIncludes(haystack: string, needle: string, meter: WorkMeter): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    meter.charge(WORK_WEIGHTS.wholeWordOccurrence);
    const end = at + needle.length;
    const before = at === 0 || !isWordCode(haystack.charCodeAt(at - 1));
    const after = end === haystack.length || !isWordCode(haystack.charCodeAt(end));
    if (before && after) return true;
    from = at + 1;
    if (from > haystack.length) return false;
  }
}

type Compiled = { test: (text: string) => boolean; size: number };

export class KeyMatcher {
  private readonly regexCache = new Map<string, Compiled | SafeRegexReason>();
  /** 普通关键词索引：[区分大小写, 不区分大小写（关键词已转小写）]。 */
  private readonly plain = { sensitive: new PlainIndex(), insensitive: new PlainIndex() };
  private lowerSource: string | null = null;
  private lowerText = '';
  readonly unsupported = new Map<string, SafeRegexReason>();
  constructor(private readonly meter: WorkMeter) {}

  /** 扫描前登记普通关键词（已做宏替换与去空白）；之后对这些关键词的判断走一次扫描索引。 */
  register(needle: string, caseSensitive: boolean) {
    this.meter.charge(WORK_WEIGHTS.register);
    if (classifyKey(needle).kind === 'regex') return;
    if (caseSensitive) this.plain.sensitive.add(needle);
    else this.plain.insensitive.add(needle.toLowerCase());
  }

  /** 扫描文本转小写：同一段文本只转一次（计费一次）。 */
  private lower(text: string) {
    if (this.lowerSource !== text) {
      this.meter.charge(text.length * WORK_WEIGHTS.textChar);
      this.lowerText = text.toLowerCase();
      this.lowerSource = text;
    }
    return this.lowerText;
  }

  matches(haystack: string, needle: string, options: MatchOptions): boolean {
    this.meter.charge(WORK_WEIGHTS.keyCheck);
    const kind = classifyKey(needle);
    if (kind.kind === 'regex') {
      let compiled = this.regexCache.get(needle);
      if (compiled === undefined) {
        this.meter.charge(kind.source.length);
        const result = compileSafeRegex(kind.source, kind.flags);
        compiled = result.ok ? { test: result.test, size: result.size } : result.reason;
        this.regexCache.set(needle, compiled);
        if (typeof compiled !== 'string') this.meter.charge(compiled.size * WORK_WEIGHTS.regexCompileState);
      }
      if (typeof compiled === 'string') { this.unsupported.set(needle, compiled); return false; }
      this.meter.charge((haystack.length + 1) * compiled.size * WORK_WEIGHTS.regexStep);
      return compiled.test(haystack);
    }
    const text = options.caseSensitive ? haystack : this.lower(haystack);
    const key = options.caseSensitive ? needle : needle.toLowerCase();
    const useWhole = options.matchWholeWords && key.split(/\s+/).length === 1;
    const index = options.caseSensitive ? this.plain.sensitive : this.plain.insensitive;
    if (index.has(key)) {
      const hits = index.lookup(text, key, this.meter);
      return useWhole ? hits.whole : hits.any;
    }
    this.meter.charge((text.length + key.length) * WORK_WEIGHTS.fallbackChar);
    return useWhole ? wholeWordIncludes(text, key, this.meter) : text.includes(key);
  }
}
