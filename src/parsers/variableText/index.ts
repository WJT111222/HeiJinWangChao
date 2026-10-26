import { extractCommandBlock } from './block';
import { failure, positionAt, skipWhitespace, variableTextLimits } from './common';
import type { ParsedVariableCommand, ParseResult } from './common';
import { parseVariablePath } from './path';
import { readJsonValue } from './value';
export { extractCommandBlock } from './block';
export { parseVariablePath } from './path';
export { parseJsonValue } from './value';
export { variableTextLimits } from './common';
export type { JsonValue, ParsedVariableCommand, ParsedVariablePath, ParseError, ParseErrorCode, ParseResult,
  ParserLimit, PathNode, SourcePosition, SourceSpan, VariableOperation } from './common';

const forbidden = new Set(['delete', 'splice', 'eval', 'Function', 'function']);
export function parseVariableText(text: string): ParseResult<ParsedVariableCommand[]> {
  const block = extractCommandBlock(text);
  if (!block.ok) return block;
  const body = block.value.text, base = block.value.source.start.offset;
  const commands: ParsedVariableCommand[] = [];
  let index = skipWhitespace(body, 0);
  const errorAt = (code: Parameters<typeof failure>[0], offset: number, limit?: Parameters<typeof failure>[3]) => {
    const result = failure(code, text, base + offset, limit);
    result.error.commandIndex = commands.length + 1;
    return result;
  };
  while (index < body.length) {
    const start = index;
    if (commands.length >= variableTextLimits.commandCount) return errorAt('limit_exceeded', index, 'commandCount');
    const op = /^[^\s=]+/u.exec(body.slice(index))?.[0];
    if (!op) return errorAt('command_syntax', index);
    if (forbidden.has(op)) return errorAt('forbidden_operation', index);
    if (op !== 'set' && op !== 'add' && op !== 'push') return errorAt('unknown_operation', index);
    index += op.length;
    if (body[index] !== ' ' && body[index] !== '\t') return errorAt('command_syntax', index);
    while (body[index] === ' ' || body[index] === '\t') index++;
    const pathStart = index, equal = body.indexOf('=', index);
    const lineEnd = body.slice(index).search(/[\r\n]/u);
    if (equal < 0 || (lineEnd >= 0 && equal >= index + lineEnd)) return errorAt('command_syntax', index);
    const pathText = body.slice(pathStart, equal).trimEnd();
    const path = parseVariablePath(pathText);
    if (!path.ok) return errorAt(path.error.code, pathStart + path.error.position.offset, path.error.limit);
    const result = readJsonValue(body, equal + 1);
    if (!result.ok) return errorAt(result.error.code, result.error.position.offset, result.error.limit);
    const { value, endOffset } = result.value;
    if (op === 'add' && typeof value !== 'number') return errorAt('add_number', result.value.startOffset);
    index = endOffset;
    while (body[index] === ' ' || body[index] === '\t') index++;
    if (index < body.length && body[index] !== '\r' && body[index] !== '\n') return errorAt('json_value', index);
    const source = { start: positionAt(text, base + start), end: positionAt(text, base + endOffset) };
    if (op === 'add') {
      // 此分支的独立收窄不借助类型断言，确保AST中add永远是数字。
      if (typeof value !== 'number') return errorAt('add_number', result.value.startOffset);
      commands.push({ operation: op, path: path.value, value, source });
    } else commands.push({ operation: op, path: path.value, value, source });
    index = skipWhitespace(body, index);
  }
  return { ok: true, value: commands };
}
