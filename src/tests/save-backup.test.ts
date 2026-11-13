import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import type { BackupImportConfirmation } from '../services/storage/saveRepository';
import { backupFileName, parseBackup, readBackupFile, serializeBackup, utf8ByteLength } from '../services/storage/backup';
import type { BackupEntry } from '../services/storage/backup';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { DataError } from '../domain/common';
import { GameStateSchema } from '../domain/state';
import { reserveStageSession } from '../workflows/stageGuard';
import { compressionState } from './fixtures/compression';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { parseCompression, planCompression } from '../domain/memories/compression';
import { parseNpcSummary, planNpcSummary } from '../domain/memories/npcMemory';
import { worldState } from './fixtures/world';
import { game, purchase, story } from './fixtures/game';

const name = 'backup-test';
const stores = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls'] as const;
let factory: IDBFactory, repository: SaveRepository;
beforeEach(async () => { factory = new IDBFactory(); repository = await SaveRepository.open(name, factory); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); repository.close(); });

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
/** 全部五个时间线仓库的所有原始记录，用于证明失败后什么都没改。 */
function all() {
  return raw(db => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const tx = db.transaction([...stores], 'readonly'), result: Record<string, unknown[]> = {};
    for (const store of stores) { const read = tx.objectStore(store).getAll(); read.onsuccess = () => { result[store] = read.result; }; }
    tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
  }));
}
async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; } catch (error) { return error instanceof DataError ? error.code : String(error); }
}
async function backupOf(saveId: string): Promise<BackupEntry> {
  const [entry] = await repository.exportBackup([saveId]);
  return structuredClone(entry);
}
async function confirm(entry: { state: BackupEntry['state']; draft?: TurnDraft }): Promise<BackupImportConfirmation> {
  return (await repository.compareBackup(entry)).confirmation;
}
async function withDraft(saveId = 'save-a', input = '去银行') {
  await repository.create(game(saveId));
  return repository.saveDraft(createTurnDraft(saveId, 0, 'turn-a', 'regular', input), null);
}

describe('备份文件格式', () => {
  it('导出→序列化→解析往返保留同一正式版本的未结算草稿，校验和为 valid', async () => {
    await withDraft();
    const entries = await repository.exportBackup(['save-a']);
    expect(entries[0].draft?.saveId).toBe('save-a');
    const parsed = await parseBackup(await serializeBackup(entries, '1.0.0-beta', new Date(2026, 10, 13)));
    expect(parsed).toMatchObject({ app: '1.0.0-beta', checksum: 'valid' });
    const [entry] = parsed.entries;
    if (!entry.ok) throw new Error('expected readable entry');
    expect(entry.state).toEqual(entries[0].state);
    expect(entry.draft).toEqual(entries[0].draft);
  });

  it('多份导出保持顺序，文件名区分单份与全部', async () => {
    await repository.create(game('save-a')); await repository.create(game('save-b'));
    const entries = await repository.exportBackup(['save-b', 'save-a']);
    expect(entries.map(entry => entry.state.saveId)).toEqual(['save-b', 'save-a']);
    const now = new Date(2026, 10, 13);
    expect(backupFileName(entries.slice(0, 1), now)).toBe('黑金王朝备份_测试存档_第0回_20261113.heijin.json');
    expect(backupFileName(entries, now)).toBe('黑金王朝备份_全部2份存档_20261113.heijin.json');
    expect(backupFileName([{ ...entries[0], summary: { ...entries[0].summary, title: 'a/b:c*?' } }], now)).toContain('_abc_');
  });

  it('缺失或无法读取的存档拒绝导出', async () => {
    expect(await code(repository.exportBackup(['nope']))).toBe('NOT_FOUND');
    await put('saves', { saveId: 'broken', schemaVersion: 99 });
    expect(await code(repository.exportBackup(['broken']))).toBeDefined();
    expect(await code(repository.exportBackup([]))).toBe('INVALID_KEY');
  });

  it('过期草稿在导出时跳过，不影响存档', async () => {
    await withDraft();
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    const [entry] = await repository.exportBackup(['save-a']);
    expect(entry.state.revision).toBe(1);
    expect(entry.draft).toBeUndefined();
  });

  it('SHA-256 不匹配标为 mismatch，仍读取各份存档', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    file.saves[0].summary.title = '被改过';
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.checksum).toBe('mismatch');
    expect(parsed.entries[0].ok).toBe(true);
  });

  it('缺少校验和为 unverified；格式不对的校验和为 mismatch', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    expect((await parseBackup(JSON.stringify({ ...file, checksum: undefined }))).checksum).toBe('unverified');
    expect((await parseBackup(JSON.stringify({ ...file, checksum: '' }))).checksum).toBe('unverified');
    expect((await parseBackup(JSON.stringify({ ...file, checksum: 'md5:abc' }))).checksum).toBe('mismatch');
  });

  it('WebCrypto 不可用：解析标为 unverified，导出省略校验和', async () => {
    await repository.create(game('save-a'));
    const entries = await repository.exportBackup(['save-a']);
    const signed = await serializeBackup(entries, 'test');
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: () => real.randomUUID(), getRandomValues: real.getRandomValues.bind(real) });
    expect((await parseBackup(signed)).checksum).toBe('unverified');
    const unsigned = JSON.parse(await serializeBackup(entries, 'test'));
    expect(unsigned).not.toHaveProperty('checksum');
    vi.unstubAllGlobals();
    expect((await parseBackup(JSON.stringify(unsigned))).checksum).toBe('unverified');
  });

  it('体积上限按 UTF-8 字节计算，多字节内容不能绕过', async () => {
    for (const text of ['abc', 'é', '中文', '😀', 'a\ud800b', '\udc00']) expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).byteLength);
    const text = JSON.stringify({ title: '中'.repeat(20) });
    expect(text.length).toBeLessThan(60);
    expect(await code(parseBackup(text, 60))).toBe('BACKUP_TOO_LARGE');
    expect(await code(readBackupFile({ size: 256 * 1024 * 1024 + 1, text: async () => '' } as unknown as Blob))).toBe('BACKUP_TOO_LARGE');
  });

  it('非备份、原始数据导出文件和未来版本各自拒绝', async () => {
    expect(await code(parseBackup('not json'))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ hello: 'world' })))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-backup', version: 1, saves: [] })))).toBe('BACKUP_INVALID');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-raw-save', version: 1, records: {} })))).toBe('BACKUP_RAW');
    expect(await code(parseBackup(JSON.stringify({ format: 'heijin-backup', version: 2, saves: [] })))).toBe('BACKUP_FUTURE');
  });

  it('单份损坏、未来或过旧版本不影响同文件其他存档', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    const base = file.saves[0].state;
    file.saves.push({ summary: { title: '未来存档' }, state: { ...base, saveId: 'save-z', schemaVersion: 99 } });
    file.saves.push({ summary: { title: '旧存档' }, state: { ...base, saveId: 'save-o', schemaVersion: 5 } });
    file.saves.push({ summary: { title: '坏存档' }, state: { saveId: 'save-y' } });
    delete file.checksum;
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.entries.map(entry => entry.ok)).toEqual([true, false, false, false]);
    expect(parsed.entries[1]).toMatchObject({ ok: false, title: '未来存档', code: 'FUTURE_VERSION' });
    expect(parsed.entries[2]).toMatchObject({ ok: false, title: '旧存档', code: 'UNSUPPORTED_VERSION' });
    expect(parsed.entries[3]).toMatchObject({ ok: false, title: '坏存档' });
  });

  it('不属于该存档的草稿在解析时跳过并说明原因', async () => {
    await repository.create(game('save-a'));
    const file = JSON.parse(await serializeBackup(await repository.exportBackup(['save-a']), 'test'));
    file.saves[0].draft = createTurnDraft('save-other', 0, 'turn-a', 'regular', '输入');
    delete file.checksum;
    const [entry] = (await parseBackup(JSON.stringify(file))).entries;
    expect(entry).toMatchObject({ ok: true, draftDropped: expect.stringContaining('不属于') });
    expect(entry.ok && entry.draft).toBeFalsy();
  });
});

describe('导入前比较', () => {
  it('区分 new / same / 仅草稿不同 / 正式存档不同 / 无法读取，且不写任何记录', async () => {
    const fresh = game('save-a');
    expect((await repository.compareBackup({ state: fresh })).kind).toBe('new');
    await withDraft();
    const backup = await backupOf('save-a');
    const before = await all();
    expect(await repository.compareBackup(backup)).toMatchObject({ kind: 'same' });
    expect(await repository.compareBackup({ state: backup.state })).toMatchObject({ kind: 'overwrite', differences: { state: false, draft: true } });
    expect(await all()).toEqual(before);
    await repository.save('save-a', 0, 'turn-x', [purchase()]);
    expect(await repository.compareBackup(backup)).toMatchObject({ kind: 'overwrite', differences: { state: true } });
    await put('saves', { saveId: 'broken', schemaVersion: 99 });
    const beforeUnreadable = await all();
    expect((await repository.compareBackup({ state: { ...backup.state, saveId: 'broken' } })).kind).toBe('overwrite-unreadable');
    expect(await all()).toEqual(beforeUnreadable);
  });

  it('revision、回合数和更新时间相同但 NPC 记忆不同，不能判为 same', async () => {
    const state = GameStateSchema.parse({ ...compressionState(), npc: npcMemoryState(31).npc });
    await put('saves', state);
    const backup = await backupOf('save-a');
    const changed = structuredClone(state);
    changed.npc['npc-a'].memories[0] = { ...changed.npc['npc-a'].memories[0], text: '另一页刚整理过的私人经历。' };
    await put('saves', GameStateSchema.parse(changed));
    const local = await repository.load('save-a');
    expect([local.revision, local.turnNumber, local.updatedAt]).toEqual([backup.state.revision, backup.state.turnNumber, backup.state.updatedAt]);
    expect(await repository.compareBackup(backup)).toMatchObject({ kind: 'overwrite', differences: { state: true, draft: false } });
  });

  it('确认凭据不携带存档内容', async () => {
    await repository.create(game('save-a'));
    const { confirmation } = await repository.compareBackup(await backupOf('save-a'));
    expect(JSON.stringify(confirmation)).toBe('{}');
    expect(Object.keys(confirmation)).toEqual([]);
  });
});

describe('导入与覆盖', () => {
  it('新增导入带回草稿，草稿内容不变、draftRevision 递增', async () => {
    const state = game('save-a');
    const draft = createTurnDraft('save-a', 0, 'turn-a', 'regular', '去银行');
    const token = await confirm({ state, draft });
    expect((await repository.importBackup({ state, draft }, token)).saveId).toBe('save-a');
    const loaded = await repository.loadGame('save-a');
    expect(loaded.state).toMatchObject({ saveId: 'save-a', revision: 0, title: state.title, updatedAt: state.updatedAt });
    expect(loaded.draft).toEqual({ ...draft, draftRevision: 1 });
  });

  it('凭据一次有效，且必须属于同一存档与同一仓库连接', async () => {
    const state = game('save-a');
    const token = await confirm({ state });
    expect(await code(repository.importBackup({ state: game('save-b') }, token))).toBe('IMPORT_CONFIRMATION_INVALID');
    expect(await code(repository.importBackup({ state }, token))).toBe('IMPORT_CONFIRMATION_INVALID');
    const other = await SaveRepository.open(name, factory);
    try {
      const foreign = await other.compareBackup({ state });
      expect(await code(repository.importBackup({ state }, foreign.confirmation))).toBe('IMPORT_CONFIRMATION_INVALID');
    } finally { other.close(); }
    expect(await code(repository.importBackup({ state }, Object.freeze({}) as BackupImportConfirmation))).toBe('IMPORT_CONFIRMATION_INVALID');
    expect(await all()).toEqual({ saves: [], drafts: [], turnReceipts: [], turnUndo: [], saveControls: [] });
  });

  it('本机已有存档时未明确覆盖则拒绝', async () => {
    await withDraft();
    const backup = await backupOf('save-a'), before = await all();
    expect(await code(repository.importBackup(backup, await confirm(backup)))).toBe('SAVE_EXISTS');
    expect(await all()).toEqual(before);
  });

  it('A：确认后草稿更新（正式 revision 不变），旧确认被拒绝且所有记录不变', async () => {
    const draft = await withDraft();
    const backup = await backupOf('save-a');
    const token = await confirm(backup);
    await repository.saveDraft(rerollStory(draft, story), draft.draftRevision, undefined, draft);
    const before = await all();
    expect((await repository.load('save-a')).revision).toBe(0);
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect(await all()).toEqual(before);
  });

  it('B：确认后 NPC 管理变化（正式 revision 不变），旧确认被拒绝并保留管理结果', async () => {
    await repository.create(worldState());
    const backup = await backupOf('save-a');
    const token = await confirm(backup);
    const { state } = await repository.loadGame('save-a');
    await repository.setNpcImportance({ saveId: 'save-a', expectedRevision: state.revision, expectedManagementRevision: 0,
      npcId: 'npc-a', identityKey: state.npc['npc-a'].identityKey, choice: 'special', operationId: 'manage-1' });
    const before = await all();
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect(await all()).toEqual(before);
    const kept = await repository.load('save-a');
    expect([kept.revision, kept.npcManagementRevision, kept.npc['npc-a'].importancePreference]).toEqual([0, 1, 'special']);
  });

  it.each(['npc', 'compression'] as const)('C：确认后写入%s记忆总结（正式 revision 不变），旧确认被拒绝且新记忆保留', async kind => {
    await put('saves', GameStateSchema.parse({ ...compressionState(), npc: npcMemoryState(31).npc }));
    const context = await repository.loadMemoryContext('save-a');
    const backup = await backupOf('save-a');
    const token = await confirm(backup);
    const saved = kind === 'npc'
      ? await (async () => { const batch = planNpcSummary(context.state, 'npc-a')!;
        return repository.saveNpcSummary(batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'npc-summary-new'), context.lineage); })()
      : await (async () => { const batch = planCompression(context.state)!;
        return repository.saveMemoryCompression(batch, parseCompression(JSON.stringify({ summary: '保留这些经历与约定。', importantEvents: ['依照原记忆的时间与结果。'] }), batch, 'summary-new'), context.lineage); })();
    expect(saved.revision).toBe(backup.state.revision);
    const before = await all();
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect(await all()).toEqual(before);
    expect(await repository.load('save-a')).toEqual(saved);
  });

  it.each([
    ['提交回执', 'turnReceipts', { saveId: 'save-a', turnId: 'turn-x', marker: true }],
    ['撤回快照', 'turnUndo', { saveId: 'save-a', turnId: 'turn-x', marker: true }],
    ['时间线控制', 'saveControls', { saveId: 'save-a', marker: true }],
  ] as const)('确认后仅%s变化（正式存档与草稿不变），旧确认同样被拒绝', async (_label, store, value) => {
    await withDraft();
    const backup = await backupOf('save-a');
    const token = await confirm(backup);
    await put(store, value);
    const before = await all();
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect(await all()).toEqual(before);
  });

  it('确认后记忆维护首次建立时间线控制，旧确认同样被拒绝', async () => {
    await withDraft();
    const backup = await backupOf('save-a');
    const token = await confirm(backup);
    await repository.loadMemoryContext('save-a');
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
  });

  it('D：无法读取的本机记录在确认后被改写、仍无法读取，旧确认失效且原记录保留', async () => {
    await put('saves', { saveId: 'save-a', schemaVersion: 99, payload: '第一版损坏数据' });
    await repository.create(game('save-b'));
    const backup = { state: game('save-a') };
    const token = await confirm(backup);
    await put('saves', { saveId: 'save-a', schemaVersion: 99, payload: '另一个标签写入的第二版' });
    const before = await all();
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect(await all()).toEqual(before);
    const retry = await confirm(backup);
    await repository.importBackup(backup, retry, { overwrite: true });
    expect((await repository.load('save-a')).saveId).toBe('save-a');
    expect((await repository.load('save-b')).saveId).toBe('save-b');
  });

  it('确认后记录出现或消失都视为变化，不会静默新增或覆盖', async () => {
    const appear = { state: game('save-a') };
    const tokenNew = await confirm(appear);
    await repository.create(game('save-a'));
    expect(await code(repository.importBackup(appear, tokenNew))).toBe('IMPORT_CONFLICT');
    const backup = await backupOf('save-a');
    const tokenOverwrite = await confirm(backup);
    await repository.delete('save-a', 0);
    expect(await code(repository.importBackup(backup, tokenOverwrite, { overwrite: true }))).toBe('IMPORT_CONFLICT');
    expect((await all()).saves).toEqual([]);
  });

  it('覆盖在同一事务清除本存档草稿、回执、撤回与控制，其他存档不受影响', async () => {
    await withDraft();
    const backup = await backupOf('save-a');
    await put('turnUndo', { saveId: 'save-a', turnId: 'turn-x', marker: true });
    await put('turnReceipts', { saveId: 'save-a', turnId: 'turn-x', marker: true });
    await put('saveControls', { saveId: 'save-a', marker: true });
    await repository.create(game('save-b'));
    await put('turnUndo', { saveId: 'save-b', turnId: 'turn-x', marker: true });
    const token = await confirm(backup);
    await repository.importBackup(backup, token, { overwrite: true });
    const after = await all();
    expect(after.turnReceipts).toEqual([]);
    expect(after.saveControls).toEqual([]);
    expect(after.turnUndo).toEqual([{ saveId: 'save-b', turnId: 'turn-x', marker: true }]);
    expect((await repository.loadDraft('save-a'))?.draftRevision).toBe(1);
    expect((await repository.load('save-b')).saveId).toBe('save-b');
  });

  it('E：同页有阶段会话时拒绝导入覆盖，所有记录不变', async () => {
    await withDraft();
    const backup = await backupOf('save-a');
    const token = await confirm(backup), before = await all();
    const session = reserveStageSession('save-a');
    try { expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBe('STORY_BUSY'); }
    finally { session.release(); }
    expect(await all()).toEqual(before);
  });

  it('E：另一连接（标签）先完成导入后，本连接的旧确认被 CAS 拒绝', async () => {
    await withDraft();
    const original = await backupOf('save-a');
    const first = { ...original, state: { ...original.state, title: '备份甲' } };
    const second = { ...original, state: { ...original.state, title: '备份乙' } };
    const other = await SaveRepository.open(name, factory);
    try {
      const tokenA = await confirm(first), tokenB = (await other.compareBackup(second)).confirmation;
      await repository.importBackup(first, tokenA, { overwrite: true });
      const before = await all();
      expect(await code(other.importBackup(second, tokenB, { overwrite: true }))).toBe('IMPORT_CONFLICT');
      expect(await all()).toEqual(before);
      expect((before.saves[0] as { title: string }).title).toBe('备份甲');
    } finally { other.close(); }
  });

  it('E：两次导入同时发起，只有一次写入，不发生双写', async () => {
    await withDraft();
    const original = await backupOf('save-a');
    const first = { ...original, state: { ...original.state, title: '备份甲' } };
    const second = { ...original, state: { ...original.state, title: '备份乙' } };
    const other = await SaveRepository.open(name, factory);
    try {
      const tokenA = await confirm(first), tokenB = (await other.compareBackup(second)).confirmation;
      const results = await Promise.allSettled([
        repository.importBackup(first, tokenA, { overwrite: true }),
        other.importBackup(second, tokenB, { overwrite: true }),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      // 同一页面由阶段会话先拦下（STORY_BUSY）；分属两个标签时由写事务内的快照比较拦下（IMPORT_CONFLICT）。
      expect(['STORY_BUSY', 'IMPORT_CONFLICT']).toContain((rejected.reason as DataError).code);
      const after = await all();
      expect(after.saves).toHaveLength(1);
      expect(after.drafts).toHaveLength(1);
    } finally { other.close(); }
  });

  it('E：覆盖后迟到的旧阶段响应不能写入，即使 draftRevision 恰好相同', async () => {
    const initial = await withDraft();
    const backup = await backupOf('save-a');
    const local = await repository.saveDraft(rerollStory(initial, story), 0, undefined, initial);
    await repository.importBackup(backup, await confirm(backup), { overwrite: true });
    const imported = (await repository.loadDraft('save-a'))!;
    expect(imported.draftRevision).toBe(local.draftRevision + 1);
    expect({ ...imported, draftRevision: 0 }).toEqual(backup.draft);
    // 旧时间线上的写入者：基于本地草稿，版本号已落后。
    const lateFromLocal = rerollStory(local, { ...story, summary: '迟到的旧正文' });
    expect(await code(repository.saveDraft(lateFromLocal, local.draftRevision, undefined, local))).toBe('DRAFT_CONFLICT');
    // 版本号恰好与导入草稿相同、其余元数据也能通过连续性检查，但内容不同。
    const coincident = TurnDraftSchema.parse({ ...imported, failures: [{ stage: 'story', attempt: 0, storyRevision: 0, errorCode: 'timeout', retryable: true }] });
    expect(coincident.draftRevision).toBe(imported.draftRevision);
    expect(await code(repository.saveDraft(rerollStory(coincident, story), coincident.draftRevision, undefined, coincident))).toBe('DRAFT_CONFLICT');
    expect(await repository.loadDraft('save-a')).toEqual(imported);
  });

  it('E：覆盖后迟到的旧记忆总结因时间线失效而拒绝', async () => {
    await put('saves', GameStateSchema.parse({ ...compressionState(), npc: npcMemoryState(31).npc }));
    const context = await repository.loadMemoryContext('save-a');
    const backup = await backupOf('save-a');
    const batch = planCompression(context.state)!;
    await repository.importBackup(backup, await confirm(backup), { overwrite: true });
    const imported = await repository.load('save-a');
    const output = parseCompression(JSON.stringify({ summary: '迟到总结。', importantEvents: ['旧时间线。'] }), batch, 'summary-late');
    expect(await code(repository.saveMemoryCompression(batch, output, context.lineage))).toBe('MEMORY_TIMELINE_CHANGED');
    expect(await repository.load('save-a')).toEqual(imported);
  });

  it.each([
    ['删除草稿', 'delete', 'drafts'],
    ['删除回执', 'delete', 'turnReceipts'],
    ['写入新存档', 'add', 'saves'],
  ] as const)('F：%s时事务中止，原数据和其他存档全部不变', async (_label, method, store) => {
    await withDraft();
    await put('turnReceipts', { saveId: 'save-a', turnId: 'turn-x', marker: true });
    await repository.create(game('save-b'));
    const backup = await backupOf('save-a');
    const token = await confirm(backup), before = await all();
    const original = IDBObjectStore.prototype[method] as (this: IDBObjectStore, ...args: unknown[]) => IDBRequest;
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
      const result = original.apply(this, args); if (this.name === store) this.transaction.abort(); return result;
    } as never);
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBeDefined();
    vi.restoreAllMocks();
    expect(await all()).toEqual(before);
  });

  it('F：写入草稿时存储空间不足，整笔导入回滚', async () => {
    await withDraft();
    const backup = await backupOf('save-a');
    const token = await confirm(backup), before = await all();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'drafts') throw new DOMException('quota', 'QuotaExceededError');
      return original.apply(this, args);
    });
    expect(await code(repository.importBackup(backup, token, { overwrite: true }))).toBeDefined();
    vi.restoreAllMocks();
    expect(await all()).toEqual(before);
  });
});
