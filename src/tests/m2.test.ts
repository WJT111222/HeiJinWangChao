import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildCreationState,
  CreationSchema,
  selectProfession,
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
import { companionProfileKey, loadCompanionProfile } from '../services/local/companionProfile';

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
function storageFixture() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
function withCompanion() {
  return {
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
}
describe('职业技能来源', () => {
  it.each(professions)('自动填写的技能随职业更新为 $name 默认值', (job) => {
    const teacher = selectProfession(newCreation(), '教师');
    expect(selectProfession(teacher, job.name).skills).toBe(job.abilities);
    expect(selectProfession(teacher, job.name).skillsSource).toBe('automatic');
  });
  it('手动补充、清空或改回默认文案均保留，跨自定义职业及刷新不丢来源', () => {
    const teacher = selectProfession(newCreation(), '教师');
    for (const skills of ['手动填写', '', teacher.skills]) {
      const manual = CreationSchema.parse(
        JSON.parse(JSON.stringify({ ...teacher, skills, skillsSource: 'manual' })),
      );
      expect(selectProfession(selectProfession(manual, 'custom'), '律师').skills).toBe(skills);
    }
    const automatic = selectProfession(selectProfession(teacher, 'custom'), '律师');
    expect(automatic.skills).toBe(professions.find((job) => job.name === '律师')!.abilities);
  });
  it('旧创角草稿仅对未改动的默认技能更新，保留不同的玩家输入', () => {
    const legacy = { ...selectProfession(newCreation(), '教师') };
    delete legacy.skillsSource;
    const restored = CreationSchema.parse(legacy);
    expect(selectProfession(restored, '律师').skills).toBe(
      professions.find((job) => job.name === '律师')!.abilities,
    );
    expect(selectProfession({ ...restored, skills: '玩家旧输入' }, '律师').skills).toBe(
      '玩家旧输入',
    );
  });
});
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
  it('玩家只读查看全量世界资料，不再按主角认知遮蔽', () => {
    const visible = playerView(uiFixture());
    const text = JSON.stringify(visible);
    expect(text).toContain('不可见');
    expect(text).toContain('已知记忆');
    expect(visible.npc).toHaveLength(2);
    expect(visible.timeline.map((t) => t.title)).toEqual(['更早的公开事件', '公开会面']);
    expect(visible.organizations[0].name).toBe('相关组织');
  });
  it('玩家可查看NPC身份与关系，不依赖在场、互动或正文引用', () => {
    const state = uiFixture();
    const person = state.npc['npc-a'];
    person.lastInteractionAt = state.worldClock;
    person.affinity = 87;
    state.journal[0].relatedActorRefs = [{ kind: 'npc', id: person.id }];
    const visible = playerView(state);
    expect(visible.npc[0]).toMatchObject({
      identity: person.identity,
      relationshipText: person.relationshipText,
      affinity: 87,
    });
    expect(JSON.stringify(visible)).toContain('内部身份');
    expect(JSON.stringify(visible)).toContain('内部关系');
    person.onScene = false;
    expect(playerView(state).npc[0].identity).toBe(person.identity);
  });
  it('全量组织关系与事件预计时间均可查看', () => {
    const state = uiFixture();
    const visible = playerView(state);
    expect(visible.organizations[0].protagonistRelation).toBe(state.organizations['org-a'].protagonistRelation);
    expect(visible.events).toEqual(Object.values(state.events));
    expect(JSON.stringify(visible)).toContain('2099-12-31');
    expect(JSON.stringify(visible)).toContain('组织内部关系');
  });
  it('玩家阅读无需借公开记忆解锁关联资料，不改动正式数据', () => {
    const state = uiFixture();
    state.memories.short[0].affectedEntityRefs = [
      { kind: 'npc', id: 'npc-a' },
      { kind: 'organization', id: 'org-a' },
    ];
    const visible = playerView(state);
    expect(visible.memories.some((memory) => memory.text === '已知记忆：一次公开会面')).toBe(true);
    expect(visible.npc[0].identity).toBe(state.npc['npc-a'].identity);
    expect(JSON.stringify(visible)).toContain('不可见');
  });
  it('初始同伴创角资料跨回合、刷新及内部变化仍可见，占位好感不变成已确认值', async () => {
    const storage = storageFixture();
    const repo = await SaveRepository.open('companion-profile', new IDBFactory());
    try {
      const state = await createProfileSave(repo, withCompanion(), defaultSettings(), storage);
      const initial = loadCompanionProfile(storage, state)!;
      expect(initial).toBeDefined();
      const later = structuredClone(state);
      // 本用例手工建立已提交历史夹具；时间也须从待定转为已确定。
      delete later.openingTimePending;
      later.worldClock = '2026-10-18T08:00:00+08:00';
      later.turnNumber = 3;
      later.revision = 3;
      later.journal = [1, 2, 3].map((revision) => ({
        turnId: `test-turn-${revision}`,
        revision,
        story: {
          turnKind: 'regular' as const,
          narrative: '隔离测试正文',
          summary: '',
          variableGuide: [],
        },
        relatedActorRefs: [],
      }));
      expect(GameStateSchema.safeParse(later).success).toBe(true);
      Object.assign(later.npc.companion, {
        identity: '后续私有身份不可见',
        relationshipText: '后续私有关系不可见',
        background: '后续私有背景不可见',
        affinity: 99,
      });
      const restored = loadCompanionProfile(storage, later)!;
      expect(restored).toEqual(initial);
      const visible = playerView(later, restored);
      expect(visible.npc[0]).toMatchObject({
        identity: '后续私有身份不可见',
        relationshipText: '后续私有关系不可见',
        authoredProfile: expect.objectContaining({ identity: '记者', relationshipText: '多年朋友' }),
        affinity: null,
        profile: {
          age: 29,
          appearance: '短发',
          temperament: '耐心',
          skills: ['采访', '写作'],
          background: '旧同事',
        },
      });
      expect(JSON.stringify(visible)).toContain('不可见');
      expect(await repo.load(state.saveId)).toEqual(state);
    } finally {
      repo.close();
    }
  });
  it('旧存档仅在未提交的创角状态回填档案；缺失来源、串档及损坏数据保守隐藏', () => {
    const state = buildCreationState(withCompanion(), defaultSettings());
    const storage = storageFixture();
    const profile = loadCompanionProfile(storage, state)!;
    const later = { ...state, turnNumber: 2, revision: 2 };
    expect(loadCompanionProfile(storageFixture(), later)).toBeUndefined();
    expect(playerView(later).npc[0].profile).toBeUndefined();
    expect(
      playerView(later, { ...profile, saveId: 'another-save' }).npc[0].profile,
    ).toBeUndefined();
    expect(
      playerView(later, { ...profile, identityKey: 'another-person' }).npc[0].authoredProfile,
    ).toBeUndefined();
    storage.setItem(companionProfileKey(state.saveId), '{invalid');
    expect(() => loadCompanionProfile(storage, later)).toThrow();
    expect(storage.getItem(companionProfileKey(state.saveId))).toBe('{invalid');
  });
  it('创角公开档案写入失败可重试，不重复建档或改写正式状态', async () => {
    const repo = await SaveRepository.open('companion-profile-failure', new IDBFactory());
    const form = withCompanion();
    const storage = storageFixture();
    const failure = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw new Error('档案写入失败');
    });
    try {
      await expect(createProfileSave(repo, form, defaultSettings(), storage)).rejects.toThrow(
        '档案写入失败',
      );
      const before = await repo.load(form.saveId);
      await createProfileSave(repo, form, defaultSettings(), storage);
      expect(await repo.list()).toHaveLength(1);
      expect(await repo.load(form.saveId)).toEqual(before);
      expect(loadCompanionProfile(storage, before)?.profile.background).toBe('旧同事');
    } finally {
      failure.mockRestore();
      repo.close();
    }
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
