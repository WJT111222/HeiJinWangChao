import type { GameState } from '../state';
import { searchHistory } from '../memories/history';
import { storyMemoryContext } from '../memories/publicMemory';
import { contextMessage } from '../../prompts/contextMessage';
import { estimateTokens } from '../../prompts/statistics';
import { maxTheaterBackground } from './record';
import type { TheaterBackground } from './record';

const clip = (value: string | undefined, limit: number) => value && (value.length > limit ? value.slice(0, limit - 1) + '…' : value);
export const theaterInputTokens = 16_000;

export function theaterBackground(state: GameState, theme: string, window: number): TheaterBackground {
  const hero = state.protagonist;
  const time = state.openingTimePending ? null : state.worldClock;
  const protagonist = hero.name.slice(0, 160);
  const related = (names: (string | undefined)[]) => names.some(name => name && name.trim().length >= 2 && theme.includes(name));
  const people = Object.values(state.npc).filter(npc => related([npc.name, ...npc.aliases]) || npc.onScene)
    .sort((a, b) => Number(related([b.name, ...b.aliases])) - Number(related([a.name, ...a.aliases])))
    .slice(0, 8);
  const ids = new Set(people.map(npc => npc.id));
  const memory = storyMemoryContext(state, Math.min(4, window), theme, true);
  const matches = searchHistory(memory.summaries.map((entry, index) => ({
    turnId: entry.id, turnNumber: index + 1, narrative: '', summary: entry.text, relatedActorRefs: [],
  })), theme);
  const priority = new Map(matches.map((entry, index) => [entry.turnId, matches.length - index]));
  const summaries = memory.summaries.sort((a, b) => (priority.get(b.id) ?? 0) - (priority.get(a.id) ?? 0))
    .map(({ layer, text }) => ({ layer, text: clip(text, 900) }));
  const context = {
    source: { turn: state.turnNumber, revision: state.revision, time },
    protagonist: { name: protagonist, age: hero.age, gender: clip(hero.gender, 60), profession: clip(hero.profession, 120),
      personality: clip(hero.personality, 400), appearance: clip(hero.appearance, 400), background: clip(hero.background, 1200) },
    world: { location: clip(state.locations[hero.locationId]?.name, 160),
      area: clip(state.locations[state.locations[hero.locationId]?.parentId ?? '']?.name, 160),
      weather: clip(state.weatherText, 120), environment: clip(state.environmentText, 500) },
    characters: people.map(npc => ({ name: clip(npc.name, 120), identity: clip(npc.identity, 160),
      appearance: clip(npc.appearance, 180), personality: clip(npc.temperament, 220), background: clip(npc.background, 420),
      relationship: clip(npc.relationshipText, 240), addressing: npc.addressing && {
        playerToNpc: clip(npc.addressing.playerToNpc, 100), npcToPlayer: clip(npc.addressing.npcToPlayer, 100) },
    })),
    immediate: memory.recentTurns.map(turn => ({ turn: turn.turnNumber, summary: clip(turn.summary, 460),
      excerpt: clip(turn.narrative, 420) })),
    recalled: memory.recalledTurns.map(turn => ({ turn: turn.turnNumber, summary: clip(turn.summary, 420) })),
    summaries,
    organizations: Object.values(state.organizations).filter(org => related([org.name]) || org.keyNpcIds.some(id => ids.has(id)))
      .slice(0, 4).map(org => ({ name: clip(org.name, 120), description: clip(org.description, 380),
        relation: clip(org.protagonistRelation, 140) })),
    events: Object.values(state.events).filter(event => event.visibility === 'known' && (
      related([event.title]) || event.locationId === hero.locationId || event.actorRefs.some(ref => ids.has(ref.id))))
      .slice(0, 4).map(event => ({ title: clip(event.title, 120), status: event.status,
        background: clip(event.backgroundText, 320), result: clip(event.resolutionText, 200) })),
  };
  const encode = () => contextMessage(context, 'THEATER_BACKGROUND');
  let serialized = encode();
  while (serialized.length > maxTheaterBackground || estimateTokens(serialized).estimatedTokens > 8_000) {
    // All variable-size sections are bounded individually. Preserve the protagonist and location.
    const last = [context.summaries, context.recalled, context.events, context.organizations, context.characters, context.immediate]
      .find(entries => entries.length);
    if (!last) break;
    last.pop();
    serialized = encode();
  }
  return { turn: state.turnNumber, revision: state.revision, schemaVersion: state.schemaVersion, time, protagonist, context: serialized };
}
