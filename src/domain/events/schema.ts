import { z } from 'zod';
import { IdSchema, IdsSchema, TextSchema, StringsSchema, GameTimeSchema, ActorRefSchema, VisibilitySchema } from '../common';

// 任务与事件共用认知分类；保留既有导出名称和任务协议。
export const TaskResultKnowledgeSchema = z.strictObject({
  facts: z.array(TextSchema.max(4000)).max(12),
  reported: z.array(TextSchema.max(4000)).max(12),
  suspected: z.array(TextSchema.max(4000)).max(12),
});
export const StoredWorldEventSchema = z.strictObject({
  id: IdSchema, title: TextSchema,
  status: z.enum(['scheduled', 'active', 'resolved', 'blocked', 'cancelled']),
  startAt: GameTimeSchema, estimatedEndAt: GameTimeSchema.optional(), completionCondition: z.string().optional(),
  resolvedAt: GameTimeSchema.optional(), locationId: IdSchema.optional(),
  actorRefs: z.array(ActorRefSchema), linkedTaskIds: IdsSchema,
  prerequisites: StringsSchema, blockers: StringsSchema,
  visibility: VisibilitySchema, impact: z.enum(['minor', 'significant', 'major']),
  resolutionText: z.string().optional(), sourceTurnIds: IdsSchema,
  resultKnowledge: TaskResultKnowledgeSchema.optional(), // 旧事件不补造核实结论。
  backgroundText: TextSchema.optional(), goalText: TextSchema.optional(),
  outcome: z.enum(['success', 'failure', 'changed', 'cancelled']).optional(),
  predecessorEventIds: IdsSchema.optional(),
});
// 新规划的权威写入契约；旧档/旧候选只用StoredWorldEventSchema读取，不伪造缺失规划。
export const WorldEventSchema = StoredWorldEventSchema.extend({
  estimatedEndAt: GameTimeSchema, backgroundText: TextSchema, goalText: TextSchema,
  actorRefs: z.array(ActorRefSchema).min(1),
});
export const SceneEventStateSchema = StoredWorldEventSchema.pick({status:true,resolvedAt:true,resolutionText:true,outcome:true,resultKnowledge:true}).extend({status:z.enum(['active','blocked','resolved','cancelled'])});
const RetiredEventDetailSchema = StoredWorldEventSchema.pick({
  title: true, startAt: true, estimatedEndAt: true, resolvedAt: true, actorRefs: true,
  locationId: true, visibility: true, impact: true, resolutionText: true, resultKnowledge: true, outcome: true,
});
export const RetiredEventSchema = z.strictObject({
  id: IdSchema, status: z.enum(['resolved', 'cancelled']), retiredAt: GameTimeSchema,
  sourceTurnIds: IdsSchema, linkedTaskIds: IdsSchema, predecessorEventIds: IdsSchema,
  // 普通无引用事件只留轻量身份，必要因果/重大结果留紧凑成果，不保存背景/目标/阻碍全文。
  detail: RetiredEventDetailSchema.optional(),
  publication: z.strictObject({title: TextSchema, summary: TextSchema, at: GameTimeSchema, sourceTurnId: IdSchema}).optional(),
});
export type RetiredEvent = z.infer<typeof RetiredEventSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
// 只保留实际结果与经过明确传递的内容，不将执行者的全部知识授予接收者。
// result是完整叙述，可能混有引述；不能默认将其每个子句都视为客观事实。
export const TaskResolutionSchema = z.strictObject({
  at: GameTimeSchema, outcome: z.enum(['success', 'failure', 'cancelled']),
  result: TextSchema.max(4000), reason: TextSchema.max(4000), sourceTurnId: IdSchema,
  resultKnowledge: TaskResultKnowledgeSchema.optional(), // 旧档缺省不补造核实结论。
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
export type WorldEvent = z.infer<typeof StoredWorldEventSchema>;
export type WorldTask = z.infer<typeof WorldTaskSchema>;
