import { z } from 'zod';
import { IdSchema, IdsSchema, StringsSchema, TextSchema, MoneySchema, GameTimeSchema } from '../common';

// This is the public leadership record, not an NPC creation instruction.
export const LeadershipSchema = z.strictObject({
  position: TextSchema, publicName: TextSchema.nullable(), description: z.string().optional(), npcId: IdSchema.optional(),
}).refine(row => row.publicName !== null || row.npcId === undefined,
  '身份未公开的职位不绑定公开人物入口');
export const OrganizationRelationSchema = z.strictObject({
  organizationId: IdSchema, relation: TextSchema, description: z.string(),
});
const relations = z.array(OrganizationRelationSchema).refine(rows => new Set(rows.map(r => r.organizationId)).size === rows.length, '同一组织仅保留一个当前关系');
const base = {
  id: IdSchema, name: TextSchema, description: z.string(),
  protagonistRelation: TextSchema, relationHistory: StringsSchema,
  keyNpcIds: IdsSchema, currentTaskIds: IdsSchema,
  leadership: z.array(LeadershipSchema).optional(), relations: relations.optional(),
};
export const GangOrgSchema = z.strictObject({
  ...base, kind: z.literal('gang'), territoryText: z.string().optional(), funds: MoneySchema.optional(),
  powerText: z.string().optional(), industries: StringsSchema, internalStatus: z.string().optional(),
});
export const GovernmentOrgSchema = z.strictObject({
  ...base, kind: z.literal('government'), jurisdictionText: z.string().optional(),
  lawfulPowers: StringsSchema, cases: StringsSchema, administrativeAffairs: StringsSchema,
  enforcementCapacityText: z.string().optional(), publicTrustText: z.string().optional(), internalStatus: z.string().optional(),
});
export const CivilOrgSchema = z.strictObject({
  ...base, kind: z.literal('civil'), missionText: z.string().optional(), supportersText: z.string().optional(),
  membershipText: z.string().optional(), activities: StringsSchema,
  activityAreaText: z.string().optional(), publicInfluenceText: z.string().optional(),
});
export const BusinessOrgSchema = z.strictObject({
  ...base, kind: z.literal('business'), sectors: StringsSchema,
  assetsEstimate: MoneySchema.optional(), liquidityEstimate: MoneySchema.optional(),
  ownershipText: z.string().optional(), operatingStatus: z.string().optional(), businessRelations: StringsSchema,
});
export const OrganizationSchema = z.discriminatedUnion('kind', [
  GangOrgSchema, GovernmentOrgSchema, CivilOrgSchema, BusinessOrgSchema,
]);
export type Organization = z.infer<typeof OrganizationSchema>;

// Immutable identity and protagonist relation history are deliberately omitted.
const commonChanges = { name: TextSchema, description: z.string(), keyNpcIds: IdsSchema, currentTaskIds: IdsSchema,
  leadership: z.array(LeadershipSchema), relations };
const gangChanges = { territoryText: z.string(), funds: MoneySchema, powerText: z.string(), industries: StringsSchema, internalStatus: z.string() };
const governmentChanges = { jurisdictionText: z.string(), lawfulPowers: StringsSchema, cases: StringsSchema, administrativeAffairs: StringsSchema,
  enforcementCapacityText: z.string(), publicTrustText: z.string(), internalStatus: z.string() };
const civilChanges = { missionText: z.string(), supportersText: z.string(), membershipText: z.string(), activities: StringsSchema,
  activityAreaText: z.string(), publicInfluenceText: z.string() };
const businessChanges = { sectors: StringsSchema, assetsEstimate: MoneySchema, liquidityEstimate: MoneySchema,
  ownershipText: z.string(), operatingStatus: z.string(), businessRelations: StringsSchema };
export const OrganizationChangesSchema = z.strictObject({ ...commonChanges, ...gangChanges, ...governmentChanges, ...civilChanges, ...businessChanges }).partial()
  .refine(value => Object.keys(value).length > 0, '组织更新不能为空');
export const organizationChangeFields = {
  gang: Object.keys({ ...commonChanges, ...gangChanges }), government: Object.keys({ ...commonChanges, ...governmentChanges }),
  civil: Object.keys({ ...commonChanges, ...civilChanges }), business: Object.keys({ ...commonChanges, ...businessChanges }),
};
export const FinancialBasisSchema = z.strictObject({ at: GameTimeSchema, note: TextSchema });
