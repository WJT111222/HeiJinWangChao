import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { OpeningPackStore, OpeningPackSchema, openingPackPrefix, openingSettings, applyOpeningPack } from '../ui/creation/openingPacks';
import { newCreation, selectProfession, CreationSchema, creationKey, createProfileSave } from '../ui/creation/model';
import { CreationWizard } from '../ui/creation/CreationWizard';
import { readDocument, writeDocument } from '../services/local/documents';
import { SaveRepository } from '../services/storage/saveRepository';
import { defaultSettings } from '../ui/settings/model';

export function packForm() {
  const form = newCreation();
  Object.assign(form, {
    step: 5, appearanceTemplate: '干净利落', personalityTemplate: '温和内敛',
    person: { name: '林岚', age: '29', gender: '女性', appearance: '  外貌首行\n衣着素净。  ', personality: '认真\n偶尔冲动' },
    customProfession: '旧书修复师', professionDescription: '  修复纸本\n保存档案。  ',
    professionLongTermImpact: '与社区合作\n保持独立', skills: '修复\n\n  手写记录  \n技能末行', skillsSource: 'manual',
    professionCategory: '技术与生产', city: 'shanghai',
    background: '  成长经历\n' + '家庭、求学、工作与生活。\n'.repeat(1800) + '背景末行  ',
    openingPreference: '  2008年秋天\n' + '从普通的一天开始，不改写已有家庭设定。\n'.repeat(1200) + '偏好末行  ',
    hasCompanion: true, companion: {
      name: '许宁', age: '28', identity: '同事', appearance: '短发', personality: '直率',
      skills: '排版\n沟通', background: '少年在外地读书。\n后来回城。', relationship: '相识多年的朋友',
    },
  });
  return CreationSchema.parse(form);
}
export class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
describe('开局包独立本地文档', () => {
  it('完整表单、长文本与全部同伴字段无损恢复，时钟/存档身份重建且直达第五步', () => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), form = packForm();
    form.worldClock = '2001-01-01T00:00:00+08:00'; delete form.openingTimePending;
    const pack = store.save('城市生活', form);
    expect(Object.keys(pack.settings).sort()).toEqual(Object.keys(form).filter(key =>
      !['version', 'saveId', 'worldClock', 'openingTimePending', 'step'].includes(key)).sort());
    const loaded = store.list().packs[0];
    expect(loaded).toEqual(pack);
    const first = applyOpeningPack(loaded), second = applyOpeningPack(loaded);
    expect(openingSettings(first)).toEqual(openingSettings(form));
    expect(first.background).toBe(form.background); expect(first.openingPreference).toBe(form.openingPreference);
    expect(first.companion).toEqual(form.companion); expect(first.step).toBe(5);
    expect(new Set([form.saveId, first.saveId, second.saveId]).size).toBe(3);
    expect(first.worldClock).toBe(newCreation().worldClock); expect(first.openingTimePending).toBe(true);
    expect(storage.getItem(creationKey)).toBeNull();
  });
  it('职业切换缓存、手动技能和模板恢复；修改套用结果不会反写开局包', () => {
    const store = new OpeningPackStore(new MemoryStorage());
    let form = selectProfession(packForm(), '程序员');
    form = { ...form, skills: '玩家编辑\n另一技能', skillsSource: 'manual' };
    const pack = store.save('技能', form), applied = applyOpeningPack(pack);
    expect(applied).toMatchObject({ skills: form.skills, skillsSource: 'manual', customProfile: form.customProfile });
    expect(selectProfession(applied, 'custom').skills).toBe(packForm().skills);
    applied.person.name = '新名字'; applied.companion.name = '新同伴'; applied.customProfile!.skills = '新技能';
    expect(store.list().packs[0]).toEqual(pack);
    expect(pack.settings.person.name).toBe('林岚');
  });
  it('自动技能状态也原样保留', () => {
    const store = new OpeningPackStore(new MemoryStorage());
    const form = selectProfession(packForm(), '教师');
    expect(applyOpeningPack(store.save('预设', form)).skillsSource).toBe('automatic');
  });
  it('同名包独立，重命名不合并，删除和显式覆盖只影响选定ID', () => {
    const store = new OpeningPackStore(new MemoryStorage());
    const a = store.save('同名', packForm()), b = store.save('同名', packForm());
    expect(a.id).not.toBe(b.id); store.rename(a.id, '重命名');
    const replacement = { ...packForm(), background: '新背景' };
    expect(store.save('覆盖后', replacement, a.id).id).toBe(a.id);
    expect(store.list().packs).toEqual([expect.objectContaining({ id: a.id, name: '覆盖后', settings: expect.objectContaining({ background: '新背景' }) }), b]);
    store.delete(a.id); expect(store.list().packs).toEqual([b]);
    expect(() => store.save('失效覆盖', replacement, a.id)).toThrow();
    expect(store.list().packs).toEqual([b]);
  });
  it('损坏、身份不符、未知版本及不合法表单隔离读取，不清除有效包或原始记录', () => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), good = store.save('有效', packForm());
    storage.setItem(openingPackPrefix + 'broken', '{');
    storage.setItem(openingPackPrefix + crypto.randomUUID(), JSON.stringify(good));
    for (const patch of [{ version: 2 }, { settings: { ...good.settings, person: { ...good.settings.person, age: '-1' } } }]) {
      const id = crypto.randomUUID(); storage.setItem(openingPackPrefix + id, JSON.stringify({ ...good, id, ...patch }));
    }
    const before = [...storage.data];
    expect(store.list()).toEqual({ packs: [good], invalidCount: 4 }); expect([...storage.data]).toEqual(before);
  });
  it.each(['person', 'profession', 'companion'] as const)('不允许保存未满足已有%s校验的表单', field => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), form = packForm();
    if (field === 'person') form.person.age = '-1';
    if (field === 'profession') form.customProfession = '';
    if (field === 'companion') form.companion.relationship = '';
    expect(() => store.save('无效', form)).toThrow(); expect(storage.length).toBe(0);
  });
  it('拒绝非创角字段、空名称及错误结构，不把API配置放进包', () => {
    const store = new OpeningPackStore(new MemoryStorage()), form = packForm();
    expect(() => store.save('   ', form)).toThrow();
    expect(() => openingSettings({ ...form, apiKey: 'not-a-real-key' } as typeof form)).toThrow();
    const good = store.save('有效', form);
    expect(() => OpeningPackSchema.parse({ ...good, settings: { ...good.settings, saveId: form.saveId } })).toThrow();
    expect(() => applyOpeningPack({ ...good, settings: { ...good.settings, person: { ...good.settings.person, name: '' } } })).toThrow();
  });
  it('读写和删除失败明确抛出，已有包、草稿和其他本地文档保持原样', () => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), good = store.save('有效', packForm());
    storage.setItem('settings', 'private'); writeDocument(storage, creationKey, CreationSchema, packForm());
    const before = [...storage.data];
    const denied = () => { throw new Error('storage denied'); };
    expect(() => new OpeningPackStore({ ...storage, get length() { return storage.length; }, key: storage.key.bind(storage), getItem: denied, setItem: denied, removeItem: denied }).list()).toThrow('storage denied');
    const limited = new OpeningPackStore({ get length() { return storage.length; }, key: storage.key.bind(storage), getItem: storage.getItem.bind(storage), setItem: denied, removeItem: denied });
    expect(() => limited.save('新包', packForm())).toThrow('storage denied');
    expect(() => limited.save('覆盖', packForm(), good.id)).toThrow('storage denied');
    expect(() => limited.rename(good.id, '新名')).toThrow('storage denied');
    expect(() => limited.delete(good.id)).toThrow('storage denied');
    expect([...storage.data]).toEqual(before);
  });
  it('套用继续使用独立草稿文档，只有原建档入口才写入正式IndexedDB', async () => {
    const storage = new MemoryStorage(), store = new OpeningPackStore(storage), pack = store.save('开局', packForm());
    const factory = new IDBFactory(), repo = await SaveRepository.open('opening-packs', factory);
    try {
      const form = applyOpeningPack(pack);
      writeDocument(storage, creationKey, CreationSchema, form);
      const refreshed = readDocument(storage, creationKey, CreationSchema)!;
      expect(refreshed).toEqual(form); expect(await repo.list()).toEqual([]);
      await createProfileSave(repo, refreshed, defaultSettings());
      const saved = await repo.load(form.saveId);
      expect(saved.protagonist.background).toBe(form.background);
      expect(saved.npc.companion.background).toBe(form.companion.background);
      expect((await repo.loadDraft(form.saveId))?.userInput).toBe(form.openingPreference);
      expect(store.list().packs).toEqual([pack]);
    } finally { repo.close(); }
  });
  it('第五步核对保留长文本、自定义缓存和全部同伴字段', () => {
    const form = selectProfession(packForm(), '程序员');
    const html = renderToStaticMarkup(<CreationWizard form={form} onChange={() => {}} onCreate={() => {}} onExit={() => {}} busy={false} />);
    for (const text of [form.background, form.openingPreference, form.skills, ...Object.values(form.companion), ...Object.values(form.customProfile!)]) expect(html).toContain(text);
    expect(html).toContain('保存为开局包');
  });
});
