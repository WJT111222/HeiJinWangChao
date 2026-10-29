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
import { worldSources } from '../services/validation/worldEvidence';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { playerView } from '../ui/panels/playerView';
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
  const result = parseWorld(JSON.stringify(factory(await repo.load('save-a'), draft)), await repo.load('save-a'), draft);
  return repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1,
    world: { ...draft.world!, result, candidateRevision: 2 } }, draft.draftRevision);
}
async function commit(repo: SaveRepository, factory: Factory, narrative?: string, nextAction?: string) {
  return repo.commitTurn(submission(await ready(repo, factory, narrative), nextAction));
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
function followEvent(state: GameState, draft: TurnDraft, fact = claim): Extract<DomainCommand, { type: 'SaveEvent' }> {
  const at = new Date(Date.parse(state.worldClock) + 300000).toISOString();
  return { type: 'SaveEvent', commandId: 'follow-report', event: { ...event('follow'), title: '仓库情况确认',
    status: 'resolved', startAt: state.worldClock, estimatedEndAt: at, resolvedAt: at, resolutionText: fact,
    actorRefs: [{ kind: 'npc', id: 'npc-b' }], sourceTurnIds: [draft.turnId] },
    evidence: proof({ kind: 'established', at, sources: ['event:report', 'npc:npc-b'], fact }) };
}
const affirmative = '主角确认同事属于非联系人临时人员。';
function confirmedRetirement(state: GameState, draft: TurnDraft) {
  const retirement = retireCommand(state), at = new Date(Date.parse(state.worldClock) + 300000).toISOString();
  retirement.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: '引用玩家确认。', playerConfirmation: '同事属于非联系人临时人员' };
  const evidence = JSON.parse(retirement.evidence); evidence.kind = 'established'; evidence.at = at;
  evidence.fact = affirmative; evidence.sources = ['story:current', 'npc:npc-a']; retirement.evidence = JSON.stringify(evidence);
  expect(draft.userInput).toContain(retirement.contactReview.playerConfirmation);
  return { ...worldResult([retirement]), taskCommands: [finishTask(state, 'work', at)] };
}

describe('PR22第三轮：先用真实提交复现', () => {
  it('收到举报事件正式结案后，下一回合不能用event:report截取未核实主张形成事实', async () => {
    const repo = await repository();
    const first = await commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [reportEvent(state, draft)] }));
    expect(first.state.events.report.status).toBe('resolved');
    expect(first.state.events.report.resolutionText).toContain(claim);
    await expect(commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [followEvent(state, draft)] }))).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(first.state);
  });
  it.each([
    '我不确认同事属于非联系人临时人员，先不要删除。',
    '如果查明同事属于非联系人临时人员，再考虑是否让他退出。',
    '经理说“同事属于非联系人临时人员”，这不是我的确认。',
    '不要把“同事属于非联系人临时人员”当成删除授权，我明确拒绝。',
  ])('真实输入“%s”中的肯定片段不构成删除授权，错误AI正文也不能代替授权', async (input) => {
    const state = handoffState(); state.contactReviewNpcIds = ['npc-a'];
    state.npc['npc-a'].relationshipText = '尚未与主角接触'; state.npc['npc-a'].affinity = 0;
    const repo = await repository(state);
    const first = await commit(repo, () => worldResult(), '主角与同事交换联系方式，以后保持联系。', input);
    expect((await repo.loadDraft('save-a'))?.userInput).toBe(input);
    await expect(commit(repo, confirmedRetirement, affirmative)).rejects.toThrow();
    const preserved = await repo.load('save-a'); expect(preserved).toEqual(first.state);
    expect(preserved.npc['npc-a']).toBeDefined(); expect(preserved.retiredNpcs['npc-a']).toBeUndefined();
  });
});

function classifiedReport(state: GameState, draft: TurnDraft) {
  const command = reportEvent(state, draft), evidence = JSON.parse(command.evidence);
  evidence.decision.resultKnowledge = { facts: [received], reported: [claim], suspected: ['举报人可能认错仓库。'] };
  command.evidence = JSON.stringify(evidence); return command;
}
describe('事件事实、结果叙述和计划的独立来源', () => {
  it('收到举报的真实行动继续可用，举报不成为事实；分类由程序随正式回合保存', async () => {
    const repo = await repository(), input = await ready(repo, (state, draft) => ({ ...worldResult(), eventCommands: [classifiedReport(state, draft)] }));
    expect((await repo.load('save-a')).events.report).toBeUndefined();
    const first = await repo.commitTurn(submission(input)), sources = worldSources(first.state, first.draft);
    expect(first.state.events.report.resultKnowledge).toEqual({ facts: [received], reported: [claim], suspected: ['举报人可能认错仓库。'] });
    expect(sources.find((source) => source.id === 'event:report')).toMatchObject({ knowledge: 'fact', worldEventOnly: true });
    const factual = sources.find((source) => source.id === 'event:report')!.text;
    expect(factual).toContain(received); expect(factual).not.toContain(claim); expect(factual).not.toContain('举报受理');
    expect(sources.find((source) => source.id === 'event-result:report')).toMatchObject({ knowledge: 'statement', worldEventOnly: true });
    expect(sources.find((source) => source.id === 'event-plan:report')).toMatchObject({ knowledge: 'plan', worldEventOnly: true });
    await expect(commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [followEvent(state, draft)] }))).rejects.toThrow();
    const next = await commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [followEvent(state, draft, received)] }));
    expect(next.state.events.follow.resolutionText).toBe(received);
  });
  it('独立观察核验的事件成果可延续，未禁止AI自主形成事件', async () => {
    const state = handoffState(); state.npc['npc-a'].memories = [{ id: 'independent-check', text: claim,
      knowledgeKind: 'observed', knowledgeSource: '独立亲眼开箱核查', createdAtGameTime: state.worldClock,
      affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }], sourceTurnIds: [], visibility: 'npc_private' }];
    const repo = await repository(state);
    const first = await commit(repo, (current, draft) => {
      const command = reportEvent(current, draft); command.event.title = '实物核验归档'; command.event.resolutionText = claim;
      const evidence = JSON.parse(command.evidence); evidence.kind = 'established'; evidence.sources = ['memory:npc-a:independent-check']; evidence.fact = claim;
      evidence.decision.result = claim; evidence.decision.resultKnowledge = { facts: [claim], reported: [], suspected: [] };
      command.evidence = JSON.stringify(evidence); return { ...worldResult(), eventCommands: [command] };
    });
    expect(worldSources(first.state, first.draft).find((source) => source.id === 'event:report')?.text).toContain(claim);
    const next = await commit(repo, (current, draft) => ({ ...worldResult(), eventCommands: [followEvent(current, draft)] }));
    expect(next.state.events.follow.status).toBe('resolved');
  });
  it.each(['event:report', 'event-result:report', 'event-plan:report'])('%s不能将隐藏事件升级为NPC认知或主角公开知识', async (sourceId) => {
    const repo = await repository(), first = await commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [classifiedReport(state, draft)] }));
    await expect(ready(repo, (state) => ({ ...worldResult([{ type: 'UpdateNpc', commandId: 'hidden-knowledge', npcId: 'npc-b', expectedRevision: state.revision,
      changes: { healthText: '得知举报后紧张' }, evidence: proof({ kind: sourceId === 'event:report' ? 'established' : 'derived',
        at: new Date(Date.parse(state.worldClock) + 300000).toISOString(), sources: [sourceId, 'npc:npc-b'], fact: received }) }]) }))).rejects.toThrow();
    expect(JSON.stringify(playerView(first.state))).not.toContain(claim);
    const context = contextFor({ stage: 'story', mode: 'regular', state: first.state, settings: defaultSettings(), userInput: '继续休息' });
    expect(JSON.stringify(context)).not.toContain(claim);
    expect(await repo.load('save-a')).toEqual(first.state);
  });
  it.each(['established', 'derived'] as const)('event-result中的引述即使另引动机，也不能以%s作为客观事件事实', async (kind) => {
    const repo = await repository(); await commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [classifiedReport(state, draft)] }));
    await expect(ready(repo, (state, draft) => {
      const command = followEvent(state, draft), evidence = JSON.parse(command.evidence);
      evidence.kind = kind; evidence.sources = ['event-result:report', 'npc:npc-b']; command.evidence = JSON.stringify(evidence);
      return { ...worldResult(), eventCommands: [command] };
    })).rejects.toThrow();
  });
  it('已知事件的自由标题与引述同样不进入事实或playerKnownText', async () => {
    const repo = await repository(), first = await commit(repo, (state, draft) => ({ ...worldResult(), eventCommands: [classifiedReport(state, draft)] }));
    const state = structuredClone(first.state); state.events.report.visibility = 'known'; state.events.report.title = claim;
    const factual = worldSources(state, first.draft).find((source) => source.id === 'event:report');
    expect(factual?.playerKnownText).toContain(received); expect(factual?.text).not.toContain(claim); expect(factual?.playerKnownText).not.toContain(claim);
  });
  it('同批新结案事件也先验证再引用事实，依赖逆序不绕过分层', async () => {
    const repo = await repository(), before = await repo.load('save-a');
    const selected = await ready(repo, (state, draft) => {
      const report = classifiedReport(state, draft), follow = followEvent(state, draft, received);
      const at = new Date(Date.parse(state.worldClock) + 360000).toISOString(); follow.event.resolvedAt = at; follow.event.estimatedEndAt = at;
      const evidence = JSON.parse(follow.evidence); evidence.at = at; follow.evidence = JSON.stringify(evidence);
      return { ...worldResult(), eventCommands: [follow, report] };
    });
    expect(selected.world?.result.eventCommands).toHaveLength(2); expect(await repo.load('save-a')).toEqual(before);
    await expect(ready(repo, (state, draft) => ({ ...worldResult(), eventCommands: [followEvent(state, draft), classifiedReport(state, draft)] }))).rejects.toThrow();
  });
  it('成果分类与凭据不一致或提前存入未结案事件时拒绝', async () => {
    const repo = await repository();
    await expect(ready(repo, (state, draft) => {
      const command = classifiedReport(state, draft); command.event.resultKnowledge = { facts: [claim], reported: [], suspected: [] };
      return { ...worldResult(), eventCommands: [command] };
    })).rejects.toThrow();
    const state = handoffState(); state.events.future = { ...event('future'), resultKnowledge: { facts: [received], reported: [], suspected: [] } };
    expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
  it.each([1, 2, 3, 4])('真实IndexedDB中的V%s旧已结案事件可读取，不补造事实，回执可重放', async (version) => {
    const factory = new IDBFactory(), repo = await repository(handoffState(), factory);
    const selected = await ready(repo, (state, draft) => ({ ...worldResult(), eventCommands: [reportEvent(state, draft)] })), input = submission(selected);
    const first = await repo.commitTurn(input), raw = { ...first.state, schemaVersion: version }; Reflect.deleteProperty(raw, 'retiredEvents');
    if (version < 4) Reflect.deleteProperty(raw, 'contactReviewNpcIds');
    if (version < 3) { Reflect.deleteProperty(raw, 'contactNpcIds'); Reflect.deleteProperty(raw, 'retiredNpcs'); }
    if (version === 1) { Reflect.deleteProperty(raw, 'weatherText'); Reflect.deleteProperty(raw, 'environmentText'); }
    const db = await new Promise<IDBDatabase>((resolve) => { const request = factory.open('handoff-review3'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    const loaded = await repo.load('save-a'); expect(loaded.events).toEqual(first.state.events); expect(loaded.revision).toBe(first.state.revision);
    expect(loaded.journal).toEqual(first.state.journal); expect(loaded.events.report.resultKnowledge).toBeUndefined();
    expect(worldSources(loaded, first.draft).find((source) => source.id === 'event:report')?.text).not.toContain(claim);
    expect((await repo.commitTurn(input)).replayed).toBe(true);
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

describe('没有独立可信授权信号时保守保护旧人', () => {
  it('即使玩家自由文本肯定确认，当前也不声称存在可靠删除确认交互', async () => {
    const state = handoffState(); state.contactReviewNpcIds = ['npc-a']; const repo = await repository(state);
    await commit(repo, () => worldResult(), '主角与同事交换联系方式。', '我确认同事属于非联系人临时人员。');
    await expect(commit(repo, confirmedRetirement, affirmative)).rejects.toThrow();
    expect((await repo.load('save-a')).npc['npc-a']).toBeDefined();
  });
  it('绕过世界验证直接模拟命令也不能用旧player_confirmed字段删除待复核人物', () => {
    const state = handoffState(); state.tasks = {}; state.contactReviewNpcIds = ['npc-a'];
    const retirement = retireCommand(state); retirement.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: '文本确认', playerConfirmation: affirmative };
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(() => commitCommands(state, 'direct', state.revision, [retirement])).toThrow('旧档联系人身份尚未可靠复核');
    expect(state.npc['npc-a']).toBeDefined();
  });
  it.each(['contact', 'companion'] as const)('%s的永久保护不被任何文本确认解除', (kind) => {
    const state = handoffState(); state.tasks = {}; state.contactReviewNpcIds = [];
    if (kind === 'contact') state.contactNpcIds = ['npc-a'];
    else { state.npc['npc-a'] = { ...state.npc['npc-a'], kind: 'special', detailedBackground: '初始同伴', activeGoals: [], habits: [], longTermMemories: [], offscreenTaskIds: [] }; state.initialCompanionId = 'npc-a'; }
    const command = retireCommand(state); command.contactReview = { conclusion: 'non_contact', basis: 'player_confirmed', reason: '确认', playerConfirmation: affirmative };
    expect(() => commitCommands(state, 'direct', state.revision, [command])).toThrow('联系人、初始同伴和现场人物保留完整档案');
  });
  it('无历史、无联系迹象的普通临时NPC仍先存候选，再原子退场并保留必要成果', async () => {
    const state = handoffState(); state.contactReviewNpcIds = ['npc-a']; state.npc['npc-a'].relationshipText = '尚未与主角接触'; state.npc['npc-a'].affinity = 0;
    const repo = await repository(state), selected = await ready(repo, (current) => {
      const at = new Date(Date.parse(current.worldClock) + 300000).toISOString(), command = retireCommand(current);
      command.contactReview = { conclusion: 'non_contact', basis: 'no_known_connection', reason: '没有历史或任何联系迹象。' };
      return { ...worldResult([command]), taskCommands: [finishTask(current, 'work', at)] };
    });
    expect(await repo.load('save-a')).toEqual(state);
    const result = await repo.commitTurn(submission(selected)); expect(result.state.npc['npc-a']).toBeUndefined();
    expect(result.state.retiredNpcs['npc-a']).toBeDefined(); expect(result.state.tasks.work.resolution).toBeDefined();
  });
});
