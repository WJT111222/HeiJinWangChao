import { z } from 'zod';
import { IdSchema, IdsSchema, TextSchema, StringsSchema, GameTimeSchema } from '../common';
import { NpcMemorySchema } from '../memories/schema';

const PrivateProfileSchema = z.strictObject({
  chestDescription: z.string().optional(),
  buttocksDescription: z.string().optional(),
  privatePartDescription: z.string().optional(),
  isVirgin: z.boolean().optional(),
  firstExperienceTarget: z.string().optional(),
  firstExperienceTime: z.string().optional(),
  firstExperienceText: z.string().optional(),
}).optional();

const base = {
  id: IdSchema, identityKey: TextSchema, aliases: StringsSchema,
  name: TextSchema, age: z.number().int().nonnegative().optional(),
  gender: z.enum(['female', 'male', 'unknown']).optional(),
  identity: z.string().optional(), appearance: z.string().optional(), temperament: z.string().optional(),
  background: z.string().optional(), skills: StringsSchema,
  locationId: IdSchema.optional(), onScene: z.boolean(),
  affinity: z.number().min(-100).max(100), relationshipText: TextSchema,
  // 兼容旧档：初始同伴没有此标记时，0 仍是未确认占位；仅有依据的关系命令可确认。
  affinityConfirmed: z.literal(true).optional(),
  healthText: z.string().optional(), memories: z.array(NpcMemorySchema),
  knownInformation: z.array(z.strictObject({ text: TextSchema, source: TextSchema, learnedAt: GameTimeSchema })),
  lastInteractionAt: GameTimeSchema.optional(),
};
export const OrdinaryNpcSchema = z.strictObject({ ...base, kind: z.literal('ordinary') });
export const SpecialNpcSchema = z.strictObject({
  ...base, kind: z.literal('special'), detailedBackground: z.string(),
  activeGoals: StringsSchema, habits: StringsSchema,
  longTermMemories: z.array(NpcMemorySchema), offscreenTaskIds: IdsSchema,
  privateProfile: PrivateProfileSchema,
});
export const NpcSchema = z.discriminatedUnion('kind', [OrdinaryNpcSchema, SpecialNpcSchema]);
export type NPC = z.infer<typeof NpcSchema>;
