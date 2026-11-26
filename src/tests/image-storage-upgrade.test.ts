import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { imageStores } from '../services/images/library';
import { request, transaction } from '../services/storage/idb';
import { SaveRepository, saveDatabaseVersion } from '../services/storage/saveRepository';
import { createTheaterStores } from '../services/storage/theaters';
import { recordPhone, schedulePhone } from '../domain/phone';
import { phoneGame } from './fixtures/phone';
import { createTurnDraft } from '../domain/drafts';
import { game } from './fixtures/game';

const name = 'image-schema';
function openRaw(
  factory: IDBFactory,
  version?: number,
  upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const op = factory.open(name, version);
    op.onupgradeneeded = () => upgrade?.(op.result, op.transaction!);
    op.onerror = () => reject(op.error);
    op.onsuccess = () => resolve(op.result);
  });
}
function seedV7(db: IDBDatabase, tx: IDBTransaction) {
  const state = game();
  db.createObjectStore('saves', { keyPath: 'saveId' }).add(state);
  for (const store of ['drafts', 'saveControls'])
    db.createObjectStore(store, { keyPath: 'saveId' }).add({ saveId: state.saveId, raw: store });
  for (const store of ['turnUndo', 'turnReceipts', 'historyMetadata', 'historyPayloads']) {
    const rows = db.createObjectStore(store, {
      keyPath: ['saveId', store.startsWith('turn') ? 'turnId' : 'id'],
    });
    rows.createIndex('saveId', 'saveId');
    rows.add({ saveId: state.saveId, id: 'node', turnId: 'turn', raw: store });
  }
  createTheaterStores(db);
  for (const store of ['theaterIndex', 'theaterBodies'])
    tx.objectStore(store).add({ saveId: state.saveId, id: 'theater', raw: store });
  db.createObjectStore('theaterVersions').add('existing-theater-version', state.saveId);
}
// Independent fixture matching the on-disk V8 contract, including previously saved image bytes.
function seedImages(db: IDBDatabase) {
  db.createObjectStore('imageCollections').add({ pictures: ['retained'] }, 'save-a');
  db.createObjectStore('imageVersions').add('original-image-version', 'save-a');
  for (const name of ['imageFiles', 'imageJobs']) {
    const rows = db.createObjectStore(name, { keyPath: ['saveId', 'id'] });
    rows.createIndex('saveId', 'saveId');
    if (name === 'imageJobs') rows.createIndex('subject', ['saveId', 'target.kind', 'target.id', 'slot']);
    rows.add({ saveId: 'save-a', id: 'retained', bytes: new Uint8Array([1, 2, 3]) });
  }
}
function contents(db: IDBDatabase) {
  const names = Array.from(db.objectStoreNames);
  return transaction(db, names, 'readonly', async (tx) =>
    Object.fromEntries(
      await Promise.all(names.map(async (n) => [n, await request(tx.objectStore(n).getAll())])),
    ),
  );
}
async function snapshot(factory: IDBFactory) {
  const db = await openRaw(factory);
  try {
    return await contents(db);
  } finally {
    db.close();
  }
}

describe('图片数据库 V8 到 V13 的打开和升级', () => {
  it('第三步 V10 原地升级保留旧会话、排期、未结算回合及独立存储，并关闭旧写入连接',async()=>{
    const factory = new IDBFactory(), state = phoneGame();
    recordPhone(state,'partner',{messageId:'old-sms',medium:'text',sender:'npc',text:'旧短信'},'evening',false);
    state.npc.partner.onScene=false;
    schedulePhone(state,{messageId:'next-sms',npcId:'partner',text:'次日取件',dueAt:'2027-01-01T08:00:00+08:00'},'evening');
    const draft=createTurnDraft(state.saveId,state.revision,'unfinished','regular','整理文件');
    const old=await openRaw(factory,10,(db,tx)=>{
      seedV7(db,tx); seedImages(db);
      tx.objectStore('saves').put(state); tx.objectStore('drafts').put(draft);
    });
    const before=await contents(old);
    let closed=false;
    old.onversionchange=()=>{closed=true; old.close();};
    const repo=await SaveRepository.open(name,factory);
    try {
      expect(closed).toBe(true);
      expect(await snapshot(factory)).toEqual({ ...before, oracleNotes: [], phoneBookPosts: [] });
      const loaded=await repo.loadGame(state.saveId);
      expect(loaded.state.phone).toEqual(state.phone);
      expect(loaded.draft).toEqual(draft);
      expect(loaded.draft?.phonePending).toBeUndefined();
    } finally {repo.close();}
  });
  it('新建完整结构，已有完整 V8 可重新打开且保留全部记录', async () => {
    const fresh = new IDBFactory();
    (await SaveRepository.open(name, fresh)).close();
    const created = await openRaw(fresh);
    expect(created.version).toBe(13);
    const tx = created.transaction([...imageStores]);
    expect(tx.objectStore('imageFiles').index('saveId').keyPath).toBe('saveId');
    expect(tx.objectStore('imageJobs').index('subject').keyPath).toEqual([
      'saveId',
      'target.kind',
      'target.id',
      'slot',
    ]);
    created.close();
    const existing = new IDBFactory();
    (
      await openRaw(existing, 8, (db, tx) => {
        seedV7(db, tx);
        seedImages(db);
      })
    ).close();
    const before = await snapshot(existing);
    (await SaveRepository.open(name, existing)).close();
    expect(await snapshot(existing)).toEqual({ ...before, oracleNotes: [], phoneBookPosts: [] });
  });

  it.each([false, true])(
    'V7 升级保留现有数据并在升级事务补齐图片结构（已有部分图片仓库 %s）',
    async (partial) => {
      const factory = new IDBFactory();
      const old = await openRaw(factory, 7, (db, tx) => {
        seedV7(db, tx);
        if (partial) {
          seedImages(db);
          db.deleteObjectStore('imageVersions');
          tx.objectStore('imageJobs').deleteIndex('subject');
        }
      });
      const before = await contents(old);
      old.onversionchange = () => old.close();
      const repo = await SaveRepository.open(name, factory);
      expect((await repo.load('save-a')).saveId).toBe('save-a');
      expect(await snapshot(factory)).toMatchObject(before);
      repo.close();
      const check = await openRaw(factory);
      expect(check.version).toBe(13);
      expect(check.transaction('imageJobs').objectStore('imageJobs').index('subject').keyPath).toEqual([
        'saveId',
        'target.kind',
        'target.id',
        'slot',
      ]);
      check.close();
    },
  );

  it.each([
    ...imageStores,
    'imageFiles.saveId',
    'imageJobs.saveId',
    'imageJobs.subject',
    'wrong index',
    'wrong primary key',
    'all stores',
  ].flatMap(defect => [8, 9, 10].map(version => ({version, defect}))))('V$version 结构异常 $defect 明确拒绝并释放连接，所有剩余记录原样保留', async ({version,defect}) => {
    const factory = new IDBFactory();
    const bad = await openRaw(factory, version, (db, tx) => {
      seedV7(db, tx);
      seedImages(db);
      if (defect === 'all stores') for (const store of imageStores) db.deleteObjectStore(store);
      else if (defect === 'wrong primary key') {
        db.deleteObjectStore('imageFiles');
        db.createObjectStore('imageFiles', { keyPath: 'id' }).add({ id: 'old-file', bytes: [4] });
      } else if (defect === 'wrong index') {
        const store = tx.objectStore('imageJobs');
        store.deleteIndex('subject');
        store.createIndex('subject', 'id');
      } else if (defect.includes('.')) {
        const [store, index] = defect.split('.');
        tx.objectStore(store).deleteIndex(index);
      } else db.deleteObjectStore(defect);
    });
    const before = await contents(bad);
    bad.close();
    await expect(SaveRepository.open(name, factory)).rejects.toMatchObject({
      code: 'STORAGE_SCHEMA',
      message: expect.stringContaining('原数据已保留'),
    });
    expect(await snapshot(factory)).toEqual(before);
    // Only this test opens a later version, to detect a leaked connection from the rejected open.
    (await openRaw(factory, saveDatabaseVersion + 1)).close();
  });

  it('升级中遇到不兼容的旧图片主键时回滚整个升级，V7 记录可重新打开', async () => {
    const factory = new IDBFactory();
    const old = await openRaw(factory, 7, (db, tx) => {
      seedV7(db, tx);
      db.createObjectStore('imageFiles', { keyPath: 'id' }).add({ id: 'original', bytes: [5, 6] });
    });
    const before = await contents(old);
    old.close();
    await expect(SaveRepository.open(name, factory)).rejects.toMatchObject({ code: 'STORAGE_SCHEMA' });
    const unchanged = await openRaw(factory, 7);
    expect(await contents(unchanged)).toEqual(before);
    unchanged.close();
  });

  it('旧标签阻塞 V7 升级时返回提示；关闭旧连接后可重试并保留记录', async () => {
    const factory = new IDBFactory(),
      old = await openRaw(factory, 7, seedV7);
    const before = await contents(old);
    await expect(SaveRepository.open(name, factory)).rejects.toMatchObject({ code: 'STORAGE_BLOCKED' });
    expect(await contents(old)).toEqual(before);
    old.close();
    const repo = await SaveRepository.open(name, factory);
    expect(await snapshot(factory)).toMatchObject(before);
    // The active repository must also release its connection on versionchange.
    (await openRaw(factory, saveDatabaseVersion + 1)).close();
    repo.close();
  });
});
