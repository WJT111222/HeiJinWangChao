// Frozen deployed-main excerpts from fbb1f13902eff11924b5dd74f42fa91a082106c5.
// Only the class name and relative import paths differ. Keep the V3 open/delete
// logic unchanged: these tests must exercise old clients, not the new CAS path.
import { timelineStores, clearUndoRecords } from '../../services/storage/turnUndo';
import { request, transaction } from '../../services/storage/idb';
import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { normalizeOpeningCity } from '../../domain/openingCity';
import { migrateSave } from '../../services/storage/migrations';
import type { GameState } from '../../domain/state';

function readState(raw: unknown, saveId: string): GameState {
  requireData(raw !== undefined, 'NOT_FOUND', '存档不存在');
  const state = migrateSave(raw);
  requireData(state.saveId === saveId, 'CORRUPT_SAVE', '存档主键与内容不一致');
  return normalizeOpeningCity(state);
}

// Only call in the existing readwrite transaction. A later validation/CAS failure
// aborts this write too; identity normalization never increments the game revision.
async function readStoredState(tx: IDBTransaction, saveId: string): Promise<GameState> {
  const store = tx.objectStore('saves');
  const raw = await request(store.get(saveId));
  const state = readState(raw, saveId);
  if (raw.schemaVersion !== state.schemaVersion || raw.openingCityId === undefined)
    await request(store.put(state));
  return state;
}

async function deleteRecords(tx: IDBTransaction, key: IDBValidKey): Promise<void> {
  await request(tx.objectStore('drafts').delete(key));
  const receipts = tx.objectStore('turnReceipts');
  const keys = await request(receipts.index('saveId').getAllKeys(key));
  for (const receiptKey of keys) await request(receipts.delete(receiptKey));
  await clearUndoRecords(tx, key);
  await request(tx.objectStore('saveControls').delete(key));
  await request(tx.objectStore('saves').delete(key));
}

export class LegacySaveRepositoryV3 {
  private constructor(private readonly database: IDBDatabase) {}

  static open(name = 'heijinwangchao', factory: IDBFactory = globalThis.indexedDB): Promise<LegacySaveRepositoryV3> {
    if (!factory) return Promise.reject(new DataError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB'));
    return new Promise((resolve, reject) => {
      // IndexedDB 结构版本独立于每个存档的 schemaVersion。
      const operation = factory.open(name, 3);
      operation.onupgradeneeded = () => {
        const db = operation.result;
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('turnUndo'))
          db.createObjectStore('turnUndo', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
        if (!db.objectStoreNames.contains('saveControls')) db.createObjectStore('saveControls', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('turnReceipts'))
          db.createObjectStore('turnReceipts', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
      };
      operation.onerror = () => reject(operation.error);
      let blocked = false;
      operation.onblocked = () => { blocked = true; reject(new DataError('STORAGE_BLOCKED', '数据库升级被其他页面阻塞')); };
      operation.onsuccess = () => {
        const db = operation.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(new LegacySaveRepositoryV3(db));
      };
    });
  }

  close(): void { this.database.close(); }

  async load(saveId: string): Promise<GameState> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      return readStoredState(tx, saveId);
    });
  }

  async delete(saveId: string, expectedRevision: number): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    return transaction(this.database, timelineStores, 'readwrite', async (tx) => {
      const current = await readStoredState(tx, saveId);
      requireData(current.revision === expectedRevision, 'REVISION_CONFLICT', '删除时存档版本已变化');
      await deleteRecords(tx, saveId);
    });
  }

}
