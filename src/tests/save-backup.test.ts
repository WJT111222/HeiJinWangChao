import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { backupFileName, backupSummary, parseBackup, serializeBackup } from '../services/storage/backup';
import { createTurnDraft } from '../domain/drafts';
import { DataError } from '../domain/common';
import { game, purchase } from './fixtures/game';

const name = 'backup-test';
let factory: IDBFactory, repository: SaveRepository;
beforeEach(async () => { factory = new IDBFactory(); repository = await SaveRepository.open(name, factory); });
afterEach(() => { repository.close(); });

async function raw<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  try { return await work(db); } finally { db.close(); }
}
function put(store: string, value: unknown) {
  return raw(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    tx.objectStore(store).put(value);
  }));
}
function count(store: string) {
  return raw(db => new Promise<number>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'); const read = tx.objectStore(store).count();
    read.onsuccess = () => resolve(read.result); tx.onabort = () => reject(tx.error);
  }));
}
async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; } catch (error) { return error instanceof DataError ? error.code : String(error); }
}

describe('save backup file format', () => {
  it('round-trips one save with its current draft through export, serialize and parse', async () => {
    await repository.create(game('save-a'));
    await repository.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'regular', '去银行'), null);
    const entries = await repository.exportBackup(['save-a']);
    expect(entries).toHaveLength(1);
    expect(entries[0].draft?.saveId).toBe('save-a');
    const text = await serializeBackup(entries, '0.9.0', new Date(2026, 10, 13));
    const parsed = await parseBackup(text);
    expect(parsed.checksumValid).toBe(true);
    expect(parsed.app).toBe('0.9.0');
    expect(parsed.entries).toEqual([expect.objectContaining({ ok: true, title: '测试存档' })]);
    const [entry] = parsed.entries;
    if (!entry.ok) throw new Error('expected readable entry');
    expect(entry.state).toEqual(entries[0].state);
    expect(entry.draft).toEqual(entries[0].draft);
  });

  it('exports several saves in the order asked and names the file for one or many', async () => {
    await repository.create(game('save-a')); await repository.create(game('save-b'));
    const entries = await repository.exportBackup(['save-b', 'save-a']);
    expect(entries.map(entry => entry.state.saveId)).toEqual(['save-b', 'save-a']);
    const now = new Date(2026, 10, 13);
    expect(backupFileName(entries.slice(0, 1), now)).toBe('黑金王朝备份_测试存档_第0回_20261113.heijin.json');
    expect(backupFileName(entries, now)).toBe('黑金王朝备份_全部2份存档_20261113.heijin.json');
    expect(backupFileName([{ ...entries[0], summary: { ...entries[0].summary, title: 'a/b:c*?' } }], now)).toContain('_abc_');
  });

  it('refuses to export a save that is missing or unreadable', async () => {
    expect(await code(repository.exportBackup(['nope']))).toBe('NOT_FOUND');
    await put('saves', { saveId: 'broken', schemaVersion: 99 });
    expect(await code(repository.exportBackup(['broken']))).toBeDefined();
    expect(await code(repository.exportBackup([]))).toBe('INVALID_KEY');
  });

  it('drops a stale draft instead of failing the export', async () => {
    await repository.create(game('save-a'));
    await repository.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入'), null);
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    const [entry] = await repository.exportBackup(['save-a']);
    expect(entry.state.revision).toBe(1);
    expect(entry.draft).toBeUndefined();
  });

  it('flags a checksum mismatch but still reads the saves', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    file.saves[0].summary.title = '被改过';
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.checksumValid).toBe(false);
    expect(parsed.entries[0].ok).toBe(true);
  });

  it('rejects non-backup, raw recovery and future-version files with distinct codes', async () => {
    expect(await code(parseBackup('not json'))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ hello: 'world' })))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-backup', version: 1, saves: [] })))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-raw-save', version: 1, record: {} })))).toBe('BACKUP_RAW');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-backup', version: 2, saves: [] })))).toBe('BACKUP_FUTURE');
  });

  it('reports one broken save without hiding the others in the same file', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    file.saves.push({ summary: { title: '未来存档' }, state: { ...file.saves[0].state, saveId: 'save-z', schemaVersion: 99 } });
    file.saves.push({ summary: { title: '坏存档' }, state: { saveId: 'save-y' } });
    delete file.checksum;
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.entries.map(entry => entry.ok)).toEqual([true, false, false]);
    expect(parsed.entries[1]).toMatchObject({ ok: false, title: '未来存档', code: 'FUTURE_VERSION' });
    expect(parsed.entries[2]).toMatchObject({ ok: false, title: '坏存档' });
  });

  it('marks a draft from another save as dropped when parsing', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    file.saves[0].draft = createTurnDraft('save-other', 0, 'turn-a', 'regular', '输入');
    delete file.checksum;
    const [entry] = (await parseBackup(JSON.stringify(file))).entries;
    expect(entry).toMatchObject({ ok: true, draftDropped: expect.stringContaining('不属于') });
    expect(entry.ok && entry.draft).toBeFalsy();
  });
});

describe('save backup import', () => {
  it('compares new, identical and diverged saves without writing', async () => {
    const state = game('save-a');
    expect(await repository.compareBackup(state)).toEqual({ kind: 'new' });
    await repository.create(state);
    const [entry] = await repository.exportBackup(['save-a']);
    expect(await repository.compareBackup(entry.state)).toMatchObject({ kind: 'same' });
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    expect(await repository.compareBackup(entry.state)).toEqual({ kind: 'overwrite', local: backupSummary(await repository.load('save-a')) });
    await put('saves', { saveId: 'broken', schemaVersion: 99 });
    expect(await repository.compareBackup({ ...entry.state, saveId: 'broken' })).toEqual({ kind: 'overwrite-unreadable' });
  });

  it('imports a new save together with its draft', async () => {
    const state = game('save-a');
    const draft = createTurnDraft('save-a', 0, 'turn-a', 'regular', '去银行');
    expect((await repository.importBackup({ state, draft })).saveId).toBe('save-a');
    expect(await repository.loadGame('save-a')).toMatchObject({ state: { saveId: 'save-a' }, draft: { turnId: 'turn-a' } });
  });

  it('never overwrites an existing save without explicit confirmation', async () => {
    await repository.create(game('save-a'));
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    expect(await code(repository.importBackup({ state: game('save-a') }))).toBe('SAVE_EXISTS');
    expect((await repository.load('save-a')).revision).toBe(1);
  });

  it('rejects overwrite when the local save changed after the comparison', async () => {
    await repository.create(game('save-a'));
    const [backup] = await repository.exportBackup(['save-a']);
    const before = await repository.compareBackup(backup.state);
    expect(before.kind).toBe('same');
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    expect(await code(repository.importBackup({ state: backup.state }, { overwrite: { localRevision: 0 } }))).toBe('REVISION_CONFLICT');
    expect((await repository.load('save-a')).revision).toBe(1);
  });

  it('overwrite replaces the save and clears its draft, receipts, undo and controls in one step', async () => {
    const backup = game('save-a');
    await repository.create(game('save-a'));
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    await repository.saveDraft(createTurnDraft('save-a', 1, 'turn-b', 'regular', '本机草稿'), null);
    await put('turnUndo', { saveId: 'save-a', turnId: 'turn-x', marker: true });
    await put('turnReceipts', { saveId: 'save-a', turnId: 'turn-x', marker: true });
    await put('saveControls', { saveId: 'save-a', marker: true });
    await repository.create(game('save-b'));
    await put('turnUndo', { saveId: 'save-b', turnId: 'turn-x', marker: true });

    await repository.importBackup({ state: backup }, { overwrite: { localRevision: 1 } });
    expect((await repository.load('save-a')).revision).toBe(0);
    expect(await repository.loadDraft('save-a')).toBeUndefined();
    expect(await count('turnReceipts')).toBe(0);
    expect(await count('saveControls')).toBe(0);
    expect(await count('turnUndo')).toBe(1); // 只属于 save-b 的记录保留
    expect((await repository.load('save-b')).saveId).toBe('save-b');
  });

  it('can replace an unreadable local record only when confirmed as unreadable', async () => {
    await put('saves', { saveId: 'save-a', schemaVersion: 99 });
    expect(await code(repository.importBackup({ state: game('save-a') }))).toBe('SAVE_EXISTS');
    expect(await code(repository.importBackup({ state: game('save-a') }, { overwrite: { localRevision: 0 } }))).toBe('REVISION_CONFLICT');
    await repository.importBackup({ state: game('save-a') }, { overwrite: { localRevision: null } });
    expect((await repository.load('save-a')).saveId).toBe('save-a');
  });

  it('skips an incompatible draft but still imports the save', async () => {
    const draft = createTurnDraft('save-a', 5, 'turn-a', 'regular', '旧草稿');
    await repository.importBackup({ state: game('save-a'), draft });
    expect(await repository.loadDraft('save-a')).toBeUndefined();
    expect((await repository.load('save-a')).saveId).toBe('save-a');
  });
});
