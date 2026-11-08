import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { buildCreationState, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { openingLives, openingValues, openingStart, openingEnd } from './fixtures/openingLives';
import type { OpeningLife } from './fixtures/openingLives';
import { variableTextEnvelope } from './fixtures/variableReply';
import { worldResult } from './fixtures/world';
import { submission } from './fixtures/turn';

const repos: SaveRepository[] = [], runners: TurnCoordinator[] = [];
afterEach(() => { runners.splice(0).forEach(r => r.dispose()); repos.splice(0).forEach(r => r.close()); vi.restoreAllMocks(); });
async function setup(life: OpeningLife = openingLives[0]) {
  const form = newCreation(); form.saveId = 'save-a'; form.person = { name: '林舟', age: life.age, gender: '男性', appearance: '', personality: '' };
  form.profession = 'custom'; form.customProfession = life.profession; form.background = life.background;
  form.professionDescription = '自定义工作介绍：' + life.profession; form.professionLongTermImpact = '长期联系与生活经验。'; form.skills = '工作安排\n沟通';
  form.city = life.key === 'comfortable' ? 'shanghai' : 'chongqing';
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const state = buildCreationState(form, settings), config = defaultAiConfig(), channel = newChannel();
  channel.defaultModel = 'story'; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const storage = new Map<string, string>(), local = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } };
  const vault = new CredentialVault(local, local); vault.set(channel.id, 'mock-opening-life-key');
  const repo = await SaveRepository.open('opening-life', new IDBFactory()); repos.push(repo); await repo.create(state);
  const draft = createTurnDraft(state.saveId, 0, 'first-turn', 'opening', ''); await repo.saveDraft(draft, null);
  return { state, draft, repo, config, vault, settings };
}
function transport(life: OpeningLife, options: { failWorld?: boolean; omitInitialization?: boolean } = {}) {
  const calls: { stage: string; context: Record<string, unknown>; prompt: string }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), prompt: string = body.messages.map((m: { content: string }) => m.content).join('\n');
    const context = JSON.parse(prompt.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]);
    const stage: string = body.model; calls.push({ stage, context, prompt });
    const opening = Boolean(context.OPENING_TIME);
    let text: string;
    if (stage === 'story') text = `<thinking>保持人物设定，建立日常生活。</thinking><正文>${opening ? life.narrative : '【旁白】林舟买好早餐，收到约定的小额报酬。'}</正文><短期记忆>回顾家庭与工作生活，了解新的机会。</短期记忆><变量规划>${JSON.stringify(opening ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: openingStart, endAt: openingEnd }) }] : [])}</变量规划>`;
    else if (stage === 'variables') text = variableTextEnvelope(`<命令>\n${opening ? options.omitInitialization ? '' : `set opening.initialState = ${JSON.stringify(openingValues(life))}\nset protagonist.healthText = "身体健康"\nset protagonist.emotionText = "平静"\nset locations[home] = ${JSON.stringify({name: '住处', parentId: life.key === 'comfortable' ? 'shanghai' : 'chongqing'})}\nset protagonist.locationId = "home"\nset items[coat] = {"name":"常穿的外套","category":"top","quantity":1,"ownerRef":{"kind":"protagonist","id":"protagonist"},"conditionText":"干净完好"}` : 'set worldClock = "2015-07-08T08:15:00+08:00"\nadd economy.cash = -1200\nset economy.incomes[paid] = {"source":"已到账报酬","amount":2000,"status":"received","account":"cash","receivedAt":"2015-07-08T08:15:00+08:00"}'}\n</命令>`);
    else text = options.failWorld ? '{"worldCommands":"bad"}' : JSON.stringify(worldResult());
    if (stage === 'story') return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
  });
  return { calls, fetcher };
}
function runner(repo: SaveRepository, fetcher: typeof fetch) { const r = new TurnCoordinator(repo, new AiClient(fetcher)); runners.push(r); return r; }

describe('开局人生 → 正式文本Variables → World投影 → 原子提交', () => {
  it.each(openingLives)('$key: 不同人生经济起点、原有资金与预期收入不混同，后续正常交易', async life => {
    const a = await setup(life), t = transport(life), r = runner(a.repo, t.fetcher);
    const done = await r.generate(a);
    expect(done.status).toBe('complete'); expect(t.calls.map(c => c.stage)).toEqual(['story', 'variables', 'world']);
    expect(t.calls[0].prompt).toContain(life.background);
    expect(t.calls[0].prompt).toContain('通过眼前环境'); expect(t.calls[0].prompt).toContain('不默认悲惨童年');
    expect(t.calls[1].context.SAVE_STATE).toHaveProperty('openingInitializationPending', true);
    expect(t.calls[1].prompt).toContain('expectedIncomes');
    expect(t.calls[1].prompt).not.toContain('未明确金额保持null');
    expect(t.calls[1].prompt).not.toContain('没有SetBalance');
    expect(t.calls[2].context.worldClock).toBe(openingEnd);
    expect(t.calls[2].prompt).toContain('InitializeOpeningState');
    const projected = projectTurn(a.state, done.draft);
    expect(projected.economy).toMatchObject({ cash: life.cash, onlineBalance: life.onlineBalance, debts: {} });
    expect(projected.economy.incomes).toEqual(Object.fromEntries(openingValues(life).expectedIncomes.map(v => [v.id, v])));
    expect(projected.items.coat.ownerRef).toEqual({ kind: 'protagonist', id: 'protagonist' });
    expect(await a.repo.load('save-a')).toEqual(a.state);
    const input = submission(done.draft, ''), saved = await a.repo.commitTurn(input);
    expect(saved.state).toMatchObject({ turnNumber: 1, revision: 1, worldClock: openingEnd, weatherText: openingValues(life).weatherText, environmentText: openingValues(life).environmentText });
    expect(saved.state).not.toHaveProperty('openingInitializationPending'); expect(saved.state).not.toHaveProperty('openingTimePending');
    expect(saved.state.appliedCommands.filter(c => c.commandId === 'opening-clock:1')).toHaveLength(1);
    expect((await a.repo.commitTurn(input)).replayed).toBe(true); expect(await a.repo.load('save-a')).toEqual(saved.state);
    expect(saved.draft.userInput).toBe(''); expect(t.calls).toHaveLength(3);
    expect(saved.state.protagonist).toMatchObject({ profession: a.state.protagonist.profession, professionDescription: a.state.protagonist.professionDescription, professionLongTermImpact: a.state.protagonist.professionLongTermImpact, skills: a.state.protagonist.skills });
    for (const call of t.calls) {
      expect(call.prompt).toContain(a.state.protagonist.professionDescription);
      expect(call.prompt).toContain(a.state.protagonist.professionLongTermImpact);
    }
    // Bind a deliberate next action through the repository's existing input boundary.
    const next = await a.repo.bindTurnAction(saved.draft, '去买早餐', true, true);
    const normal = await r.generate({ ...a, draft: next });
    expect(normal.status).toBe('complete'); expect(t.calls).toHaveLength(6);
    const second = await a.repo.commitTurn(submission(normal.draft, ''));
    expect(second.state.economy.cash).toBe(life.cash + 800); expect(second.state.economy.onlineBalance).toBe(life.onlineBalance);
    expect(second.state.economy.incomes.paid.status).toBe('received');
    expect(second.state.worldClock).toBe('2015-07-08T08:15:00+08:00'); expect(second.state.journal).toHaveLength(2);
    expect(await a.repo.load('save-a')).toEqual(second.state);
    expect(second.state.protagonist).toEqual(saved.state.protagonist);
    for (const call of t.calls.slice(3)) expect(call.prompt).toContain(a.state.protagonist.professionDescription);
  });
  it('World失败保留初始化候选而不改正式状态，恢复仅补World', async () => {
    const a = await setup(), options = { failWorld: true }, t = transport(openingLives[0], options), r = runner(a.repo, t.fetcher);
    await expect(r.generate(a)).rejects.toThrow(); expect(await a.repo.load('save-a')).toEqual(a.state);
    const failed = await a.repo.loadDraft('save-a'); expect(failed?.variables?.validation).toBe('validated');
    options.failWorld = false;
    const done = await r.generate({ ...a, draft: failed! }); expect(t.calls.map(c => c.stage)).toEqual(['story', 'variables', 'world', 'world']);
    const saved = await a.repo.commitTurn(submission(done.draft, '')); expect(saved.state.economy.cash).toBe(30000);
  });
  it('IDB事务失败回滚余额、预期收入、标记与journal，重试仅提交一次', async () => {
    const a = await setup(), t = transport(openingLives[0]), done = await runner(a.repo, t.fetcher).generate(a), before = await a.repo.loadGame('save-a');
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'saves') throw new Error('mock transaction failure'); return put.apply(this, args);
    });
    await expect(a.repo.commitTurn(submission(done.draft, ''))).rejects.toThrow(); spy.mockRestore();
    expect(await a.repo.loadGame('save-a')).toEqual(before);
    const saved = await a.repo.commitTurn(submission(done.draft, '')); expect(saved.state.journal).toHaveLength(1);
    expect((await a.repo.commitTurn(submission(done.draft, ''))).replayed).toBe(true); expect(t.calls).toHaveLength(3);
  });
  it('没有初始化命令也不增加审批门槛；空开局结算后关闭初始化入口', async () => {
    const a = await setup(), t = transport(openingLives[0], { omitInitialization: true });
    const done = await runner(a.repo, t.fetcher).generate(a), saved = await a.repo.commitTurn(submission(done.draft, ''));
    expect(saved.state.economy.cash).toBeNull(); expect(saved.state.economy.incomes).toEqual({});
    expect(saved.state).not.toHaveProperty('openingInitializationPending');
  });
  it('新提示词只用于开局，不向普通正文注入人生补写指令', async () => {
    const a = await setup(), t = transport(openingLives[0]);
    const done = await runner(a.repo, t.fetcher).generate(a), saved = await a.repo.commitTurn(submission(done.draft, '继续'));
    const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: saved.state, draft: saved.draft, settings: a.settings, userInput: '继续' });
    expect(prompt.modules.some(m => m.id === 'stages.opening.story')).toBe(false);
    expect(JSON.stringify(prompt.messages)).not.toContain('先让主角成为一个有过去');
  });
});
