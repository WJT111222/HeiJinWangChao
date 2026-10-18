import { z } from 'zod';
import { IdSchema, TextSchema, StringsSchema, IdsSchema } from '../common';

export const EquipmentSchema = z.strictObject({
  topItemId: IdSchema.optional(),
  bottomItemId: IdSchema.optional(),
  shoesItemId: IdSchema.optional(),
  accessoryItemIds: IdsSchema,
  primaryWeaponItemId: IdSchema.optional(),
  secondaryWeaponItemId: IdSchema.optional(),
  currentVehicleAssetId: IdSchema.optional(),
});
export const ProtagonistSchema = z.strictObject({
  id: IdSchema, name: TextSchema, age: z.number().int().nonnegative(),
  gender: TextSchema, appearance: z.string(), personality: z.string(),
  profession: TextSchema, background: z.string().optional(), skills: StringsSchema,
  healthText: z.string(), emotionText: z.string(),
  publicStatus: z.string().optional(), legalStatus: z.string().optional(),
  locationId: IdSchema, currentWear: EquipmentSchema,
});
export type Protagonist = z.infer<typeof ProtagonistSchema>;
