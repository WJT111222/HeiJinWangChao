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
  invalid?: 'syntax' | 'schema';
}

export function settlementField(paths: readonly (string | undefined)[]) {
  for (const path of paths) for (const part of path?.split('.').reverse() ?? []) {
    const field = SettlementFieldSchema.safeParse(part);
    if (field.success) return field.data;
  }
}

export function structuredRefs(value: unknown, key = ''): string[] {
  if (typeof value === 'string')
    return /(?:^id$|(?:Id|Ids)$)/u.test(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => structuredRefs(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, item]) => structuredRefs(item, name));
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
  const dependencies = new Map(groups.map(members => [members, new Set<Set<UpdateUnit<T>>>()]));
  for (const unit of units) for (const ref of unit.refs) {
    const owner = owners.get(ref), members = group.get(unit)!;
    if (owner && group.get(owner) !== members) dependencies.get(members)!.add(group.get(owner)!);
  }
  const ordered: typeof groups = [];
  const visited = new Set<Set<UpdateUnit<T>>>();
  function visit(members: Set<UpdateUnit<T>>) {
    if (visited.has(members)) return;
    visited.add(members);
    for (const dependency of dependencies.get(members)!) visit(dependency);
    ordered.push(members);
  }
  groups.forEach(visit);
  return { group, dependencies, ordered };
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
      // A final state constraint may span a group or have no single command index.
      // Keep only complete groups that independently lead to a verified state.
      const accepted = new Set<UpdateUnit<T>>();
      let result = await verify([]);
      for (const group of ordered) {
        if (![...group].some(unit => active.has(unit))) continue;
        try {
          result = await verify(units.filter(unit => accepted.has(unit) || group.has(unit)));
          for (const unit of group) accepted.add(unit);
        } catch (failure) {
          if (!(failure instanceof AiError) || failure.code === 'variable_runtime') throw failure;
          const attempted = units.filter(unit => accepted.has(unit) || group.has(unit));
          const index = failure.details?.commandIndex;
          const located = typeof index === 'number' ? attempted[index] : undefined;
          remove(group, located && group.has(located) ? located : [...group][0],
            reason(failure), settlementField([failure.details?.valuePath, failure.details?.fieldPath]));
        }
      }
      return finish(result);
    }
  }
}
