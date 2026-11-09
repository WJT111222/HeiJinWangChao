import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { worldConditions } from './fixtures/worldConditions';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { timePreflight } from '../domain/timePreflight';
import { timeState } from './fixtures/time';
import { task } from './fixtures/game';
import { worldResult } from './fixtures/world';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { submission } from './fixtures/turn';
import { stageResponses } from '../services/ai/stageResponses';

const at = '2040-04-18T09:10:00+08:00';
const parse = (a: ReturnType<typeof worldConditions>) => parseWorld(JSON.stringify(a.response), a.state, a.draft);
const apply = (a: ReturnType<typeof worldConditions>) => {
  const r = parse(a); return projectTurn(a.state, a.draft, [...r.worldCommands, ...r.taskCommands, ...r.eventCommands]);
};
it('离场取材料任务blocked与现场讨论active并存，原文阻碍及单侧关系完整保留', () => {
  const a = worldConditions(), before = structuredClone(a), next = apply(a);
  expect(next.tasks[a.task.id]).toMatchObject({ status: 'blocked', blockers: a.task.blockers, prerequisites: a.task.prerequisites, linkedEventId: a.event.id });
  expect(next.events[a.event.id]).toMatchObject({ status: 'active', blockers: a.event.blockers, prerequisites: a.event.prerequisites });
  expect(next.npc.npc_fixture_lin.onScene).toBe(false);
  expect(next.npc.npc_fixture_xu).toEqual(a.state.npc.npc_fixture_xu);
  expect(next.protagonist).toEqual(a.state.protagonist); expect(a).toEqual(before);
});
it.each(['active', 'completed', 'failure', 'cancelled'] as const)('任务%s由World声明，文本阻碍不成为执行门槛', outcome => {
  const a = worldConditions();
  a.task.status = outcome === 'failure' ? 'cancelled' : outcome;
  if (outcome !== 'active') a.task.resolution = { at, outcome: outcome === 'completed' ? 'success' : outcome,
    result: '本次取件事务已有结果，仍保留尚待处理的困难。', reason: '依当前进展作出结论', sourceTurnId: a.draft.turnId };
  expect(apply(a).tasks[a.task.id]).toMatchObject(a.task);
});
it.each(['active', 'blocked', 'success', 'failure', 'changed', 'cancelled'] as const)('事件%s允许保留未解除的阻碍', outcome => {
  const a = worldConditions();
  a.event.continuation = { direction: 'end', reason: '后续按实际发展再安排' };
  a.event.status = ['success', 'failure', 'changed'].includes(outcome) ? 'resolved' : outcome as 'active' | 'blocked' | 'cancelled';
  if (['success', 'failure', 'changed', 'cancelled'].includes(outcome)) Object.assign(a.event, { resolvedAt: at, resolutionText: '讨论已有结论，材料问题仍保留。', outcome });
  else a.event.estimatedEndAt = '2040-04-18T11:00:00+08:00';
  expect(apply(a).events[a.event.id]).toMatchObject(a.event);
});
it('旧阻碍保留时仍可更新active并延期，不要求清空数组或改blocked', () => {
  const a = worldConditions();
  a.state.events[a.event.id] = { ...structuredClone(a.event), linkedTaskIds: [], sourceTurnIds: [], estimatedEndAt: at };
  expect(apply(a).events[a.event.id]).toMatchObject({ status: 'active', estimatedEndAt: a.event.estimatedEndAt, blockers: a.event.blockers });
});
it('到期主角入场安排保留文本阻碍，只有pending，不伪造已响应或知情', () => {
  const a = worldConditions(); a.event.estimatedEndAt = at;
  const next = apply(a);
  expect(next.events[a.event.id]).toMatchObject({ blockers: a.event.blockers, protagonistEntry: { status: 'pending', queuedAt: at, sourceTurnId: a.draft.turnId } });
  expect(next.npc.npc_fixture_xu).toEqual(a.state.npc.npc_fixture_xu);
  a.event.protagonistEntry = { id: 'forged', sourceTurnId: a.draft.turnId, queuedAt: at, channel: '伪造', cue: '已代玩家同意', status: 'presented', handledTurnId: a.draft.turnId };
  expect(() => parse(a)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'event_entry' }) }));
});
it('文本中的ID样式或相互提及不是程序依赖，显式实体关联仍独立校验', () => {
  const a = worldConditions();
  a.task.prerequisites = [`event:${a.event.id}`];
  a.event.blockers = [`task:${a.task.id}`, 'task:not-an-executable-reference'];
  expect(apply(a).events[a.event.id].blockers).toEqual(a.event.blockers);
  a.event.linkedTaskIds = ['missing-real-task'];
  expect(() => parse(a)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'task_event_reference' }) }));
});
it.each(['actor', 'location', 'estimate', 'future', 'scene', 'revision'] as const)('独立%s约束仍明确拒绝，不污染原状态', fault => {
  const a = worldConditions(), before = structuredClone(a.state);
  if (fault === 'actor') a.event.actorRefs.push({ kind: 'npc', id: 'missing-actor' });
  if (fault === 'location') a.event.locationId = 'missing-location';
  if (fault === 'estimate') a.event.estimatedEndAt = '2040-04-18T08:00:00+08:00';
  if (fault === 'future') Object.assign(a.event, { status: 'resolved', resolvedAt: '2040-04-18T12:00:00+08:00', resolutionText: '未来结果' });
  if (fault === 'scene') a.task.actorRef = { kind: 'npc', id: 'npc_fixture_xu' };
  if (fault === 'revision') a.response.worldCommands.push({ type: 'UpdateNpc', commandId: 'old-revision', npcId: 'npc_fixture_lin', expectedRevision: 99, changes: { healthText: '休息' }, evidence: '合成候选' });
  expect(() => parse(a)).toThrow(); expect(a.state).toEqual(before);
});
it('公开时间候选不再按文本阻碍或关联任务状态裁定；不完成任务、不接受玩家邀请', () => {
  const state = timeState(true);
  state.tasks.errand = { ...task('errand'), actorRef: { kind: 'protagonist', id: state.protagonist.id }, status: 'blocked', blockers: ['材料未到'], linkedEventId: 'visitor' };
  state.events.visitor.linkedTaskIds = ['errand']; state.events.visitor.blockers = ['仍在等待答复'];
  const before = structuredClone(state);
  expect(timePreflight(state, '睡到明早8点').candidates).toEqual([expect.objectContaining({ id: 'visitor', conditional: true })]);
  expect(state).toEqual(before);
});
it.each(['opening', 'regular'] as const)('实际%s World Prompt说明文本与显式引用的边界', async mode => {
  const a = worldConditions(); a.draft.turnKind = mode; a.draft.story!.turnKind = mode;
  const p = await composePrompt({ state: a.state, draft: a.draft, stage: 'world', mode, settings: defaultSettings(), userInput: '' });
  const sent = p.messages.map(m => m.content).join('\n');
  expect(sent).toContain('prerequisites和blockers是剧情说明字符串数组');
  expect(sent).not.toContain('成功需结构化前置条件已满足');
  expect(sent).not.toContain('成功推进需其结构化状态已解除');
  expect(sent).toContain('linkedTaskIds'); expect(sent).toContain('predecessorEventIds');
});

const resources: { dispose: () => void }[] = [];
afterEach(() => { resources.splice(0).forEach(r => r.dispose()); vi.restoreAllMocks(); stageResponses.clear(); });
async function setup(a = worldConditions()) {
  const factory = new IDBFactory(), repo = await SaveRepository.open('conditions-world', factory);
  resources.push({ dispose: () => repo.close() }); await repo.create(a.state);
  const initial = createTurnDraft(a.state.saveId, 0, a.draft.turnId, 'opening', '');
  await repo.saveDraft(initial, null); await repo.saveDraft(rerollStory(initial, a.draft.story!), 0);
  a.draft = await repo.saveDraft({ ...a.draft, draftRevision: 2 }, 1);
  const values = new Map<string, string>(), store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const config = defaultAiConfig(), channel = { ...newChannel(), defaultModel: 'mock-world' }; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock-world' };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'conditions-test-only');
  const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(a.response) }, finish_reason: 'stop' }] }));
  const stage = new WorldStage(repo, new AiClient(transport)); resources.push(stage);
  return { ...a, repo, factory, stage, transport, options: { config, vault, settings: defaultSettings() } };
}
it('Variables现场终态投影交给World后，Commit不得再次把原阻碍当完成门槛', async () => {
  const source = worldConditions();
  const old = { ...structuredClone(source.event), linkedTaskIds: [], sourceTurnIds: [] };
  source.state.events[old.id] = old;
  source.draft.variables!.result.commands.push({ type: 'SaveEvent', commandId: 'scene-finish', evidence: '讨论已有现场结论',
    event: { ...old, status: 'resolved', resolvedAt: at, resolutionText: '双方完成了本次讨论，分歧作为后续事项保留。', outcome: 'success', sourceTurnIds: [source.draft.turnId] } });
  source.response = worldResult();
  const a = await setup(source), ready = await a.stage.generate({ ...a.options, draft: a.draft });
  const saved = await a.repo.commitTurn(submission(ready, ''));
  expect(saved.state.events[old.id]).toMatchObject({ status: 'resolved', blockers: old.blockers, prerequisites: old.prerequisites });
  expect(a.transport).toHaveBeenCalledTimes(1);
});
it('Runtime→候选→事务失败→原子重试→重载与幂等：阻碍不清空，单次Mock模型调用', async () => {
  const a = await setup(), before = await a.repo.loadGame(a.state.saveId);
  const ready = await a.stage.generate({ ...a.options, draft: a.draft });
  expect(await a.repo.load(a.state.saveId)).toEqual(before.state); expect(ready.story).toEqual(a.draft.story);
  const snapshot = await a.repo.loadGame(a.state.saveId), put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'saves') throw Error('synthetic write failure'); return put.apply(this, args);
  });
  await expect(a.repo.commitTurn(submission(ready, ''))).rejects.toThrow(); vi.restoreAllMocks();
  expect(await a.repo.loadGame(a.state.saveId)).toEqual(snapshot);
  const committed = await a.repo.commitTurn(submission(ready, ''));
  expect(committed.state.tasks[a.task.id]).toMatchObject({ status: 'blocked', blockers: a.task.blockers });
  expect(committed.state.events[a.event.id]).toMatchObject({ status: 'active', blockers: a.event.blockers });
  const other = await SaveRepository.open('conditions-world', a.factory); resources.push({ dispose: () => other.close() });
  expect((await other.loadGame(a.state.saveId)).state).toEqual(committed.state);
  expect((await other.commitTurn(submission(ready, ''))).replayed).toBe(true);
  expect(a.transport).toHaveBeenCalledTimes(1);
});
