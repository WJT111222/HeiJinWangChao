import type { TimelineEntry } from '../events/schema';
import { compareHistoryTime, historyTimeKey, historyTimeLabel } from './time';
import type { Chronicle } from './schema';
export type ChronicleEntry = TimelineEntry & { chronicle: Chronicle };
export interface HistorySlot { key: string; label: string; year?: number; entries: ChronicleEntry[] }
export const historyPageSize = 12;
const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function historyProjection(timeline: readonly TimelineEntry[]) {
  const ordered = timeline.filter((entry): entry is ChronicleEntry => Boolean(entry.chronicle)).sort((a, b) =>
    compareHistoryTime(a.chronicle.time, b.chronicle.time) || Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || byId(a.id, b.id));
  const slots: HistorySlot[] = [], groups = new Map<string, HistorySlot>();
  for (const entry of ordered) {
    const time = entry.chronicle.time;
    // Unknown dates share a slot only for the same explicitly identified milestone, not all undated facts.
    const key = time.precision === 'unknown' ? `unknown:${entry.chronicle.milestoneId}` : historyTimeKey(time);
    let slot = groups.get(key);
    if (!slot) {
      const point = time.precision === 'range' ? time.to : time;
      const year = point.precision === 'unknown' ? undefined : point.precision === 'instant'
        ? new Date(Date.parse(point.at) + 8 * 3600000).getUTCFullYear()
        : point.precision === 'day' ? Number(point.date.slice(0, 4)) : point.year;
      slot = { key, label: historyTimeLabel(time), year, entries: [] };
      groups.set(key, slot); slots.push(slot);
    }
    slot.entries.push(entry);
  }
  return { slots, records: timeline.filter(entry => !entry.chronicle) };
}
