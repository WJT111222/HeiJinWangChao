import type { SaveSummary } from '../../services/storage/saveManagement';
import { saveKeyText } from '../../services/storage/saveManagement';
import { dateTime } from '../panels/playerView';
import { CITY, saveCity } from './skyline';
import type { City } from './skyline';

export const ticketKey = (save: SaveSummary) => `${typeof save.storageKey}:${saveKeyText(save.storageKey)}`;
export function ticketOrder(saves: readonly SaveSummary[], active?: string): SaveSummary[] {
  return [...saves.filter(s => s.status === 'readable' && s.saveId === active),
    ...saves.filter(s => s.status !== 'readable' || s.saveId !== active)];
}
export function ticketName(title: string) {
  const split = title.indexOf(' · ');
  return split > 0 ? title.slice(0, split) : title;
}
export function ticketTime(updatedAt?: string) {
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return {date: '保存时间无法读取', time: '--:--', full: '保存时间无法读取'};
  const full = dateTime(updatedAt), [date, time] = full.split(/\s+/);
  return {date, time, full: `保存于 ${full}`};
}
export function departure(save: SaveSummary | undefined, active: string | undefined, loading: boolean, error: string) {
  if (loading) return {dest:'···', time:'--:--', status:'读取中', tone:'idle'};
  if (error) return {dest:'———', time:'--:--', status:'暂停检票', tone:'bad'};
  if (!save) return {dest:'新人生', time:'--:--', status:'可购票', tone:'new'};
  if (save.status === 'unreadable') return {dest:'未知', time:'--:--', status:'无法读取', tone:'bad'};
  const city = saveCity(save.title), selected = save.saveId === active;
  return {dest: city ? CITY[city][0] : '未知', time:ticketTime(save.updatedAt).time, status:selected?'已选择':'本地存档', tone:selected?'ok':'idle'};
}

// The supplied design's seeded, decorative guilloche. No save data enters paths.
export function guilloche(city?: City): string[] {
  let seed = ({cq:7, sh:31, hrb:53, gz:97}[city ?? 'cq']) * 7;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const a = 4 + random()*4, f1 = 14 + random()*8, f2 = 5 + random()*3;
  return Array.from({length:15}, (_, k) => Array.from({length:81}, (_, i) => {
    const x = i*4, y = 37+a*Math.sin(x/f1+k*.45)+a*.6*Math.sin(x/f2+k*1.1)+(k-6.5)*4.6;
    return `${i?'L':'M'}${x} ${y.toFixed(1)}`;
  }).join(''));
}
