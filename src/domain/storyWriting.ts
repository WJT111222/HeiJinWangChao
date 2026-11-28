import { z } from 'zod';
import { STORY_STYLE_IDS } from '../ui/settings/storyStyles';
export const StoryWritingSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('native'), prefixSource: z.literal('unknown').optional(), min: z.number().int().positive(), max: z.number().int().positive(),
    perspective: z.enum(['first', 'second', 'third']), style: z.enum(STORY_STYLE_IDS), naturalProse: z.boolean() }),
  z.strictObject({ source: z.literal('preset'), id: z.string().min(1), version: z.string().min(1),
    prefixSource: z.literal('unknown').optional(), configurationVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(), configuration: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export type StoryWriting = z.infer<typeof StoryWritingSchema>;

export function continuationMinimum(writing: StoryWriting | undefined, currentNativeMinimum: number): number | undefined {
  if (writing?.source !== 'native') return undefined;
  // An explicit native continuation can use a newly selected native range, as before.
  return currentNativeMinimum;
}

export function sameWritingSource(previous: StoryWriting | undefined, current: StoryWriting): boolean {
  if (current.source === 'native') return previous?.source === 'native';
  return previous?.source === 'preset' && previous.id === current.id
    && previous.version === current.version && previous.configurationVersion === current.configurationVersion
    && previous.configuration === current.configuration;
}
