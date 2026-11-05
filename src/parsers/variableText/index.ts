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

const forbidden = new Set(['splice', 'eval', 'Function', 'function']);
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
    const rawOp = /^[^\s=]+/u.exec(body.slice(index))?.[0];
    const op = rawOp?.toLowerCase();
    if (!op) return errorAt('command_syntax', index);
    if (forbidden.has(op)) return errorAt('forbidden_operation', index);
    if (op !== 'set' && op !== 'add' && op !== 'push' && op !== 'delete') return errorAt('unknown_operation', index);
    index += op.length;
    if (body[index] !== ' ' && body[index] !== '\t') return errorAt('command_syntax', index);
    while (body[index] === ' ' || body[index] === '\t') index++;
    // 来源：MoRanJiangHu storyResponseParser.parse命令块 的标准 delete 路径体例。
    // 不忽略多余操作数：兼容显式 null，其他值严格拒绝，避免损坏输出变为成功。
    if (op === 'delete') {
      const length = body.slice(index).search(/[\r\n]/u);
      const end = length < 0 ? body.length : index + length;
      const line = body.slice(index, end), separator = line.indexOf('=');
      const pathText = (separator < 0 ? line : line.slice(0, separator)).trimEnd();
      const path = parseVariablePath(pathText);
      if (!path.ok) return errorAt(path.error.code, index + path.error.position.offset, path.error.limit);
      if (separator >= 0) {
        const value = readJsonValue(body, index + separator + 1);
        if (!value.ok || value.value.value !== null || value.value.endOffset > end || body.slice(value.value.endOffset, end).trim()) return errorAt('json_value', index + separator + 1);
      }
      commands.push({ operation: 'delete', path: path.value, value: null,
        source: { start: positionAt(text, base + start), end: positionAt(text, base + end) } });
      index = skipWhitespace(body, end); continue;
    }
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

export { parseVariableResponse } from './response';
