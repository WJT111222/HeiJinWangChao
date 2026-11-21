import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { editAtPath } from '../domain/playerVariables';
import { reserveStageSession } from '../workflows/stageGuard';
import { parseTextVariables, parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { npc } from './fixtures/game';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { sentContext } from './fixtures/contextAssertions';
import { initialCompanionProfile, loadCompanionProfile } from '../services/local/companionProfile';

let repo: SaveRepository;
let factory: IDBFactory;
const id = 'save-a';
beforeEach(async () => {
  factory = new IDBFactory();
  repo = await SaveRepository.open('vars', factory);
  const state = worldState();
  state.initialCompanionId = 'npc-a';
  state.npc['npc-a'].identityKey = id + ':initial-companion';
  state.npc.scene.age = 55;
  await repo.create(state);
});
afterEach(() => repo.close());

it('Variables 文本命令可从剧情更新未逐字出现的称呼，保留另一方向及其他 NPC 的设置', async () => {
  const snap = await repo.loadVariableSnapshot(id);
  expect(snap.state.schemaVersion).toBe(10);
  expect(snap.state.npc.scene).not.toHaveProperty('addressing');
  const documents = new Map<string,string>();
  const storage = {getItem:(key:string)=>documents.get(key) ?? null, setItem:(key:string,data:string)=>{documents.set(key,data);}};
  const archive = loadCompanionProfile(storage,snap.state);
  expect(archive?.npcId).toBe('npc-a');
  const originalBytes = [...documents.entries()];
  const edited = structuredClone(snap.state);
  edited.npc.scene.addressing = { playerToNpc: '晚晴' };
  edited.npc['npc-a'].addressing = { npcToPlayer: '老板' };
  edited.npc['npc-a'].appearance = '当前外貌';
  const saved = await repo.savePlayerVariables(snap, edited);
  expect(archive?.profile.appearance).not.toBe('当前外貌');
  expect(initialCompanionProfile(saved.state)).toBeUndefined();
  expect(loadCompanionProfile(storage,saved.state)).toEqual(archive);
  expect([...documents.entries()]).toEqual(originalBytes);
  const draft = rerollStory(createTurnDraft(id, 0, 'address', 'opening', '交谈'), {
    turnKind: 'opening',
    narrative: '【旁白】对方笑着换了个更亲近的称呼。',
    summary: '双方约定称呼。',
    variableGuide: [],
  });
  const vars = await parseTextVariables(
    '<thinking>根据当场约定更新。</thinking><说明></说明><命令>\nset npc[scene].addressing = {"npcToPlayer":"老大"}\n</命令>',
    saved.state,
    draft,
  );
  const ready = await completeDraft(repo, {
    variables: vars,
    world: worldResult(),
    narrative: draft.story!.narrative,
  });
  const result = await repo.commitTurn(submission(ready, ''));
  expect(result.state.npc.scene.addressing).toEqual({ playerToNpc: '晚晴', npcToPlayer: '老大' });
  expect(result.state.npc['npc-a'].addressing).toEqual({ npcToPlayer: '老板' });
  const w = worldResult();
  const forbidden = {
    type: 'UpdateNpc',
    commandId: 'x',
    expectedRevision: 0,
    npcId: 'npc-a',
    evidence: '旧正文习惯称呼',
    changes: { addressing: { npcToPlayer: '先生' } },
  };
  expect(() =>
    parseWorld(JSON.stringify({ ...w, worldCommands: [forbidden] }), saved.state, worldDraft()),
  ).toThrow();
});

it.each(['UpdateNpc', 'CreateNpc'] as const)('Variables JSON %s 可结算正文未逐字出现的双向称呼', async (type) => {
  const state = await repo.load(id);
  const draft = worldDraft(false, 'opening');
  const addressing = { playerToNpc: '小周', npcToPlayer: '林老师' };
  const npcId = type === 'UpdateNpc' ? 'scene' : 'new-npc';
  const common = { type, commandId: 'addressing', evidence: '剧情中关系趋近' };
  const command = type === 'UpdateNpc'
    ? { ...common, npcId, expectedRevision: state.revision, changes: { addressing } }
    : { ...common, npc: { ...npc(npcId), name: '周岚', addressing } };
  const candidate = parseVariables(JSON.stringify({
    commands: [command], rejectedSuggestions: [], unresolved: [],
  }), state, draft);
  const ready = await completeDraft(repo, { variables: candidate, narrative: draft.story!.narrative });
  const result = await repo.commitTurn(submission(ready, ''));
  expect(result.state.npc[npcId].addressing).toEqual(addressing);
  expect((await repo.load(id)).npc[npcId].addressing).toEqual(addressing);
});

it('称呼 JSON 命令继续拒绝错误字段类型和不存在的 NPC', async () => {
  const state = await repo.load(id);
  const draft = worldDraft(false, 'opening');
  const command = { type: 'UpdateNpc', npcId: 'scene', commandId: 'addressing', expectedRevision: state.revision,
    evidence: '关系趋近', changes: { addressing: { npcToPlayer: '林老师' } } };
  const validate = (value: unknown) => parseVariables(JSON.stringify({
    commands: [value], rejectedSuggestions: [], unresolved: [],
  }), state, draft);
  expect(() => validate({ ...command, changes: { addressing: { npcToPlayer: 10 } } })).toThrow(expect.objectContaining({ code: 'schema_fields' }));
  expect(() => validate({ ...command, npcId: 'missing' })).toThrow(expect.objectContaining({ code: 'data_integrity' }));
  expect(await repo.load(id)).toEqual(state);
});

it('Variables 关闭时，下一次 Story messages 同时保留旧正文并读取正式新称呼', async () => {
  await repo.commitTurn(
    submission(
      await completeDraft(repo, { narrative: '【旁白】过去多次称她为阿姨。\n【主角】阿姨，阿姨。' }),
      '',
    ),
  );
  const snap = await repo.loadVariableSnapshot(id);
  const corrected = { playerToNpc: '晚晴', npcToPlayer: '老大' };
  await repo.savePlayerVariables(snap, editAtPath(snap.state, '/npc/scene/addressing', corrected));
  const { state, draft } = await repo.loadGame(id);
  const settings = defaultSettings();
  settings.runtime.useVariableStage = false;
  const { messages } = await composePrompt({
    stage: 'story',
    mode: 'regular',
    state,
    draft,
    settings,
    userInput: '直呼姓名',
  });
  expect(sentContext(messages).SAVE_STATE).toMatchObject({
    npc: { scene: { age: 55, addressing: corrected } },
  });
  expect(messages.map((m) => m.content).join('\n')).toContain('当前明确设定优先于旧正文');
  expect(state.journal.at(-1)?.story.narrative).toContain('阿姨，阿姨');
});

it('并发、在途阶段与迟到候选受锁和 CAS 保护，行动保留且候选失效', async () => {
  const old = await completeDraft(repo);
  const base = await repo.loadVariableSnapshot(id);
  const other = await SaveRepository.open('vars', factory);
  try {
    const stale = await other.loadVariableSnapshot(id);
    const edited = editAtPath(base.state, '/protagonist/age', 23);
    const held = reserveStageSession(id);
    try {
      await expect(repo.savePlayerVariables(base, edited)).rejects.toMatchObject({ code: 'STORY_BUSY' });
    } finally {
      held.release();
    }
    const saved = await repo.savePlayerVariables(base, edited);
    expect(saved.draft).toMatchObject({
      userInput: old.userInput,
      turnId: old.turnId,
      draftRevision: old.draftRevision + 1,
      stageStatus: { story: 'pending' },
    });
    for (const key of ['story', 'variables', 'world'])
      expect(saved.draft?.[key as 'story']).toBeUndefined();
    await expect(other.savePlayerVariables(stale, edited)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(other.commitTurn(submission(old))).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(
      other.saveDraft({ ...old, draftRevision: old.draftRevision + 1 }, old.draftRevision),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadVariableSnapshot(id)).toEqual(saved);
  } finally {
    other.close();
  }
});

it.each([
  ['/protagonist/age', '二十'],
  ['/protagonist/locationId', 'missing'],
  ['/npc/scene/id', 'new-id'],
  ['/economy/cash', 0],
  ['/journal', [{}]],
  ['/npc', []],
  ['/protagonist/newField', true],
])('非法类型、结构、身份和引用均整笔回滚 %s', async (path, value) => {
  const base = await repo.loadVariableSnapshot(id);
  const edited = editAtPath({ ...base.state, title: '不得部分保存' }, String(path), value);
  await expect(repo.savePlayerVariables(base, edited)).rejects.toThrow();
  expect(await repo.loadVariableSnapshot(id)).toEqual(base);
});

it('正式快照、历史收藏、下一回合撤回及备份恢复各自保留所在时点的值', async () => {
  await repo.commitTurn(submission(await completeDraft(repo), ''));
  const node = await repo.history.create(id, '修改前');
  const base = await repo.loadVariableSnapshot(id),
    next = structuredClone(base.state);
  next.npc.scene.addressing = { playerToNpc: '晚晴' };
  next.npc.scene.onScene = false;
  next.protagonist.skills = ['翻译'];
  next.protagonist.age = 23;
  const saved = await repo.savePlayerVariables(base, next);
  expect(saved.state.npc.scene).toMatchObject({ onScene: false, addressing: { playerToNpc: '晚晴' } });
  expect(saved.state.protagonist).toMatchObject({ age: 23, skills: ['翻译'] });
  const hist = await repo.history.preview(id, { kind: 'manual', id: node.id });
  expect(hist.state.npc.scene.addressing).toBeUndefined();
  expect(hist.state.protagonist.age).toBe(base.state.protagonist.age);
  const backup = (await repo.exportBackup([id]))[0];
  const fresh = await SaveRepository.open('backup-vars', factory);
  try {
    const comparison = await fresh.compareBackup(backup);
    await fresh.importBackup(backup, comparison.confirmation);
    expect((await fresh.load(id)).npc.scene.addressing).toEqual(next.npc.scene.addressing);
  } finally {
    fresh.close();
  }
  await repo.bindTurnAction(saved.draft!, '下一步', true, true);
  const turn = await repo.commitTurn(
    submission(
      await completeDraft(repo, { variables: await elapsedVariables(repo, '经过一分钟', 60) }),
      '',
    ),
  );
  const restored = await repo.undoTurn({
    saveId: id,
    expectedRevision: turn.state.revision,
    expectedDraft: turn.draft,
    operationId: 'undo-edited-turn',
  });
  expect(restored.state.npc.scene.addressing).toEqual(next.npc.scene.addressing);
});

it('同 ID 的新实例不能使用旧编辑快照；控制记录写入失败时正式数据和草稿一起回滚', async () => {
  await completeDraft(repo);
  const base = await repo.loadVariableSnapshot(id);
  const copy = (await repo.exportBackup([id]))[0],
    compared = await repo.compareBackup(copy);
  await repo.importBackup(copy, compared.confirmation, { overwrite: true });
  await expect(
    repo.savePlayerVariables(base, { ...base.state, title: '过期编辑' }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const restored = await repo.loadVariableSnapshot(id);
  expect(restored.instance).not.toBe(base.instance);
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: InstanceType<typeof IDBObjectStore>,
    ...args: Parameters<typeof put>
  ) {
    if (this.name === 'saveControls') throw new DOMException('mock quota', 'QuotaExceededError');
    return put.apply(this, args);
  });
  try {
    await expect(
      repo.savePlayerVariables(restored, { ...restored.state, title: '不得部分保存' }),
    ).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  expect(await repo.loadVariableSnapshot(id)).toEqual(restored);
});
