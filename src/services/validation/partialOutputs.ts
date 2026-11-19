import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import { WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import type { SkippedUpdate } from '../../domain/updateSettlement';
import { parseVariablePath } from '../../parsers/variableText';
import { variableStatements } from '../../parsers/variableText/isolation';
import type { VariableStatement } from '../../parsers/variableText/isolation';
import { AiError } from '../ai/errors';
import { parseVariables, validateVariableStatements, validateWorldCandidate, worldJson } from './aiOutputs';
import { worldValidationError } from './worldDiagnostics';
import { commandEnvelope } from './commandEnvelope';
import { isolateUpdates, settlementField, structuredRefs } from './updateIsolation';
import type { UpdateUnit } from './updateIsolation';

const worldGroups = ['worldCommands', 'taskCommands', 'eventCommands'] as const;
type WorldGroup = typeof worldGroups[number];
const rawWorldSchema = WorldResultSchema.omit({ settlement: true, deferredEvents: true }).extend({
  worldCommands: z.array(z.unknown()), taskCommands: z.array(z.unknown()), eventCommands: z.array(z.unknown()),
});

function workLinks(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  return ['linkedEventId', 'linkedTaskIds', 'predecessorEventIds'].flatMap(key => structuredRefs(Reflect.get(value, key), key));
}

function worldUnit(input: unknown, group: WorldGroup, groupIndex: number, commandIndex: number, state: GameState): UpdateUnit<unknown> {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const writes: string[] = [];
  for (const key of ['npc', 'organization', 'location', 'event', 'task', 'entry']) {
    const record = value[key];
    if (record && typeof record === 'object' && 'id' in record && typeof record.id === 'string') writes.push(record.id);
  }
  if (value.type === 'DeleteEvent' && typeof value.eventId === 'string') writes.push(value.eventId);
  const category = group === 'taskCommands' ? 'task' : group === 'eventCommands' ? 'event'
    : typeof value.type === 'string' && /Npc/u.test(value.type) ? 'person' : 'world';
  const refs = structuredRefs(value);
  const atomicRefs = workLinks(value.task ?? value.event);
  for (const id of writes) {
    if (state.tasks[id]?.linkedEventId) atomicRefs.push(state.tasks[id].linkedEventId);
    if (state.events[id]) atomicRefs.push(...state.events[id].linkedTaskIds);
  }
  const checked = DomainCommandSchema.safeParse(input);
  const field = checked.success ? undefined : settlementField(checked.error.issues.map(issue => issue.path.join('.')));
  return { input, writes, refs, atomicRefs, position: { group, commandIndex, groupIndex, category, ...(field ? { field } : {}) },
    invalid: checked.success ? undefined : 'schema' };
}

export async function parsePartialWorld(text: string, state: GameState, draft: TurnDraft) {
  const legacyJson = /^\s*(?:\{|```)/u.test(text);
  const envelope = legacyJson ? undefined : commandEnvelope(text);
  if (!envelope && !legacyJson) throw new AiError('invalid_output', undefined, { fieldPath: 'worldEnvelope.commandBlock' });
  let raw: unknown;
  try { raw = worldJson(envelope?.commands ?? text); } catch (error) { throw worldValidationError(error); }
  const parsed = rawWorldSchema.safeParse(raw);
  if (!parsed.success) throw worldValidationError(parsed.error, {}, raw);
  let index = 0;
  const units = worldGroups.flatMap(group => parsed.data[group].map((input, groupIndex) => worldUnit(input, group, groupIndex, index++, state)));
  if (draft.variables?.validation === 'validated')
    parseVariables(JSON.stringify(draft.variables.result), state, draft);
  const { result, skipped } = await isolateUpdates(units, selected => {
    const raw = { ...parsed.data };
    for (const group of worldGroups) raw[group] = selected.filter(unit => unit.position.group === group).map(unit => unit.input);
    return validateWorldCandidate(raw, state, draft, true);
  });
  const accepted = worldGroups.reduce((total, group) => total + result[group].length, 0);
  if (skipped.length || envelope?.formatWarning || result.deferredEvents?.length)
    result.settlement = { skipped, accepted, ...(envelope?.formatWarning ? { formatWarning: true } : {}) };
  return result;
}

function variableUnit(input: VariableStatement, commandIndex: number, hasLooseBalanceChange: boolean): UpdateUnit<VariableStatement> {
  const { ast } = input;
  const pathText = /^\s*[^\s=]+[\t ]+([^=\r\n]+?)[\t ]*(?:=|$)/u.exec(input.text)?.[1];
  const recoveredPath = pathText ? parseVariablePath(pathText) : undefined;
  const path = ast?.path.nodes ?? (recoveredPath?.ok ? recoveredPath.value.nodes : []);
  const nodes = path[0]?.name === 'gameState' ? path.slice(1) : path;
  const [root, target, action] = nodes;
  const name = root?.kind === 'root' || root?.kind === 'field' ? root.name : undefined;
  const id = target?.kind === 'id' ? target.id : undefined;
  const refs = structuredRefs(ast?.value);
  if (name === 'protagonist' && nodes.some(node => node.kind === 'field' && node.name === 'currentWear') && typeof ast?.value === 'string') refs.push(ast.value);
  // Creators and linked work records bind references. Existing NPC field updates do not
  // force all unrelated changes to the same NPC into one transaction.
  const writes = id && (!action || name === 'events' ||
    (name === 'items' && action.kind === 'field' && action.name === 'purchase')) ? [id] : [];
  if (id && !writes.length) refs.push(id);
  const atomicRefs = name === 'tasks' || name === 'events'
    ? workLinks(ast?.value) : [];
  const category: SkippedUpdate['category'] = name === 'items' ? 'item' : name === 'economy' ? 'economy'
    : name === 'npc' ? 'person' : name === 'tasks' ? 'task' : name === 'events' ? 'event' : 'state';
  const atomicKeys: string[] = [];
  if (hasLooseBalanceChange && (name === 'economy' ||
    (name === 'items' && (!action || (action.kind === 'field' && action.name === 'purchase')))))
    atomicKeys.push('loose-balance-and-inventory');
  // Index operations or transition commands consume the preceding value at the same path.
  // A whole protagonist update can write these same collections in the source protocol.
  const fields = id ? action?.kind === 'field' ? [action.name] : []
    : target?.kind === 'field' ? [target.name]
      : name === 'protagonist' && ast?.value && typeof ast.value === 'object' && !Array.isArray(ast.value) ? Object.keys(ast.value) : [];
  for (const field of fields) {
    if (['skills', 'currentWear', 'activeGoals', 'affinityChange', 'quantity'].includes(field))
      atomicKeys.push(JSON.stringify([name, id ?? null, field]));
  }
  return { input, writes, refs, atomicRefs, atomicKeys,
    position: { group: 'variables', commandIndex, groupIndex: commandIndex, category },
    invalid: ast ? undefined : 'syntax' };
}

export async function parsePartialVariables(text: string, state: GameState, draft: TurnDraft) {
  const envelope = commandEnvelope(text);
  if (!envelope) throw new AiError('variable_text_syntax', undefined, { variableStep: 'envelope', fieldPath: 'text.block_structure' });
  const statements = variableStatements(envelope.text);
  if (!statements.ok) throw new AiError('variable_text_syntax', undefined, { variableStep: 'commands', fieldPath: `text.${statements.error.code}` });
  const hasLooseBalanceChange = statements.value.some(unit =>
    /^\s*[^\s=]+\s+(?:gameState\.)?economy\.(?:cash|onlineBalance)\s*=/iu.test(unit.text));
  const units = statements.value.map((statement,index) => variableUnit(statement,index,hasLooseBalanceChange));
  // A world-clock statement is the temporal basis shared by application groups.
  const clocks = units.filter(unit => unit.input.ast?.path.nodes.some(node => (node.kind === 'root' || node.kind === 'field') && node.name === 'worldClock') && unit.position.category === 'state');
  const optional = units.filter(unit => !clocks.includes(unit));
  const { result, skipped } = await isolateUpdates(optional, selected => {
    const basis = units.filter(unit => clocks.includes(unit) || selected.includes(unit));
    const ast = basis.map(unit => unit.input.ast!);
    return validateVariableStatements(ast, state, draft, envelope.hasDescription)
      .catch(error => {
        if (!(error instanceof AiError)) throw error;
        const offset = error.details?.commandIndex;
        const failed = offset === undefined ? undefined : basis[offset];
        if (failed && clocks.includes(failed)) throw new AiError('variable_runtime');
        const local = failed ? selected.indexOf(failed) : undefined;
        throw new AiError(error.code, error.status, { ...error.details, commandIndex: local });
      });
  });
  if (skipped.length || envelope.formatWarning)
    result.settlement = { skipped, accepted: result.commands.filter(command => command.commandId.startsWith('text-v1:')).length, ...(envelope.formatWarning ? { formatWarning: true } : {}) };
  return result;
}
