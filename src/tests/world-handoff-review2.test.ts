import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { migrateSave } from '../services/storage/migrations';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { handoffState, handoffResult, finishTask, retireCommand, resultText } from './fixtures/handoff';
import { worldDraft, worldResult, proof } from './fixtures/world';
import { event, npc, story } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { worldSources } from '../services/validation/worldEvidence';
import { projectTurn } from '../domain/turnProjection';
import { playerView } from '../ui/panels/playerView';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';

const repositories: SaveRepository[] = [];
afterEach(() => repositories.splice(0).forEach((repo) => repo.close()));
async function repository(state = handoffState()) {
  const repo = await SaveRepository.open('handoff-review2', new IDBFactory());
  repositories.push(repo); await repo.create(state); return repo;
}
async function commit(repo: SaveRepository, raw: ReturnType<typeof worldResult>) {
  const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '主角在街边休息。', 600), narrative: '主角在街边休息。' });
  const result = parseWorld(JSON.stringify(raw), await repo.load('save-a'), draft);
  const ready = await repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1,
    world: { ...draft.world!, result, candidateRevision: 2 } }, draft.draftRevision);
  return repo.commitTurn(submission(ready));
}

describe('PR22第二轮先复现：混合成果和未索引旧正文', () => {
  it('跨两次正式提交，C不能引用仍含A举报的task:work来确认举报内容', async () => {
    const secret = '蓝仓暗格藏着违禁货物。', state = handoffState();
    state.npc['npc-c'] = { ...npc('npc-c'), name: 'C', onScene: false };
    const repo = await repository(state), raw = handoffResult(state);
    const finish = raw.taskCommands[1], receive = raw.taskCommands[0];
    if (finish.type !== 'SaveTask' || receive.type !== 'SaveTask') throw Error();
    const evidence = JSON.parse(finish.evidence);
    evidence.decision.result = `已接收一份未经核实的举报，原话：${secret}`;
    delete evidence.decision.resultKnowledge;
    finish.evidence = JSON.stringify(evidence);
    receive.task.handoff!.content = secret;
    receive.evidence = proof({ at: receive.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: secret });
    const first = await commit(repo, raw), ended = worldResult();
    ended.taskCommands = [finishTask(first.state, 'next', '2026-10-18T08:15:00+08:00')];
    const second = await commit(repo, ended), draft = worldDraft(); draft.baseSaveRevision = second.state.revision;
    draft.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', evidence: draft.story!.narrative, worldClock: '2026-10-18T08:30:00+08:00' }];
    const forged: DomainCommand = { type: 'SaveEvent', commandId: 'launder-original-result',
      event: { ...event('false-truth'), title: '蓝仓情况确认', actorRefs: [{ kind: 'npc', id: 'npc-c' }],
        startAt: second.state.worldClock, estimatedEndAt: '2026-10-18T08:30:00+08:00', status: 'resolved',
        resolvedAt: '2026-10-18T08:25:00+08:00', resolutionText: secret, sourceTurnIds: [draft.turnId] },
      evidence: proof({ kind: 'established', at: '2026-10-18T08:25:00+08:00', sources: ['task:work', 'npc:npc-c'], fact: secret }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [forged] }), second.state, draft)).toThrow();
    expect((await repo.load('save-a')).events['false-truth']).toBeUndefined();
  });
  it('旧journal明确交换联系方式但引用为空，不能推定从未联系并批准退场', () => {
    const raw = { ...handoffState(), schemaVersion: 2 }; Reflect.deleteProperty(raw, 'retiredEvents');
    raw.npc['npc-a'].relationshipText = '尚未与主角接触'; raw.npc['npc-a'].affinity = 0;
    raw.journal = [{ turnId: 'past', revision: 1, relatedActorRefs: [],
      story: { ...story, narrative: '主角与同事交换联系方式，约好以后经常联系。', summary: '与同事建立长期联系。' } }];
    raw.turnNumber = 1; raw.revision = 1;
    Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    const state = migrateSave(raw), draft = worldDraft(); draft.baseSaveRevision = state.revision;
    const retirement: Extract<DomainCommand, { type: 'RetireNpc' }> = { ...retireCommand(state), contactReview: { conclusion: 'non_contact', basis: 'no_known_connection', reason: '结构化引用为空。' } };
    expect(() => parseWorld(JSON.stringify({ ...worldResult([retirement]), taskCommands: [finishTask(state)] }), state, draft)).toThrow();
  });
});

function mixedOutcome(classified = true) {
  const state = handoffState(), raw = worldResult(), command = finishTask(state);
  const secret = '蓝仓暗格藏着违禁货物。', action = '同事接收并归档了一份举报。';
  const evidence = JSON.parse(command.evidence);
  evidence.decision.result = `${action}举报未经核实，原话：${secret}办事员怀疑举报人认错了仓库。`;
  if (classified) evidence.decision.resultKnowledge = { facts: [action], reported: [secret], suspected: ['举报人可能认错了仓库。'] };
  else delete evidence.decision.resultKnowledge;
  command.evidence = JSON.stringify(evidence); raw.taskCommands = [command];
  return { state, raw, action, secret };
}
function laterDraft(state: ReturnType<typeof handoffState>) {
  const draft = worldDraft(); draft.baseSaveRevision = state.revision;
  draft.variables!.result.commands = [{ type: 'SetWorldClock', commandId: 'later', evidence: draft.story!.narrative, worldClock: '2026-10-18T08:20:00+08:00' }];
  return draft;
}
function memoryCommand(state: ReturnType<typeof handoffState>, text: string, kind: 'reported' | 'observed', npcId = 'npc-a'): Extract<DomainCommand, { type: 'RecordNpcMemory' }> {
  return { type: 'RecordNpcMemory', commandId: 'remember-claim', npcId, expectedRevision: state.revision, layer: 'personal', knowledgeKind: kind, addToKnownInformation: false,
    evidence: proof({ kind: kind === 'reported' ? 'reported' : 'established', at: '2026-10-18T08:15:00+08:00', sources: ['task-result:work'], fact: text }),
    memory: { id: 'remembered-claim', text: kind === 'reported' ? `[转述]${text}` : text, knowledgeSource: 'task-result:work',
      sourceTurnIds: ['turn-a'], affectedEntityRefs: [{ kind: 'npc', id: npcId }], visibility: 'npc_private', createdAtGameTime: '2026-10-18T08:15:00+08:00' } };
}
describe('混合任务成果的认知分层与旧档保留', () => {
  it.each([1, 2, 3, 4])('V%s旧成果原文与终态保留，迁移不伪造认知分类或推进正式版本', (version) => {
    const state = handoffState(); state.tasks.work.status = 'completed';
    state.tasks.work.resolution = { at: state.worldClock, outcome: 'success', result: '收到一份未经核实的举报，声称蓝仓藏有违禁品。', reason: '完成举报登记', sourceTurnId: 'past' };
    const raw = { ...state, schemaVersion: version }; Reflect.deleteProperty(raw, 'retiredEvents');
    if (version < 4) Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    if (version < 3) { Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); }
    if (version === 1) { Reflect.deleteProperty(raw, 'weatherText'); Reflect.deleteProperty(raw, 'environmentText'); }
    const migrated = migrateSave(raw); expect(migrated.tasks).toEqual(state.tasks);
    expect(migrated.revision).toBe(state.revision); expect(migrated.worldClock).toBe(state.worldClock);
    expect(migrated.tasks.work.resolution?.resultKnowledge).toBeUndefined();
    expect(worldSources(migrated, worldDraft()).find((source) => source.id === 'task:work')?.text).not.toContain('蓝仓');
  });
  it.each([true, false])('classified=%s：完整原文保留，只有明确分层事实进入fact，旧成果不补造事实', async (classified) => {
    const { state, raw, action, secret } = mixedOutcome(classified), repo = await repository(state), before = await repo.load('save-a');
    const result = await commit(repo, raw), saved = await repo.load('save-a');
    expect(saved.tasks.work.resolution?.result).toContain(secret);
    const sources = worldSources(saved, laterDraft(saved)), fact = sources.find((source) => source.id === 'task:work');
    expect(fact?.text).not.toContain(secret); expect(fact?.text.includes(action)).toBe(classified);
    expect(sources.find((source) => source.id === 'task-result:work')).toMatchObject({ knowledge: 'statement', ownerNpcId: 'npc-a' });
    expect(JSON.stringify(playerView(saved))).not.toContain(secret);
    expect(result.state).toEqual(saved); expect(before.tasks.work.resolution).toBeUndefined();
    expect(GameStateSchema.safeParse(saved).success).toBe(true);
  });
  it('实际收到举报可作事实使用，但引述内容不能；没有把所有真实任务成果禁用', async () => {
    const { state, raw, action, secret } = mixedOutcome(), repo = await repository(state), { state: saved } = await commit(repo, raw);
    const draft = laterDraft(saved), command: DomainCommand = { type: 'SaveEvent', commandId: 'real-action',
      event: { ...event('receipt'), title: '举报登记', actorRefs: [{ kind: 'npc', id: 'npc-a' }], status: 'resolved', startAt: saved.worldClock,
        resolvedAt: '2026-10-18T08:15:00+08:00', estimatedEndAt: '2026-10-18T08:20:00+08:00', resolutionText: action },
      evidence: proof({ kind: 'established', at: '2026-10-18T08:15:00+08:00', sources: ['task:work'], fact: action }) };
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [command] }), saved, draft)).not.toThrow();
    command.evidence = proof({ kind: 'established', at: '2026-10-18T08:15:00+08:00', sources: ['task:work'], fact: secret });
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), eventCommands: [command] }), saved, draft)).toThrow();
  });
  it('完整成果只允许所属NPC保留转述，不能升级为observed或跨人物认知', async () => {
    const { state, raw, secret } = mixedOutcome(), repo = await repository(state), { state: saved } = await commit(repo, raw), draft = laterDraft(saved);
    expect(() => parseWorld(JSON.stringify(worldResult([memoryCommand(saved, secret, 'reported')])), saved, draft)).not.toThrow();
    expect(() => parseWorld(JSON.stringify(worldResult([memoryCommand(saved, secret, 'observed')])), saved, draft)).toThrow();
    expect(() => parseWorld(JSON.stringify(worldResult([memoryCommand(saved, secret, 'reported', 'npc-b')])), saved, draft)).toThrow();
    expect((await repo.load('save-a')).npc['npc-a'].memories).toEqual([]);
  });
  it('改用derived或混入NPC动机，也不能把statement成果变成实际观察', async () => {
    const { state, raw, secret } = mixedOutcome(), repo = await repository(state), { state: saved } = await commit(repo, raw), draft = laterDraft(saved);
    const command = memoryCommand(saved, secret, 'observed'), evidence = JSON.parse(command.evidence);
    evidence.kind = 'derived'; evidence.sources.push('npc:npc-a'); command.evidence = JSON.stringify(evidence);
    expect(() => parseWorld(JSON.stringify(worldResult([command])), saved, draft)).toThrow();
  });
  it.each(['unknown-field', 'oversized', 'non-text'])('%s认知分类不符合严格Schema，拒绝整个结果', (fault) => {
    const { state, raw } = mixedOutcome(), command = raw.taskCommands[0], evidence = JSON.parse(command.evidence);
    if (fault === 'unknown-field') evidence.decision.resultKnowledge.permissions = 'public';
    if (fault === 'oversized') evidence.decision.resultKnowledge.facts = Array.from({ length: 13 }, () => '事实');
    if (fault === 'non-text') evidence.decision.resultKnowledge.reported = [123];
    command.evidence = JSON.stringify(evidence);
    expect(() => parseWorld(JSON.stringify(raw), state, worldDraft())).toThrow(); expect(state.tasks.work.resolution).toBeUndefined();
  });
  it('同批来源也先验证再引用，不允许从刚终结任务的混合成果中洗出事实', () => {
    const { state, raw, secret } = mixedOutcome(), draft = worldDraft();
    const memory = memoryCommand(state, secret, 'reported');
    const result = { ...raw, worldCommands: [memory] };
    // 完成凭据在08:05，当前投影到08:10，记忆仍限制在窗口内。
    const evidence = JSON.parse(memory.evidence); evidence.at = '2026-10-18T08:06:00+08:00'; memory.evidence = JSON.stringify(evidence);
    memory.memory.createdAtGameTime = evidence.at;
    expect(() => parseWorld(JSON.stringify(result), state, draft)).not.toThrow();
    memory.knowledgeKind = 'observed'; memory.memory.text = secret; evidence.kind = 'established'; memory.evidence = JSON.stringify(evidence);
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow();
  });
  it('转述交接仍允许自由概括，observed不能借原始混合叙述取得未核实主张', () => {
    const { state, raw, secret } = mixedOutcome(), receiver = handoffResult(state).taskCommands[0];
    if (receiver.type !== 'SaveTask') throw Error();
    receiver.task.handoff = { ...receiver.task.handoff!, content: '有举报涉及蓝仓暗格，内容有待核实。', summaryBasis: { mode: 'faithful_summary', resultExcerpt: secret } };
    receiver.evidence = proof({ at: receiver.task.startAt, sources: ['task:work', 'npc:npc-b'], fact: '核对人用工作电话转交举报要点。' });
    raw.taskCommands.push(receiver);
    expect(() => parseWorld(JSON.stringify(raw), state, worldDraft())).not.toThrow();
    receiver.task.handoff.knowledgeKind = 'observed'; expect(() => parseWorld(JSON.stringify(raw), state, worldDraft())).toThrow();
  });
  it('明确的实际核验成果仍支持observed交接，错误认知元数据不能写入', () => {
    const state = handoffState(), raw = handoffResult(state), receiver = raw.taskCommands[0];
    if (receiver.type !== 'SaveTask') throw Error(); receiver.task.handoff!.knowledgeKind = 'observed';
    receiver.task.handoff!.channel = '接收人当面查看已核验的清单原件';
    expect(() => parseWorld(JSON.stringify(raw), state, worldDraft())).not.toThrow();
    const wrong = structuredClone(raw), finish = wrong.taskCommands[1];
    if (finish.type !== 'SaveTask') throw Error();
    finish.task.resolution = { at: '2026-10-18T08:05:00+08:00', outcome: 'success', result: resultText, reason: '伪造', sourceTurnId: 'turn-a',
      resultKnowledge: { facts: ['不存在的核验结论'], reported: [], suspected: [] } };
    expect(() => parseWorld(JSON.stringify(wrong), state, worldDraft())).toThrow();
  });
});

function pendingState() {
  const state = handoffState(); state.npc['npc-a'].relationshipText = '尚未与主角接触'; state.npc['npc-a'].affinity = 0;
  state.contactReviewNpcIds = ['npc-a']; return state;
}
function reviewed(state: ReturnType<typeof handoffState>): Extract<DomainCommand, { type: 'RetireNpc' }> {
  return { ...retireCommand(state), contactReview: { conclusion: 'non_contact', basis: 'no_known_connection', reason: '核验现有记录。' } };
}
describe('旧档历史索引不完整不能推断无联系', () => {
  it('真实Composer向世界模型提供玩家确认输入，但不把输入当成世界事实来源', async () => {
    const state = pendingState(), draft = worldDraft(); draft.userInput = '我确认同事只是非联系人临时人员。';
    const composed = await composePrompt({ stage: 'world', mode: 'regular', state, draft, settings: defaultSettings(), userInput: '', domains: ['npc_ordinary'] });
    expect(composed.context.NPC_LIFECYCLE).toMatchObject({ playerConfirmationInput: draft.userInput });
    expect(JSON.stringify(composed.context.WORLD_SOURCES)).not.toContain(draft.userInput);
    expect(composed.messages.some((message) => message.content.includes(draft.userInput))).toBe(true);
  });
  it.each(['journal', 'short', 'medium', 'long'] as const)('%s无关联ID也保守保护，无需程序分析正文关键词', (layer) => {
    const state = pendingState(), draft = worldDraft();
    if (layer === 'journal') {
      state.journal = [{ turnId: 'past', revision: 1, story: { ...story, narrative: '上次见面之后，大家一直保持联系。' }, relatedActorRefs: [] }];
      state.revision = 1; state.turnNumber = 1; draft.baseSaveRevision = 1;
    }
    else state.memories[layer] = [{ id: 'old', text: '两人互留联系方式。', sourceTurnIds: [], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock }];
    const raw = { ...worldResult([reviewed(state)]), taskCommands: [finishTask(state)] };
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(() => parseWorld(JSON.stringify(raw), state, draft)).toThrow();
    expect(state.npc['npc-a']).toBeDefined();
  });
  it('没有历史与联系迹象的待确认临时NPC仍能安全退出', () => {
    const state = pendingState(), draft = worldDraft(), raw = { ...worldResult([reviewed(state)]), taskCommands: [finishTask(state)] };
    const result = parseWorld(JSON.stringify(raw), state, draft);
    const projected = projectTurn(state, draft, [...result.taskCommands, ...result.worldCommands]);
    expect(projected.npc['npc-a']).toBeUndefined(); expect(state.npc['npc-a']).toBeDefined();
  });
  it('AI写入确认及真实玩家自由文本都不是独立可靠删除授权，旧人继续保护', () => {
    const state = pendingState(), draft = worldDraft();
    state.journal = [{ turnId: 'past', revision: 1, story, relatedActorRefs: [] }];
    state.revision = 1; state.turnNumber = 1; draft.baseSaveRevision = 1;
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    const fact = '主角确认同事属于非联系人临时人员。'; draft.story!.narrative += fact;
    const retirement = reviewed(state); retirement.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: fact, playerConfirmation: fact };
    const evidence = JSON.parse(retirement.evidence); evidence.kind = 'established'; evidence.sources = ['story:current', 'npc:npc-a']; evidence.fact = fact; retirement.evidence = JSON.stringify(evidence);
    const raw = { ...worldResult([retirement]), taskCommands: [finishTask(state)] };
    expect(() => parseWorld(JSON.stringify(raw), state, draft)).toThrow();
    draft.userInput = fact;
    expect(() => parseWorld(JSON.stringify(raw), state, draft)).toThrow();
    state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = [];
    expect(() => parseWorld(JSON.stringify(raw), state, draft)).toThrow();
  });
});
