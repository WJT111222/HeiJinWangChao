import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameStateSchema } from '../domain/state';
import { ProtagonistSchema } from '../domain/protagonist/schema';
import { talentDefinitions } from '../domain/protagonist/talents';
import type { TalentId } from '../domain/protagonist/talents';
import { buildCreationState, CreationSchema, creationKey, createProfileSave, newCreation, selectProfession } from '../ui/creation/model';
import { applyOpeningPack, OpeningPackStore, openingPackPrefix } from '../ui/creation/openingPacks';
import { readDocument, writeDocument } from '../services/local/documents';
import { SaveRepository } from '../services/storage/saveRepository';
import { migrateSave } from '../services/storage/migrations';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { defaultSettings } from '../ui/settings/model';
import { gameTime } from './fixtures/game';
import { completeDraft } from './fixtures/turn';

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const variants = [undefined, ...talentDefinitions.map(t => t.id)];
const noWorldChanges = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] };
const network = vi.fn(() => { throw new Error('PR-A must not send requests'); });
beforeEach(() => { network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function talentForm(talentId?: TalentId) {
  const form = selectProfession(newCreation(), '教师');
  form.saveId = 'save-a'; form.step = 5;
  form.worldClock = gameTime; delete form.openingTimePending;
  form.person = { name: '林岚', age: '29', gender: '女性', appearance: '旧外貌\n第二行', personality: '保持原性格' };
  form.background = '旧背景\n第二行'; form.skills = '手动技能\n沟通'; form.skillsSource = 'manual';
  form.hasCompanion = true;
  form.companion = { name: '许宁', age: '28', identity: '同事', appearance: '短发', personality: '直率', skills: '排版\n沟通', background: '既有经历', relationship: '老朋友' };
  form.openingPreference = '从普通一天开始';
  if (talentId !== undefined) form.talentId = talentId;
  return form;
}
function expectTalent(hero: { talentId?: TalentId }, id?: TalentId) {
  expect(hero.talentId).toBe(id);
  expect(Object.hasOwn(hero, 'talentId')).toBe(id !== undefined);
}

describe('创角数据、旧草稿、开局包 T03–T08', () => {
  it('默认新草稿与正式 V10 主角不补字段，默认开局时钟策略不变', () => {
    expect(newCreation()).not.toHaveProperty('talentId');
    const form = talentForm();
    const state = buildCreationState(form, defaultSettings());
    expect(state.schemaVersion).toBe(11); expectTalent(state.protagonist);
    const pending = { ...form, worldClock: newCreation().worldClock, openingTimePending: true as const };
    expect(buildCreationState(pending, defaultSettings()).openingTimePending).toBe(true);
  });

  it.each(talentDefinitions)('$id 只增加主角 ID，不改变职业、技能、同伴或资金', ({ id }) => {
    const expected = buildCreationState(talentForm(), defaultSettings());
    const actual = buildCreationState(talentForm(id), defaultSettings());
    const { talentId, ...hero } = actual.protagonist;
    expect(talentId).toBe(id); expect(hero).toEqual(expected.protagonist);
    expect(actual.npc).toEqual(expected.npc); expect(actual.economy).toEqual(expected.economy);
    expect(actual.items).toEqual(expected.items); expect(actual.organizations).toEqual(expected.organizations);
  });

  it.each([null, 'none', '枭雄光环', 'unknown', ['underworld_aura', 'cyber_tyrant']])(
    '创角和正式主角严格拒绝不合法字段 %j', value => {
      const form = talentForm();
      expect(CreationSchema.safeParse({ ...form, talentId: value }).success).toBe(false);
      const state = buildCreationState(form, defaultSettings());
      expect(ProtagonistSchema.safeParse({ ...state.protagonist, talentId: value }).success).toBe(false);
      expect(GameStateSchema.safeParse({ ...state, protagonist: { ...state.protagonist, talentId: value } }).success).toBe(false);
    },
  );

  it.each([1, 2, 3, 4, 5])('旧 heijin.creation.v1 第 %i 步草稿读取不丢字段、不清空、不回写', step => {
    const storage = new MemoryStorage(), legacy = { ...talentForm(), step };
    const original = JSON.stringify(legacy); storage.setItem(creationKey, original);
    expect(creationKey).toBe('heijin.creation.v1');
    expect(readDocument(storage, creationKey, CreationSchema)).toEqual(legacy);
    expect(storage.getItem(creationKey)).toBe(original);
    expect(readDocument(storage, creationKey, CreationSchema)).not.toHaveProperty('talentId');
  });

  it.each(talentDefinitions)('$id 经职业切换、草稿保存与刷新仍保留且可清除', ({ id }) => {
    const storage = new MemoryStorage();
    const changed = selectProfession(selectProfession(talentForm(id), '程序员'), 'custom');
    expect(changed.talentId).toBe(id);
    writeDocument(storage, creationKey, CreationSchema, changed);
    const refreshed = readDocument(storage, creationKey, CreationSchema)!;
    expect(refreshed).toEqual(changed);
    delete refreshed.talentId;
    const cleared = writeDocument(storage, creationKey, CreationSchema, refreshed);
    expect(cleared).not.toHaveProperty('talentId');
    expect(JSON.parse(storage.getItem(creationKey)!)).not.toHaveProperty('talentId');
  });

  it.each(variants)('开局包 %s 保留/省略 ID；旧包完整覆盖后回到无天赋', id => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), form = talentForm(id);
    const saved = store.save('天赋兼容', form), before = [...storage.data];
    expect(saved.version).toBe(1); expect(openingPackPrefix).toBe('heijin.opening-pack.v1:');
    const list = store.list(); expect(list).toEqual({ packs: [saved], invalidCount: 0 });
    const applied = applyOpeningPack(list.packs[0]); expectTalent(applied, id);
    expect(applied.person).toEqual(form.person); expect(applied.skills).toBe(form.skills); expect(applied.companion).toEqual(form.companion);
    expect(applied.step).toBe(5); expect(applied.saveId).not.toBe(form.saveId);
    expect([...storage.data]).toEqual(before);
    // Existing applyOpeningPack replaces the entire form; no merge from previous talent.
    const legacy = store.save('旧开局包', talentForm());
    expectTalent(applyOpeningPack(legacy)); expect(legacy.settings).not.toHaveProperty('talentId');
  });
});

describe('V10 读取、备份和正式回合 T06、T09–T10', () => {
  it('旧 V10 严格读取、列出、导出与重载，不补天赋、不写回原记录', async () => {
    const factory = new IDBFactory(), name = 'talent-legacy', repo = await SaveRepository.open(name, factory);
    const original = buildCreationState(talentForm(), defaultSettings());
    expect(migrateSave(structuredClone(original))).toEqual(original);
    await repo.create(original);
    try {
      const before = await repo.exportRaw('save-a');
      expect(await repo.load('save-a')).toEqual(original);
      expect((await repo.list())[0].status).toBe('readable');
      expectTalent((await repo.loadGame('save-a')).state.protagonist);
      expect(await repo.exportRaw('save-a')).toEqual(before);
    } finally { repo.close(); }
    const reopened = await SaveRepository.open(name, factory);
    try { expect(await reopened.load('save-a')).toEqual(original); expectTalent((await reopened.load('save-a')).protagonist); }
    finally { reopened.close(); }
  });

  it.each([6, 7, 8, 9])('V%i 仍拒绝迁移，不恢复既有不支持版本', version => {
    expect(() => migrateSave({ ...buildCreationState(talentForm(), defaultSettings()), schemaVersion: version }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
  });

  it.each(variants)('备份导出、导入新仓储、关闭重开：%s', async id => {
    const factory = new IDBFactory(), source = await SaveRepository.open('talent-export', factory);
    const target = await SaveRepository.open('talent-import', factory);
    try {
      await createProfileSave(source, talentForm(id), defaultSettings());
      const original = await source.loadGame('save-a');
      const file = await serializeBackup(await source.exportBackup(['save-a']), 'test');
      const parsed = await parseBackup(file); expect(parsed.checksum).toBe('valid');
      const entry = parsed.entries[0]; if (!entry.ok) throw new Error('Expected readable V10 backup');
      expectTalent(entry.state.protagonist, id);
      const { confirmation } = await target.compareBackup(entry);
      await target.importBackup(entry, confirmation);
      expect((await target.loadGame('save-a')).state).toEqual(original.state);
      // Existing import protection advances draftRevision to invalidate late responses.
      expect((await target.loadGame('save-a')).draft).toEqual({ ...original.draft!, draftRevision: original.draft!.draftRevision + 1 });
      expectTalent((await target.load('save-a')).protagonist, id);
    } finally { source.close(); target.close(); }
    const reopened = await SaveRepository.open('talent-import', factory);
    try { expectTalent((await reopened.load('save-a')).protagonist, id); }
    finally { reopened.close(); }
  });

  it('备份确认包含天赋字段；换掉已确认 ID 必须拒绝且五仓库不变', async () => {
    const factory = new IDBFactory(), source = await SaveRepository.open('talent-source', factory);
    const target = await SaveRepository.open('talent-existing', factory);
    try {
      await createProfileSave(source, talentForm('underworld_aura'), defaultSettings());
      await createProfileSave(target, talentForm('cyber_tyrant'), defaultSettings());
      const [entry] = await source.exportBackup(['save-a']);
      const { confirmation } = await target.compareBackup(entry), before = await target.exportRaw('save-a');
      const replaced = structuredClone(entry); replaced.state.protagonist.talentId = 'golden_edict';
      await expect(target.importBackup(replaced, confirmation, { overwrite: true }))
        .rejects.toMatchObject({ code: 'IMPORT_CONFIRMATION_INVALID' });
      expect(await target.exportRaw('save-a')).toEqual(before);
      const refreshed = await target.compareBackup(entry);
      await target.importBackup(entry, refreshed.confirmation, { overwrite: true });
      expectTalent((await target.load('save-a')).protagonist, 'underworld_aura');
    } finally { source.close(); target.close(); }
  });

  it('玩家明确导入旧无天赋备份时忠实恢复无字段，不保留被替换存档的 ID', async () => {
    const factory = new IDBFactory(), source = await SaveRepository.open('talent-old-backup', factory);
    const target = await SaveRepository.open('talent-local-save', factory);
    try {
      await createProfileSave(source, talentForm(), defaultSettings());
      await createProfileSave(target, talentForm('cyber_tyrant'), defaultSettings());
      const [entry] = await source.exportBackup(['save-a']), compared = await target.compareBackup(entry);
      expect(compared.kind).toBe('overwrite');
      await target.importBackup(entry, compared.confirmation, { overwrite: true });
      expectTalent((await target.load('save-a')).protagonist);
    } finally { source.close(); target.close(); }
  });

  it('损坏备份的未知天赋不能静默清洗成无天赋', async () => {
    const repo = await SaveRepository.open('talent-invalid-backup', new IDBFactory());
    try {
      await createProfileSave(repo, talentForm(), defaultSettings());
      const file = JSON.parse(await serializeBackup(await repo.exportBackup(['save-a']), 'test'));
      file.saves[0].state.protagonist.talentId = 'unknown';
      const before = await repo.exportRaw('save-a'), parsed = await parseBackup(JSON.stringify(file));
      expect(parsed.entries[0].ok).toBe(false);
      await expect(repo.compareBackup(file.saves[0])).rejects.toBeDefined();
      expect(await repo.exportRaw('save-a')).toEqual(before);
    } finally { repo.close(); }
  });

  it.each(variants)('两轮合法 Story/Variables/World 原子结算及撤回保持 %s', async id => {
    const repo = await SaveRepository.open('talent-turns', new IDBFactory());
    try {
      await createProfileSave(repo, talentForm(id), defaultSettings());
      for (let index = 1; index <= 2; index++) {
        const before = await repo.loadGame('save-a');
        if (index > 1) await repo.bindTurnAction(before.draft!, '继续观察', true, true);
        const draft = await completeDraft(repo, { narrative: '经过一分钟，主角继续观察街道，心情平静。', summary: '继续观察街道',
          variables: { commands: [
            { type: 'SetWorldClock', commandId: `time-${index}`, worldClock: new Date(Date.parse(before.state.worldClock) + 60000).toISOString(), evidence: '经过一分钟' },
            { type: 'UpdateProtagonist', commandId: `hero-${index}`, protagonistId: 'protagonist', expectedRevision: before.state.revision, changes: { emotionText: '平静', profession: '观察员', skills: ['观察'] }, evidence: '主角继续观察街道，心情平静' },
          ], rejectedSuggestions: [], unresolved: [] }, world: noWorldChanges });
        const input = { draft, nextAction: '', useVariableStage: true, useWorldStage: true };
        const result = await repo.commitTurn(input);
        expectTalent(result.state.protagonist, id); expect(result.state.turnNumber).toBe(index);
        expect((await repo.commitTurn(input)).replayed).toBe(true);
      }
      const latest = await repo.loadGame('save-a');
      const restored = await repo.undoTurn({ saveId: 'save-a', expectedRevision: latest.state.revision, expectedDraft: latest.draft, operationId: 'undo-talent' });
      expectTalent(restored.state.protagonist, id); expect(restored.state.turnNumber).toBe(1);
    } finally { repo.close(); }
  });
});
