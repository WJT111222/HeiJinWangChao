import { failure, inputFailure, variableTextLimits } from './common';
import type { ParsedVariablePath, ParseResult } from './common';
const identifier = /^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u;
const entityId = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_.:-]*$/u;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/** 数字索引仅为语法，不授予对真实实体使用可变索引的写权限。 */
export function parseVariablePath(text: string): ParseResult<ParsedVariablePath> {
  const invalid = inputFailure(text);
  if (invalid) return invalid;
  if (text.length > variableTextLimits.pathLength) return failure('limit_exceeded', text, 0, 'pathLength');
  const rootEnd = text.search(/[.[]/u), stop = rootEnd < 0 ? text.length : rootEnd;
  const root = text.slice(0, stop);
  if (forbidden.has(root)) return failure('unsafe_path', text);
  if (!identifier.test(root)) return failure('path_syntax', text);
  const path: ParsedVariablePath = { nodes: [{ kind: 'root', name: root }] };
  let index = stop;
  while (index < text.length) {
    const offset = index;
    if (path.nodes.length >= variableTextLimits.pathDepth) return failure('limit_exceeded', text, offset, 'pathDepth');
    if (text[index] === '.') {
      index++;
      const start = index;
      while (index < text.length && text[index] !== '.' && text[index] !== '[') index++;
      const name = text.slice(start, index);
      if (forbidden.has(name)) return failure('unsafe_path', text, start);
      if (!identifier.test(name)) return failure('path_syntax', text, start);
      path.nodes.push({ kind: 'field', name });
    } else if (text[index] === '[') {
      const end = text.indexOf(']', index + 1);
      if (end < 0) return failure('path_syntax', text, index);
      const id = text.slice(index + 1, end);
      if (forbidden.has(id)) return failure('unsafe_path', text, index + 1);
      if (/^[0-9]+$/u.test(id)) {
        const value = Number(id);
        if (!/^(?:0|[1-9][0-9]*)$/u.test(id) || !Number.isSafeInteger(value)) return failure('path_syntax', text, index + 1);
        path.nodes.push({ kind: 'index', index: value });
      } else {
        if (!entityId.test(id) || /^[0-9]+\.[0-9]+$/u.test(id)) return failure('path_syntax', text, index + 1);
        path.nodes.push({ kind: 'id', id });
      }
      index = end + 1;
      if (index < text.length && text[index] !== '.' && text[index] !== '[') return failure('path_syntax', text, index);
    } else return failure('path_syntax', text, index);
  }
  return { ok: true, value: path };
}
