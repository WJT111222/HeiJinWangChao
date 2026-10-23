import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { playerView } from '../ui/panels/playerView';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { handoffState, handoffResult, finishTask, resultText } from './fixtures/handoff';
import { worldDraft, worldResult, proof } from './fixtures/world';
import { event, npc } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import { fingerprint, commitCommands } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { worldSources } from '../services/validation/worldEvidence';
import { retireCommand } from './fixtures/handoff';
import { projectTurn } from '../domain/turnProjection';
import { defaultSettings } from '../ui/settings/model';
import { contextFor } from '../prompts/context';

const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach((repo) => repo.close()); vi.restoreAllMocks(); });
async function repository(state = handoffState()) { const repo = await SaveRepository.open('handoff-review', new IDBFactory()); repositories.push(repo); await repo.create(state); return repo; }
async function commit(repo: SaveRepository, raw: ReturnType<typeof worldResult>) {
  const d = await completeDraft(repo, { variables: await elapsedVariables(repo, '主角在街边休息。', 600), narrative: '主角在街边休息。' });
  const result = parseWorld(JSON.stringify(raw), await repo.load('save-a'), d);
  const ready = await repo.saveDraft({ ...d, draftRevision: d.draftRevision + 1, world: { ...d.world!, result, candidateRevision: 2 } }, d.draftRevision);
  return repo.commitTurn(submission(ready));
}

describe('PR22审查：先复现三条真实路径', () => {
  it('A的未核实报告经B交接及其他职责结案，C不能借task JSON认定为世界事实', async () => {
    const secret = '蓝仓暗格藏着违禁货物。', state = handoffState(); state.npc['npc-c'] = { ...npc('npc-c'), name: 'C', onScene: false };
    const repo = await repository(state), initial = handoffResult(state), finish = initial.taskCommands[1], receive = initial.taskCommands[0];
    if (finish.type !== 'SaveTask' || receive.type !== 'SaveTask') throw Error();
    const evidence = JSON.parse(finish.evidence); evidence.decision.result = `已接收一份未经核实的举报，原话：${secret}`; delete evidence.decision.resultKnowledge; finish.evidence = JSON.stringify(evidence);
    receive.task.handoff!.content = secret; receive.evidence = proof({ at: receive.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: secret });
    const first = await commit(repo, initial);
    const ending = finishTask(first.state, 'next', '2026-10-18T08:15:00+08:00'), ended = worldResult(); ended.taskCommands = [ending];
    const second = await commit(repo, ended), draft = worldDraft(); draft.baseSaveRevision = second.state.revision;
    draft.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', worldClock: '2026-10-18T08:30:00+08:00', evidence: draft.story!.narrative }];
    const forged: DomainCommand = { type: 'SaveEvent', commandId: 'launder-report', event: { ...event('false-truth'), title: '蓝仓情况确认', actorRefs: [{ kind: 'npc', id: 'npc-c' }], startAt: second.state.worldClock, estimatedEndAt: '2026-10-18T08:30:00+08:00', status: 'resolved', resolvedAt: '2026-10-18T08:25:00+08:00', resolutionText: secret, sourceTurnIds: [draft.turnId] },
      evidence: proof({ kind: 'established', at: '2026-10-18T08:25:00+08:00', sources: ['task:next', 'npc:npc-c'], fact: secret }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [forged] }), second.state, draft)).toThrow();
    expect(JSON.stringify(playerView(second.state))).not.toContain(secret);
    expect((await repo.load('save-a')).events['false-truth']).toBeUndefined();
  });
  it('V2非联系人不能永久误标成联系人，尚未确认身份应独立暂缓清理', () => {
    const v2 = { ...handoffState(), schemaVersion: 2 }; Reflect.deleteProperty(v2, 'contactNpcIds'); Reflect.deleteProperty(v2, 'retiredNpcs'); Reflect.deleteProperty(v2, 'contactReviewNpcIds');
    const state = migrateSave(v2); expect(state.contactNpcIds).toEqual([]);
  });
  it('有原文依据的忠实概括可交接，叙述事实不必等于报告正文', () => {
    const state = handoffState(), r = handoffResult(state), receiver = r.taskCommands[0];
    if (receiver.type !== 'SaveTask') throw Error();
    const summarized = { ...receiver, task: { ...receiver.task, handoff: { ...receiver.task.handoff!, content: '登记编号318对应的三份材料齐全。', summaryBasis: { mode: 'faithful_summary', resultExcerpt: resultText } } },
      evidence: proof({ at: receiver.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: '核对人把登记要点通过电话传给接收人。' }) };
    const result = { ...r, taskCommands: [summarized, r.taskCommands[1]] };
    expect(() => parseWorld(JSON.stringify(result), state, worldDraft())).not.toThrow();
  });
});


function legacy(state = handoffState(), version: 1 | 2 | 3 = 2) {
  const raw = { ...state, schemaVersion: version }; Reflect.deleteProperty(raw, 'contactReviewNpcIds');
  if (version < 3) { Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); }
  if (version === 1) { Reflect.deleteProperty(raw, 'weatherText'); Reflect.deleteProperty(raw, 'environmentText'); }
  return raw;
}
function reviewRetirement(state: ReturnType<typeof handoffState>, basis: 'no_known_connection' | 'player_confirmed' = 'no_known_connection') {
  return { ...retireCommand(state), contactReview: { conclusion: 'non_contact' as const, basis, reason: '核验稳定身份及现有公开记录，确认只是场外临时工作人员。' } };
}
function unpack(result: ReturnType<typeof worldResult>) { return [...result.worldCommands, ...result.taskCommands, ...result.eventCommands]; }

describe('任务来源分隔与人物认知', () => {
  it('任务事实仅暴露实际成果，报告保留statement；计划、原因不进入fact材料', () => {
    const state = handoffState(), report = '未核实的蓝仓情报';
    state.tasks.work.status = 'completed';
    state.tasks.work.goal = `核实${report}`;
    state.tasks.work.resolution = { at: state.worldClock, outcome: 'success', result: '只完成了文件归档。', reason: report, sourceTurnId: 'past',
      resultKnowledge: { facts: ['只完成了文件归档。'], reported: [], suspected: [] } };
    state.tasks.work.handoff = { fromTaskId: 'prior', at: state.worldClock, channel: '电话', content: report, necessity: '接收工作报告', knowledgeKind: 'reported' };
    const sources = worldSources(state, worldDraft()), objective = sources.find((s) => s.id === 'task:work');
    expect(objective?.knowledge).toBe('fact'); expect(objective?.text).toContain('文件归档'); expect(objective?.text).not.toContain(report);
    expect(sources.find((s) => s.id === 'handoff:work')).toMatchObject({ knowledge: 'statement', text: report, ownerNpcId: 'npc-a' });
    expect(sources.find((s) => s.id === 'task-plan:work')).toMatchObject({ knowledge: 'plan' });
  });
  it('真实成果仍可引用；B收到转述不能直接变成observed或传给无来源的C', () => {
    const state = handoffState(), r = handoffResult(state), draft = worldDraft();
    const projected = projectTurn(state, draft, unpack(parseWorld(JSON.stringify(r), state, draft)));
    const next = { ...draft, baseSaveRevision: projected.revision };
    next.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', evidence: next.story!.narrative, worldClock: '2026-10-18T08:20:00+08:00' }];
    const memory: Extract<DomainCommand, { type: 'RecordNpcMemory' }> = { type: 'RecordNpcMemory', commandId: 'receive', npcId: 'npc-b', expectedRevision: projected.revision, layer: 'personal', knowledgeKind: 'reported', addToKnownInformation: false,
      evidence: proof({ kind: 'reported', sources: ['handoff:next'], fact: resultText, at: '2026-10-18T08:15:00+08:00' }),
      memory: { id: 'reported', text: `[转述]${resultText}`, knowledgeSource: 'handoff:next', sourceTurnIds: [next.turnId], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }], visibility: 'npc_private', createdAtGameTime: '2026-10-18T08:15:00+08:00' } };
    expect(() => parseWorld(JSON.stringify(worldResult([memory])), projected, next)).not.toThrow();
    memory.knowledgeKind = 'observed'; memory.memory.text = resultText;
    memory.evidence = proof({ kind: 'established', sources: ['handoff:next'], fact: resultText, at: '2026-10-18T08:15:00+08:00' });
    expect(() => parseWorld(JSON.stringify(worldResult([memory])), projected, next)).toThrow();
    memory.npcId = 'npc-a'; memory.memory.affectedEntityRefs = [{ kind: 'npc', id: 'npc-a' }];
    expect(() => parseWorld(JSON.stringify(worldResult([memory])), projected, next)).toThrow();
    const actual = worldSources(projected, next).find((source) => source.id === 'task:work'); expect(actual?.text).toContain(resultText);
  });
});

describe('旧档联系人暂缓保护与合法退场', () => {
  it.each([1, 2] as const)('V%s迁移不改revision、原文或NPC实体；非联系人须明确复核才可退场', async (version) => {
    const original = handoffState(); original.npc['npc-a'].relationshipText = '尚未与主角接触'; original.npc['npc-a'].affinity = 0;
    const raw = legacy(original, version), factory = new IDBFactory(), repo = await SaveRepository.open(`legacy-contact-${version}`, factory); repositories.push(repo);
    const db = await new Promise<IDBDatabase>((resolve) => { const request = factory.open(`legacy-contact-${version}`); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    const state = await repo.load('save-a'); expect(state.contactNpcIds).toEqual([]); expect(state.contactReviewNpcIds).toContain('npc-a');
    expect(state.npc).toEqual(original.npc); expect(state.revision).toBe(0); expect(state.journal).toEqual(original.journal);
    const result = { ...worldResult([retireCommand(state)]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(result), state, worldDraft())).toThrow();
    result.worldCommands = [reviewRetirement(state)];
    const committed = await commit(repo, result); expect(committed.state.npc['npc-a']).toBeUndefined(); expect(committed.state.contactReviewNpcIds).not.toContain('npc-a');
    expect(committed.state.retiredNpcs['npc-a']).toBeDefined(); expect(committed.state.tasks.work.resolution).toBeDefined();
    expect((await repo.load('save-a')).schemaVersion).toBe(4);
  });
  it('有既往联系的旧NPC保持待确认，AI自称“无联系”不能绕过；真实公开确认可以复核', () => {
    const state = migrateSave(legacy()), d = worldDraft(), retirement = reviewRetirement(state);
    let r = { ...worldResult([retirement]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
    retirement.contactReview.basis = 'player_confirmed'; expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
    const fact = '主角确认同事属于非联系人临时人员。'; d.story!.narrative += fact;
    const evidence = JSON.parse(retirement.evidence); evidence.kind = 'established'; evidence.sources = ['story:current', 'npc:npc-a']; evidence.fact = fact; retirement.evidence = JSON.stringify(evidence);
    d.userInput = fact;
    r = { ...worldResult([{ ...retirement, contactReview: { ...retirement.contactReview, playerConfirmation: fact } }]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(r), state, d)).not.toThrow();
    state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = state.contactReviewNpcIds.filter((id) => id !== 'npc-a');
    expect(() => parseWorld(JSON.stringify(r), state, d)).toThrow();
  });
  it('待确认人物可登记为正式联系人，登记会解除待确认状态且不能再清理', () => {
    const state = migrateSave(legacy());
    const command: DomainCommand = { type: 'RegisterContact', commandId: 'register', evidence: '主角与同事交换联系方式。', npcId: 'npc-a', reason: '交换联系方式' };
    const next = commitCommands(state, 'confirm', state.revision, [command]);
    expect(next.contactNpcIds).toContain('npc-a'); expect(next.contactReviewNpcIds).not.toContain('npc-a');
    expect(next.npc['npc-a']).toEqual(state.npc['npc-a']);
  });
  it('V3预览误标可修复；真实登记回执、初始同伴保留永久身份，新非联系人不被无故加入待确认', () => {
    const state = handoffState(); state.npc['npc-a'] = { ...state.npc['npc-a'], kind: 'special', detailedBackground: '同伴', activeGoals: [], habits: [], longTermMemories: [], offscreenTaskIds: [] }; state.initialCompanionId = 'npc-a';
    const command: DomainCommand = { type: 'RegisterContact', commandId: 'register-b', evidence: '交换联系方式', reason: '联络', npcId: 'npc-b' };
    state.appliedCommands.push({ turnId: 'old-contact', commandId: command.commandId, fingerprint: fingerprint(command) });
    state.contactNpcIds = Object.keys(state.npc); const migrated = migrateSave(legacy(state, 3));
    expect(migrated.contactNpcIds.sort()).toEqual(['npc-a', 'npc-b']); expect(migrated.contactReviewNpcIds).toEqual(['scene']); expect(migrated.npc).toEqual(state.npc);
    const fresh = handoffState(); fresh.contactNpcIds = []; const preview = migrateSave(legacy(fresh, 3));
    expect(preview.contactReviewNpcIds).toEqual([]); expect(migrateSave(migrated)).toEqual(migrated);
  });
  it('待确认状态独立显示，不冒充永久联系人，也不向世界输入伪造确认结果', () => {
    const state = migrateSave(legacy()), scene = playerView(state).npc.find((person) => person.id === 'scene');
    expect(scene).toMatchObject({ isContact: false, contactReviewPending: true });
    const context = contextFor({ stage: 'world', mode: 'regular', state, draft: worldDraft(), settings: defaultSettings(), userInput: '' });
    expect(context.NPC_LIFECYCLE).toMatchObject({ contactNpcIds: [], contactReviewNpcIds: state.contactReviewNpcIds });
    expect(GameStateSchema.safeParse({ ...state, contactNpcIds: ['scene'] }).success).toBe(false);
  });
});

describe('忠实概括的来源、时间及权限', () => {
  function summarized() {
    const state = handoffState(), r = handoffResult(state), receiver = r.taskCommands[0]; if (receiver.type !== 'SaveTask') throw Error();
    receiver.task.handoff = { ...receiver.task.handoff!, content: '三份材料核对齐全，登记号为318。', summaryBasis: { mode: 'faithful_summary', resultExcerpt: resultText } };
    receiver.evidence = proof({ at: receiver.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: '核对人通过电话传达清单要点。' });
    return { state, r, receiver };
  }
  it('原始片段可核验但摘要无需逐字匹配；接收后的知识性质仍为reported', () => {
    const { state, r } = summarized(), draft = worldDraft();
    const normalized = parseWorld(JSON.stringify(r), state, draft), projected = projectTurn(state, draft, unpack(normalized));
    const handed = worldSources(projected, draft).find((source) => source.id === 'handoff:next');
    expect(handed).toMatchObject({ knowledge: 'statement', ownerNpcId: 'npc-b', text: '三份材料核对齐全，登记号为318。' });
    expect(projected.tasks.next.handoff?.summaryBasis?.resultExcerpt).toBe(resultText);
    expect(GameStateSchema.safeParse(projected).success).toBe(true);
  });
  it.each(['fake-excerpt', 'other-secret', 'wrong-source', 'early', 'future'] as const)('%s不能借概括通道伪造来源、越权或越时', (fault) => {
    const { state, r, receiver } = summarized();
    if (fault === 'fake-excerpt') receiver.task.handoff!.summaryBasis!.resultExcerpt = '根本不存在的结果';
    if (fault === 'other-secret') { receiver.task.handoff!.summaryBasis!.resultExcerpt = 'A的私人银行卡密码'; receiver.task.handoff!.content = '口令已经取得。'; }
    if (fault === 'wrong-source') receiver.evidence = proof({ at: receiver.task.startAt, sources: ['npc:npc-a', 'npc:npc-b'], fact: '移交摘要' });
    if (fault === 'early') receiver.task.handoff!.at = state.worldClock;
    if (fault === 'future') receiver.task.handoff!.at = '2026-10-18T08:30:00+08:00';
    expect(() => parseWorld(JSON.stringify(r), state, worldDraft())).toThrow();
  });
  it('旧版逐字交接保持兼容，未声明概括依据的凭空新内容仍拒绝', () => {
    const { state, r, receiver } = summarized(); delete receiver.task.handoff!.summaryBasis;
    expect(() => parseWorld(JSON.stringify(r), state, worldDraft())).toThrow();
    receiver.task.handoff!.content = resultText; expect(() => parseWorld(JSON.stringify(r), state, worldDraft())).not.toThrow();
  });
});

describe('修复不削弱真实成果与事务', () => {
  it('真实核验成果继续支持有权限的世界事实候选，不把所有任务结果降级为转述', () => {
    const state = handoffState(), draft = worldDraft();
    const finished = parseWorld(JSON.stringify(handoffResult(state)), state, draft), projected = projectTurn(state, draft, unpack(finished));
    const next = { ...draft, baseSaveRevision: projected.revision }; next.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', worldClock: '2026-10-18T08:20:00+08:00', evidence: next.story!.narrative }];
    const real: DomainCommand = { type: 'SaveEvent', commandId: 'verified-result', event: { ...event('verified-result'), title: '核验完成记录', status: 'resolved', startAt: projected.worldClock, estimatedEndAt: '2026-10-18T08:20:00+08:00', resolvedAt: '2026-10-18T08:15:00+08:00', resolutionText: resultText, actorRefs: [{ kind: 'npc', id: 'npc-a' }] },
      evidence: proof({ at: '2026-10-18T08:15:00+08:00', kind: 'established', sources: ['task:work'], fact: resultText }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [real] }), projected, next)).not.toThrow();
  });
  it('待确认身份复核后的删除仍与成果和回执原子提交；写入失败不会提前解除保护', async () => {
    const original = handoffState(); original.npc['npc-a'].relationshipText = '尚未与主角接触'; original.npc['npc-a'].affinity = 0;
    const state = migrateSave(legacy(original)), repo = await repository(state), before = await repo.load('save-a');
    const raw = { ...worldResult([reviewRetirement(state)]), taskCommands: [finishTask(state)] };
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'turnReceipts') throw new DOMException('Mock quota', 'QuotaExceededError'); return add.call(this, value, key);
    });
    await expect(commit(repo, raw)).rejects.toThrow(); vi.restoreAllMocks(); expect(await repo.load('save-a')).toEqual(before);
    const ready = (await repo.loadDraft('save-a'))!, committed = await repo.commitTurn(submission(ready));
    expect(committed.state.contactReviewNpcIds).not.toContain('npc-a'); expect(committed.state.npc['npc-a']).toBeUndefined();
    expect(committed.state.tasks.work.resolution).toBeDefined(); expect((await repo.commitTurn(submission(ready))).replayed).toBe(true);
  });
});
