import { z } from 'zod';
import { IdSchema, IdsSchema, TextSchema, StringsSchema, GameTimeSchema } from '../common';
import { NpcMemorySchema } from '../memories/schema';

const PrivateProfileSchema = z.strictObject({
  bodyDescription: z.string().optional(),
  chestDescription: z.string().optional(),
  pussyDescription: z.string().optional(),
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
// Absence in legacy saves means unknown, never inferred from the contact registry.
const publicVariables = {
  phoneContact: z.strictObject({ status: z.enum(['unknown', 'known', 'invalid']), note: z.string().optional() }).optional(),
  usualLocations: z.array(z.strictObject({
    locationId: IdSchema, role: z.enum(['home', 'work', 'frequent']), knownToProtagonist: z.boolean(),
  })).optional(),
};
export const SpecialProfileSchema = z.strictObject({
  detailedBackground: z.string(),
  activeGoals: StringsSchema, habits: StringsSchema,
  longTermMemories: z.array(NpcMemorySchema), offscreenTaskIds: IdsSchema,
  privateProfile: PrivateProfileSchema,
  relationshipNetwork: z.array(z.strictObject({
    name: TextSchema, relationship: TextSchema, description: z.string(),
    affinity: z.number().min(-100).max(100).nullable().optional(), npcId: IdSchema.optional(),
  })).optional(),
});
export const OrdinaryNpcSchema = z.strictObject({ ...base, ...publicVariables, kind: z.literal('ordinary') });
export const SpecialNpcSchema = z.strictObject({ ...base, ...publicVariables, kind: z.literal('special'), ...SpecialProfileSchema.shape });
export const NpcSchema = z.discriminatedUnion('kind', [OrdinaryNpcSchema, SpecialNpcSchema]);
export type NPC = z.infer<typeof NpcSchema>;
export const DormantNpcProfileSchema = z.strictObject({ id: IdSchema, identityKey: TextSchema, profile: SpecialProfileSchema });

// Batch 1 adds persistence only. Existing AI creation/update protocols remain unchanged.
export const OrdinaryNpcCreationSchema = OrdinaryNpcSchema.omit({ phoneContact: true, usualLocations: true });
export const SpecialNpcCreationSchema = SpecialNpcSchema.omit({ phoneContact: true, usualLocations: true, relationshipNetwork: true });
export const NpcCreationSchema = z.discriminatedUnion('kind', [OrdinaryNpcCreationSchema, SpecialNpcCreationSchema]);
