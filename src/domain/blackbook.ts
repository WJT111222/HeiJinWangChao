import { z } from 'zod';
import { CountSchema, GameTimeSchema } from './common';
import { eventCacheVersion } from './phoneTopic';
import type { GameState } from './state';

const text = z.string().min(1);
const response = z.strictObject({
  author: text,
  text,
  at: GameTimeSchema,
  region: text,
  likes: CountSchema,
  replyTo: text.optional(),
  byAuthor: z.boolean(),
});
const comment = response.extend({ replies: response.array() });
export const BookPost = z.strictObject({
  author: text,
  title: text,
  subtitle: text,
  body: text,
  tags: text.array(),
  at: GameTimeSchema,
  location: text,
  likes: CountSchema,
  saves: CountSchema,
  comments: comment.array(),
});
export type BookPost = z.infer<typeof BookPost>;
export interface BookSource {
  id: string;
  key: string;
  kind: 'topic' | 'event';
  seedId: string;
  title: string;
  summary: string;
  related: boolean;
  at: string;
}
export function bookSources(state: GameState, instance: string | null) {
  function source(
    topic: GameState['phone']['topics'][number],
    kind: BookSource['kind'],
    id: string,
    version: readonly unknown[],
  ): BookSource {
    const { title, summary, related, at } = topic;
    return {
      kind,
      id,
      seedId: topic.id,
      title,
      summary,
      related,
      at,
      key: JSON.stringify([
        state.saveId,
        state.createdAt,
        instance,
        kind,
        id,
        version,
        title,
        summary,
        at,
        related,
      ]),
    };
  }
  const published = state.phone.topics
    .filter((t) => Date.parse(t.expiresAt) > Date.parse(state.worldClock))
    .reverse()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const hot: BookSource[] = [];
  const ranked = new Set<string>();
  const topics = published.map((topic) => {
    const { eventId } = topic;
    const entry = source(topic, 'topic', topic.id, [topic.expiresAt, eventId, topic.eventVersion]);
    const event = eventId ? state.events[eventId] : undefined;
    if (event && event.eventKind === 'main' && !ranked.has(event.id)) {
      ranked.add(event.id);
      // Private event fields never enter a post, its cache key or the ranking.
      const version = eventCacheVersion(event);
      // Older seeds stored just one turn ID. A sole matching source still identifies
      // that original settlement only if variable management has never edited the save.
      const legacyMatch =
        !state.npcManagementRevision &&
        event.sourceTurnIds.length === 1 &&
        event.sourceTurnIds[0] === topic.eventVersion;
      const headline = source(topic, 'event', event.id, [topic.id, version]);
      if (topic.eventVersion === version || legacyMatch) headline.key = entry.key;
      hot.push(headline);
    }
    return entry;
  });
  return { topics, hot };
}
