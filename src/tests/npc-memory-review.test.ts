import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DomainCommand } from '../domain/commands';
import type { GameState } from '../domain/state';
import { GameStateSchema } from '../domain/state';
import { createTurnDraft, TurnDraftSchema } from '../domain/drafts';
import { npcMaintenanceAvailable, planNpcSummary } from '../domain/memories/npcMemory';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseWorld } from '../services/validation/aiOutputs';
import { worldSources } from '../services/validation/worldEvidence';
import { MemoryMaintenance } from '../workflows/memoryMaintenance';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { playerView } from '../ui/panels/playerView';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { completeDraft, submission } from './fixtures/turn';
import { event, task } from './fixtures/game';
import { worldDraft, worldResult, proof, actionTime } from './fixtures/world';

async function seed(state: GameState) {
  const factory = new IDBFactory(), repo = await SaveRepository.open('npc-review', factory);
  const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('npc-review'); req.onsuccess = () => resolve(req.result); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close(); return repo;
}
const secret = 'A把唯一的红色钥匙封存在诊室暗格内。';
async function hiddenEvent(participantB = false) {
  const initial = npcMemoryState(); initial.npc['npc-a'].memories.at(-1)!.text = secret;
  const repo = await seed(initial);
  try {
    const saved: DomainCommand = { type: 'SaveEvent', commandId: 'private-incident', evidence: proof({ kind: 'established', sources: ['memory:npc-a:npc-a-memory-21'], fact: secret }),
      event: { ...event('private-incident'), title: secret, status: 'resolved', resolvedAt: actionTime, resolutionText: secret,
        actorRefs: [{ kind: 'npc', id: 'npc-a' }, ...(participantB ? [{ kind: 'npc' as const, id: 'npc-b' }] : [])] } };
    const result = { ...worldResult(), eventCommands: [saved] };
    expect(parseWorld(JSON.stringify(result), initial, { ...worldDraft(), baseSaveRevision: initial.revision })).toEqual(result);
    await repo.saveDraft(createTurnDraft(initial.saveId, initial.revision, 'turn-a', 'regular', ''), null);
    const draft = await completeDraft(repo, { world: result });
    await repo.commitTurn(submission(draft));
    const state = await repo.load(initial.saveId);
    expect(state.events['private-incident']).toEqual(saved.event);
    expect(state.npc).toEqual(initial.npc); expect(JSON.stringify(playerView(state))).not.toContain(secret);
    const next = worldDraft(); next.baseSaveRevision = state.revision; next.turnId = (await repo.loadDraft(state.saveId))!.turnId;
    next.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'next-clock', evidence: '经过十分钟，主角完成用餐。', worldClock: '2026-10-18T08:20:00+08:00' }];
    return { state, draft: TurnDraftSchema.parse(next), at: '2026-10-18T08:15:00+08:00' };
  } finally { repo.close(); }
}

// 真正经过事件验证、正式事务与下回合WORLD_SOURCES，不以helper的返回值冒充完整路径。
describe('隐藏事件不是NPC知情授权', () => {
  it.each(['UpdateNpc', 'SaveTask', 'RecordNpcMemory'] as const)('A的独占秘密经隐藏事件不能授权B的%s', async (type) => {
    const { state, draft, at } = await hiddenEvent(type === 'RecordNpcMemory');
    const snapshot = structuredClone(state), evidence = proof({ at, sources: type === 'RecordNpcMemory' ? ['event:private-incident'] : ['event:private-incident', 'npc:npc-b'],
      kind: type === 'RecordNpcMemory' ? 'established' : type === 'SaveTask' ? 'planned' : 'derived', fact: type === 'RecordNpcMemory' ? secret : 'B核查了暗格中的红色钥匙。' });
    const command: DomainCommand = type === 'UpdateNpc' ? { type, commandId: 'borrow', expectedRevision: state.revision, npcId: 'npc-b', changes: { healthText: '核查暗格后稍感疲惫' }, evidence }
      : type === 'SaveTask' ? { type, commandId: 'borrow', task: { ...task('b-secret-plan'), actorRef: { kind: 'npc', id: 'npc-b' }, goal: '取出A暗格内的钥匙', dueAt: at, startAt: state.worldClock }, evidence }
      : { type, commandId: 'borrow', expectedRevision: state.revision, npcId: 'npc-b', layer: 'personal', knowledgeKind: 'observed', addToKnownInformation: false, evidence,
        memory: { id: 'b-stolen-knowledge', text: secret, sourceTurnIds: [draft.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }], visibility: 'npc_private', createdAtGameTime: at, knowledgeSource: 'event:private-incident' } };
    const result = type === 'SaveTask' ? { ...worldResult(), taskCommands: [command] } : worldResult([command]);
    expect(worldSources(state, draft).some((source) => source.id === 'event:private-incident')).toBe(true);
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow();
    expect(state).toEqual(snapshot);
  });
  it('后台事件可以继续产生隐藏后续事件；参与者B仍不会自动得到新知识', async () => {
    const { state, draft, at } = await hiddenEvent();
    const before = structuredClone(state);
    const next: DomainCommand = { type: 'SaveEvent', commandId: 'hidden-followup',
      evidence: proof({ at, sources: ['event:private-incident'], fact: '暗格附近的看守开始轮值。' }),
      event: { ...event('followup'), title: '暗格看守轮值', status: 'active', startAt: state.worldClock, estimatedEndAt: at,
        sourceTurnIds: [draft.turnId], actorRefs: [{ kind: 'npc', id: 'npc-a' }, { kind: 'npc', id: 'npc-b' }] } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [next] }), state, draft)).not.toThrow();
    expect(state).toEqual(before); expect(state.npc['npc-b'].memories).toHaveLength(1);
    expect(worldSources(state, draft).find((source) => source.id === 'event:private-incident')?.worldEventOnly).toBe(true);
  });
  it('已公开事件的正常来源保持可用；旧事件无新增持久化字段', async () => {
    const { state, draft, at } = await hiddenEvent();
    const disclosed = { ...state.events['private-incident'], title: '公开开放安排', resolutionText: '诊所已经公开开放。', visibility: 'known' as const };
    state.events[disclosed.id] = disclosed;
    expect(GameStateSchema.parse(state).events[disclosed.id]).toEqual(disclosed);
    const plan: DomainCommand = { type: 'SaveTask', commandId: 'public-plan', evidence: proof({ at, kind: 'planned', sources: ['event:private-incident', 'npc:npc-b'], fact: 'B准备前往已开放诊所。' }),
      task: { ...task('public-visit'), actorRef: { kind: 'npc', id: 'npc-b' }, startAt: state.worldClock, dueAt: at } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [plan] }), state, draft)).not.toThrow();
    expect(worldSources(state, draft).find((source) => source.id === 'event:private-incident')?.worldEventOnly).toBeUndefined();
  });
  it('合法隐藏事件仍可正常演化；A可依据本人原始知识行动，事件并不永久只属于A', async () => {
    const { state, draft, at } = await hiddenEvent();
    const aPlan: DomainCommand = { type: 'SaveTask', commandId: 'a-own-plan', evidence: proof({ at, kind: 'planned', sources: ['memory:npc-a:npc-a-memory-21'], fact: 'A准备检查自己的钥匙。' }),
      task: { ...task('a-plan'), actorRef: { kind: 'npc', id: 'npc-a' }, dueAt: at, startAt: state.worldClock, prerequisites: ['event:private-incident'] } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [aPlan] }), state, draft)).not.toThrow();
    const active: DomainCommand = { ...aPlan, task: { ...aPlan.task, status: 'active' },
      evidence: proof({ at, kind: 'derived', sources: ['memory:npc-a:npc-a-memory-21'], fact: 'A已经开始核查自己保管的钥匙。' }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [active] }), state, draft)).not.toThrow(); // 原事件已结案，任务前置条件仍正常满足。
    // B通过独立的现场观察来源获知，而不是由事件参与者列表或事件ID自动获知。
    state.npc['npc-b'].knownInformation.push({ text: secret, source: 'B独立到诊室亲眼查看暗格', learnedAt: state.worldClock });
    const remember: DomainCommand = { type: 'RecordNpcMemory', commandId: 'b-observation', expectedRevision: state.revision, npcId: 'npc-b', layer: 'personal', knowledgeKind: 'observed', addToKnownInformation: false,
      evidence: proof({ at, kind: 'established', sources: ['knowledge:npc-b:0'], fact: secret }),
      memory: { id: 'b-independent-observation', text: secret, sourceTurnIds: [draft.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }], visibility: 'npc_private', createdAtGameTime: at, knowledgeSource: 'knowledge:npc-b:0 独立观察' } };
    expect(() => parseWorld(JSON.stringify(worldResult([remember])), state, draft)).not.toThrow();
    const bPlan: DomainCommand = { ...aPlan, commandId: 'b-own-plan', task: { ...aPlan.task, id: 'b-plan', actorRef: { kind: 'npc', id: 'npc-b' } }, evidence: proof({ at, kind: 'planned', sources: ['knowledge:npc-b:0'], fact: 'B准备核查自己已经看见的钥匙。' }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [bPlan] }), state, draft)).not.toThrow();
    expect(state.memories.npcSummaries['npc-b']).toBeUndefined();
    expect(JSON.stringify(playerView(state))).not.toContain(secret);
  });
});

function twoNpcs(blockA = true, blockB = false) {
  const state = npcMemoryState(); state.npc['npc-b'].memories = state.npc['npc-a'].memories.map((entry, index) => ({ ...entry, id: `b-memory-${index}`, text: `B自己的独立经历${index}`, affectedEntityRefs: [{ kind: 'npc' as const, id: 'npc-b' }] }));
  if (blockA) state.npc['npc-a'].memories[0].text = 'A的完整原始记录'.repeat(10000);
  if (blockB) state.npc['npc-b'].memories[0].text = 'B的完整原始记录'.repeat(10000);
  return GameStateSchema.parse(state);
}
function configured() {
  const config = defaultAiConfig(), channel = newChannel(); config.channels = [channel];
  config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'memory-review' };
  const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
  const vault = new CredentialVault(storage(), storage()); vault.set(channel.id, 'mock-review-key'); return { config, vault };
}
describe('超预算人物不阻塞其他合法批次', () => {
  it('A超长、B正常：选B且不截断A；原始与已有总结保持完整，重复维护不重复请求', async () => {
    const state = twoNpcs(), batch = planNpcSummary(state)!;
    expect(batch.npcId).toBe('npc-b'); expect(npcMaintenanceAvailable(state)).toBe(true);
    const repo = await seed(state), transport = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(npcSummaryOutput(batch)) } }] }));
    const runner = new MemoryMaintenance(repo, new AiClient(transport), async (_id, work) => work());
    const input = { saveId: state.saveId, task: 'npc' as const, timeoutSeconds: 10, ...configured() };
    try {
      const after = await runner.run(input); expect(after!.npc).toEqual(state.npc);
      expect(after!.memories.npcSummaries['npc-b']).toHaveLength(1);
      expect(npcMaintenanceAvailable(after!)).toBe(false);
      expect(await runner.run(input)).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(1);
      expect(await repo.load(state.saveId)).toEqual(after);
    } finally { repo.close(); }
  });
  it('A、B都超长：无可执行任务，不发API请求，也不更改原始数据', async () => {
    const state = twoNpcs(true, true);
    expect(planNpcSummary(state)).toBeUndefined(); expect(npcMaintenanceAvailable(state)).toBe(false);
    const repo = await seed(state), transport = vi.fn();
    try {
      expect(await new MemoryMaintenance(repo, new AiClient(transport), async (_id, work) => work()).run({ saveId: state.saveId, task: 'npc', timeoutSeconds: 10, ...configured() })).toBeUndefined();
      expect(transport).not.toHaveBeenCalled(); expect(await repo.load(state.saveId)).toEqual(state);
    } finally { repo.close(); }
  });
  it('两人正常仍优先A；显式指定不可执行的A不擅自改为B', () => {
    expect(planNpcSummary(twoNpcs(false))!.npcId).toBe('npc-a');
    expect(planNpcSummary(twoNpcs(), 'npc-a')).toBeUndefined();
    expect(planNpcSummary(twoNpcs(), 'npc-b')!.npcId).toBe('npc-b');
  });
});
