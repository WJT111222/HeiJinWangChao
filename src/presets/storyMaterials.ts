import type { AiMessage } from '../services/ai/protocols';
import { isCustomCityId, normalizeOpeningCity, openingCities, openingCityIdentity } from '../domain/openingCity';
import { contextMessage, worldWeekday, type ComposeInput } from '../prompts/context';
import type { sharedContext } from '../prompts/sharedContext';
import type { StoryMaterials, MaterialSlot } from './messages';

export function storyMaterials(
  input: ComposeInput,
  context: Record<string, unknown>,
  worldview: string,
): StoryMaterials {
  const { state } = input;
  const { SAVE_STATE, MEMORY_CONTEXT, ...facts } = context as ReturnType<typeof sharedContext> &
    Record<string, unknown>;
  const { protagonist, memories, worldClock, ...world } = SAVE_STATE;
  const { long, ...otherMemories } = memories;
  const { recentTurns, ...recall } = MEMORY_CONTEXT;
  delete facts.PLAYER_ACTION;
  const creation = facts.CREATION_PROFILE as { companion?: unknown } | undefined;
  delete facts.CREATION_PROFILE;
  const opening = facts.OPENING_TIME as Record<string, unknown> | undefined;
  if (opening) {
    const copy = { ...opening };
    delete copy.playerPreference;
    delete copy.playerBackground;
    facts.OPENING_TIME = copy;
  }
  const history: AiMessage[] = [];
  for (const turn of recentTurns) {
    const action = input.historyActions?.[turn.turnId];
    if (action) history.push({ role: 'user', content: action });
    history.push({ role: 'assistant', content: turn.narrative });
  }
  history.push({ role: 'user', content: input.userInput });
  let city: string | undefined = openingCityIdentity(normalizeOpeningCity(state))?.name;
  const visited = new Set<string>();
  let location = state.locations[protagonist.locationId];
  while (location && !visited.has(location.id)) {
    visited.add(location.id);
    const currentCity = Object.values(openingCities).find((item) => item.name === location.name) ?? (isCustomCityId(location.id) ? location : undefined);
    if (currentCity || location.parentId === 'china') {
      city = location.name;
      break;
    }
    if (!location.parentId) break;
    location = state.locations[location.parentId];
  }
  const scene = Object.values(state.npc).filter((n) => n.onScene);
  return {
    user: protagonist.name,
    char: scene.map((n) => n.name).join('、'),
    history,
    markers: {
      charDescription: worldview,
      charPersonality: '',
      dialogueExamples: '',
      enhanceDefinitions: '',
      personaDescription: contextMessage({ protagonist }),
      scenario: contextMessage({
        worldClock,
        weekday: worldClock ? worldWeekday(worldClock) : undefined,
        city,
        location: state.locations[protagonist.locationId]?.name,
      }),
      worldInfoBefore: contextMessage({
        ...facts,
        SAVE_STATE: { ...world, memories: otherMemories },
        MEMORY_CONTEXT: recall,
        companion: creation?.companion,
      }),
      worldInfoAfter: long.length ? contextMessage({ long }) : '',
    } satisfies Record<MaterialSlot, string>,
  };
}
