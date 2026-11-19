import { extractCommandBlock, parseVariableText, variableTextLimits } from './index';
import { failure, positionAt } from './common';
import type { ParsedVariableCommand, ParseResult } from './common';

export interface VariableStatement { text: string; ast?: ParsedVariableCommand }

/** Split only at top-level physical line boundaries; never recover an ambiguous tail. */
export function variableStatements(text: string): ParseResult<VariableStatement[]> {
  const block = extractCommandBlock(text);
  if (!block.ok) return block;
  const { text: body, source } = block.value;
  const statements: VariableStatement[] = [];
  const closers: string[] = [];
  let quoted = false, escaped = false, start = 0;
  const error = (offset: number) => failure('json_value', text, source.start.offset + offset);
  function add(end: number) {
    const statement = body.slice(start, end);
    if (!statement.trim()) return;
    const prefix = '<命令>';
    const parsed = parseVariableText(prefix + statement + '</命令>');
    const ast = parsed.ok && parsed.value.length === 1 ? parsed.value[0] : undefined;
    if (ast) {
      const base = source.start.offset + start - prefix.length;
      ast.source = {
        start: positionAt(text, base + ast.source.start.offset),
        end: positionAt(text, base + ast.source.end.offset),
      };
    }
    statements.push({ text: statement, ast });
  }
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '\r' || char === '\n') return error(i);
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (closers.length >= variableTextLimits.jsonDepth) return error(i);
      closers.push(char === '{' ? '}' : ']');
    } else if (char === '}' || char === ']') {
      if (closers.pop() !== char) return error(i);
    } else if ((char === '\n' || char === '\r') && closers.length === 0) {
      // A value may start on the next line after '='.
      if (body.slice(start, i).trimEnd().endsWith('=')) continue;
      add(i);
      start = i + 1;
    }
  }
  if (quoted || closers.length || body.slice(start).trimEnd().endsWith('=')) return error(body.length);
  add(body.length);
  if (statements.length > variableTextLimits.commandCount)
    return failure('limit_exceeded', text, source.start.offset, 'commandCount');
  return { ok: true, value: statements };
}
