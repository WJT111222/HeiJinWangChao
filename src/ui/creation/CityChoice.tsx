// 创角第 3 步的城市选择：官方八城卡片 + 自定义城市入口，以及下方的城市详情。
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { officialCityForCode, openingCities } from '../../domain/openingCity';
import { cnCitiesIn, cnCityLevelName, cnProvinces, searchCnCities } from '../../domain/cities/catalog';
import type { CnCity } from '../../domain/cities/catalog';
import { customCityVisual, officialCityVisual, citySkyline } from '../home/cityVisual';
import type { CityVisual } from '../home/cityVisual';
import { guilloche } from '../home/ticketView';
import { cities } from './model';
import type { Creation, CreationCityId } from './model';

/** 车票色带（比城市色深一档）。 */
export const ticketBand = { cq: '#2f6f63', sh: '#34468e', hrb: '#6f8fa8', gz: '#a8482c', bj: '#8d2a24', hz: '#3d6a55', cs: '#4c2f6b', sy: '#1b7f8c', custom: '#5b4b35' } as const;

/** 创角中当前城市的视觉身份；自定义城市尚未选定时用「自」字占位。 */
export function creationCityVisual(form: Pick<Creation, 'city' | 'customCity'>): CityVisual {
  if (form.city !== 'custom') return officialCityVisual(openingCities[form.city].key);
  const chosen = form.customCity;
  return chosen ? customCityVisual(chosen.name, chosen.region, Number(chosen.id.slice(3)))
    : { ...customCityVisual('自定义', '中国大陆', 7), seal: '自', line: 'CUSTOM · 中国大陆', meta: '中国大陆' };
}

export function CreationGuilloche({ city }: { city: CityVisual }) {
  const paths = useMemo(() => guilloche(city.seed), [city.seed]);
  return <svg viewBox="0 0 320 74" preserveAspectRatio="none" aria-hidden="true">{paths.map((d, k) => <path key={k} className={k % 4 ? '' : 'deep'} d={d} />)}</svg>;
}

/** 电脑端城市卡顶部的剪影、城市印与经度。 */
function CityCardArt({ city, selected, placeholder }: { city: CityVisual; selected: boolean; placeholder?: boolean }) {
  const svg = useMemo(() => placeholder ? '' : citySkyline(city, 'aria-hidden="true" focusable="false"', false), [city, placeholder]);
  return <span className={`creation-city-art${placeholder ? ' placeholder' : ''}`} aria-hidden="true" style={{ '--c': city.tint } as CSSProperties}>
    <span className="creation-city-sky" dangerouslySetInnerHTML={{ __html: svg }} />
    {placeholder && <span className="creation-city-q">？</span>}
    <span className="creation-city-seal">{city.seal}</span>
    {city.key !== 'custom' && <span className="creation-city-lon">{city.meta}</span>}
    {selected && <span className="creation-city-start">起点</span>}
  </span>;
}

export function CityCards({ form, mobile, onPick }: { form: Creation; mobile: boolean; onPick: (city: CreationCityId) => void }) {
  const custom = creationCityVisual({ city: 'custom', customCity: form.customCity });
  const card = (id: CreationCityId, city: CityVisual, label: string, name: string, description?: string, isNew?: boolean) => {
    const selected = form.city === id, placeholder = id === 'custom' && !form.customCity;
    return <label className={`choice-card city-card ${selected ? 'selected' : ''} ${id === 'custom' ? 'custom' : ''}`} key={id}
      style={{ '--c': city.tint, '--tint': city.tint } as CSSProperties}>
      <input type="radio" name="city" value={id} checked={selected} onChange={() => onPick(id)} aria-label={id === 'custom' ? '自定义城市' : name} />
      {mobile ? <span className="creation-city-art"><CreationGuilloche city={city} /><span className="creation-city-seal" aria-hidden="true">{selected ? '起点' : city.seal}</span></span>
        : <CityCardArt city={city} selected={selected} placeholder={placeholder} />}
      <small>{label}</small>
      <strong>{name}{isNew && <span className="creation-city-new" aria-label="新城市">NEW</span>}</strong>
      {mobile && description && selected && <p>{description}</p>}
    </label>;
  };
  return <fieldset className="city-list">
    <legend className="sr-only">初始城市</legend>
    {cities.map(city => card(city.id, officialCityVisual(openingCities[city.id].key), city.label, city.name, city.description,
      !['chongqing', 'shanghai', 'harbin', 'guangzhou'].includes(city.id)))}
    {card('custom', custom, form.customCity ? `${form.customCity.region} · 自定义` : '中国大陆任一城市', form.customCity?.name ?? '自定义城市')}
  </fieldset>;
}

/** 选中城市的详情。官方城市显示版本内置介绍；自定义城市是省市选择、可选介绍与 AI 补全。 */
export function CityDetail({ form, mobile, onCustomCity, introField }: {
  form: Creation; mobile: boolean;
  onCustomCity: (city: CnCity) => void;
  introField: ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const city = creationCityVisual(form);
  if (form.city !== 'custom') {
    const official = openingCities[form.city];
    return <section className="creation-city-detail" style={{ '--c': city.tint } as CSSProperties} aria-label={`${official.name}城市详情`}>
      <header><strong>{official.name}</strong><small>{official.label}</small><em>{city.line}</em></header>
      <p className="creation-city-intro">{official.intro}</p>
      <p className="creation-city-note">官方城市介绍随版本提供，不需要 AI 补全。选择起点，不限制未来的目的地。</p>
    </section>;
  }
  const chosen = form.customCity;
  return <section className="creation-city-detail custom" style={{ '--c': city.tint } as CSSProperties} aria-label="自定义城市">
    <header><strong>{chosen?.name ?? '自定义城市'}</strong><small>{chosen ? chosen.region : '中国大陆真实城市 · 直辖市 / 地级市 / 县级市'}</small><em>CUSTOM START</em></header>
    {chosen && !picking ? <>
      <div className="creation-city-chosen">
        <span className="creation-city-chosen-seal" aria-hidden="true">{city.seal}</span>
        <span><b>{chosen.name}</b><small>{chosen.region} · 区划 {chosen.id.slice(3)}</small></span>
        <button type="button" onClick={() => setPicking(true)}>更换城市</button>
      </div>
      {introField}
    </> : <CityPicker mobile={mobile} selectedId={chosen?.id} intro={form.cityIntro?.trim() ?? ''}
      onCancel={chosen ? () => setPicking(false) : undefined}
      onPick={picked => { setPicking(false); onCustomCity(picked); }} />}
  </section>;
}

function CityPicker({ mobile, selectedId, intro, onPick, onCancel }: {
  mobile: boolean; selectedId?: string; intro: string; onPick: (city: CnCity) => void; onCancel?: () => void;
}) {
  const provinces = cnProvinces();
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState(() => provinces.find(item => cnCitiesIn(item).some(city => city.id === selectedId)) ?? provinces[0]);
  const [pending, setPending] = useState<CnCity>();
  const results = query.trim() ? searchCnCities(query) : cnCitiesIn(province);
  const pick = (city: CnCity) => {
    // 已经写了介绍时换城市会清空介绍，先在原位确认。
    if (intro && city.id !== selectedId) setPending(city);
    else onPick(city);
  };
  const row = (city: CnCity) => {
    const official = officialCityForCode(city.code);
    return <li key={city.id}><button type="button" aria-pressed={city.id === selectedId} onClick={() => pick(city)}>
      <span>{city.name}</span>
      <small>{official ? '官方城市' : query.trim() ? `${city.province} · ${cnCityLevelName[city.level]}` : city.level === 2 && city.parent ? `县级市 · ${city.parent}` : cnCityLevelName[city.level]}</small>
    </button></li>;
  };
  return <div className="creation-city-picker">
    <label className="creation-city-search">
      <span className="sr-only">搜索城市</span>
      <input type="search" value={query} placeholder="搜索城市或省份，如：苏州、江苏" maxLength={20} onChange={event => setQuery(event.target.value)} />
    </label>
    {!query.trim() && (mobile
      ? <label className="creation-city-province">省份<select value={province} onChange={event => setProvince(event.target.value)}>
        {provinces.map(item => <option key={item}>{item}</option>)}</select></label>
      : <ul className="creation-city-provinces" aria-label="省份">{provinces.map(item =>
        <li key={item}><button type="button" aria-pressed={item === province} onClick={() => setProvince(item)}>{item}</button></li>)}</ul>)}
    <div className="creation-city-results">
      <p className="creation-city-results-head">{query.trim() ? `「${query.trim()}」· ${results.length} 个结果` : `${province} · ${results.length} 座城市`}</p>
      {results.length ? <ul aria-label="城市">{results.map(row)}</ul>
        : <p className="creation-city-empty">没有找到。本期支持中国大陆的直辖市、地级市和县级市，自治州、地区、盟和县暂不支持。</p>}
    </div>
    {pending && <div className="creation-city-confirm" role="alertdialog" aria-label="更换城市">
      <p>更换为「{pending.name}」会清空已写的城市介绍。</p>
      <button type="button" onClick={() => setPending(undefined)}>保留原城市</button>
      <button type="button" className="primary" onClick={() => { const next = pending; setPending(undefined); onPick(next); }}>确认更换</button>
    </div>}
    {onCancel && <button type="button" className="text-button creation-city-cancel" onClick={onCancel}>取消更换</button>}
  </div>;
}

