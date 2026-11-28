import { isCustomCityId, openingCityIdentity } from '../../domain/openingCity';
import type { OpeningCityProfile } from '../../domain/openingCity';
import { CITY, CITY_TICKET_META, CUSTOM_CITY_TINT, customSkyline, saveCity, skyline } from './skyline';
import type { City } from './skyline';

/** 一座开局城市在界面上的全部装饰身份。官方城市取美术配置，自定义城市统一暖铜色、城市首字印、按区划代码生成剪影。 */
export interface CityVisual {
  key: City | 'custom';
  name: string;
  seal: string;
  tint: string;
  /** 英文行，如「BEIJING · 39°54′N」或「CUSTOM · 江苏」。 */
  line: string;
  keywords: string;
  /** 车票上的经度；自定义城市写地区。 */
  meta: string;
  seed: number;
}
const officialSeeds: Record<City, number> = { cq: 7, sh: 31, hrb: 53, gz: 97, bj: 113, hz: 131, cs: 151, sy: 173 };

export function officialCityVisual(key: City): CityVisual {
  const [name, line, keywords] = CITY[key], meta = CITY_TICKET_META[key];
  return { key, name, seal: meta.seal, tint: meta.tint, line, keywords, meta: meta.longitude, seed: officialSeeds[key] };
}
export function customCityVisual(name: string, region: string, seed: number): CityVisual {
  return { key: 'custom', name, seal: Array.from(name)[0] ?? '城', tint: CUSTOM_CITY_TINT, line: `CUSTOM · ${region}`, keywords: '自定义起点', meta: region, seed };
}

/** 优先按存档身份解析；身份缺失或无法识别时（旧存档）回退到标题后缀识别。 */
export function cityVisual(source: { title?: string; openingCityId?: string | null; openingCityProfile?: OpeningCityProfile }): CityVisual | undefined {
  const identity = openingCityIdentity(source);
  if (identity?.kind === 'custom') return customCityVisual(identity.name, identity.region, identity.seed);
  const key = identity?.key ?? (source.title !== undefined && !isCustomCityId(source.openingCityId) ? saveCity(source.title) : undefined);
  return key ? officialCityVisual(key) : undefined;
}

export const citySkyline = (city: CityVisual, extra = '', ambientSnow = true) =>
  city.key === 'custom' ? customSkyline(city.seed, extra) : skyline(city.key, extra, ambientSnow);
