import { cleanKeys } from './release';

/**
 * 关键词在编辑框里的文字表示，格式化与解析互逆（parseKeys(formatKeys(k)) 等于 cleanKeys(k)）。
 *
 * - 分隔符：英文逗号、中文逗号、顿号、换行。
 * - 完整的正则字面量（/…/标志）整体作为一个关键词：里面的逗号（如量词 {1,2}、字符类 [，,]）不分隔，原样保留；
 *   正则里的反斜杠转义按正则规则跳过下一个字符，字符类里的斜杠不结束正则。
 * - 普通关键词里的分隔符写成「\,」「\，」「\、」；只有紧跟分隔符、反斜杠或位于末尾的反斜杠才写成「\\」，
 *   其他反斜杠原样保留（例如 a\b）。
 * - 首尾空白、空项、重复项按 cleanKeys 整理：匹配时本来就去掉首尾空白、跳过空项，重复不影响结果。
 */
const isSeparator = (c: string | undefined) => c === ',' || c === '，' || c === '、' || c === '\n';
const isBlank = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '　';

/** text 从 start 起若是完整的 /…/标志 正则字面量，返回其结束位置（不含）；否则返回 -1。 */
function scanRegexLiteral(text: string, start: number): number {
  if (text[start] !== '/') return -1;
  let i = start + 1, inClass = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') return -1;
    if (c === '\\') { if (text[i + 1] === '\n' || i + 1 >= text.length) return -1; i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') break;
  }
  if (i >= text.length || i === start + 1) return -1; // 没有闭合或空正则「//」
  i++;
  while (i < text.length && /[a-z]/i.test(text[i])) i++;
  return i;
}

function formatKey(key: string): string {
  if (scanRegexLiteral(key, 0) === key.length) return key;
  let out = '';
  for (let i = 0; i < key.length; i++) {
    const c = key[i];
    if (isSeparator(c)) out += `\\${c}`;
    else if (c === '\\' && (i + 1 === key.length || isSeparator(key[i + 1]) || key[i + 1] === '\\')) out += '\\\\';
    else out += c;
  }
  return out;
}

/** 关键词数组 → 编辑框文字（用中文逗号分隔）。 */
export function formatKeys(keys: readonly string[]): string {
  return keys.map(formatKey).join('，');
}

/** 编辑框文字 → 关键词数组。 */
export function parseKeys(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && isBlank(text[i])) i++;
    if (i >= text.length) break;
    if (isSeparator(text[i])) { i++; continue; }
    const end = scanRegexLiteral(text, i);
    if (end > 0) {
      let j = end;
      while (j < text.length && isBlank(text[j])) j++;
      if (j >= text.length || isSeparator(text[j])) { out.push(text.slice(i, end)); i = j + 1; continue; }
    }
    let token = '';
    while (i < text.length && !isSeparator(text[i])) {
      const c = text[i], next = text[i + 1];
      if (c === '\\' && (isSeparator(next) || next === '\\')) { token += next; i += 2; }
      else { token += c; i++; }
    }
    i++;
    out.push(token);
  }
  return cleanKeys(out);
}
