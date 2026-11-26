import { z } from 'zod';
import { IdentifierSchema } from './schema';

export const officialIds = ['worldbooks.heijin.worldview', 'worldbooks.heijin.modern_underworld'] as const;
export type OfficialId = typeof officialIds[number];
export const officialSchema = z.strictObject({
  [officialIds[0]]: z.boolean(), [officialIds[1]]: z.boolean(),
});
export type OfficialSelection = z.infer<typeof officialSchema>;
export const worldviewSchema = z.strictObject({
  official: officialSchema,
  books: z.array(z.strictObject({
    bookId: IdentifierSchema, versionId: IdentifierSchema, contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string(), entries: z.array(z.strictObject({ entryId: IdentifierSchema, content: z.string() })),
  })),
});
export type MainWorldview = z.infer<typeof worldviewSchema>;
