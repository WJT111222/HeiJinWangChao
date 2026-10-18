import { z } from 'zod';
import { IdSchema, IdsSchema, StringsSchema, TextSchema, MoneySchema } from '../common';

const base = {
  id: IdSchema, name: TextSchema, description: z.string(),
  protagonistRelation: TextSchema, relationHistory: StringsSchema,
  keyNpcIds: IdsSchema, currentTaskIds: IdsSchema,
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
