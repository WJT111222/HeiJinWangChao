import { variableTextEnvelope } from './fixtures/variableReply';
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { parseWorld, parseTextVariables, parseVariables } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { playerView } from '../ui/panels/playerView';
import { completeDraft, submission } from './fixtures/turn';
import { event, organizations, npc } from './fixtures/game';
import { worldState, worldDraft, worldResult, proof, actionTime } from './fixtures/world';

const repos: SaveRepository[] = [];
afterEach(() => repos.splice(0).forEach(repo => repo.close()));
const visibilities = ['known', 'partially_known', 'hidden'] as const;
function prepared(visibility: typeof visibilities[number], actor: 'npc' | 'organization' = 'npc') {
  const state = worldState(), draft = worldDraft(true, 'opening');
  state.organizations['org-a'] = structuredClone(organizations[3]);
  state.events.investigation = { ...event('investigation'), title: '此前听说的资金调查', status: 'active', visibility,
    actorRefs: [{ kind: actor, id: actor === 'npc' ? 'npc-a' : 'org-a' }], estimatedEndAt: actionTime,
    impact: 'significant', sourceTurnIds: [] };
  return { state, draft };
}
function update(a: ReturnType<typeof prepared>, status: 'blocked' | 'success' | 'failure' = 'blocked'): Extract<DomainCommand, { type: 'SaveEvent' }> {
  const fact = status === 'blocked' ? '调查因缺少原始单据而受阻。' : status === 'success' ? '调查已完成并核对了全部单据。' : '原始单据毁损，调查以失败结束。';
  const old = a.state.events.investigation;
  return { type: 'SaveEvent', commandId: `investigation-${status}`, evidence: proof({ sources: ['event:investigation', 'npc:npc-a', 'org:org-a'], fact,
    decision: { targetId: old.id, status: status === 'blocked' ? 'blocked' : 'resolved', reason: '核验原始单据的实际进展', result: fact,
      conditionsSatisfied: status === 'success', continues: status === 'blocked', ...(status === 'failure' ? { failure: true } : {}),
      ...(status === 'blocked' ? {} : { resultKnowledge: { facts: [fact], reported: [], suspected: [] } }) } }),
    event: { ...old, status: status === 'blocked' ? 'blocked' : 'resolved', sourceTurnIds: [a.draft.turnId],
      ...(status === 'blocked' ? { estimatedEndAt: '2026-10-19T08:00:00+08:00' }
        : { resolvedAt: actionTime, resolutionText: fact, outcome: status, resultKnowledge:{facts:[fact],reported:[],suspected:[]} }) } };
}
const parse = (a: ReturnType<typeof prepared>, command: DomainCommand) => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [command] }), a.state, a.draft);
const storyEvents = (state: ReturnType<typeof worldState>) => contextFor({ state, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: '继续整理衣物' }).KNOWN_EVENTS;

describe('第三轮：世界事件自主变化不要求角色先知晓', () => {
  it.each(visibilities.flatMap(visibility => (['npc', 'organization'] as const).map(actor => ({ visibility, actor }))))('$visibility / $actor：到期合法derived受阻延期通过，角色知情不变', ({ visibility, actor }) => {
    const a = prepared(visibility, actor), before = structuredClone(a.state), known = storyEvents(a.state);
    const result = parse(a, update(a)), after = projectTurn(a.state, a.draft, result.eventCommands);
    expect(after.events.investigation).toMatchObject({ status: 'blocked', visibility, estimatedEndAt: '2026-10-19T08:00:00+08:00' });
    expect(after.npc).toEqual(before.npc); expect(after.protagonist).toEqual(before.protagonist); expect(after.memories).toEqual(before.memories);
    expect(storyEvents(after)).toEqual(known);
    expect(playerView(after).events[0].status).toBe('blocked'); expect(a.state).toEqual(before);
  });
  it.each(visibilities.flatMap(visibility => (['success', 'failure'] as const).map(status => ({ visibility, status }))))('$visibility / $status：完成和失败依据客观来源结算，不传播结果', ({ visibility, status }) => {
    const a = prepared(visibility), known = storyEvents(a.state), before = structuredClone(a.state);
    if (status === 'failure') a.state.events.investigation.blockers = ['缺失无法补回的原始材料'];
    const result = parse(a, update(a, status)), after = projectTurn(a.state, a.draft, result.eventCommands);
    expect(after.events.investigation).toMatchObject({ status: 'resolved', outcome: status, visibility });
    expect(storyEvents(after)).toEqual(known); expect(after.npc).toEqual(before.npc);
  });
  it('真实IndexedDB候选、Commit、刷新和回执重放保留旧认知；未发布成果不进入正文', async () => {
    const a = prepared('known'), before = structuredClone(a.state), known = storyEvents(a.state);
    const repo = await SaveRepository.open('world-event-knowledge', new IDBFactory()); repos.push(repo);
    await repo.create(a.state); await repo.saveDraft(createTurnDraft(a.state.saveId, 0, a.draft.turnId, 'opening', ''), null);
    const result = parse(a, update(a, 'success'));
    const draft = await completeDraft(repo, { world: result });
    expect((await repo.load(a.state.saveId))).toEqual(before);
    const committed = await repo.commitTurn(submission(draft));
    expect(committed.state.events.investigation.status).toBe('resolved'); expect(storyEvents(committed.state)).toEqual(known);
    expect(committed.state.npc).toEqual(before.npc); expect(committed.state.memories.short.at(-1)?.text).toBe(draft.story!.summary);
    expect((await repo.commitTurn(submission(draft))).replayed).toBe(true);
    expect(storyEvents(await repo.load(a.state.saveId))).toEqual(known);
    const next = worldDraft(true, 'regular'); next.turnId = 'turn-next'; next.baseSaveRevision = committed.state.revision;
    next.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'next-clock', worldClock: '2026-10-18T08:20:00+08:00', evidence: '本轮经过十分钟' }];
    const fact = committed.state.events.investigation.resultKnowledge!.facts[0];
    committed.state.npc['npc-b'] = { ...npc('npc-b'), onScene: false };
    const memory: DomainCommand = { type: 'RecordNpcMemory', commandId: 'borrow-event', npcId: 'npc-b', expectedRevision: committed.state.revision,
      layer: 'personal', knowledgeKind: 'observed', addToKnownInformation: false,
      evidence: proof({ kind: 'established', at: '2026-10-18T08:15:00+08:00', sources: ['event:investigation'], fact }),
      memory: { id: 'stolen-progress', text: fact, knowledgeSource: 'event:investigation', visibility: 'npc_private', createdAtGameTime: '2026-10-18T08:15:00+08:00', sourceTurnIds: [next.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }] } };
    expect(() => parseWorld(JSON.stringify(worldResult([memory])), committed.state, next)).toThrow();
  });
  it('存量正式版本与visibility保持合法读取', () => {
    for (const visibility of visibilities) expect(GameStateSchema.parse(prepared(visibility).state).events.investigation.visibility).toBe(visibility);
  });
  it('程序规范化后的候选可重复验证，快照和来源不重复叠加', () => {
    const a = prepared('known'), result = parse(a, update(a));
    expect(parseWorld(JSON.stringify(result), a.state, a.draft)).toEqual(result);
    expect(result.eventCommands[0]).toMatchObject({ event: { protagonistKnowledge: { status: 'active', worldUpdateTurnId: a.draft.turnId } } });
  });
  it('模型不能编造主角已知快照', () => {
    const a = prepared('known'), command = update(a);
    command.event.protagonistKnowledge = { worldUpdateTurnId: a.draft.turnId, title: '凭空得知的结果', startAt: command.event.startAt, status: 'resolved', resolutionText: '主角已经获悉' };
    expect(() => parse(a, command)).toThrow();
  });
  it('后续合法现场观察可更新已知状态，但不能篡改程序快照', async () => {
    const a = prepared('known'), repo = await SaveRepository.open('event-scene-observation', new IDBFactory()); repos.push(repo);
    await repo.create(a.state); await repo.saveDraft(createTurnDraft(a.state.saveId, 0, a.draft.turnId, 'opening', ''), null);
    const saved = await completeDraft(repo, { world: parse(a, update(a)) });
    const after = (await repo.commitTurn(submission(saved))).state;
    after.npc['npc-a'].onScene = true;
    const next = worldDraft(true); next.turnId = 'scene-next'; next.baseSaveRevision = after.revision;
    const result = await parseTextVariables(variableTextEnvelope('<命令>set events[investigation].sceneState = {"status":"active"}</命令>'), after, next);
    const observed = projectTurn(after, { ...next, variables: { ...next.variables!, result } });
    expect(storyEvents(observed)).toContainEqual(expect.objectContaining({ status: 'active', title: a.state.events.investigation.title }));
    // 现场状态可被观察，但旧World私下修改的规划/背景不能借此全部变成人物来源。
    const forged = structuredClone(result), command = forged.commands[0];
    if (command.type !== 'SaveEvent') throw Error('fixture');
    command.event.protagonistKnowledge = undefined;
    expect(() => parseVariables(JSON.stringify(forged), after, next)).toThrow();
  });
  it('时间预检不把未告知的场外新标题与排程当成主角已知线索', () => {
    const a = prepared('known');
    a.state.events.investigation.impact = 'major';
    a.state.events.investigation.locationId = a.state.protagonist.locationId;
    const command = update(a); command.event = { ...command.event, status: 'active', title: '场外新消息：事故封路', estimatedEndAt: '2026-10-18T08:20:00+08:00' };
    command.evidence = proof({ sources: ['event:investigation', 'npc:npc-a'], fact: '同事按安排继续调查。' });
    const after = projectTurn(a.state, a.draft, parse(a, command).eventCommands);
    const context = contextFor({ state: after, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: '在家等待两小时' });
    expect(JSON.stringify(context)).not.toContain('事故封路');
  });
});
