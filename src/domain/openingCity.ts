import { z } from 'zod';
import type { GameState } from './state';
import { customCityIdPattern } from './cities/catalog';

/**
 * 官方开局城市。键是存档身份（openingCityId），key 是美术资源键；二者都不能改名。
 * code 是统计用区划代码，用于把自定义城市目录里的同一座城市映射回官方身份。
 * intro 是官方城市介绍，随版本提供，进入生成上下文；不写进存档。
 */
export const openingCities = {
  chongqing: { key: 'cq', name: '重庆', english: 'CHONGQING · 山城', code: '500000', region: '直辖市', label: '山城 · 江岸与街巷',
    intro: '长江与嘉陵江交汇，山地街区、跨江交通与立体城市空间交织。制造业、商贸与社区生活相邻，出行距离不能只看地图上的直线。' },
  shanghai: { key: 'sh', name: '上海', english: 'SHANGHAI · 魔都', code: '310000', region: '直辖市', label: '海派 · 街区与都市',
    intro: '金融、航运与专业服务汇集，老街区和新商务区共存。轨道交通连接广阔城区，住房、通勤与职场节奏构成日常生活的重要背景。' },
  harbin: { key: 'hrb', name: '哈尔滨', english: 'HARBIN · 冰城', code: '230100', region: '黑龙江', label: '北国 · 工业与生活',
    intro: '松花江畔的东北城市，拥有工业和高校基础，街区建筑保留多重历史痕迹。四季温差明显，冬季气候会实际影响出行与工作安排。' },
  guangzhou: { key: 'gz', name: '广州', english: 'GUANGZHOU · 羊城', code: '440100', region: '广东', label: '岭南 · 商贸与人情',
    intro: '珠江沿岸的商贸中心，制造业、专业市场与现代服务业联系紧密。老城街巷、城中村和新城并存，粤语文化与多元迁入人口共同塑造城市生活。' },
  beijing: { key: 'bj', name: '北京', english: 'BEIJING · 京城', code: '110000', region: '直辖市', label: '京城 · 胡同与长街',
    intro: '环路层层展开，胡同院落和高楼商务区相隔不远。机关、高校、科研与各类企业汇聚，通勤距离和住房条件深刻影响日常节奏。' },
  hangzhou: { key: 'hz', name: '杭州', english: 'HANGZHOU · 钱塘', code: '330100', region: '浙江', label: '江南 · 湖山与新城',
    intro: '西湖与钱塘江之间，老街巷、茶山和新兴产业园区相邻。电商、科技与旅游服务业活跃，烟雨时节的湖光山色是城市生活的底色。' },
  changsha: { key: 'cs', name: '长沙', english: 'CHANGSHA · 星城', code: '430100', region: '湖南', label: '湘楚 · 江洲与夜市',
    intro: '湘江穿城，岳麓山与橘子洲隔江相望。传媒娱乐、餐饮夜宵和制造业并行，大学周边与老街区的年轻人让城市入夜后依旧热闹。' },
  sanya: { key: 'sy', name: '三亚', english: 'SANYA · 鹿城', code: '460200', region: '海南', label: '海岛 · 椰风与旺季',
    intro: '海南岛最南端的滨海城市，海湾、酒店带与本地社区相隔不远。旅游旺季带来大量季节性工作和旅居人口，淡季时城市节奏慢下来。' },
} as const;
export type OfficialCityId = keyof typeof openingCities;
export const officialCityIds = Object.keys(openingCities) as OfficialCityId[];
export type OfficialCityKey = (typeof openingCities)[OfficialCityId]['key'];

/** 自定义开局城市的存档快照。身份在 openingCityId（cn-六位代码），这里只存显示与可选介绍。 */
export const openingCityIntroLimit = 400;
export const OpeningCityProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(20),
  region: z.string().trim().min(1).max(40),
  intro: z.string().trim().min(1).max(openingCityIntroLimit).optional(),
});
export type OpeningCityProfile = z.infer<typeof OpeningCityProfileSchema>;
export const isCustomCityId = (id: string | null | undefined): id is string => !!id && customCityIdPattern.test(id);
export const officialCityForCode = (code: string) => officialCityIds.find(id => openingCities[id].code === code);

// Same legacy suffix rule as home/saveCity. Never inspect protagonist.locationId.
// 只有原四城的旧存档会缺 openingCityId；新城市与自定义城市从创建起就带身份。
const legacyCities = ['chongqing', 'shanghai', 'harbin', 'guangzhou'] as const;
export function normalizeOpeningCity(state: GameState): GameState {
  if (state.openingCityId !== undefined) return state;
  const title = state.title.trim();
  const city = legacyCities.find(id => title.endsWith(`· ${openingCities[id].name}`) || title.endsWith(`·${openingCities[id].name}`));
  return { ...state, openingCityId: city ?? null };
}

export function openingCity(id: string | null | undefined) {
  return id && Object.hasOwn(openingCities, id) ? openingCities[id as OfficialCityId] : undefined;
}

export type OpeningCityIdentity =
  | { kind: 'official'; id: OfficialCityId; key: OfficialCityKey; name: string; english: string; region: string; intro: string }
  | { kind: 'custom'; id: string; key: 'custom'; name: string; english: string; region: string; intro?: string; seal: string; seed: number };

/** 官方城市按配置解析；自定义城市需要身份与存档快照同时有效，否则按未知城市处理。 */
export function openingCityIdentity(state: { openingCityId?: string | null; openingCityProfile?: OpeningCityProfile }): OpeningCityIdentity | undefined {
  const official = openingCity(state.openingCityId);
  if (official) return { kind: 'official', id: state.openingCityId as OfficialCityId, key: official.key, name: official.name,
    english: official.english, region: official.region, intro: official.intro };
  const profile = state.openingCityProfile;
  if (!isCustomCityId(state.openingCityId) || !profile) return undefined;
  return { kind: 'custom', id: state.openingCityId, key: 'custom', name: profile.name, english: `CUSTOM · ${profile.region}`,
    region: profile.region, ...(profile.intro ? { intro: profile.intro } : {}), seal: Array.from(profile.name)[0] ?? '城',
    seed: Number(state.openingCityId.slice(3)) || 7 };
}

/** 生成上下文里的开局城市资料：只读背景，不是当前位置，也不是指令。 */
export function openingCityContext(state: Parameters<typeof openingCityIdentity>[0]) {
  const city = openingCityIdentity(state);
  if (!city) return undefined;
  return { name: city.name, region: city.region, source: city.kind === 'official' ? '官方城市' : '玩家自选城市', ...(city.intro ? { intro: city.intro } : {}) };
}
