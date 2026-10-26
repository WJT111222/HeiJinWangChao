/** 仅描述JSON数据，不含执行器、存档对象或函数。数字使用JSON.parse的IEEE-754语义。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type VariableOperation = 'set' | 'add' | 'push';
export type PathNode =
  | { kind: 'root'; name: string }
  | { kind: 'field'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'id'; id: string };
export interface ParsedVariablePath {
  nodes: [Extract<PathNode, { kind: 'root' }>, ...Exclude<PathNode, { kind: 'root' }>[]];
}
/** offset和column按UTF-16单元计；line/column从1开始，end为独占结束位置。 */
export interface SourcePosition { offset: number; line: number; column: number }
export interface SourceSpan { start: SourcePosition; end: SourcePosition }
interface CommandSource { path: ParsedVariablePath; source: SourceSpan }
export type ParsedVariableCommand = CommandSource & (
  | { operation: 'add'; value: number }
  | { operation: 'set' | 'push'; value: JsonValue }
);
export type ParseErrorCode =
  | 'input_type' | 'missing_block' | 'block_structure' | 'command_syntax'
  | 'unknown_operation' | 'forbidden_operation' | 'path_syntax' | 'unsafe_path'
  | 'json_value' | 'add_number' | 'limit_exceeded';
export type ParserLimit = 'inputLength' | 'commandCount' | 'pathLength' | 'pathDepth' | 'valueLength' | 'jsonDepth' | 'blockDepth';
export interface ParseError {
  code: ParseErrorCode;
  /** 从1开始；结构提取或单独解析路径/值时尚无法确定命令序号，使用null。 */
  commandIndex: number | null;
  position: SourcePosition;
  message: string;
  limit?: ParserLimit;
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };
export const variableTextLimits = Object.freeze({
  inputLength: 262144, commandCount: 128, pathLength: 1024, pathDepth: 32,
  valueLength: 65536, jsonDepth: 32, blockDepth: 32,
});
const messages: Record<ParseErrorCode, string> = {
  input_type: '输入必须是文本。', missing_block: '未找到顶层命令区块。',
  block_structure: '命令或外围区块的标签缺失、重复、嵌套或不匹配。',
  command_syntax: '命令须使用“操作 路径 = JSON值”，并以换行分隔。',
  unknown_operation: '不支持此操作类型。', forbidden_operation: '禁止脚本或删除类操作。',
  path_syntax: '路径包含空段、非法标识符或不完整括号。', unsafe_path: '路径包含禁止访问的属性。',
  json_value: '值不是完整、有限的标准JSON数据。', add_number: 'add的操作数必须是有限JSON数字。',
  limit_exceeded: '输入超过解析器安全上限。',
};
export function positionAt(text: string, offset: number): SourcePosition {
  offset = Number.isSafeInteger(offset) ? Math.max(0, Math.min(text.length, offset)) : 0;
  let line = 1, column = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\r') { line++; column = 1; }
    else if (text[i] === '\n') { if (text[i - 1] !== '\r') line++; column = 1; }
    else column++;
  }
  return { offset, line, column };
}
export function failure(code: ParseErrorCode, text: string, offset = 0, limit?: ParserLimit): { ok: false; error: ParseError } {
  return { ok: false, error: { code, commandIndex: null, position: positionAt(text, offset), message: messages[code], ...(limit ? { limit } : {}) } };
}
export function inputFailure(text: string) {
  if (typeof text !== 'string') return failure('input_type', '');
  if (text.length > variableTextLimits.inputLength) return failure('limit_exceeded', text, 0, 'inputLength');
}
export function skipWhitespace(text: string, start: number) {
  let index = start;
  while (index < text.length && /\s/u.test(text[index])) index++;
  return index;
}
