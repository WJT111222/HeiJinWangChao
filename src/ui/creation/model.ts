import { z } from 'zod';
import { pendingOpeningClock } from '../../domain/openingTime';
import { IdSchema, GameTimeSchema, requireData, DataError } from '../../domain/common';
import { createGameState, GameStateSchema } from '../../domain/state';
import { SpecialNpcSchema } from '../../domain/npc/schema';
import { createTurnDraft } from '../../domain/drafts';
import { fingerprint } from '../../domain/commands';
import { SaveRepository } from '../../services/storage/saveRepository';
import type { Settings } from '../settings/model';
import professions from './professions.json';
import { loadCompanionProfile } from '../../services/local/companionProfile';

export { professions };
export const cities = [
  {
    id: 'chongqing',
    name: '重庆',
    label: '山城 · 江岸与街巷',
    description:
      '长江与嘉陵江交汇，山地街区、跨江交通与立体城市空间交织。制造业、商贸与社区生活相邻，出行距离不能只看地图上的直线。',
  },
  {
    id: 'shanghai',
    name: '上海',
    label: '海派 · 街区与都市',
    description:
      '金融、航运与专业服务汇集，老街区和新商务区共存。轨道交通连接广阔城区，住房、通勤与职场节奏构成日常生活的重要背景。',
  },
  {
    id: 'harbin',
    name: '哈尔滨',
    label: '北国 · 工业与生活',
    description:
      '松花江畔的东北城市，拥有工业和高校基础，街区建筑保留多重历史痕迹。四季温差明显，冬季气候会实际影响出行与工作安排。',
  },
  {
    id: 'guangzhou',
    name: '广州',
    label: '岭南 · 商贸与人情',
    description:
      '珠江沿岸的商贸中心，制造业、专业市场与现代服务业联系紧密。老城街巷、城中村和新城并存，粤语文化与多元迁入人口共同塑造城市生活。',
  },
] as const;
const PersonFormSchema = z.strictObject({
  name: z.string(),
  age: z.string(),
  gender: z.string(),
  appearance: z.string(),
  personality: z.string(),
});
export const CreationSchema = z.strictObject({
  version: z.literal(1),
  saveId: IdSchema,
  worldClock: GameTimeSchema,
  openingTimePending: z.literal(true).optional(),
  step: z.number().int().min(1).max(5),
  person: PersonFormSchema,
  profession: z.string(),
  customProfession: z.string(),
  skills: z.string(),
  skillsSource: z.enum(['automatic', 'manual']).optional(),
  city: z.enum(['chongqing', 'shanghai', 'harbin', 'guangzhou']),
  background: z.string(),
  hasCompanion: z.boolean(),
  companion: z.strictObject({
    name: z.string(),
    age: z.string(),
    identity: z.string(),
    appearance: z.string(),
    personality: z.string(),
    skills: z.string(),
    background: z.string(),
    relationship: z.string(),
  }),
  openingPreference: z.string(),
});
export type Creation = z.infer<typeof CreationSchema>;
export const creationKey = 'heijin.creation.v1';
export function newCreation(): Creation {
  return {
    version: 1,
    saveId: crypto.randomUUID(),
    worldClock: pendingOpeningClock,
    openingTimePending: true,
    step: 1,
    person: { name: '', age: '', gender: '', appearance: '', personality: '' },
    profession: '',
    customProfession: '',
    skills: '',
    skillsSource: 'automatic',
    city: 'chongqing',
    background: '',
    hasCompanion: false,
    companion: {
      name: '',
      age: '',
      identity: '',
      appearance: '',
      personality: '',
      skills: '',
      background: '',
      relationship: '',
    },
    openingPreference: '',
  };
}
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
export function professionName(form: Creation) {
  return form.profession === 'custom' ? form.customProfession.trim() : form.profession;
}
// 兼容旧 UI 草稿：仅空值或与原职业默认文案完全一致时视作自动填写。
export function selectProfession(form: Creation, profession: string): Creation {
  const previous = professions.find((job) => job.name === form.profession)?.abilities ?? '';
  const automatic =
    form.skillsSource === 'automatic'
      ? form.skills === previous
      : form.skillsSource !== 'manual' && (form.skills === '' || form.skills === previous);
  return {
    ...form,
    profession,
    skills: automatic
      ? (professions.find((job) => job.name === profession)?.abilities ?? '')
      : form.skills,
    skillsSource: automatic ? 'automatic' : 'manual',
  };
}
function age(value: string) {
  requireData(
    /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)),
    'AGE',
    '年龄请填写非负整数',
  );
  return Number(value);
}
export function validateStep(form: Creation, step = form.step) {
  if (step === 1) {
    requireData(
      form.person.name.trim() && form.person.gender.trim(),
      'PROFILE',
      '请填写姓名和性别',
    );
    age(form.person.age);
  }
  if (step === 2)
    requireData(
      (form.profession === 'custom' && form.customProfession.trim()) ||
        professions.some((p) => p.name === form.profession),
      'PROFESSION',
      '请选择职业或填写自定义职业',
    );
  if (step === 4 && form.hasCompanion) {
    requireData(
      form.companion.name.trim() && form.companion.relationship.trim(),
      'COMPANION',
      '请填写同伴姓名及与主角的关系',
    );
    if (form.companion.age.trim()) age(form.companion.age);
  }
}
export function buildCreationState(form: Creation, settings: Settings) {
  for (let i = 1; i <= 4; i++) validateStep(form, i);
  const city = cities.find((c) => c.id === form.city)!;
  const companion = form.hasCompanion
    ? SpecialNpcSchema.parse({
        id: 'companion',
        identityKey: `${form.saveId}:initial-companion`,
        kind: 'special',
        name: form.companion.name,
        age: form.companion.age.trim() ? age(form.companion.age) : undefined,
        identity: form.companion.identity,
        appearance: form.companion.appearance,
        temperament: form.companion.personality,
        background: form.companion.background,
        detailedBackground: form.companion.background,
        skills: lines(form.companion.skills),
        relationshipText: form.companion.relationship,
        affinity: 0,
        onScene: false,
        aliases: [],
        memories: [],
        knownInformation: [],
        activeGoals: [],
        habits: [],
        longTermMemories: [],
        offscreenTaskIds: [],
      })
    : undefined;
  const state = createGameState({
    saveId: form.saveId,
    title: `${form.person.name.trim()} · ${city.name}`,
    worldClock: form.worldClock,
    protagonist: {
      id: 'protagonist',
      name: form.person.name,
      age: age(form.person.age),
      gender: form.person.gender,
      appearance: form.person.appearance,
      personality: form.person.personality,
      profession: professionName(form),
      skills: lines(form.skills),
      background: form.background,
      healthText: '',
      emotionText: '',
      locationId: city.id,
      currentWear: { accessoryItemIds: [] },
    },
    locations: {
      china: { id: 'china', name: '中国' },
      [city.id]: { id: city.id, name: city.name, parentId: 'china' },
    },
    companion,
  });
  return GameStateSchema.parse({
    ...state,
    ...(form.openingTimePending ? { openingTimePending: true } : {}),
    memories: { ...state.memories, immediateWindowSize: settings.memory.immediateWindowSize },
  });
}

export async function createProfileSave(
  repository: SaveRepository,
  form: Creation,
  settings: Settings,
  profileStorage?: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const expected = buildCreationState(form, settings);
  let state;
  try {
    state = await repository.create(expected);
  } catch (error) {
    // 同一创角草稿重试只补齐开局草稿，不重复建档，也不覆盖已存在的状态。
    if (!(error instanceof DataError) || error.code !== 'DUPLICATE_SAVE') throw error;
    state = await repository.load(form.saveId);
    requireData(
      fingerprint({ ...state, createdAt: '', updatedAt: '' }) ===
        fingerprint({ ...expected, createdAt: '', updatedAt: '' }),
      'CREATION_CONFLICT',
      '存档已存在且资料不同，请从首页读取',
    );
  }
  // UI 创角档案写入失败时保留表单，重试沿用同一正式存档。
  if (profileStorage) loadCompanionProfile(profileStorage, state);
  const existing = await repository.loadDraft(form.saveId);
  if (!existing)
    await repository.saveDraft(
      createTurnDraft(
        form.saveId,
        state.revision,
        `opening-${form.saveId}`,
        'opening',
        form.openingPreference,
        settings.runtime.useVariableStage,
        settings.runtime.useWorldStage,
      ),
      null,
    );
  return state;
}
