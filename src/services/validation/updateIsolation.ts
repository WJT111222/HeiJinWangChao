import { SettlementFieldSchema } from '../../domain/updateSettlement';
import type { SkippedUpdate } from '../../domain/updateSettlement';
import { AiError } from '../ai/errors';

export interface UpdateUnit<T> {
  input: T;
  position: Omit<SkippedUpdate, 'reason'>;
  writes: readonly string[];
  refs: readonly string[];
  atomicKeys?: readonly string[];
  atomicRefs?: readonly string[];
  verifyAfter?: readonly number[];
  invalid?: 'syntax' | 'schema';
}

export function settlementField(paths: readonly (string | undefined)[]) {
  for (const path of paths) for (const part of path?.split('.').reverse() ?? []) {
    const field = SettlementFieldSchema.safeParse(part);
    if (field.success) return field.data;
  }
}

const referenceFields = new Set([
  'locationId', 'parentId', 'npcId', 'organizationId', 'itemId', 'taskId', 'eventId', 'parentEventId',
  'linkedEventId', 'linkedTaskIds', 'predecessorEventIds', 'fromTaskId', 'offscreenTaskIds',
  'currentTaskIds', 'keyNpcIds', 'mortgageDebtId', 'collateralAssetIds', 'debtId', 'relatedEntryIds',
  'topItemId', 'bottomItemId', 'shoesItemId', 'primaryWeaponItemId', 'secondaryWeaponItemId',
  'accessoryItemIds', 'currentVehicleAssetId',
]);
const referenceObjects = new Set([
  'location', 'npc', 'organization', 'event', 'task', 'item', 'entry', 'vehicle', 'debt', 'memory', 'actorRef',
  'actorRefs', 'ownerRef', 'affectedEntityRefs', 'expectedOwner', 'from', 'to', 'transfer', 'loss', 'changes',
  'purchase', 'profile', 'specialProfile', 'usualLocations', 'relationshipNetwork', 'relations', 'leadership',
  'handoff', 'continuation', 'protagonistEntry', 'currentWear', 'equipment', 'state',
]);
const actorObjects = new Set(['actorRef','actorRefs','ownerRef','affectedEntityRefs','expectedOwner','from','to']);

export function structuredRefs(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return referenceFields.has(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => structuredRefs(item, key));
  if (!value || typeof value !== 'object' || key && !referenceObjects.has(key)) return [];
  const refs = Object.entries(value).flatMap(([name, item]) => structuredRefs(item, name));
  if (actorObjects.has(key) && 'kind' in value && 'id' in value && typeof value.id === 'string')
    refs.push(value.id);
  return refs;
}

function isolationGroups<T>(units: readonly UpdateUnit<T>[]) {
  const group = new Map(units.map(unit => [unit, new Set([unit])]));
  const owners = new Map<string, UpdateUnit<T>>();
  const sharedWrites = new Map<string, UpdateUnit<T>>();
  function join(left: UpdateUnit<T>, right: UpdateUnit<T>) {
    const a = group.get(left)!, b = group.get(right)!;
    if (a === b) return;
    for (const unit of b) {
      a.add(unit);
      group.set(unit, a);
    }
  }
  function joinWriters(unit: UpdateUnit<T>, table: Map<string, UpdateUnit<T>>, keys: readonly string[]) {
    for (const key of keys) {
      const prior = table.get(key);
      if (prior) join(prior, unit);
      else table.set(key, unit);
    }
  }
  for (const unit of units) {
    joinWriters(unit, owners, unit.writes);
    joinWriters(unit, sharedWrites, unit.atomicKeys ?? []);
  }
  for (const unit of units) for (const ref of unit.atomicRefs ?? []) {
    const owner = owners.get(ref);
    if (owner) join(owner, unit);
  }

  const groups = [...new Set(units.map(unit => group.get(unit)!))];
  type Group = typeof groups[number];
  const dependencies = new Map(groups.map(members => [members, new Set<Group>()]));
  for (const unit of units) for (const ref of unit.refs) {
    const prior = owners.get(ref);
    if (prior && group.get(prior) !== group.get(unit)) dependencies.get(group.get(unit)!)!.add(group.get(prior)!);
  }

  // Condense strongly connected references before testing any prefix. A cycle in
  // this graph means "verify together"; the domain still decides whether it is legal.
  const reverse = new Map(groups.map(members => [members, new Set<Group>()]));
  for (const [members, prerequisites] of dependencies)
    for (const prior of prerequisites) reverse.get(prior)!.add(members);
  const finished: Group[] = [], seen = new Set<Group>();
  function visit(members: Group) {
    if (seen.has(members)) return;
    seen.add(members);
    for (const prior of dependencies.get(members)!) visit(prior);
    finished.push(members);
  }
  groups.forEach(visit);
  seen.clear();
  const cyclic = new Map<Group, Group>();
  function collect(members: Group, component: Group) {
    if (seen.has(members)) return;
    seen.add(members);
    cyclic.set(members, component);
    for (const unit of members) component.add(unit);
    for (const next of reverse.get(members)!) collect(next, component);
  }
  for (const members of [...finished].reverse()) if (!seen.has(members)) collect(members, new Set());

  // Prerequisites first for trials, original text/World order for execution.
  const ordered = [...new Set(finished.map(members => cyclic.get(members)!))];
  const condensed = new Map(ordered.map(members => [members, new Set<Group>()]));
  for (const [members, prerequisites] of dependencies) {
    const component = cyclic.get(members)!;
    for (const prior of prerequisites) {
      const prerequisite = cyclic.get(prior)!;
      if (component !== prerequisite) condensed.get(component)!.add(prerequisite);
    }
    for (const unit of members) group.set(unit, component);
  }
  // Scene counterparts may be satisfied by other legal writes or by the base.
  // Use these hints for trial order. Only entity dependencies propagate rejection.
  const byIndex = new Map(units.map(unit => [unit.position.commandIndex, unit]));
  const earlier = new Map(ordered.map(members => [members, new Set<Group>()]));
  for (const unit of units) for (const index of unit.verifyAfter ?? []) {
    const prior = byIndex.get(index);
    if (prior && group.get(prior) !== group.get(unit)) earlier.get(group.get(unit)!)!.add(group.get(prior)!);
  }
  seen.clear();
  const topological: Group[] = [];
  function order(members: Group) {
    if (seen.has(members)) return;
    seen.add(members);
    for (const prior of condensed.get(members)!) order(prior);
    for (const prior of earlier.get(members)!) order(prior);
    topological.push(members);
  }
  ordered.forEach(order);
  return { group, dependencies: condensed, ordered: topological };
}

function reason(error: AiError): SkippedUpdate['reason'] {
  const detail = String(error.details?.worldRule ?? error.details?.domainRule ?? '');
  if (error.code === 'variable_text_syntax') return 'syntax';
  if (/time|clock/u.test(detail) || error.code === 'time_data' || error.code === 'time_preflight') return 'time';
  if (/permission|ownership/u.test(detail) || error.code === 'permission') return 'permission';
  if (/reference|missing/u.test(detail)) return 'reference';
  if (/duplicate|conflict/u.test(detail) || error.code === 'candidate_conflict') return 'conflict';
  if (/schema|structure/u.test(detail) || error.code === 'schema_fields') return 'schema';
  return 'constraint';
}

/** Each attempt is against the original snapshot and uses the same strict batch verifier. */
export async function isolateUpdates<T, R>(units: readonly UpdateUnit<T>[],
  verify: (selected: readonly UpdateUnit<T>[]) => R | Promise<R>) {
  const { group: byUnit, dependencies, ordered } = isolationGroups(units);
  const skipped: SkippedUpdate[] = [];
  const active = new Set(units);
  function remove(group: Set<UpdateUnit<T>>, primary: UpdateUnit<T>, why: SkippedUpdate['reason'], field?: SkippedUpdate['field']) {
    for (const unit of group) if (active.delete(unit)) {
      skipped.push({ ...unit.position, ...(unit === primary && field ? { field } : {}), reason: unit.invalid ?? (unit === primary ? why : 'dependency') });
    }
    for (const dependent of ordered) {
      if (dependencies.get(dependent)?.has(group) && [...dependent].some(unit => active.has(unit)))
        remove(dependent, [...dependent][0], 'dependency');
    }
  }
  for (const group of ordered) {
    const invalid = [...group].find(unit => active.has(unit) && unit.invalid);
    if (invalid) remove(group, invalid, invalid.invalid!);
  }
  const finish = (result: R) => ({ result, skipped: skipped.sort((a, b) => a.commandIndex - b.commandIndex) });
  while (true) {
    const selected = units.filter(unit => active.has(unit));
    try { return finish(await verify(selected)); }
    catch (error) {
      if (!(error instanceof AiError) || error.code === 'variable_runtime' || selected.length === 0) throw error;
      const index = error.details?.commandIndex;
      const primary = typeof index === 'number' ? selected[index] : undefined;
      if (primary) {
        const group = byUnit.get(primary)!;
        remove(group, primary, reason(error), settlementField([error.details?.valuePath, error.details?.fieldPath]));
        continue;
      }
      // Unattributed constraints may be temporary. Retry pending groups after
      // a successful addition before deciding what cannot be part of the verified result.
      const accepted = new Set<UpdateUnit<T>>();
      const failures = new Map<Set<UpdateUnit<T>>, { error: AiError; primary?: UpdateUnit<T> }>();
      let result = await verify([]);
      let progress: boolean;
      do {
        progress = false;
        for (const group of ordered) {
          if (![...group].some(unit => active.has(unit) && !accepted.has(unit))) continue;
          if ([...dependencies.get(group)!].some(prior => ![...prior].every(unit => accepted.has(unit)))) continue;
          const attempted = units.filter(unit => accepted.has(unit) || group.has(unit));
          try {
            result = await verify(attempted);
            for (const unit of group) accepted.add(unit);
            progress = true;
          } catch (failure) {
            if (!(failure instanceof AiError) || failure.code === 'variable_runtime') throw failure;
            const index = failure.details?.commandIndex;
            const primary = typeof index === 'number' ? attempted[index] : undefined;
            failures.set(group, { error: failure, primary });
          }
        }
      } while (progress);
      for (const group of ordered) {
        const first = [...group].find(unit => active.has(unit) && !accepted.has(unit));
        if (!first) continue;
        const failure = failures.get(group);
        const primary = failure?.primary && group.has(failure.primary) ? failure.primary : first;
        remove(group, primary, failure ? reason(failure.error) : 'dependency',
          settlementField([failure?.error.details?.valuePath, failure?.error.details?.fieldPath]));
      }
      return finish(result);
    }
  }
}
