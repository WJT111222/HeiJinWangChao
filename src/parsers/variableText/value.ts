import { failure, inputFailure, skipWhitespace, variableTextLimits } from './common';
import type { JsonValue, ParseResult } from './common';
interface ReadValue { value: JsonValue; startOffset: number; endOffset: number }
function finiteJson(value: JsonValue): boolean {
  const queue: JsonValue[] = [value];
  while (queue.length) {
    const entry = queue.pop();
    if (typeof entry === 'number' && !Number.isFinite(entry)) return false;
    if (entry && typeof entry === 'object') for (const child of Object.values(entry)) queue.push(child);
  }
  return true;
}
/** 找出单个JSON值边界；只做词法扫描和JSON.parse，不解释任何脚本。 */
export function readJsonValue(text: string, offset: number): ParseResult<ReadValue> {
  const invalid = inputFailure(text);
  if (invalid) return invalid;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return failure('json_value', text);
  const start = skipWhitespace(text, offset);
  if (start === text.length) return failure('json_value', text, start);
  const stack: string[] = [];
  let quoted = false, escaped = false, end = start;
  const compound = text[start] === '{' || text[start] === '[', string = text[start] === '"';
  for (; end < text.length; end++) {
    if (end - start >= variableTextLimits.valueLength) return failure('limit_exceeded', text, end, 'valueLength');
    const char = text[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') { quoted = false; if (string && stack.length === 0) { end++; break; } }
      else if (char === '\r' || char === '\n') return failure('json_value', text, end);
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      if (stack.length > variableTextLimits.jsonDepth) return failure('limit_exceeded', text, end, 'jsonDepth');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return failure('json_value', text, end);
      if (compound && stack.length === 0) { end++; break; }
    } else if (!compound && !string && (char === '\n' || char === '\r')) break;
  }
  if (end - start > variableTextLimits.valueLength) return failure('limit_exceeded', text, end, 'valueLength');
  if (quoted || stack.length) return failure('json_value', text, end);
  try {
    const value: JsonValue = JSON.parse(text.slice(start, end));
    if (!finiteJson(value)) return failure('json_value', text, start);
    return { ok: true, value: { value, startOffset: start, endOffset: end } };
  } catch { return failure('json_value', text, start); }
}
export function parseJsonValue(text: string): ParseResult<JsonValue> {
  const result = readJsonValue(text, 0);
  if (!result.ok) return result;
  if (skipWhitespace(text, result.value.endOffset) !== text.length) return failure('json_value', text, result.value.endOffset);
  return { ok: true, value: result.value.value };
}
