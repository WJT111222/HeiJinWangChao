import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { configureTurnStages, createTurnDraft, rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { completeTurnDraft } from '../domain/turnCommit';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { buildCreationState, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldResult } from './fixtures/world';
import { completeDraft } from './fixtures/turn';
import { variableReply } from './fixtures/variableReply';

let repo: SaveRepository;
let factory: IDBFactory;
const runners: TurnCoordinator[] = [];
beforeEach(async () => { factory = new IDBFactory(); repo = await SaveRepository.open('disabled-stages', factory); });
afterEach(() => { runners.splice(0).forEach(r => r.dispose()); repo.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const body = '【旁白】他走过街边，停下来观察行人。';
const openingGuide = [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:03:00+08:00' }) }];
const story = (guides: unknown[] = [], text = body) => `<正文>${text}</正文><短期记忆>观察行人。</短期记忆><变量规划>${JSON.stringify(guides)}</变量规划>`;
const json = (text: string, finish = 'stop') => Response.json({ choices: [{ message: { content: text }, finish_reason: finish }] });
function setup(variable = false, world = false) {
  const settings = defaultSettings(); settings.runtime.useVariableStage = variable; settings.runtime.useWorldStage = world;
  settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
  const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://disabled-stage.mock.invalid/v1'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const values = new Map<string, string>(), store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-disabled-key');
  return { settings, config, vault };
}
async function seed(realOpening = false) {
  const state = realOpening ? buildCreationState({ ...newCreation(), person: { name: '林舟', age: '30', gender: '女性', appearance: '', personality: '' }, profession: '教师' }, defaultSettings()) : worldState();
  await repo.create(state);
  const draft = createTurnDraft(state.saveId, 0, 'opening', 'opening', '');
  await repo.saveDraft(draft, null); return { state, draft };
}
function runner(fetcher: typeof fetch) { const r = new TurnCoordinator(repo, new AiClient(fetcher)); runners.push(r); return r; }
async function run(r: TurnCoordinator, draft: TurnDraft, input = setup()) {
  return generateAndSettleTurn(r, repo, { ...input, draft }, { check: () => undefined, onSettling: () => undefined });
}
const request = (draft: TurnDraft) => ({ draft, nextAction: '', useVariableStage: draft.useVariableStage, useWorldStage: draft.useWorldStage });

it('真实创角开局只请求Story，初始化唯一开局时钟并保存Journal/短期记忆；刷新、导出及下一回合保持纯小说', async () => {
  const { state, draft } = await seed(true), transport = vi.fn<typeof fetch>(async () => json(story(openingGuide))), commit = vi.spyOn(repo, 'commitTurn');
  const first = (await run(runner(transport), draft)).committed!;
  expect(transport).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0][1]!.body)).model).toBe('story');
  expect(first.state).toMatchObject({ revision: 1, turnNumber: 1, worldClock: '2015-06-01T08:03:00+08:00' });
  expect(first.state.openingTimePending).toBeUndefined();
  expect(first.state.journal[0]).toMatchObject({ scene: { worldClock: '2015-06-01T08:00:00+08:00' }, story: { narrative: body } });
  expect(first.state.memories.short[0]).toMatchObject({ text: '观察行人。', sourceTurnIds: ['opening'] });
  expect(first.state.protagonist).toEqual(state.protagonist); expect(first.state.economy).toEqual(state.economy);
  expect(first.draft.variables).toBeUndefined(); expect(first.draft.world).toBeUndefined();
  repo.close(); repo = await SaveRepository.open('disabled-stages', factory);
  expect((await repo.loadGame(state.saveId)).state).toEqual(first.state);
  const backup = await repo.exportBackup([state.saveId]); expect(JSON.stringify(backup)).toContain(body);
  const imported = await SaveRepository.open('pure-import', new IDBFactory());
  try {
    const entry = backup[0]; const comparison = await imported.compareBackup(entry);
    await imported.importBackup(entry, comparison.confirmation);
    expect((await imported.loadGame(state.saveId)).state).toEqual(first.state);
    expect((await imported.loadDraft(state.saveId))?.useVariableStage).toBe(false);
  } finally { imported.close(); }
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([{ guides: [] }, { guides: [{ group: 'time', subjectHint: 'time:opening', observedFact: '{}' }] }])('真实待定开局缺失或非法时间拒绝，不能用关闭阶段绕过初始化', async ({ guides }) => {
  const { state, draft } = await seed(true), commit = vi.spyOn(repo, 'commitTurn');
  await expect(run(runner(async () => json(story(guides))), draft)).rejects.toThrow();
  expect(commit).toHaveBeenCalledTimes(1); expect(await repo.loadDraft(state.saveId)).toMatchObject({ story: { narrative: body }, stageStatus: { story: 'ready' } }); expect(await repo.load(state.saveId)).toEqual(state);
});

it.each([true, false])('普通回合结构化 time:pause=%s 也不更新纯小说世界；重新开启后恢复三阶段', async pause => {
  const { draft } = await seed();
  const first = (await run(runner(async () => json(story())), draft)).committed!;
  const bound = await repo.bindTurnAction(first.draft, '继续观察', false, false);
  const guides = pause ? [{ group: 'time', subjectHint: 'time:pause', observedFact: '2026-10-18T08:30:00+08:00', textEvidence: '停下观察' }] : [];
  const second = (await run(runner(async () => json(story(guides))), bound)).committed!;
  for (const key of ['worldClock', 'protagonist', 'economy', 'items', 'npc', 'organizations', 'events', 'tasks', 'appliedCommands'] as const) expect(second.state[key]).toEqual(first.state[key]);
  const next = await repo.bindTurnAction(second.draft, '继续观察', true, true), calls: string[] = [];
  const third = (await run(runner(async (_url, init) => {
    const stage = JSON.parse(String(init!.body)).model; calls.push(stage);
    return json(stage === 'story' ? story() : stage === 'variables' ? variableReply({ commands: [], rejectedSuggestions: [], unresolved: [] }) : JSON.stringify(worldResult()));
  }), next, setup(true, true))).committed!;
  expect(calls).toEqual(['story', 'variables', 'world']); expect(third.state.turnNumber).toBe(3);
});

it('已有合法三阶段候选关闭后仍保存以供复用，纯小说结算不应用其现金及世界变化', async () => {
  const { state } = await seed(), original = await completeDraft(repo);
  const transport = vi.fn<typeof fetch>(); const result = await run(runner(transport), original);
  expect(transport).not.toHaveBeenCalled(); expect(result.outcome.draft.variables).toEqual(original.variables);
  expect(result.outcome.draft.world).toEqual(original.world);
  expect(result.committed?.state.economy).toEqual(state.economy); expect(result.committed?.state.worldClock).toBe(state.worldClock);
  expect(result.committed?.state.appliedCommands).toEqual(state.appliedCommands);
});

it('已保存正文/失败下游切为纯小说，通过合法CAS完成，无再次Story请求', async () => {
  const { draft } = await seed(), selected = await repo.saveDraft(rerollStory(draft, { turnKind: 'opening', narrative: body, summary: '观察', variableGuide: [] }), 0);
  const failed = await repo.saveDraft({ ...selected, draftRevision: selected.draftRevision + 1, stageStatus: { ...selected.stageStatus, variables: 'failed' } }, selected.draftRevision);
  const transport = vi.fn<typeof fetch>(); const result = await run(runner(transport), failed);
  expect(transport).not.toHaveBeenCalled(); expect(result.committed?.state.turnNumber).toBe(1);
  expect(result.outcome.draft.executionRevision).toBe(1); expect(result.outcome.draft.variables).toBeUndefined();
});

it('设置只冻结一次：运行中启用两个下游不能改变本次已保存的纯小说方案', async () => {
  const { draft } = await seed(), input = setup(), calls: string[] = [];
  const result = await run(runner(async (_url, init) => {
    calls.push(JSON.parse(String(init!.body)).model);
    input.settings.runtime.useVariableStage = true; input.settings.runtime.useWorldStage = true;
    expect(await repo.loadDraft(draft.saveId)).toMatchObject({ useVariableStage: false, useWorldStage: false });
    return json(story());
  }), draft, input);
  expect(calls).toEqual(['story']); expect(result.committed?.draft.useVariableStage).toBe(false);
});

it('World-only只能预览，不伪造变量，不提交；改为纯小说丢弃preview后无请求结算', async () => {
  const { draft, state } = await seed(), calls: string[] = [];
  const r = runner(async (_url, init) => { const stage = JSON.parse(String(init!.body)).model; calls.push(stage); return json(stage === 'story' ? story() : JSON.stringify(worldResult())); });
  const preview = await run(r, draft, setup(false, true));
  expect(preview.outcome.status).toBe('preview'); expect(preview.committed).toBeUndefined();
  expect(preview.outcome.draft.variables).toBeUndefined(); expect(completeTurnDraft(preview.outcome.draft)).toBe(false);
  expect(await repo.load(state.saveId)).toEqual(state);
  expect((await run(r, preview.outcome.draft)).committed?.state.turnNumber).toBe(1);
  expect(calls).toEqual(['story', 'world']);
});

it.each(['empty', 'short', 'network', 'truncated'] as const)('Story %s 不提前提交，正式世界完全不变', async mode => {
  const { state, draft } = await seed(), commit = vi.spyOn(repo, 'commitTurn');
  const transport = vi.fn<typeof fetch>(async () => {
    if (mode === 'network') throw new TypeError('mock interrupted');
    return json(mode === 'empty' ? '' : mode === 'short' ? story([], '短') : '<正文>他走过街边，停下来', mode === 'truncated' ? 'length' : 'stop');
  });
  await expect(run(runner(transport), draft)).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled(); expect(await repo.load(state.saveId)).toEqual(state); expect(transport).toHaveBeenCalledTimes(1);
});

it('截断刷新恢复→续写完成只保存一次；失败片段、字数与续写规则仍由#177负责', async () => {
  const { state, draft } = await seed(), calls: string[] = [], commit = vi.spyOn(repo, 'commitTurn');
  const r = runner(async (_url, init) => {
    const request = JSON.parse(String(init!.body)); calls.push(request.messages.at(-1).content);
    return calls.length === 1 ? json('<正文>他走过街边，停下来', 'length') : json('观察行人。</正文><短期记忆>观察行人。</短期记忆><变量规划>[]</变量规划>');
  });
  await expect(run(r, draft)).rejects.toThrow(); expect(commit).not.toHaveBeenCalled();
  const restored = (await repo.loadGame(state.saveId)).draft!;
  expect(restored.storyPartial?.continuations).toBe(0);
  const result = await run(r, restored);
  expect(calls).toHaveLength(2); expect(calls[1]).toContain('【续写】'); expect(commit).toHaveBeenCalledTimes(1);
  expect(result.committed?.state.journal).toHaveLength(1); expect(result.committed?.state.journal[0].story.narrative).toBe('他走过街边，停下来观察行人。');
});

it('提交失败后只重新提交，不重发Story', async () => {
  const { draft } = await seed(), transport = vi.fn<typeof fetch>(async () => json(story())), r = runner(transport);
  const original = repo.commitTurn.bind(repo); vi.spyOn(repo, 'commitTurn').mockRejectedValueOnce(Error('mock write failure')).mockImplementation(original);
  await expect(run(r, draft)).rejects.toThrow('mock write failure');
  expect((await repo.load(draft.saveId)).turnNumber).toBe(0);
  const result = await run(r, (await repo.loadDraft(draft.saveId))!);
  expect(result.committed?.state.turnNumber).toBe(1); expect(transport).toHaveBeenCalledTimes(1);
});

it('配置更新CAS拒绝过期快照与偷偷修改正文；旧响应不能覆盖新配置', async () => {
  const { draft } = await seed();
  const configured = configureTurnStages(draft, setup().settings.runtime);
  await repo.saveDraft(configured, draft.draftRevision, undefined, draft);
  await expect(repo.saveDraft(configured, draft.draftRevision, undefined, draft)).rejects.toThrow();
  await expect(repo.saveDraft(rerollStory(draft, { turnKind: 'opening', narrative: body, summary: '观察', variableGuide: [] }), draft.draftRevision, undefined, draft)).rejects.toThrow();
  await expect(repo.saveDraft({ ...configureTurnStages(configured, setup(true, true).settings.runtime), userInput: '偷偷换行动' }, configured.draftRevision, undefined, configured)).rejects.toThrow();
  expect(await repo.loadDraft(draft.saveId)).toEqual(configured);
});

it('纯小说同时提交、幂等回执与撤回保留原有保护', async () => {
  const { draft, state } = await seed(); const prepared = (await runner(async () => json(story())).generate({ ...setup(), draft })).draft;
  const other = await SaveRepository.open('disabled-stages', factory);
  try {
    const results = await Promise.allSettled([repo.commitTurn(request(prepared)), other.commitTurn(request(prepared))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const replay = await repo.commitTurn(request(prepared)); expect(replay.replayed).toBe(true); expect(replay.state.turnNumber).toBe(1);
    const bound = await repo.bindTurnAction(replay.draft, '再观察', false, false);
    const next = (await run(runner(async () => json(story())), bound)).committed!;
    const status = await repo.undoStatus(state.saveId);
    expect(status.available).toBe(1);
    expect(next.state.turnNumber).toBe(2);
    const undone = await repo.undoTurn({ saveId: state.saveId, expectedRevision: next.state.revision, expectedDraft: next.draft, operationId: 'pure-undo' });
    expect(undone.state.turnNumber).toBe(1); expect(undone.state.journal).toEqual(replay.state.journal);
    expect(undone.state.memories).toEqual(replay.state.memories); expect(undone.input).toBe('再观察');
    await expect(repo.commitTurn(request(prepared))).rejects.toThrow();
  } finally { other.close(); }
});

it('纯小说提交IDB回执故障整批回滚，恢复只提交不重复收费', async () => {
  const { draft, state } = await seed(); const transport = vi.fn<typeof fetch>(async () => json(story())), r = runner(transport);
  const add = IDBObjectStore.prototype.add;
  const fault = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'turnReceipts') throw new DOMException('mock write failure', 'UnknownError');
    return add.call(this, value, key);
  });
  await expect(run(r, draft)).rejects.toThrow(); expect(await repo.load(state.saveId)).toEqual(state);
  fault.mockRestore(); expect((await run(r, (await repo.loadDraft(state.saveId))!)).committed?.state.turnNumber).toBe(1);
  expect(transport).toHaveBeenCalledTimes(1);
});


it('缺失Web Locks在设置CAS和任何收费请求之前拒绝，草稿及正式存档不变', async () => {
  const { state, draft } = await seed(); vi.stubGlobal('navigator', {}); vi.stubGlobal('window', { localStorage: { getItem: () => null } });
  const transport = vi.fn<typeof fetch>();
  await expect(run(runner(transport), draft)).rejects.toMatchObject({ code: 'concurrency_unavailable' });
  expect(transport).not.toHaveBeenCalled(); expect(await repo.loadDraft(state.saveId)).toEqual(draft);
  expect(await repo.load(state.saveId)).toEqual(state);
});

it('纯小说请求中第二标签会话不能发出第二笔请求；取消后迟到正文不能保存，可主动重试', async () => {
  const { state, draft } = await seed(); let release!: (response: Response) => void;
  const hold = new Promise<Response>(resolve => { release = resolve; });
  let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  const r = runner(async () => { started(); return hold; });
  const pending = run(r, draft); const rejection = expect(pending).rejects.toThrow(); await entered;
  const other = await SaveRepository.open('disabled-stages', factory), transport = vi.fn<typeof fetch>();
  const second = new TurnCoordinator(other, new AiClient(transport)); runners.push(second);
  try {
    await expect(run(second, (await repo.loadDraft(state.saveId))!)).rejects.toMatchObject({ code: 'STORY_BUSY' });
    expect(transport).not.toHaveBeenCalled(); r.cancel(); release(json(story())); await rejection;
    expect(await repo.load(state.saveId)).toEqual(state); expect((await repo.loadDraft(state.saveId))?.story).toBeUndefined();
    const retry = await run(runner(async () => json(story())), (await repo.loadDraft(state.saveId))!);
    expect(retry.committed?.state.turnNumber).toBe(1);
  } finally { other.close(); }
});

it('Variables-only跳过越权命令，正文及安全结果仍可提交', async () => {
  const { state, draft } = await seed(); const commit = vi.spyOn(repo, 'commitTurn');
  const r = runner(async (_url, init) => json(JSON.parse(String(init!.body)).model === 'story' ? story() : variableReply({ commands: [{ type: 'UpdateProtagonist', commandId: 'bad', changes: { talentId: 'cyber_tyrant' } }], rejectedSuggestions: [], unresolved: [] })));
  const saved = (await run(r, draft, setup(true, false))).committed!;
  expect(commit).toHaveBeenCalledTimes(1);
  expect(saved.state.protagonist).toEqual(state.protagonist);
  expect(saved.state.journal.at(-1)?.settlement?.variables?.skipped).toHaveLength(1);
});
