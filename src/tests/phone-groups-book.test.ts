import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { worldState, worldResult } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { StageGuard } from '../workflows/stageGuard';
import { sendGroupChat } from '../workflows/groupChat';
import { expandBook } from '../workflows/blackbook';
import { bookSources } from '../domain/blackbook';
import { type GroupAction } from '../domain/phoneGroup';
import { chatBase } from '../domain/phone';
import { frozenChatContext } from '../prompts/phoneContext';
import { parseWorld } from '../services/validation/aiOutputs';
import { commandsForPhase } from '../domain/stageCommands';
import type { DomainCommand } from '../domain/commands';

let repo: SaveRepository;
const channel = { ...newChannel(), defaultModel: 'fixture' };
const config = defaultAiConfig();
config.channels.push(channel);
config.routes.story = { channelId: channel.id, modelId: 'fixture' };
const vault = new CredentialVault(
  { getItem: () => 'synthetic-key-only', setItem() {}, removeItem() {} },
  { getItem: () => null, setItem() {}, removeItem() {} },
);
const settings = defaultSettings();
const groupId = crypto.randomUUID(),
  members = ['npc-a', 'scene'];
const create: GroupAction = { type: 'create', invitees: members, name: '渡口', category: '工作' };
const responses = (value: unknown) => ({
  protocol: 'openai' as const,
  model: 'fixture',
  text: JSON.stringify(value),
  diagnostics: [],
});
const seed = (n: number): Extract<DomainCommand, { type: 'SeedTopic' }> => ({
  type: 'SeedTopic',
  commandId: 'seed-' + n,
  evidence: '城市街景',
  related: n === 1,
  title: '渡口市集' + n,
  summary: '有人在堤边摆摊。',
  expiresAt: '2099-01-01T00:00:00Z',
});
async function input() {
  const { state, draft, instance } = await repo.loadGame('save-a');
  return { state, draft, instance: instance ?? null, settings, config, vault };
}
beforeEach(async () => {
  repo = await SaveRepository.open('step-five', new IDBFactory());
  const state = worldState();
  for (const id of members) {
    state.npc[id].phoneContact = { status: 'known' };
    state.npc[id].background = 'PRIVATE_' + id;
  }
  await repo.create(state);
  await repo.commitTurn(submission(await completeDraft(repo), ''));
});
afterEach(() => {
  repo.close();
  vi.restoreAllMocks();
});

function model() {
  const client = new AiClient();
  const calls = vi.spyOn(client, 'generate').mockImplementation(async (_route, messages) => {
    const data = JSON.parse(messages.at(-1)!.content);
    if (!data.npc) return responses([...members].reverse().map((npcId) => ({ npcId, status: 'reply' })));
    const npcId = data.npc.id;
    return responses(
      data.group.action.type === 'message'
        ? { npcId, status: 'replied', text: '  原文 ' + npcId + '\n' }
        : { npcId, status: 'joined' },
    );
  });
  return { client, calls };
}
it('建群、独立回复、冻结、v7 恢复、三段结算和撤回保留顺序、原文与角色边界', async () => {
  const { client, calls } = model(),
    start = await input();
  await sendGroupChat(repo, new StageGuard(), { ...start, groupId, action: create }, client);
  const waiting = await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: { type: 'message', text: '  同步安排。\n' } },
    client,
  );
  expect((await repo.load('save-a')).phone).toEqual(start.state.phone);
  expect(calls).toHaveBeenCalledTimes(5);
  const wires = calls.mock.calls.map(([, m]) => m.at(-1)!.content);
  expect(wires[2]).not.toMatch(/PRIVATE_|knownInformation|memories/);
  for (const i of [0, 1, 3, 4]) {
    const id = JSON.parse(wires[i]).npc.id;
    expect(wires[i]).toContain('PRIVATE_' + id);
    expect(wires[i]).not.toContain('PRIVATE_' + members.find((n) => n !== id));
  }
  expect(JSON.parse(wires[4]).preceding[0].text).toBe('  原文 scene\n');
  const bound = await repo.bindTurnAction(waiting, '在窗边等候', true, true, true);
  expect(bound.phoneFreeze!.ids).toHaveLength(6);
  for (const stage of ['story', 'entities'] as const)
    expect(frozenChatContext(start.state, bound, stage).PHONE_CHAT?.groupOperations).toEqual(
      bound.phonePending,
    );
  const backup = await serializeBackup(await repo.exportBackup(['save-a']), 'group-test');
  expect(JSON.parse(backup).version).toBe(7);
  const [entry] = (await parseBackup(backup)).entries;
  if (!entry.ok) throw Error(entry.error);
  const copy = await SaveRepository.open('copy', new IDBFactory());
  try {
    await copy.importBackup(entry, (await copy.compareBackup(entry)).confirmation);
    expect((await copy.loadDraft('save-a'))?.phoneFreeze).toEqual(bound.phoneFreeze);
    expect((await copy.loadDraft('save-a'))?.phonePending).toEqual(bound.phonePending);
  } finally {
    copy.close();
  }
  await expect(
    sendGroupChat(
      repo,
      new StageGuard(),
      { ...(await input()), groupId, action: { type: 'leave' } },
      client,
    ),
  ).rejects.toMatchObject({ code: 'PHONE_TARGET' });
  const ready = await completeDraft(repo, {
    variables: await elapsedVariables(repo, '在窗边等候', 60),
    world: worldResult([seed(1)]),
  });
  const commit = submission(ready, ''),
    done = await repo.commitTurn(commit);
  const group = done.state.phone.groups![groupId];
  expect(group.members).toEqual(members);
  expect(group.history[1].outcomes.map((o) => o.npcId)).toEqual([...members].reverse());
  expect(done.state.phone.topics).toHaveLength(1);
  expect((await repo.commitTurn(commit)).replayed).toBe(true);
  const undone = await repo.undoTurn({
    saveId: 'save-a',
    expectedRevision: done.state.revision,
    expectedDraft: done.draft,
    operationId: 'back',
  });
  expect(undone.state.phone).toEqual(start.state.phone);
  expect(undone.draft.phonePending).toEqual(waiting.phonePending);
});
it('失败、取消和过期请求均不留下半组回执；拒绝及退出保存在草稿内', async () => {
  const { client, calls } = model(),
    start = await input();
  calls
    .mockResolvedValueOnce(responses({ npcId: 'npc-a', status: 'joined' }))
    .mockRejectedValueOnce(Error('offline'));
  await expect(
    sendGroupChat(repo, new StageGuard(), { ...start, groupId, action: create }, client),
  ).rejects.toThrow();
  expect((await input()).draft).toEqual(start.draft);
  let resume!: () => void, entered!: () => void;
  const arrived = new Promise<void>((r) => {
    entered = r;
  });
  calls.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((r) => {
      resume = r;
    });
    return responses({ npcId: 'npc-a', status: 'joined' });
  });
  const guard = new StageGuard();
  const work = sendGroupChat(repo, guard, { ...start, groupId, action: create }, client);
  await arrived;
  guard.cancel();
  resume();
  await expect(work).rejects.toThrow();
  expect((await input()).draft).toEqual(start.draft);
  calls
    .mockResolvedValueOnce(responses({ npcId: 'npc-a', status: 'joined' }))
    .mockResolvedValueOnce(responses({ npcId: 'scene', status: 'refused' }));
  const waiting = await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: create },
    client,
  );
  expect(chatBase(start.state, waiting.phonePending!, 'preview').phone.groups![groupId].members).toEqual(
    ['npc-a'],
  );
  await expect(
    sendGroupChat(repo, new StageGuard(), { ...start, groupId, action: create }, client),
  ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: { type: 'invite', invitees: ['scene'] } },
    client,
  );
  calls
    .mockResolvedValueOnce(
      responses([
        { npcId: 'scene', status: 'reply' },
        { npcId: 'npc-a', status: 'later' },
      ]),
    )
    .mockResolvedValueOnce(responses({ npcId: 'scene', status: 'left' }));
  const last = await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: { type: 'message', text: '星期五见。' } },
    client,
  );
  expect(chatBase(start.state, last.phonePending!, 'preview').phone.groups![groupId].members).toEqual([
    'npc-a',
  ]);
});
it('阶段三每回合零到五条，整批展开与点赞只写本机，时间线回退过滤已撤销种子', async () => {
  expect(commandsForPhase('entities', 'regular')).not.toContain('SeedTopic');
  expect(commandsForPhase('scene', 'regular')).not.toContain('SeedTopic');
  expect(commandsForPhase('offscreen', 'opening')).not.toContain('SeedTopic');
  const { state, draft } = await input();
  await repo.bindTurnAction(draft!, '在窗边等候', true, true, true);
  const five = Array.from({ length: 5 }, (_, i) => seed(i));
  const ready = await completeDraft(repo, {
    variables: await elapsedVariables(repo, '在窗边等候', 60),
    world: worldResult(five),
  });
  expect(() => parseWorld(JSON.stringify(worldResult([...five, seed(6)])), state, ready)).toThrow();
  const done = await repo.commitTurn(submission(ready, ''));
  const live = await input();
  const sources = bookSources(live.state, live.instance).topics;
  expect(sources).toHaveLength(5);
  const client = new AiClient();
  const post = {
    author: '沿江人',
    title: '市集',
    subtitle: '江岸',
    body: '只是城市氛围。',
    tags: ['集市'],
    at: live.state.worldClock,
    location: '江边',
    likes: 1,
    saves: 2,
    comments: [],
  };
  const calls = vi
    .spyOn(client, 'generate')
    .mockResolvedValue(responses(sources.map((_, index) => ({ index, post }))));
  const first = await expandBook(repo, new StageGuard(), live, sources, client);
  expect(Object.keys(first)).toHaveLength(5);
  await repo.books.like(sources[0].key, 'post');
  expect(
    (await expandBook(repo, new StageGuard(), live, sources, client))[sources[0].key].liked,
  ).toEqual(['post']);
  expect(calls).toHaveBeenCalledTimes(1);
  const file = await serializeBackup(await repo.exportBackup(['save-a']), 'book');
  expect(file).not.toContain(post.body);
  expect((await input()).state).toEqual(live.state);
  const undone = await repo.undoTurn({
    saveId: 'save-a',
    expectedRevision: done.state.revision,
    expectedDraft: done.draft,
    operationId: 'book-back',
  });
  expect(bookSources(undone.state, live.instance).topics).toEqual([]);
  await expect(expandBook(repo, new StageGuard(), live, sources, client)).rejects.toMatchObject({
    code: 'DRAFT_CONFLICT',
  });
  expect(calls).toHaveBeenCalledTimes(1);
});

it('恢复群聊所在历史节点只消费完全匹配的操作，恢复较早分支时按玩家选择处理', async () => {
  const { client } = model();
  const pending = await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: create },
    client,
  );
  const before = await repo.history.create('save-a', '群聊前');
  await repo.bindTurnAction(pending, '等一分钟', true, true, true);
  const ready = await completeDraft(repo, { variables: await elapsedVariables(repo, '等一分钟', 60) });
  const done = await repo.commitTurn(submission(ready, ''));
  const after = await repo.history.create('save-a', '群聊后');
  await repo.undoTurn({
    saveId: 'save-a',
    expectedRevision: done.state.revision,
    expectedDraft: done.draft,
    operationId: 'restore-chat',
  });
  const target = await repo.history.preview('save-a', { kind: 'manual', id: after.id });
  const restored = await repo.history.restore(
    target.confirmation,
    '在窗边稍候',
    true,
    true,
    true,
    'keep',
  );
  expect(restored.state.phone.groups![groupId].history).toHaveLength(1);
  expect(restored.draft.phonePending ?? []).toEqual([]);
  await repo.deleteDraft('save-a', restored.draft.draftRevision, restored.draft, restored.instance);
  await sendGroupChat(
    repo,
    new StageGuard(),
    { ...(await input()), groupId, action: { type: 'leave' } },
    client,
  );
  const older = () => repo.history.preview('save-a', { kind: 'manual', id: before.id });
  const selection = await older();
  await expect(
    repo.history.restore(selection.confirmation, '在窗边稍候', true, true, true, 'keep'),
  ).rejects.toMatchObject({ code: 'PHONE_CONFLICT' });
  expect((await input()).draft?.phonePending).toHaveLength(1);
  const returned = await repo.history.restore(
    (await older()).confirmation,
    '在窗边稍候',
    true,
    true,
    true,
    'discard',
  );
  expect(returned.state.phone.groups).toBeUndefined();
  expect(returned.draft.phonePending ?? []).toEqual([]);
});

it('自定义城市、主势力、后宫成员与群聊共存时，四段请求各自只装配所需上下文和命令', async () => {
  const { phoneGame } = await import('./fixtures/phone');
  const { talentPromptInput } = await import('./fixtures/talentPrompt');
  const { composePrompt } = await import('../prompts/composer');
  const { freezeChat } = await import('../domain/phoneChat');
  const { GameStateSchema } = await import('../domain/state');
  const state = phoneGame();
  state.openingCityId = 'cn-320500';
  state.openingCityProfile = { name: '苏州', region: '江苏', intro: '古城水巷' };
  state.locations['cn-320500'] = { id: 'cn-320500', name: '苏州' };
  for (const person of Object.values(state.npc)) if (person.onScene) person.locationId = 'cn-320500';
  state.protagonist.locationId = 'cn-320500';
  const audience = ['partner', 'colleague'];
  const row = {
    kind: 'group' as const,
    id: groupId,
    groupId,
    at: state.worldClock,
    baseTurnId: 'evening',
    action: { type: 'create' as const, name: '临江群', category: '自定义' as const, invitees: audience },
    audience,
    outcomes: audience.map((npcId) => ({ npcId, status: 'joined' as const })),
  };
  for (const stage of ['story', 'entities', 'variables', 'world'] as const) {
    const input = talentPromptInput(stage, 'regular');
    input.state = GameStateSchema.parse(state);
    const template = talentPromptInput('world', 'regular').draft!;
    input.draft = {
      ...template,
      saveId: state.saveId,
      baseSaveRevision: state.revision,
      phonePending: [row],
      phoneFreeze: freezeChat([row]),
    };
    // Reuse the ordinary context fixture, with no unrelated commands referencing its own save.
    if (input.draft.entities) input.draft.entities.result.commands = [];
    if (input.draft.variables) input.draft.variables.result.commands = [];
    const { context } = await composePrompt(input);
    expect(JSON.stringify(context.OPENING_CITY)).toContain('苏州');
    expect(context.PROTAGONIST_FACTION).toBeDefined();
    if (stage === 'story' || stage === 'entities')
      expect(context.PHONE_CHAT).toMatchObject({ groupOperations: [row] });
    else expect(context.PHONE_CHAT).toBeUndefined();
    if (stage === 'variables') expect(context.PHONE_CHAT_TIME).toMatchObject({ participants: audience });
    if (stage === 'world') {
      expect(context.HAREM_WORLD_POLICY).toBeDefined();
      expect(context.COMMAND_CATALOG).toMatchObject({
        commandTypes: expect.arrayContaining(['SeedTopic', 'SchedulePhoneMessage']),
      });
    } else expect(JSON.stringify(context.COMMAND_CATALOG ?? {})).not.toContain('SeedTopic');
  }
});

it('同回合创建主事件并公开种子，热榜、展开请求和缓存都只使用种子上的公开原文', async () => {
  const { event } = await import('./fixtures/game');
  const { state, draft } = await input();
  const bound = await repo.bindTurnAction(draft!, '在窗边等候', true, true, true);
  const main = {
    ...event('market'),
    eventKind: 'main' as const,
    title: '内部议程',
    backgroundText: '闭门会议资料',
    goalText: '尚未披露的目的',
    estimatedEndAt: '2099-01-01T00:00:00Z',
    sourceTurnIds: [bound.turnId],
  };
  const publicSeed = { ...seed(1), eventId: main.id };
  const result = worldResult([publicSeed]);
  result.eventCommands.push({
    type: 'SaveEvent',
    commandId: 'create-market',
    evidence: '场外规划',
    event: main,
  });
  const ready = await completeDraft(repo, {
    variables: await elapsedVariables(repo, '在窗边等候', 60),
    world: result,
  });
  expect(parseWorld(JSON.stringify(result), state, ready).worldCommands).toContainEqual(publicSeed);
  const done = await repo.commitTurn(submission(ready, ''));
  const live = await input();
  const { topics, hot } = bookSources(live.state, live.instance);
  expect(hot).toHaveLength(1);
  expect(hot[0]).toMatchObject({
    id: main.id,
    title: publicSeed.title,
    summary: publicSeed.summary,
    key: topics[0].key,
  });
  expect(JSON.stringify(hot)).not.toMatch(/内部议程|闭门会议资料|尚未披露的目的/);
  const post = {
    author: '本地人',
    title: '新摊位',
    subtitle: '沿江见闻',
    body: '集市开放',
    tags: [],
    at: live.state.worldClock,
    location: '江边',
    likes: 0,
    saves: 0,
    comments: [],
  };
  const client = new AiClient();
  const calls = vi.spyOn(client, 'generate').mockResolvedValue(responses([{ index: 0, post }]));
  await expandBook(repo, new StageGuard(), live, [{ ...hot[0], summary: main.backgroundText }], client);
  const payload = JSON.parse(calls.mock.calls[0][1].at(-1)!.content);
  expect(payload.topics).toEqual([
    { index: 0, title: publicSeed.title, summary: publicSeed.summary, at: live.state.worldClock },
  ]);
  await expandBook(repo, new StageGuard(), live, topics, client);
  expect(calls).toHaveBeenCalledTimes(1);
  await repo.undoTurn({
    saveId: 'save-a',
    expectedRevision: done.state.revision,
    expectedDraft: done.draft,
    operationId: 'undo-market',
  });
  expect(bookSources((await input()).state, live.instance).hot).toEqual([]);
  await expect(expandBook(repo, new StageGuard(), live, hot, client)).rejects.toMatchObject({
    code: 'DRAFT_CONFLICT',
  });
  expect(calls).toHaveBeenCalledTimes(1);
});

it('主角知情不等于公开；每个现存主事件仅取最新有效公开种子，事件版本变化隔离热榜缓存', async () => {
  const { mainStage, subStage } = await import('./fixtures/eventStages');
  const { seedTopic } = await import('../domain/phoneTopic');
  const { state, instance } = await input();
  const main = mainStage();
  state.events[main.id] = main;
  state.events['known-only'] = {
    ...main,
    id: 'known-only',
    visibility: 'known',
    protagonistKnowledge: { worldUpdateTurnId: 'prior', title: '只对主角私下披露' },
  };
  state.events['sub-only'] = subStage('sub-only');
  expect(bookSources(state, instance).hot).toEqual([]);
  const turn = state.journal.at(-1)!.turnId;
  for (const [i, eventId] of [main.id, undefined, 'sub-only', main.id].entries())
    seedTopic(state, { ...seed(i), eventId }, turn);
  const latest = state.phone.topics.at(-1)!;
  expect(bookSources(state, instance).hot).toMatchObject([{ id: main.id, title: latest.title }]);
  const matching = bookSources(state, instance).hot[0].key;
  main.sourceTurnIds.push('next-event-version');
  expect(bookSources(state, instance).hot[0].key).not.toBe(matching);
  latest.expiresAt = state.worldClock;
  expect(bookSources(state, instance).hot).toMatchObject([{ id: main.id, title: seed(0).title }]);
  delete state.events[main.id];
  expect(bookSources(state, instance).hot).toEqual([]);
  expect(bookSources(state, instance).topics.map((t) => t.title)).toContain(seed(1).title);
});
