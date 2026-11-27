import { z } from 'zod';
import { GameTimeSchema, IdSchema, requireData } from './common';
import { canonicalJson } from './worldbook/canonical';
import { hash53 } from './worldbook/triggerSupport';
import type { GameState } from './state';

export const topicLimit = 5;
export const TopicInput = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  related: z.boolean(),
  expiresAt: GameTimeSchema,
  eventId: IdSchema.optional(),
});
export const Topic = TopicInput.extend({
  id: z.string().min(1),
  at: GameTimeSchema,
  turnId: IdSchema,
  eventVersion: z.string().optional(),
});
export function eventCacheVersion(event: GameState['events'][string]) {
  const sourceTurnIds = [...new Set(event.sourceTurnIds)].sort();
  return 'event-v2:' + hash53(canonicalJson({ ...event, sourceTurnIds })).toString(36);
}

export function seedTopic(
  state: GameState,
  value: z.infer<typeof TopicInput> & { commandId: string },
  turnId: string,
) {
  requireData(
    state.phone.topics.filter((t) => t.turnId === turnId).length < topicLimit,
    'PHONE_TOPIC',
    '每回合最多五条话题种子',
  );
  requireData(
    Date.parse(value.expiresAt) > Date.parse(state.worldClock),
    'PHONE_TIME',
    '话题有效期须晚于本回合时钟',
  );
  requireData(
    !value.eventId || Object.hasOwn(state.events, value.eventId),
    'NOT_FOUND',
    '话题引用的事件不存在',
  );
  const { title, summary, related, expiresAt, eventId } = value;
  state.phone.topics.push({
    id: JSON.stringify([turnId, value.commandId]),
    turnId,
    at: state.worldClock,
    title,
    summary,
    related,
    expiresAt,
    ...(eventId
      ? {
          eventId,
          eventVersion: eventCacheVersion(state.events[eventId]),
        }
      : {}),
  });
}
