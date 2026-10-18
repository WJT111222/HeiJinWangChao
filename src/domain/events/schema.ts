import { z } from 'zod';
import { IdSchema, IdsSchema, TextSchema, StringsSchema, GameTimeSchema, ActorRefSchema, VisibilitySchema } from '../common';

export const WorldEventSchema = z.strictObject({
  id: IdSchema, title: TextSchema,
  status: z.enum(['scheduled', 'active', 'resolved', 'blocked', 'cancelled']),
  startAt: GameTimeSchema, estimatedEndAt: GameTimeSchema.optional(), completionCondition: z.string().optional(),
  resolvedAt: GameTimeSchema.optional(), locationId: IdSchema.optional(),
  actorRefs: z.array(ActorRefSchema), linkedTaskIds: IdsSchema,
  prerequisites: StringsSchema, blockers: StringsSchema,
  visibility: VisibilitySchema, impact: z.enum(['minor', 'significant', 'major']),
  resolutionText: z.string().optional(), sourceTurnIds: IdsSchema,
});
export const WorldTaskSchema = z.strictObject({
  id: IdSchema, actorRef: ActorRefSchema, goal: TextSchema,
  startAt: GameTimeSchema, dueAt: GameTimeSchema.optional(), completionCondition: z.string().optional(),
  status: z.enum(['planned', 'active', 'completed', 'blocked', 'cancelled']),
  locationId: IdSchema.optional(), linkedEventId: IdSchema.optional(),
  prerequisites: StringsSchema, blockers: StringsSchema,
});
export const TimelineEntrySchema = z.strictObject({
  eventId: IdSchema, occurredAt: GameTimeSchema, title: TextSchema, locationId: IdSchema.optional(),
  summary: TextSchema, outcome: TextSchema, longTermImpact: z.string(),
  actorRefs: z.array(ActorRefSchema), sourceTurnIds: IdsSchema,
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;
export type WorldTask = z.infer<typeof WorldTaskSchema>;
