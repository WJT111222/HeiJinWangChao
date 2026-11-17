import { z } from 'zod';
import { request } from '../idb';
import { CountSchema, GameTimeSchema, IdSchema } from '../../../domain/common';
import type { GameState } from '../../../domain/state';

export const HistorySummarySchema = z.strictObject({
  turnNumber: CountSchema, worldClock: GameTimeSchema, savedAt: GameTimeSchema,
  protagonistName: z.string(), title: z.string(), lastTurnId: IdSchema,
});
export type HistorySummary = z.infer<typeof HistorySummarySchema>;
export function historySummary(state: GameState): HistorySummary {
  return HistorySummarySchema.parse({ turnNumber: state.turnNumber, worldClock: state.worldClock,
    savedAt: state.updatedAt, protagonistName: state.protagonist.name, title: state.title, lastTurnId: state.journal.at(-1)?.turnId });
}
export const ManualHistorySchema = z.strictObject({
  version: z.literal(1), saveId: IdSchema, id: IdSchema, name: z.string().trim().min(1).max(100),
  sourceInstance: IdSchema.nullable(), sourceCreatedAt: GameTimeSchema,
  createdAt: GameTimeSchema, updatedAt: GameTimeSchema, summary: HistorySummarySchema,
  bytes: CountSchema, rawBytes: CountSchema, encoding: z.enum(['gzip', 'json']), digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ManualHistory = z.infer<typeof ManualHistorySchema>;
export type HistoryNode = { kind: 'automatic' | 'manual'; id: string; name: string; bytes: number;
  summary?: HistorySummary; turnNumber: number; oldTimeline: boolean; source: string; createdAt?: string; error?: string };
export const historyStores = ['historyMetadata', 'historyPayloads'];
export async function clearManualHistory(tx: IDBTransaction, saveId: IDBValidKey) {
  for (const name of historyStores) {
    const store = tx.objectStore(name);
    for (const key of await request(store.index('saveId').getAllKeys(saveId))) await request(store.delete(key));
  }
}
