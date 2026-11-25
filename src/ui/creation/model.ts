import { z } from 'zod';
import { pendingOpeningClock } from '../../domain/openingTime';
import { IdSchema, GameTimeSchema, requireData, DataError } from '../../domain/common';
import { createGameState, GameStateSchema } from '../../domain/state';
import { SpecialNpcSchema } from '../../domain/npc/schema';
import { TalentIdSchema } from '../../domain/protagonist/talents';
import { createTurnDraft } from '../../domain/drafts';
import { fingerprint } from '../../domain/commands';
import { SaveRepository } from '../../services/storage/saveRepository';
import type { Settings } from '../settings/model';
import professions from './professions.json';
import { loadCompanionProfile } from '../../services/local/companionProfile';
import { cityIntroTooLong, officialCityForCode, officialCityIds, openingCities, openingCityIntroLimit } from '../../domain/openingCity';
import type { OfficialCityId } from '../../domain/openingCity';
import { cnCityRegion, customCityIdPattern, findCnCity } from '../../domain/cities/catalog';

export { professions };
export const professionCategories = [...new Set(professions.map((job) => job.category))];
/** 创角城市卡：官方八城沿用存档身份（重庆、上海、哈尔滨、广州在前，新四城在后）。介绍来自领域配置。 */
export const cities = officialCityIds.map(id => ({ id, name: openingCities[id].name, label: openingCities[id].label, description: openingCities[id].intro }));
export type CreationCityId = OfficialCityId | 'custom';
/** 自定义城市：身份来自本地行政区划目录（cn-六位代码），存显示名与地区，供离线显示与存档快照。 */
const CustomCityChoiceSchema = z.strictObject({
  id: z.string().regex(customCityIdPattern), name: z.string().trim().min(1).max(20), region: z.string().trim().min(1).max(40),
});
export type CustomCityChoice = z.infer<typeof CustomCityChoiceSchema>;
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
  talentId: TalentIdSchema.optional(),
  skillsSource: z.enum(['automatic', 'manual']).optional(),
  appearanceTemplate: z.string().optional(),
  personalityTemplate: z.string().optional(),
  professionCategory: z.string().optional(),
  professionDescription: z.string().optional(),
  professionLongTermImpact: z.string().optional(),
  customProfile: z.strictObject({
    name: z.string(), description: z.string(), skills: z.string(), longTermImpact: z.string(),
  }).optional(),
  city: z.enum(['chongqing', 'shanghai', 'harbin', 'guangzhou', 'beijing', 'hangzhou', 'changsha', 'sanya', 'custom']),
  customCity: CustomCityChoiceSchema.optional(),
  /** 自定义城市的可选介绍（玩家手填或 AI 补全）；官方城市不使用。草稿不设上限，超长只在第 3 步提示，避免草稿存不下。 */
  cityIntro: z.string().optional(),
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
    profession: 'custom',
    appearanceTemplate: 'custom',
    personalityTemplate: 'custom',
    professionDescription: '',
    professionLongTermImpact: '',
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
export function professionProfile(form: Creation) {
  const preset = professions.find((job) => job.name === form.profession);
  return {
    name: professionName(form),
    description: preset?.description ?? form.professionDescription ?? '',
    skills: lines(form.skills),
    longTermImpact: preset?.longTermImpact ?? form.professionLongTermImpact ?? '',
  };
}
export function selectProfession(form: Creation, profession: string): Creation {
  if (form.profession === profession) return form;
  const previous = professions.find((job) => job.name === form.profession);
  const job = professions.find((job) => job.name === profession);
  const customProfile = form.profession === 'custom'
    ? { name: form.customProfession, description: form.professionDescription ?? '',
        skills: form.skills, longTermImpact: form.professionLongTermImpact ?? '' }
    : form.customProfile;
  if (profession === 'custom') return {
    ...form, profession, customProfile, customProfession: customProfile?.name ?? '',
    professionDescription: customProfile?.description ?? '',
    professionLongTermImpact: customProfile?.longTermImpact ?? '',
    skills: customProfile?.skills ?? '', skillsSource: 'manual',
  };
  const manual = form.skillsSource === 'manual' ||
    (form.skillsSource === undefined && form.skills !== '' && form.skills !== previous?.skills.join('\n'));
  return { ...form, profession, customProfile, professionCategory: job?.category,
    // 自由选择与预设各保留自己的技能；预设间保留玩家手工修改。
    skills: form.profession !== 'custom' && manual ? form.skills : job?.skills.join('\n') ?? '',
    skillsSource: form.profession !== 'custom' && manual ? 'manual' : 'automatic',
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
      form.person.name.trim() && ['男性', '女性'].includes(form.person.gender),
      'PROFILE',
      '请填写姓名并选择男性或女性',
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
  if (step === 3 && form.city === 'custom') {
    requireData(creationCustomCity(form), 'CITY', '请选择一座自定义城市');
    requireData(!cityIntroTooLong(form.cityIntro ?? ''), 'CITY', `城市介绍请控制在 ${openingCityIntroLimit} 字以内`);
  }
  if (step === 4 && form.hasCompanion) {
    requireData(
      form.companion.name.trim() && form.companion.relationship.trim(),
      'COMPANION',
      '请填写同伴姓名及与主角的关系',
    );
    if (form.companion.age.trim()) age(form.companion.age);
  }
}
/** 草稿里的自定义城市以本地目录为准：只认区划代码，名称与地区从目录取，不信任草稿或开局包里存的文字。 */
export function creationCustomCity(form: Pick<Creation, 'customCity'>) {
  const known = form.customCity && findCnCity(form.customCity.id);
  return known && { id: known.id, code: known.code, name: known.name, region: cnCityRegion(known) };
}
/** 创角选定城市的存档身份与名称。自定义城市只接受本地目录中的有效代码；目录里的官方八城映射回官方身份，不写自定义快照。 */
export function creationCityChoice(form: Pick<Creation, 'city' | 'customCity' | 'cityIntro'>) {
  if (form.city !== 'custom') return { id: form.city as string, name: openingCities[form.city].name, profile: undefined };
  const known = creationCustomCity(form);
  requireData(known, 'CITY', '请选择一座自定义城市');
  const official = officialCityForCode(known.code);
  if (official) return { id: official as string, name: openingCities[official].name, profile: undefined };
  const intro = form.cityIntro?.trim();
  requireData(!intro || !cityIntroTooLong(intro), 'CITY', `城市介绍请控制在 ${openingCityIntroLimit} 字以内`);
  return { id: known.id, name: known.name, profile: { name: known.name, region: known.region, ...(intro ? { intro } : {}) } };
}
/** 创角各处显示用的城市名；自定义城市按目录取名，未选定时为空。 */
export const creationCityName = (form: Pick<Creation, 'city' | 'customCity'>) =>
  form.city === 'custom' ? creationCustomCity(form)?.name ?? '' : openingCities[form.city].name;
export function buildCreationState(form: Creation, settings: Settings) {
  for (let i = 1; i <= 4; i++) validateStep(form, i);
  const city = creationCityChoice(form);
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
    openingCityId: city.id,
    ...(city.profile ? { openingCityProfile: city.profile } : {}),
    worldClock: form.worldClock,
    protagonist: {
      id: 'protagonist',
      name: form.person.name,
      age: age(form.person.age),
      gender: form.person.gender,
      appearance: form.person.appearance,
      personality: form.person.personality,
      profession: professionName(form),
      professionDescription: professionProfile(form).description,
      professionLongTermImpact: professionProfile(form).longTermImpact,
      skills: professionProfile(form).skills,
      ...(form.talentId !== undefined ? { talentId: form.talentId } : {}),
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
    openingInitializationPending: true,
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
