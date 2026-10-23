import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiConfigSchema, defaultAiConfig, newChannel, readAiConfig, removeChannel, saveAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { CredentialVault } from '../services/ai/credentials';
import { AiClient } from '../services/ai/client';
import { resolveModelRoute, requestSnapshot } from '../services/ai/snapshot';
import { requestInspections } from '../services/ai/inspection';
import { planCompression, parseCompression, sourceUnion, applyCompression } from '../domain/memories/compression';
import { MemoryMaintenance, browserMemoryLock } from '../workflows/memoryMaintenance';
import type { MemoryLock } from '../workflows/memoryMaintenance';
import { compressionState } from './fixtures/compression';
import { completeDraft, submission, elapsedVariables } from './fixtures/turn';
import { storyMemoryContext, publicShortMemories } from '../domain/memories/publicMemory';
import { composePrompt } from '../prompts/composer';
import { record, array } from '../services/ai/protocols';
import type { GameState } from '../domain/state';

const output = { entries: [{ text: '已经发生的事实、承诺和修正过程已按先后保留。' }], unresolved: [], contradictions: [] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); requestInspections.clear(); });
function setup(protocol: Protocol = 'openai') {
  const store = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  };
  const config = defaultAiConfig(), channel = newChannel(protocol), vault = new CredentialVault(store(), store());
  config.channels = [channel]; channel.defaultModel = 'default-model';
  config.routes.story = { channelId: channel.id, modelId: 'story-model' };
  config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'memory-model' };
  vault.set(channel.id, 'test-memory-secret');
  return { config, vault, channel };
}
const locks = new Set<string>();
const lock: MemoryLock = async (id, work) => {
  if (locks.has(id)) throw new Error('busy');
  locks.add(id); try { return await work(); } finally { locks.delete(id); }
};
async function seeded(state: GameState = compressionState(), factory = new IDBFactory()) {
  const repo = await SaveRepository.open('compression', factory);
  const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('compression'); req.onsuccess = () => resolve(req.result); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close(); return repo;
}
function wire(protocol: Protocol, text = JSON.stringify(output)) {
  return Response.json(protocol === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 10, totalTokenCount: 50 } }
    : protocol === 'anthropic'
      ? { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 40, output_tokens: 10 } }
      : { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } });
}

describe('记忆模型路由及旧配置兼容', () => {
  it('旧配置无memory时默认跟随正文，不丢其他路由/参数；保存读取和删除渠道正常', () => {
    const { config, channel } = setup();
    const legacy = { ...config, routes: { story: config.routes.story, variables: config.routes.variables, world: config.routes.world } };
    const store = new Map<string, string>(), storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    storage.setItem('heijin.ai.v1', JSON.stringify(legacy));
    const read = readAiConfig(storage);
    expect(read.routes.memory).toEqual({ mode: 'follow-story' });
    expect(resolveModelRoute(read, 'memory').model).toBe('story-model');
    expect(read.channels).toEqual(config.channels);
    expect(AiConfigSchema.parse(legacy).routes.story).toEqual(config.routes.story);
    saveAiConfig(storage, config);
    expect(readAiConfig(storage).routes.memory).toEqual(config.routes.memory);
    const removed = removeChannel(config, channel.id);
    expect(removed.routes.memory).toEqual({ mode: 'follow-story' });
    expect(removed.channels).toHaveLength(0);
  });
  it('独立模型冻结路由、参数和凭证；失败不回退', () => {
    const { config, vault, channel } = setup();
    const snapshot = requestSnapshot(config, 'memory', vault);
    config.routes.memory = { mode: 'follow-story' }; channel.parameters.temperature = 1.2;
    vault.set(channel.id, 'changed-secret');
    expect(snapshot.model).toBe('memory-model');
    expect(snapshot.channel.parameters.temperature).toBeUndefined();
    expect(snapshot.stage).toBe('memory'); expect(snapshot.useCot).toBe(false);
  });
  it('旧设置无自动维护字段默认关闭，不改即时窗口或七项写作设置', () => {
    const settings = defaultSettings();
    const legacy = { ...settings, memory: { immediateWindowSize: 20 } };
    const read = SettingsSchema.parse(legacy);
    expect(read.memory).toEqual({ immediateWindowSize: 20, automaticMaintenance: false });
    expect(read.prompts).toEqual(settings.prompts);
  });
});

describe('批次、预算和输出确定性', () => {
  it.each([['short', 30], ['medium', 50]] as const)('%s 阈值=%s不触发，超过后选最早10条', (layer, threshold) => {
    expect(planCompression(compressionState(layer, threshold))).toBeUndefined();
    const batch = planCompression(compressionState(layer, threshold + 1))!;
    expect(batch.layer).toBe(layer); expect(batch.entries.map((entry) => entry.id)).toEqual(Array.from({ length: 10 }, (_, index) => `memory-${index + 1}`));
    const result = parseCompression(JSON.stringify(output), batch, 'new-summary');
    expect(result.sourceTurnIds).toEqual(sourceUnion(batch.entries));
    expect(result.createdAtGameTime).toBe(batch.entries[0].createdAtGameTime);
    expect(result.affectedEntityRefs).toEqual([{ kind: 'npc', id: 'npc-a' }]);
    expect(result.visibility).toBe('player_known');
  });
  it('预算只减少批次，不截断条目/来源；首条太长则拒绝且不计入旧档只读摘要', () => {
    const state = compressionState();
    state.memories.short.forEach((entry) => { entry.text = '事实'.repeat(1500); });
    const batch = planCompression(state)!;
    expect(batch.entries.length).toBeGreaterThanOrEqual(2); expect(batch.entries.length).toBeLessThan(10);
    expect(batch.entries[0].text).toBe(state.memories.short[0].text);
    state.memories.short[0].text = '事实'.repeat(20000);
    expect(() => planCompression(state)).toThrow();
    state.memories.short = [];
    expect(publicShortMemories(state).length).toBe(31); expect(planCompression(state)).toBeUndefined();
  });
  it.each([
    '{broken',
    JSON.stringify({ ...output, entries: [{ text: '摘要', sourceTurnIds: ['invented'] }] }),
    JSON.stringify({ ...output, entries: [{ text: '摘要', createdAtGameTime: '2099-01-01T00:00:00Z' }] }),
    JSON.stringify({ ...output, entries: [{ text: '摘要', affectedEntityRefs: ['npc-private'] }] }),
    JSON.stringify({ ...output, entries: [{ text: '摘要', visibility: 'internal' }] }),
    JSON.stringify({ ...output, unresolved: ['债务金额不明'] }),
    JSON.stringify({ ...output, contradictions: ['两项重要事实无法解释'] }),
    JSON.stringify({ ...output, entries: [{ text: '' }] }),
  ])('非法或未解决输出拒绝，不生成可信MemoryEntry：%s', (text) => {
    expect(() => parseCompression(text, planCompression(compressionState())!, 'new')).toThrow();
  });
  it('仅存储的公开且时间/来源可信的记忆可入批，部分已覆盖来源不重复收费', () => {
    const state = compressionState('short', 36);
    state.memories.short[0].visibility = 'internal';
    state.memories.short[1].visibility = 'npc_private';
    state.memories.short[2].createdAtGameTime = '2099-01-01T00:00:00Z';
    state.memories.short[3].sourceTurnIds = ['not-a-turn'];
    state.memories.short[4].sourceTurnIds = [];
    state.memories.medium = [{ ...state.memories.short[5], id: 'already-covered' }];
    expect(planCompression(state)).toBeUndefined(); // 仅30条可信条目。
    state.memories.short.push({ ...state.memories.short[6], id: 'still-active' });
    const batch = planCompression(state)!;
    for (const id of ['memory-1', 'memory-2', 'memory-3', 'memory-4', 'memory-5', 'memory-6'])
      expect(batch.entries.map((entry) => entry.id)).not.toContain(id);
    expect(batch.entries[0].sourceTurnIds).toEqual(['history-7']);
  });
  it('来源、引用、时间和可见性不能在写库边界被替换', () => {
    const state = compressionState(), batch = planCompression(state)!, result = parseCompression(JSON.stringify(output), batch, 'new');
    for (const changed of [{ ...result, sourceTurnIds: ['history-1'] }, { ...result, sourceTurnIds: [...result.sourceTurnIds, 'invented'] },
      { ...result, createdAtGameTime: '2099-01-01T00:00:00Z' }, { ...result, affectedEntityRefs: [{ kind: 'npc' as const, id: 'missing' }] }])
      expect(() => applyCompression(state, batch, changed)).toThrow();
    expect(() => applyCompression(state, { ...batch, journalProofs: batch.journalProofs.map(() => batch.journalProofs[0]) }, result)).toThrow();
  });
});

describe('真实AI Client + 公开批次请求 + 原子记忆维护', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s 独立请求/统计/脱敏，短→中后来源只保存一次', async (protocol) => {
    const before = compressionState(), repo = await seeded(before), { config, vault } = setup(protocol);
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).not.toMatch(/私有调查|身份秘密|test-memory-secret|SAVE_STATE/);
      return wire(protocol);
    });
    const runner = new MemoryMaintenance(repo, new AiClient(transport), lock);
    try {
      const result = await runner.run({ saveId: before.saveId, config, vault, timeoutSeconds: 10 });
      expect(result!.memories.short).toHaveLength(21); expect(result!.memories.medium).toHaveLength(1);
      expect({ ...result, memories: before.memories }).toEqual(before);
      expect(result!.memories.medium[0].sourceTurnIds).toHaveLength(10);
      expect(await runner.run({ saveId: before.saveId, config, vault, timeoutSeconds: 10 })).toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(1);
      const inspection = requestInspections.getSnapshot()[0];
      expect(inspection.stage).toBe('memory'); expect(inspection.scope?.kind).toBe('memory');
      expect(inspection.statistics.actual.inputTokens).toBe(40); expect(inspection.statistics.actual.outputTokens).toBe(10);
      expect(JSON.stringify(inspection)).not.toContain('test-memory-secret');
      expect(await repo.load(before.saveId)).toEqual(result);
    } finally { repo.close(); }
  });
  it('中→长实际持久化，永久原文与草稿不变', async () => {
    const state = compressionState('medium'), repo = await seeded(state), { config, vault } = setup();
    try {
      const result = await new MemoryMaintenance(repo, new AiClient(async () => wire('openai')), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 });
      expect(result!.memories.medium).toHaveLength(41); expect(result!.memories.long).toHaveLength(1);
      expect(result!.journal).toEqual(state.journal); expect(result!.revision).toBe(state.revision);
      expect(await repo.loadDraft(state.saveId)).toBeUndefined();
    } finally { repo.close(); }
  });
  it.each([401, 429, 503])('HTTP %s 不回退、不自动重试或删除记忆', async (status) => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    const transport = vi.fn(async () => new Response('', { status }));
    try {
      await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 })).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1); expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it('写库失败整体回滚，已确认回合不回滚，原始摘要不提前删除', async () => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    try {
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
      await expect(new MemoryMaintenance(repo, new AiClient(async () => wire('openai')), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 })).rejects.toThrow();
      expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it('维护期间继续正式游玩：合并最新状态，不改变revision或当前合法草稿', async () => {
    const repo = await seeded(), { config, vault } = setup();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const runner = new MemoryMaintenance(repo, new AiClient(async () => { started(); await hold; return wire('openai'); }), lock);
    try {
      const pending = runner.run({ saveId: 'save-a', config, vault, timeoutSeconds: 10 });
      await ready;
      const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '经过十分钟，主角完成用餐。', 600) });
      const committed = await repo.commitTurn(submission(draft));
      release(); const result = await pending;
      expect(result!.revision).toBe(32); expect(result!.turnNumber).toBe(32);
      expect(result!.journal).toEqual(committed.state.journal);
      expect(result!.memories.short).toHaveLength(22);
      expect(await repo.loadDraft('save-a')).toEqual(committed.draft);
      expect({ ...result, memories: committed.state.memories }).toEqual(committed.state);
      expect((await repo.commitTurn(submission(draft))).replayed).toBe(true);
    } finally { release(); repo.close(); }
  });
  it('同批跨执行器/重复触发仅一次付费，取消/迟到结果不写入', async () => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; }), hold = new Promise<void>((resolve) => { release = resolve; });
    const transport = vi.fn(async () => { started(); await hold; return wire('openai'); });
    const runner = new MemoryMaintenance(repo, new AiClient(transport), lock);
    try {
      const pending = runner.run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      await ready;
      await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 })).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(runner.cancel()).toBe(true); await rejected;
      release(); await Promise.resolve(); expect(await repo.load(state.saveId)).toEqual(state);
    } finally { release(); repo.close(); }
  });
  it.each(['{broken', JSON.stringify({ ...output, unresolved: ['承诺结果无法确认'] }), JSON.stringify({ ...output, entries: [{ text: 'test-memory-secret' }] }), JSON.stringify({ ...output, entries: [{ text: 'test-memory-secret' }] }).replace('test-memory-secret', '\\u0074est-memory-secret')])('非法响应不污染存档：%s', async (text) => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    try {
      await expect(new MemoryMaintenance(repo, new AiClient(async () => wire('openai', text)), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 })).rejects.toThrow();
      expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it('维护期间来源被修改则拒绝迟到结果，保留更新后的数据', async () => {
    const factory = new IDBFactory(), state = compressionState(), repo = await seeded(state, factory), { config, vault } = setup();
    const changed = compressionState(); changed.memories.short[0].text = '另一维护操作修正了来源';
    const transport = async () => {
      const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('compression'); req.onsuccess = () => resolve(req.result); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(changed); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      db.close(); return wire('openai');
    };
    try {
      await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run({ saveId: 'save-a', config, vault, timeoutSeconds: 10 })).rejects.toMatchObject({ code: 'MEMORY_CONFLICT' });
      expect(await repo.load('save-a')).toEqual(changed);
    } finally { repo.close(); }
  });
  it('超时不删来源、不自动重试；默认跟随正文的模型用于真实请求', async () => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    config.routes.memory = { mode: 'follow-story' };
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(record(JSON.parse(String(init?.body))).model).toBe('story-model');
      return new Promise<Response>(() => {});
    });
    try {
      await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 0.01 })).rejects.toMatchObject({ code: 'timeout' });
      expect(transport).toHaveBeenCalledTimes(1); expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it('保存阶段不可虚假取消；含凭证的公开输入在发请求前被拒绝', async () => {
    const state = compressionState(), repo = await seeded(state), { config, vault } = setup();
    const runner = new MemoryMaintenance(repo, new AiClient(async () => wire('openai')), lock);
    try {
      await runner.run({ saveId: state.saveId, config, vault, timeoutSeconds: 10, onPhase: (phase) => { if (phase === 'saving') expect(runner.cancel()).toBe(false); } });
    } finally { repo.close(); }
    state.memories.short[0].text = '误存的test-memory-secret';
    const secretRepo = await seeded(state), transport = vi.fn(async () => wire('openai'));
    try {
      await expect(new MemoryMaintenance(secretRepo, new AiClient(transport), lock).run({ saveId: state.saveId, config, vault, timeoutSeconds: 10 })).rejects.toMatchObject({ code: 'MEMORY_PERMISSION' });
      expect(transport).not.toHaveBeenCalled(); expect(await secretRepo.load(state.saveId)).toEqual(state);
    } finally { secretRepo.close(); }
  });
  it('无安全Web Locks时明确拒绝，不静默付费', async () => {
    vi.stubGlobal('navigator', { locks: undefined });
    await expect(browserMemoryLock('save', async () => 'should-not-run')).rejects.toMatchObject({ code: 'MEMORY_LOCK_UNAVAILABLE' });
  });
});

describe('真实Composer保留部分重叠的整条上层摘要', () => {
  it.each([1, 10, 20])('N=%s：1～30摘要与最近窗口重叠时，保留整条语义及明确来源范围', async (size) => {
    const state = compressionState('short', 35), batch = planCompression(state)!;
    const source = state.journal.slice(0, 30).map((entry) => entry.turnId);
    state.memories.short = state.memories.short.slice(30);
    state.memories.medium = [{ ...parseCompression(JSON.stringify(output), batch, 'mid-1-30'), sourceTurnIds: source, text: '第1至30回合的重要承诺与因果，不可遗失。' }];
    const settings = defaultSettings(); settings.memory.immediateWindowSize = size;
    const { context } = await composePrompt({ stage: 'story', mode: 'regular', state, settings, userInput: '' });
    const memory = record(context.MEMORY_CONTEXT), summaries = array(memory.summaries).map(record);
    const mid = summaries.filter((entry) => entry.id === 'mid-1-30');
    expect(mid).toHaveLength(1); expect(mid[0].text).toBe(state.memories.medium[0].text);
    expect(mid[0].sourceTurnIds).toEqual(source);
    expect(array(mid[0].overlappingSourceTurnIds)).toHaveLength(Math.max(0, size - 5));
    expect(array(mid[0].uncoveredSourceTurnIds)).toHaveLength(30 - Math.max(0, size - 5));
    expect(array(memory.recentTurns)).toHaveLength(size);
    expect(storyMemoryContext(state, size, '', true).summaries.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(6000);
  });
});

it('long和medium部分重叠保留各自完整语义；完全覆盖short不复活，高层超预算明确省略', () => {
  const state = compressionState('short', 40), original = state.memories.short[0];
  state.memories.long = [{ ...original, id: 'long', text: '第1到20回合的重大转折', sourceTurnIds: state.journal.slice(0, 20).map((turn) => turn.turnId) }];
  state.memories.medium = [{ ...original, id: 'medium', text: '第1到30回合的因果与承诺', sourceTurnIds: state.journal.slice(0, 30).map((turn) => turn.turnId) }];
  const memory = storyMemoryContext(state, 1, '', false);
  expect(memory.summaries.filter((entry) => entry.id === 'long')).toHaveLength(1);
  const mid = memory.summaries.find((entry) => entry.id === 'medium')!;
  expect(mid.text).toBe(state.memories.medium[0].text); expect(mid.overlappingSourceTurnIds).toHaveLength(20); expect(mid.uncoveredSourceTurnIds).toHaveLength(10);
  expect(publicShortMemories(state)).toHaveLength(10);
  state.memories.long[0].text = '历史'.repeat(4000);
  const limited = storyMemoryContext(state, 1, '', false);
  expect(limited.omittedSummaryIds).toContain('long'); expect(state.memories.long[0].text).toHaveLength(8000);
});

it('大量来源元数据也受上下文预算约束，不截断永久来源', () => {
  const state = compressionState('short', 1000);
  const sources = state.journal.slice(0, -1).map((turn) => turn.turnId);
  state.memories.long = [{ ...state.memories.short[0], id: 'many-sources', text: '来源完整的长期历史', sourceTurnIds: sources }];
  const context = storyMemoryContext(state, 1, '', false);
  expect(JSON.stringify(context.summaries).length).toBeLessThanOrEqual(20000);
  expect(context.omittedSummaryIds).toContain('many-sources');
  expect(state.memories.long[0].sourceTurnIds).toEqual(sources);
});
