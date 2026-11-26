import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { migrateSave } from '../services/storage/migrations';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { worldResult, worldState } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { parseEntities, parseWorld } from '../services/validation/aiOutputs';
import { variableTextEnvelope } from './fixtures/variableReply';
import { settleTurn } from '../domain/turnCommit';
import { projectTurn } from '../domain/turnProjection';
import { configureTurnStages, startStageAttempt } from '../domain/drafts';
import { phoneContext } from '../prompts/phoneContext';
import { commandsForPhase } from '../domain/stageCommands';
import { commandCatalog } from '../services/validation/commandCatalog';
import { recordPhone, schedulePhone } from '../domain/phone';
import type { DomainCommand } from '../domain/commands';

const story = {
  messageId: 'story-letter',
  sender: 'npc' as const,
  medium: 'call' as const,
  text: '  前台说：“原件到了。”\n请签收。  ',
};
const scheduled = (
  dueAt: string,
  id = 'letter',
): Extract<DomainCommand, { type: 'SchedulePhoneMessage' }> => ({
  commandId: 'schedule-' + id,
  type: 'SchedulePhoneMessage',
  messageId: id,
  npcId: 'npc-a',
  text: '文件在前台。',
  dueAt,
  evidence: '场外跟进',
});
let repo: SaveRepository, other: SaveRepository;
beforeEach(async () => {
  const db = new IDBFactory();
  repo = await SaveRepository.open('inbox', db);
  other = await SaveRepository.open('inbox', db);
  await repo.create(worldState());
  await repo.commitTurn(submission(await completeDraft(repo), ''));
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.close();
  other.close();
});
async function candidates() {
  const state = await repo.load('save-a');
  const scene = await elapsedVariables(repo, '领取文件', 60);
  const end = scene.commands[0].worldClock;
  const later = new Date(Date.parse(end) + 60000).toISOString();
  const entity = {
    ...story,
    npcId: 'scene',
    commandId: 'record',
    type: 'RecordPhoneMessage' as const,
    evidence: '正文原话',
  };
  const draft = await completeDraft(repo, {
    variables: { ...scene, commands: [entity, ...scene.commands] },
    world: worldResult([scheduled(end), scheduled(later, 'later')]),
  });
  return { state, draft, end, later, entity };
}
describe('正文消息和场外来信', () => {
  it('人物文本协议保留通话原文；仅提及可标出场，未授权其他人物字段', async () => {
    const { state, draft, end } = await candidates();
    const text = (commands: string) => variableTextEnvelope('<命令>\n' + commands + '\n</命令>');
    const reply = await parseEntities(
      text(
        'push npc[scene].phoneMessages = ' +
          JSON.stringify(story) +
          '\nset npc[npc-a].appearedInStory = true',
      ),
      state,
      draft,
    );
    expect(reply.commands).toMatchObject([
      { type: 'RecordPhoneMessage', ...story },
      { type: 'UpdateNpc', changes: { appearedInStory: true } },
    ]);
    await expect(parseEntities(text('set npc[npc-a].healthText = "正常"'), state, draft)).rejects.toThrow();
    const projected = projectTurn(state, draft);
    expect(projected.npc.scene.appearedInStory).toBe(true);
    expect(projected.phone.threads.scene.messages[0]).toMatchObject({ at: end, text: story.text });
    expect(state.phone.threads).toEqual({});
    expect(projected.phone.scheduled).toEqual([]);
    expect(
      parseWorld(JSON.stringify(worldResult([scheduled(end)])), state, draft).worldCommands,
    ).toHaveLength(1);
    // The appearance rule belongs to the prompt. An absent marker is not a program veto.
    expect(state.npc['npc-a'].appearedInStory).toBeUndefined();
    expect(() =>
      parseWorld(JSON.stringify(worldResult([{ ...scheduled(end), npcId: 'scene' }])), state, draft),
    ).toThrow();
    expect(() =>
      parseWorld(JSON.stringify(worldResult([scheduled(state.worldClock)])), state, draft),
    ).toThrow();
    expect(commandsForPhase('offscreen', 'opening')).not.toContain('SchedulePhoneMessage');
    expect(commandCatalog('world', true, false).commandTypes).not.toContain('SchedulePhoneMessage');
    expect(commandsForPhase('scene', 'regular')).not.toContain('RecordPhoneMessage');
    expect(commandsForPhase('entities', 'regular')).not.toContain('SchedulePhoneMessage');
  });
  it('同一次 CAS 投递恰好到期的来信，未来消息跨回合，重放不重复，撤回恢复队列和会话', async () => {
    const { state, draft, end, later } = await candidates();
    const first = await repo.commitTurn(submission(draft, ''));
    const replay = await other.commitTurn(submission(draft, ''));
    expect(replay.replayed).toBe(true);
    expect(replay.state.phone).toEqual(first.state.phone);
    expect(first.state.revision).toBe(state.revision + 1);
    expect(first.state.phone.threads['npc-a'].messages).toMatchObject([
      {
        id: 'letter',
        source: 'offscreen',
        sourceTurnId: draft.turnId,
        deliveredTurnId: draft.turnId,
        at: end,
      },
    ]);
    expect(first.state.phone.scheduled.map((m) => m.messageId)).toEqual(['later']);
    const entry = (await parseBackup(await serializeBackup(await repo.exportBackup(['save-a']), 'inbox')))
      .entries[0];
    expect(entry).toMatchObject({ ok: true, state: { phone: first.state.phone } });
    const node = await repo.history.create('save-a', '来信');
    expect((await repo.history.preview('save-a', { kind: 'manual', id: node.id })).state.phone).toEqual(
      first.state.phone,
    );
    const next = await completeDraft(repo, { variables: await elapsedVariables(repo, '稍候', 60) });
    const second = await repo.commitTurn(submission(next, ''));
    expect(second.state.phone.scheduled).toEqual([]);
    expect(second.state.phone.threads['npc-a'].messages[1]).toMatchObject({
      id: 'later',
      at: later,
      sourceTurnId: draft.turnId,
      deliveredTurnId: next.turnId,
    });
    const undo = await repo.undoTurn({
      saveId: 'save-a',
      expectedRevision: second.state.revision,
      expectedDraft: second.draft,
      operationId: 'undo-letter',
    });
    expect(undo.state.phone).toEqual(first.state.phone);
    await expect(other.commitTurn(submission(next, ''))).rejects.toThrow();
  });
  it('历史回溯恢复待投递与当时的会话，备份可实际导入再投递', async () => {
    const { draft } = await candidates();
    const first = await repo.commitTurn(submission(draft, ''));
    const node = await repo.history.create('save-a', '投递前');
    const exported = await serializeBackup(await repo.exportBackup(['save-a']), 'inbox');
    const second = await completeDraft(repo, { variables: await elapsedVariables(repo, '过一分钟', 60) });
    await repo.commitTurn(submission(second, ''));
    const preview = await repo.history.preview('save-a', { kind: 'manual', id: node.id });
    const restored = await repo.history.restore(preview.confirmation, '等来信', true, true);
    expect(restored.state.phone).toEqual(first.state.phone);
    const imported = await SaveRepository.open('restored', new IDBFactory());
    try {
      const [entry] = (await parseBackup(exported)).entries;
      if (!entry.ok) throw Error(entry.error);
      await imported.importBackup(entry, (await imported.compareBackup(entry)).confirmation);
      const replay = await completeDraft(imported, {
        variables: await elapsedVariables(imported, '等来信', 60),
      });
      const arrived = await imported.commitTurn(submission(replay, ''));
      expect(arrived.state.phone.threads['npc-a'].messages.map((m) => m.id)).toEqual(['letter', 'later']);
    } finally {
      imported.close();
    }
  });
  it('关闭三段仍投递此前已到期的消息，纯过去视角不消费当前队列', async () => {
    const { state, draft } = await candidates();
    const off = configureTurnStages(draft, {
      useEntityStage: false,
      useVariableStage: false,
      useWorldStage: false,
    });
    schedulePhone(
      state,
      { messageId: 'prior', npcId: 'npc-a', dueAt: state.worldClock, text: '排队的来信' },
      'prior-turn',
    );
    const next = settleTurn(state, off, state.updatedAt);
    expect(next.phone.threads['npc-a'].messages.map((m) => m.id)).toEqual(['prior']);
    expect(next.phone.threads.scene).toBeUndefined();
    const historical = {
      ...off,
      userInput: '从现场人物的视角，回顾去年用餐的往事。',
      story: {
        ...off.story!,
        variableGuide: [
          {
            group: 'time' as const,
            subjectHint: 'time:retrospective',
            textEvidence: '回顾往事',
            observedFact: JSON.stringify({
              npcId: 'scene',
              perspectiveRequest: '现场人物的视角',
              pastRequest: '回顾去年',
              temporalScope: 'past_only',
              currentPlotAdvances: false,
            }),
          },
        ],
      },
    };
    expect(settleTurn(state, historical, state.updatedAt).phone).toEqual(state.phone);
  });
  it('失败、取消、重做和禁用上游候选不投递', async () => {
    const { state, draft } = await candidates();
    const disabled = configureTurnStages(draft, {
      useEntityStage: false,
      useVariableStage: false,
      useWorldStage: false,
    });
    expect(startStageAttempt(draft, ['entities']).world).toBeUndefined();
    expect(disabled.useEntityStage).toBe(false);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'drafts') throw new DOMException('quota', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(repo.commitTurn(submission(draft, ''))).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await repo.load('save-a')).toEqual(state);
    await repo.deleteDraft('save-a', draft.draftRevision);
    await expect(other.commitTurn(submission(draft, ''))).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(state);
  });
  it('相同消息 ID 重放保持唯一，冲突不覆盖。正文只收到已投递记录的有限上下文', async () => {
    const { state, end } = await candidates();
    const peer = 'npc-a';
    for (let i = 0; i < 12; i++)
      recordPhone(state, peer, { ...story, messageId: 'msg-' + i }, state.journal.at(-1)!.turnId, false);
    recordPhone(state, peer, { ...story, messageId: 'msg-0' }, 'again', false);
    expect(state.phone.threads[peer].messages).toHaveLength(12);
    expect(() =>
      recordPhone(state, peer, { ...story, messageId: 'msg-0', text: '替换' }, 'again', false),
    ).toThrow();
    const input = { npcId: peer, dueAt: end, messageId: 'pending', text: '尚未送达的内容' };
    schedulePhone(state, input, 'earlier');
    schedulePhone(state, input, 'again');
    expect(() => schedulePhone(state, { ...input, text: '覆盖' }, 'again')).toThrow();
    const context = phoneContext(state, 'story', '');
    expect(context.PHONE_STORY?.threads[0].earlier?.count).toBe(4);
    expect(context.PHONE_STORY?.threads[0].recent).toHaveLength(8);
    expect(JSON.stringify(context)).not.toContain(input.text);
    expect(phoneContext(state, 'world', '').PHONE_INBOX?.scheduled).toMatchObject([{ messageId: 'pending' }]);
  });
  it('V11 第二步空 phone 与三段草稿可恢复；新建场外人物保持未标记，损坏的旧表拒绝迁移', async () => {
    const { state, draft } = await candidates();
    const old = { ...state, phone: { threads: {}, scheduled: [], topics: [] } };
    const migrated = migrateSave(old);
    expect(Object.values(migrated.npc).every((p) => p.appearedInStory)).toBe(true);
    expect(migrateSave(state).npc['npc-a'].appearedInStory).toBeUndefined();
    expect(() => migrateSave({ ...old, phone: { ...old.phone, scheduled: [{}] } })).toThrow();
    const parsed = await parseBackup(
      JSON.stringify({ format: 'heijin-backup', version: 4, saves: [{ state: old, draft, theaters: [] }] }),
    );
    expect(parsed.entries[0]).toMatchObject({
      ok: true,
      draft: { turnId: draft.turnId },
      state: { phone: { version: 1 } },
    });
  });
});

it('四种正文入口可承接含模板字样的手机原话，排队消息仍不可见', async () => {
  const [{ composePrompt }, { talentPromptInput }, { builtInPresets }, { nativeDeliveryId }] =
    await Promise.all([
      import('../prompts/composer'),
      import('./fixtures/talentPrompt'),
      import('../presets/library'),
      import('../presets/settings'),
    ]);
  const input = talentPromptInput('story', 'regular');
  const text = '签收编号写着 {{ticket}}，原样带上。';
  const turn = input.state.journal.at(-1)!.turnId;
  recordPhone(
    input.state,
    'npc-a',
    { messageId: 'receipt', sender: 'npc', medium: 'text', text },
    turn,
    false,
  );
  schedulePhone(
    input.state,
    {
      messageId: 'pending-receipt',
      npcId: 'npc-a',
      dueAt: '2027-01-01T08:00:00+08:00',
      text: '尚未送达的签收细节',
    },
    turn,
  );
  for (const selection of [
    null,
    nativeDeliveryId,
    ...builtInPresets.map((definition) => ({ definition })),
  ] as const) {
    const { messages } = await composePrompt(input, selection);
    const parts = messages.flatMap((m) =>
      [...m.content.matchAll(/<([A-Z_]+)>\n(\{[^\n]+\})\n<\/\1>/g)].map((match) => JSON.parse(match[2])),
    );
    expect(parts.flatMap((p) => p.PHONE_STORY?.threads ?? [])[0].recent[0].text).toBe(text);
    const wire = messages.map((m) => m.content).join('\n');
    expect(wire).toContain('只有玩家行动明确授权');
    expect(wire).not.toContain('尚未送达的签收细节');
  }
  const { contextMessage } = await import('../prompts/contextMessage');
  const command = { type: 'RecordPhoneMessage', text };
  const keys = { ENTITY_CANDIDATE: [command], other: '{{unknown}}' };
  const envelope = contextMessage(keys);
  expect(JSON.parse(envelope.split('\n')[1])).toEqual(keys);
  expect(envelope).not.toContain('{{ticket}}');
  expect(envelope).toContain('{{unknown}}');
  expect(input.state.phone.threads['npc-a'].messages[0].text).toBe(text);
});
