import { classifyKey } from './regexKey';
import { compileSafeRegex, type SafeRegexReason } from './safeRegex';

/**
 * 关键词匹配（行为说明见 docs/WORLDBOOK_COMPATIBILITY.md「关键词匹配」）：
 * - 正则关键词：由安全子集判断，不受大小写与完整词设置影响；不在子集内的视为不命中并记录原因；
 * - 形似正则但无效的、普通文本：不区分大小写时两边转小写；完整词模式下，不含空白的关键词要求两侧
 *   是文本边界或非 [A-Za-z0-9_] 字符（因此对中文基本等同于包含匹配），含空白的关键词直接做包含判断。
 */
export interface MatchOptions { caseSensitive: boolean; matchWholeWords: boolean }
export interface UnsupportedKey { key: string; reason: SafeRegexReason }

const isWordCode = (c: number) => c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;

function wholeWordIncludes(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const end = at + needle.length;
    const before = at === 0 || !isWordCode(haystack.charCodeAt(at - 1));
    const after = end === haystack.length || !isWordCode(haystack.charCodeAt(end));
    if (before && after) return true;
    from = at + 1;
    if (from > haystack.length) return false;
  }
}

export class KeyMatcher {
  private readonly regexCache = new Map<string, ((text: string) => boolean) | SafeRegexReason>();
  readonly unsupported = new Map<string, SafeRegexReason>();

  matches(haystack: string, needle: string, options: MatchOptions): boolean {
    const kind = classifyKey(needle);
    if (kind.kind === 'regex') {
      let compiled = this.regexCache.get(needle);
      if (compiled === undefined) {
        const result = compileSafeRegex(kind.source, kind.flags);
        compiled = result.ok ? result.test : result.reason;
        this.regexCache.set(needle, compiled);
      }
      if (typeof compiled === 'string') { this.unsupported.set(needle, compiled); return false; }
      return compiled(haystack);
    }
    const text = options.caseSensitive ? haystack : haystack.toLowerCase();
    const key = options.caseSensitive ? needle : needle.toLowerCase();
    if (!options.matchWholeWords) return text.includes(key);
    return key.split(/\s+/).length > 1 ? text.includes(key) : wholeWordIncludes(text, key);
  }
}
