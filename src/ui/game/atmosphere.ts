import { openingCity } from '../../domain/openingCity';
import { chinaCalendar } from '../../domain/openingTime';
import type { GameState } from '../../domain/state';

export function deriveAtmosphere(state: Pick<GameState, 'openingCityId' | 'openingTimePending' | 'worldClock' | 'weatherText'>) {
  const hour = state.openingTimePending ? 21 : chinaCalendar(state.worldClock).hour;
  const time = hour < 5 || hour >= 23 ? 'late' : hour < 7 ? 'dawn' : hour < 17 ? 'day' : hour < 19 ? 'dusk' : 'night';
  const text = state.weatherText;
  const weather = /雨/.test(text) ? 'rain' : /雪/.test(text) ? 'snow' : /雾|霾/.test(text) ? 'fog' : /阴|云/.test(text) ? 'cloud' : 'clear';
  return { city: openingCity(state.openingCityId)?.key ?? 'other', time, weather } as const;
}

export const timeNames = { dawn: '黎明', day: '午后', dusk: '黄昏', night: '入夜', late: '深夜' };
export const weatherSeals = { rain: '雨', snow: '雪', fog: '雾', cloud: '阴', clear: '晴' };

// Text only: never used to derive visual identity. Stop before a national root.
export function locationText(locations: GameState['locations'], id: string) {
  const chain: GameState['locations'][string][] = [], seen = new Set<string>();
  let node = locations[id];
  while (node && !seen.has(node.id) && node.id !== 'china') {
    seen.add(node.id); chain.unshift(node);
    if (!node.parentId) break;
    node = locations[node.parentId];
  }
  const city = chain.find(n => openingCity(n.id)) ?? (chain.length > 1 ? chain[0] : undefined);
  return { name: locations[id]?.name ?? '地点未确认', path: chain.slice(0, -1).map(n => n.name).join(' › '), city: city?.name };
}

const CN = '零一二三四五六七八九';
export function cn(n: number): string {
  if (n < 10) return CN[n];
  if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
  if (n < 100) return CN[n / 10 | 0] + '十' + (n % 10 ? CN[n % 10] : '');
  if (n >= 1000) return String(n); // Keep headings usable beyond the design's 999-turn range.
  const h = n / 100 | 0, r = n % 100;
  return CN[h] + '百' + (r === 0 ? '' : r < 10 ? '零' + CN[r] : (r < 20 ? '一' : '') + cn(r));
}
export function dx(n: number) {
  const letters: Record<string, string> = { 一: '壹', 二: '贰', 三: '叁', 四: '肆', 五: '伍', 六: '陆', 七: '柒', 八: '捌', 九: '玖', 十: '拾', 百: '佰', 零: '零' };
  return cn(n).replace(/[一二三四五六七八九十百零]/g, c => letters[c]);
}
export function sceneTime(time: string) {
  const c = chinaCalendar(time);
  return `${cn(c.month)}月${cn(c.day)}日 · ${c.weekday} · ${cn(c.hour)}时${c.minute ? cn(c.minute) + '分' : '整'}`;
}
