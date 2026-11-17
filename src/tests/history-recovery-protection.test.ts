import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBIndex } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { request, transaction } from '../services/storage/idb';
import { serializeRawSave } from '../services/storage/saveManagement';
import { decodeHistory } from '../services/storage/history/codec';
import { worldState } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';

let repo: SaveRepository, db: IDBDatabase;
beforeEach(async () => {
  const factory = new IDBFactory(); repo = await SaveRepository.open('recovery', factory);
  db = await request(factory.open('recovery'));
  await repo.create(worldState());
  await repo.commitTurn(submission(await completeDraft(repo), ''));
});
afterEach(() => { vi.restoreAllMocks(); db.close(); repo.close(); });
const stores = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls', 'historyMetadata', 'historyPayloads'];
async function snapshot() {
  return transaction(db, stores, 'readonly', async tx => {
    const rows = [];
    for (const name of stores) rows.push({ name, keys: await request(tx.objectStore(name).getAllKeys()), values: await request(tx.objectStore(name).getAll()) });
    return rows;
  });
}
async function corrupt() {
  await transaction(db, ['saves'], 'readwrite', async tx => {
    const state = await request(tx.objectStore('saves').get('save-a'));
    await request(tx.objectStore('saves').put({ ...state, schemaVersion: 999 }));
  });
}

it.each(['complete', 'payload-only', 'metadata-only'] as const)('损坏主档 %s 收藏：原始导出后仍阻止删除，七张表与二进制原样保留', async kind => {
  const state = await repo.load('save-a'), node = await repo.history.create('save-a', '必须保留');
  expect(node.encoding).toBe('gzip');
  const other = { ...state, saveId: 'save-b' };
  await repo.importBackup({ state: other }, (await repo.compareBackup({ state: other })).confirmation);
  await repo.history.create('save-b', '其他人生');
  if (kind !== 'complete') await transaction(db, ['historyMetadata', 'historyPayloads'], 'readwrite', async tx => {
    await request(tx.objectStore(kind === 'payload-only' ? 'historyMetadata' : 'historyPayloads').delete(['save-a', node.id]));
  });
  await corrupt();
  const before = await snapshot(), raw = await repo.exportRaw('save-a');
  // The existing V1 rescue file remains partial. Downloading it must NOT authorize deletion.
  expect(JSON.parse(serializeRawSave(raw)).records.saves[0].value.schemaVersion).toBe(999);
  expect(raw.records).not.toHaveProperty('historyPayloads');
  await expect(repo.deleteUnreadable('save-a')).rejects.toMatchObject({ code: 'HISTORY_RECOVERY_REQUIRED' });
  expect(await snapshot()).toEqual(before);
  expect((await repo.list()).find(save => save.storageKey === 'save-a')?.status).toBe('unreadable');
  if (kind !== 'metadata-only') {
    const record = await request(db.transaction('historyPayloads').objectStore('historyPayloads').get(['save-a', node.id]));
    expect(record.payload.data).toBeInstanceOf(ArrayBuffer);
    expect(await decodeHistory(record.payload)).toEqual(state);
  }
  // A user can explicitly import a previously verified standard backup. This preserves collections.
  if (kind === 'complete') {
    const comparison = await repo.compareBackup({ state });
    await repo.importBackup({ state }, comparison.confirmation, { overwrite: true });
    expect((await repo.history.preview('save-a', { kind: 'manual', id: node.id })).state).toEqual(state);
  }
});

it('即使元数据损坏，关联记录仍阻止删除；检查失败不会当作没有收藏', async () => {
  const node = await repo.history.create('save-a', '原收藏'); await corrupt();
  await transaction(db, ['historyMetadata'], 'readwrite', async tx => {
    await request(tx.objectStore('historyMetadata').put({ saveId: 'save-a', id: node.id, broken: true }));
  });
  const before = await snapshot();
  await expect(repo.deleteUnreadable('save-a')).rejects.toMatchObject({ code: 'HISTORY_RECOVERY_REQUIRED' });
  expect(await snapshot()).toEqual(before);
  vi.spyOn(IDBIndex.prototype, 'count').mockImplementation(() => { throw new DOMException('synthetic denied', 'SecurityError'); });
  await expect(repo.deleteUnreadable('save-a')).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});

it('无收藏的损坏主档仍可删除，其他存档的真实收藏保持原样', async () => {
  const state = { ...await repo.load('save-a'), saveId: 'save-b' };
  await repo.importBackup({ state }, (await repo.compareBackup({ state })).confirmation);
  const node = await repo.history.create('save-b', '只保护另一存档'); await corrupt();
  const before = await snapshot(); await repo.deleteUnreadable('save-a');
  const after = await snapshot();
  for (const name of ['historyMetadata', 'historyPayloads']) expect(after.find(row => row.name === name)).toEqual(before.find(row => row.name === name));
  expect((await repo.list()).map(save => save.storageKey)).toEqual(['save-b']);
  expect((await repo.history.preview('save-b', { kind: 'manual', id: node.id })).state).toEqual(state);
});
