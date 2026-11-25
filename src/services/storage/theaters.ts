import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { TheaterRecordSchema, TheaterRoute, TheaterTitle } from '../../domain/theater/record';
import type { TheaterRecord } from '../../domain/theater/record';
import type { GameState } from '../../domain/state';
import { request, transaction } from './idb';

export const theaterStores = ['theaterIndex', 'theaterBodies'] as const;
export const theaterVersionStore = 'theaterVersions';
export const theaterChangeKey = 'heijin.theaters.changed.v1';
const ownerStores = ['saves', 'saveControls', ...theaterStores];
const writeStores = [...ownerStores, theaterVersionStore];
export type TheaterOwner = { saveId: string; instance: string | null; createdAt: string };
export type OpenTheater = { record: TheaterRecord; owner: TheaterOwner };
export type TheaterCursor = [string, string, string];

export function createTheaterStores(db: IDBDatabase) {
  const index = db.createObjectStore('theaterIndex', { keyPath: ['saveId', 'id'] });
  index.createIndex('recent', ['saveId', 'updatedAt', 'id']);
  index.createIndex('saveId', 'saveId');
  const bodies = db.createObjectStore('theaterBodies', { keyPath: ['saveId', 'id'] });
  bodies.createIndex('saveId', 'saveId');
}

export function createTheaterVersionStore(tx: IDBTransaction) {
  const versions = tx.db.createObjectStore(theaterVersionStore);
  // Upgrade V6 collections using only their keys. Existing legacy backup marks
  // cannot certify a collection with a version, even if its main revision matches.
  const cursor = tx.objectStore('theaterIndex').index('saveId').openKeyCursor(null, 'nextunique');
  cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row) return;
    versions.add(crypto.randomUUID(), row.key);
    row.continue();
  };
}

export async function advanceTheaterVersion(tx: IDBTransaction, saveId: string) {
  const version = crypto.randomUUID();
  await request(tx.objectStore(theaterVersionStore).put(version, saveId));
  return version;
}

/** Wake other tabs after commit. The next read gets the authoritative IDB version. */
export function notifyTheaterChange() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(theaterChangeKey, crypto.randomUUID()); }
  catch { /* The library also rereads on entry and focus. */ }
}
function metadata(record: TheaterRecord) {
  const { id, saveId, title, status, createdAt, updatedAt, revision } = record;
  let length = 0;
  for (const char of record.body) if (!/\s/u.test(char)) length++;
  return { id, saveId, title, status, createdAt, updatedAt, revision, model: record.config.route.model,
    theme: record.theme.slice(0, 140), length };
}
export type TheaterListItem = ReturnType<typeof metadata>;

function sameOwner(a: TheaterOwner, b: TheaterOwner) {
  return a.saveId === b.saveId && a.createdAt === b.createdAt && a.instance === b.instance;
}
async function owner(tx: IDBTransaction, saveId: string, expected?: TheaterOwner): Promise<TheaterOwner> {
  const saved = await request<unknown>(tx.objectStore('saves').get(saveId));
  requireData(saved && typeof saved === 'object' && 'createdAt' in saved && typeof saved.createdAt === 'string',
    'THEATER_OWNER', '所属存档已不存在或无法读取。');
  const control = await request<{ instanceId?: string } | undefined>(tx.objectStore('saveControls').get(saveId));
  const value = { saveId, createdAt: saved.createdAt, instance: control?.instanceId ?? null };
  requireData(!expected || sameOwner(expected, value), 'THEATER_OWNER', '所属存档已被替换，请重新打开小剧场。');
  return value;
}

export async function putTheater(tx: IDBTransaction, record: TheaterRecord) {
  await request(tx.objectStore('theaterBodies').put(record));
  await request(tx.objectStore('theaterIndex').put(metadata(record)));
}

export async function clearTheaters(tx: IDBTransaction, saveId: IDBValidKey) {
  for (const name of theaterStores) {
    const store = tx.objectStore(name);
    const keys = await request(store.index('saveId').getAllKeys(saveId));
    await Promise.all(keys.map(key => request(store.delete(key))));
  }
}

export async function exportTheaters(tx: IDBTransaction, saveId: string) {
  const rows = await request<unknown[]>(tx.objectStore('theaterBodies').index('saveId').getAll(saveId));
  return rows.map(row => TheaterRecordSchema.parse(row));
}

async function existing(tx: IDBTransaction, saveId: string, id: string) {
  const raw = await request(tx.objectStore('theaterBodies').get([saveId, id]));
  requireData(raw !== undefined, 'THEATER_MISSING', '该小剧场已删除。');
  return TheaterRecordSchema.parse(raw);
}

export class TheaterRepository {
  constructor(private readonly database: IDBDatabase, private readonly readState: (value: unknown, saveId: string) => GameState) {}

  private async mutate<T>(saveId: string, work: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal) {
    const result = await transaction(this.database, writeStores, 'readwrite', async tx => {
      const value = await work(tx);
      await advanceTheaterVersion(tx, saveId);
      return value;
    }, signal);
    notifyTheaterChange();
    return result;
  }

  async list(saveId: string, after?: TheaterCursor, expected?: TheaterOwner) {
    IdSchema.parse(saveId);
    requireData(!after || after[0] === saveId, 'THEATER_OWNER', '小剧场列表已变化。');
    return transaction(this.database, ['saves', 'saveControls', 'theaterIndex'], 'readonly', async tx => {
      await owner(tx, saveId, expected);
      return new Promise<{ items: TheaterListItem[]; next?: TheaterCursor }>((resolve, reject) => {
        const items: TheaterListItem[] = [];
        const index = tx.objectStore('theaterIndex').index('recent');
        const cursor = index.openCursor(IDBKeyRange.bound([saveId], after ?? [saveId, []], false, Boolean(after)), 'prev');
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) { resolve({ items }); return; }
          if (items.length === 20) {
            const last = items.at(-1)!;
            resolve({ items, next: [saveId, last.updatedAt, last.id] }); return;
          }
          items.push(row.value as TheaterListItem);
          row.continue();
        };
      });
    });
  }

  open(saveId: string, id: string): Promise<OpenTheater> {
    return transaction(this.database, ownerStores, 'readonly', async tx => ({
      owner: await owner(tx, saveId), record: await existing(tx, saveId, id),
    }));
  }

  /** Read only the committed state. The projection and insert share the same save identity. */
  create(saveId: string, project: (state: GameState) => TheaterRecord, expected: TheaterOwner, signal?: AbortSignal): Promise<OpenTheater> {
    return this.mutate(saveId, async tx => {
      const current = await owner(tx, saveId, expected);
      const state = this.readState(await request(tx.objectStore('saves').get(saveId)), saveId);
      const record = TheaterRecordSchema.parse(project(state));
      requireData(record.saveId === saveId && record.revision === 0, 'THEATER_OWNER', '小剧场归属无效。');
      requireData(await request(tx.objectStore('theaterBodies').getKey([saveId, record.id])) === undefined, 'THEATER_CONFLICT', '小剧场已存在。');
      await putTheater(tx, record);
      return { record, owner: current };
    }, signal);
  }

  getOwner(saveId: string) {
    return transaction(this.database, ['saves', 'saveControls'], 'readonly', tx => owner(tx, saveId));
  }

  async verify(expected: OpenTheater) {
    return transaction(this.database, ownerStores, 'readonly', tx => this.current(tx, expected));
  }

  private async current(tx: IDBTransaction, expected: OpenTheater) {
    await owner(tx, expected.owner.saveId, expected.owner);
    const record = await existing(tx, expected.owner.saveId, expected.record.id);
    if (record.revision !== expected.record.revision)
      throw new DataError('THEATER_CONFLICT', '小剧场已在其他页面修改，请重新打开。');
    return record;
  }

  private write(expected: OpenTheater, changes: Partial<Pick<TheaterRecord, 'body' | 'status' | 'title' | 'config'>>, signal?: AbortSignal): Promise<OpenTheater> {
    return this.mutate(expected.owner.saveId, async tx => {
      const current = await this.current(tx, expected);
      const record = TheaterRecordSchema.parse({ ...current, ...changes, revision: CountSchema.parse(current.revision + 1),
        updatedAt: new Date().toISOString() });
      await putTheater(tx, record);
      return { record, owner: expected.owner };
    }, signal);
  }

  saveText(expected: OpenTheater, body: string, status: TheaterRecord['status'], signal?: AbortSignal) {
    return this.write(expected, { body, status }, signal);
  }

  rename(expected: OpenTheater, title: string) {
    return this.write(expected, { title: TheaterTitle.parse(title) });
  }

  changeRoute(expected: OpenTheater, route: TheaterRoute) {
    return this.write(expected, { config: { ...expected.record.config, routeMode: 'independent', route: TheaterRoute.parse(route) } });
  }

  fork(expected: OpenTheater, id: string, body: string, status: 'partial' | 'stopped', signal?: AbortSignal) {
    return this.mutate(expected.owner.saveId, async tx => {
      const current = await this.current(tx, expected);
      const now = new Date().toISOString();
      const record = TheaterRecordSchema.parse({ ...current, id, revision: 0, body, status,
        title: current.title.slice(0, 92) + '（未完篇）', createdAt: now, updatedAt: now });
      requireData(await request(tx.objectStore('theaterBodies').getKey([record.saveId, record.id])) === undefined,
        'THEATER_CONFLICT', '小剧场已存在。');
      await putTheater(tx, record);
      return { record, owner: expected.owner };
    }, signal);
  }

  delete(expected: OpenTheater) {
    return this.mutate(expected.owner.saveId, async tx => {
      const record = await this.current(tx, expected);
      for (const name of theaterStores) await request(tx.objectStore(name).delete([record.saveId, record.id]));
    });
  }
}
