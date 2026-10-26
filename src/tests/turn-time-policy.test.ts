import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseVariables } from '../services/validation/aiOutputs';
import { completeDraft, submission } from './fixtures/turn';
import { timeState, timeDraft } from './fixtures/time';
import { createTurnDraft } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { historicalPerspective, timeOutcome } from '../domain/timePreflight';
import { worldResult } from './fixtures/world';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { settleTurn, TurnSubmissionSchema } from '../domain/turnCommit';
import { fingerprint } from '../domain/commands';
import { GameStateSchema } from '../domain/state';

const repos: SaveRepository[] = [];
afterEach(() => repos.splice(0).forEach((repo) => repo.close()));
const variables = (worldClock?: string, evidence = '你喝了一口可乐。') => ({
  commands: worldClock ? [{ type: 'SetWorldClock' as const, commandId: 'elapsed', worldClock, evidence }] : [],
  rejectedSuggestions: [], unresolved: [],
});
async function repository(opening = false) {
  const factory = new IDBFactory(), repo = await SaveRepository.open('time-policy', factory); repos.push(repo);
  const state = timeState();
  if (opening) { state.turnNumber = 0; state.revision = 0; state.journal = []; state.memories.short = []; }
  const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('time-policy'); req.onsuccess = () => resolve(req.result); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  return { repo, state, factory };
}
describe('每个正式剧情回合的可变耗时', () => {
  it.each([
    ['你喝了一口可乐。', '2026-12-31T23:02:00+08:00'],
    ['【同事】你好。\n【你】你好。', '2026-12-31T23:00:15+08:00'],
    ['陈宁笑着说：“你好。”你也问候了他。', '2026-12-31T23:00:30+08:00'],
  ])('正文无需时间词：%s', async (narrative, clock) => {
    const state = timeState(), draft = timeDraft(state, '喝水聊天');
    draft.story!.narrative = narrative; draft.story!.variableGuide = [];
    expect(() => parseVariables(JSON.stringify(variables(clock, narrative)), state, draft)).not.toThrow();
    const prompt = await composePrompt({ state, draft, stage: 'variables', mode: 'regular', userInput: draft.userInput, settings: defaultSettings() });
    expect(prompt.context.PLAYER_ACTION).toBe(draft.userInput);
  });
  it('普通回合允许合法零耗时，不增加固定步长', async () => {
    const { repo, state } = await repository();
    const draft = await completeDraft(repo, { narrative: '你喝了一口可乐。', variables: variables() });
    const result = await repo.commitTurn(submission(draft));
    expect(result.state.worldClock).toBe(state.worldClock);
    expect(result.state.turnNumber).toBe(state.turnNumber + 1);
  });
  it.each([false, true])('opening=%s：正式正向推进一次，刷新/重复提交不叠加耗时', async (opening) => {
    const { repo, state } = await repository(opening);
    const draft = await completeDraft(repo, { narrative: '你喝了一口可乐。', variables: variables('2026-12-31T23:02:00+08:00') });
    const input = submission(draft), result = await repo.commitTurn(input);
    expect(result.state.worldClock).toBe('2026-12-31T23:02:00+08:00');
    expect(result.state.revision).toBe(state.revision + 1);
    expect(await repo.commitTurn(input)).toMatchObject({ replayed: true, state: result.state });
    expect((await repo.loadGame(state.saveId)).state).toEqual(result.state);
  });
  it.each([false, true])('opening=%s：允许零耗时但不能倒退，两个入口均保护时钟', async (opening) => {
    const { repo, state } = await repository(opening);
    const draft = await completeDraft(repo, { narrative: '你喝了一口可乐。', variables: variables() });
    expect(settleTurn(state, draft, state.updatedAt).worldClock).toBe(state.worldClock);
    const backwards = await completeDraft(repo, { narrative: '你喝了一口可乐。', variables: variables('2026-12-31T22:59:59+08:00') });
    expect(() => parseVariables(JSON.stringify(backwards.variables!.result), state, backwards)).toThrow();
    await expect(repo.commitTurn(submission(backwards))).rejects.toThrow();
    expect(await repo.load(state.saveId)).toEqual(state);
  });
  it('旧版本已完成的零耗时回合及持久回执仍原样读取和重放，不重新结算', async () => {
    const { repo, state, factory } = await repository();
    const old = await completeDraft(repo, { narrative: '你喝了一口可乐。', variables: variables() });
    const request = TurnSubmissionSchema.parse(submission(old));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(request)));
    const requestHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const legacy = GameStateSchema.parse({ ...state, revision: state.revision + 1, turnNumber: state.turnNumber + 1,
      journal: [...state.journal, { turnId: old.turnId, revision: state.revision + 1, story: old.story, relatedActorRefs: [] }] });
    const next = createTurnDraft(state.saveId, legacy.revision, 'legacy-next', 'regular', request.nextAction);
    const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('time-policy'); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['saves', 'drafts', 'turnReceipts'], 'readwrite');
      tx.objectStore('saves').put(legacy); tx.objectStore('drafts').put(next);
      tx.objectStore('turnReceipts').add({ saveId: state.saveId, turnId: old.turnId, requestHash, revision: legacy.revision, nextTurnId: next.turnId });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
    expect((await repo.loadGame(state.saveId)).state).toEqual(legacy);
    expect(await repo.commitTurn(request)).toEqual({ state: legacy, draft: next, replayed: true });
  });
});

const pastRequest = '切换到陈宁的视角，描写他昨天晚上独自经历的事情。';
const pastStory = '昨天晚上，陈宁独自回顾了此前已知的约定。';
const proof = () => ({ npcId: 'npc-a', perspectiveRequest: '切换到陈宁的视角', pastRequest: '描写他昨天晚上独自经历的事情', temporalScope: 'past_only', currentPlotAdvances: false });
const guide = (value = proof()) => ({ group: 'time' as const, subjectHint: 'time:retrospective', observedFact: JSON.stringify(value), textEvidence: pastStory });
async function retrospective(repo: SaveRepository, input = pastRequest, entries: NonNullable<TurnDraft['story']>['variableGuide'] = [guide()]) {
  const state = await repo.load('save-a');
  await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'past-turn', state.turnNumber === 0 ? 'opening' : 'regular', input), null);
  return completeDraft(repo, { narrative: pastStory, summary: '回顾已有约定', variableGuide: entries, variables: variables(), world: { ...worldResult(), visibleHooks: [] } });
}
describe('其他人物纯历史视角的唯一零耗时例外', () => {
  it.each([false, true])('opening=%s：仅玩家明确要求的过去视角可只读零耗时提交，回执幂等', async (opening) => {
    const { repo, state } = await repository(opening), draft = await retrospective(repo);
    expect(timeOutcome(state, draft, true)).toBeUndefined();
    const result = await repo.commitTurn(submission(draft));
    expect(result.state.worldClock).toBe(state.worldClock);
    for (const key of ['protagonist', 'npc', 'economy', 'events', 'tasks', 'timeline', 'items'] as const) expect(result.state[key]).toEqual(state[key]);
    expect(result.state.journal.at(-1)?.story.narrative).toBe(pastStory);
    expect((await repo.commitTurn(submission(draft))).replayed).toBe(true);
    for (const stage of ['variables', 'world'] as const) {
      const prompt = await composePrompt({ stage, mode: draft.turnKind, state, draft, userInput: draft.userInput, settings: defaultSettings() });
      expect(prompt.context.HISTORICAL_PERSPECTIVE).toEqual(proof());
    }
  });
  it.each([
    '切换到陈宁的视角，描述他现在正在做的事情。',
    '看看周围。',
    '陈宁向我讲述他昨天的事情。',
    '切换到陈宁的视角，回顾昨天后继续推进现在的行动。',
  ])('当前/自插回忆/讲述/混合剧情不能套用旧过去声明冻结：%s', async (input) => {
    const { repo, state } = await repository(), draft = await retrospective(repo, input);
    expect(() => historicalPerspective(state, draft)).toThrow();
    await expect(repo.commitTurn(submission(draft))).rejects.toThrow();
    expect(await repo.load(state.saveId)).toEqual(state);
  });
  it.each(['present', 'mixed'])('即使玩家提到过去，模型声明scope=%s不能冻结', async (temporalScope) => {
    const { repo, state } = await repository(), entry = { ...guide(), observedFact: JSON.stringify({ ...proof(), temporalScope }) }, draft = await retrospective(repo, pastRequest, [entry]);
    expect(() => historicalPerspective(state, draft)).toThrow();
    await expect(repo.commitTurn(submission(draft))).rejects.toThrow();
  });
  it('AI插入闪回不会取得过去视角特权，合法零耗时仍可提交', async () => {
    const { repo, state } = await repository();
    const draft = await completeDraft(repo, { narrative: pastStory + '你继续观察周围。', variables: variables() });
    expect(historicalPerspective(state, draft)).toBeUndefined();
    expect((await repo.commitTurn(submission(draft))).state.worldClock).toBe(state.worldClock);
  });
  it('例外不开放现在的变量、记忆或世界候选写入，也不能借回忆推进几个小时', async () => {
    const { repo, state } = await repository(), draft = await retrospective(repo);
    const changed = { ...draft, variables: { ...draft.variables!, result: variables('2027-01-01T02:00:00+08:00', pastStory) } };
    expect(() => parseVariables(JSON.stringify(changed.variables.result), state, changed)).toThrow();
    expect(() => parseVariables(JSON.stringify({ ...variables(), commands: [{ type: 'UpdateProtagonist', commandId: 'past-health',
      protagonistId: state.protagonist.id, expectedRevision: state.revision, changes: { healthText: '已恢复' }, evidence: pastStory }] }), state, draft)).toThrow();
    const world = { ...worldResult(), visibleHooks: [{ text: '以往秘密现在自动公开' }] };
    expect(() => settleTurn(state, { ...draft, world: { ...draft.world!, result: world } }, state.updatedAt)).toThrow();
    await expect(repo.commitTurn(submission(changed))).rejects.toThrow();
    expect(await repo.load(state.saveId)).toEqual(state);
  });
  it('声明必须唯一，人物及玩家引文不能伪造', () => {
    const state = timeState(), draft = timeDraft(state, pastRequest);
    draft.story!.narrative = pastStory;
    for (const value of [{ ...proof(), npcId: 'missing' }, { ...proof(), npcId: state.protagonist.id }, { ...proof(), pastRequest: 'AI杜撰的要求' }]) {
      draft.story!.variableGuide = [{ ...guide(), observedFact: JSON.stringify(value) }];
      expect(() => historicalPerspective(state, draft)).toThrow();
    }
    draft.story!.variableGuide = [guide()];
    draft.story!.variableGuide = [guide(), guide()];
    expect(() => historicalPerspective(state, draft)).toThrow();
  });
});
