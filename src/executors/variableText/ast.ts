import { z } from 'zod';
import { CountSchema } from '../../domain/common';
import { parseJsonValue, parseVariablePath, variableTextLimits } from '../../parsers/variableText';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { failed } from './model';
import type { ExecutionResult } from './model';

const name = z.string().min(1).max(variableTextLimits.pathLength);
const root = z.strictObject({ kind: z.literal('root'), name });
const child = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('field'), name }),
  z.strictObject({ kind: z.literal('index'), index: CountSchema }),
  z.strictObject({ kind: z.literal('id'), id: name }),
]);
const position = z.strictObject({ offset: CountSchema, line: CountSchema.min(1), column: CountSchema.min(1) });
const command = z.strictObject({ operation: z.enum(['set', 'add', 'push']),
  path: z.strictObject({ nodes: z.tuple([root]).rest(child).refine((nodes) => nodes.length <= variableTextLimits.pathDepth) }),
  value: z.unknown(), source: z.strictObject({ start: position, end: position }),
});
/** 不信任仅凭TS类型手工拼出的AST；先重验结构，再重验路径词法。值由各精确映射校验。 */
export function validateAst(input: readonly ParsedVariableCommand[]): ExecutionResult<ParsedVariableCommand[]> {
  if (!Array.isArray(input) || input.length > variableTextLimits.commandCount) return failed('type_mismatch');
  const output: ParsedVariableCommand[] = [];
  for (let i = 0; i < input.length; i++) {
    const parsed = command.safeParse(input[i]);
    if (!parsed.success) return failed('type_mismatch');
    const c = parsed.data, origin = { commandIndex: i + 1, source: c.source };
    if (c.source.end.offset < c.source.start.offset || c.source.end.line < c.source.start.line) return failed('type_mismatch', origin);
    const path = c.path.nodes.map((node) => node.kind === 'root' ? node.name
      : node.kind === 'field' ? `.${node.name}` : node.kind === 'index' ? `[${node.index}]` : `[${node.id}]`).join('');
    const checked = parseVariablePath(path);
    if (!checked.ok || JSON.stringify(checked.value) !== JSON.stringify(c.path)) return failed('unsupported_path', origin);
    const value = safeValue(c.value);
    if (!value.ok) return failed('type_mismatch', origin);
    if (c.operation === 'add') {
      if (typeof value.value !== 'number') return failed('type_mismatch', origin);
      output.push({ ...c, operation: 'add', value: value.value });
    } else output.push({ ...c, operation: c.operation, value: value.value });
  }
  return { ok: true, value: output };
}

// 保守拒绝函数、访问器、非普通对象、循环/共享图与超深数据，然后才序列化。
function safeValue(input: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || ++nodes > variableTextLimits.valueLength) return { ok: false as const };
    const value = entry.value;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) return { ok: false as const }; continue; }
    if (typeof value === 'string') { if (value.length > variableTextLimits.valueLength) return { ok: false as const }; continue; }
    if (typeof value !== 'object' || seen.has(value) || entry.depth >= variableTextLimits.jsonDepth
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== Array.prototype && Object.getPrototypeOf(value) !== null)
      || Object.getOwnPropertySymbols(value).length) return { ok: false as const };
    seen.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable) return { ok: false as const };
      pending.push({ value: descriptor.value, depth: entry.depth + 1 });
    }
  }
  const serialized = JSON.stringify(input);
  return typeof serialized === 'string' ? parseJsonValue(serialized) : { ok: false as const };
}
