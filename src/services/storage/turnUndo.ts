import { retainNpcChoices } from '../../domain/npc/profiles';
import { z } from 'zod';
import { CountSchema, IdSchema, requireData } from '../../domain/common';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { migrateSave } from './migrations';
import { request } from './idb';

/** Storage policy, independent of V6 GameState and the snapshot encoding. UTF-8 bytes,
 * not a claim about the browser's physical IndexedDB allocation. */
export const undoPolicy = Object.freeze({ maxTurns: 5, maxBytes: 64 * 1024 * 1024 });
export const timelineStores = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls'];
const DescriptorSchema = z.strictObject({ turnId: IdSchema, beforeTurnId: IdSchema, bytes: CountSchema });
const ControlSchema = z.strictObject({
  saveId: IdSchema, epoch: IdSchema,
  records: z.array(DescriptorSchema).max(undoPolicy.maxTurns),
  input: z.string().max(100000), memoryPaused: z.boolean(),
  notice: z.enum(['budget', 'quota', 'legacy_write']).optional(),
  lastNpcManagement: z.strictObject({operationId:IdSchema,request:z.string(),managementRevision:CountSchema}).optional(),
  lastUndo: z.strictObject({ operationId: IdSchema, revision: CountSchema, draftTurnId: IdSchema }).optional(),
});
export type SaveControl = z.infer<typeof ControlSchema>;
export interface MemoryLineage { saveId: string; epoch: string }
export interface UndoStatus {
  available: number; bytes: number; maxTurns: number; maxBytes: number;
  input: string; memoryPaused: boolean; notice?: SaveControl['notice'];
  unavailable?: 'opening' | 'no_history' | 'chain';
}
const SnapshotSchema = z.strictObject({
  version: z.literal(1), saveId: IdSchema, turnId: IdSchema, beforeTurnId: IdSchema,
  input: z.string().max(100000), stateJSON: z.string(),
});
export function newSaveControl(saveId: string): SaveControl {
  return { saveId, epoch: `epoch-${crypto.randomUUID()}`, records: [], input: '', memoryPaused: false };
}
export async function readControl(tx: IDBTransaction, saveId: string): Promise<SaveControl | undefined> {
  const raw: unknown = await request(tx.objectStore('saveControls').get(saveId));
  if (raw === undefined) return undefined;
  const parsed = ControlSchema.parse(raw);
  requireData(parsed.saveId === saveId, 'UNDO_CORRUPT', '撤回索引与存档不一致');
  return parsed;
}
export async function writeControl(tx: IDBTransaction, control: SaveControl) {
  await request(tx.objectStore('saveControls').put(ControlSchema.parse(control)));
}
export async function clearUndoRecords(tx: IDBTransaction, saveId: IDBValidKey) {
  const store = tx.objectStore('turnUndo');
  for (const key of await request(store.index('saveId').getAllKeys(saveId))) await request(store.delete(key));
}
export async function assertMemoryLineage(tx: IDBTransaction, saveId: string, token: MemoryLineage) {
  const control = await readControl(tx, saveId);
  requireData(Boolean(control && token && token.saveId === saveId && token.epoch === control.epoch),
    'MEMORY_TIMELINE_CHANGED', '存档时间线已改变，本次旧总结未保存');
  return control!;
}
export async function inspectUndo(tx: IDBTransaction, state: GameState): Promise<UndoStatus> {
  const control = await readControl(tx, state.saveId);
  const records = control?.records ?? [];
  const keys = await request(tx.objectStore('turnUndo').index('saveId').getAllKeys(state.saveId));
  const valid = records.every((entry, index) =>
    keys.some(key => Array.isArray(key) && key[1] === entry.turnId)
    && (index === 0 || entry.beforeTurnId === records[index - 1].turnId))
    && (!records.length || records.at(-1)!.turnId === state.journal.at(-1)?.turnId);
  return { available: valid ? records.length : 0, bytes: records.reduce((sum, entry) => sum + entry.bytes, 0),
    maxTurns: undoPolicy.maxTurns, maxBytes: undoPolicy.maxBytes, input: control?.input ?? '',
    memoryPaused: control?.memoryPaused ?? false, notice: control?.notice,
    ...(!valid ? { unavailable: 'chain' as const } : !records.length ? { unavailable: state.turnNumber <= 1 ? 'opening' as const : 'no_history' as const } : {}) };
}

/** Runs inside the formal commit transaction, reading the latest (including summaries)
 * pre-turn state. Metadata lists only a contiguous suffix of the active timeline. */
export async function recordUndo(tx: IDBTransaction, state: GameState, draft: TurnDraft, quotaFallback: boolean) {
  const control = await readControl(tx, state.saveId) ?? newSaveControl(state.saveId);
  const previousTurn = state.journal.at(-1)?.turnId;
  if (control.records.length && (await inspectUndo(tx, state)).unavailable === 'chain') {
    await clearUndoRecords(tx, state.saveId); control.records = [];
  }
  control.input = ''; delete control.lastUndo; delete control.notice;
  if (quotaFallback || !previousTurn || state.turnNumber === 0 || state.openingTimePending || state.openingInitializationPending) {
    await clearUndoRecords(tx, state.saveId); control.records = [];
    if (quotaFallback) control.notice = 'quota';
    await writeControl(tx, control); return;
  }
  const snapshot = SnapshotSchema.parse({ version: 1, saveId: state.saveId, turnId: draft.turnId,
    beforeTurnId: previousTurn, input: draft.userInput, stateJSON: JSON.stringify(state) });
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (bytes > undoPolicy.maxBytes) {
    await clearUndoRecords(tx, state.saveId); control.records = []; control.notice = 'budget';
  } else {
    let total = control.records.reduce((sum, item) => sum + item.bytes, 0) + bytes;
    const store = tx.objectStore('turnUndo');
    while (control.records.length && (control.records.length >= undoPolicy.maxTurns || total > undoPolicy.maxBytes)) {
      const oldest = control.records.shift()!; total -= oldest.bytes;
      await request(store.delete([state.saveId, oldest.turnId]));
    }
    await request(store.add(snapshot));
    control.records.push({ turnId: draft.turnId, beforeTurnId: previousTurn, bytes });
  }
  await writeControl(tx, control);
}
export async function restoreSnapshot(tx: IDBTransaction, state: GameState, control: SaveControl): Promise<{ state: GameState; input: string }> {
  const status = await inspectUndo(tx, state), head = control.records.at(-1);
  requireData(status.available > 0 && head, 'UNDO_UNAVAILABLE', '没有可靠的已提交回合恢复点');
  const record = SnapshotSchema.parse(await request(tx.objectStore('turnUndo').get([state.saveId, head!.turnId])));
  const before = migrateSave(JSON.parse(record.stateJSON));
  requireData(record.saveId === state.saveId && record.turnId === head!.turnId && record.beforeTurnId === head!.beforeTurnId
    && before.saveId === state.saveId && before.createdAt === state.createdAt && before.turnNumber >= 1
    && before.turnNumber === state.turnNumber - 1 && before.revision < state.revision
    && before.journal.at(-1)?.turnId === record.beforeTurnId
    && before.journal.every((entry, index) => entry.turnId === state.journal[index]?.turnId && entry.revision === state.journal[index]?.revision),
  'UNDO_CORRUPT', '恢复点与当前时间线不一致，未修改存档');
  // Business time can go back; concurrency revision must never do so (ABA protection).
  const restored = GameStateSchema.parse({ ...retainNpcChoices(before,state), openingCityId: state.openingCityId,
    revision: state.revision + 1, updatedAt: new Date().toISOString() });
  await request(tx.objectStore('turnUndo').delete([state.saveId, head!.turnId]));
  control.records.pop();
  control.epoch = `epoch-${crypto.randomUUID()}`;
  control.memoryPaused = true;
  control.input = record.input;
  delete control.notice;
  return { state: restored, input: record.input };
}
