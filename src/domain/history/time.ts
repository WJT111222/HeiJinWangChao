import { z } from 'zod';
import { GameTimeSchema, TextSchema } from '../common';

const year = z.number().int().min(1).max(9999);
const text = TextSchema.max(200).optional();
export const HistoryPointSchema = z.discriminatedUnion('precision', [
  z.strictObject({ precision: z.literal('instant'), at: GameTimeSchema, text }),
  z.strictObject({ precision: z.literal('day'), date: z.iso.date(), text }),
  z.strictObject({ precision: z.literal('month'), year, month: z.number().int().min(1).max(12), text }),
  z.strictObject({ precision: z.literal('season'), year, season: z.enum(['spring', 'summer', 'autumn', 'winter']), text }),
  z.strictObject({ precision: z.literal('year'), year, text }),
]);
export const HistoryTimeSchema = z.discriminatedUnion('precision', [
  ...HistoryPointSchema.options,
  z.strictObject({ precision: z.literal('range'), from: HistoryPointSchema, to: HistoryPointSchema, text }),
  z.strictObject({ precision: z.literal('unknown'), text: TextSchema.max(200) }),
]);
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;
export type HistoryTime = z.infer<typeof HistoryTimeSchema>;
const seasons = { spring: [3, 5, '春季'], summer: [6, 8, '夏季'], autumn: [9, 11, '秋季'], winter: [12, 12, '冬季'] } as const;
const china = 8 * 3600000;
function midnight(y: number, m: number, d: number) {
  const at = new Date(0); at.setUTCFullYear(y, m - 1, d); at.setUTCHours(0, 0, 0, 0); return at.getTime() - china;
}
/** Bounds are comparison metadata ONLY. Never persisted as invented occurrence dates.
 * Winter is the named year's December display group, not a cross-year season.
 */
export function historyBounds(time: HistoryTime): { earliest: number; latest: number } | undefined {
  if (time.precision === 'unknown') return undefined;
  if (time.precision === 'instant') return { earliest: Date.parse(time.at), latest: Date.parse(time.at) };
  if (time.precision === 'range') return { earliest: historyBounds(time.from)!.earliest, latest: historyBounds(time.to)!.latest };
  if (time.precision === 'day') {
    const [y, m, d] = time.date.split('-').map(Number);
    return { earliest: midnight(y, m, d), latest: midnight(y, m, d + 1) - 1 };
  }
  // A display season is not a fabricated factual interval, especially winter.
  // Calendar-year bounds only: the explicit seasonal ordering below never changes world time.
  const [from, to] = time.precision === 'month' ? [time.month, time.month] : [1, 12];
  return { earliest: midnight(time.year, from, 1), latest: midnight(time.year, to + 1, 1) - 1 };
}
function parts(at: number) {
  const date = new Date(at + china);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()];
}
/** Lexicographic display order: precise day/time, month tail, season tail, year tail.
 * Ranges sit at their ending precision's tail, labelled as ranges, never as a known instant.
 */
export function historyOrder(time: HistoryTime): number[] {
  if (time.precision === 'unknown') return [Infinity];
  if (time.precision === 'range') return [...historyOrder(time.to), 1, ...historyOrder(time.from)];
  if (time.precision === 'instant') return [...parts(Date.parse(time.at)), 0];
  if (time.precision === 'day') return [...time.date.split('-').map(Number), 24, 0, 0, 0, 0];
  if (time.precision === 'month') return [time.year, time.month, 32, 0, 0, 0, 0, 0];
  if (time.precision === 'season') return [time.year, seasons[time.season][1], 33, 0, 0, 0, 0, 0];
  return [time.year, 13, 0, 0, 0, 0, 0, 0];
}
export function compareHistoryTime(a: HistoryTime, b: HistoryTime) {
  const left = historyOrder(a), right = historyOrder(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0, y = right[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function historyTimeKey(time: HistoryTime): string {
  // Equal instants in different timezone representations share one position; prose is not identity.
  if (time.precision === 'instant') return `instant:${Date.parse(time.at)}`;
  if (time.precision === 'unknown') return 'unknown';
  if (time.precision === 'range') return `range:${historyTimeKey(time.from)}:${historyTimeKey(time.to)}`;
  if (time.precision === 'day') return `day:${time.date}`;
  if (time.precision === 'month') return `month:${time.year}:${time.month}`;
  if (time.precision === 'season') return `season:${time.year}:${time.season}`;
  return `year:${time.year}`;
}
export function historyTimeLabel(time: HistoryTime): string {
  if (time.precision === 'unknown') return `时间待考 · ${time.text}`;
  if (time.precision === 'range') return `${historyTimeLabel(time.from)} — ${historyTimeLabel(time.to)}${time.text ? `（${time.text}）` : ''}`;
  let label: string;
  if (time.precision === 'instant') {
    const [y, m, d, h, min, sec, ms] = parts(Date.parse(time.at));
    label = `${y}年${m}月${d}日 ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
      + (sec || ms ? `:${String(sec).padStart(2, '0')}${ms ? `.${String(ms).padStart(3, '0')}` : ''}` : '');
  } else if (time.precision === 'day') label = `${time.date}（时刻未详）`;
  else if (time.precision === 'month') label = `${time.year}年${time.month}月（月内日期未详）`;
  else if (time.precision === 'season') label = `${time.year}年${seasons[time.season][2]}（日期未详）`;
  else label = `${time.year}年（年内日期未详）`;
  return time.text ? `${label} · ${time.text}` : label;
}
