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
import { entityEnvelope, validateEntityStatements, parseVariables, validateVariableStatements, validateWorldCandidate, worldJson } from './aiOutputs';
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

function worldUnit(
  input: unknown, group: WorldGroup, groupIndex: number, commandIndex: number,
  state: GameState, existingLocations: ReadonlySet<string>,
): UpdateUnit<unknown> {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const writes: string[] = [];
  for (const key of ['npc', 'organization', 'location', 'event', 'task', 'entry']) {
    const record = value[key];
    if (record && typeof record === 'object' && 'id' in record && typeof record.id === 'string'
      && (key !== 'location' || !existingLocations.has(record.id))) writes.push(record.id);
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
  const existingLocations = new Set(Object.keys(state.locations));
  for (const command of draft.entities?.result.commands ?? [])
    if (command.type === 'CreateLocation') existingLocations.add(command.location.id);
  if (draft.variables?.validation === 'validated') {
    const variables = parseVariables(JSON.stringify(draft.variables.result), state, draft);
    for (const command of variables.commands)
      if (command.type === 'CreateLocation') existingLocations.add(command.location.id);
  }
  let index = 0;
  const units = worldGroups.flatMap(group => parsed.data[group].map((input, groupIndex) =>
    worldUnit(input, group, groupIndex, index++, state, existingLocations)));
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

function variablePath(input: VariableStatement) {
  let path = input.ast?.path.nodes;
  if (!path) {
    const pathText = /^\s*[^\s=]+[\t ]+([^=\r\n]+?)[\t ]*(?:=|$)/u.exec(input.text)?.[1];
    const recovered = pathText ? parseVariablePath(pathText) : undefined;
    if (recovered?.ok) path = recovered.value.nodes;
  }
  if (!path) return [];
  return path[0]?.name === 'gameState' ? path.slice(1) : path;
}

function variableUnit(input: VariableStatement, commandIndex: number, hasLooseBalanceChange: boolean, state: GameState): UpdateUnit<VariableStatement> {
  const { ast } = input;
  const nodes = variablePath(input);
  const [root, target, action, nestedAction] = nodes;
  const name = root?.kind === 'root' || root?.kind === 'field' ? root.name : undefined;
  const id = target?.kind === 'id' ? target.id : undefined;
  const economyId = name === 'economy' && target?.kind === 'field' && action?.kind === 'id' ? action.id : undefined;
  const field = nodes.slice(1).filter(node => node.kind === 'field').at(-1);
  const refs = structuredRefs(ast?.value, field?.name ?? '');
  // Creators and linked work records bind references. Existing NPC field updates do not
  // force all unrelated changes to the same NPC into one transaction.
  const createsLocation = name === 'locations' && id && !Object.hasOwn(state.locations, id);
  const createsEntity = name === 'locations' ? createsLocation : ast?.operation !== 'delete' && !action;
  const writes = id && (createsEntity || name === 'events' ||
    (name === 'items' && action?.kind === 'field' && action.name === 'purchase')) ? [id] : [];
  if (economyId && target?.kind === 'field' && (
    (target.name === 'incomes' || target.name === 'debts') && !nestedAction
    || target.name === 'vehicles' && nestedAction?.kind === 'field' && nestedAction.name === 'purchase'
  )) writes.push(economyId);
  const subject = id ?? economyId;
  if (subject && !writes.length) refs.push(subject);
  const atomicRefs = name === 'tasks' || name === 'events'
    ? workLinks(ast?.value) : [];
  const category: SkippedUpdate['category'] = name === 'items' ? 'item' : name === 'economy' ? 'economy'
    : name === 'npc' ? 'person' : name === 'tasks' ? 'task' : name === 'events' ? 'event' : 'state';
  const atomicKeys: string[] = [];
  if (name === 'harem') {
    atomicKeys.push('harem-transaction');
    // Link a new person's creation to their registration even if a different field is invalid.
    for (const edit of Array.isArray(ast?.value) ? ast.value : []) {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue;
      const raw = edit.value;
      const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined;
      for (const personId of [edit.npcId, edit.childNpcId, value?.childNpcId, value?.parentNpcId, value?.leftNpcId, value?.rightNpcId])
        if (typeof personId === 'string') atomicRefs.push(personId);
    }
  }
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

// Try concrete scene counterparts first. The formal projection still decides
// whether the old scene or another accepted move is also sufficient.
function addSceneDependencies(state: GameState, units: UpdateUnit<VariableStatement>[]) {
  type Position = { unit: UpdateUnit<VariableStatement>; value: string | null };
  type Presence = { unit: UpdateUnit<VariableStatement>; value: boolean };
  const people = new Map<string, { location?: Position; presence?: Presence }>();
  let hero: Position | undefined;
  for (const unit of units) {
    const ast = unit.input.ast;
    if (ast?.operation !== 'set') continue;
    const [root, target, field] = variablePath(unit.input);
    if (root?.kind !== 'root' && root?.kind !== 'field') continue;
    if (root.name === 'protagonist') {
      const value = !target && ast.value && typeof ast.value === 'object' && 'locationId' in ast.value
        ? ast.value.locationId : target?.kind === 'field' && target.name === 'locationId' ? ast.value : undefined;
      if (typeof value === 'string') hero = { unit, value };
    }
    if (root.name !== 'npc' || target?.kind !== 'id') continue;
    const person = people.get(target.id) ?? {};
    const object = !field && ast.value && typeof ast.value === 'object' ? ast.value : undefined;
    const location = field?.kind === 'field' && field.name === 'locationId' ? ast.value : object && 'locationId' in object ? object.locationId : undefined;
    const presence = field?.kind === 'field' && field.name === 'onScene' ? ast.value : object && 'onScene' in object ? object.onScene : undefined;
    if (typeof location === 'string' || location === null) person.location = { unit, value: location };
    if (typeof presence === 'boolean') person.presence = { unit, value: presence };
    people.set(target.id, person);
  }
  function tryAfter(unit: UpdateUnit<VariableStatement> | undefined, prerequisite: UpdateUnit<VariableStatement> | undefined) {
    if (unit && prerequisite && unit !== prerequisite)
      unit.verifyAfter = [...(unit.verifyAfter ?? []), prerequisite.position.commandIndex];
  }
  const oldHero = state.protagonist.locationId;
  const destination = hero?.value ?? oldHero;
  for (const [id, { location, presence }] of people) {
    const before = state.npc[id];
    const exact = location ? location.value : before?.locationId;
    if ((presence?.value ?? before?.onScene) && exact && exact === destination) {
      if (destination !== oldHero) {
        // An already-present NPC moving first would violate the old scene.
        if (before?.onScene || location?.unit === presence?.unit) tryAfter(location?.unit, hero?.unit);
        if (presence?.value && before?.locationId !== oldHero) tryAfter(presence.unit, hero?.unit);
      }
      if (presence?.value && before?.locationId !== oldHero && before?.locationId !== destination)
        tryAfter(presence.unit, location?.unit);
    }
    if (presence?.value === false && before?.onScene && location
      && (location.value === null || destination === oldHero && location.value !== destination))
      tryAfter(location.unit, presence.unit);
  }
}

export async function parsePartialEntities(text: string, state: GameState, draft: TurnDraft) {
  const { text: body, contactedNpcIds } = entityEnvelope(text);
  const result = await parsePartialVariables(body, state, draft, contactedNpcIds);
  if (result.settlement) for (const update of result.settlement.skipped) update.group = 'entities';
  return { ...result, contactedNpcIds };
}

export async function parsePartialVariables(text: string, state: GameState, draft: TurnDraft, contacts?: string[]) {
  const envelope = commandEnvelope(text);
  if (!envelope) throw new AiError('variable_text_syntax', undefined, { variableStep: 'envelope', fieldPath: 'text.block_structure' });
  const statements = variableStatements(envelope.text);
  if (!statements.ok) throw new AiError('variable_text_syntax', undefined, { variableStep: 'commands', fieldPath: `text.${statements.error.code}` });
  const hasLooseBalanceChange = statements.value.some(unit =>
    /^\s*[^\s=]+\s+(?:gameState\.)?economy\.(?:cash|onlineBalance)\s*=/iu.test(unit.text));
  const units = statements.value.map((statement,index) => variableUnit(statement,index,hasLooseBalanceChange,state));
  // An unreadable household operation cannot identify its newborns. Keep same-batch
  // new NPCs with that failed operation instead of persisting an unlinked birth.
  const unknownFamilySource = units.some(unit => {
    if (!unit.atomicKeys?.includes('harem-transaction')) return false;
    const edits = unit.input.ast?.value;
    return !Array.isArray(edits) || edits.some(edit => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit) || typeof edit.op !== 'string') return true;
      if (edit.op !== 'child') return false;
      const value = edit.value;
      return !value || typeof value !== 'object' || Array.isArray(value) || typeof value.childNpcId !== 'string';
    });
  });
  if (unknownFamilySource) {
    for (const unit of units) {
      const [root, target] = variablePath(unit.input);
      if ((root?.kind === 'root' || root?.kind === 'field') && root.name === 'npc' && target?.kind === 'id' && !Object.hasOwn(state.npc,target.id) && unit.writes.length)
        unit.atomicKeys = [...(unit.atomicKeys ?? []),'harem-transaction'];
    }
  }
  addSceneDependencies(state, units);
  // A world-clock statement is the temporal basis shared by application groups.
  const clocks = contacts ? [] : units.filter(unit => unit.input.ast?.path.nodes.some(node => (node.kind === 'root' || node.kind === 'field') && node.name === 'worldClock') && unit.position.category === 'state');
  const optional = units.filter(unit => !clocks.includes(unit));
  const { result, skipped } = await isolateUpdates(optional, selected => {
    const basis = units.filter(unit => clocks.includes(unit) || selected.includes(unit));
    const ast = basis.map(unit => unit.input.ast!);
    const validation = contacts ? validateEntityStatements(ast, state, draft, contacts) :
      validateVariableStatements(ast, state, draft, envelope.hasDescription, true);
    return validation
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
