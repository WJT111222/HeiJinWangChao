import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { game } from './fixtures/game';
import { saveKeyText, serializeRawSave } from '../services/storage/saveManagement';
import * as migrations from '../services/storage/migrations';

let factory: IDBFactory, repository: SaveRepository, database: IDBDatabase;
beforeEach(async () => {
  factory = new IDBFactory(); repository = await SaveRepository.open('unreadable', factory);
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open('unreadable'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
});
afterEach(() => { vi.restoreAllMocks(); database.close(); repository.close(); });
async function put(store: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore(store).put(value);
  });
}
async function all() {
  const result: Record<string, unknown[]> = {};
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['saves', 'drafts', 'turnReceipts'], 'readonly');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    for (const name of ['saves', 'drafts', 'turnReceipts']) {
      const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; };
    }
  });
  return result;
}

describe('unreadable saves stay individually manageable', () => {
  it('distinct compound keys cannot share a display/React identity through punctuation in strings', () => {
    expect(saveKeyText(['a', 'b'])).not.toBe(saveKeyText(['a, string:b']));
    expect(saveKeyText([42])).not.toBe(saveKeyText(['42']));
    expect(saveKeyText([['nested', 'key']])).not.toBe(saveKeyText(['nested', 'key']));
  });
  it('lists two readable records and one unsupported record without mutating any data', async () => {
    await repository.create(game('save-a')); await repository.create(game('save-b'));
    await put('saves', { saveId: 'broken', title: '未支持版本', schemaVersion: 99, privateData: '原样保留' });
    const before = await all(), list = await repository.list();
    expect(list).toHaveLength(3);
    expect(list).toContainEqual(expect.objectContaining({ status: 'unreadable', storageKey: 'broken', title: '未支持版本' }));
    expect(list.filter(item => item.status === 'readable')).toHaveLength(2);
    expect(await repository.loadGame('save-a')).toMatchObject({ state: { saveId: 'save-a' } });
    expect(await repository.loadGame('save-b')).toMatchObject({ state: { saveId: 'save-b' } });
    expect(await all()).toEqual(before);
  });
  it('uses a generic title for malformed metadata, without hiding the physical key', async () => {
    await put('saves', { saveId: 42, title: { invalid: true }, updatedAt: 'not-a-date' });
    expect(await repository.list()).toEqual([expect.objectContaining({ status: 'unreadable', storageKey: 42, title: '未命名存档' })]);
  });
  it('database read errors remain errors, never empty or unreadable save cards', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    await expect(repository.list()).rejects.toThrow();
  });
  it('a damaged GameState keeps safe metadata and cannot be loaded or mutated normally', async () => {
    const raw = { ...game('broken'), economy: { cash: -50 }, title: '旧人生' };
    await put('saves', raw);
    expect(await repository.list()).toEqual([expect.objectContaining({ status: 'unreadable', saveId: 'broken', title: '旧人生' })]);
    await expect(repository.load('broken')).rejects.toThrow();
    await expect(repository.delete('broken', 0)).rejects.toThrow();
    expect((await all()).saves).toEqual([raw]);
  });
  it('listing existing supported legacy data does not write a migration or new defaults', async () => {
    const legacy = { ...game(), schemaVersion: 4 }; Reflect.deleteProperty(legacy, 'retiredEvents');
    await put('saves', legacy);
    expect(await repository.list()).toEqual([expect.objectContaining({ status: 'readable', saveId: 'save-a' })]);
    expect((await all()).saves).toEqual([legacy]);
  });
  it('unavailable database rejects instead of returning an empty list', async () => {
    repository.close(); await expect(repository.list()).rejects.toThrow();
    await expect(SaveRepository.open('denied', {} as IDBFactory)).rejects.toThrow();
  });
  it('a record-level parser exception is isolated, while new saves can still be created and played', async () => {
    await put('saves', broken); await repository.create(game());
    const original = migrations.migrateSave;
    vi.spyOn(migrations, 'migrateSave').mockImplementation(raw => {
      if ((raw as { saveId: string }).saveId === 'broken') throw new RangeError('damaged record');
      return original(raw);
    });
    expect((await repository.list()).map(item => item.status).sort()).toEqual(['readable', 'unreadable']);
    expect((await repository.loadGame('save-a')).state.saveId).toBe('save-a');
  });
});

const broken = { saveId: 'broken', title: '旧数据', schemaVersion: 99, original: { unknownField: [null, '原文\n下一行', 2] } };
const rawDraft = { saveId: 'broken', unexpected: true, turnId: '原始回合', story: { narrative: '【旁白】未验证的草稿' } };
const rawReceipts = [{ saveId: 'broken', turnId: 'turn-a', hash: 'old-hash' }, { saveId: 'broken', turnId: 'turn-b', newField: 42 }];
async function seedRaw() {
  await repository.create(game('save-a')); await repository.create(game('save-b'));
  await put('saves', broken); await put('drafts', rawDraft);
  for (const receipt of rawReceipts) await put('turnReceipts', receipt);
  await put('drafts', { saveId: 'save-b', protected: true });
  await put('turnReceipts', { saveId: 'save-b', turnId: 'turn-a', protected: true });
}

describe('raw export never validates or rewrites game data', () => {
  it('exports exact save, draft and all own receipts including unknown fields and versions', async () => {
    await seedRaw(); const before = await all();
    const migrate = vi.spyOn(migrations, 'migrateSave').mockImplementation(() => { throw Error('must not validate'); });
    const raw = await repository.exportRaw('broken'), json = JSON.parse(serializeRawSave(raw));
    expect(migrate).not.toHaveBeenCalled();
    expect(json).toEqual({ format: 'heijin-raw-save', version: 1, records: {
      saves: [{ key: 'broken', value: broken }], drafts: [{ key: 'broken', value: rawDraft }],
      turnReceipts: rawReceipts.map(value => ({ key: ['broken', value.turnId], value })),
    } });
    expect(await all()).toEqual(before);
    raw.records.saves[0].value = null; expect(await all()).toEqual(before);
  });
  it('absent related records remain absent; a missing save fails explicitly', async () => {
    await put('saves', broken);
    expect((await repository.exportRaw('broken')).records).toMatchObject({ drafts: [], turnReceipts: [] });
    await expect(repository.exportRaw('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repository.exportRaw(undefined as unknown as IDBValidKey)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });
  it.each([new Date('2020-01-01'), new Map([['x', 1]]), Infinity, BigInt(12)])('cannot silently convert or discard non-JSON values (%s)', async value => {
    await put('saves', { ...broken, original: value }); const before = await all();
    const data = await repository.exportRaw('broken');
    expect(() => serializeRawSave(data)).toThrow('JSON 无法原样保存');
    expect(await all()).toEqual(before);
  });
  it('preserves existing draft undefined properties in explicit export metadata, without inventing null values', async () => {
    await put('saves', broken); await put('drafts', { ...rawDraft, variables: undefined, world: undefined });
    const before = await all(), data = JSON.parse(serializeRawSave(await repository.exportRaw('broken')));
    expect(data.records.drafts[0].value).toEqual(rawDraft);
    expect(data.undefinedFields).toEqual([
      ['records', 'drafts', 0, 'value', 'variables'], ['records', 'drafts', 0, 'value', 'world'],
    ]);
    expect(await all()).toEqual(before);
  });
  it('cyclic corruption explicitly fails JSON export, but still permits targeted deletion', async () => {
    const cyclic: Record<string, unknown> = { ...broken }; cyclic.self = cyclic;
    await put('saves', cyclic);
    const data = await repository.exportRaw('broken');
    expect(() => serializeRawSave(data)).toThrow('JSON 无法原样保存');
    await repository.deleteUnreadable('broken'); expect(await repository.list()).toEqual([]);
  });
  it('a failed read of any associated store fails the entire export without writes', async () => {
    await seedRaw(); const before = await all(), original = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'drafts') throw new DOMException('denied', 'SecurityError');
      return original.apply(this, args);
    });
    await expect(repository.exportRaw('broken')).rejects.toThrow(); vi.restoreAllMocks(); expect(await all()).toEqual(before);
  });
});

describe('targeted unreadable deletion stays atomic', () => {
  it('deletes only the chosen record and related draft/receipts, surviving database reopen', async () => {
    await seedRaw(); const before = await all(); await repository.deleteUnreadable('broken');
    const after = await all();
    for (const store of Object.keys(before)) expect(after[store]).toEqual(before[store].filter(value => (value as { saveId: string }).saveId !== 'broken'));
    repository.close(); repository = await SaveRepository.open('unreadable', factory);
    expect(await repository.list()).toHaveLength(2);
    await expect(repository.deleteUnreadable('broken')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each([42, ['invalid', 7], 'not a valid / GameState ID'])('uses the physical key even when not a domain ID (%s)', async key => {
    await repository.create(game()); await put('saves', { saveId: key }); await put('drafts', { saveId: key, original: true });
    await put('turnReceipts', { saveId: key, turnId: 'turn-z' });
    expect((await repository.exportRaw(key)).records.saves[0].key).toEqual(key);
    await repository.deleteUnreadable(key);
    expect(await all()).toEqual({ saves: [await repository.load('save-a')], drafts: [], turnReceipts: [] });
  });
  it('refuses deletion if a selected unreadable record has become readable before confirmation', async () => {
    await seedRaw(); await repository.list(); await put('saves', game('broken')); const before = await all();
    await expect(repository.deleteUnreadable('broken')).rejects.toMatchObject({ code: 'SAVE_READABLE' });
    expect(await all()).toEqual(before);
  });
  it.each(['drafts', 'turnReceipts', 'saves'])('failure at %s rolls back every delete', async name => {
    await seedRaw(); const before = await all(), original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      const result = original.call(this, key); if (this.name === name) this.transaction.abort(); return result;
    });
    await expect(repository.deleteUnreadable('broken')).rejects.toThrow(); vi.restoreAllMocks(); expect(await all()).toEqual(before);
  });
  it('normal deletion retains its existing revision guard and also removes receipts', async () => {
    await repository.create(game()); await put('turnReceipts', { saveId: 'save-a', turnId: 'turn-a' });
    await expect(repository.delete('save-a', 1)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await all()).turnReceipts).toHaveLength(1); await repository.delete('save-a', 0);
    expect(await all()).toEqual({ saves: [], drafts: [], turnReceipts: [] });
  });
  it('never uses a misleading payload saveId instead of the actual IndexedDB primary key', async () => {
    // Damaged/foreign DB layout with out-of-line saves, using the same version: key identity
    // must remain authoritative even when an unreadable payload names a different save.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open('out-of-line', 2);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('saves'); open.result.createObjectStore('drafts', { keyPath: 'saveId' });
        open.result.createObjectStore('turnReceipts', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
      };
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    const repo = await SaveRepository.open('out-of-line', factory);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['saves', 'drafts', 'turnReceipts'], 'readwrite');
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        tx.objectStore('saves').put(game('save-b'), 'bad-key'); tx.objectStore('saves').put(game('save-b'), 'save-b');
        for (const saveId of ['bad-key', 'save-b']) {
          tx.objectStore('drafts').put({ saveId }); tx.objectStore('turnReceipts').put({ saveId, turnId: 'turn-a' });
        }
      });
      expect(await repo.list()).toContainEqual(expect.objectContaining({ status: 'unreadable', storageKey: 'bad-key', saveId: 'save-b' }));
      const protectedData = await repo.exportRaw('save-b'), data = await repo.exportRaw('bad-key');
      expect(data.records.drafts[0].key).toBe('bad-key');
      expect(data.records.turnReceipts[0].key).toEqual(['bad-key', 'turn-a']);
      await repo.deleteUnreadable('bad-key'); expect(await repo.exportRaw('save-b')).toEqual(protectedData);
      expect(await repo.list()).toHaveLength(1);
    } finally { repo.close(); db.close(); }
  });
});
