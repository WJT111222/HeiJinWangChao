import { worldResultForTurn } from './fixtures/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { playerView } from '../ui/panels/playerView';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { handoffState, handoffResult, finishTask, resultText } from './fixtures/handoff';
import { worldDraft, worldResult, proof } from './fixtures/world';
import type { DomainCommand } from '../domain/commands';
import { commitCommands } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { retireCommand } from './fixtures/handoff';
import { defaultSettings } from '../ui/settings/model';
import { contextFor } from '../prompts/context';

const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach((repo) => repo.close()); vi.restoreAllMocks(); });
async function repository(state = handoffState()) { const repo = await SaveRepository.open('handoff-review', new IDBFactory()); repositories.push(repo); await repo.create(state); return repo; }
async function commit(repo: SaveRepository, raw: ReturnType<typeof worldResult>) {
  const d = await completeDraft(repo, { variables: await elapsedVariables(repo, '主角在街边休息。', 600), narrative: '主角在街边休息。' });
  const result = parseWorld(JSON.stringify(worldResultForTurn(raw, d.turnId)), await repo.load('save-a'), d);
  const ready = await repo.saveDraft({ ...d, draftRevision: d.draftRevision + 1, world: { ...d.world!, result, candidateRevision: 2 } }, d.draftRevision);
  return repo.commitTurn(submission(ready));
}

describe('PR22审查：先复现三条真实路径', () => {
  it('当前待复核身份与正式联系人保持分离',()=>{const state=reviewState();expect(state.contactNpcIds).toEqual([]);expect(state.contactReviewNpcIds).toContain('npc-a');});
  it('有原文依据的忠实概括可交接，叙述事实不必等于报告正文', () => {
    const state = handoffState(), r = handoffResult(state), receiver = r.taskCommands[0];
    if (receiver.type !== 'SaveTask') throw Error();
    const summarized = { ...receiver, task: { ...receiver.task, handoff: { ...receiver.task.handoff!, content: '登记编号318对应的三份材料齐全。', summaryBasis: { mode: 'faithful_summary', resultExcerpt: resultText } } },
      evidence: proof({ at: receiver.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: '核对人把登记要点通过电话传给接收人。' }) };
    const result = { ...r, taskCommands: [summarized, r.taskCommands[1]] };
    expect(() => parseWorld(JSON.stringify(result), state, worldDraft())).not.toThrow();
  });
});


function reviewState() { const state=handoffState();state.contactReviewNpcIds=Object.keys(state.npc);return state; }
function reviewRetirement(state: ReturnType<typeof handoffState>, basis: 'no_known_connection' | 'player_confirmed' = 'no_known_connection') {
  return { ...retireCommand(state), contactReview: { conclusion: 'non_contact' as const, basis, reason: '核验稳定身份及现有公开记录，确认只是场外临时工作人员。' } };
}

describe('旧档联系人暂缓保护与合法退场', () => {
  it('旧非联系人复核也不能授权删除；移除退场提案后任务成果正常保存',async()=>{
 const original=reviewState();original.npc['npc-a'].relationshipText='尚未与主角接触';original.npc['npc-a'].affinity=0;const repo=await repository(original),state=await repo.load('save-a');
 const result={...worldResult([retireCommand(state)]),taskCommands:[finishTask(state)]};expect(()=>parseWorld(JSON.stringify(result),state,worldDraft())).toThrow();result.worldCommands=[reviewRetirement(state)];
 await expect(commit(repo,result)).rejects.toThrow();result.worldCommands=[];const committed=await commit(repo,result);expect(committed.state.npc['npc-a']).toEqual(original.npc['npc-a']);expect(committed.state.contactReviewNpcIds).toContain('npc-a');expect(committed.state.tasks.work.resolution).toBeDefined();expect((await repo.load('save-a')).schemaVersion).toBe(9);
});
  it('有既往联系的旧NPC保持待确认；自称无联系或自由文本确认均不能绕过保护', () => {
    const state = reviewState(), d = worldDraft(), retirement = reviewRetirement(state);
    let r = { ...worldResult([retirement]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
    retirement.contactReview.basis = 'player_confirmed'; expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
    const fact = '主角确认同事属于非联系人临时人员。'; d.story!.narrative += fact;
    const evidence = JSON.parse(retirement.evidence); evidence.kind = 'established'; evidence.sources = ['story:current', 'npc:npc-a']; evidence.fact = fact; retirement.evidence = JSON.stringify(evidence);
    d.userInput = fact;
    r = { ...worldResult([{ ...retirement, contactReview: { ...retirement.contactReview, playerConfirmation: fact } }]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
    state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = state.contactReviewNpcIds.filter((id) => id !== 'npc-a');
    expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
  });
  it('待确认人物可登记为正式联系人，登记会解除待确认状态且不能再清理', () => {
    const state = reviewState();
    const command: DomainCommand = { type: 'RegisterContact', commandId: 'register', evidence: '主角与同事交换联系方式。', npcId: 'npc-a', reason: '交换联系方式' };
    const next = commitCommands(state, 'confirm', state.revision, [command]);
    expect(next.contactNpcIds).toContain('npc-a'); expect(next.contactReviewNpcIds).not.toContain('npc-a');
    expect(next.npc['npc-a']).toEqual(state.npc['npc-a']);
  });
  it('当前已登记联系人和初始同伴读写不变，不自动扩展待复核名单',()=>{
 const state=handoffState();state.npc['npc-a']={...state.npc['npc-a'],kind:'special',detailedBackground:'同伴',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[]};state.initialCompanionId='npc-a';state.contactNpcIds=['npc-a','npc-b'];
 const before=structuredClone(state),loaded=migrateSave(state);expect(loaded).toEqual(before);expect(loaded.contactReviewNpcIds).toEqual([]);
});
  it('待确认状态独立显示，不冒充永久联系人，也不向世界输入伪造确认结果', () => {
    const state = reviewState(), scene = playerView(state).npc.find((person) => person.id === 'scene');
    expect(scene).toMatchObject({ isContact: false, contactReviewPending: true });
    const context = contextFor({ stage: 'world', mode: 'regular', state, draft: worldDraft(), settings: defaultSettings(), userInput: '' });
    expect(context.NPC_LIFECYCLE).toMatchObject({ contactNpcIds: [], contactReviewNpcIds: state.contactReviewNpcIds });
    expect(GameStateSchema.safeParse({ ...state, contactNpcIds: ['scene'] }).success).toBe(false);
  });
});

describe('修复不削弱真实成果与事务', () => {
  it('任务成果与回执原子提交，待确认人物完整保留；写入失败不改变人物', async () => {
    const original = handoffState(); original.npc['npc-a'].relationshipText = '尚未与主角接触'; original.npc['npc-a'].affinity = 0;
    const state = { ...original, contactReviewNpcIds: Object.keys(original.npc) }, repo = await repository(state), before = await repo.load('save-a');
    const raw = { ...worldResult(), taskCommands: [finishTask(state)] };
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'turnReceipts') throw new DOMException('Mock quota', 'QuotaExceededError'); return add.call(this, value, key);
    });
    await expect(commit(repo, raw)).rejects.toThrow(); vi.restoreAllMocks(); expect(await repo.load('save-a')).toEqual(before);
    const ready = (await repo.loadDraft('save-a'))!, committed = await repo.commitTurn(submission(ready));
    expect(committed.state.contactReviewNpcIds).toContain('npc-a'); expect(committed.state.npc['npc-a']).toEqual(before.npc['npc-a']);
    expect(committed.state.tasks.work.resolution).toBeDefined(); expect((await repo.commitTurn(submission(ready))).replayed).toBe(true);
  });
});
