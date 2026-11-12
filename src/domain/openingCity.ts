import type { GameState } from './state';

// Save identity, independent of the mutable location tree and of UI artwork keys.
export const openingCities = {
  chongqing: { key: 'cq', name: '重庆', english: 'CHONGQING · 山城' },
  shanghai: { key: 'sh', name: '上海', english: 'SHANGHAI · 魔都' },
  harbin: { key: 'hrb', name: '哈尔滨', english: 'HARBIN · 冰城' },
  guangzhou: { key: 'gz', name: '广州', english: 'GUANGZHOU · 羊城' },
} as const;

// Same legacy suffix rule as home/saveCity. Never inspect protagonist.locationId.
export function normalizeOpeningCity(state: GameState): GameState {
  if (state.openingCityId !== undefined) return state;
  const title = state.title.trim();
  const city = Object.entries(openingCities).find(([, city]) =>
    title.endsWith(`· ${city.name}`) || title.endsWith(`·${city.name}`));
  return { ...state, openingCityId: city?.[0] ?? null };
}

export function openingCity(id: string | null | undefined) {
  return id && Object.hasOwn(openingCities, id) ? openingCities[id as keyof typeof openingCities] : undefined;
}
