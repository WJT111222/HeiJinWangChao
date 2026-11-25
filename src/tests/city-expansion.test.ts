import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cnCitiesIn, cnCityRegion, cnProvinces, findCnCity, searchCnCities } from '../domain/cities/catalog';
import { cnCitySource } from '../domain/cities/cnCitySource';
import { OpeningCityProfileSchema, cityIntroLength, officialCityForCode, officialCityIds, openingCities, openingCityContext, openingCityIdentity } from '../domain/openingCity';
import { GameStateSchema } from '../domain/state';
import { CreationSchema, buildCreationState, creationCityChoice, creationCityName, newCreation, validateStep } from '../ui/creation/model';
import type { Creation } from '../ui/creation/model';
import { applyOpeningPack, openingSettings } from '../ui/creation/openingPacks';
import { defaultSettings } from '../ui/settings/model';
import { sharedContext } from '../prompts/sharedContext';
import { SaveRepository } from '../services/storage/saveRepository';
import { cityVisual } from '../ui/home/cityVisual';
import { CITY, ORDER, customSkyline, skyline } from '../ui/home/skyline';
import { deriveAtmosphere, locationText } from '../ui/game/atmosphere';
import { AiClient } from '../services/ai/client';
import { completeCreation } from '../services/ai/creationCompletion';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { readPromptResource } from '../prompts/loader';
import { promptManifest } from '../prompts/manifest';

const person = { name: '林舟', age: '30', gender: '男性', appearance: '', personality: '' };
function form(patch: Partial<Creation> = {}): Creation {
  return { ...newCreation(), person, customProfession: '记者', ...patch };
}
const suzhou = { id: 'cn-320500', name: '苏州', region: '江苏' };

describe('行政区划城市目录', () => {
  it('只含直辖市、地级市、县级市；代码唯一，同名靠代码区分', () => {
    const all = cnProvinces().flatMap(cnCitiesIn);
    expect(all.length).toBeGreaterThan(650);
    expect(new Set(all.map(city => city.id)).size).toBe(all.length);
    expect(all.every(city => /^cn-\d{6}$/u.test(city.id) && !/自治|盟$|地区$/u.test(city.name))).toBe(true);
    expect(cnProvinces()).toHaveLength(31);
    expect(cnCitySource.some(([province]) => /香港|澳门|台湾/u.test(province))).toBe(false);
  });
  it('地区文字：直辖市、地级市写省份、县级市带上级', () => {
    expect(cnCityRegion(findCnCity('cn-110000')!)).toBe('直辖市');
    expect(cnCityRegion(findCnCity('cn-320500')!)).toBe('江苏');
    const kunshan = searchCnCities('昆山')[0];
    expect(kunshan).toMatchObject({ level: 2, province: '江苏', parent: '苏州' });
    expect(cnCityRegion(kunshan)).toBe('江苏 · 苏州');
  });
  it('搜索：名字开头优先，其次包含；输入省份名列出该省城市', () => {
    expect(searchCnCities('苏')[0].name).toBe('苏州');
    expect(searchCnCities('江苏').map(city => city.name)).toContain('无锡');
    expect(searchCnCities('江苏省').map(city => city.name)).toContain('无锡');
    expect(searchCnCities('  ')).toEqual([]);
    expect(searchCnCities('不存在的城市')).toEqual([]);
  });
  it('官方八城的代码都在目录里，并能映射回官方身份', () => {
    for (const id of officialCityIds) {
      const city = findCnCity(`cn-${openingCities[id].code}`);
      expect(city?.name, id).toBe(openingCities[id].name);
      expect(officialCityForCode(openingCities[id].code)).toBe(id);
    }
    expect(officialCityForCode('320500')).toBeUndefined();
  });
});

describe('创角写入城市身份', () => {
  it.each(officialCityIds)('官方城市 %s：身份、标题、地点根节点，不写自定义快照', id => {
    const state = buildCreationState(form({ city: id, customCity: suzhou, cityIntro: '不会被写入' }), defaultSettings());
    expect(state.openingCityId).toBe(id);
    expect(state.openingCityProfile).toBeUndefined();
    expect(state.title).toBe(`林舟 · ${openingCities[id].name}`);
    expect(state.locations[id]).toEqual({ id, name: openingCities[id].name, parentId: 'china' });
    expect(state.protagonist.locationId).toBe(id);
  });
  it('自定义城市：身份是区划代码，快照名称、地区与可选介绍，程序建好城市地点', () => {
    const state = buildCreationState(form({ city: 'custom', customCity: suzhou, cityIntro: '  古城水巷与园区并存。  ' }), defaultSettings());
    expect(state.openingCityId).toBe('cn-320500');
    expect(state.openingCityProfile).toEqual({ name: '苏州', region: '江苏', intro: '古城水巷与园区并存。' });
    expect(state.title).toBe('林舟 · 苏州');
    expect(state.locations['cn-320500']).toEqual({ id: 'cn-320500', name: '苏州', parentId: 'china' });
    expect(buildCreationState(form({ city: 'custom', customCity: suzhou, cityIntro: ' ' }), defaultSettings()).openingCityProfile)
      .toEqual({ name: '苏州', region: '江苏' });
  });
  it('未选城市、目录外代码、超长介绍都不能通过第 3 步', () => {
    expect(() => validateStep(form({ city: 'custom' }), 3)).toThrow('请选择一座自定义城市');
    expect(() => validateStep(form({ city: 'custom', customCity: { ...suzhou, id: 'cn-999999' } }), 3)).toThrow('请选择一座自定义城市');
    expect(() => validateStep(form({ city: 'custom', customCity: suzhou, cityIntro: '字'.repeat(401) }), 3)).toThrow('400');
    expect(() => validateStep(form({ city: 'custom', customCity: suzhou, cityIntro: '' }), 3)).not.toThrow();
    expect(creationCityName(form({ city: 'custom' }))).toBe('');
    expect(creationCityName(form({ city: 'sanya' }))).toBe('三亚');
  });
  it('开局包带着自定义城市与介绍往返，套用时不重新生成', () => {
    const settings = openingSettings(form({ step: 5, city: 'custom', customCity: suzhou, cityIntro: '园林与工业园区。' }));
    const applied = applyOpeningPack({ version: 1, id: crypto.randomUUID(), name: '苏州开局', settings });
    expect(applied).toMatchObject({ city: 'custom', customCity: suzhou, cityIntro: '园林与工业园区。' });
    expect(buildCreationState(applied, defaultSettings()).openingCityProfile?.intro).toBe('园林与工业园区。');
  });
});

describe('城市介绍字数口径一致', () => {
  const emoji = '🏙️'.replace('\uFE0F', ''); // 单个码点、两个 UTF-16 单元
  it('统一按去掉首尾空白后的 Unicode 字符计数', () => {
    expect(cityIntroLength(`  ${emoji.repeat(3)}江南  `)).toBe(5);
    expect(emoji.repeat(400).length).toBe(800);
  });
  it('第 3 步、建档与存档字段同一口径：400 个 Emoji 能建档，401 个三处都拒绝', () => {
    const ok = form({ city: 'custom', customCity: suzhou, cityIntro: emoji.repeat(400) });
    expect(() => validateStep(ok, 3)).not.toThrow();
    expect(buildCreationState(ok, defaultSettings()).openingCityProfile?.intro).toBe(emoji.repeat(400));
    expect(OpeningCityProfileSchema.safeParse({ name: '苏州', region: '江苏', intro: emoji.repeat(400) }).success).toBe(true);
    const long = form({ city: 'custom', customCity: suzhou, cityIntro: emoji.repeat(401) });
    expect(() => validateStep(long, 3)).toThrow('400');
    expect(() => buildCreationState(long, defaultSettings())).toThrow('400');
    expect(OpeningCityProfileSchema.safeParse({ name: '苏州', region: '江苏', intro: emoji.repeat(401) }).success).toBe(false);
  });
  it('超长粘贴不影响草稿保存与恢复，只在第 3 步提示', () => {
    const pasted = form({ city: 'custom', customCity: suzhou, cityIntro: '长'.repeat(20000) });
    const restored = CreationSchema.parse(JSON.parse(JSON.stringify(pasted)));
    expect(restored.cityIntro).toHaveLength(20000);
    expect(() => validateStep(restored, 3)).toThrow('400');
    expect(() => validateStep({ ...restored, cityIntro: `  ${'字'.repeat(400)}\n ` }, 3)).not.toThrow();
  });
});

describe('建档以本地城市目录为准', () => {
  it('草稿或开局包里的名称、地区被改过时，按区划代码从目录取', () => {
    const tampered = form({ city: 'custom', customCity: { id: 'cn-320500', name: '伪造城', region: '火星' }, cityIntro: '介绍' });
    expect(creationCityChoice(tampered)).toMatchObject({ id: 'cn-320500', name: '苏州', profile: { name: '苏州', region: '江苏', intro: '介绍' } });
    const state = buildCreationState(tampered, defaultSettings());
    expect(state.title).toBe('林舟 · 苏州');
    expect(state.locations['cn-320500'].name).toBe('苏州');
    expect(creationCityName(tampered)).toBe('苏州');
    const kunshan = buildCreationState(form({ city: 'custom', customCity: { id: searchCnCities('昆山')[0].id, name: '昆山', region: '错的' } }), defaultSettings());
    expect(kunshan.openingCityProfile).toEqual({ name: '昆山', region: '江苏 · 苏州' });
  });
  it('目录里的官方八城映射回官方身份，不写自定义快照', () => {
    for (const id of officialCityIds) {
      const state = buildCreationState(form({ city: 'custom', customCity: { id: `cn-${openingCities[id].code}`, name: '随便', region: '随便' }, cityIntro: '不会写入' }), defaultSettings());
      expect(state.openingCityId, id).toBe(id);
      expect(state.openingCityProfile).toBeUndefined();
      expect(state.locations[id].name).toBe(openingCities[id].name);
    }
  });
  it('开局包带着被改过的名称套用，建档仍以目录为准', () => {
    const settings = openingSettings(form({ step: 5, city: 'custom', customCity: suzhou }));
    const pack = { version: 1 as const, id: crypto.randomUUID(), name: '改过的包', settings: { ...settings, customCity: { id: 'cn-320500', name: '别名', region: '别处' } } };
    expect(buildCreationState(applyOpeningPack(pack), defaultSettings()).openingCityProfile).toEqual({ name: '苏州', region: '江苏' });
  });
});

describe('存档兼容', () => {
  const custom = () => buildCreationState(form({ city: 'custom', customCity: suzhou }), defaultSettings());
  it('自定义快照必须配自定义身份；官方或空身份带快照会被拒绝', () => {
    expect(GameStateSchema.safeParse(custom()).success).toBe(true);
    expect(GameStateSchema.safeParse({ ...custom(), openingCityId: 'chongqing' }).success).toBe(false);
    expect(GameStateSchema.safeParse({ ...custom(), openingCityId: null }).success).toBe(false);
    expect(GameStateSchema.safeParse({ ...custom(), openingCityProfile: { name: '苏州', region: '江苏', extra: 1 } }).success).toBe(false);
  });
  it('身份解析：官方城市取版本内置介绍，自定义城市取快照；缺快照按未知处理', () => {
    expect(openingCityIdentity({ openingCityId: 'hangzhou' })).toMatchObject({ kind: 'official', key: 'hz', name: '杭州', region: '浙江' });
    expect(openingCityIdentity(custom())).toMatchObject({ kind: 'custom', key: 'custom', name: '苏州', seal: '苏', seed: 320500 });
    expect(openingCityIdentity({ openingCityId: 'cn-320500' })).toBeUndefined();
    expect(openingCityIdentity({ openingCityId: null })).toBeUndefined();
  });
  let repo: SaveRepository;
  beforeEach(async () => { repo = await SaveRepository.open('city-expansion', new IDBFactory()); });
  afterEach(() => { repo.close(); vi.restoreAllMocks(); });
  it('存档列表带出城市身份与快照，首页票面按身份显示城市', async () => {
    const created = await repo.create(custom());
    expect((await repo.load(created.saveId)).openingCityProfile).toEqual({ name: '苏州', region: '江苏' });
    const [summary] = await repo.list();
    expect(summary).toMatchObject({ status: 'readable', openingCityId: 'cn-320500', openingCityProfile: { name: '苏州' } });
    expect(cityVisual(summary as never)).toMatchObject({ key: 'custom', name: '苏州', seal: '苏', tint: '#B59A73' });
  });
  it('旧存档只认标题后缀；新身份优先于标题', () => {
    expect(cityVisual({ title: '人物 · 重庆' })?.key).toBe('cq');
    expect(cityVisual({ title: '人物 · 重庆', openingCityId: 'sanya' })?.key).toBe('sy');
    expect(cityVisual({ title: '人物 · 苏州', openingCityId: 'cn-320500' })).toBeUndefined();
  });
});

describe('生成上下文', () => {
  it('OPENING_CITY 只读注入一次；SAVE_STATE 不重复自定义快照', () => {
    const state = buildCreationState(form({ city: 'custom', customCity: suzhou, cityIntro: '古城水巷。' }), defaultSettings());
    const context = sharedContext(state, 10, '', false);
    expect(context.OPENING_CITY).toEqual({ name: '苏州', region: '江苏', source: '玩家自选城市', intro: '古城水巷。' });
    expect(context.SAVE_STATE).not.toHaveProperty('openingCityProfile');
    expect(context.SAVE_STATE.openingCityId).toBe('cn-320500');
  });
  it('官方城市带版本介绍；无身份的旧档不注入', () => {
    const state = buildCreationState(form({ city: 'beijing' }), defaultSettings());
    expect(sharedContext(state, 10, '', false).OPENING_CITY).toEqual({ name: '北京', region: '直辖市', source: '官方城市', intro: openingCities.beijing.intro });
    expect(openingCityContext({ openingCityId: null })).toBeUndefined();
    expect(sharedContext({ ...state, openingCityId: null }, 10, '', false)).not.toHaveProperty('OPENING_CITY');
  });
  it('公共世界书不再限定四城，并说明 OPENING_CITY 只是起点背景', async () => {
    const worldview = await readPromptResource('worldbooks.heijin.worldview');
    expect(worldview).not.toContain('初始城市限定');
    for (const name of ['北京', '杭州', '长沙', '三亚', 'OPENING_CITY', '不是当前所在地']) expect(worldview).toContain(name);
  });
});

describe('城市介绍 AI 补全', () => {
  function setup(reply: string) {
    const map = new Map<string, string>();
    const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
    const vault = new CredentialVault(store, store), config = defaultAiConfig();
    const channel = { ...newChannel('openai'), baseUrl: 'https://creation.mock.invalid/v1', defaultModel: 'story-model' };
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story-model' };
    vault.set(channel.id, 'fixture-city-token');
    const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }));
    return { config, vault, transport };
  }
  const input = { kind: 'city' as const, person: { name: '林舟', age: '30', gender: '男性' }, cityName: '苏州', cityRegion: '江苏', cityIntro: '' };
  it('一次请求，使用城市补全提示词，只发送城市资料，不带人物信息', async () => {
    const { config, vault, transport } = setup('江南水乡与工业园区并存的城市。');
    const result = await completeCreation(input, config, vault, { signal: new AbortController().signal }, new AiClient(transport));
    expect(result).toEqual({ kind: 'city', text: '江南水乡与工业园区并存的城市。' });
    expect(transport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toBe(await readPromptResource('creation.city'));
    expect(JSON.parse(body.messages[1].content)).toEqual({ cityName: '苏州', cityRegion: '江苏', cityIntro: '' });
    expect(promptManifest.modules.find(module => module.id === 'creation.city')).toMatchObject({ activation: 'creation-action', category: 'creation' });
  });
  it('没有城市名不发请求；代码块或 JSON 输出视为无效', async () => {
    const { config, vault, transport } = setup('```\n介绍\n```');
    await expect(completeCreation({ ...input, cityName: ' ' }, config, vault, { signal: new AbortController().signal }, new AiClient(transport))).rejects.toMatchObject({ code: 'configuration' });
    expect(transport).not.toHaveBeenCalled();
    await expect(completeCreation(input, config, vault, { signal: new AbortController().signal }, new AiClient(transport))).rejects.toMatchObject({ code: 'invalid_output' });
  });
});

describe('城市美术', () => {
  it('八座官方城市都有剪影、名称、关键词；顺序原四城在前', () => {
    expect(ORDER).toEqual(['cq', 'sh', 'hrb', 'gz', 'bj', 'hz', 'cs', 'sy']);
    for (const key of ORDER) {
      expect(CITY[key]).toHaveLength(3);
      expect(skyline(key)).toMatch(/^<svg viewBox="0 0 1200 160"/u);
      expect(skyline(key)).not.toMatch(/NaN|undefined|Infinity/u);
    }
  });
  it('自定义城市剪影按代码确定：同城相同、异城不同', () => {
    expect(customSkyline(320500)).toBe(customSkyline(320500));
    expect(customSkyline(320500)).not.toBe(customSkyline(330200));
    expect(customSkyline(110000)).not.toMatch(/NaN|undefined|Infinity/u);
  });
  it('氛围与场景文字识别自定义城市节点', () => {
    const state = buildCreationState(form({ city: 'custom', customCity: suzhou }), defaultSettings());
    expect(deriveAtmosphere(state).city).toBe('custom');
    const locations = { ...state.locations, road: { id: 'road', name: '平江路', parentId: 'cn-320500' } };
    expect(locationText(locations, 'road')).toMatchObject({ name: '平江路', city: '苏州' });
  });
});
