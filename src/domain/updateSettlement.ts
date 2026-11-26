import { z } from 'zod';
import { CountSchema, IdSchema } from './common';

export const SettlementFieldSchema = z.enum([
  'ownerRef', 'parentId', 'createdAtGameTime', 'locationId', 'actorRef', 'actorRefs', 'linkedEventId', 'linkedTaskIds', 'predecessorEventIds',
  'protagonistEntry', 'entryIntent', 'status', 'resolvedAt', 'fixedEndAt', 'estimatedEndAt', 'lastInteractionAt', 'worldClock', 'commandId',
  'expectedRevision', 'amount', 'price', 'healthText', 'quantity', 'name', 'type',
]);
export const SkippedUpdateSchema = z.strictObject({
  commandIndex: CountSchema,
  group: z.enum(['entities', 'variables', 'worldCommands', 'taskCommands', 'eventCommands']),
  groupIndex: CountSchema,
  category: z.enum(['item', 'economy', 'person', 'task', 'event', 'world', 'state']),
  field: SettlementFieldSchema.optional(),
  reason: z.enum(['syntax', 'schema', 'permission', 'reference', 'conflict', 'time', 'constraint', 'dependency']),
});
export type SkippedUpdate = z.infer<typeof SkippedUpdateSchema>;
export const UpdateSettlementSchema = z.strictObject({
  skipped: z.array(SkippedUpdateSchema),
  accepted: CountSchema,
  formatWarning: z.literal(true).optional(),
});
export const JournalSettlementSchema = z.strictObject({
  entities: UpdateSettlementSchema.optional(),
  variables: UpdateSettlementSchema.optional(),
  world: UpdateSettlementSchema.optional(),
  deferred: CountSchema.optional(),
});
export const DeferredEventIdsSchema = z.array(IdSchema).refine(ids => ids.every((id, i) => i === 0 || ids[i - 1] < id));
