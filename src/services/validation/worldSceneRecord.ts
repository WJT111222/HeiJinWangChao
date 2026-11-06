import type { ActorRef } from '../../domain/common';
import type { WorldEvent } from '../../domain/events/schema';
import type { GameState } from '../../domain/state';
import { requireWorld } from './worldEvidence';
import type { WorldEvidence } from './worldEvidence';

/** Bounded, extractive record format; these labels never assert an actor's next choice. */
export const sceneRecordGoal = '待处理：等待现场当事人下一步行动，不代表已经作出决定。';
export const sceneRecordCue = '现场事项仍待回应，请决定下一步行动。';
export function sceneRecordDescriptions(locationName: string, quotes: readonly string[]) {
  return { title: `${locationName} · 现场记录`, backgroundText: `现场依据：\n${quotes.join('\n')}`, goalText: sceneRecordGoal };
}
const sameActor = (a: ActorRef, b: ActorRef) => a.kind === b.kind && a.id === b.id;

/** Called after source/affirmative-context verification; does not grant authority to other commands. */
export function validateAnchoredScene(event: WorldEvent, old: WorldEvent | undefined, proof: WorldEvidence, state: GameState) {
  const record = proof.sceneRecord;
  requireWorld(record, 'permission', 'actor_permission');
  const quotes = record.anchors.map(anchor => anchor.quote);
  const namesFor = (ref: ActorRef) => ref.kind === 'protagonist'
    ? ref.id === state.protagonist.id ? [state.protagonist.name, '主角'] : []
    : ref.kind === 'npc' ? state.npc[ref.id] ? [state.npc[ref.id].name, ...state.npc[ref.id].aliases] : []
      : state.organizations[ref.id] ? [state.organizations[ref.id].name] : [];
  for (const anchor of record.anchors) for (const actor of anchor.actorRefs) {
    requireWorld(event.actorRefs.some(ref => sameActor(ref, actor)), 'permission', 'actor_permission');
    // A name elsewhere in the Story is insufficient. It must be the subject of this entire
    // affirmative source clause. Do not interpret a name in a roster/possessive as participation.
    const subject = namesFor(actor).some(name => anchor.quote.startsWith(name)
      && !/^[的、，,。！？：:]/u.test(anchor.quote.slice(name.length))
      && anchor.quote.slice(name.length).replace(/[。！？\s]/gu, '').length >= 2);
    requireWorld(subject, 'permission', 'actor_permission');
  }
  requireWorld(event.actorRefs.every(ref => record.anchors.some(anchor => anchor.actorRefs.some(actor => sameActor(actor, ref)))), 'permission', 'actor_permission');
  const location = event.locationId && state.locations[event.locationId];
  requireWorld(location, 'permission', 'actor_permission');
  requireWorld(event.actorRefs.every(ref => ref.kind !== 'protagonist'
    || state.protagonist.locationId === location.id), 'permission', 'actor_permission');
  if (event.continuation?.direction === 'protagonist')
    requireWorld(quotes.includes(event.continuation.entry.cue) || event.continuation.entry.cue === sceneRecordCue,
      'permission', 'actor_permission');
  const templates = sceneRecordDescriptions(location.name, quotes);
  for (const field of ['title', 'backgroundText', 'goalText', 'resolutionText'] as const) {
    const value = event[field];
    if (value !== undefined && value !== old?.[field]) {
      // A whole quoted proposition or a documented neutral composition, never arbitrary paraphrase.
      // Do not accept word-level splicing that can change a subject, negation or causal relationship.
      requireWorld(quotes.includes(value) || (field !== 'resolutionText' && value === templates[field]), 'permission', 'actor_permission');
    }
  }
}
