import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository, saveDatabaseVersion } from '../services/storage/saveRepository';
import { worldState } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { rerollStory } from '../domain/drafts';
import { decodeHistory, encodeHistory, maxHistoryBytes } from '../services/storage/history/codec';
import { parseBackup } from '../services/storage/backup';
import * as backup from '../services/storage/backup';
import { reserveStageSession } from '../workflows/stageGuard';

let repo: SaveRepository, factory: IDBFactory;
beforeEach(async () => { factory = new IDBFactory(); repo = await SaveRepository.open('history', factory); await repo.create(worldState()); });
afterEach(() => { repo.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function turn(action = '继续日常') {
  const game = await repo.loadGame('save-a');
  if (game.draft && !game.draft.userInput) await repo.bindTurnAction(game.draft, action, true, true);
  return repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '时间经过', 60) }), ''));
}
async function turns(n: number) { for (let i = 0; i < n; i++) await turn(`行动 ${i}`); }
async function oldest() { return (await repo.history.list('save-a')).nodes.filter(n => n.kind === 'automatic')[0]; }
async function raw() { return repo.exportRaw('save-a'); }
async function edit(store: string, work: (store: IDBObjectStore) => void) {
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('history'); open.onsuccess = () => { const db = open.result, tx = db.transaction(store, 'readwrite'); work(tx.objectStore(store)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  });
}
it('五份原始恢复点可自由读取，列表不读取历史载荷；只读预览与取消不改任何仓库', async () => {
  await turns(7); const before = await raw();
  const get = vi.spyOn(IDBObjectStore.prototype, 'get'), all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  const list = await repo.history.list('save-a');
  expect(list.nodes.map(n => n.turnNumber)).toEqual([2, 3, 4, 5, 6]);
  expect(get.mock.contexts.every(s => (s as IDBObjectStore).name !== 'turnUndo' && (s as IDBObjectStore).name !== 'historyPayloads')).toBe(true);
  expect(all.mock.contexts.every(s => (s as IDBObjectStore).name !== 'turnUndo' && (s as IDBObjectStore).name !== 'historyPayloads')).toBe(true);
  for (const node of list.nodes) {
    const preview = await repo.history.preview('save-a', node);
    expect(preview.state.turnNumber).toBe(node.turnNumber);
    expect(preview.state.journal).toEqual((await repo.load('save-a')).journal.slice(0, node.turnNumber));
    repo.history.release(preview.confirmation);
  }
  expect(await raw()).toEqual(before);
});
it('最旧节点恢复原子清空全部撤回及旧回执，绑定新输入；从新根积累五份', async () => {
  await turns(7); const before = await repo.loadGame('save-a'), preview = await repo.history.preview('save-a', await oldest());
  const restored = await repo.history.restore(preview.confirmation, '换一个选择', true, true);
  expect(restored.state).toEqual({ ...preview.state, revision: before.state.revision + 1, updatedAt: restored.state.updatedAt });
  expect(restored.draft.userInput).toBe('换一个选择'); expect(restored.draft.story).toBeUndefined();
  expect((await raw()).records.turnReceipts).toEqual([]); expect((await repo.undoStatus('save-a')).available).toBe(0);
  await expect(repo.history.restore(preview.confirmation, '双击', true, true)).rejects.toThrow();
  await expect(repo.undoTurn({ saveId: 'save-a', expectedRevision: restored.state.revision, expectedDraft: restored.draft, operationId: 'no' })).rejects.toThrow();
  await turn(); expect((await repo.undoStatus('save-a')).available).toBe(1);
  let game = await repo.loadGame('save-a');
  const undone = await repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: 'first' });
  expect(undone.state.turnNumber).toBe(preview.state.turnNumber); expect((await repo.undoStatus('save-a')).available).toBe(0);
  await turns(6); expect((await repo.undoStatus('save-a')).available).toBe(5);
  for (let i = 0; i < 5; i++) { game = await repo.loadGame('save-a'); await repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: `again-${i}` }); }
  expect((await repo.load('save-a')).turnNumber).toBe(3);
});
it('收藏完整正式状态，压缩无损、重开、同名独立、改名、删除及单节点导出', async () => {
  await turns(3); const state = await repo.load('save-a'), before = await raw();
  const one = await repo.history.create('save-a', '重要谈判前'), two = await repo.history.create('save-a', '重要谈判前');
  expect(one.id).not.toBe(two.id); expect(one.bytes).toBeGreaterThan(0); expect(one.encoding).toBe('gzip');
  repo.close(); repo = await SaveRepository.open('history', factory);
  expect((await repo.history.preview('save-a', { kind: 'manual', id: one.id })).state).toEqual(state);
  await repo.history.rename('save-a', one.id, '新名称');
  const list = await repo.history.list('save-a'); expect(list.manualBytes).toBeGreaterThan(one.bytes);
  expect(list.nodes.find(n => n.id === one.id)?.name).toBe('新名称');
  const exported = await repo.history.exportNode('save-a', { kind: 'manual', id: one.id }, '1.0-test');
  const parsed = await parseBackup(exported.text);
  expect(parsed.checksum).toBe('valid'); expect(parsed.entries[0].ok).toBe(true);
  if (parsed.entries[0].ok) expect(parsed.entries[0].state).toEqual(state);
  expect('draft' in parsed.entries[0]).toBe(false);
  await repo.history.delete('save-a', two.id);
  expect((await repo.history.list('save-a')).nodes.filter(n => n.kind === 'manual')).toHaveLength(1);
  expect(await raw()).toEqual(before);
});
it('导出外壳超过原备份导入上限时拒绝下载，原节点与正式进度保留', async () => {
  await turns(2); const node = await repo.history.create('save-a', '保留的大节点');
  const before = await raw(), nodes = await repo.history.list('save-a');
  // Mock the serialized length instead of building and encoding a huge GameState.
  vi.spyOn(backup, 'serializeBackup').mockResolvedValue('x'.repeat(backup.maxBackupBytes + 1));
  await expect(repo.history.exportNode('save-a', { kind: 'manual', id: node.id }, 'test')).rejects.toMatchObject({ code: 'HISTORY_TOO_LARGE' });
  expect(await raw()).toEqual(before); expect(await repo.history.list('save-a')).toEqual(nodes);
});
it('只保存正式状态，不包含未结算正文、草稿或续写片段', async () => {
  await turns(2); const game = await repo.loadGame('save-a');
  const bound = await repo.bindTurnAction(game.draft!, '未提交的输入', true, true);
  await repo.saveDraft(rerollStory(bound, { turnKind: 'regular', narrative: '不可收藏的候选', summary: '候选', variableGuide: [] }), bound.draftRevision);
  const node = await repo.history.create('save-a', '正式进度');
  const preview = await repo.history.preview('save-a', { kind: 'manual', id: node.id });
  expect(preview.state).toEqual(game.state); expect(preview.hasDraft).toBe(true);
  expect(JSON.stringify(preview.state)).not.toContain('不可收藏的候选');
});
it('旧时间线收藏保留且可再恢复，不带旧撤回链', async () => {
  await turns(5); const old = await repo.load('save-a'), node = await repo.history.create('save-a', '旧未来');
  const preview = await repo.history.preview('save-a', await oldest());
  await repo.history.restore(preview.confirmation, '新分支行动', true, true);
  const list = await repo.history.list('save-a'); expect(list.nodes).toHaveLength(1); expect(list.nodes[0].oldTimeline).toBe(true);
  const later = await repo.history.preview('save-a', { kind: 'manual', id: node.id }); expect(later.state).toEqual(old);
  const fresh = await repo.history.restore(later.confirmation, '再选择', true, true);
  expect(fresh.state.turnNumber).toBe(5); expect((await repo.undoStatus('save-a')).available).toBe(0);
  expect((await repo.history.list('save-a')).nodes).toHaveLength(1);
});
it.each(['saves', 'drafts', 'saveControls', 'historyMetadata'] as const)('确认后 %s 改变，严格拒绝覆盖', async store => {
  await turns(3); const node = await repo.history.create('save-a', '节点');
  const preview = await repo.history.preview('save-a', { kind: 'manual', id: node.id });
  if (store === 'saves') { const state = await repo.load('save-a'); await edit(store, s => s.put({ ...state, environmentText: '不提升 revision 的合法变更' })); }
  else if (store === 'drafts') { const game = await repo.loadGame('save-a'); await repo.bindTurnAction(game.draft!, '另一标签操作', true, true); }
  else if (store === 'historyMetadata') await repo.history.rename('save-a', node.id, '更名');
  else { const game = await repo.loadGame('save-a'); await repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: 'elsewhere' }); }
  const before = await raw(); await expect(repo.history.restore(preview.confirmation, '新的输入', true, true)).rejects.toMatchObject({ code: 'HISTORY_CONFLICT' });
  expect(await raw()).toEqual(before);
});
it('跨连接重复确认最多成功一次，旧草稿、回执和记忆 lineage 不能复活', async () => {
  await turns(3);
  await repo.bindTurnAction((await repo.loadGame('save-a')).draft!, '旧时间线行动', true, true);
  const stale = await completeDraft(repo, { variables: await elapsedVariables(repo, '旧候选时间', 60) });
  const context = await repo.loadMemoryContext('save-a');
  const second = await SaveRepository.open('history', factory);
  try {
    const firstPreview = await repo.history.preview('save-a', await oldest()), otherPreview = await second.history.preview('save-a', await oldest());
    const results = await Promise.allSettled([repo.history.restore(firstPreview.confirmation, '一', true, true), second.history.restore(otherPreview.confirmation, '二', true, true)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const restored = await raw();
    await expect(repo.commitTurn(submission(stale, ''))).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(repo.checkMemoryLineage(context.lineage)).rejects.toMatchObject({ code: 'MEMORY_TIMELINE_CHANGED' });
    await expect(repo.saveDraft(rerollStory(stale, { turnKind: 'regular', narrative: '迟到旧正文', summary: '', variableGuide: [] }), stale.draftRevision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await raw()).toEqual(restored);
  } finally { second.close(); }
});
it('恢复写入失败整个事务回滚，手动收藏与未来自动节点不被预删', async () => {
  await turns(3); await repo.history.create('save-a', '保留');
  const preview = await repo.history.preview('save-a', await oldest()), before = await raw(), list = await repo.history.list('save-a');
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === 'drafts') throw new DOMException('mock quota', 'QuotaExceededError'); return original.apply(this, args);
  });
  await expect(repo.history.restore(preview.confirmation, '输入', true, true)).rejects.toThrow(); vi.restoreAllMocks();
  expect(await raw()).toEqual(before); expect(await repo.history.list('save-a')).toEqual(list);
});
it('收藏配额失败不留元数据孤儿，不删除任何已有节点', async () => {
  await turns(2); await repo.history.create('save-a', '原节点'); const before = await raw(), list = await repo.history.list('save-a');
  const original = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === 'historyPayloads') throw new DOMException('mock quota', 'QuotaExceededError'); return original.apply(this, args);
  });
  await expect(repo.history.create('save-a', '空间不足')).rejects.toThrow(); vi.restoreAllMocks();
  expect(await raw()).toEqual(before); expect(await repo.history.list('save-a')).toEqual(list);
});
it('压缩损坏、尺寸异常和解压膨胀被拒绝；无压缩 API 安全保存 JSON', async () => {
  const state = worldState(), payload = await encodeHistory(state);
  expect(await decodeHistory(payload)).toEqual(state);
  await expect(decodeHistory({ ...payload, rawBytes: maxHistoryBytes + 1 })).rejects.toThrow();
  await expect(decodeHistory({ ...payload, rawBytes: 1 })).rejects.toThrow();
  await expect(decodeHistory({ ...payload, digest: '0'.repeat(64) })).rejects.toThrow();
  vi.stubGlobal('CompressionStream', undefined);
  const plain = await encodeHistory(state); expect(plain.encoding).toBe('json'); expect(await decodeHistory(plain)).toEqual(state);
});
it('开局不能制造正式历史；预览状态被调用方改写不能改变恢复权威数据', async () => {
  await expect(repo.history.create('save-a', '未开局')).rejects.toMatchObject({ code: 'HISTORY_OPENING' });
  await turns(3); const preview = await repo.history.preview('save-a', await oldest()), cash = preview.state.economy.cash;
  preview.state.economy.cash = 999999;
  const result = await repo.history.restore(preview.confirmation, '继续', true, true); expect(result.state.economy.cash).toBe(cash);
});
it('同页已有请求或浏览器没有 Web Locks，拒绝覆盖且不改任何数据', async () => {
  await turns(3); const preview = await repo.history.preview('save-a', await oldest()), before = await raw();
  const session = reserveStageSession('save-a');
  await expect(repo.history.restore(preview.confirmation, '禁止并发', true, true)).rejects.toMatchObject({ code: 'STORY_BUSY' }); session.release();
  const fresh = await repo.history.preview('save-a', await oldest());
  vi.stubGlobal('window', {}); vi.stubGlobal('navigator', {});
  await expect(repo.history.restore(fresh.confirmation, '无锁', true, true)).rejects.toMatchObject({ code: 'concurrency_unavailable' });
  expect(await raw()).toEqual(before);
});
it('旧自动描述符无新摘要仍可读，升级 V4 不清空存档或撤回链', async () => {
  await turns(3); const before = await raw(), control = before.records.saveControls![0].value as { records: object[] };
  await edit('saveControls', s => s.put({ ...control, records: control.records.map(entry => { const row = { ...entry } as { summary?: unknown }; delete row.summary; return row; }) }));
  const preview = await repo.history.preview('save-a', await oldest()); expect(preview.state.turnNumber).toBe(1);
  expect(saveDatabaseVersion).toBe(5);
});
it('删除正式存档原子删除关联收藏；导入同 ID 备份保留收藏但标记旧时间线', async () => {
  await turns(3); await repo.history.create('save-a', '收藏');
  const entry = (await repo.exportBackup(['save-a']))[0], comparison = await repo.compareBackup(entry);
  await repo.importBackup(entry, comparison.confirmation, { overwrite: true });
  expect((await repo.history.list('save-a')).nodes[0].oldTimeline).toBe(true);
  const game = await repo.loadGame('save-a'); await repo.delete('save-a', game.state.revision, game.instance);
  await repo.create(worldState()); expect((await repo.history.list('save-a')).nodes).toEqual([]);
});
it('真实 V4 数据库升级保留五仓库全部字节语义；旧连接关闭且不能重新打开 V4', async () => {
  await turns(4); const records = (await raw()).records, legacyFactory = new IDBFactory();
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = legacyFactory.open('legacy-v4', 4);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of ['saves', 'drafts', 'saveControls']) db.createObjectStore(name, { keyPath: 'saveId' });
      for (const name of ['turnUndo', 'turnReceipts']) db.createObjectStore(name, { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
    };
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = legacy.transaction(['saves', 'drafts', 'saveControls', 'turnUndo', 'turnReceipts'], 'readwrite');
    for (const [name, entries] of Object.entries(records)) for (const entry of entries!) tx.objectStore(name).put(entry.value);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  legacy.onversionchange = () => legacy.close();
  const upgraded = await SaveRepository.open('legacy-v4', legacyFactory);
  try {
    expect((await upgraded.exportRaw('save-a')).records).toEqual(records);
    expect((await upgraded.history.list('save-a')).nodes).toHaveLength(3);
    expect((await upgraded.history.preview('save-a', (await upgraded.history.list('save-a')).nodes[0])).state.turnNumber).toBe(1);
    await expect(new Promise((resolve, reject) => { const open = legacyFactory.open('legacy-v4', 4); open.onerror = () => reject(open.error); open.onsuccess = () => { open.result.close(); resolve(undefined); }; })).rejects.toMatchObject({ name: 'VersionError' });
  } finally { upgraded.close(); }
});
it('新增自动历史仍严格受 64 MiB 限制，超额不会伪造可读节点', async () => {
  await turns(2); const state = await repo.load('save-a');
  // Existing undo policy counts UTF-8 snapshot bytes; this synthetic payload exceeds 64 MiB.
  state.protagonist.background = 'x'.repeat(64 * 1024 * 1024);
  await edit('saves', store => store.put(state));
  await turn();
  expect((await repo.undoStatus('save-a')).available).toBe(0);
  expect((await repo.undoStatus('save-a')).notice).toBe('budget');
  expect((await repo.history.list('save-a')).nodes).toEqual([]);
}, 30000); // Real 64 MiB cloning/validation, not a latency benchmark; keep all budget assertions.
it('导入较早备份后仍可恢复高版本收藏，不降低历史 journal 的版本约束', async () => {
  await turns(2); const backup = (await repo.exportBackup(['save-a']))[0];
  await turns(5); const manual = await repo.history.create('save-a', '较晚收藏');
  await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation, { overwrite: true });
  const preview = await repo.history.preview('save-a', { kind: 'manual', id: manual.id });
  const restored = await repo.history.restore(preview.confirmation, '继续这份收藏', true, true);
  expect(restored.state.revision).toBeGreaterThan(preview.state.revision);
  expect(restored.state.journal).toEqual(preview.state.journal); await turn();
  expect((await repo.load('save-a')).turnNumber).toBe(8);
});
it('正式世界私密七字段和休眠档案压缩往返完全一致；未知未来格式拒绝', async () => {
  const { fullPrivateProfile } = await import('./fixtures/npcUnified');
  const { hibernateNpcProfile } = await import('../domain/npc/profiles');
  await turns(2); const state = await repo.load('save-a');
  state.npc['npc-a'] = { ...state.npc['npc-a'], kind: 'special', age: 30, gender: 'female', detailedBackground: '合成专属背景',
    activeGoals: [], habits: [], longTermMemories: [], offscreenTaskIds: [], privateProfile: fullPrivateProfile };
  const payload = await encodeHistory(state); expect(await decodeHistory(payload)).toEqual(state);
  const dormant = hibernateNpcProfile(state, 'npc-a', state.npc['npc-a'].identityKey);
  expect(await decodeHistory(await encodeHistory(dormant))).toEqual(dormant);
  await expect(decodeHistory({ ...payload, version: 2 } as unknown as typeof payload)).rejects.toThrow();
});
