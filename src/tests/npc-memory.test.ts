import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import type { DomainCommand } from '../domain/commands';
import { commitCommands } from '../domain/commands';
import { NpcSummarySchema, NpcMemorySchema, npcKnowledgeKind } from '../domain/memories/schema';
import { planNpcSummary, parseNpcSummary, applyNpcSummary, npcSummaryCandidates, rawNpcMemories, npcKnowledgeContext, npcSummaryInput } from '../domain/memories/npcMemory';
import { MemoryMaintenance } from '../workflows/memoryMaintenance';
import type { MemoryLock } from '../workflows/memoryMaintenance';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { requestInspections } from '../services/ai/inspection';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { playerView } from '../ui/panels/playerView';
import { searchHistory } from '../domain/memories/history';
import { worldSources, readWorldEvidence } from '../services/validation/worldEvidence';
import { parseWorld } from '../services/validation/aiOutputs';
import { createTurnDraft } from '../domain/drafts';
import { completeDraft, submission } from './fixtures/turn';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { proof, worldDraft, worldResult, actionTime, projectedTime } from './fixtures/world';
import { gameTime, task, event } from './fixtures/game';

const locks = new Set<string>();
const lock: MemoryLock = async (id, work) => {
  if (locks.has(id)) throw new Error('busy'); locks.add(id);
  try { return await work(); } finally { locks.delete(id); }
};
afterEach(() => { vi.restoreAllMocks(); requestInspections.clear(); });
function configured(protocol: Protocol = 'openai') {
  const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };
  const vault = new CredentialVault(storage(), storage()), config = defaultAiConfig(), channel = newChannel(protocol);
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story-model' };
  config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'npc-memory-model' }; vault.set(channel.id, 'npc-test-secret');
  return { config, vault };
}
async function overwrite(factory: IDBFactory, state: GameState) {
  const db = await new Promise<IDBDatabase>((resolve) => { const request = factory.open('npc-memory'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
}
async function seeded(state = npcMemoryState(), factory = new IDBFactory()) {
  const repo = await SaveRepository.open('npc-memory', factory); await overwrite(factory, state); return repo;
}
function wire(protocol: Protocol, content: string) {
  return Response.json(protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 } }
    : protocol === 'anthropic' ? { content: [{ type: 'text', text: content }], usage: { input_tokens: 50, output_tokens: 20 } }
      : { choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
}
function summarize(state = npcMemoryState()) {
  const batch = planNpcSummary(state, 'npc-a')!;
  const result = parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'npc-summary');
  return { state: GameStateSchema.parse(applyNpcSummary(state, batch, result)), batch, result };
}
const runInput = (state: GameState) => ({ saveId: state.saveId, ...configured(), task: 'npc' as const, npcId: 'npc-a', timeoutSeconds: 10 });

describe('独立NPC来源与认知模型', () => {
  it.each([false, true])('普通/特殊NPC=%s：超过20条取最早10条；长期原始记录和最新记忆永久保留', (special) => {
    expect(planNpcSummary(npcMemoryState(20, special))).toBeUndefined();
    const before = npcMemoryState(21, special), { state, batch, result } = summarize(before);
    expect(batch.entries.map((entry) => entry.id)).toEqual(Array.from({ length: 10 }, (_, i) => `npc-a-memory-${i + 1}`));
    expect(state.npc).toEqual(before.npc); expect(state.journal).toEqual(before.journal); expect(state.revision).toBe(before.revision);
    expect(result.flatMap((entry) => entry.npcProvenance!.sourceMemoryIds)).toEqual(batch.entries.map((entry) => entry.id));
    expect(rawNpcMemories(state.npc['npc-a'])).toHaveLength(21);
    expect(planNpcSummary(state, 'npc-a')).toBeUndefined();
    expect(npcSummaryCandidates(state, 'npc-a')).toHaveLength(11);
    expect(npcKnowledgeContext(state, 'npc-b').summaries).toEqual([]);
    expect(JSON.stringify(npcKnowledgeContext(state, 'npc-b'))).not.toMatch(/A的私人经历|本组经历/);
  });
  it('亲历/转述/猜测/旧未知以及公开/私有/内部信息分组，不抬高权限', () => {
    const state = npcMemoryState(22), memories = state.npc['npc-a'].memories;
    memories[0] = { ...memories[0], text: '[转述]听说车辆被转卖', knowledgeKind: 'reported', knowledgeSource: '他人告知' };
    memories[1] = { ...memories[1], text: '[推测]可能存在债务', knowledgeKind: 'suspected', knowledgeSource: '个人猜测' };
    delete memories[2].knowledgeKind;
    memories[3].visibility = 'player_known'; memories[4].visibility = 'internal'; memories[4].text = 'NPC本人尚未获知的后台真相';
    const { state: after, result } = summarize(state);
    expect(new Set(result.map((entry) => entry.npcProvenance!.knowledgeKind))).toEqual(new Set(['observed', 'reported', 'suspected', 'unknown']));
    expect(result.every((entry) => entry.visibility !== 'player_known')).toBe(true);
    expect(result.some((entry) => entry.npcProvenance!.sourceVisibility === 'internal')).toBe(false);
    expect(after.npc['npc-a'].memories[4]).toEqual(memories[4]);
    expect(JSON.stringify(npcKnowledgeContext(after, 'npc-a'))).not.toContain('NPC本人尚未获知的后台真相');
    expect(JSON.stringify(result)).toContain('[转述]'); expect(JSON.stringify(result)).toContain('[推测]');
    expect(npcKnowledgeKind(memories[2])).toBe('unknown');
    expect(playerView(after).memories.map((entry) => entry.text)).toContain(memories[3].text);
    expect(JSON.stringify(playerView(after))).not.toContain('本组经历');
  });
  it('缺少journal来源的真实NPC记忆仍按自身ID及knowledgeSource整理，不捏造回合或时间', () => {
    const before = npcMemoryState(); before.npc['npc-a'].memories.forEach((entry) => { entry.sourceTurnIds = []; delete entry.knowledgeKind; });
    const { result } = summarize(before);
    expect(result[0].sourceTurnIds).toEqual([]); expect(result[0].npcProvenance!.sourceMemoryIds).toHaveLength(10);
    expect(result[0].createdAtGameTime).toBe(before.npc['npc-a'].memories[9].createdAtGameTime);
    expect(result[0].npcProvenance!.knowledgeKind).toBe('unknown');
  });
  it('旧档无provenance/kind原样读取，旧总结覆盖不明时不猜测收费', async () => {
    const before = npcMemoryState(); before.npc['npc-a'].memories.forEach((entry) => { delete entry.knowledgeKind; });
    const raw = before.npc['npc-a'].memories[0];
    before.memories.npcSummaries['npc-a'] = [{ id: 'legacy', text: '旧私人总结', sourceTurnIds: [], affectedEntityRefs: raw.affectedEntityRefs, createdAtGameTime: raw.createdAtGameTime, visibility: 'npc_private' }];
    const repo = await seeded(before);
    try { expect(await repo.load(before.saveId)).toEqual(before); expect(planNpcSummary(before, 'npc-a')).toBeUndefined(); }
    finally { repo.close(); }
  });
  it('未来时间、归属不明和重复记忆ID不能凑阈值，预算超限不截断原文', () => {
    const state = npcMemoryState();
    state.npc['npc-a'].memories[0].createdAtGameTime = '2099-01-01T00:00:00Z';
    expect(planNpcSummary(state)).toBeUndefined();
    const duplicate = npcMemoryState(); duplicate.npc['npc-b'].memories[0].id = duplicate.npc['npc-a'].memories[0].id;
    expect(planNpcSummary(duplicate)).toBeUndefined();
    const large = npcMemoryState(); large.npc['npc-a'].memories[0].text = '私有经历'.repeat(10000);
    expect(() => planNpcSummary(large)).toThrow(); expect(large.npc['npc-a'].memories[0].text).toHaveLength(40000);
  });
  it.each(['broken', JSON.stringify({ summaries: [], npcId: 'invented', unresolved: [], contradictions: [] }),
    JSON.stringify({ summaries: [{ groupId: 'observed:npc_private', text: '摘要', sourceMemoryIds: ['invented'] }], unresolved: [], contradictions: [] }),
    JSON.stringify({ summaries: [{ groupId: 'reported:npc_private', text: '改变认知性质' }], unresolved: [], contradictions: [] }),
    JSON.stringify({ summaries: [{ groupId: 'observed:npc_private', text: '摘要' }], unresolved: ['重大承诺无法保留'], contradictions: [] }),
    JSON.stringify({ summaries: [{ groupId: 'observed:npc_private', text: '摘要' }], unresolved: [], contradictions: ['未能解释的误解'] })])('严格拒绝身份、来源、分组或JSON篡改：%s', (text) => {
    expect(() => parseNpcSummary(text, planNpcSummary(npcMemoryState())!, 'summary')).toThrow();
  });
  it('保存边界拒绝伪造来源/时间/引用/权限，严格Schema兼容旧字段而拒绝无来源新字段', () => {
    const before = npcMemoryState(), { batch, result } = summarize(before), original = result[0];
    for (const summary of [{ ...original, visibility: 'player_known' as const }, { ...original, createdAtGameTime: gameTime },
      { ...original, affectedEntityRefs: [{ kind: 'npc' as const, id: 'npc-b' }] },
      { ...original, npcProvenance: { ...original.npcProvenance!, sourceMemoryIds: ['b-memory'] } },
      { ...original, npcProvenance: { ...original.npcProvenance!, npcId: 'npc-b' } }])
      expect(() => applyNpcSummary(before, batch, [summary])).toThrow();
    expect(NpcSummarySchema.safeParse({ ...original, freePatch: true }).success).toBe(false);
    expect(NpcMemorySchema.safeParse({ ...before.npc['npc-a'].memories[0], knowledgeKind: 'omniscient' }).success).toBe(false);
  });
  it('RecordNpcMemory持久化明确认知类型，不接受与命令不一致的字段', () => {
    const state = npcMemoryState(), memory = { ...state.npc['npc-a'].memories[0], id: 'new-memory', sourceTurnIds: ['turn-new'], createdAtGameTime: gameTime };
    const command: DomainCommand = { type: 'RecordNpcMemory', commandId: 'new', evidence: '亲眼观察', expectedRevision: state.revision, npcId: 'npc-a', memory, knowledgeKind: 'observed', layer: 'personal', addToKnownInformation: false };
    expect(commitCommands(state, 'turn-new', state.revision, [command]).npc['npc-a'].memories.at(-1)!.knowledgeKind).toBe('observed');
    expect(() => commitCommands(state, 'turn-new', state.revision, [{ ...command, memory: { ...memory, knowledgeKind: 'reported' } }])).toThrow();
  });
});

describe('真实运行、维护事务和异常', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s只发送A的授权批次，复用memory路由/快照/usage；不重复收费', async (protocol) => {
    const state = npcMemoryState(), repo = await seeded(state), settings = configured(protocol), batch = planNpcSummary(state)!;
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body); expect(body).not.toMatch(/B的独占秘密|未公开人物B|背景秘密|SAVE_STATE|npc-test-secret|A的私人经历21|npcSummaries/);
      expect(String(_url) + body).toContain('npc-memory-model'); return wire(protocol, JSON.stringify(npcSummaryOutput(batch)));
    });
    const runner = new MemoryMaintenance(repo, new AiClient(transport), lock);
    try {
      const after = await runner.run({ saveId: state.saveId, ...settings, task: 'npc', timeoutSeconds: 10 });
      expect(after!.npc).toEqual(state.npc); expect({ ...after, memories: state.memories }).toEqual(state);
      expect(after!.memories.npcSummaries['npc-a'][0].visibility).toBe('npc_private');
      expect(await runner.run({ saveId: state.saveId, ...settings, task: 'npc', timeoutSeconds: 10 })).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(1);
      const inspection = requestInspections.getSnapshot()[0]; expect(inspection.scope?.memoryTask).toBe('memory.npc_summarize');
      expect(inspection.statistics.actual.inputTokens).toBe(50); expect(inspection.statistics.actual.outputTokens).toBe(20);
      expect(JSON.stringify(inspection)).not.toContain('npc-test-secret');
    } finally { repo.close(); }
  });
  it.each([429, 503])('HTTP %s失败保留全部记录，不回退或自动重试', async (status) => {
    const state = npcMemoryState(), repo = await seeded(state), transport = vi.fn(async () => new Response('', { status }));
    try { await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run(runInput(state))).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1); expect(await repo.load(state.saveId)).toEqual(state); }
    finally { repo.close(); }
  });
  it('JSON无效、数据库配额失败都不半保存或删除原始记忆', async () => {
    const state = npcMemoryState(), repo = await seeded(state), batch = planNpcSummary(state)!;
    try {
      await expect(new MemoryMaintenance(repo, new AiClient(async () => wire('openai', '{broken')), lock).run(runInput(state))).rejects.toThrow();
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
      await expect(new MemoryMaintenance(repo, new AiClient(async () => wire('openai', JSON.stringify(npcSummaryOutput(batch)))), lock).run(runInput(state))).rejects.toThrow();
      expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it.each(['source', 'identity', 'deleted'] as const)('%s变化拒绝迟到写入，不覆盖最新状态', async (change) => {
    const state = npcMemoryState(), factory = new IDBFactory(), repo = await seeded(state, factory), batch = planNpcSummary(state)!;
    const latest = structuredClone(state);
    if (change === 'source') latest.npc['npc-a'].memories[0].text = '来源经另一操作修正';
    if (change === 'identity') latest.npc['npc-a'].identityKey = 'replacement-identity';
    if (change === 'deleted') { delete latest.npc['npc-a']; latest.journal.forEach((entry) => { entry.relatedActorRefs = []; }); }
    const transport = async () => { await overwrite(factory, latest); return wire('openai', JSON.stringify(npcSummaryOutput(batch))); };
    try { await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run(runInput(state))).rejects.toThrow(); expect(await repo.load(state.saveId)).toEqual(latest); }
    finally { repo.close(); }
  });
  it('NPC与公开维护使用同一锁；取消、迟到和超时不损坏原始记录', async () => {
    const state = npcMemoryState(), repo = await seeded(state), batch = planNpcSummary(state)!;
    let release!: () => void, started!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { started = resolve; });
    const transport = vi.fn(async () => { started(); await hold; return wire('openai', JSON.stringify(npcSummaryOutput(batch))); });
    const runner = new MemoryMaintenance(repo, new AiClient(transport), lock);
    try {
      const pending = runner.run(runInput(state)), rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      await ready; await expect(new MemoryMaintenance(repo, new AiClient(transport), lock).run({ ...runInput(state), task: 'public' })).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1); expect(runner.cancel()).toBe(true); await rejected; release();
      await expect(new MemoryMaintenance(repo, new AiClient(async () => new Promise<Response>(() => {})), lock).run({ ...runInput(state), timeoutSeconds: 0.01 })).rejects.toMatchObject({ code: 'timeout' });
      expect(await repo.load(state.saveId)).toEqual(state);
    } finally { release(); repo.close(); }
  });
  it('新正式回合产生新NPC记忆时，仅合并旧批次，不覆盖新草稿、回执或时间', async () => {
    const state = npcMemoryState(21, true), repo = await seeded(state), batch = planNpcSummary(state)!;
    const command: DomainCommand = { type: 'RecordNpcMemory', commandId: 'new-private-memory', expectedRevision: state.revision, npcId: 'npc-a', knowledgeKind: 'observed', layer: 'longTerm', addToKnownInformation: false,
      evidence: proof({ fact: '同事整理了诊室。' }), memory: { id: 'latest-npc-memory', text: '同事整理了诊室。', sourceTurnIds: ['turn-a'], affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }], visibility: 'npc_private', createdAtGameTime: actionTime, knowledgeSource: 'goal:npc-a:0 自身行动' } };
    let committedState: GameState | undefined;
    const transport = async () => {
      await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'turn-a', 'regular', ''), null);
      const draft = await completeDraft(repo, { world: worldResult([command]) });
      committedState = (await repo.commitTurn(submission(draft))).state;
      return wire('openai', JSON.stringify(npcSummaryOutput(batch)));
    };
    try {
      const after = await new MemoryMaintenance(repo, new AiClient(transport), lock).run(runInput(state));
      expect(rawNpcMemories(after!.npc['npc-a'])).toHaveLength(22);
      expect(after!.npc).toEqual(committedState!.npc); expect(after!.journal).toEqual(committedState!.journal);
      expect(after!.revision).toBe(22); expect((await repo.loadDraft(state.saveId))!.baseSaveRevision).toBe(22);
      expect({ ...after, memories: committedState!.memories }).toEqual(committedState);
    } finally { repo.close(); }
  });
});

describe('内部接入与公开泄露阻断', () => {
  it('在场也不公开私人总结；普通正文、记忆面板和历史搜索不接收私有内容', async () => {
    const { state } = summarize(); state.npc['npc-a'].onScene = true;
    const prompt = await composePrompt({ state, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: '看看四周' });
    expect(JSON.stringify(prompt.context)).not.toMatch(/本组经历|A的私人经历|B的独占秘密/);
    expect(JSON.stringify(prompt.context.MEMORY_CONTEXT)).toContain('"history-1"'); // NPC来源不抑制玩家公开历史。
    expect(JSON.stringify(playerView(state))).not.toMatch(/本组经历|A的私人经历|B的独占秘密/);
    expect(searchHistory(playerView(state).journal, '本组经历')).toEqual([]);
  });
  it('变量/世界使用所属NPC知识分区，已总结原文不重复注入；只向场景适用人物提供资料', async () => {
    const { state } = summarize(npcMemoryState(21, true));
    const draft = { ...worldDraft(), baseSaveRevision: state.revision };
    const world = await composePrompt({ state, draft, stage: 'world', mode: 'regular', settings: defaultSettings(), userInput: '' });
    expect(JSON.stringify(world.context)).toContain('本组经历'); expect(JSON.stringify(world.context)).not.toContain('A的私人经历1，');
    expect(world.context.NPC_KNOWLEDGE).toEqual(expect.arrayContaining([expect.objectContaining({ ownerNpcId: 'npc-a', summaries: expect.any(Array) })]));
    state.npc['npc-a'].onScene = true;
    const variables = await composePrompt({ state, draft, stage: 'variables', mode: 'regular', settings: defaultSettings(), userInput: '' });
    expect(JSON.stringify(variables.context.SAVE_STATE)).not.toMatch(/A的私人经历|B的独占秘密|本组经历/);
    expect(JSON.stringify(variables.context.NPC_KNOWLEDGE)).toContain('本组经历');
    expect(JSON.stringify(variables.context.NPC_KNOWLEDGE)).not.toContain('B的独占秘密');
  });
  it('总结允许所属NPC建立计划；拒绝跨人物、客观完成、公开事件及新知识自动传播', () => {
    const input = npcMemoryState(21, true); input.npc['npc-a'].memories[0].affectedEntityRefs.push({ kind: 'npc', id: 'npc-b' });
    const { state, result } = summarize(input); const draft = { ...worldDraft(), baseSaveRevision: state.revision };
    const source = `npc-summary:npc-a:${result[0].id}`, sources = worldSources(state, draft);
    expect(sources.find((entry) => entry.id === source)!.actors).toEqual([{ kind: 'npc', id: 'npc-a' }]);
    const evidence = proof({ kind: 'planned', sources: [source], fact: '同事准备核对自己的约定' });
    const command: DomainCommand = { type: 'SaveTask', commandId: 'own-plan', evidence, task: { ...task(), actorRef: { kind: 'npc', id: 'npc-a' } } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [command] }), state, draft)).not.toThrow();
    expect(() => readWorldEvidence({ ...command, task: { ...command.task, actorRef: { kind: 'npc', id: 'npc-b' } } }, sources, gameTime, projectedTime)).toThrow();
    expect(() => readWorldEvidence({ ...command, evidence: proof({ kind: 'established', sources: [source], fact: result[0].text }), task: { ...command.task, status: 'completed' } }, sources, gameTime, projectedTime)).toThrow();
    expect(() => readWorldEvidence({ type: 'SaveEvent', commandId: 'leak', evidence, event: { ...event(), visibility: 'known' } }, sources, gameTime, projectedTime)).toThrow();
    const memory: DomainCommand = { type: 'RecordNpcMemory', commandId: 'leak-memory', evidence, expectedRevision: state.revision, npcId: 'npc-b', memory: state.npc['npc-b'].memories[0], knowledgeKind: 'observed', layer: 'personal', addToKnownInformation: false };
    expect(() => readWorldEvidence(memory, sources, gameTime, projectedTime)).toThrow();
    expect(npcSummaryInput(planNpcSummary(npcMemoryState())!)).not.toHaveProperty('priorSummaries');
  });
});


it('总结形成的NPC计划仍有所属身份，不能被另一人物借用为私有行动依据', () => {
  const { state } = summarize(npcMemoryState(21, true));
  state.tasks['private-task'] = { ...task('private-task'), actorRef: { kind: 'npc', id: 'npc-a' } };
  const draft = { ...worldDraft(), baseSaveRevision: state.revision };
  const command: DomainCommand = { type: 'UpdateNpc', commandId: 'borrow-private-plan', expectedRevision: state.revision,
    npcId: 'npc-b', changes: { healthText: '稍感疲劳' }, evidence: proof({ sources: ['npc:npc-b', 'task:private-task'], fact: '未公开人物B整理了资料' }) };
  expect(worldSources(state, draft).find((entry) => entry.id === 'task:private-task')!.ownerNpcId).toBe('npc-a');
  expect(() => parseWorld(JSON.stringify(worldResult([command])), state, draft)).toThrow();
});
it('新增来源记录禁止认知前缀冲突，持久总结禁止重复覆盖和权限篡改', () => {
  const { state, result } = summarize();
  expect(NpcMemorySchema.safeParse({ ...state.npc['npc-a'].memories[0], knowledgeKind: 'observed', text: '[推测]猜测他人收款' }).success).toBe(false);
  const duplicated = structuredClone(state); duplicated.memories.npcSummaries['npc-a'].push({ ...result[0], id: 'duplicate-summary' });
  expect(GameStateSchema.safeParse(duplicated).success).toBe(false);
  const leaked = structuredClone(state); leaked.memories.npcSummaries['npc-a'][0].visibility = 'player_known';
  expect(GameStateSchema.safeParse(leaked).success).toBe(false);
});
it('选择器拒绝不存在/原型人物引用，认知上下文不注入未来记忆', () => {
  const state = npcMemoryState();
  expect(() => planNpcSummary(state, 'missing')).toThrow(); expect(() => planNpcSummary(state, '__proto__')).toThrow();
  state.npc['npc-a'].memories[0].createdAtGameTime = '2099-01-01T00:00:00Z';
  expect(npcKnowledgeContext(state, 'npc-a').raw.some((entry) => entry.id === state.npc['npc-a'].memories[0].id)).toBe(false);
});

it('同一回合产生多条NPC记忆时按原始ID覆盖，不能按turnId把余下条目误判成已总结', () => {
  const input = npcMemoryState(); input.npc['npc-a'].memories.forEach((entry) => { entry.sourceTurnIds = ['history-1']; });
  const { state, result } = summarize(input);
  expect(result[0].sourceTurnIds).toEqual(['history-1']);
  expect(result[0].npcProvenance!.sourceMemoryIds).toHaveLength(10);
  expect(npcSummaryCandidates(state, 'npc-a').map((entry) => entry.id)).toEqual(Array.from({ length: 11 }, (_, index) => `npc-a-memory-${index + 11}`));
});

it('同一游戏时间记录的最新纠正仍进入原始认知窗口，不能被旧记录挤出', () => {
  const state = npcMemoryState(); state.npc['npc-a'].memories.forEach((entry) => { entry.createdAtGameTime = gameTime; });
  state.npc['npc-a'].memories[20].text = '最新纠正：先前听闻的转卖并未实际发生。';
  const context = npcKnowledgeContext(state, 'npc-a');
  expect(context.raw).toHaveLength(20);
  expect(context.raw[0].id).toBe('npc-a-memory-21');
  expect(context.raw.some((entry) => entry.text.includes('最新纠正'))).toBe(true);
});

it('NPC亲历的私有事实不能仅因established就被升级为player_known记忆', () => {
  const state = npcMemoryState(), original = state.npc['npc-a'].memories.at(-1)!;
  const draft = { ...worldDraft(), baseSaveRevision: state.revision }, source = `memory:npc-a:${original.id}`;
  const command: DomainCommand = { type: 'RecordNpcMemory', commandId: 'private-promotion', npcId: 'npc-a', expectedRevision: state.revision,
    knowledgeKind: 'observed', layer: 'personal', addToKnownInformation: false,
    evidence: proof({ kind: 'established', sources: [source], fact: original.text }),
    memory: { ...original, id: 'promoted-memory', text: original.text, sourceTurnIds: ['turn-a'], createdAtGameTime: actionTime, knowledgeSource: source, visibility: 'player_known' } };
  expect(() => parseWorld(JSON.stringify(worldResult([command])), state, draft)).toThrow();
  expect(() => parseWorld(JSON.stringify(worldResult([{ ...command, memory: { ...command.memory, visibility: 'npc_private' } }])), state, draft)).not.toThrow();
  original.visibility = 'player_known'; // 明确已有公开来源时仍可正常引用。
  expect(() => parseWorld(JSON.stringify(worldResult([command])), state, draft)).not.toThrow();
});
it('NPC私有事实不能直接转成新公开事件，已有公开来源的正例仍成立', () => {
  const state = npcMemoryState(), original = state.npc['npc-a'].memories.at(-1)!, draft = { ...worldDraft(), baseSaveRevision: state.revision };
  const command: DomainCommand = { type: 'SaveEvent', commandId: 'publish-private', event: { ...event(), actorRefs: [{ kind: 'npc', id: 'npc-a' }], visibility: 'known' },
    evidence: proof({ kind: 'established', sources: [`memory:npc-a:${original.id}`], fact: original.text }) };
  const output = { ...worldResult(), eventCommands: [command] };
  expect(() => parseWorld(JSON.stringify(output), state, draft)).toThrow();
  state.events[command.event.id] = { ...command.event, title: '先前已知的预约' };
  expect(() => parseWorld(JSON.stringify(output), state, draft)).toThrow(); // 不能借已知事件更新字段泄漏私人进展。
  original.visibility = 'player_known';
  expect(() => parseWorld(JSON.stringify(output), state, draft)).not.toThrow();
});


it('内部世界记录即使放在NPC容器且带亲历类型，也不能作为NPC已经获知的资料', () => {
  const state = npcMemoryState(); const internal = state.npc['npc-a'].memories[0];
  internal.visibility = 'internal'; internal.text = '后台知道但角色尚不知情的秘密';
  expect(planNpcSummary(state)).toBeUndefined(); // 只剩20条合法知识，不能用内部资料凑阈值。
  expect(JSON.stringify(npcKnowledgeContext(state, 'npc-a'))).not.toContain(internal.text);
  expect(JSON.stringify(worldSources(state, { ...worldDraft(), baseSaveRevision: state.revision }))).not.toContain(internal.text);
});
