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
// 只保留实际结果与经过明确传递的内容，不将执行者的全部知识授予接收者。
export const TaskResolutionSchema = z.strictObject({
  at: GameTimeSchema, outcome: z.enum(['success', 'failure', 'cancelled']),
  result: TextSchema.max(4000), reason: TextSchema.max(4000), sourceTurnId: IdSchema,
});
export const TaskHandoffSchema = z.strictObject({
  fromTaskId: IdSchema, at: GameTimeSchema, channel: TextSchema.max(500),
  content: TextSchema.max(4000), necessity: TextSchema.max(2000),
  knowledgeKind: z.enum(['observed', 'reported']),
  summaryBasis: z.strictObject({ mode: z.literal('faithful_summary'), resultExcerpt: TextSchema.max(4000) }).optional(),
});
export const WorldTaskSchema = z.strictObject({
  id: IdSchema, actorRef: ActorRefSchema, goal: TextSchema,
  startAt: GameTimeSchema, dueAt: GameTimeSchema.optional(), completionCondition: z.string().optional(),
  status: z.enum(['planned', 'active', 'completed', 'blocked', 'cancelled']),
  locationId: IdSchema.optional(), linkedEventId: IdSchema.optional(),
  prerequisites: StringsSchema, blockers: StringsSchema,
  resolution: TaskResolutionSchema.optional(), handoff: TaskHandoffSchema.optional(),
});
export const TimelineEntrySchema = z.strictObject({
  eventId: IdSchema, occurredAt: GameTimeSchema, title: TextSchema, locationId: IdSchema.optional(),
  summary: TextSchema, outcome: TextSchema, longTermImpact: z.string(),
  actorRefs: z.array(ActorRefSchema), sourceTurnIds: IdsSchema,
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;
export type WorldTask = z.infer<typeof WorldTaskSchema>;
