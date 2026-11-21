import { canonicalJson } from './canonical';

/**
 * 触发引擎的小工具：可复现的随机数、同步内容指纹、保守 Token 估算、条目开头的前缀指令。
 */

/** 53 位字符串哈希（同步，用于随机种子和计时效果的条目指纹；不用于安全用途）。 */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 由种子字符串得到 [0, 1) 的确定性随机序列。同一种子、同一输入，结果完全相同（预览与正式生成一致）。 */
export function seededRandom(seed: string): () => number {
  let state = hash53(seed) >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 计时效果用的条目指纹：书 ID + 条目全部内容。条目被修改后指纹变化，旧效果不再作用于它。 */
export function entryFingerprint(bookId: string, entry: unknown): string {
  return hash53(canonicalJson({ bookId, entry })).toString(36);
}

/**
 * 保守的 Token 估算：ASCII 每 3 个字符算 1，其余字符每个算 1.5，向上取整。
 * 比项目现有估算（ASCII 每 4 个算 1）更宁多勿少，避免世界书挤爆请求。
 */
export interface CharCounts { ascii: number; other: number }
/** 按码点分类计数：ASCII（< 128）与其他。 */
export function countChars(text: string): CharCounts {
  let ascii = 0, other = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 128) ascii++;
    else other++;
  }
  return { ascii, other };
}
/** 保守估算的取整公式。计数可以分段累加（拼接处不拆开代理对时），结果与整段计算相同。 */
export const tokensOf = (counts: CharCounts) => Math.ceil(counts.ascii / 3 + counts.other * 1.5);
export function conservativeTokens(text: string): number {
  return tokensOf(countChars(text));
}

const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];

/**
 * 条目正文开头的前缀指令（行为说明见 docs/WORLDBOOK_COMPATIBILITY.md「前缀指令」）：
 * 只有正文以 @@ 开头时才解析；从第一行起逐行读，直到遇到第一行不以 @@ 开头的内容，其后为正文。
 * - 已知指令（以 @@activate / @@dont_activate 开头）记入列表；
 * - 以 @@@ 开头的行：前一行是未知指令时去掉一个 @ 再判断，否则忽略；
 * - 其余以 @@ 开头的行是未知指令，丢弃；
 * - 如果每一行都以 @@ 开头，正文保持原样（参照版本如此）。
 * 只有与 @@activate / @@dont_activate 完全相同的行才生效。
 */
export function parseDecorators(content: string): { decorators: string[]; content: string } {
  if (!content.startsWith('@@')) return { decorators: [], content };
  const lines = content.split('\n');
  const decorators: string[] = [];
  let afterUnknown = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('@@')) return { decorators, content: lines.slice(i).join('\n') };
    if (line.startsWith('@@@') && !afterUnknown) continue;
    const candidate = line.startsWith('@@@') ? line.slice(1) : line;
    if (KNOWN_DECORATORS.some((known) => candidate.startsWith(known))) {
      decorators.push(candidate);
      afterUnknown = false;
    } else afterUnknown = true;
  }
  return { decorators, content };
}
