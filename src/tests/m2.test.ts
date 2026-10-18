import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildCreationState,
  cities,
  createProfileSave,
  newCreation,
  professions,
} from '../ui/creation/model';
import { defaultSettings, SettingsSchema, settingsKey } from '../ui/settings/model';
import { playerView, money } from '../ui/panels/playerView';
import { readDocument, writeDocument } from '../services/local/documents';
import { GameStateSchema } from '../domain/state';
import { SpecialNpcSchema } from '../domain/npc/schema';
import { SaveRepository } from '../services/storage/saveRepository';
import { uiFixture } from './fixtures/ui';

function filled() {
  return {
    ...newCreation(),
    person: {
      name: '林舟',
      age: '30',
      gender: '自由填写',
      appearance: '短发',
      personality: '沉稳',
    },
    profession: '教师',
    skills: '教学\n沟通',
    background: '已填写的家庭事实',
    openingPreference: '从日常工作开始',
  };
}
describe('M2 创角资料与真实存档', () => {
  it('16 个职业均有两段正式介绍，且没有新增职业', () => {
    expect(professions).toHaveLength(16);
    expect(new Set(professions.map((p) => p.name)).size).toBe(16);
    expect(professions.every((p) => p.description.length > 10 && p.abilities.length > 10)).toBe(
      true,
    );
  });
  it.each(professions)('$name 资料可以通过 M1 Schema', (profession) => {
    const state = buildCreationState(
      { ...filled(), profession: profession.name },
      defaultSettings(),
    );
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(state.protagonist.profession).toBe(profession.name);
    expect(state.economy.cash).toBeNull();
    expect(state.economy.onlineBalance).toBeNull();
    expect(state.items).toEqual({});
  });
  it.each(cities)('$name 使用真实地点关联，背景及技能不变', (city) => {
    const form = { ...filled(), city: city.id };
    const state = buildCreationState(form, defaultSettings());
    expect(state.locations[state.protagonist.locationId].name).toBe(city.name);
    expect(state.protagonist.background).toBe(form.background);
    expect(state.protagonist.skills).toEqual(['教学', '沟通']);
  });
  it('自定义职业、跳过同伴与空背景合法', () => {
    const state = buildCreationState(
      { ...filled(), profession: 'custom', customProfession: '独立策展人', background: '' },
      defaultSettings(),
    );
    expect(state.protagonist.profession).toBe('独立策展人');
    expect(state.npc).toEqual({});
    expect(state.initialCompanionId).toBeUndefined();
  });
  it('同伴通过特殊 NPC 校验，不自动推定在场或生成资产', () => {
    const form = {
      ...filled(),
      hasCompanion: true,
      companion: {
        name: '陈宁',
        age: '29',
        identity: '记者',
        appearance: '短发',
        personality: '耐心',
        skills: '采访\n写作',
        background: '旧同事',
        relationship: '多年朋友',
      },
    };
    const state = buildCreationState(form, defaultSettings());
    expect(SpecialNpcSchema.safeParse(state.npc.companion).success).toBe(true);
    expect(state.npc.companion.onScene).toBe(false);
    expect(state.initialCompanionId).toBe('companion');
  });
  it('真实 IndexedDB 创建后重开恢复，偏好只在开局草稿，不制造正文', async () => {
    const factory = new IDBFactory();
    let repo = await SaveRepository.open('m2', factory);
    const form = filled();
    try {
      const state = await createProfileSave(repo, form, defaultSettings());
      repo.close();
      repo = await SaveRepository.open('m2', factory);
      expect(await repo.load(form.saveId)).toEqual(state);
      const draft = await repo.loadDraft(form.saveId);
      expect(draft?.userInput).toBe(form.openingPreference);
      expect(draft?.story).toBeUndefined();
      expect(state.journal).toEqual([]);
      expect((await createProfileSave(repo, form, defaultSettings())).saveId).toBe(state.saveId);
      expect(await repo.list()).toHaveLength(1);
    } finally {
      repo.close();
    }
  });
  it('创建正式快照后草稿写入失败，可重试补齐且不重复创建', async () => {
    const repo = await SaveRepository.open('partial-creation', new IDBFactory());
    const form = filled();
    const failure = vi.spyOn(repo, 'saveDraft').mockRejectedValueOnce(new Error('模拟写入失败'));
    try {
      await expect(createProfileSave(repo, form, defaultSettings())).rejects.toThrow('模拟');
      expect(await repo.list()).toHaveLength(1);
      expect(await repo.loadDraft(form.saveId)).toBeUndefined();
      await createProfileSave(repo, form, defaultSettings());
      expect(await repo.list()).toHaveLength(1);
      expect(await repo.loadDraft(form.saveId)).toBeDefined();
    } finally {
      failure.mockRestore();
      repo.close();
    }
  });
});
describe('玩家可见资料投影', () => {
  it('过滤私有记忆、场外计划、未知人物和地点，不把完整内部对象传给面板', () => {
    const visible = playerView(uiFixture());
    const text = JSON.stringify(visible);
    expect(text).not.toContain('不可见');
    expect(text).toContain('已知记忆');
    expect(visible.npc).toHaveLength(1);
    expect(visible.timeline.map((t) => t.title)).toEqual(['更早的公开事件', '公开会面']);
    expect(visible.organizations[0].name).toBe('相关组织');
  });
  it('未知金额不伪装成零，人民币分正确转为元', () => {
    expect(money(null)).toBe('未确认');
    expect(money(12345)).toBe('123.45 元');
    expect(money(0)).toBe('0.00 元');
  });
});
describe('本地设置与填写草稿存储', () => {
  it('设置恰好七个提示词字段，保存恢复全部分类', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    const settings = defaultSettings();
    settings.prompts.perspective = 'first';
    settings.memory.immediateWindowSize = 12;
    settings.runtime.useWorldStage = false;
    expect(Object.keys(settings.prompts)).toHaveLength(7);
    writeDocument(storage, settingsKey, SettingsSchema, settings);
    expect(readDocument(storage, settingsKey, SettingsSchema)).toEqual(settings);
  });
  it('非法设置不写入，损坏或被禁用的存储明确报错', () => {
    const setter = vi.fn();
    expect(() =>
      writeDocument({ setItem: setter }, settingsKey, SettingsSchema, {
        ...defaultSettings(),
        memory: { immediateWindowSize: 0 },
      }),
    ).toThrow();
    expect(setter).not.toHaveBeenCalled();
    expect(() =>
      readDocument({ getItem: () => '{invalid' }, settingsKey, SettingsSchema),
    ).toThrow();
    expect(() =>
      writeDocument(
        {
          setItem: () => {
            throw new Error('禁用存储');
          },
        },
        settingsKey,
        SettingsSchema,
        defaultSettings(),
      ),
    ).toThrow('禁用');
  });
});
