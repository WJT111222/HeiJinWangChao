import { z } from 'zod';
import { IdSchema, IdsSchema, TextSchema } from '../common';
import { HistoryTimeSchema } from './time';

export const HistoryStatementSchema = z.strictObject({
  text: TextSchema.max(400), nature: z.enum(['fact', 'statement', 'rumor', 'inference']), sourceText: TextSchema.max(200).optional(),
});
const shared = {
  milestoneId: IdSchema,
  nature: z.enum(['fact', 'statement', 'rumor', 'inference']),
  time: HistoryTimeSchema,
  narrative: TextSchema.max(3000),
  process: z.array(TextSchema.max(300)).max(8),
  results: z.array(HistoryStatementSchema).max(6),
  impacts: z.array(HistoryStatementSchema).max(6),
  locationText: TextSchema.max(200).optional(),
  supportingTurnIds: IdsSchema.max(40).optional(),
  relations: z.array(z.strictObject({ kind: z.enum(['follows', 'corrects', 'parallel']), entryId: IdSchema })).max(32).optional(),
};
/** Optional on old records. AI supplies significance; no numerical/semantic classifier. */
export const ChronicleSchema = z.discriminatedUnion('category', [
  z.strictObject({ ...shared, category: z.literal('world'), scope: z.enum(['region', 'country', 'world', 'organization']),
    scopeText: TextSchema.max(120), basis: z.enum(['event_result', 'historical_event', 'cancellation_decision']), endTime: HistoryTimeSchema }),
  z.strictObject({ ...shared, category: z.literal('protagonist'), endTime: HistoryTimeSchema.optional() }),
]);
export type Chronicle = z.infer<typeof ChronicleSchema>;
