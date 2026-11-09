import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { worldState } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { rerollStory } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { compressionState } from './fixtures/compression';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { parseCompression, planCompression } from '../domain/memories/compression';
import { parseNpcSummary, planNpcSummary } from '../domain/memories/npcMemory';
import { MemoryMaintenance } from '../workflows/memoryMaintenance';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { undoPolicy } from '../services/storage/turnUndo';
import { gameTime, purchase, task, event } from './fixtures/game';
import { npcUpdate, worldResult } from './fixtures/world';

let repo: SaveRepository, factory: IDBFactory;
beforeEach(async () => {
  factory = new IDBFactory(); repo = await SaveRepository.open('undo', factory);
  await repo.create(worldState());
});
afterEach(() => { vi.restoreAllMocks(); repo.close(); });
async function turn(action = '') {
  const game = await repo.loadGame('save-a');
  if (game.draft && action) await repo.bindTurnAction(game.draft, action, true, true);
  const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '继续日常生活', 60) });
  return repo.commitTurn(submission(draft, ''));
}
async function undo(operationId = crypto.randomUUID()) {
  const game = await repo.loadGame('save-a');
  return repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision,
    expectedDraft: game.draft, operationId });
}
async function rawWrite(store: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('undo');
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    }; open.onerror = () => reject(open.error);
  });
}
async function memoryGame() {
  const state = compressionState(); state.npc = npcMemoryState(31).npc;
  await rawWrite('saves', GameStateSchema.parse(state));
  return state;
}
const summaryText = JSON.stringify({ summary: '保留这些经历与约定。', importantEvents: ['依照原记忆的时间与结果。'] });
function memoryConfig() {
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'mock'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'mock' };
  const values = new Map<string, string>(), store = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'test-undo-key');
  return { config, vault, saveId: 'save-a', timeoutSeconds: 10 };
}
it('完整恢复前回合，原输入持久回填，消费快照并保留单一时间线', async () => {
  const first = await turn(); const second = await turn('去公园散步');
  expect((await repo.undoStatus('save-a')).available).toBe(1);
  const result = await undo();
  expect(result.state).toEqual({ ...first.state, revision: second.state.revision + 1, updatedAt: result.state.updatedAt });
  expect(result.draft.userInput).toBe('');
  expect(result.draft.turnId).not.toBe(second.draft.turnId);
  expect(result.input).toBe('去公园散步');
  expect(await repo.undoStatus('save-a')).toMatchObject({ available: 0, input: '去公园散步', memoryPaused: true });
  await expect(undo()).rejects.toThrow();
  expect((await repo.exportRaw('save-a')).records.turnReceipts).toHaveLength(0);
});
it('连续五次撤回，窗口安全滑动且重新打开仍可用', async () => {
  for (let i = 0; i < 8; i++) await turn(`行动${i}`);
  repo.close(); repo = await SaveRepository.open('undo', factory);
  expect((await repo.undoStatus('save-a')).available).toBe(5);
  for (let i = 7; i >= 3; i--) {
    const result = await undo(); expect(result.input).toBe(`行动${i}`);
    expect(result.state.turnNumber).toBe(i);
  }
  expect((await repo.undoStatus('save-a')).available).toBe(0);
  await expect(undo()).rejects.toThrow();
});
it('撤回重放同一操作不再弹出一层；旧提交不能复活，发送创建新时间线', async () => {
  await turn(); await turn('旧行动'); await turn('另一个行动');
  const before = await repo.loadGame('save-a');
  const command = { saveId: 'save-a', expectedRevision: before.state.revision, expectedDraft: before.draft, operationId: 'undo-once' };
  const result = await repo.undoTurn(command);
  expect(await repo.undoTurn(command)).toEqual({ ...result, replayed: true });
  const fresh = await turn('新的选择');
  expect(fresh.state.journal.some(entry => entry.turnId === before.state.journal.at(-1)!.turnId)).toBe(false);
  expect((await repo.undoStatus('save-a')).input).toBe('');
});
it('跨连接版本竞争只允许一次撤回', async () => {
  await turn(); await turn('甲'); await turn('乙');
  const second = await SaveRepository.open('undo', factory), game = await repo.loadGame('save-a');
  try {
    const args = { saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft };
    const results = await Promise.allSettled([repo.undoTurn({ ...args, operationId: 'one' }), second.undoTurn({ ...args, operationId: 'two' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.load('save-a')).turnNumber).toBe(2);
  } finally { second.close(); }
});
it('开局、无恢复点旧档不伪造撤回能力', async () => {
  expect((await repo.undoStatus('save-a')).available).toBe(0);
  await turn(); expect((await repo.undoStatus('save-a')).available).toBe(0);
  await expect(undo()).rejects.toThrow();
});
it('撤回事务故障完整回滚，包括世界、草稿、回执和快照', async () => {
  await turn(); await turn('失败事务');
  const before = await repo.exportRaw('save-a'), original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'drafts') throw new DOMException('mock failure', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await expect(undo()).rejects.toThrow(); vi.restoreAllMocks();
  expect(await repo.exportRaw('save-a')).toEqual(before);
});
it('未结算草稿只能按确认时的精确版本丢弃，迟到阶段结果不能写回', async () => {
  await turn(); await turn('已有行动');
  const game = await repo.loadGame('save-a'), stale = game.draft!;
  const bound = await repo.bindTurnAction(stale, '未完成的尝试', true, true);
  const partial = await repo.saveDraft(rerollStory(bound, { turnKind: 'regular', narrative: '未结算正文', summary: '草稿', variableGuide: [] }), bound.draftRevision);
  await expect(repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: stale, operationId: 'stale' })).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  const result = await undo(); expect(result.draft.story).toBeUndefined(); expect(result.input).toBe('已有行动');
  await expect(repo.saveDraft({ ...partial, draftRevision: partial.draftRevision + 1 }, partial.draftRevision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
});
it('旧的完整提交内容在撤回与重新生成后均不能写回', async () => {
  await turn();
  const game = await repo.loadGame('save-a'); await repo.bindTurnAction(game.draft!, '将被撤回', true, true);
  const candidate = await completeDraft(repo, { variables: await elapsedVariables(repo, '原行动', 60) });
  const request = submission(candidate, ''); await repo.commitTurn(request); await undo();
  await expect(repo.commitTurn(request)).rejects.toThrow();
  const newResult = await turn('替代行动');
  await expect(repo.commitTurn(request)).rejects.toThrow(); expect(await repo.load('save-a')).toEqual(newResult.state);
});
it('回填编辑持久保存，连续撤回替换输入；旧输入写入不能覆盖新草稿', async () => {
  await turn(); await turn('原行动一'); await turn('原行动二');
  const first = await undo(); await repo.saveUndoInput(first.draft, '编辑后的选择');
  repo.close(); repo = await SaveRepository.open('undo', factory);
  expect((await repo.undoStatus('save-a')).input).toBe('编辑后的选择');
  const second = await undo(); expect(second.input).toBe('原行动一');
  await expect(repo.saveUndoInput(first.draft, '迟到输入')).rejects.toThrow();
  expect((await repo.undoStatus('save-a')).input).toBe('原行动一');
});
it.each(['short', 'npc'] as const)('%s：来源仍存在，撤回前的总结也必须因 epoch 失效而拒绝', async kind => {
  await memoryGame(); await turn();
  const context = await repo.loadMemoryContext('save-a');
  const publicBatch = planCompression(context.state)!, npcBatch = planNpcSummary(context.state, 'npc-a')!;
  const output = parseCompression(summaryText, publicBatch, 'summary-late');
  const npcOutput = parseNpcSummary(JSON.stringify(npcSummaryOutput(npcBatch)), npcBatch, 'npc-summary-late');
  const restored = await undo();
  if (kind === 'short') await expect(repo.saveMemoryCompression(publicBatch, output, context.lineage)).rejects.toMatchObject({ code: 'MEMORY_TIMELINE_CHANGED' });
  else await expect(repo.saveNpcSummary(npcBatch, npcOutput, context.lineage)).rejects.toMatchObject({ code: 'MEMORY_TIMELINE_CHANGED' });
  expect(await repo.load('save-a')).toEqual(restored.state);
});
it('真实 MemoryMaintenance 请求迟到，且重新加载时自动总结不再调用网络', async () => {
  await memoryGame(); await turn();
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const transport = vi.fn(async () => { await hold; return Response.json({ choices: [{ message: { content: summaryText } }] }); });
  const runner = new MemoryMaintenance(repo, new AiClient(transport), async (_id, work) => work());
  const pending = runner.run({ ...memoryConfig(), kind: 'short', automatic: true });
  const failure = expect(pending).rejects.toMatchObject({ code: 'MEMORY_TIMELINE_CHANGED' });
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  const restored = await undo(); release(); await failure;
  const reloaded = await SaveRepository.open('undo', factory);
  try {
    const restarted = new MemoryMaintenance(reloaded, new AiClient(transport), async (_id, work) => work());
    expect(await restarted.run({ ...memoryConfig(), kind: 'short', automatic: true })).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1); expect(await reloaded.load('save-a')).toEqual(restored.state);
    await reloaded.bindTurnAction(restored.draft, '主动继续', true, true);
    expect((await reloaded.loadMemoryContext('save-a')).paused).toBe(false);
  } finally { reloaded.close(); }
});
it('提交快照包含此前已落库且没有增加 revision 的合法总结', async () => {
  await memoryGame();
  const context = await repo.loadMemoryContext('save-a'), batch = planCompression(context.state)!;
  const saved = await repo.saveMemoryCompression(batch, parseCompression(summaryText, batch, 'summary-before'), context.lineage);
  expect(saved.revision).toBe(context.state.revision);
  await turn(); const restored = await undo();
  expect(restored.state.memories).toEqual(saved.memories);
  expect(restored.state.journal).toEqual(saved.journal);
});
it('正式回合推进不误杀仍有效的总结来源', async () => {
  await memoryGame(); const context = await repo.loadMemoryContext('save-a'), batch = planCompression(context.state)!;
  await turn(); const before = await repo.load('save-a');
  const saved = await repo.saveMemoryCompression(batch, parseCompression(summaryText, batch, 'summary-regular'), context.lineage);
  expect(saved.revision).toBe(before.revision); expect(saved.memories.medium.at(-1)?.id).toBe('summary-regular');
});
it('快照写入配额失败：整批回滚后重验保存正式回合，明确无撤回能力', async () => {
  await turn(); await turn('已有恢复点');
  const original = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'turnUndo') throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  });
  const result = await turn('空间不足的回合');
  expect(result.state.turnNumber).toBe(3); expect((await repo.undoStatus('save-a'))).toMatchObject({ available: 0, notice: 'quota' });
  expect((await repo.exportRaw('save-a')).records.turnUndo).toHaveLength(0);
  vi.restoreAllMocks(); await turn('后续恢复'); expect((await repo.undoStatus('save-a')).available).toBe(1);
});
it('正式存档仍写不下时失败，不能先删除旧快照或谎报提交成功', async () => {
  await turn(); await turn('已有恢复点');
  const candidate = await completeDraft(repo, { variables: await elapsedVariables(repo, '新行动', 60) });
  const before = await repo.exportRaw('save-a'), original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'saves') throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await expect(repo.commitTurn(submission(candidate, ''))).rejects.toThrow(); vi.restoreAllMocks();
  expect(await repo.exportRaw('save-a')).toEqual(before);
});
it('数量之外也执行 64 MiB 容量边界，保留连续后缀', async () => {
  const state = worldState(); state.protagonist.background = 'x'.repeat(22 * 1024 * 1024);
  await rawWrite('saves', state);
  for (let i = 0; i < 4; i++) await turn(`大存档${i}`);
  const status = await repo.undoStatus('save-a'); expect(status.available).toBe(2); expect(status.bytes).toBeLessThanOrEqual(undoPolicy.maxBytes);
  expect((await undo()).input).toBe('大存档3'); expect((await undo()).input).toBe('大存档2');
  expect((await repo.undoStatus('save-a')).available).toBe(0);
}, 30000);
it('单份快照超过预算时仍保存正式回合并明确报告', async () => {
  const state = worldState(); state.protagonist.background = 'x'.repeat(undoPolicy.maxBytes);
  await rawWrite('saves', state); await turn(); const result = await turn('超过预算');
  expect(result.state.turnNumber).toBe(2); expect(await repo.undoStatus('save-a')).toMatchObject({ available: 0, notice: 'budget' });
}, 30000);
it('真实领域命令修改资金、物品、装备、NPC、任务、事件后整体恢复', async () => {
  const baseline = await turn(); const before = baseline.state;
  const candidate = await completeDraft(repo, { variables: { ...(await elapsedVariables(repo, '购买并穿上衣物', 600)), commands: [
    ...(await elapsedVariables(repo, '经过十分钟', 600)).commands, purchase(),
    { type: 'SetEquipment', commandId: 'wear', evidence: '穿着', equipment: { topItemId: 'shirt', accessoryItemIds: [] } },
  ] }, world: { ...worldResult([{ ...npcUpdate(), expectedRevision: before.revision }]),
    taskCommands: [{ type: 'SaveTask', commandId: 'job', evidence: '后台安排', task: { ...task(), actorRef: { kind: 'npc', id: 'npc-a' }, startAt: gameTime, dueAt: '2026-10-19T08:00:00+08:00' } }],
    eventCommands: [{ type: 'SaveEvent', commandId: 'event', evidence: '日常事件', event: { ...event(), sourceTurnIds: [baseline.draft.turnId], startAt: gameTime, estimatedEndAt: '2026-10-19T08:00:00+08:00', actorRefs: [{ kind: 'npc', id: 'npc-a' }] } }],
  } });
  const committed = await repo.commitTurn(submission(candidate, ''));
  expect(committed.state.items.shirt).toBeDefined(); expect(Object.keys(committed.state.tasks)).toHaveLength(1);
  const result = await undo();
  expect(result.state).toEqual({ ...before, revision: committed.state.revision + 1, updatedAt: result.state.updatedAt });
});
it('删除存档同时删除恢复点和控制记录，不影响其他存档', async () => {
  await turn(); await turn('删除测试');
  const other = { ...worldState(), saveId: 'save-b' }; await repo.create(other);
  const state = await repo.load('save-a'); await repo.delete('save-a', state.revision);
  expect(await repo.list()).toHaveLength(1); expect(await repo.load('save-b')).toEqual(other);
  // Reusing an ID cannot resurrect old checkpoints or lineage tokens.
  await repo.create(worldState()); expect((await repo.undoStatus('save-a')).available).toBe(0);
});
it('升级 IndexedDB v2 仅添加恢复点存储，不改 V6 存档或旧草稿', async () => {
  const oldState = compressionState(), db = await new Promise<IDBDatabase>((resolve, reject) => {
    const operation = factory.open('old-v2', 2);
    operation.onupgradeneeded = () => {
      operation.result.createObjectStore('saves', { keyPath: 'saveId' });
      operation.result.createObjectStore('drafts', { keyPath: 'saveId' });
      operation.result.createObjectStore('turnReceipts', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
    };
    operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(oldState);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); db.close();
  const upgraded = await SaveRepository.open('old-v2', factory);
  try {
    expect(await upgraded.loadGame('save-a')).toEqual({ state: oldState });
    expect(await upgraded.undoStatus('save-a')).toMatchObject({ available: 0, unavailable: 'no_history' });
    const draft = await completeDraft(upgraded, { variables: await elapsedVariables(upgraded, '旧档继续', 60) });
    const result = await upgraded.commitTurn(submission(draft, ''));
    expect((await upgraded.undoStatus('save-a')).available).toBe(1);
    const restored = await upgraded.undoTurn({ saveId: 'save-a', expectedRevision: result.state.revision, expectedDraft: result.draft, operationId: 'old-save' });
    expect(restored.state).toEqual({ ...oldState, revision: result.state.revision + 1, updatedAt: restored.state.updatedAt });
  } finally { upgraded.close(); }
});
it('快照损坏时严格拒绝恢复，不能消费原恢复点或半写世界', async () => {
  await turn(); await turn('完整性检查');
  const raw = await repo.exportRaw('save-a'), snapshot = raw.records.turnUndo![0].value as { stateJSON: string };
  await rawWrite('turnUndo', { ...snapshot, stateJSON: '{"invalid":true}' });
  const before = await repo.exportRaw('save-a');
  await expect(undo()).rejects.toThrow(); expect(await repo.exportRaw('save-a')).toEqual(before);
});
it('缺失快照链不报告可用；下次提交从新的连续恢复点开始', async () => {
  await turn(); await turn('旧一'); await turn('旧二');
  const raw = await repo.exportRaw('save-a'), control = raw.records.saveControls![0].value as { records: Array<{ turnId: string }> };
  control.records[0].turnId = 'missing-checkpoint'; await rawWrite('saveControls', control);
  expect(await repo.undoStatus('save-a')).toMatchObject({ available: 0, unavailable: 'chain' });
  await expect(undo()).rejects.toThrow(); await turn('新恢复点');
  expect((await repo.undoStatus('save-a')).available).toBe(1); expect((await undo()).input).toBe('新恢复点');
});
it('独立领域写入破坏连续回合边界时作废旧链与旧总结令牌', async () => {
  await turn(); await turn('旧回合'); const before = await repo.loadMemoryContext('save-a');
  await repo.save('save-a', before.state.revision, 'standalone', [purchase()]);
  expect(await repo.undoStatus('save-a')).toMatchObject({ available: 0, notice: 'legacy_write' });
  await expect(repo.checkMemoryLineage(before.lineage)).rejects.toMatchObject({ code: 'MEMORY_TIMELINE_CHANGED' });
});
it('原子中止恢复点删除也撤销已排队的恢复写入', async () => {
  await turn(); await turn('中止检查'); const before = await repo.exportRaw('save-a');
  const original = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
    const operation = original.call(this, key); if (this.name === 'turnUndo') this.transaction.abort(); return operation;
  });
  await expect(undo()).rejects.toThrow(); vi.restoreAllMocks(); expect(await repo.exportRaw('save-a')).toEqual(before);
});
