import { z } from 'zod';
import { ActorRefSchema, IdSchema, TextSchema } from '../common';

export const ItemCategorySchema = z.enum(['top', 'bottom', 'shoes', 'accessory', 'weapon', 'document', 'device', 'other']);
export const ImportantItemSchema = z.strictObject({
  id: IdSchema, name: TextSchema, category: ItemCategorySchema,
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownerRef: ActorRefSchema.optional(), locationId: IdSchema.optional(),
  conditionText: z.string(), itemDetails: z.record(z.string(), z.string()).optional(),
  createdByTurnId: IdSchema.optional(),
});
export type ImportantItem = z.infer<typeof ImportantItemSchema>;
