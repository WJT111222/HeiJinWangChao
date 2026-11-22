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
// 「我的势力」：部门、成员归属与主角已知列表均为可选字段，旧档缺省即为空。
export const DepartmentSchema = z.strictObject({
  id: IdSchema, name: TextSchema, duty: z.string(),
  headPosition: TextSchema.optional(), headPublicName: TextSchema.nullable().optional(), headNpcId: IdSchema.optional(),
  scaleText: z.string().optional(), statusText: z.string().optional(),
}).refine(row => row.headPublicName !== null || row.headNpcId === undefined, '负责人身份未公开时不绑定公开人物入口');
const departments = z.array(DepartmentSchema).refine(rows => new Set(rows.map(r => r.id)).size === rows.length, '部门ID重复');
// covert=true：暗中身份（卧底、暗桩等），主角即使认识此人也不能凭此得知其组织身份。
export const OrganizationMemberSchema = z.strictObject({ npcId: IdSchema, position: TextSchema, departmentId: IdSchema.optional(), covert: z.boolean().optional() });
const members = z.array(OrganizationMemberSchema).refine(rows => new Set(rows.map(r => r.npcId)).size === rows.length, '同一人物仅保留一个成员记录');
/** 主角在剧情里真实得知的该组织据点/产业与内情；由程序填写id与learnedAt，只能逐条追加。 */
export const ProtagonistOrgKnowledgeSchema = z.strictObject({
  id: IdSchema, category: z.enum(['holding', 'intel']), text: TextSchema, source: TextSchema,
  learnedAt: GameTimeSchema, knowledgeKind: z.enum(['observed', 'reported']),
  locationId: IdSchema.optional(), statusText: z.string().optional(),
});
const protagonistKnown = z.array(ProtagonistOrgKnowledgeSchema).refine(rows => new Set(rows.map(r => r.id)).size === rows.length, '已知条目ID重复');
const base = {
  id: IdSchema, name: TextSchema, description: z.string(),
  protagonistRelation: TextSchema, relationHistory: StringsSchema,
  keyNpcIds: IdsSchema, currentTaskIds: IdsSchema,
  leadership: z.array(LeadershipSchema).optional(), relations: relations.optional(),
  departments: departments.optional(), members: members.optional(), protagonistKnown: protagonistKnown.optional(),
};
export const GangOrgSchema = z.strictObject({
  ...base, kind: z.literal('gang'), territoryText: z.string().optional(), funds: MoneySchema.optional(),
  powerText: z.string().optional(), industries: StringsSchema, internalStatus: z.string().optional(),
  reputationText: z.string().optional(),
});
export const GovernmentOrgSchema = z.strictObject({
  ...base, kind: z.literal('government'), jurisdictionText: z.string().optional(),
  lawfulPowers: StringsSchema, cases: StringsSchema, administrativeAffairs: StringsSchema,
  enforcementCapacityText: z.string().optional(), publicTrustText: z.string().optional(), internalStatus: z.string().optional(),
  fundingText: z.string().optional(),
});
export const CivilOrgSchema = z.strictObject({
  ...base, kind: z.literal('civil'), missionText: z.string().optional(), supportersText: z.string().optional(),
  membershipText: z.string().optional(), activities: StringsSchema,
  activityAreaText: z.string().optional(), publicInfluenceText: z.string().optional(),
  fundingText: z.string().optional(),
});
export const BusinessOrgSchema = z.strictObject({
  ...base, kind: z.literal('business'), sectors: StringsSchema,
  assetsEstimate: MoneySchema.optional(), liquidityEstimate: MoneySchema.optional(),
  ownershipText: z.string().optional(), operatingStatus: z.string().optional(), businessRelations: StringsSchema,
  reputationText: z.string().optional(), operatingAreaText: z.string().optional(),
});
export const OrganizationSchema = z.discriminatedUnion('kind', [
  GangOrgSchema, GovernmentOrgSchema, CivilOrgSchema, BusinessOrgSchema,
]);
export type Organization = z.infer<typeof OrganizationSchema>;

// Immutable identity and protagonist relation history are deliberately omitted.
const commonChanges = { name: TextSchema, description: z.string(), keyNpcIds: IdsSchema, currentTaskIds: IdsSchema,
  leadership: z.array(LeadershipSchema), relations, departments, members };
const gangChanges = { territoryText: z.string(), funds: MoneySchema, powerText: z.string(), industries: StringsSchema, internalStatus: z.string(), reputationText: z.string() };
const governmentChanges = { jurisdictionText: z.string(), lawfulPowers: StringsSchema, cases: StringsSchema, administrativeAffairs: StringsSchema,
  enforcementCapacityText: z.string(), publicTrustText: z.string(), internalStatus: z.string(), fundingText: z.string() };
const civilChanges = { missionText: z.string(), supportersText: z.string(), membershipText: z.string(), activities: StringsSchema,
  activityAreaText: z.string(), publicInfluenceText: z.string(), fundingText: z.string() };
const businessChanges = { sectors: StringsSchema, assetsEstimate: MoneySchema, liquidityEstimate: MoneySchema,
  ownershipText: z.string(), operatingStatus: z.string(), businessRelations: StringsSchema, reputationText: z.string(), operatingAreaText: z.string() };
export const OrganizationChangesSchema = z.strictObject({ ...commonChanges, ...gangChanges, ...governmentChanges, ...civilChanges, ...businessChanges }).partial()
  .refine(value => Object.keys(value).length > 0, '组织更新不能为空');
export const organizationChangeFields = {
  gang: Object.keys({ ...commonChanges, ...gangChanges }), government: Object.keys({ ...commonChanges, ...governmentChanges }),
  civil: Object.keys({ ...commonChanges, ...civilChanges }), business: Object.keys({ ...commonChanges, ...businessChanges }),
};
export const FinancialBasisSchema = z.strictObject({ at: GameTimeSchema, note: TextSchema });

/** 主角唯一主势力：归属、代表并依靠的组织。普通雇佣、合作或听说不构成绑定。 */
export const ProtagonistFactionSchema = z.strictObject({
  organizationId: IdSchema, position: TextSchema, departmentId: IdSchema.optional(),
  joinedAt: GameTimeSchema, bondText: TextSchema,
});
export const FactionBindingSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('bind'), position: TextSchema, bondText: TextSchema, departmentId: IdSchema.optional() }),
  z.strictObject({ action: z.literal('update'), position: TextSchema.optional(), bondText: TextSchema.optional(), departmentId: IdSchema.nullable().optional() }),
  z.strictObject({ action: z.literal('unbind') }),
]);
