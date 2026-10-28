import { variableReply } from './fixtures/variableReply';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft } from '../domain/drafts';
import { timePreflight } from '../domain/timePreflight';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { record, array, string } from '../services/ai/protocols';
import { defaultSettings } from '../ui/settings/model';
import { StoryStage } from '../workflows/storyStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { parseVariables } from '../services/validation/aiOutputs';
import { timeState, timeStory } from './fixtures/time';
import { worldResult } from './fixtures/world';
import { submission } from './fixtures/turn';

const resources: { dispose?: () => void; close?: () => void }[] = [];
afterEach(() => { resources.splice(0).reverse().forEach((item) => { item.dispose?.(); item.close?.(); }); vi.restoreAllMocks(); });
async function seed(state = timeState(), action = '睡到明天早上8点', flags = { variables: true, world: true }) {
  const factory = new IDBFactory(), repo = await SaveRepository.open('time-runtime', factory); resources.push(repo);
  const db = await new Promise<IDBDatabase>((resolve) => { const req = factory.open('time-runtime'); req.onsuccess = () => resolve(req.result); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  const draft = createTurnDraft(state.saveId, state.revision, 'sleep-turn', 'regular', action, flags.variables, flags.world);
  await repo.saveDraft(draft, null); return { repo, factory, state, draft };
}
function setup() {
  const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://time.mock.invalid/v1'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const map = new Map<string, string>(), store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'time-mock-secret');
  const settings = defaultSettings(); settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 1;
  return { config, vault, settings };
}
function context(init?: RequestInit) {
  const body = record(JSON.parse(String(init?.body))), text = array(body.messages).map((message) => string(record(message).content)).join('\n');
  const match = text.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/); if (!match) throw new Error('missing context');
  return { model: string(body.model), ctx: record(JSON.parse(match[1])) };
}
function wireStory(interrupt = false, bad = false) {
  const story = timeStory(interrupt), text = `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(bad ? [] : story.variableGuide)}</变量规划>`;
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
function variableResult(state: GameState, draft: TurnDraft, interrupt = false) {
  const story = timeStory(interrupt), guide = story.variableGuide[0];
  const commands: DomainCommand[] = [{ type: 'SetWorldClock', commandId: 'sleep-clock', worldClock: guide.observedFact, evidence: guide.textEvidence }];
  if (interrupt) commands.push({ type: 'SaveEvent', commandId: 'visitor-arrived', evidence: guide.textEvidence,
    event: { ...state.events.visitor, status: 'active', sourceTurnIds: [...state.events.visitor.sourceTurnIds, draft.turnId] } });
  return { commands, rejectedSuggestions: [], unresolved: [] };
}
const jsonWire = (value: unknown) => Response.json({ choices: [{ message: { content: value && typeof value==='object' && 'commands' in value ? variableReply(value) : JSON.stringify(value) } }] });
function coordinator(repo: SaveRepository, fetcher: typeof fetch) { const value = new TurnCoordinator(repo, new AiClient(fetcher)); resources.push(value); return value; }
function storyRunner(repo: SaveRepository, fetcher: typeof fetch) { const value = new StoryStage(repo, new AiClient(fetcher)); resources.push(value); return value; }

describe('真实三阶段、正式事务及恢复中的时间预检', () => {
  it.each([false, true])('interrupt=%s：只用原三阶段；候选不改时钟，提交一次才推进，重复回执不重复事件', async (interrupt) => {
    const { state, repo, draft } = await seed(timeState(interrupt)), calls: string[] = [];
    const runner = coordinator(repo, async (_url, init) => {
      const { model, ctx } = context(init); calls.push(model);
      if (model === 'story') {
        expect(record(ctx.TIME_PREFLIGHT).targetAt).toBe('2027-01-01T08:00:00+08:00');
        expect(array(record(ctx.TIME_PREFLIGHT).candidates)).toHaveLength(interrupt ? 1 : 0);
        return wireStory(interrupt);
      }
      if (model === 'variables') return jsonWire(variableResult(state, draft, interrupt));
      expect(record(ctx.TIME_WINDOW).to).toBe(timeStory(interrupt).variableGuide[0].observedFact);
      return jsonWire(worldResult());
    });
    const outcome = await runner.generate({ draft, ...setup() });
    expect(calls).toEqual(['story', 'variables', 'world']); expect(await repo.load(state.saveId)).toEqual(state);
    const committed = await repo.commitTurn(submission(outcome.draft));
    expect(committed.state.worldClock).toBe(timeStory(interrupt).variableGuide[0].observedFact);
    expect(committed.state.revision).toBe(state.revision + 1); expect(committed.state.journal).toHaveLength(2);
    if (interrupt) {
      expect(committed.state.events.visitor.status).toBe('active'); // 实际敲门事实，不是到期自动结案。
      expect(timePreflight(committed.state, '睡到早上8点').candidates).toEqual([]);
    }
    const replay = await repo.commitTurn(submission(outcome.draft)); expect(replay.replayed).toBe(true); expect(replay.state).toEqual(committed.state);
  });
  it('相关候选也允许继续睡至早晨，不强制打断或把到期事件改成已完成', async () => {
    const { state, repo, draft } = await seed(timeState(true));
    const runner = coordinator(repo, async (_url, init) => context(init).model === 'story' ? wireStory() : jsonWire(context(init).model === 'variables' ? variableResult(state, draft) : worldResult()));
    const result = await runner.generate({ draft, ...setup() }); const saved = await repo.commitTurn(submission(result.draft));
    expect(saved.state.worldClock).toBe('2027-01-01T08:00:00+08:00'); expect(saved.state.events.visitor).toEqual(state.events.visitor);
  });
  it('缺少停止规划不拒绝正常正文；正式时钟仍完整不提前推进', async () => {
    const { state, repo, draft } = await seed();
    const saved = await storyRunner(repo, async () => wireStory(false, true)).generate({ draft, ...setup() });
    expect(saved.story?.variableGuide).toEqual([]);
    expect(await repo.loadDraft(state.saveId)).toEqual(saved); expect(await repo.load(state.saveId)).toEqual(state);
  });
  it('变量失败后刷新只恢复下游；预检不预先推进时间，也不重复支付正文', async () => {
    const { state, repo, factory, draft } = await seed(timeState(true)); let fail = true; const calls: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => { const { model } = context(init); calls.push(model); return model === 'story' ? wireStory(true) : model === 'variables' ? fail ? jsonWire('bad') : jsonWire(variableResult(state, draft, true)) : jsonWire(worldResult()); };
    await expect(coordinator(repo, fetcher).generate({ draft, ...setup() })).rejects.toThrow();
    const partial = await repo.loadDraft(state.saveId); expect(partial?.story?.variableGuide[0].observedFact).toBe('2027-01-01T03:00:00+08:00'); expect(await repo.load(state.saveId)).toEqual(state);
    fail = false;
    const reopened = await SaveRepository.open('time-runtime', factory); resources.push(reopened);
    const outcome = await coordinator(reopened, fetcher).generate({ draft: (await reopened.loadDraft(state.saveId))!, ...setup() });
    expect(calls.filter((call) => call === 'story')).toHaveLength(1); expect(outcome.status).toBe('complete'); expect(await reopened.load(state.saveId)).toEqual(state);
  });
  it('重新Roll以同一正式基线重算并使旧时间/变量/世界失效，不叠加睡眠时长', async () => {
    const { state, repo, draft } = await seed(timeState(true));
    const fetcher: typeof fetch = async (_url, init) => context(init).model === 'story' ? wireStory(true) : jsonWire(context(init).model === 'variables' ? variableResult(state, draft, true) : worldResult());
    const ready = await coordinator(repo, fetcher).generate({ draft, ...setup() });
    const rerolled = await storyRunner(repo, async (_url, init) => { expect(record(context(init).ctx.TIME_PREFLIGHT).from).toBe(state.worldClock); return wireStory(false); }).generate({ draft: ready.draft, ...setup() });
    expect(rerolled.variables).toBeUndefined(); expect(rerolled.world).toBeUndefined(); expect(rerolled.storyRevision).toBe(ready.draft.storyRevision + 1);
    expect(rerolled.story?.variableGuide[0].observedFact).toBe('2027-01-01T08:00:00+08:00'); expect(await repo.load(state.saveId)).toEqual(state);
  });
  it.each([{ variables: false, world: false }, { variables: false, world: true }, { variables: true, world: false }])('关闭阶段%j不伪造时间结算', async (flags) => {
    const { state, repo, draft } = await seed(timeState(), undefined, flags), input = setup(), calls: string[] = [];
    input.settings.runtime.useVariableStage = flags.variables; input.settings.runtime.useWorldStage = flags.world;
    const result = await coordinator(repo, async (_url, init) => { const { model } = context(init); calls.push(model); return model === 'story' ? wireStory() : jsonWire(model === 'variables' ? variableResult(state, draft) : worldResult()); }).generate({ draft, ...input });
    expect(calls).toEqual(['story', ...(flags.variables ? ['variables'] : []), ...(flags.world ? ['world'] : [])]);
    if (flags.world && !flags.variables) expect(result.draft.world?.validation).toBe('preview');
    await expect(repo.commitTurn(submission(result.draft))).rejects.toThrow(); expect(await repo.load(state.saveId)).toEqual(state);
  });
  it('并发/取消/迟到不能覆盖新行动，新动作地点重新预检而不是沿用旧事件', async () => {
    const { state, repo, draft } = await seed(timeState(true)); let release!: () => void, started!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { started = resolve; });
    const first = storyRunner(repo, async () => { started(); await hold; return wireStory(true); });
    const pending = first.generate({ draft, ...setup() }), stopped = expect(pending).rejects.toMatchObject({ code: 'cancelled' }); await ready;
    await expect(storyRunner(repo, async () => wireStory()).generate({ draft, ...setup() })).rejects.toThrow();
    first.cancel(); await stopped;
    await repo.save(state.saveId, state.revision, 'relocate', [{ type: 'UpdateProtagonist', commandId: 'move', expectedRevision: state.revision, protagonistId: state.protagonist.id, evidence: '已经出门', changes: { locationId: 'chongqing' } }]);
    await repo.deleteDraft(state.saveId, draft.draftRevision);
    const newer = await repo.load(state.saveId), next = createTurnDraft(state.saveId, newer.revision, 'next-action', 'regular', '在街边等待一小时'); await repo.saveDraft(next, null);
    release(); await Promise.resolve();
    expect(await repo.loadDraft(state.saveId)).toEqual(next); expect(timePreflight(newer, next.userInput).candidates).toEqual([]); expect(newer.worldClock).toBe(state.worldClock);
  });
  it('正式revision在生成中变化时，旧响应不得保存时间结果', async () => {
    const { state, repo, draft } = await seed();
    const runner = storyRunner(repo, async () => { await repo.save(state.saveId, state.revision, 'external', [{ type: 'SetWorldClock', commandId: 'external-clock', evidence: '实际经过一分钟', worldClock: '2026-12-31T23:01:00+08:00' }]); return wireStory(); });
    await expect(runner.generate({ draft, ...setup() })).rejects.toThrow(); expect((await repo.load(state.saveId)).worldClock).toBe('2026-12-31T23:01:00+08:00'); expect(await repo.loadDraft(state.saveId)).toEqual(draft);
  });
  it('正式事务失败时，时钟、事件、正文和记忆一起回滚', async () => {
    const { state, repo, draft } = await seed(timeState(true));
    const result = await coordinator(repo, async (_url, init) => context(init).model === 'story' ? wireStory(true) : jsonWire(context(init).model === 'variables' ? variableResult(state, draft, true) : worldResult())).generate({ draft, ...setup() });
    const add = IDBObjectStore.prototype.add; vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) { if (this.name === 'turnReceipts') throw new DOMException('failed', 'QuotaExceededError'); return add.apply(this, args); });
    await expect(repo.commitTurn(submission(result.draft))).rejects.toThrow(); expect(await repo.load(state.saveId)).toEqual(state); expect(await repo.loadDraft(state.saveId)).toEqual(result.draft);
    const wrong = { ...variableResult(state, draft, true), commands: [{ type: 'SetWorldClock', commandId: 'late', worldClock: '2027-01-01T08:00:00+08:00', evidence: '凌晨03:00，已约定访客敲门声将你唤醒。' }] };
    expect(() => parseVariables(JSON.stringify(wrong), state, result.draft)).toThrow();
  });
});
