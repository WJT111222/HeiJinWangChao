import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ActorRef } from '../domain/common';
import { createTurnDraft } from '../domain/drafts';
import type { DomainCommand } from '../domain/commands';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { parseTextVariables, parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { event, organizations } from './fixtures/game';
import { worldState, worldDraft, worldResult, proof } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';

const repos: SaveRepository[] = [];
afterEach(() => repos.splice(0).forEach(repo => repo.close()));
const org: ActorRef = { kind: 'organization', id: 'org-a' };
const hero: ActorRef = { kind: 'protagonist', id: 'hero' };
const text = '<命令>set events[incident].sceneState = {"status":"blocked"}</命令>';
function fixture(actors: ActorRef[] = [org]) {
  const state = worldState(), draft = worldDraft(false, 'opening');
  state.organizations['org-a'] = structuredClone(organizations[3]);
  state.events.incident = { ...event('incident'), status: 'active', actorRefs: actors,
    locationId: state.protagonist.locationId, estimatedEndAt: '2026-10-19T08:00:00+08:00', impact: 'minor', sourceTurnIds: [] };
  return { state, draft, context: { draft, expectedRevision: state.revision } };
}
function candidate(a: ReturnType<typeof fixture>) {
  const command: DomainCommand = { type: 'SaveEvent', commandId: 'bypass-event', evidence: '变量状态更新',
    event: { ...a.state.events.incident, status: 'blocked', sourceTurnIds: [a.draft.turnId] } };
  return { commands: [command], rejectedSuggestions: [], unresolved: [] };
}
async function compiled(a: ReturnType<typeof fixture>, input = text) {
  const parsed = parseVariableText(input); if (!parsed.ok) throw Error('fixture syntax');
  const plan = await compileVariableCommands(parsed.value, a.state, a.context);
  if (!plan.ok) throw Error('fixture compile');
  return plan.value;
}
async function repository(a: ReturnType<typeof fixture>) {
  const repo = await SaveRepository.open('scene-event-permission', new IDBFactory()); repos.push(repo);
  await repo.create(a.state);
  await repo.saveDraft(createTurnDraft(a.state.saveId, 0, a.draft.turnId, 'opening', ''), null);
  return repo;
}

describe('PR50现场事件权限漏洞复现', () => {
  it('纯组织事件不能作为文本Variables结果，即使其地点与主角相同', async () => {
    const a = fixture(), before = structuredClone(a.state);
    await expect(parseTextVariables(text, a.state, a.draft)).rejects.toMatchObject({ code: 'data_integrity' });
    expect(a.state).toEqual(before);
  });
  it('独立内存模拟也不能接受纯组织事件计划', async () => {
    const a = fixture(), before = structuredClone(a.state);
    const out = await simulateVariablePlan(await compiled(a), a.state, a.context);
    expect(out).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(out).not.toHaveProperty('value'); expect(a.state).toEqual(before);
  });
  it('直接提交规范化领域候选不能绕过变量解析权限', () => {
    const a = fixture();
    expect(() => parseVariables(JSON.stringify(candidate(a)), a.state, a.draft)).toThrow();
  });
  it('伪造validated候选经真实IndexedDB正式提交时仍拒绝，整对象及草稿保留', async () => {
    const a = fixture(), repo = await repository(a);
    const draft = await completeDraft(repo, { variables: candidate(a), world: worldResult() });
    const before = await repo.loadGame(a.state.saveId);
    await expect(repo.commitTurn(submission(draft))).rejects.toMatchObject({ code: 'data_integrity' });
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
  });
  it('合法主角现场事件仍可生成变量候选', async () => {
    const a = fixture([hero]);
    expect((await parseTextVariables(text, a.state, a.draft)).commands[0]).toMatchObject({ type: 'SaveEvent', event: { status: 'blocked' } });
  });
  it('同一纯组织事件仍可通过原World来源和权限协议更新', () => {
    const a = fixture(), draft = worldDraft(true, 'opening');
    const result = parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [{ type: 'SaveEvent', commandId: 'world-event',
      event: { ...a.state.events.incident, status: 'blocked', sourceTurnIds: [draft.turnId] },
      evidence: proof({ sources: ['event:incident', 'org:org-a'], fact: '组织清点暂时受阻。', decision: {
        targetId: 'incident', status: 'blocked', reason: '材料尚未齐备', result: '等待补齐材料', conditionsSatisfied: false, continues: true,
      } }),
    }] }), a.state, draft);
    expect(result.eventCommands).toHaveLength(1);
  });
});

const sceneNpc: ActorRef = { kind: 'npc', id: 'scene' };
const offscreenNpc: ActorRef = { kind: 'npc', id: 'npc-a' };
const deniedCases: Array<{ name: string; actors: ActorRef[] }> = [
  { name: '空参与者旧事件', actors: [] },
  { name: '仅离场NPC', actors: [offscreenNpc] },
  { name: '现场与离场NPC混合', actors: [sceneNpc, offscreenNpc] },
  { name: '主角与离场NPC混合', actors: [hero, offscreenNpc] },
  { name: '组织与离场NPC混合', actors: [org, offscreenNpc] },
];
describe('共享现场权限的正反边界', () => {
  it.each(deniedCases)('$name：文本、模拟和规范候选一致拒绝', async ({ actors }) => {
    const a = fixture(actors), before = structuredClone(a.state);
    await expect(parseTextVariables(text, a.state, a.draft)).rejects.toMatchObject({ code: 'data_integrity' });
    const out = await simulateVariablePlan(await compiled(a), a.state, a.context);
    expect(out).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(out).not.toHaveProperty('value');
    expect(() => parseVariables(JSON.stringify(candidate(a)), a.state, a.draft)).toThrow();
    expect(a.state).toEqual(before);
  });
  it.each(deniedCases.filter(c => c.name === '空参与者旧事件' || c.name === '现场与离场NPC混合'))('$name：伪造validated也不能落库', async ({ actors }) => {
    const a = fixture(actors), repo = await repository(a);
    const draft = await completeDraft(repo, { variables: candidate(a), world: worldResult() }), before = await repo.loadGame(a.state.saveId);
    await expect(repo.commitTurn(submission(draft))).rejects.toMatchObject({ code: 'data_integrity' });
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
  });
  it.each([
    { name: '实际在场NPC', actors: [sceneNpc] },
    { name: '主角与在场NPC', actors: [hero, sceneNpc] },
    { name: '组织与在场NPC', actors: [org, sceneNpc] },
  ])('$name：文本、模拟、候选复核与正式原子提交通过，重放幂等', async ({ actors }) => {
    const a = fixture(actors), before = structuredClone(a.state);
    const out = await simulateVariablePlan(await compiled(a), a.state, a.context);
    expect(out).toMatchObject({ ok: true, value: { events: { incident: { status: 'blocked' } } } });
    const result = await parseTextVariables(text, a.state, a.draft);
    expect(parseVariables(JSON.stringify(result), a.state, a.draft)).toEqual(result);
    expect(a.state).toEqual(before);
    const repo = await repository(a), draft = await completeDraft(repo, { variables: result, world: worldResult() });
    const committed = await repo.commitTurn(submission(draft));
    expect(committed.state.events.incident.status).toBe('blocked');
    expect((await repo.commitTurn(submission(draft))).replayed).toBe(true);
    expect((await repo.load(a.state.saveId)).events.incident.status).toBe('blocked');
  });
  it.each(['arrival', 'departure'] as const)('%s：使用本幕正式现场与整批合法投影，合法入/离场不误伤', async mode => {
    const actor = mode === 'arrival' ? offscreenNpc : sceneNpc, a = fixture([actor]);
    const input = `<命令>\nset npc[${actor.id}].onScene = ${mode === 'arrival'}\nset events[incident].sceneState = {"status":"blocked"}\n</命令>`;
    const result = await parseTextVariables(input, a.state, a.draft);
    expect(parseVariables(JSON.stringify(result), a.state, a.draft)).toEqual(result);
    const simulation = await simulateVariablePlan(await compiled(a, input), a.state, a.context);
    expect(simulation.ok).toBe(true);
    const repo = await repository(a), draft = await completeDraft(repo, { variables: result, world: worldResult() });
    const committed = await repo.commitTurn(submission(draft));
    expect(committed.state.events.incident.status).toBe('blocked');
    expect(committed.state.npc[actor.id].onScene).toBe(mode === 'arrival');
  });
  it('不能给纯组织事件伪加主角参与者获得现场权限', async () => {
    const a = fixture(), result = candidate(a), command = result.commands[0];
    if (command.type !== 'SaveEvent') throw Error('fixture command');
    command.event.actorRefs = [hero];
    expect(() => parseVariables(JSON.stringify(result), a.state, a.draft)).toThrow();
    const repo = await repository(a), draft = await completeDraft(repo, { variables: result, world: worldResult() });
    const before = await repo.loadGame(a.state.saveId);
    await expect(repo.commitTurn(submission(draft))).rejects.toMatchObject({ code: 'data_integrity' });
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
  });
  it('前面合法人物更新不能在后续组织事件越权时部分成功', async () => {
    const a = fixture(), before = structuredClone(a.state);
    const input = '<命令>\nset protagonist.emotionText = "安心"\nset events[incident].sceneState = {"status":"blocked"}\n</命令>';
    await expect(parseTextVariables(input, a.state, a.draft)).rejects.toMatchObject({ code: 'data_integrity' });
    const simulation = await simulateVariablePlan(await compiled(a, input), a.state, a.context);
    expect(simulation).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(simulation).not.toHaveProperty('value'); expect(a.state).toEqual(before);
  });
});

it('直接伪造候选也不能把新事件冒充既有现场事件', () => {
  const a = fixture([hero]), result = candidate(a), command = result.commands[0];
  if (command.type !== 'SaveEvent') throw Error('fixture command');
  command.event.id = 'new-incident';
  expect(() => parseVariables(JSON.stringify(result), a.state, a.draft)).toThrow();
});

describe('现场事件不授予Variables整对象写权限', () => {
  const changes = {
    estimatedEndAt: '2026-10-20T08:00:00+08:00', impact: 'major', title: '被篡改标题',
    backgroundText: '被篡改背景', goalText: '被篡改目标', locationId: undefined,
    visibility: 'known', prerequisites: ['event:incident'], blockers: ['task:unknown'],
    linkedTaskIds: ['unknown'], predecessorEventIds: ['incident'], sourceTurnIds: [],
  };
  it.each(Object.entries(changes))('%s：规范化候选及正式提交均拒绝', async (field, value) => {
    const a = fixture([hero]), result = candidate(a), command = result.commands[0];
    if (command.type !== 'SaveEvent') throw Error('fixture');
    Object.assign(command.event, { [field]: value });
    expect(() => parseVariables(JSON.stringify(result), a.state, a.draft)).toThrow();
    const repo = await repository(a), draft = await completeDraft(repo, { variables: result, world: worldResult() });
    const before = await repo.loadGame(a.state.saveId);
    await expect(repo.commitTurn(submission(draft))).rejects.toBeDefined();
    expect(await repo.loadGame(a.state.saveId)).toEqual(before);
  });
});
