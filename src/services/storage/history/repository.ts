import { z } from 'zod';
import { DataError, IdSchema, requireData } from '../../../domain/common';
import { fingerprint } from '../../../domain/commands';
import { createTurnDraft, TurnDraftSchema } from '../../../domain/drafts';
import { GameStateSchema } from '../../../domain/state';
import type { GameState } from '../../../domain/state';
import { reserveStageSession, withBrowserLock } from '../../../workflows/stageGuard';
import { request, transaction } from '../idb';
import { migrateSave } from '../migrations';
import { clearUndoRecords, controlInstance, inspectUndo, newSaveControl, readControl, SnapshotSchema, timelineStores, writeControl } from '../turnUndo';
import { notifyImages, imageTimelineChange } from '../../images/library';
import { historyCodec } from './worker';
import { historyStores, historySummary, ManualHistorySchema } from './model';
import type { HistoryNode, ManualHistory } from './model';
import { maxHistoryBytes, PayloadSchema } from './codec';
import type { HistoryPayload } from './codec';
import { utf8ByteLength } from '../backup';

const stores = [...timelineStores, ...historyStores];
const nameSchema = z.string().trim().min(1).max(100);
export type HistorySelection = { kind: 'automatic' | 'manual'; id: string };
declare const historyBrand: unique symbol;
export interface HistoryConfirmation { readonly [historyBrand]: true }
export interface HistoryPreview {
  state: GameState; node: HistoryNode; confirmation: HistoryConfirmation; currentTurn: number; hasDraft: boolean;
}
interface Current { state: unknown; draft: unknown; control: unknown }
interface Selected { metadata?: unknown; record: unknown }
interface Confirmation { owner: HistoryRepository; saveId: string; selection: HistorySelection; current: Current; source: Selected }
const confirmations = new WeakMap<HistoryConfirmation, Confirmation>();
function same(a: unknown, b: unknown) { return fingerprint(a) === fingerprint(b); }
function sameSource(a: Selected, b: Selected) {
  if (!same(a.metadata, b.metadata)) return false;
  if (a.metadata === undefined) return same(a.record, b.record);
  const left = payloadRecord(a.record), right = payloadRecord(b.record);
  if (!same({ ...left, data: undefined }, { ...right, data: undefined })) return false;
  const x = new Uint8Array(left.data), y = new Uint8Array(right.data);
  return x.length === y.length && x.every((value, i) => value === y[i]);
}
async function current(tx: IDBTransaction, saveId: string): Promise<Current> {
  return { state: await request(tx.objectStore('saves').get(saveId)),
    draft: await request(tx.objectStore('drafts').get(saveId)), control: await request(tx.objectStore('saveControls').get(saveId)) };
}
function checkedState(raw: unknown, saveId: string) {
  const state = migrateSave(raw);
  requireData(state.saveId === saveId, 'HISTORY_CORRUPT', '历史存档身份不一致');
  return state;
}
function settled(state: GameState) {
  requireData(state.turnNumber >= 1 && state.journal.length > 0 && !state.openingTimePending && !state.openingInitializationPending,
    'HISTORY_OPENING', '请先完成开局正式结算；未结算正文不能保存为历史节点');
}
function payloadRecord(raw: unknown): HistoryPayload {
  return z.strictObject({ saveId: IdSchema, id: IdSchema, payload: PayloadSchema }).parse(raw).payload;
}
async function source(tx: IDBTransaction, saveId: string, selection: HistorySelection): Promise<Selected> {
  IdSchema.parse(saveId); IdSchema.parse(selection.id);
  if (selection.kind === 'automatic') return { record: await request(tx.objectStore('turnUndo').get([saveId, selection.id])) };
  return { metadata: await request(tx.objectStore('historyMetadata').get([saveId, selection.id])),
    record: await request(tx.objectStore('historyPayloads').get([saveId, selection.id])) };
}
function manualNode(meta: ManualHistory, state: GameState, instance: string | null): HistoryNode {
  return { kind: 'manual', id: meta.id, name: meta.name, bytes: meta.bytes, summary: meta.summary, turnNumber: meta.summary.turnNumber,
    source: meta.sourceInstance ?? '原始时间线', createdAt: meta.createdAt,
    oldTimeline: meta.sourceCreatedAt !== state.createdAt || meta.sourceInstance !== instance
      || !state.journal.some(entry => entry.turnId === meta.summary.lastTurnId) };
}
function storedBytes(meta: ManualHistory, payload: HistoryPayload) {
  // Logical record bytes: two UTF-8 JSON envelopes + the actual encoded buffer.
  // IndexedDB engine/index/page overhead is intentionally not called exact disk usage.
  return utf8ByteLength(JSON.stringify(meta)) + utf8ByteLength(JSON.stringify({ saveId: meta.saveId, id: meta.id,
    payload: { ...payload, data: undefined } })) + payload.data.byteLength;
}
function sizeMeta(meta: ManualHistory, payload: HistoryPayload) {
  let bytes = storedBytes(meta, payload);
  while (bytes !== meta.bytes) { meta.bytes = bytes; bytes = storedBytes(meta, payload); }
  return ManualHistorySchema.parse(meta);
}
async function decode(source: Selected, selection: HistorySelection, saveId: string): Promise<GameState> {
  if (selection.kind === 'automatic') {
    const record = SnapshotSchema.parse(source.record);
    requireData(record.saveId === saveId && record.turnId === selection.id, 'HISTORY_CORRUPT', '恢复点身份不一致');
    requireData(record.stateJSON.length <= maxHistoryBytes, 'HISTORY_TOO_LARGE', '历史节点超过安全大小限制');
    return historyCodec({ kind: 'parse', json: record.stateJSON });
  }
  const meta = ManualHistorySchema.parse(source.metadata), raw = z.object({ saveId: IdSchema, id: IdSchema }).parse(source.record);
  const payload = payloadRecord(source.record);
  requireData(meta.saveId === saveId && meta.id === selection.id && raw.saveId === saveId && raw.id === selection.id
    && meta.digest === payload.digest && meta.encoding === payload.encoding && meta.rawBytes === payload.rawBytes
    && meta.bytes === storedBytes(meta, payload), 'HISTORY_CORRUPT', '收藏元数据与内容不一致');
  const state = await historyCodec({ kind: 'decode', payload });
  requireData(state.saveId === saveId && state.createdAt === meta.sourceCreatedAt && same(historySummary(state), meta.summary),
    'HISTORY_CORRUPT', '收藏摘要与正式内容不一致');
  return state;
}

/** No AI, no GameState migration writes. Only one selected payload is decoded at a time. */
export class HistoryRepository {
  constructor(private readonly database: IDBDatabase) {}

  async list(saveId: string): Promise<{ nodes: HistoryNode[]; manualBytes: number; notice?: string }> {
    return transaction(this.database, ['saves', 'saveControls', 'turnUndo', 'historyMetadata'], 'readonly', async tx => {
      const state = checkedState(await request(tx.objectStore('saves').get(saveId)), saveId), control = await readControl(tx, saveId);
      const status = await inspectUndo(tx, state), nodes: HistoryNode[] = [];
      if (status.available) for (const [index, entry] of (control?.records ?? []).entries()) {
        nodes.push({ kind: 'automatic', id: entry.turnId, name: `第 ${state.turnNumber - status.available + index} 回合结束`,
          bytes: entry.bytes, summary: entry.summary, turnNumber: state.turnNumber - status.available + index,
          oldTimeline: false, source: controlInstance(control) ?? '原始时间线' });
      }
      let manualBytes = 0;
      const rows: unknown[] = await request(tx.objectStore('historyMetadata').index('saveId').getAll(saveId));
      for (const raw of rows) {
        const parsed = ManualHistorySchema.safeParse(raw);
        if (parsed.success && parsed.data.saveId === saveId) {
          nodes.push(manualNode(parsed.data, state, controlInstance(control))); manualBytes += parsed.data.bytes;
        } else {
          // Never silently erase or treat corrupt metadata as a valid restore point.
          const id = z.object({ id: IdSchema }).safeParse(raw);
          if (id.success) nodes.push({ kind: 'manual', id: id.data.id, name: '无法读取的历史收藏', bytes: 0, turnNumber: 0,
            oldTimeline: true, source: '无法确认', error: '格式无法验证，原始数据保留；请先保留浏览器数据并联系维护者' });
        }
      }
      return { nodes, manualBytes, ...(status.unavailable === 'chain' ? { notice: '自动恢复链异常，已禁用读取；原始记录保留' } : {}) };
    });
  }

  async create(saveId: string, name: string): Promise<ManualHistory> {
    const checkedName = nameSchema.parse(name), session = reserveStageSession(saveId);
    try { return await withBrowserLock(saveId, async () => {
      const captured = await transaction(this.database, ['saves', 'drafts', 'saveControls'], 'readonly', tx => current(tx, saveId));
      const state = checkedState(captured.state, saveId); settled(state);
      const payload = await historyCodec({ kind: 'encode', state });
      const now = new Date().toISOString();
      return transaction(this.database, stores, 'readwrite', async tx => {
        session.check();
        requireData(same(await current(tx, saveId), captured), 'HISTORY_CONFLICT', '保存期间正式状态或草稿已改变，请重新保存；原记录未修改');
        const control = await readControl(tx, saveId);
        const meta = sizeMeta({ version: 1, saveId, id: `history-${crypto.randomUUID()}`, name: checkedName,
          sourceInstance: controlInstance(control), sourceCreatedAt: state.createdAt, createdAt: now, updatedAt: now,
          summary: historySummary(state), bytes: 0, rawBytes: payload.rawBytes, encoding: payload.encoding, digest: payload.digest }, payload);
        await request(tx.objectStore('historyMetadata').add(meta));
        await request(tx.objectStore('historyPayloads').add({ saveId, id: meta.id, payload }));
        return meta;
      });
    }, { required: true }); } finally { session.release(); }
  }

  async rename(saveId: string, id: string, name: string): Promise<void> {
    const checkedName = nameSchema.parse(name);
    await transaction(this.database, historyStores, 'readwrite', async tx => {
      const selected = await source(tx, saveId, { kind: 'manual', id });
      const meta = ManualHistorySchema.parse(selected.metadata), payload = payloadRecord(selected.record);
      requireData(meta.saveId === saveId && meta.id === id, 'HISTORY_CORRUPT', '收藏身份不一致');
      await request(tx.objectStore('historyMetadata').put(sizeMeta({ ...meta, name: checkedName, updatedAt: new Date().toISOString() }, payload)));
    });
  }
  async delete(saveId: string, id: string): Promise<void> {
    IdSchema.parse(saveId); IdSchema.parse(id);
    await transaction(this.database, historyStores, 'readwrite', async tx => {
      await request(tx.objectStore('historyMetadata').delete([saveId, id]));
      await request(tx.objectStore('historyPayloads').delete([saveId, id]));
    });
  }

  async preview(saveId: string, selection: HistorySelection): Promise<HistoryPreview> {
    const captured = await transaction(this.database, stores, 'readonly', async tx => {
      const saved = await current(tx, saveId), state = checkedState(saved.state, saveId), selected = await source(tx, saveId, selection);
      const control = await readControl(tx, saveId);
      if (selection.kind === 'automatic') requireData((await inspectUndo(tx, state)).available > 0
        && control?.records.some(entry => entry.turnId === selection.id), 'HISTORY_UNAVAILABLE', '自动历史已失效，请刷新列表');
      return { saved, selected, state, control };
    });
    const state = await decode(captured.selected, selection, saveId); settled(state);
    requireData(state.saveId === saveId, 'HISTORY_CORRUPT', '历史存档身份不一致');
    let node: HistoryNode;
    if (selection.kind === 'automatic') {
      const record = SnapshotSchema.parse(captured.selected.record), records = captured.control!.records;
      const index = records.findIndex(entry => entry.turnId === selection.id), entry = records[index];
      const turnNumber = captured.state.turnNumber - records.length + index;
      requireData(entry.bytes === utf8ByteLength(JSON.stringify(record)) && state.createdAt === captured.state.createdAt
        && state.turnNumber === turnNumber && state.revision < captured.state.revision
        && state.journal.at(-1)?.turnId === record.beforeTurnId && record.beforeTurnId === entry.beforeTurnId
        && captured.state.journal[turnNumber]?.turnId === record.turnId
        && same(state.journal, captured.state.journal.slice(0, turnNumber))
        && (!entry.summary || same(entry.summary, historySummary(state))), 'HISTORY_CORRUPT', '自动历史与当前时间线不一致，未修改存档');
      node = { kind: 'automatic', id: selection.id, name: `第 ${turnNumber} 回合结束`, bytes: entry.bytes,
        summary: historySummary(state), turnNumber, oldTimeline: false, source: controlInstance(captured.control) ?? '原始时间线' };
    } else node = manualNode(ManualHistorySchema.parse(captured.selected.metadata), captured.state, controlInstance(captured.control));
    const confirmation = Object.freeze({}) as HistoryConfirmation;
    confirmations.set(confirmation, { owner: this, saveId, selection: { ...selection }, current: captured.saved, source: captured.selected });
    return { state, node, confirmation, currentTurn: captured.state.turnNumber,
      hasDraft: Boolean(captured.saved.draft && !same((captured.saved.draft as { userInput?: string }).userInput, '')) };
  }
  release(confirmation: HistoryConfirmation) { confirmations.delete(confirmation); }

  /** Fresh explicit confirmation. Paid generation starts in the UI only AFTER this transaction commits. */
  async restore(confirmation: HistoryConfirmation, action: string, useVariableStage: boolean, useWorldStage: boolean) {
    const checked = confirmations.get(confirmation);
    confirmations.delete(confirmation); // one-shot: double click or replay cannot replace twice
    requireData(checked?.owner === this, 'HISTORY_CONFIRMATION_INVALID', '历史确认已失效，请重新预览');
    const { saveId, selection, current: expected, source: selected } = checked;
    const userInput = z.string().trim().min(1).max(100000).parse(action), session = reserveStageSession(saveId);
    try {
      const result = await withBrowserLock(saveId, async () => {
        const restored = await decode(selected, selection, saveId); settled(restored);
        return transaction(this.database, stores, 'readwrite', async tx => {
          session.check();
          const observed = await current(tx, saveId);
          requireData(same(observed, expected), 'HISTORY_CONFLICT', '正式存档、草稿或时间线已改变，请重新预览；本次没有覆盖，也没有请求模型');
          requireData(sameSource(await source(tx, saveId, selection), selected), 'HISTORY_CONFLICT', '历史节点已改变或被删除，请重新预览');
          const state = checkedState(observed.state, saveId), oldDraft = observed.draft === undefined ? undefined : TurnDraftSchema.parse(observed.draft);
          const nextState = GameStateSchema.parse({ ...restored, revision: Math.max(state.revision, restored.revision) + 1, updatedAt: new Date().toISOString() });
          const draft = TurnDraftSchema.parse({ ...createTurnDraft(saveId, nextState.revision, `turn-${crypto.randomUUID()}`, 'regular', userInput,
            useVariableStage, useWorldStage), draftRevision: (oldDraft?.draftRevision ?? 0) + 1 });
          const control = { ...newSaveControl(saveId), instanceId: `instance-${crypto.randomUUID()}` };
          // Intentional new timeline root: no old automatic point or commit receipt survives.
          await clearUndoRecords(tx, saveId);
          const receipts = tx.objectStore('turnReceipts');
          for (const key of await request(receipts.index('saveId').getAllKeys(saveId))) await request(receipts.delete(key));
          await request(tx.objectStore('saves').put(nextState));
          await request(tx.objectStore('drafts').put(draft));
          await writeControl(tx, control);
          return { state: nextState, draft, instance: control.instanceId, replayed: false };
        });
      }, { required: true });
      notifyImages(imageTimelineChange);
      return result;
    } finally { session.release(); }
  }

  async exportNode(saveId: string, selection: HistorySelection, app: string): Promise<{ text: string; name: string }> {
    const preview = await this.preview(saveId, selection);
    try { return { name: `历史节点_第${preview.state.turnNumber}回.heijin.json`,
      text: await historyCodec({ kind: 'export', state: preview.state, app }) }; }
    finally { this.release(preview.confirmation); }
  }
}

export function historyError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '浏览器存储空间不足；本次未保存，正式进度及已有收藏保持不变。请导出备份并清理不需要的收藏。';
  if (error instanceof DataError) return error.message;
  if (error instanceof Error && 'code' in error && error.code === 'concurrency_unavailable') return '浏览器缺少跨标签互斥能力，未改写或请求模型；请使用支持 Web Locks 的浏览器。';
  return '历史操作失败，未完成的事务已回滚，原始记录保留。请刷新列表后重试。';
}
