import { failure, inputFailure, positionAt, variableTextLimits } from './common';
import type { ParseResult, SourceSpan } from './common';
export interface CommandBlock { text: string; source: SourceSpan }

/** 外围标签内容只供隔离；不会被解释为命令。命令块中JSON字符串内的标签是普通数据。 */
export function extractCommandBlock(text: string): ParseResult<CommandBlock> {
  const invalid = inputFailure(text);
  if (invalid) return invalid;
  const tag = /<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)>/uy;
  let ignored: { name: string; depth: number } | undefined;
  let start: number | undefined, end: number | undefined;
  let inCommand = false, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inCommand && inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      // 裸换行本身是非法JSON；交给值解析器报错，不让坏引号吞掉后续真实结束标签。
      else if (char === '\n' || char === '\r') inString = false;
      continue;
    }
    if (inCommand && char === '"') { inString = true; continue; }
    if (char !== '<') continue;
    tag.lastIndex = i;
    const match = tag.exec(text);
    if (!match) {
      if (!ignored && /^<\/?[\p{L}_]/u.test(text.slice(i))) return failure('block_structure', text, i);
      continue;
    }
    const close = match[1] === '/', name = match[2];
    if (ignored) {
      // 其他区块中的<命令>示例完全不参与命令块结构或唯一性判断。
      if (name === ignored.name) {
        if (close) { if (--ignored.depth === 0) ignored = undefined; }
        else if (++ignored.depth > variableTextLimits.blockDepth) return failure('limit_exceeded', text, i, 'blockDepth');
      }
    } else if (inCommand) {
      if (name !== '命令' || !close) return failure('block_structure', text, i);
      end = i;
      inCommand = false;
    } else if (name === '命令') {
      if (close || start !== undefined) return failure('block_structure', text, i);
      start = tag.lastIndex;
      inCommand = true;
    } else {
      if (close) return failure('block_structure', text, i);
      ignored = { name, depth: 1 };
    }
    i = tag.lastIndex - 1;
  }
  if (inCommand || ignored) return failure('block_structure', text, text.length);
  if (start === undefined || end === undefined) return failure('missing_block', text);
  return { ok: true, value: { text: text.slice(start, end), source: { start: positionAt(text, start), end: positionAt(text, end) } } };
}
