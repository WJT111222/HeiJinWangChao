import { z } from 'zod';
import { IdSchema, TextSchema, IdsSchema, GameTimeSchema, ActorRefSchema } from '../common';

export const MemoryEntrySchema = z.strictObject({
  id: IdSchema, text: TextSchema, sourceTurnIds: IdsSchema,
  affectedEntityRefs: z.array(ActorRefSchema),
  visibility: z.enum(['player_known', 'npc_private', 'internal']),
  createdAtGameTime: GameTimeSchema,
});
export const KnowledgeKindSchema = z.enum(['observed', 'reported', 'suspected']);
export const KnowledgeNatureSchema = z.enum(['observed', 'reported', 'suspected', 'unknown']);
export const NpcMemorySchema = MemoryEntrySchema.extend({
  knowledgeSource: TextSchema,
  knowledgeKind: KnowledgeKindSchema.optional(), // 旧档缺省保持未知，不补造亲历事实。
}).refine((memory) => !memory.knowledgeKind || (memory.knowledgeKind === 'observed'
  ? !/^\[(?:转述|推测)\]/.test(memory.text) : memory.text.startsWith(memory.knowledgeKind === 'reported' ? '[转述]' : '[推测]')), '认知类型与原始记忆标记冲突');
export function npcKnowledgeKind(memory: z.infer<typeof NpcMemorySchema>): z.infer<typeof KnowledgeNatureSchema> {
  return memory.knowledgeKind ?? (memory.text.startsWith('[转述]') ? 'reported' : memory.text.startsWith('[推测]') ? 'suspected' : 'unknown');
}
export const NpcSummarySchema = MemoryEntrySchema.extend({
  npcProvenance: z.strictObject({
    npcId: IdSchema, identityKey: TextSchema,
    sourceMemoryIds: IdsSchema.refine((ids) => ids.length > 0 && ids.length <= 10),
    knowledgeKind: KnowledgeNatureSchema,
    sourceVisibility: MemoryEntrySchema.shape.visibility,
  }).optional(), // 既有总结可原样读取；没有可靠来源时不伪造覆盖凭据。
});
// 退场仅保留必要历史材料，属于局部经历，不充当公开分层摘要的整回合覆盖凭据。
export const HistoricalMemorySchema = MemoryEntrySchema.extend({
  retiredNpcSource: z.strictObject({ npcId: IdSchema, sourceMemoryId: IdSchema,
    knowledgeKind: KnowledgeNatureSchema, knowledgeSource: TextSchema }).optional(),
});
export const MemoryStateSchema = z.strictObject({
  immediateWindowSize: z.number().int().positive(),
  short: z.array(MemoryEntrySchema), medium: z.array(MemoryEntrySchema), long: z.array(HistoricalMemorySchema),
  npcSummaries: z.record(IdSchema, z.array(NpcSummarySchema)),
});
