import { describe, expect, it } from 'vitest';
import { DomainCommandSchema, commitCommands } from '../domain/commands';
import { parseWorld } from '../services/validation/aiOutputs';
import { worldState, worldDraft, worldResult, proof, actionTime } from './fixtures/world';
import { task } from './fixtures/game';
import { afterEach, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GameStateSchema } from '../domain/state';
import { migrateSave } from '../services/storage/migrations';
import { projectTurn } from '../domain/turnProjection';
import { rerollStory } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { playerView } from '../ui/panels/playerView';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { handoffState, finishTask, receiveTask, retireCommand, handoffResult, resultText } from './fixtures/handoff';
import { event, npc } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import type { GameState } from '../domain/state';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { recallHistory, historyRecords } from '../domain/memories/history';
import { publicShortMemories, storyMemoryContext } from '../domain/memories/publicMemory';
import { compressionCandidates } from '../domain/memories/compression';
describe('M5-P5 成果及生命周期缺口', () => {
  it('同窗口的真实终结留下成果，不需要强制接班', () => {
    const state = worldState();
    state.tasks.work = { ...task('work'), actorRef: { kind: 'npc', id: 'npc-a' }, status: 'active' };
    const candidate = worldResult();
    candidate.taskCommands = [{ type: 'SaveTask', commandId: 'finish', task: { ...state.tasks.work, status: 'completed',
      resolution: { at: actionTime, outcome: 'success', result: '核对清单记载了三份齐全的材料。', reason: '逐份比对登记记录，无缺失。', sourceTurnId: 'turn-a' } },
      evidence: proof({ sources: ['task:work', 'npc:npc-a'], fact: '清单与三份材料逐一吻合。',
        decision: { targetId: 'work', status: 'completed', reason: '逐份比对登记记录，无缺失。', result: '核对清单记载了三份齐全的材料。', conditionsSatisfied: true, continues: false } }) }];
    const result = parseWorld(JSON.stringify(candidate), state, worldDraft());
    expect(result.taskCommands).toHaveLength(1);
    expect(state.tasks.work.status).toBe('active');
  });
  it('明确的联系人保护不是人物面板可见性推断', () => {
    const command = DomainCommandSchema.parse({ type: 'RegisterContact', commandId: 'contact', npcId: 'npc-a', reason: '交换联络方式', evidence: '主角与同事交换了联络方式。' });
    const state = worldState();
    expect(commitCommands(state, 'turn-a', 0, [command]).contactNpcIds).toContain('npc-a');
  });
});


const parse = (state: GameState, result: ReturnType<typeof worldResult> = handoffResult(state), draft = worldDraft()) => parseWorld(JSON.stringify(result), state, draft);
const commands = (result: ReturnType<typeof worldResult>) => [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
const project = (state: GameState, result: ReturnType<typeof worldResult>) => projectTurn(state, worldDraft(), commands(parse(state, result)));

describe('自主终结与有依据的同窗口交接', () => {
  it.each(['npc', 'organization'] as const)('%s 接班：前序先校验，传递明确成果，允许逆序返回', (kind) => {
    const state = handoffState(), before = structuredClone(state);
    const result = parse(state, handoffResult(state, { kind, id: kind === 'npc' ? 'npc-b' : 'org-a' }));
    const projected = projectTurn(state, worldDraft(), commands(result));
    expect(projected.tasks.work.resolution).toMatchObject({ result: resultText, outcome: 'success', sourceTurnId: 'turn-a' });
    expect(projected.tasks.next.actorRef.kind).toBe(kind);
    expect(Object.keys(projected.npc)).toEqual(Object.keys(state.npc));
    expect(state).toEqual(before);
    expect(JSON.stringify(playerView(projected))).not.toContain(resultText);
  });
  it('同一 NPC 结束旧职责后可在实际释放时间之后开始新职责，不强制隔回合', () => {
    const state = handoffState(), result = handoffResult(state, { kind: 'npc', id: 'npc-a' });
    expect(project(state, result).tasks.next.status).toBe('active');
    const first = result.taskCommands[0];
    if (first.type !== 'SaveTask') throw Error();
    first.task.startAt = '2026-10-18T08:04:00+08:00';
    expect(() => parse(state, result)).toThrow();
  });
  it('暂时受阻保留占用，没有下一项就不强制制造接班人', () => {
    const state = handoffState(), result = worldResult();
    result.taskCommands = [{ ...finishTask(state), task: { ...state.tasks.work, status: 'blocked', blockers: ['尚未取得门禁许可'] },
      evidence: proof({ sources: ['npc:npc-a', 'task:work'], fact: '门禁限制使人员停在门外。', decision: { targetId: 'work', status: 'blocked', reason: '门禁许可尚未取得', result: '留在门外等待许可', conditionsSatisfied: false, continues: true } }) }];
    expect(project(state, result).tasks.work.status).toBe('blocked');
    result.taskCommands.push(receiveTask({ kind: 'npc', id: 'npc-a' }));
    expect(() => parse(state, result)).toThrow();
  });
  it('到期、没有实际结果和存在未满足条件都不能冒充成功', () => {
    for (const fault of ['no-result', 'unmet', 'future', 'plan'] as const) {
      const state = handoffState(), result = worldResult();
      const c = finishTask(state);
      if (fault === 'no-result') c.evidence = proof({ sources: ['task:work'], fact: '时间已到。' });
      if (fault === 'unmet') state.tasks.work.blockers = ['未获许可'];
      if (fault === 'future') { state.tasks.work.startAt = '2026-10-18T08:20:00+08:00'; c.task.startAt = state.tasks.work.startAt; }
      if (fault === 'plan') c.evidence = proof({ kind: 'planned', sources: ['task:work'], fact: '准备核对材料。' });
      result.taskCommands = [c]; expect(() => parse(state, result)).toThrow();
    }
  });
  it('实际失败终止保留原因和结果，不依赖指定完成/终止关键词', () => {
    const state = handoffState(), result = worldResult(); result.taskCommands = [finishTask(state, 'work', actionTime, 'cancelled')];
    expect(project(state, result).tasks.work.resolution).toMatchObject({ outcome: 'failure', result: resultText });
    const c = result.taskCommands[0];
    if (c.type !== 'SaveTask') throw Error();
    const proofData = JSON.parse(c.evidence); proofData.decision.continues = true; c.evidence = JSON.stringify(proofData);
    expect(() => parse(state, result)).toThrow();
  });
  it('允许主动取消尚未开始的安排，无须满足全部完成条件', () => {
    const state = handoffState(); state.tasks.work.startAt = '2026-10-18T08:30:00+08:00'; state.tasks.work.blockers = ['未获许可'];
    const result = worldResult(); result.taskCommands = [finishTask(state, 'work', actionTime, 'cancelled')];
    expect(project(state, result).tasks.work.status).toBe('cancelled');
  });
  it('拒绝改派原任务、自证、循环以及未经验证的同批成果', () => {
    const state = handoffState();
    const changed = finishTask(state); changed.task.actorRef = { kind: 'npc', id: 'npc-b' };
    expect(() => parse(state, { ...worldResult(), taskCommands: [changed] })).toThrow();
    const self = receiveTask(); self.task.handoff!.fromTaskId = self.task.id;
    self.evidence = proof({ sources: [`task:${self.task.id}`, 'npc:npc-b'], fact: resultText });
    expect(() => parse(state, { ...worldResult(), taskCommands: [self] })).toThrow();
    const a = receiveTask(), b = receiveTask({ kind: 'npc', id: 'npc-a' }, 'other');
    a.task.handoff!.fromTaskId = b.task.id; b.task.handoff!.fromTaskId = a.task.id;
    expect(() => parse(state, { ...worldResult(), taskCommands: [a, b] })).toThrow();
    const invalid = finishTask(state); invalid.evidence = proof({ sources: ['task:work'], fact: '估计截止时间到了。' });
    expect(() => parse(state, { ...worldResult(), taskCommands: [receiveTask(), invalid] })).toThrow();
  });
  it('同一成果不得重复制造相同接班职责，不设置固定接力深度', () => {
    const state = handoffState(); const first = project(state, handoffResult(state));
    const again = receiveTask({ kind: 'npc', id: 'npc-b' }, 'duplicate');
    const result = worldResult(); result.taskCommands = [again];
    expect(() => parse(first, result, { ...worldDraft(), baseSaveRevision: first.revision })).toThrow();
  });
  it('跨任务只能传递前序成果的具体内容，不能顺便携带A的其他秘密', () => {
    const state = handoffState(), r = handoffResult(state), c = r.taskCommands[0];
    if (c.type !== 'SaveTask') throw Error();
    c.task.handoff!.content = 'A的私人银行卡密码';
    c.evidence = proof({ sources: ['task:work', 'npc:npc-b'], fact: c.task.handoff!.content });
    expect(() => parse(state, r)).toThrow();
  });
  it('明确信息传递可生成B的转述记忆，不能自动升级为主角已知', () => {
    const state = handoffState(), r = handoffResult(state);
    const memory: DomainCommand = { type: 'RecordNpcMemory', commandId: 'report-memory', npcId: 'npc-b', expectedRevision: 0,
      layer: 'personal', knowledgeKind: 'reported', addToKnownInformation: true,
      memory: { id: 'received-report', text: `[转述]${resultText}`, sourceTurnIds: ['turn-a'], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }],
        createdAtGameTime: '2026-10-18T08:06:00+08:00', visibility: 'npc_private', knowledgeSource: 'handoff:next' },
      evidence: proof({ kind: 'reported', at: '2026-10-18T08:06:00+08:00', sources: ['handoff:next'], fact: resultText }) };
    r.worldCommands = [memory];
    const projected = project(state, r);
    expect(projected.npc['npc-b'].memories[0].knowledgeKind).toBe('reported');
    expect(JSON.stringify(playerView(projected))).not.toContain(resultText);
    memory.memory.visibility = 'player_known'; expect(() => parse(state, r)).toThrow();
  });
  it('隐藏事件ID仍不能给B授权，缺少实际交接也不能借A私有task来源', () => {
    const state = handoffState(); state.events.secret = { ...event('secret'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved', resolvedAt: state.worldClock, resolutionText: resultText };
    const r = worldResult(), c = receiveTask(); delete c.task.handoff;
    for (const sources of [['task:work', 'npc:npc-b'], ['event:secret', 'npc:npc-b']]) {
      c.evidence = proof({ sources, fact: resultText }); r.taskCommands = [c]; expect(() => parse(state, r)).toThrow();
    }
  });
});

describe('联系人与最小身份历史，严格引用边界', () => {
  function retireCandidate(state: GameState) { return { ...worldResult([retireCommand(state)]), taskCommands: [finishTask(state)] }; }
  it('非联系人退场清理完整档案，终结任务与历史引用仍可读，绝不存整份NPC备份', () => {
    const state = handoffState();
    state.events.old = { ...event('old'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved', resolvedAt: state.worldClock, resolutionText: '核对登记已留档' };
    state.journal = [{ turnId: 'past', revision: 0, story: worldDraft().story!, relatedActorRefs: [{ kind: 'npc', id: 'npc-a' }] }]; state.turnNumber = 1;
    state.npc['npc-b'].memories = [{ id: 'remember-a', text: '曾见过核对人', knowledgeKind: 'observed', knowledgeSource: '亲历', sourceTurnIds: ['past'], affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }], createdAtGameTime: state.worldClock, visibility: 'npc_private' }];
    const projected = project(state, retireCandidate(state));
    expect(projected.npc['npc-a']).toBeUndefined();
    expect(Object.keys(projected.retiredNpcs['npc-a']).sort()).toEqual(['aliases', 'id', 'identityKey', 'name', 'retiredAt', 'sourceTurnIds']);
    expect(projected.tasks.work.actorRef.id).toBe('npc-a');
    expect(projected.events.old.actorRefs[0].id).toBe('npc-a');
    expect(projected.journal).toEqual(state.journal); expect(projected.npc['npc-b'].memories).toEqual(state.npc['npc-b'].memories);
    expect(GameStateSchema.safeParse(projected).success).toBe(true);
    expect(state.npc['npc-a']).toBeDefined();
  });
  it.each(['contact', 'scene', 'companion', 'duty', 'organization', 'item', 'asset', 'event', 'goal'] as const)('%s 引用或保护尚未处理则拒绝退场', (reason) => {
    const state = handoffState();
    if (reason === 'contact') state.contactNpcIds = ['npc-a'];
    if (reason === 'scene') state.npc['npc-a'].onScene = true;
    if (reason === 'companion' || reason === 'goal') state.npc['npc-a'] = { ...worldState().npc['npc-a'] };
    if (reason === 'companion') state.initialCompanionId = 'npc-a';
    if (reason === 'organization') state.organizations['org-a'].keyNpcIds = ['npc-a'];
    if (reason === 'item') state.items.key = { id: 'key', name: '钥匙', category: 'other', quantity: 1, conditionText: '完好', ownerRef: { kind: 'npc', id: 'npc-a' } };
    if (reason === 'asset') state.economy.vehicles.car = { id: 'car', kind: 'vehicle', name: '车', ownerRef: { kind: 'npc', id: 'npc-a' }, estimatedValue: null, statusText: '完好', source: '原始档案', model: '轿车' };
    if (reason === 'event') state.events.live = { ...event('live'), actorRefs: [{ kind: 'npc', id: 'npc-a' }] };
    const r = retireCandidate(state); if (reason === 'duty') r.taskCommands = [];
    const before = structuredClone(state); expect(() => project(state, r)).toThrow(); expect(state).toEqual(before);
  });
  it('公开记忆必留存；选中的必要私有材料保留为internal，不进入公开正文/历史搜索', () => {
    const state = handoffState();
    state.npc['npc-a'].memories = ['player_known', 'npc_private'].map((visibility, i) => ({ id: `m${i}`, text: i ? '私有账册藏在楼梯下' : '主角见过核对人', knowledgeSource: '亲眼见到', sourceTurnIds: [], affectedEntityRefs: [{ kind: 'npc' as const, id: 'npc-a' }], visibility: visibility === 'player_known' ? 'player_known' as const : 'npc_private' as const, createdAtGameTime: state.worldClock, knowledgeKind: 'observed' as const }));
    const r = retireCandidate(state); const retire = r.worldCommands[0]; if (retire.type !== 'RetireNpc') throw Error(); retire.retainMemoryIds = ['m1'];
    const projected = project(state, r);
    expect(projected.memories.long.map((m) => m.visibility)).toEqual(['player_known', 'internal']);
    expect(JSON.stringify(playerView(projected))).not.toContain('私有账册');
    expect(projected.memories.npcSummaries['npc-a']).toBeUndefined();
  });
  it('事件仍在推进但已有真实继任职责可退出，不改写历史参与者', () => {
    const state = handoffState(); state.events.case = { ...event('case'), estimatedEndAt:'2026-10-19T08:00:00+08:00', actorRefs: [{ kind: 'npc', id: 'npc-a' }], linkedTaskIds: ['work'] }; state.tasks.work.linkedEventId = 'case';
    const r = handoffResult(state), next = r.taskCommands[0]; if (next.type !== 'SaveTask') throw Error(); next.task.linkedEventId = 'case';
    r.worldCommands = [retireCommand(state)];
    r.eventCommands = [{ type: 'SaveEvent', commandId: 'case-link', event: { ...state.events.case, linkedTaskIds: ['work', 'next'] }, evidence: proof({ kind: 'planned', sources: ['event:case', 'npc:npc-a'], fact: '保留核验安排。' }) }];
    const projected = project(state, r); expect(projected.npc['npc-a']).toBeUndefined(); expect(projected.events.case.actorRefs).toEqual(state.events.case.actorRefs);
  });
  it('再出现必须复用稳定身份，不恢复不存在的旧关系；换ID或伪造身份拒绝', () => {
    const state = handoffState(), retired = project(state, retireCandidate(state));
    const command = DomainCommandSchema.parse({ type: 'CreateNpc', commandId: 'return', evidence: '该人物再次出现', npc: { ...npc(), onScene: false, affinity: 0, relationshipText: '尚未与主角接触', memories: [], knownInformation: [] } });
    const back = commitCommands(retired, 'later', retired.revision, [command]); expect(back.npc['npc-a'].identityKey).toBe(state.npc['npc-a'].identityKey);
    if (command.type !== 'CreateNpc') throw Error(); command.npc.id = 'new-id';
    expect(() => commitCommands(retired, 'later', retired.revision, [command])).toThrow();
  });
  it('V2迁移将既有NPC独立标记为待复核，V1链式升级，保持revision/journal和幂等；损坏档不洗白', () => {
    const state = handoffState(), v2 = { ...state, schemaVersion: 2 }; Reflect.deleteProperty(v2, 'retiredEvents'); Reflect.deleteProperty(v2, 'contactNpcIds'); Reflect.deleteProperty(v2, 'retiredNpcs'); Reflect.deleteProperty(v2, 'contactReviewNpcIds');
    const migrated = migrateSave(v2); expect(migrated.contactNpcIds).toEqual([]); expect([...migrated.contactReviewNpcIds].sort()).toEqual(Object.keys(state.npc).sort()); expect(migrated.revision).toBe(state.revision); expect(migrated.journal).toEqual(state.journal);
    expect(migrateSave(migrated)).toEqual(migrated);
    const v1 = { ...v2, schemaVersion: 1 }; Reflect.deleteProperty(v1, 'retiredEvents'); Reflect.deleteProperty(v1, 'weatherText'); Reflect.deleteProperty(v1, 'environmentText'); expect(migrateSave(v1).contactNpcIds).toEqual([]);
    expect(() => migrateSave({ ...v2, npc: { bad: npc() } })).toThrow();
  });
});


const resources: { dispose?: () => void; close?: () => void }[] = [];
afterEach(() => { resources.splice(0).reverse().forEach((r) => { r.dispose?.(); r.close?.(); }); vi.restoreAllMocks(); });
async function repository() { const repo = await SaveRepository.open('lifecycle', new IDBFactory()); resources.push(repo); await repo.create(handoffState()); return repo; }
function stage(repo: SaveRepository, fetcher: typeof fetch) { const runner = new WorldStage(repo, new AiClient(fetcher)); resources.push(runner); return runner; }
function config() {
  const config = defaultAiConfig(), channel = newChannel(); config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const map = new Map<string, string>(), store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-only');
  return { config, vault, settings: defaultSettings() };
}
const wire = (result: ReturnType<typeof worldResult>) => Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] });
async function prepared(repo: SaveRepository, raw?: ReturnType<typeof worldResult>) {
  const draft = await completeDraft(repo);
  if (!raw) return draft;
  const state = await repo.load('save-a'), result = parseWorld(JSON.stringify(raw), state, draft);
  return repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1, world: { ...draft.world!, candidateRevision: 2, result } }, draft.draftRevision);
}

describe('真实WorldStage、候选保存和原子正式结算', () => {
  it('连续多回合：世界因果→完成交接→临时人物退场→接班人继续→自然终结；刷新和回执不重复', async () => {
    const repo = await repository(), state = await repo.load('save-a'), initial = await prepared(repo);
    const raw = handoffResult(state); raw.worldCommands = [retireCommand(state)];
    const transport = vi.fn<typeof fetch>(async () => wire(raw));
    const saved = await stage(repo, transport).generate({ ...config(), draft: initial });
    expect(transport).toHaveBeenCalledTimes(1); expect(await repo.load('save-a')).toEqual(state);
    expect(saved.world?.result.taskCommands.find((c) => c.type === 'SaveTask' && c.task.id === 'work')).toMatchObject({ task: { resolution: { sourceTurnId: initial.turnId } } });
    const committed = await repo.commitTurn(submission(saved));
    expect(committed.state.npc['npc-a']).toBeUndefined(); expect(committed.state.tasks.next.status).toBe('active');
    expect(committed.state.tasks.work.actorRef.id).toBe('npc-a');
    const replay = await repo.commitTurn(submission(saved)); expect(replay.replayed).toBe(true); expect(replay.state).toEqual(committed.state);
    expect((await repo.loadGame('save-a')).state).toEqual(committed.state);
    const ctx = contextFor({ stage: 'world', mode: 'regular', state: committed.state, draft: { ...worldDraft(), turnId: committed.draft.turnId, baseSaveRevision: committed.state.revision,
      variables: { ...worldDraft().variables!, result: await elapsedVariables(repo, worldDraft().story!.narrative, 600) } }, settings: defaultSettings(), userInput: '' });
    expect(JSON.stringify(ctx.OFFSCREEN_STATE)).not.toContain('"id":"work"');
    expect(JSON.stringify(ctx.NPC_LIFECYCLE)).toContain('identity-npc-a');
    const nextDraft = await completeDraft(repo, { variables: await elapsedVariables(repo, worldDraft().story!.narrative, 600) });
    const ending = worldResult(); ending.taskCommands = [finishTask(committed.state, 'next', '2026-10-18T08:15:00+08:00')];
    const finished = await stage(repo, async () => wire(ending)).generate({ ...config(), draft: nextDraft });
    const next = await repo.commitTurn(submission(finished));
    expect(next.state.tasks.next.status).toBe('completed'); expect(Object.keys(next.state.tasks).sort()).toEqual(['next', 'work']);
    expect(next.state.journal).toHaveLength(2); expect(next.state.npc['npc-a']).toBeUndefined(); expect(next.state.npc['npc-b']).toBeDefined();
    expect(next.state.economy.cash).toBe(7000); // 只有首回合正文中的一次真实消费，交接没有发放任何资金。
    expect(JSON.stringify(playerView(next.state))).not.toContain(resultText);
  });
  it('联系人正式登记、刷新、完成任务后仍完整保留；世界不能注册联系人', async () => {
    const repo = await repository(), before = await repo.load('save-a');
    const fact = '主角与现场人物交换了联络方式。';
    const d = await completeDraft(repo, { narrative: fact, variables: { ...await elapsedVariables(repo, fact, 60), commands: [...(await elapsedVariables(repo, fact, 60)).commands,
      { type: 'RegisterContact', commandId: 'contact', npcId: 'scene', reason: '交换联络方式', evidence: fact }] } });
    const result = await repo.commitTurn(submission(d)); expect(result.state.contactNpcIds).toContain('scene');
    expect((await repo.load('save-a')).npc.scene).toEqual(before.npc.scene);
    const world = worldResult([{ type: 'RegisterContact', commandId: 'forged-contact', npcId: 'npc-a', reason: '任意', evidence: proof() }]);
    expect(() => parse(before, world)).toThrow();
  });
  it.each(['drafts', 'turnReceipts', 'abort'] as const)('%s 写失败全部回滚任务、人物、成果、journal及下一草稿，重试恰好一次', async (point) => {
    const repo = await repository(), raw = handoffResult(await repo.load('save-a')); raw.worldCommands = [retireCommand(await repo.load('save-a'))];
    const d = await prepared(repo, raw), before = await repo.loadGame('save-a');
    const put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add;
    if (point === 'drafts') vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) { if (this.name === point) throw new DOMException('mock quota', 'QuotaExceededError'); return put.call(this, value, key); });
    else vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) { if (this.name === 'turnReceipts' && point === 'turnReceipts') throw new DOMException('mock quota', 'QuotaExceededError'); const request = add.call(this, value, key); if (this.name === 'turnReceipts') request.addEventListener('success', () => this.transaction.abort()); return request; });
    await expect(repo.commitTurn(submission(d))).rejects.toThrow(); vi.restoreAllMocks(); expect(await repo.loadGame('save-a')).toEqual(before);
    const result = await repo.commitTurn(submission(d)); expect(result.state.npc['npc-a']).toBeUndefined(); expect(result.state.journal).toHaveLength(1);
  });
  it('Roll及重放不能删除正式NPC；过期候选CAS提交拒绝', async () => {
    const repo = await repository(), raw = handoffResult(await repo.load('save-a')); raw.worldCommands = [retireCommand(await repo.load('save-a'))];
    const d = await prepared(repo, raw), before = await repo.load('save-a');
    await repo.saveDraft(rerollStory(d, { ...d.story!, narrative: '主角改为在家阅读。' }), d.draftRevision);
    await expect(repo.commitTurn(submission(d))).rejects.toThrow(); expect(await repo.load('save-a')).toEqual(before);
    expect((await repo.loadDraft('save-a'))?.world).toBeUndefined();
  });
  it('取消或其他标签更新后，迟到的删除/交接响应不能写回', async () => {
    for (const cause of ['cancel', 'tab'] as const) {
      const repo = await repository(), initial = await prepared(repo), before = await repo.load('save-a');
      let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void; const active = new Promise<void>((resolve) => { started = resolve; });
      const raw = handoffResult(before); raw.worldCommands = [retireCommand(before)];
      const runner = stage(repo, async () => { started(); await waiting; return wire(raw); });
      const pending = runner.generate({ ...config(), draft: initial });
      const rejected = expect(pending).rejects.toThrow(); await active;
      if (cause === 'cancel') runner.cancel(); else {
        const current = (await repo.loadDraft('save-a'))!;
        await repo.saveDraft(rerollStory(current, { ...current.story!, narrative: '跨标签的新正文' }), current.draftRevision);
      }
      release(); await rejected; expect(await repo.load('save-a')).toEqual(before);
      expect((await repo.loadDraft('save-a'))?.world).toBeUndefined();
    }
  });
  it('隐藏调查成果仅在独立正文汇报后公开；已知重大结案可入时间线，普通事件无需入列', async () => {
    const repo = await repository();
    const state = await repo.load('save-a'), d = await prepared(repo);
    const secret = { ...event('investigation'), title: '材料核验结果', actorRefs: [{ kind: 'npc' as const, id: 'npc-a' }], status: 'resolved' as const, resolvedAt: actionTime, resolutionText: resultText, sourceTurnIds: [d.turnId] };
    const raw = { ...worldResult(), eventCommands: [{ type: 'SaveEvent' as const, commandId: 'secret', event: secret,
      evidence: proof({ sources: ['npc:npc-a'], fact: '核验记录已经整理。', outcome: resultText }) }] };
    const validated = parseWorld(JSON.stringify(raw), state, d);
    const ready = await repo.saveDraft({ ...d, draftRevision: d.draftRevision + 1, world: { ...d.world!, candidateRevision: 2, result: validated } }, d.draftRevision);
    const first = await repo.commitTurn(submission(ready));
    expect(first.state.timeline).toEqual([]); expect(JSON.stringify(playerView(first.state))).not.toContain(resultText);
    expect(recallHistory(historyRecords(first.state.journal), '登记编号318', new Set())).toEqual([]);
    const fact = `主角收到了核验结果：${resultText}`;
    const draft = await completeDraft(repo, { narrative: fact, variables: await elapsedVariables(repo, fact, 600) });
    const disclosed = { ...secret, visibility: 'known' as const, sourceTurnIds: [d.turnId, draft.turnId] };
    const result = { ...worldResult(), eventCommands: [{ type: 'SaveEvent' as const, commandId: 'disclosure', event: disclosed,
      evidence: proof({ at: '2026-10-18T08:15:00+08:00', kind: 'established', sources: ['story:current', 'npc:npc-a'], fact: resultText }) }], timelineCandidates: ['investigation'] };
    // 已结案事件不可重写：改公开状态属于未来正式揭示协议，本轮必须拒绝而非绕过终态。
    expect(() => parseWorld(JSON.stringify(result), first.state, draft)).toThrow();
    const publicEvent = { ...disclosed, id: 'public-report', startAt: '2026-10-18T08:15:00+08:00', resolvedAt: '2026-10-18T08:15:00+08:00', estimatedEndAt: '2026-10-18T08:20:00+08:00' };
    const publicResult = { ...worldResult(), eventCommands: [{ ...result.eventCommands[0], event: publicEvent }], timelineCandidates: [publicEvent.id] };
    publicEvent.sourceTurnIds = [draft.turnId];
    const checked = parseWorld(JSON.stringify(publicResult), first.state, draft);
    const accepted = await repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1, world: { ...draft.world!, candidateRevision: 2, result: checked } }, draft.draftRevision);
    const final = await repo.commitTurn(submission(accepted)); expect(final.state.timeline).toHaveLength(1); expect(JSON.stringify(playerView(final.state))).toContain(resultText);
    expect(final.state.events.investigation.visibility).toBe('hidden');
  });
});

// 针对生命周期增量本身的回归；没有删除原安全边界测试。
describe('连续因果、旧候选和历史参与者', () => {
  it('三回合真实运行：主角递交材料后介入→处理交接退场→接班人自然结束，不产生第三项接班任务', async () => {
    const repo = await SaveRepository.open('causal-chain', new IDBFactory()); resources.push(repo);
    const initial = handoffState(); initial.tasks = {}; await repo.create(initial);
    const fact = '主角将材料交到值班窗口，随后在外等候。';
    const first = await completeDraft(repo, { narrative: fact, variables: await elapsedVariables(repo, fact, 600) });
    const job = { ...task('work'), goal: '核对窗口材料', actorRef: { kind: 'npc' as const, id: 'npc-a' }, status: 'active' as const, startAt: '2026-10-18T08:05:00+08:00', dueAt: '2026-10-18T08:09:00+08:00' };
    const planned = { ...worldResult(), taskCommands: [{ type: 'SaveTask' as const, commandId: 'intervene', task: job, evidence: proof({ sources: ['npc:npc-a'], fact: '核对人依值班职责接下窗口材料。' }) }] };
    const running = await stage(repo, async () => wire(planned)).generate({ ...config(), draft: first });
    const round1 = await repo.commitTurn(submission(running)); expect(round1.state.tasks.work.status).toBe('active');
    const second = await completeDraft(repo, { narrative: '主角继续在外等候。', variables: await elapsedVariables(repo, '主角继续在外等候。', 600) });
    const done = finishTask(round1.state, 'work', '2026-10-18T08:15:00+08:00'), receive = receiveTask();
    receive.task.startAt = '2026-10-18T08:16:00+08:00'; receive.task.handoff!.at = receive.task.startAt;
    receive.evidence = proof({ at: receive.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: resultText });
    const retiring = retireCommand(round1.state), retirementProof = JSON.parse(retiring.evidence); retirementProof.at = '2026-10-18T08:18:00+08:00'; retiring.evidence = JSON.stringify(retirementProof);
    const middle = { ...worldResult([retiring]), taskCommands: [receive, done] };
    const middleReady = await stage(repo, async () => wire(middle)).generate({ ...config(), draft: second });
    const round2 = await repo.commitTurn(submission(middleReady)); expect(round2.state.npc['npc-a']).toBeUndefined(); expect(round2.state.tasks.work.resolution?.at).toBe('2026-10-18T08:15:00+08:00');
    const third = await completeDraft(repo, { narrative: '主角整理自己的笔记。', variables: await elapsedVariables(repo, '主角整理自己的笔记。', 600) });
    const ending = { ...worldResult(), taskCommands: [finishTask(round2.state, 'next', '2026-10-18T08:25:00+08:00')] };
    const final = await stage(repo, async () => wire(ending)).generate({ ...config(), draft: third });
    const round3 = await repo.commitTurn(submission(final));
    expect(Object.keys(round3.state.tasks)).toHaveLength(2); expect(Object.values(round3.state.tasks).every((t) => t.status === 'completed')).toBe(true);
    expect(round3.state.journal).toHaveLength(3); expect(round3.state.memories.short).toHaveLength(3); expect(round3.state.tasks.work.actorRef.id).toBe('npc-a');
  });
  it('退场原参与者保留在未完事件因果中，后续组织仍可合法结案；不重新执行已退场NPC行动', () => {
    const state = handoffState(); state.tasks.work.linkedEventId = 'case'; state.events.case = { ...event('case'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], linkedTaskIds: ['work'], estimatedEndAt: '2026-10-18T09:00:00+08:00' };
    const r = handoffResult(state, { kind: 'organization', id: 'org-a' }); r.worldCommands = [retireCommand(state)];
    const next = r.taskCommands[0]; if (next.type !== 'SaveTask') throw Error(); next.task.linkedEventId = 'case';
    r.eventCommands = [{ type: 'SaveEvent', commandId: 'link', event: { ...state.events.case, linkedTaskIds: ['work', 'next'] }, evidence: proof({ kind: 'planned', sources: ['event:case', 'npc:npc-a'], fact: '机构接下后续核验安排。' }) }];
    const retired = project(state, r), draft = worldDraft(); draft.baseSaveRevision = retired.revision;
    draft.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', worldClock: '2026-10-18T08:20:00+08:00', evidence: draft.story!.narrative }];
    const ended = finishTask(retired, 'next', '2026-10-18T08:15:00+08:00');
    const finishEvent: DomainCommand = { type: 'SaveEvent', commandId: 'close-case', event: { ...retired.events.case, status: 'resolved', resolvedAt: '2026-10-18T08:16:00+08:00', resolutionText: resultText },
      evidence: proof({ at: '2026-10-18T08:16:00+08:00', sources: ['event:case', 'task:next', 'org:org-a'], fact: '机构核验记录与清单一致。', decision: { targetId: 'case', status: 'resolved', result: resultText, reason: '逐份核验，所需登记一致', conditionsSatisfied: true, continues: false } }) };
    const candidate = { ...worldResult(), taskCommands: [ended], eventCommands: [finishEvent] };
    const result = parseWorld(JSON.stringify(candidate), retired, draft);
    const projected = projectTurn(retired, draft, commands(result)); expect(projected.events.case.status).toBe('resolved'); expect(projected.npc['npc-a']).toBeUndefined();
  });
  it('世界AI可先创建必要接收人物再承接，但不自动新建人物或授予其他秘密', () => {
    const state = handoffState(), r = handoffResult(state, { kind: 'npc', id: 'new-person' });
    r.worldCommands = [{ type: 'CreateNpc', commandId: 'new-person', npc: { ...npc('new-person'), name: '登记员', onScene: false, affinity: 0, relationshipText: '尚未与主角接触', memories: [], knownInformation: [] },
      evidence: proof({ at: actionTime, sources: ['org:org-a'], fact: '机构已有专门负责登记核验的工作人员。' }) }];
    const result = project(state, r); expect(result.npc['new-person'].memories).toEqual([]); expect(result.tasks.next.actorRef.id).toBe('new-person');
  });
  it('旧协议结果先规范化保存才能正式结算，不移除候选完整性校验；重复提交幂等', async () => {
    const repo = await repository(), state = await repo.load('save-a'), c = finishTask(state);
    c.evidence = proof({ sources: ['task:work', 'npc:npc-a'], fact: '同事逐份完成了材料核对。', outcome: resultText });
    const raw = { ...worldResult(), taskCommands: [c] }, d = await completeDraft(repo, { world: raw });
    const before = await repo.loadGame('save-a'); await expect(repo.commitTurn(submission(d))).rejects.toThrow('世界候选需先保存'); expect(await repo.loadGame('save-a')).toEqual(before);
    const corrected = await stage(repo, async () => wire(raw)).generate({ ...config(), draft: d });
    const accepted = await repo.commitTurn(submission(corrected)); expect(accepted.state.tasks.work.resolution?.result).toBe(resultText);
    expect((await repo.commitTurn(submission(corrected))).replayed).toBe(true);
  });
});


describe('退场资料与公开记忆压缩兼容', () => {
  it('局部NPC经历保留来源但不冒充整回合压缩覆盖，也不遮蔽公开短期摘要', () => {
    const state = handoffState();
    state.journal = [{ turnId: 'past', revision: 0, story: { ...worldDraft().story!, summary: '主角提交材料并在街边遇到另一位熟人。' }, relatedActorRefs: [] }]; state.turnNumber = 1;
    state.memories.short = [{ id: 'short-past', text: state.journal[0].story.summary, sourceTurnIds: ['past'], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock }];
    state.npc['npc-a'].memories = [{ id: 'one-observation', text: '主角提交了材料。', knowledgeSource: '亲眼看到', sourceTurnIds: ['past'], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock }];
    const r = { ...worldResult([retireCommand(state)]), taskCommands: [finishTask(state)] };
    const projected = project(state, r);
    expect(publicShortMemories(projected)).toMatchObject([{ id: 'short-past' }]);
    expect(compressionCandidates(projected, 'short')).toHaveLength(1);
    projected.journal.push({ turnId: 'recent', revision: 0, story: { ...worldDraft().story!, summary: '最近的街边休息' }, relatedActorRefs: [] }); projected.turnNumber++;
    const ctx = storyMemoryContext(projected, 1, '', false);
    expect(ctx.summaries.some((entry) => entry.id === 'short-past')).toBe(true);
    expect(projected.memories.long[0].retiredNpcSource).toMatchObject({ npcId: 'npc-a', sourceMemoryId: 'one-observation', knowledgeKind: 'unknown' });
    expect(projected.memories.long[0].sourceTurnIds).toEqual(['past']);
  });
  it('同批引用前序条件时按依赖排序，不接受循环条件与回填过去的交接', () => {
    const state = handoffState(), r = handoffResult(state), receiver = r.taskCommands[0];
    if (receiver.type !== 'SaveTask') throw Error(); receiver.task.prerequisites = ['task:work'];
    expect(() => parse(state, r)).not.toThrow();
    receiver.task.handoff!.at = '2026-10-18T07:59:00+08:00'; expect(() => parse(state, r)).toThrow();
  });
});

describe('新决策不是固定措辞分类器', () => {
  it('肯定成果可用否定句式表达，不因“没有遗漏”误伤；明确状态与决策矛盾仍拒绝', () => {
    const state = handoffState(), c = finishTask(state), raw = JSON.parse(c.evidence);
    raw.fact = '清单没有遗漏，三份材料与记录相符。'; c.evidence = JSON.stringify(raw);
    expect(() => parse(state, { ...worldResult(), taskCommands: [c] })).not.toThrow();
    raw.decision.status = 'blocked'; c.evidence = JSON.stringify(raw);
    expect(() => parse(state, { ...worldResult(), taskCommands: [c] })).toThrow();
  });
});

describe('历史只读回合的生命周期边界', () => {
  it('明确回顾过去仍不能退场NPC或推进后台职责', () => {
    const state = handoffState(); state.tasks = {};
    const draft = worldDraft(); draft.userInput = '切换到同事的视角，回顾昨天的事情。';
    draft.story = { ...draft.story!, narrative: '昨天，同事在楼下核对材料。', variableGuide: [{ group: 'time', subjectHint: 'time:retrospective',
      observedFact: JSON.stringify({ npcId: 'npc-a', perspectiveRequest: '切换到同事的视角', pastRequest: '回顾昨天的事情', temporalScope: 'past_only', currentPlotAdvances: false }), textEvidence: '昨天，同事在楼下核对材料。' }] };
    draft.variables!.result.commands = [];
    const retire = retireCommand(state), raw = JSON.parse(retire.evidence); raw.at = state.worldClock; retire.evidence = JSON.stringify(raw);
    const before = structuredClone(state); expect(() => parse(state, worldResult([retire]), draft)).toThrow(); expect(state).toEqual(before);
  });
});

describe('真实IndexedDB旧档升级与回执', () => {
  it('V2档与已有回执升级后可读取、重放并继续；正式revision和原文不变', async () => {
    const factory = new IDBFactory(), repo = await SaveRepository.open('old-v2', factory); resources.push(repo); await repo.create(handoffState());
    const draft = await completeDraft(repo), first = await repo.commitTurn(submission(draft));
    const v2 = { ...first.state, schemaVersion: 2 }; Reflect.deleteProperty(v2, 'retiredEvents'); Reflect.deleteProperty(v2, 'contactNpcIds'); Reflect.deleteProperty(v2, 'retiredNpcs'); Reflect.deleteProperty(v2, 'contactReviewNpcIds');
    const db = await new Promise<IDBDatabase>((resolve) => { const request = factory.open('old-v2'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(v2); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    const upgraded = await repo.load('save-a'); expect(upgraded.schemaVersion).toBe(5); expect(upgraded.revision).toBe(first.state.revision); expect(upgraded.journal).toEqual(first.state.journal);
    expect(upgraded.contactNpcIds).toEqual([]); expect([...upgraded.contactReviewNpcIds].sort()).toEqual(Object.keys(upgraded.npc).sort());
    const replay = await repo.commitTurn(submission(draft)); expect(replay.replayed).toBe(true); expect(replay.state).toEqual(upgraded);
    const next = await completeDraft(repo, { variables: await elapsedVariables(repo, worldDraft().story!.narrative, 600) });
    expect((await repo.commitTurn(submission(next))).state.turnNumber).toBe(2);
  });
});

describe('退场后的交接来源', () => {
  it('原人物已退场后不能凭旧任务成果伪造现在由其传出的私人报告', () => {
    const state = handoffState(), initial = handoffResult(state); initial.worldCommands = [retireCommand(state)];
    const retired = project(state, initial), draft = worldDraft(); draft.baseSaveRevision = retired.revision;
    draft.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', worldClock: '2026-10-18T08:20:00+08:00', evidence: draft.story!.narrative }];
    const receiver = receiveTask({ kind: 'organization', id: 'org-a' }, 'late-report'); receiver.task.startAt = '2026-10-18T08:16:00+08:00'; receiver.task.handoff!.at = '2026-10-18T08:15:00+08:00';
    receiver.evidence = proof({ at: '2026-10-18T08:15:00+08:00', sources: ['task:work', 'org:org-a'], fact: resultText });
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), taskCommands: [receiver] }), retired, draft)).toThrow();
  });
});

describe('联系人及特殊NPC正向正式结算', () => {
  it.each(['contact', 'special'] as const)('%s 完成职责：联系人完整保留，非联系人特殊NPC无剩余职责可正式退场', async (kind) => {
    const state = handoffState();
    if (kind === 'contact') state.contactNpcIds = ['npc-a'];
    else state.npc['npc-a'] = { ...worldState().npc['npc-a'], kind: 'special', detailedBackground: '临时核验岗位', activeGoals: [], habits: [], longTermMemories: [], offscreenTaskIds: ['work'] };
    const repo = await SaveRepository.open(`positive-${kind}`, new IDBFactory()); resources.push(repo); await repo.create(state);
    const d = await prepared(repo), raw = { ...worldResult(), taskCommands: [finishTask(state)] };
    if (kind === 'special') raw.worldCommands = [retireCommand(state)];
    const ready = await stage(repo, async () => wire(raw)).generate({ ...config(), draft: d });
    const committed = await repo.commitTurn(submission(ready)); expect(committed.state.tasks.work.status).toBe('completed');
    if (kind === 'contact') { expect(committed.state.npc['npc-a']).toEqual(state.npc['npc-a']); expect(committed.state.contactNpcIds).toEqual(['npc-a']); }
    else { expect(committed.state.npc['npc-a']).toBeUndefined(); expect(committed.state.retiredNpcs['npc-a'].identityKey).toBe(state.npc['npc-a'].identityKey); }
  });
});
