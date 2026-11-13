import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { SaveRepository, saveDatabaseVersion } from '../services/storage/saveRepository';
import { backupFileName } from '../services/storage/backup';
import { newSaveControl, timelineStores } from '../services/storage/turnUndo';
import { request, transaction } from '../services/storage/idb';
import { createTurnDraft } from '../domain/drafts';
import { game } from './fixtures/game';
import { LegacySaveRepositoryV3 } from './fixtures/legacySaveRepositoryV3';

const name = 'backup-upgrade';
async function raw(factory: IDBFactory, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const op = factory.open(name, version);
    op.onsuccess = () => resolve(op.result); op.onerror = () => reject(op.error);
  });
}
async function snapshot(factory: IDBFactory) {
  const db = await raw(factory);
  try {
    return await transaction(db, timelineStores, 'readonly', async tx => {
      const result: Record<string, unknown[]> = {};
      for (const store of timelineStores) result[store] = await request(tx.objectStore(store).getAll());
      return result;
    });
  } finally { db.close(); }
}
async function seed(factory: IDBFactory) {
  const legacy = await LegacySaveRepositoryV3.open(name, factory), db = await raw(factory);
  try {
    await transaction(db, timelineStores, 'readwrite', async tx => {
      await request(tx.objectStore('saves').put(game()));
      await request(tx.objectStore('drafts').put(createTurnDraft('save-a', 0, 'turn-a', 'regular', '原草稿')));
      await request(tx.objectStore('turnReceipts').put({ saveId: 'save-a', turnId: 'receipt-a', raw: '保留回执' }));
      await request(tx.objectStore('turnUndo').put({ saveId: 'save-a', turnId: 'undo-a', raw: '保留恢复点' }));
      await request(tx.objectStore('saveControls').put(newSaveControl('save-a')));
    });
    // Finish the same identity normalization the deployed V3 client performs.
    await legacy.load('save-a');
    return legacy;
  } catch (error) { legacy.close(); throw error; }
  finally { db.close(); }
}

describe('备份导入的旧客户端连接边界', () => {
  it('升级不改五个仓库；真正 V3 删除器失效，同 ID 同 revision 的导入及草稿完整保留，新版重载后可正常删除', async () => {
    const factory = new IDBFactory(), legacy = await seed(factory);
    const stale = await legacy.load('save-a'), before = await snapshot(factory);
    const repository = await SaveRepository.open(name, factory);
    try {
      expect(await snapshot(factory)).toEqual(before);
      const incoming = { state: { ...stale, title: '导入的新进度' },
        draft: createTurnDraft('save-a', stale.revision, 'turn-imported', 'regular', '导入的待发送行动') };
      await repository.importBackup(incoming, (await repository.compareBackup(incoming)).confirmation, { overwrite: true });
      const imported = await repository.loadGame('save-a'), after = await snapshot(factory);
      expect(imported.state).toEqual(incoming.state);
      expect(imported.draft).toEqual({ ...incoming.draft, draftRevision: 1 });
      expect(imported.instance).toMatch(/^instance-/);
      // This is the frozen V3 two-argument delete implementation, not V4 CAS.
      await expect(legacy.delete('save-a', stale.revision)).rejects.toMatchObject({ name: 'InvalidStateError' });
      await expect(legacy.load('save-a')).rejects.toMatchObject({ name: 'InvalidStateError' });
      await expect(LegacySaveRepositoryV3.open(name, factory)).rejects.toMatchObject({ name: 'VersionError' });
      expect(await snapshot(factory)).toEqual(after);
      const refreshed = await SaveRepository.open(name, factory);
      try {
        expect(await refreshed.loadGame('save-a')).toEqual(imported);
        await refreshed.delete('save-a', imported.state.revision, imported.instance);
        expect(await refreshed.list()).toEqual([]);
      } finally { refreshed.close(); }
    } finally { legacy.close(); repository.close(); }
  });

  it('旧删除器在升级之前仍按原逻辑工作，防止夹具退化成永远拒绝', async () => {
    const factory = new IDBFactory(), legacy = await seed(factory);
    try {
      await legacy.delete('save-a', 0);
      expect(Object.values(await snapshot(factory)).every(records => records.length === 0)).toBe(true);
    } finally { legacy.close(); }
  });

  it('不释放的 V3 连接阻塞升级，不能得到导入仓库；原记录不变，关闭旧连接后重试成功且无连接泄漏', async () => {
    const factory = new IDBFactory(), legacy = await seed(factory);
    const blocker = await raw(factory, 3); // Deliberately no versionchange close handler.
    try {
      const before = await snapshot(factory);
      await expect(SaveRepository.open(name, factory)).rejects.toMatchObject({ code: 'STORAGE_BLOCKED' });
      expect(blocker.version).toBe(3);
      expect(await transaction(blocker, timelineStores, 'readonly', async tx => {
        const result: Record<string, unknown[]> = {};
        for (const store of timelineStores) result[store] = await request(tx.objectStore(store).getAll());
        return result;
      })).toEqual(before);
      blocker.close();
      // Also waits for the earlier blocked request to finish and close its DB.
      const repository = await SaveRepository.open(name, factory);
      try { expect(await snapshot(factory)).toEqual(before); }
      finally { repository.close(); }
      // A further upgrade must not hang on the rejected request's late success.
      const later = await raw(factory, saveDatabaseVersion + 1); later.close();
    } finally { blocker.close(); legacy.close(); }
  });

  it('升级事务中止保持 V3 与五仓库原始记录，之后可重新升级', async () => {
    const factory = new IDBFactory(), legacy = await seed(factory);
    const before = await snapshot(factory), original = factory.open.bind(factory);
    const spy = vi.spyOn(factory, 'open').mockImplementation((dbName, version) => {
      const op = original(dbName, version);
      if (version === saveDatabaseVersion) op.addEventListener('upgradeneeded', () => op.transaction!.abort());
      return op;
    });
    try {
      await expect(SaveRepository.open(name, factory)).rejects.toMatchObject({ name: 'AbortError' });
      spy.mockRestore();
      const unchanged = await raw(factory, 3); unchanged.close();
      expect(await snapshot(factory)).toEqual(before);
      const repository = await SaveRepository.open(name, factory);
      try { expect(await snapshot(factory)).toEqual(before); }
      finally { repository.close(); }
    } finally { spy.mockRestore(); legacy.close(); }
  });

  it('已经排队的 V3 写入完成后才完成升级，不丢失升级前的最后一次修改', async () => {
    const factory = new IDBFactory(), legacy = await seed(factory), db = await raw(factory, 3);
    db.onversionchange = () => db.close();
    const state = { ...game(), title: '升级前排队的保存' };
    try {
      const write = transaction(db, ['saves'], 'readwrite', tx => request(tx.objectStore('saves').put(state)));
      const open = SaveRepository.open(name, factory);
      await write;
      const repository = await open;
      try { expect((await repository.load('save-a')).title).toBe(state.title); }
      finally { repository.close(); }
    } finally { db.close(); legacy.close(); }
  });
});

it('备份文件名清理全部 ASCII 控制字符和非法符号，保留中文及日期格式', () => {
  const state = game(), summary = { title: '测试存档', turnNumber: 0, revision: 0, schemaVersion: state.schemaVersion, updatedAt: state.updatedAt };
  const title = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('') + '山城\\/:*?"<>| 人生';
  expect(backupFileName([{ state, summary: { ...summary, title } }], new Date(2026, 10, 13)))
    .toBe('黑金王朝备份_山城人生_第0回_20261113.heijin.json');
});
