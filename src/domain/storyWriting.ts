import { z } from 'zod';
import { STORY_STYLE_IDS } from '../ui/settings/storyStyles';
export const StoryWritingSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('native'), min: z.number().int().positive(), max: z.number().int().positive(),
    perspective: z.enum(['first', 'second', 'third']), style: z.enum(STORY_STYLE_IDS), naturalProse: z.boolean() }),
  z.strictObject({ source: z.literal('preset'), id: z.string().min(1), version: z.string().min(1),
    configuration: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export type StoryWriting = z.infer<typeof StoryWritingSchema>;

export function continuationMinimum(writing: StoryWriting | undefined, currentNativeMinimum: number): number | undefined {
  if (writing?.source === 'preset') return undefined;
  // An explicit native continuation can use a newly selected native range, as before.
  return currentNativeMinimum;
}

export function sameWritingSource(previous: StoryWriting | undefined, current: StoryWriting): boolean {
  if (current.source === 'native') return previous?.source !== 'preset';
  return previous?.source === 'preset' && previous.id === current.id
    && previous.version === current.version && previous.configuration === current.configuration;
}
