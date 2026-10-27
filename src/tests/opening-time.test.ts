import { variableCommandsForTurn } from '../domain/turnProjection';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { newCreation, buildCreationState } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { composePrompt } from '../prompts/composer';

function form() {
  return { ...newCreation(), person: { name: '林舟', age: '30', gender: '女', appearance: '', personality: '' }, profession: '教师' };
}
afterEach(() => vi.useRealTimers());
describe('开局时间不取设备日期', () => {
  it('不同现实日期创建的游戏均有持久待定标记，审计时间仍是真实时间', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2032-07-08T09:10:00Z'));
    const first = buildCreationState(form(), defaultSettings());
    vi.setSystemTime(new Date('2044-01-01T00:00:00Z'));
    const second = buildCreationState(form(), defaultSettings());
    expect(first).toHaveProperty('openingTimePending', true);
    expect(first.worldClock).toBe(second.worldClock);
    expect(first.createdAt).not.toBe(second.createdAt);
  });
  it('真实Composer不把设备日期、占位时钟或派生星期作为已确定开局注入', async () => {
    const state = buildCreationState(form(), defaultSettings());
    const prompt = await composePrompt({ state, settings: defaultSettings(), stage: 'story', mode: 'opening', userInput: '' });
    const text = JSON.stringify(prompt.context);
    expect(text).not.toContain(state.worldClock);
    expect(prompt.context.SAVE_STATE).toHaveProperty('worldClock', null);
    expect(prompt.context).toHaveProperty('OPENING_TIME');
  });
});

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openingTimeSelection, openingTimeBase, openingTimeContext, chinaCalendar, pendingOpeningClock } from '../domain/openingTime';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { GameStateSchema, StorySchema } from '../domain/state';
import { commitCommands } from '../domain/commands';
import { projectTurn } from '../domain/turnProjection';
import { parseVariables } from '../services/validation/aiOutputs';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { record, array, string } from '../services/ai/protocols';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import { timePreflight } from '../domain/timePreflight';
import { submission } from './fixtures/turn';
import { game } from './fixtures/game';
import { historyState } from './fixtures/history';

const start = '2015-07-08T14:00:00+08:00', end = '2015-07-08T14:02:00+08:00';
function selectedStory(from = start, to = end, anchor?: string) {
  const c = chinaCalendar(from);
  const text = anchor ?? `${c.year}年${c.month}月${c.day}日${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}，${c.weekday}，重庆街头。`;
  return StorySchema.parse({ turnKind: 'opening', narrative: `${text}主角喝了一口水，走到站台前。`, summary: '主角走到站台前。',
    variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: from, endAt: to }), textEvidence: text }] });
}
function chosen(preference = '', from = start, to = end) {
  const value = { ...form(), openingPreference: preference };
  const state = buildCreationState(value, defaultSettings());
  return { state, draft: rerollStory(createTurnDraft(state.saveId, 0, 'opening', 'opening', preference), selectedStory(from, to)) };
}
const variables = (at = end) => ({ commands: [{ type: 'SetWorldClock' as const, commandId: 'clock', worldClock: at, evidence: '主角喝了一口水，走到站台前。' }], rejectedSuggestions: [], unresolved: [] });

describe('开局时间确定性边界', () => {
  it.each([
    ['故事发生在2015年夏天。', start, end],
    ['背景设在2008年的重庆。', '2008-08-10T10:00:00+08:00', '2008-08-10T10:03:00+08:00'],
    ['2022年12月31日晚上开始。', '2022-12-31T23:59:00+08:00', '2023-01-01T00:02:00+08:00'],
    ['2024年2月29日08:30开始。', '2024-02-29T08:30:00+08:00', '2024-02-29T08:31:00+08:00'],
    ['', start, end],
    ['夏天开始。', start, end],
    ['2022-12-31T16:30:45Z 开始。', '2023-01-01T00:30:45+08:00', '2023-01-01T00:31:45+08:00'],
  ])('玩家设定 %s 或无设定，在同一次正文内补全起止时间', (preference, from, to) => {
    const { state, draft } = chosen(preference, from, to);
    expect(openingTimeSelection(state, draft)).toMatchObject({ startAt: from, endAt: to });
    expect(parseVariables(JSON.stringify(variables(to)), state, draft).commands).toHaveLength(1);
    expect(projectTurn(state, { ...draft, variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated', result: variables(to) } }).worldClock).toBe(to);
    expect(state.openingTimePending).toBe(true);
  });
  it.each(['故事时间是今年。', '背景设在很久以前。', '2023年2月29日开始。', '2024年13月1日开始。',
    '2024年1月1日25:00开始。', '背景在2008年。故事在2015年。', '2024年1月1日开始；2024年2月1日开始。'])('含糊或矛盾玩家文本交由同一次Story处理：%s', (text) => {
    const state = buildCreationState({ ...form(), openingPreference: text }, defaultSettings());
    expect(openingTimeContext(state, text)?.playerPreference).toBe(text);
  });
  it('历史履历日期不会不加区分地覆盖开局年代', () => {
    const { state, draft } = chosen('故事发生在2015年夏天。'); state.protagonist.background = '2001年出生，2023年毕业。';
    expect(openingTimeContext(state, draft.userInput)).toMatchObject({ playerBackground: state.protagonist.background, playerPreference: draft.userInput });
  });
  it.each([
    ['故事发生在2016年。', start, end],
    ['冬天开始。', start, end],
    ['故事发生在2015年冬天。', start, end],
    ['2015年7月9日开始。', start, end],
    ['2015年7月8日晚上开始。', start, end],
    ['', start, start],
    ['', start, '2015-07-08T13:59:00+08:00'],
  ])('结构化日历独立于文学约束，零耗时合法、倒退拒绝：%s %s %s', (preference, from, to) => {
    const { state, draft } = chosen(preference, from, to);
    if (Date.parse(to) < Date.parse(from)) expect(() => openingTimeSelection(state, draft)).toThrow();
    else expect(openingTimeSelection(state, draft)?.endAt).toBe(to);
  });
  it.each([
    ['2015年7月9日14:00，重庆街头。', start],
    ['2015年7月8日15:00，重庆街头。', start],
    ['2015年7月8日星期一，重庆街头。', start],
    ['2015年7月8日凌晨，重庆街头。', start],
    ['2015年7月8日冬天，重庆街头。', start],
    ['重庆街头。', start],
    ['不是2015年7月8日，重庆街头。', start],
  ])('不再用正文日期/星期/时段/否定词审判合法结构化候选：%s', (anchor, from) => {
    const { state, draft } = chosen(); draft.story = selectedStory(from, end, anchor);
    expect(openingTimeSelection(state, draft)?.startAt).toBe(from);
  });
  it.each(['2015-02-29T08:00:00+08:00', '2024-02-30T08:00:00+08:00', '2015-07-08T06:00:00Z', 'not-a-date'])('模型非法日期或非中国标准偏移拒绝：%s', (at) => {
    const { state, draft } = chosen(); draft.story!.variableGuide[0].observedFact = JSON.stringify({ startAt: at, endAt: end });
    expect(() => openingTimeSelection(state, draft)).toThrow();
  });
  it('拒绝缺失、重复、额外时间协议、伪造证据及未知字段', () => {
    for (const change of ['missing', 'duplicate', 'retrospective', 'unknown']) {
      const { state, draft } = chosen(), guide = draft.story!.variableGuide;
      if (change === 'missing') guide.length = 0;
      if (change === 'duplicate') guide.push({ ...guide[0] });
      if (change === 'retrospective') guide.push({ ...guide[0], subjectHint: 'time:retrospective' });
      if (change === 'unknown') guide[0].observedFact = JSON.stringify({ startAt: start, endAt: end, weekday: '星期一' });
      expect(() => openingTimeSelection(state, draft)).toThrow();
    }
  });
  it('开局允许空变量，等值时间统一注入一次，冲突时间与未确认正式时钟仍拒绝', () => {
    const { state, draft } = chosen();
    expect(parseVariables(JSON.stringify({ ...variables(), commands: [] }), state, draft).commands).toEqual([]);
    const repeated = [...variables().commands, { ...variables().commands[0], commandId: 'again' }];
    const accepted = parseVariables(JSON.stringify({ ...variables(), commands: repeated }), state, draft);
    expect(variableCommandsForTurn(state, draft, accepted.commands).filter((command) => command.type === 'SetWorldClock')).toHaveLength(1);
    expect(() => parseVariables(JSON.stringify(variables('2015-07-08T14:04:00+08:00')), state, draft)).toThrow();
    expect(() => commitCommands(state, draft.turnId, 0, variables().commands)).toThrow('开局时间待确认');
    expect(() => timePreflight(state, '睡到明天早上8点')).toThrow('尚未确定');
  });
  it('正式旧档没有标记时绝不重新选择年代；普通命令的倒退保护不变', () => {
    const state = game(); const draft = rerollStory(createTurnDraft(state.saveId, 0, 'legacy', 'opening', ''), selectedStory());
    expect(openingTimeSelection(state, draft)).toBeUndefined();
    expect(openingTimeBase(state, draft)).toBe(state);
    expect(() => parseVariables(JSON.stringify(variables()), state, draft)).toThrow();
    expect(() => commitCommands(state, 'regular', 0, variables().commands)).toThrow('不可倒退');
  });
  it.each([1, 2, 3, 4])('旧V%s开局及已提交存档读取不添加标记、不改世界时间', (version) => {
    for (const original of [game(), historyState(2)]) {
      const raw: Record<string, unknown> = { ...original, schemaVersion: version };
      if (version < 4) delete raw.contactReviewNpcIds;
      if (version < 3) { delete raw.contactNpcIds; delete raw.retiredNpcs; }
      if (version < 2) { delete raw.weatherText; delete raw.environmentText; }
      const restored = migrateSave(raw);
      expect(restored.worldClock).toBe(original.worldClock); expect(restored.openingTimePending).toBeUndefined();
      expect(restored.revision).toBe(original.revision); expect(restored.journal).toEqual(original.journal);
    }
  });
  it('待定标记不能附加在已有历史/命令/事件或任意占位日期上', () => {
    const { state } = chosen();
    expect(GameStateSchema.safeParse({ ...state, worldClock: start }).success).toBe(false);
    expect(GameStateSchema.safeParse({ ...game(), openingTimePending: true }).success).toBe(false);
    expect(GameStateSchema.safeParse({ ...historyState(1), openingTimePending: true, worldClock: pendingOpeningClock }).success).toBe(false);
  });
  it.each([
    ['2024-02-29T23:59:00+08:00', 2024, 2, 29, '星期四'],
    ['2024-02-29T16:00:00Z', 2024, 3, 1, '星期五'],
    ['2022-12-31T16:00:00Z', 2023, 1, 1, '星期日'],
    ['1988-07-02T16:30:00Z', 1988, 7, 3, '星期日'],
  ])('中国标准时间日历不取设备时区，也不因历史夏令时偏移：%s', (at, year, month, day, weekday) => {
    expect(chinaCalendar(at)).toMatchObject({ year, month, day, weekday });
  });
});

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((close) => close()); vi.restoreAllMocks(); });
async function runtime(preference = '') {
  const repo = await SaveRepository.open('opening-time', new IDBFactory()); cleanup.push(() => repo.close());
  const state = await repo.create(buildCreationState({ ...form(), openingPreference: preference }, defaultSettings()));
  const draft = createTurnDraft(state.saveId, 0, `opening-${state.saveId}`, 'opening', preference); await repo.saveDraft(draft, null);
  const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://opening.mock.invalid/v1'; config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const keys = new Map<string, string>(), store = { getItem: (key: string) => keys.get(key) ?? null,
    setItem: (key: string, value: string) => { keys.set(key, value); }, removeItem: (key: string) => { keys.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'opening-mock-key');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const calls: string[] = [], contexts: Record<string, unknown>[] = [];
  const plan = { failure: '', story: selectedStory() };
  const client = new AiClient(async (_url, init) => {
    const body = record(JSON.parse(String(init?.body))), model = string(body.model); calls.push(model);
    const messages = array(body.messages).map((item) => string(record(item).content)).join('\n');
    const context = record(JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1])); contexts.push(context);
    if (plan.failure === model) return Response.json({ choices: [{ message: { content: '{invalid' } }] });
    if (model === 'story') {
      const story = record(context.OPENING_TIME).status === 'pending' ? plan.story : StorySchema.parse({ turnKind: 'regular', narrative: '主角喝了一口水，走到站台前。', summary: '主角走到站台前。', variableGuide: [] });
      const text = `<thinking>本轮创作提纲：保持时间与人物连续。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    const value = model === 'variables' ? variables(context.OPENING_TIME ? string(record(context.OPENING_TIME).endAt)
      : new Date(Date.parse(string(record(context.SAVE_STATE).worldClock)) + 15000).toISOString())
      : { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  });
  const runner = new TurnCoordinator(repo, client); cleanup.push(() => runner.dispose());
  const generate = async () => runner.generate({ draft: (await repo.loadDraft(state.saveId))!, config, vault, settings });
  return { repo, state, draft, config, vault, settings, calls, contexts, plan, client, generate };
}

describe('开局时间真实Runtime、投影与原子事务', () => {
  it('2015开局只调用原三个阶段；统一窗口，首次提交才确立时间，重复回执不重算', async () => {
    const run = await runtime('故事发生在2015年夏天。'), result = await run.generate();
    expect(run.calls).toEqual(['story', 'variables', 'world']); expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
    expect(record(run.contexts[0].SAVE_STATE).worldClock).toBeNull();
    expect(run.contexts[1].SAVE_STATE).toHaveProperty('worldClock', end);
    expect(run.contexts[2].TIME_WINDOW).toEqual({ from: start, to: end });
    expect(JSON.stringify(run.contexts)).not.toContain(pendingOpeningClock);
    const committed = await run.repo.commitTurn(submission(result.draft));
    expect(committed.state.worldClock).toBe(end); expect(committed.state.openingTimePending).toBeUndefined();
    expect(committed.state.revision).toBe(1); expect(committed.state.memories.short[0].createdAtGameTime).toBe(end);
    expect((await run.repo.commitTurn(submission(result.draft))).replayed).toBe(true);
    expect(await run.repo.load(run.state.saveId)).toEqual(committed.state); expect(run.calls).toHaveLength(3);
  });
  it.each(['variables', 'world'])('%s失败后重读只恢复下游，正式标记与时钟未提前改变', async (stage) => {
    const run = await runtime(); run.plan.failure = stage;
    await expect(run.generate()).rejects.toThrow();
    const saved = (await run.repo.loadDraft(run.state.saveId))!;
    expect(saved.story).toBeTruthy(); expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
    run.plan.failure = ''; await run.generate();
    expect(run.calls.filter((call) => call === 'story')).toHaveLength(1);
    expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
  });
  it('十个连续正式回合与重载：不读取现实日期、不叠加开局耗时', async () => {
    const run = await runtime(); let result = await run.generate();
    for (let turn = 1; turn <= 10; turn++) {
      const committed = await run.repo.commitTurn(submission(result.draft));
      expect(Date.parse(committed.state.worldClock)).toBe(Date.parse(end) + (turn - 1) * 15000);
      expect((await run.repo.loadGame(run.state.saveId)).state).toEqual(committed.state);
      expect(committed.state.turnNumber).toBe(turn);
      result = await run.generate();
    }
    expect(run.calls).toHaveLength(33);
  });
  it('首次事务写入失败：标记、候选、原文、时钟和记忆全部回滚', async () => {
    const run = await runtime(), result = await run.generate();
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'turnReceipts') throw new DOMException('mock quota', 'QuotaExceededError'); return add.apply(this, args);
    });
    await expect(run.repo.commitTurn(submission(result.draft))).rejects.toThrow();
    expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
    expect(await run.repo.loadDraft(run.state.saveId)).toEqual(result.draft);
  });
  it('Roll选取新的开局时间，旧变量/世界全部失效，正式待定不改变', async () => {
    const run = await runtime(); const result = await run.generate();
    run.plan.story = selectedStory('2008-08-10T10:00:00+08:00', '2008-08-10T10:05:00+08:00');
    const stage = new StoryStage(run.repo, run.client); cleanup.push(() => stage.dispose());
    const next = await stage.generate({ ...run, draft: result.draft });
    expect(next.variables).toBeUndefined(); expect(next.world).toBeUndefined();
    expect(openingTimeSelection(run.state, next)?.startAt).toBe('2008-08-10T10:00:00+08:00');
    expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
    expect((await run.generate()).status).toBe('complete');
    expect(run.contexts.at(-1)?.TIME_WINDOW).toEqual({ from: '2008-08-10T10:00:00+08:00', to: '2008-08-10T10:05:00+08:00' });
  });
  it('无合法变量时world preview使用同一Story候选时钟，仍不能正式提交', async () => {
    const run = await runtime(); run.settings.runtime.useVariableStage = false;
    const result = await run.generate(); expect(result.status).toBe('preview');
    expect(run.calls).toEqual(['story', 'world']); expect(run.contexts[1].TIME_WINDOW).toEqual({ from: start, to: end });
    await expect(run.repo.commitTurn(submission(result.draft))).rejects.toThrow();
    expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
  });
});

describe('开局时间补充恢复与兼容', () => {
  it('数字点分和带空格的明确年份同样受保护，不悄悄忽略玩家时刻', () => {
    const { state, draft } = chosen('2022 年 12 月 31 日晚上8点半开始。', '2022-12-31T20:30:00+08:00', '2022-12-31T20:32:00+08:00');
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2022-12-31T20:30:00+08:00');
    draft.story = selectedStory('2022-12-31T21:30:00+08:00', '2022-12-31T21:32:00+08:00');
    expect(openingTimeSelection(state, draft)?.startAt).toBe('2022-12-31T21:30:00+08:00');
    expect(openingTimeContext(state, '2015年12月，故事发生在2015年夏天。')?.playerPreference).toContain('2015年12月');
  });
  it('旧版未完成创角草稿没有标记，仍保留原时钟而非静默套用新规则', () => {
    const legacy = form(); delete legacy.openingTimePending; legacy.worldClock = '2020-01-02T03:04:00+08:00';
    const state = buildCreationState(legacy, defaultSettings());
    expect(state.openingTimePending).toBeUndefined(); expect(state.worldClock).toBe(legacy.worldClock);
  });
  it('取消和迟到的新开局响应不能保存时间或启动下游；重读不创建请求', async () => {
    const run = await runtime(); let release!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; }), began = new Promise<void>((resolve) => { started = resolve; });
    const stage = new StoryStage(run.repo, new AiClient(async () => {
      started(); await wait; const story = selectedStory();
      const text = `<thinking>保持连续。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    })); cleanup.push(() => stage.dispose());
    const request = stage.generate({ ...run, draft: run.draft }); const rejected = expect(request).rejects.toMatchObject({ code: 'cancelled' });
    await began; stage.cancel(); await rejected; release(); await Promise.resolve();
    expect(await run.repo.loadGame(run.state.saveId)).toEqual({ state: run.state, draft: run.draft }); expect(run.calls).toEqual([]);
  });
  it('跨标签修改正文后，旧开局日期回包不能覆盖新草稿', async () => {
    const run = await runtime();
    const next = rerollStory(run.draft, selectedStory('2008-08-10T10:00:00+08:00', '2008-08-10T10:05:00+08:00'));
    const stage = new StoryStage(run.repo, new AiClient(async () => {
      await run.repo.saveDraft(next, run.draft.draftRevision);
      const story = selectedStory();
      const text = `<thinking>保持连续。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    })); cleanup.push(() => stage.dispose());
    await expect(stage.generate({ ...run, draft: run.draft })).rejects.toThrow();
    expect(await run.repo.loadDraft(run.state.saveId)).toEqual(next); expect(await run.repo.load(run.state.saveId)).toEqual(run.state);
  });
});

it('待定开局的记忆资源预览不计算占位日历，也不要求不存在的开局结果', async () => {
  const state = buildCreationState(form(), defaultSettings());
  const prompt = await composePrompt({ state, stage: 'memory', mode: 'opening', settings: defaultSettings(), userInput: '', memoryTask: 'memory.short_to_medium' });
  expect(JSON.stringify(prompt.context)).not.toContain(pendingOpeningClock);
  expect(state.openingTimePending).toBe(true);
});
