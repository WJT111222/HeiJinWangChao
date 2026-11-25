import { cnCitySource } from './cnCitySource';

/** 自定义开局城市的稳定身份：`cn-` 加六位统计用区划代码。显示名可能重名，代码不会。 */
export const customCityIdPattern = /^cn-\d{6}$/u;
export type CnCityLevel = 0 | 1 | 2;
export const cnCityLevelName = ['直辖市', '地级市', '县级市'] as const;
export interface CnCity {
  id: string;
  code: string;
  name: string;
  province: string;
  level: CnCityLevel;
  /** 县级市所属的地级行政区（「省直辖」表示省直管），其他级别为空。 */
  parent?: string;
}

let parsed: { cities: readonly CnCity[]; byId: ReadonlyMap<string, CnCity>; provinces: readonly string[] } | undefined;
function catalog() {
  if (parsed) return parsed;
  const cities: CnCity[] = [];
  for (const [province, encoded] of cnCitySource)
    for (const item of encoded.split(';')) {
      const [code, name, level, parent] = item.split('|');
      cities.push({ id: `cn-${code}`, code, name, province, level: Number(level) as CnCityLevel, ...(parent ? { parent } : {}) });
    }
  parsed = { cities, byId: new Map(cities.map(city => [city.id, city])), provinces: cnCitySource.map(([province]) => province) };
  return parsed;
}

export const cnProvinces = () => catalog().provinces;
export const cnCitiesIn = (province: string) => catalog().cities.filter(city => city.province === province);
export const findCnCity = (id: string | null | undefined) => id ? catalog().byId.get(id) : undefined;

/** 存档里保存的地区文字：地级市写省份，县级市写「省份 · 上级」，直辖市写「直辖市」。 */
export function cnCityRegion(city: CnCity) {
  if (city.level === 0) return '直辖市';
  return city.level === 2 && city.parent ? `${city.province} · ${city.parent}` : city.province;
}

/** 搜城市名或省份名。城市名开头匹配优先，其次是包含；输入省份名时列出该省全部城市。 */
export function searchCnCities(query: string, limit = 40): CnCity[] {
  const text = query.trim().replace(/(?:省|市|自治区)$/u, '');
  if (!text) return [];
  const { cities } = catalog();
  const starts = cities.filter(city => city.name.startsWith(text));
  const contains = cities.filter(city => !city.name.startsWith(text) && city.name.includes(text));
  const province = cities.filter(city => city.province === text && !city.name.includes(text));
  return [...starts, ...contains, ...province].slice(0, limit);
}
