import { afterEach, beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { recordPhone } from '../domain/phone';
import type { TurnDraft } from '../domain/drafts';
import { freezeChat, type ChatExchange } from '../domain/phoneChat';
import { composePrompt } from '../prompts/composer';
import { backupSummary, parseBackup, serializeBackup } from '../services/storage/backup';
import { request, transaction } from '../services/storage/idb';
import { SaveRepository } from '../services/storage/saveRepository';
import { defaultSettings } from '../ui/settings/model';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { worldState } from './fixtures/world';

const saveId = 'save-a';
const peers = ['npc-a', 'scene'];
let repo: SaveRepository, factory: IDBFactory;
const receipt = { npcId: 'npc-a', status: 'replied', text: '  明天在榆树桥见。\n带上原件。  ' } as const;

beforeEach(async () => {
  factory = new IDBFactory();
  repo = await SaveRepository.open('chat-management', factory);
  const state = worldState();
  for (const npcId of peers) state.npc[npcId].phoneContact = { status: 'known' };
  await repo.create(state);
  await repo.commitTurn(submission(await completeDraft(repo), ''));
});
afterEach(() => repo.close());

async function append(text: string, reply: ChatExchange['reply']) {
  const { state, draft, instance } = await repo.loadGame(saveId);
  const row = { id: crypto.randomUUID(), at: state.worldClock, baseTurnId: state.journal.at(-1)!.turnId, text, reply };
  return repo.appendPhoneExchange(state, draft, instance ?? null, row, new AbortController().signal);
}

async function seedStoredDraft(draft: TurnDraft) {
  const database = await request(factory.open('chat-management'));
  try {
    await transaction(database, ['drafts'], 'readwrite', tx => request(tx.objectStore('drafts').put(draft)));
  } finally { database.close(); }
}

it.each([false, true])('变量与人物管理后重载、备份和结算，冻结=%s', async (bound) => {
  await append('  请保留 {{ticket}}  ', receipt);
  let before = await append('那件事请稍后答复。', { npcId: 'scene', status: 'later' });
  if (bound) {
    await repo.bindTurnAction(before, '在窗边等候', true, true, true);
    before = await completeDraft(repo, { variables: await elapsedVariables(repo, '在窗边等候', 60) });
    expect(before.world).toBeDefined();
  }
  const base = await repo.loadVariableSnapshot(saveId);
  const edited = structuredClone(base.state);
  edited.npc.scene.addressing = { playerToNpc: '晚晴' };
  const saved = await repo.savePlayerVariables(base, edited);
  expect(saved.draft?.story).toBeUndefined();
  expect(saved.draft?.entities).toBeUndefined();
  expect(saved.draft?.variables).toBeUndefined();
  expect(saved.draft?.world).toBeUndefined();
  await repo.setNpcImportance({
    saveId, npcId: 'npc-a', identityKey: saved.state.npc['npc-a'].identityKey, choice: 'ordinary',
    expectedRevision: saved.state.revision, expectedManagementRevision: saved.state.npcManagementRevision!,
    expectedDraftRevision: saved.draft!.draftRevision, expectedTurnId: before.turnId, operationId: 'change-importance',
  });
  repo.close();
  repo = await SaveRepository.open('chat-management', factory);
  const live = await repo.loadGame(saveId);
  expect(live.draft?.phonePending).toEqual(before.phonePending);
  expect(live.draft?.phoneFreeze).toEqual(before.phoneFreeze);
  expect(live.draft?.userInput).toEqual(before.userInput);
  expect(live.state.phone).toEqual(base.state.phone);
  const file = await serializeBackup(await repo.exportBackup([saveId]), 'test');
  const entry = (await parseBackup(file)).entries[0];
  if (!entry.ok) throw Error(entry.error);
  const restored = await SaveRepository.open('restored', factory);
  try {
    await restored.importBackup(entry, (await restored.compareBackup(entry)).confirmation);
    const draft = (await restored.loadDraft(saveId))!;
    expect(draft.phoneFreeze).toEqual(before.phoneFreeze);
    expect(draft.phonePending).toEqual(before.phonePending);
    if (!bound) await restored.bindTurnAction(draft, '在窗边等候', true, true, true);
    const ready = await completeDraft(restored, { variables: await elapsedVariables(restored, '在窗边等候', 60) });
    const first = await restored.commitTurn(submission(ready, ''));
    expect(first.draft.phonePending).toBeUndefined();
    expect(first.state.phone.threads['npc-a'].messages.map(m => m.text)).toEqual([before.phonePending![0].text, receipt.text]);
    expect(first.state.phone.threads.scene.messages[0]).toMatchObject({ id: before.phonePending![1].id, chatOutcome: 'later' });
    expect((await restored.commitTurn(submission(ready, ''))).replayed).toBe(true);
    expect((await restored.load(saveId)).phone).toEqual(first.state.phone);
  } finally { restored.close(); }
});

it.each(['人物引用', '基准回合', '消息时间', '冻结校验值'])('阻止覆盖含冲突的聊天草稿：%s', async (conflict) => {
  const pending = await append('约定仍有效。', receipt);
  const frozen = await repo.bindTurnAction(pending, '稍候', true, true, true);
  const snapshot = await repo.loadVariableSnapshot(saveId);
  const row = frozen.phonePending![0];
  if (conflict === '人物引用') row.reply = { ...receipt, npcId: 'missing' };
  if (conflict === '基准回合') row.baseTurnId = 'different-turn';
  if (conflict === '消息时间') row.at = '2031-01-01T00:00:00Z';
  frozen.phoneFreeze = freezeChat([row]);
  if (conflict === '冻结校验值') frozen.phoneFreeze.checksum++;
  // Simulate an existing draft whose structure or references no longer agree with the save.
  await seedStoredDraft(frozen);
  const original = await repo.exportRaw(saveId);
  const base = { ...snapshot, draft: frozen };
  await expect(repo.savePlayerVariables(base, { ...base.state, title: '新标题' })).rejects.toThrow(/私聊/);
  await expect(repo.exportBackup([saveId])).rejects.toThrow(/私聊/);
  await expect(repo.compareBackup({ state: base.state, draft: frozen })).rejects.toThrow(/私聊/);
  const incoming = await serializeBackup([{ state: base.state, summary: backupSummary(base.state), draft: frozen }], 'fixture');
  expect((await parseBackup(incoming)).entries[0]).toMatchObject({ ok: false, error: expect.stringContaining('私聊') });
  expect(await repo.exportRaw(saveId)).toEqual(original);
});

it('多人的本轮冻结消息按全局顺序进入正文和人物请求，历史独立裁剪，重放只结算一次', async () => {
  const existing = await repo.loadGame(saveId);
  for (const peer of peers) {
    for (let i = 0; i < 12; i++)
      recordPhone(existing.state, peer, { sender: 'npc', medium: 'text', messageId: peer + '-old-' + i, text: peer + ' 历史消息 ' + i }, 'prior', false);
  }
  await repo.importBackup(existing, (await repo.compareBackup(existing)).confirmation, { overwrite: true });
  const expected = [];
  for (let i = 0; i < 14; i++) {
    const npcId = peers[i % 2];
    const text = i === 0 ? '  约好在榆树桥交接 {{原件}}。  ' : i === 1 ? '线索来自钟表铺的账册。' : '问题 ' + i;
    const reply: ChatExchange['reply'] = i >= 11 ? { npcId, status: (['later','read_unanswered','unread'] as const)[i-11] }
      : { npcId, status: 'replied', text: i === 0 ? '以后请叫我澄江。\n明天见。' : '答复 ' + i };
    const pending = await append(text, reply), id = pending.phonePending!.at(-1)!.id;
    expected.push({ npcId, id, text, sender: 'protagonist', chatOutcome: reply.status,
      status: reply.status === 'replied' ? 'read' : reply.status === 'unread' ? 'delivered' : 'read_unanswered' });
    if (reply.status === 'replied') expected.push({ npcId, id: id + ':reply', sender: 'npc', text: reply.text });
  }
  const { state, draft } = await repo.loadGame(saveId);
  const frozen = await repo.bindTurnAction(draft!, '等候一分钟', true, true, true);
  const full = await completeDraft(repo, { variables: await elapsedVariables(repo, '等候一分钟', 60) });
  expect(frozen.phoneFreeze!.ids).toEqual(expected.map(m => m.id));
  for (const stage of ['story', 'entities'] as const) {
    const { messages } = await composePrompt({ stage, mode: 'regular', state, settings: defaultSettings(),
      draft: stage === 'story' ? frozen : full, userInput: frozen.userInput });
    const contexts = messages.flatMap(m => [...m.content.matchAll(/<([A-Z_]+)>\n(\{[^\n]+\})\n<\/\1>/g)].map(match => JSON.parse(match[2])));
    const chats = contexts.filter(c => c.PHONE_CHAT).map(c => c.PHONE_CHAT);
    expect(chats).toHaveLength(1);
    expect(chats[0].frozenMessages).toMatchObject(expected);
    const history = chats[0].threads;
    expect(history).toHaveLength(2);
    for (const [i, peer] of peers.entries()) {
      const prior = state.phone.threads[peer].messages;
      expect(history[i]).toMatchObject({ npcId: peer, recent: prior.slice(-8), earlier: { count: 4, lastExcerpt: prior[3].text } });
    }
  }
  const first = await repo.commitTurn(submission(full, ''));
  expect((await repo.commitTurn(submission(full, ''))).replayed).toBe(true);
  for (const peer of peers) {
    const messages = (await repo.load(saveId)).phone.threads[peer].messages.slice(12);
    expect(messages).toEqual(first.state.phone.threads[peer].messages.slice(12));
    expect(messages.map(m => ({ ...m, npcId: peer }))).toMatchObject(expected.filter(m => m.npcId === peer));
  }
});

it('恢复历史节点只去重完全相同的聊天，遇到同 ID 不同回执则回滚', async () => {
  const pending = await append('约在南门。', receipt);
  await repo.bindTurnAction(pending, '稍候一分钟', true, true, true);
  const full = await completeDraft(repo, { variables: await elapsedVariables(repo, '稍候一分钟', 60) });
  const committed = await repo.commitTurn(submission(full, ''));
  const node = await repo.history.create(saveId, '聊天已结算');
  const before = await repo.undoTurn({ saveId, expectedRevision: committed.state.revision, expectedDraft: committed.draft, operationId: 'review-undo' });
  const selection = { kind: 'manual' as const, id: node.id };
  const copied = structuredClone(before.draft);
  copied.phonePending![0].reply = { npcId: 'npc-a', status: 'unread' };
  await seedStoredDraft(copied);
  const conflict = await repo.history.preview(saveId, selection);
  const raw = await repo.exportRaw(saveId);
  await expect(repo.history.restore(conflict.confirmation, '等候', true, true, true, 'keep')).rejects.toMatchObject({ code: 'PHONE_CONFLICT' });
  expect(await repo.exportRaw(saveId)).toEqual(raw);
  await seedStoredDraft(before.draft);
  const match = await repo.history.preview(saveId, selection);
  const restored = await repo.history.restore(match.confirmation, '等候', true, true, true, 'keep');
  expect(restored.draft.phonePending).toBeUndefined();
  expect(restored.state.phone).toEqual(committed.state.phone);
});
