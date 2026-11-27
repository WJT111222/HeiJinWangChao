import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { worldState } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { ChatReply, freezeChat } from '../domain/phoneChat';
import { TurnDraftSchema } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import { resolveModelRoute } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { privateChatMessages, sendPrivateChat } from '../workflows/phoneChat';
import { StageGuard } from '../workflows/stageGuard';
import { frozenChatContext } from '../prompts/phoneContext';
import { contextMessage } from '../prompts/contextMessage';

const saveId = 'save-a',
  npcId = 'npc-a',
  text = '  请保留 {{ticket}}\n原件。  ';
const reply = { npcId, status: 'replied', text: '  我先看看。  ' } as const;
const db = () => new IDBFactory();
let repo: SaveRepository, other: SaveRepository;
beforeEach(async () => {
  const factory = db();
  repo = await SaveRepository.open('private', factory);
  other = await SaveRepository.open('private', factory);
  const state = worldState();
  state.npc[npcId].phoneContact = { status: 'known' };
  state.npc.scene.background = '另一个人的私密资料';
  state.npc[npcId].knownInformation = [
    { text: '看过楼层图', source: '本人查阅', learnedAt: state.worldClock },
  ];
  await repo.create(state);
  await repo.commitTurn(submission(await completeDraft(repo), ''));
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.close();
  other.close();
});
function model() {
  const config = defaultAiConfig(),
    channel = { ...newChannel(), defaultModel: 'scene-model' };
  config.channels.push(channel);
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: '' };
  const values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'fixture-key-only');
  const settings = defaultSettings();
  return { config, vault, settings };
}
async function input() {
  const { state, draft, instance } = await repo.loadGame(saveId);
  return { ...model(), state, draft, instance: instance ?? null, npcId, text };
}
function wire(value: unknown) {
  return { text: JSON.stringify(value), protocol: 'openai' as const, model: 'fixture', diagnostics: [] };
}
async function accept() {
  const start = await input(),
    client = new AiClient();
  vi.spyOn(client, 'generate').mockResolvedValue(wire(reply));
  const draft = await sendPrivateChat(repo, new StageGuard(), start, client);
  return { ...start, draft };
}
async function freezeAndFinish() {
  const start = await accept();
  const frozen = await repo.bindTurnAction(
    start.draft,
    '收好手机，等候取件',
    true,
    true,
    true,
    start.instance,
  );
  const full = await completeDraft(repo, { variables: await elapsedVariables(repo, '等候取件', 60) });
  return { start, frozen, full };
}
it.each(['replied', 'later', 'read_unanswered', 'unread'] as const)(
  '私聊结果 %s 保留原文，只写待结算草稿',
  async (status) => {
    const start = await input(),
      client = new AiClient();
    const output = status === 'replied' ? reply : { npcId, status };
    const sent = vi.spyOn(client, 'generate').mockResolvedValue(wire(output));
    const saved = await sendPrivateChat(repo, new StageGuard(), start, client);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(saved.phonePending).toEqual([
      {
        id: expect.any(String),
        text,
        at: start.state.worldClock,
        baseTurnId: start.state.journal.at(-1)!.turnId,
        reply: output,
      },
    ]);
    expect(saved.phoneFreeze).toBeUndefined();
    expect(await other.load(saveId)).toEqual(start.state);
    expect((await other.loadDraft(saveId))?.phonePending).toEqual(saved.phonePending);
  },
);
it('按收信人选择资料、知情、难度和最近记录，手机路由可以独立设置', async () => {
  const start = await accept();
  expect(resolveModelRoute(start.config, 'phone').model).toBe('scene-model');
  start.config.routes.phone = {
    mode: 'independent',
    channelId: start.config.channels[0].id,
    modelId: 'phone-only',
  };
  expect(resolveModelRoute(start.config, 'phone').model).toBe('phone-only');
  const messages = await privateChatMessages(start.state, start.draft, npcId, '下一句', start.settings);
  const body = JSON.parse(messages[1].content);
  expect(body.npc).toMatchObject({ id: npcId, experience: '值班医师', knowledge: [{ text: '看过楼层图' }] });
  expect(body.thisTurn.map((m: { text: string }) => m.text)).toEqual([text, reply.text]);
  expect(body.message).toBe('下一句');
  expect(JSON.stringify(messages)).not.toContain('另一个人的私密资料');
  expect(messages[0].content).toContain('亲密');
});
it('无号码、关闭、错误回复者和非法回包均不产生待结算写入', async () => {
  const start = await input(),
    client = new AiClient(),
    guard = new StageGuard();
  const send = vi.spyOn(client, 'generate').mockResolvedValue(wire({ ...reply, npcId: 'scene' }));
  await expect(sendPrivateChat(repo, guard, { ...start, npcId: 'scene' }, client)).rejects.toMatchObject({
    code: 'PHONE_TARGET',
  });
  start.settings.runtime.phoneChat = false;
  await expect(sendPrivateChat(repo, guard, start, client)).rejects.toMatchObject({ code: 'PHONE_TARGET' });
  expect(send).not.toHaveBeenCalled();
  start.settings.runtime.phoneChat = true;
  await expect(sendPrivateChat(repo, guard, start, client)).rejects.toMatchObject({ code: 'invalid_output' });
  expect(ChatReply.safeParse({ npcId, status: 'later', text: '越过协议的文字' }).success).toBe(false);
  expect(await repo.loadDraft(saveId)).toEqual(start.draft);
});
it('冻结清单防篡改，备份保留草稿，放弃后原样解冻并可再次绑定', async () => {
  const start = await accept();
  const frozen = await repo.bindTurnAction(start.draft, '聊天之后出门', true, true, true, start.instance);
  expect(frozen.phoneFreeze).toEqual(freezeChat(start.draft.phonePending!));
  const revised = structuredClone(frozen);
  const row = revised.phonePending![0];
  if (!('reply' in row)) throw Error('expected private chat');
  row.text = '擅改';
  expect(TurnDraftSchema.safeParse(revised).success).toBe(false);
  await expect(sendPrivateChat(repo, new StageGuard(), { ...start, draft: frozen })).rejects.toMatchObject({
    code: 'PHONE_TARGET',
  });
  const file = await serializeBackup(await repo.exportBackup([saveId]), 'fixture');
  expect(JSON.parse(file).version).toBe(6);
  const entry = (await parseBackup(file)).entries[0];
  expect(entry).toMatchObject({
    ok: true,
    draft: { phonePending: frozen.phonePending, phoneFreeze: frozen.phoneFreeze },
  });
  if (!entry.ok) throw Error('复原备份失败');
  const imported = await SaveRepository.open('chat-import', db());
  try {
    await imported.importBackup(entry, (await imported.compareBackup(entry)).confirmation);
    const restored = await imported.loadGame(saveId);
    expect(restored.draft?.phoneFreeze).toEqual(frozen.phoneFreeze);
    expect(restored.draft?.phonePending).toEqual(frozen.phonePending);
    expect(restored.state.phone).toEqual(start.state.phone);
  } finally { imported.close(); }
  expect(
    JSON.parse(contextMessage(frozenChatContext(start.state, frozen, 'story')).split('\n')[1]).PHONE_CHAT
      .frozenMessages[0].text,
  ).toBe(text);
  await repo.deleteDraft(saveId, frozen.draftRevision, frozen, start.instance);
  const unlocked = (await repo.loadDraft(saveId))!;
  expect(unlocked.phoneFreeze).toBeUndefined();
  expect(unlocked.phonePending).toEqual(frozen.phonePending);
  expect((await repo.bindTurnAction(unlocked, '另一个行动', true, true)).phoneFreeze).toEqual(
    frozen.phoneFreeze,
  );
  expect(await repo.load(saveId)).toEqual(start.state);
});
it('取消、并发回合及过时回包在存储边界被拦截', async () => {
  const start = await input(),
    guard = new StageGuard(),
    client = new AiClient();
  let answer!: () => void;
  const held = new Promise<void>((r) => {
    answer = r;
  });
  const sent = vi.spyOn(client, 'generate').mockImplementation(async () => {
    await held;
    return wire(reply);
  });
  const waiting = sendPrivateChat(repo, guard, start, client);
  await vi.waitFor(() => expect(sent).toHaveBeenCalled());
  await expect(other.bindTurnAction(start.draft!, '另一标签开始回合', true, true)).rejects.toMatchObject({
    code: 'STORY_BUSY',
  });
  guard.cancel();
  answer();
  await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
  expect(await repo.loadDraft(saveId)).toEqual(start.draft);
  const accepted = await accept();
  await expect(sendPrivateChat(other, new StageGuard(), start, client)).rejects.toMatchObject({
    code: 'DRAFT_CONFLICT',
  });
  await expect(
    repo.appendPhoneExchange(
      start.state,
      start.draft,
      start.instance,
      accepted.draft.phonePending![0],
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
});
it('正式事务中断保持冻结数据，重试原子提交且重放不重复', async () => {
  const { start, full } = await freezeAndFinish(),
    put = IDBObjectStore.prototype.put;
  const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === 'drafts') throw new DOMException('interrupted', 'AbortError');
    return put.apply(this, args);
  });
  await expect(repo.commitTurn(submission(full, ''))).rejects.toThrow();
  failing.mockRestore();
  expect(await repo.load(saveId)).toEqual(start.state);
  expect((await repo.loadDraft(saveId))?.phoneFreeze).toEqual(full.phoneFreeze);
  const result = await repo.commitTurn(submission(full, ''));
  const messages = result.state.phone.threads[npcId].messages;
  expect(messages.map((m) => m.id)).toEqual(full.phoneFreeze!.ids);
  expect(messages.map((m) => m.text)).toEqual([text, reply.text]);
  expect(messages.every((m) => m.at === start.state.worldClock && m.deliveredTurnId === full.turnId)).toBe(
    true,
  );
  expect(result.draft.phonePending).toBeUndefined();
  expect((await other.commitTurn(submission(full, ''))).replayed).toBe(true);
  expect((await other.load(saveId)).phone).toEqual(result.state.phone);
});
it.each(['keep', 'discard'] as const)(
  '撤回恢复已消费聊天，并按 %s 处理新时间线上的草稿',
  async (chatChoice) => {
    const { start, full } = await freezeAndFinish();
    const committed = await repo.commitTurn(submission(full, ''));
    const later = await accept();
    const request = {
      saveId,
      expectedRevision: committed.state.revision,
      expectedDraft: later.draft,
      operationId: 'undo-chat',
    };
    await expect(repo.undoTurn(request)).rejects.toMatchObject({ code: 'PHONE_TIMELINE' });
    expect(await repo.load(saveId)).toEqual(committed.state);
    const undone = await repo.undoTurn({ ...request, chatChoice });
    expect(undone.state.phone).toEqual(start.state.phone);
    expect(undone.draft.phonePending?.map((row) => row.id)).toEqual([
      ...full.phoneFreeze!.ids.slice(0, 1),
      ...(chatChoice === 'keep' ? [later.draft.phonePending![0].id] : []),
    ]);
    expect(
      undone.draft.phonePending?.every(
        (row) => row.at === start.state.worldClock && row.baseTurnId === start.state.journal.at(-1)!.turnId,
      ),
    ).toBe(true);
  },
);
it('自动历史节点恢复原聊天，当前新增聊天由确认选项决定', async () => {
  const { start, full } = await freezeAndFinish();
  await repo.commitTurn(submission(full, ''));
  const later = await accept();
  const preview = await repo.history.preview(saveId, { kind: 'automatic', id: full.turnId });
  expect(preview.hasPendingChat).toBe(true);
  const result = await repo.history.restore(preview.confirmation, '从这里继续', true, true, true, 'discard');
  expect(result.state.phone).toEqual(start.state.phone);
  expect(result.draft.phoneFreeze?.ids).toEqual(full.phoneFreeze!.ids);
  expect(result.draft.phoneFreeze?.ids).not.toContain(later.draft.phonePending![0].id);
});

it('首次结构错误后重试同一收信人，成功只产生一个操作', async () => {
  const start = await input(),
    client = new AiClient();
  const sent = vi
    .spyOn(client, 'generate')
    .mockResolvedValueOnce(wire({ npcId, status: 'replied' }))
    .mockResolvedValueOnce(wire(reply));
  const draft = await sendPrivateChat(repo, new StageGuard(), start, client);
  expect(sent).toHaveBeenCalledTimes(2);
  expect(sent.mock.calls[0][1]).toEqual(sent.mock.calls[1][1]);
  expect(draft.phonePending).toHaveLength(1);
});
const switches = [false, true].flatMap((useEntityStage) =>
  [false, true].flatMap((useVariableStage) =>
    [false, true].map((useWorldStage) => ({ useEntityStage, useVariableStage, useWorldStage })),
  ),
);
it.each(switches)(
  '原子结算与按需请求 entities=$useEntityStage scene=$useVariableStage world=$useWorldStage',
  async (flags) => {
    const { TurnCoordinator } = await import('../workflows/turnCoordinator');
    const { variableReply } = await import('./fixtures/variableReply');
    const { worldResult } = await import('./fixtures/world');
    const start = await accept(),
      { config, settings } = start;
    const channelId = config.channels[0].id;
    config.routes.story = { channelId, modelId: 'story' };
    for (const stage of ['entities', 'variables', 'world'] as const)
      config.routes[stage] = { mode: 'independent', channelId, modelId: stage };
    Object.assign(settings.runtime, flags, { streamStory: false });
    settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    const expected = [
      'story',
      ...(flags.useEntityStage ? ['entities'] : []),
      ...(flags.useVariableStage ? ['variables'] : []),
      ...(flags.useWorldStage ? ['world'] : []),
    ];
    const scene = await elapsedVariables(repo, '在窗边等待一分钟', 60);
    const answers: Record<string, string> = {
      story:
        '<thinking>承接手机对话。</thinking><正文>【旁白】主角收起手机，在窗边等待一分钟。</正文><短期记忆>等候取件。</短期记忆><变量规划>[]</变量规划>',
      entities: '<接触者>[]</接触者>' + variableReply({ commands: [] }),
      variables: variableReply(scene),
      world: JSON.stringify(worldResult()),
    };
    const calls: string[] = [];
    const workflow = new TurnCoordinator(
      repo,
      new AiClient(async (_url, init) => {
        const model = JSON.parse(String(init?.body)).model;
        calls.push(model);
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: answers[model] } }] });
      }),
    );
    const draft = await repo.bindTurnAction(
      start.draft,
      '在窗边等待一分钟',
      flags.useVariableStage,
      flags.useWorldStage,
      flags.useEntityStage,
      start.instance,
    );
    const generated = await workflow.generate({ ...start, draft });
    expect(generated.status).toBe('complete');
    expect(calls).toEqual(expected);
    const { state: settled } = await repo.commitTurn(
      { draft: generated.draft, nextAction: '', ...flags },
      start.instance,
    );
    expect(settled.phone.threads[npcId].messages.map((m) => m.text)).toEqual([text, reply.text]);
    expect(settled.economy).toEqual(start.state.economy);
  },
);
it('人物候选在冻结的聊天原文上检查消息 ID，场外仍可安排后续来信', async () => {
  const { checkEntityCommands } = await import('../domain/entityCandidate');
  const { parseWorld } = await import('../services/validation/aiOutputs');
  const { worldResult } = await import('./fixtures/world');
  const { projectTurn } = await import('../domain/turnProjection');
  const { start, full } = await freezeAndFinish();
  const messageId = full.phoneFreeze!.ids[0];
  const duplicate = {
    type: 'RecordPhoneMessage' as const,
    commandId: 'record',
    evidence: '复述原话',
    npcId,
    messageId,
    sender: 'protagonist' as const,
    medium: 'text' as const,
    text,
  };
  const matched = checkEntityCommands(start.state, full, [], [duplicate]);
  expect(matched.phone.threads[npcId].messages).toHaveLength(2);
  expect(() => checkEntityCommands(start.state, full, [], [{ ...duplicate, text: '改写原话' }])).toThrow();
  const after = projectTurn(start.state, full);
  const scheduled = worldResult([
    {
      type: 'SchedulePhoneMessage',
      commandId: 'later',
      messageId: 'subsequent',
      npcId,
      text: '签收完毕。',
      dueAt: after.worldClock,
      evidence: '取件后跟进',
    },
  ]);
  expect(parseWorld(JSON.stringify(scheduled), start.state, full).worldCommands).toHaveLength(1);
});
it('同一段冻结原话能经原生、独立防截断及文学预设正文入口送达，排期原文不提前传入', async () => {
  const { start, frozen } = await freezeAndFinish();
  const { composePrompt } = await import('../prompts/composer');
  const { builtInPresets } = await import('../presets/library');
  const { nativeDeliveryId } = await import('../presets/settings');
  const { schedulePhone } = await import('../domain/phone');
  schedulePhone(
    start.state,
    { messageId: 'future', npcId, text: '未送达的原件位置', dueAt: '2028-01-01T00:00:00Z' },
    start.state.journal.at(-1)!.turnId,
  );
  for (const selection of [
    null,
    nativeDeliveryId,
    ...builtInPresets.map((definition) => ({ definition })),
  ] as const) {
    const { messages } = await composePrompt(
      {
        stage: 'story',
        mode: 'regular',
        settings: start.settings,
        state: start.state,
        draft: frozen,
        userInput: frozen.userInput,
      },
      selection,
    );
    const parts = messages.flatMap((m) =>
      [...m.content.matchAll(/<([A-Z_]+)>\n(\{[^\n]+\})\n<\/\1>/g)].map((match) => JSON.parse(match[2])),
    );
    expect(parts.flatMap((p) => p.PHONE_CHAT?.frozenMessages ?? [])[0].text).toBe(text);
    expect(messages.map((m) => m.content).join('')).not.toContain('未送达的原件位置');
  }
});

it('含已结算私聊的历史节点 v6 恢复原文，节点未携带的独立收藏保持省略', async () => {
  const {full} = await freezeAndFinish();
  const {state} = await repo.commitTurn(submission(full,''));
  const {backupSummary} = await import('../services/storage/backup');
  const file = await serializeBackup([{state,summary:backupSummary(state)}], 'fixture');
  expect(JSON.parse(file).version).toBe(6);
  const restored=(await parseBackup(file)).entries[0];
  expect(restored).toMatchObject({ok:true,state:{phone:state.phone}});
  expect(restored).not.toHaveProperty('theaters');
  expect(restored).not.toHaveProperty('images');
});
