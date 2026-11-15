import { worldResultForTurn } from './fixtures/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseWorld } from '../services/validation/aiOutputs';
import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';
import type { DomainCommand } from '../domain/commands';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { handoffState, finishTask, retireCommand } from './fixtures/handoff';
import { worldResult, proof } from './fixtures/world';
import { event } from './fixtures/game';
import { commitCommands } from '../domain/commands';
import { GameStateSchema } from '../domain/state';

const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach((repo) => repo.close()); vi.restoreAllMocks(); });
async function repository(state = handoffState(), factory = new IDBFactory()) {
  const repo = await SaveRepository.open('handoff-review3', factory);
  repositories.push(repo); await repo.create(state); return repo;
}
type Factory = (state: GameState, draft: TurnDraft) => ReturnType<typeof worldResult>;
async function ready(repo: SaveRepository, factory: Factory, narrative = '主角在街边休息。') {
  const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, narrative, 600), narrative });
  const result = parseWorld(JSON.stringify(worldResultForTurn(factory(await repo.load('save-a'), draft),draft.turnId)), await repo.load('save-a'), draft);
  return repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1,
    world: { ...draft.world!, result, candidateRevision: 2 } }, draft.draftRevision);
}
const claim = '蓝仓暗格藏着违禁货物。';
const received = '同事接收并归档了一份举报。';
function reportEvent(state: GameState, draft: TurnDraft): Extract<DomainCommand, { type: 'SaveEvent' }> {
  const at = new Date(Date.parse(state.worldClock) + 300000).toISOString();
  const text = `${received}举报未经核实，内容为：${claim}`;
  return { type: 'SaveEvent', commandId: 'receive-report', event: { ...event('report'), title: '举报受理',
    status: 'resolved', startAt: state.worldClock, estimatedEndAt: at, resolvedAt: at, resolutionText: text,
    actorRefs: [{ kind: 'npc', id: 'npc-a' }], sourceTurnIds: [draft.turnId] },
    evidence: proof({ at, sources: ['npc:npc-a'], fact: received,
      decision: { targetId: 'report', status: 'resolved', reason: '举报登记受理完成，尚未核查举报内容。', result: text, conditionsSatisfied: true, continues: false } }) };
}
function classifiedReport(state: GameState, draft: TurnDraft) {
  const command = reportEvent(state, draft), evidence = JSON.parse(command.evidence);
  evidence.decision.resultKnowledge = { facts: [received], reported: [claim], suspected: ['举报人可能认错仓库。'] };
  command.evidence = JSON.stringify(evidence); command.event.resultKnowledge = evidence.decision.resultKnowledge; return command;
}
describe('事件事实、结果叙述和计划的独立来源', () => {
  it('已结案事件重载不补造事实，回执可重放',async()=>{
 const repo=await repository(handoffState(),new IDBFactory()),selected=await ready(repo,(state,draft)=>({...worldResult(),eventCommands:[reportEvent(state,draft)]})),input=submission(selected),first=await repo.commitTurn(input);
 const loaded=await repo.load('save-a');expect(loaded.events).toEqual(first.state.events);expect(loaded.journal).toEqual(first.state.journal);expect(loaded.events.report.resultKnowledge).toBeUndefined();expect((await repo.commitTurn(input)).replayed).toBe(true);
});
  it('事件分类、原文、正式状态和回执一起回滚，重试幂等且只结案一次', async () => {
    const repo = await repository(), selected = await ready(repo, (state, draft) => ({ ...worldResult(), eventCommands: [classifiedReport(state, draft)] }));
    const before = await repo.loadGame('save-a'), input = submission(selected), add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'turnReceipts') throw new DOMException('Mock quota', 'QuotaExceededError'); return add.call(this, value, key);
    });
    await expect(repo.commitTurn(input)).rejects.toThrow(); expect(await repo.loadGame('save-a')).toEqual(before); vi.restoreAllMocks();
    const result = await repo.commitTurn(input); expect(result.state.events.report.resultKnowledge?.facts).toEqual([received]);
    expect(result.state.journal).toHaveLength(1); expect((await repo.commitTurn(input)).replayed).toBe(true);
  });
});

describe('旧退场命令一律拒绝，正式人物永久保留', () => {
  it('RetireNpc 不是合法命令：世界校验与直接提交都拒绝，成果可在移除后原子提交', async () => {
    const state = handoffState(); state.npc['npc-a'].relationshipText = '尚未与主角接触'; state.npc['npc-a'].affinity = 0;
    const repo = await repository(state);
    await expect(ready(repo, (current) => {
      const at = new Date(Date.parse(current.worldClock) + 300000).toISOString();
      return { ...worldResult([retireCommand(current)]), taskCommands: [finishTask(current, 'work', at)] };
    })).rejects.toThrow();
    expect(() => commitCommands(state, 'direct', state.revision, [retireCommand(state)])).toThrow();
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    const selected = await ready(repo, current => ({...worldResult(),taskCommands:[finishTask(current,'work',new Date(Date.parse(current.worldClock)+300000).toISOString())]}));
    expect(await repo.load('save-a')).toEqual(state);
    const result = await repo.commitTurn(submission(selected)); expect(result.state.npc['npc-a']).toEqual(state.npc['npc-a']);
    expect(result.state.tasks.work.resolution).toBeDefined();
  });
});
