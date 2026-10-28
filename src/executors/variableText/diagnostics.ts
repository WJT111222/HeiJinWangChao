import type { ZodError, ZodIssue } from 'zod';
import type { ParsedVariableCommand } from '../../parsers/variableText';

// Deliberately finite metadata vocabulary. Never copy a failed value, entity ID,
// free-text validator message or provider response into an error or log.
export type DiagnosticType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null' | 'undefined';
export type DiagnosticRule = 'invalid_type' | 'required_field' | 'schema_constraint'
  | 'value_constraint' | 'reserved_field' | 'path_identity' | 'domain_schema';
export interface ExecutionDiagnostic {
  valuePath?: string;
  expectedType?: DiagnosticType;
  actualType?: DiagnosticType;
  validationRule: DiagnosticRule;
}

const allowedPaths = new Set([
  'worldClock', 'protagonist.healthText', 'protagonist.emotionText',
  'protagonist.locationId', 'protagonist.profession', 'protagonist.publicStatus',
  'protagonist.legalStatus', 'protagonist.skills', 'protagonist.currentWear',
  'economy.cash', 'economy.onlineBalance', 'economy.transfers',
]);
const allowedPatterns = [
  /^npc\[id\](?:\.(?:relationshipText|healthText|locationId|onScene|lastInteractionAt|memories|longTermMemories|knownInformation|affinityChange|activeGoals|contact))?$/,
  /^items\[id\](?:\.(?:conditionText|locationId|quantity|purchase|transfer|loss))?$/,
  /^locations\[id\]$/,
  /^organizations\[id\](?:\.protagonistRelation)?$/,
  /^events\[id\]$/,
  /^tasks\[id\]$/,
  /^economy\.(?:incomes|debts|vehicles)\[id\](?:\.(?:repayments|purchase))?$/,
];
export function isSafeVariablePath(path: string): boolean {
  return allowedPaths.has(path) || allowedPatterns.some((pattern) => pattern.test(path))
    || /^(?:npc\[id\]\.(?:memories|longTermMemories|knownInformation))\.(?:text|knowledgeKind|knowledgeSource|visibility)$/.test(path);
}

export function safeVariablePath(command: ParsedVariableCommand): string | undefined {
  const text = command.path.nodes.map((node) => {
    if (node.kind === 'id') return '[id]';
    if (node.kind === 'index') return '[index]';
    return node.kind === 'root' ? node.name : `.${node.name}`;
  }).join('');
  return isSafeVariablePath(text) ? text : undefined;
}

export function diagnosticType(value: unknown): DiagnosticType | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'undefined': return 'undefined';
    case 'object': return 'object';
    default: return undefined;
  }
}
function expectedType(issue: ZodIssue): DiagnosticType | undefined {
  if (issue.code !== 'invalid_type') return;
  const expected = issue.expected === 'int' ? 'integer' : issue.expected;
  return ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'undefined'].includes(expected)
    ? expected as DiagnosticType : undefined;
}
export function diagnosticForRule(command: ParsedVariableCommand, validationRule: DiagnosticRule): ExecutionDiagnostic {
  return { ...(safeVariablePath(command) ? { valuePath: safeVariablePath(command) } : {}), validationRule };
}
export function diagnosticForObject(command: ParsedVariableCommand): ExecutionDiagnostic {
  const actual = diagnosticType(command.value);
  return { ...diagnosticForRule(command, 'invalid_type'), expectedType: 'object',
    ...(actual ? { actualType: actual } : {}) };
}

const memoryFields = new Set(['text', 'knowledgeKind', 'knowledgeSource', 'visibility']);
export function diagnosticForSchema(
  command: ParsedVariableCommand,
  error: ZodError,
  fieldName?: string,
): ExecutionDiagnostic {
  const issue = error.issues[0];
  if (!issue) return diagnosticForRule(command, 'domain_schema');
  const base = safeVariablePath(command);
  let value: unknown = command.value;
  let path = base;
  if (issue.path.length === 0) {
    // A schema validated the command's value directly.
  } else if (issue.path.length === 1 && issue.path[0] === fieldName) {
    // e.g. UpdateNpc.changes.safeParse({ onScene: value })
  } else if (issue.path.length === 1 && base && memoryFields.has(String(issue.path[0]))
    && /^npc\[id\]\.(?:memories|longTermMemories|knownInformation)$/.test(base)
    && command.value && typeof command.value === 'object' && !Array.isArray(command.value)) {
    const key = String(issue.path[0]);
    path = `${base}.${key}`;
    value = Object.hasOwn(command.value, key)
      ? (command.value as Record<string, unknown>)[key] : undefined;
  } else {
    // A nested/union schema error cannot be reliably attributed to the root value.
    return diagnosticForRule(command, 'domain_schema');
  }
  const expected = expectedType(issue);
  const actual = diagnosticType(value);
  const rule: DiagnosticRule = expected
    ? actual === 'undefined' ? 'required_field' : 'invalid_type'
    : ['too_small', 'too_big', 'invalid_format'].includes(issue.code) ? 'value_constraint' : 'schema_constraint';
  return {
    ...(path ? { valuePath: path } : {}),
    validationRule: rule,
    ...(expected ? { expectedType: expected } : {}),
    ...(actual ? { actualType: actual } : {}),
  };
}
