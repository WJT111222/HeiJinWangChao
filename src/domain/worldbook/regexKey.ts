/**
 * 关键词是否按正则处理（行为说明见 docs/WORLDBOOK_COMPATIBILITY.md「正则关键词」）：
 * - 整个关键词形如 `/内容/标志`，标志只能是 g i m s u y；
 * - 内容里出现未转义的 `/` 时不算正则；
 * - 内容里第一处 `\/` 还原为 `/`（参照版本只还原第一处，这里保持一致）；
 * - 构造失败（语法错误、标志重复等）时按普通文本匹配。
 * 阶段 A 只做分类和安全预检，不用它匹配任何文本。
 */
export type KeyKind =
  | { kind: 'text' }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'invalid-regex' };

const REGEX_LITERAL = /^\/([\s\S]+?)\/([gimsuy]*)$/;
const UNESCAPED_SLASH = /(^|[^\\])\//;

export function classifyKey(key: string): KeyKind {
  const literal = REGEX_LITERAL.exec(key);
  if (!literal) return { kind: 'text' };
  const [, body, flags] = literal;
  if (UNESCAPED_SLASH.test(body)) return { kind: 'invalid-regex' };
  const source = body.replace('\\/', '/');
  try {
    new RegExp(source, flags);
    return { kind: 'regex', source, flags };
  } catch {
    return { kind: 'invalid-regex' };
  }
}

export const MAX_REGEX_SOURCE_CHARS = 1_000;
/** 括号内含重复量词、括号外又跟重复量词，例如 (a+)+、(x*)*、(\w+){2,}。 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)[*+{]/;
const BACKREFERENCE = /\\[1-9]|\\k</;

/** 静态预检：只给出提示，是否在触发时跳过由阶段 B 决定。 */
export function regexRisk(source: string): 'too-long' | 'risky' | null {
  if (source.length > MAX_REGEX_SOURCE_CHARS) return 'too-long';
  if (NESTED_QUANTIFIER.test(source) || BACKREFERENCE.test(source)) return 'risky';
  return null;
}
