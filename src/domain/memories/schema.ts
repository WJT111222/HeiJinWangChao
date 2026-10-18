import { z } from 'zod';
import { IdSchema, TextSchema, IdsSchema, GameTimeSchema, ActorRefSchema } from '../common';

export const MemoryEntrySchema = z.strictObject({
  id: IdSchema, text: TextSchema, sourceTurnIds: IdsSchema,
  affectedEntityRefs: z.array(ActorRefSchema),
  visibility: z.enum(['player_known', 'npc_private', 'internal']),
  createdAtGameTime: GameTimeSchema,
});
export const NpcMemorySchema = MemoryEntrySchema.extend({
  knowledgeSource: TextSchema,
});
export const MemoryStateSchema = z.strictObject({
  immediateWindowSize: z.number().int().positive(),
  short: z.array(MemoryEntrySchema), medium: z.array(MemoryEntrySchema), long: z.array(MemoryEntrySchema),
  npcSummaries: z.record(IdSchema, z.array(MemoryEntrySchema)),
});
