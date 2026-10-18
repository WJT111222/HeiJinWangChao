import { z } from 'zod';
import { IdSchema, MoneySchema, TextSchema, GameTimeSchema, ActorRefSchema, entityTable } from '../common';

export const AccountSchema = z.enum(['cash', 'onlineBalance']);
export const IncomeRecordSchema = z.strictObject({
  id: IdSchema, source: TextSchema, amount: MoneySchema.nullable(),
  status: z.enum(['expected', 'received', 'cancelled']),
  account: AccountSchema, expectedAt: GameTimeSchema.optional(), receivedAt: GameTimeSchema.optional(),
  sourceTurnId: IdSchema.optional(), scheduleText: z.string().optional(),
});
export const DebtRecordSchema = z.strictObject({
  id: IdSchema, creditor: TextSchema, principal: MoneySchema.nullable(), outstanding: MoneySchema.nullable(),
  status: z.enum(['active', 'repaid', 'disputed', 'cancelled']),
  dueAt: GameTimeSchema.optional(), repaymentTerms: z.string(),
  collateralAssetIds: z.array(IdSchema), autoPaymentAuthorized: z.boolean(), source: TextSchema,
});
const assetBase = {
  id: IdSchema, name: TextSchema, ownerRef: ActorRefSchema,
  estimatedValue: MoneySchema.nullable(), acquiredAt: GameTimeSchema.optional(),
  source: TextSchema, statusText: z.string(),
};
export const PropertyAssetSchema = z.strictObject({
  ...assetBase, kind: z.literal('property'), locationId: IdSchema, ownershipText: z.string(), mortgageDebtId: IdSchema.optional(),
});
export const VehicleAssetSchema = z.strictObject({
  ...assetBase, kind: z.literal('vehicle'), model: z.string(), plate: z.string().optional(), locationId: IdSchema.optional(),
});
export const OtherAssetSchema = z.strictObject({
  ...assetBase, kind: z.literal('other'), category: TextSchema, details: z.string(),
});
export const EconomySchema = z.strictObject({
  cash: MoneySchema.nullable(), onlineBalance: MoneySchema.nullable(),
  incomes: entityTable(IncomeRecordSchema), debts: entityTable(DebtRecordSchema),
  properties: entityTable(PropertyAssetSchema), vehicles: entityTable(VehicleAssetSchema),
  otherAssets: entityTable(OtherAssetSchema),
});
export type Economy = z.infer<typeof EconomySchema>;
