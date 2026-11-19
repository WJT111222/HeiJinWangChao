import { fingerprint } from '../../domain/commands';
import type { WorldResultSchema, TurnDraft } from '../../domain/drafts';
import type { z } from 'zod';
import type { GameState } from '../../domain/state';
import { terminalEvent } from '../../domain/events/lifecycle';
import { requireEventEntry, requireWorld } from './worldDiagnostics';

/** Carry an unfinished interaction to an explicit legacy successor, never accept/decline for the player. */
export function normalizeStageEntryHandoffs(result: z.infer<typeof WorldResultSchema>, base: GameState, draft: TurnDraft) {
  const normalized = new Set<string>();
  const offset = result.worldCommands.length + result.taskCommands.length;
  const eventWrites = result.eventCommands.flatMap((command, index) =>
    command.type === 'SaveEvent' ? [{ event: command.event, index }] : []);
  const scope = (index: number, field: string) => ({
    fieldPath: `eventCommands.${index}.event.${field}`, commandIndex: offset + index, commandType: 'SaveEvent',
  });
  for (const { event: source, index } of eventWrites) {
    if (source.eventKind !== 'sub' || !terminalEvent(source)) continue;
    const old = base.events[source.id], entry = old?.protagonistEntry;
    if (!entry || (entry.status !== 'pending' && entry.status !== 'presented')) continue;
    requireWorld(Date.parse(source.resolvedAt!) === Date.parse(source.fixedEndAt!), 'invalid_output', 'event_time');
    const referencing = eventWrites.filter(({ event }) => event.predecessorEventIds?.includes(source.id));
    const eligible = referencing.filter(({ event }) => !event.eventKind && !terminalEvent(event));
    const targets = eligible.flatMap(({ event, index }) => event.continuation?.direction === 'protagonist'
      ? [{ event, index, plan: event.continuation.entry }] : []);
    const sourceScope = scope(index, 'protagonistEntry');
    if (entry.status === 'pending' && targets.length === 0 && source.continuation?.direction !== 'protagonist') {
      const closed = { ...entry, status: 'invalidated' as const, handledTurnId: draft.turnId, textEvidence: '阶段到期，未呈现的原入场安排已结束' };
      requireEventEntry(!source.protagonistEntry || fingerprint(source.protagonistEntry) === fingerprint(entry)
        || fingerprint(source.protagonistEntry) === fingerprint(closed), 'permission', 'forged_entry', sourceScope);
      source.protagonistEntry = closed;
      normalized.add(source.id);
      continue;
    }
    if (!targets.length) {
      requireEventEntry(referencing.length, 'invalid_output', 'missing_successor', sourceScope);
      const first = referencing[0];
      requireEventEntry(eligible.length, 'invalid_output', 'invalid_successor',
        scope(first.index, first.event.eventKind ? 'eventKind' : 'status'));
      requireEventEntry(false, 'invalid_output', 'mismatched_direction', scope(eligible[0].index, 'continuation.direction'));
    }
    requireEventEntry(targets.length === 1, 'invalid_output', 'multiple_successors', sourceScope);
    const { event: target, index: targetIndex, plan } = targets[0];
    requireEventEntry(!base.events[target.id], 'permission', 'invalid_successor', scope(targetIndex, 'id'));
    requireEventEntry(target.entryIntent === old.entryIntent, 'permission', 'mismatched_entry', scope(targetIndex, 'entryIntent'));
    const mismatch = (['cue', 'channel', 'locationId'] as const).find(field => plan[field] !== entry[field]);
    if (mismatch) requireEventEntry(false, 'permission', 'mismatched_entry', scope(targetIndex, `continuation.entry.${mismatch}`));
    const invalidated = { ...entry, status: 'invalidated' as const, handledTurnId: draft.turnId, textEvidence: '阶段固定到期，入场职责转交后续事件' };
    const transferred = { ...entry, id: `stage-entry:${base.revision}` };
    requireEventEntry(!normalized.has(target.id), 'invalid_output', 'reused_successor', scope(targetIndex, 'predecessorEventIds'));
    // Entry IDs are scoped by target event ID, as in the existing entry protocol.
    requireWorld(transferred.id.length <= 128, 'invalid_output', 'event_entry');
    requireEventEntry(!source.protagonistEntry || fingerprint(source.protagonistEntry) === fingerprint(entry)
      || fingerprint(source.protagonistEntry) === fingerprint(invalidated), 'permission', 'forged_entry', sourceScope);
    requireEventEntry(!target.protagonistEntry || fingerprint(target.protagonistEntry) === fingerprint(transferred),
      'permission', 'forged_entry', scope(targetIndex, 'protagonistEntry'));
    normalized.add(source.id);
    normalized.add(target.id);
    source.protagonistEntry = invalidated;
    target.protagonistEntry = transferred;
    target.sourceTurnIds = [...new Set([...target.sourceTurnIds, ...old.sourceTurnIds])];
  }
  return normalized;
}
