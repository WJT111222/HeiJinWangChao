import type { GameState } from '../../domain/state';
import { dateTime, money } from '../panels/playerView';

// A read-only projection of the same save shown in the profile/economy dialogs.
// Wide desktop lays these blocks out as a left column plus a story bar (CSS only); narrower layouts keep the top strip.
export function PlayerStatus({ state, equipment = [], onProfile, onEconomy }: {
  state: GameState; equipment?: readonly (readonly [string, string])[]; onProfile: () => void; onEconomy: () => void;
}) {
  const hero = state.protagonist;
  const clock = state.openingTimePending ? '开局时间待确认' : dateTime(state.worldClock);
  const place = state.locations[hero.locationId]?.name || '地点未确认';
  const weather = state.weatherText || '天气待确认';
  const environment = state.environmentText || '环境待确认';
  // Display-only breadcrumb from the existing parent links; stops on missing or cyclic data.
  const ancestors: string[] = [];
  for (let id = state.locations[hero.locationId]?.parentId, seen = new Set<string>(); id && !seen.has(id) && state.locations[id]; id = state.locations[id].parentId) {
    seen.add(id); ancestors.unshift(state.locations[id].name);
  }
  const path = ancestors.join(' › ');
  return <aside className="player-status" aria-label="主角信息">
    <div className="status-identity">
      <span className="status-seal" aria-hidden="true">{Array.from(hero.name)[0] || '人'}</span>
      <div>
        <h2 title={hero.name}>{hero.name}</h2>
        <p className="status-demographics" title={`${hero.age} 岁 · ${hero.gender} · ${hero.profession || '职业未确认'}`}>{hero.age} 岁 · {hero.gender} · {hero.profession || '职业未确认'}</p>
        <p className="status-mobile-location">{clock} · {place}</p>
      </div>
    </div>
    <div className="status-place"><time title={clock}>{clock}</time>
      <p className="status-location" title={path ? `${path} › ${place}` : place}>
        {path && <span className="status-location-path">{path}</span>}
        <span className="status-location-name">{place}</span>
      </p>
      <p className="status-weather" title={weather}><small>天气</small><span>{weather}</span></p>
      <p className="status-environment" title={environment}><small>环境</small><span>{environment}</span></p>
    </div>
    <div className="status-funds">
      <span><small>现金</small><strong title={money(state.economy.cash)}>{money(state.economy.cash)}</strong></span>
      <span className="status-online"><small>线上资金</small><strong title={money(state.economy.onlineBalance)}>{money(state.economy.onlineBalance)}</strong></span>
    </div>
    <div className="status-condition">
      <span title={hero.healthText || '待开局确认'}><small>身体</small>{hero.healthText || '待开局确认'}</span>
      <span title={hero.emotionText || '待开局确认'}><small>情绪</small>{hero.emotionText || '待开局确认'}</span>
    </div>
    {equipment.length > 0 && <section className="status-wear" aria-label="当前穿戴与装备">
      <h3>当前穿戴与装备</h3>
      <dl>{equipment.map(([label, value]) => <div key={label} data-empty={value === '无' || undefined}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
    </section>}
    <div className="status-actions">
      <button onClick={onProfile}>人物档案</button>
      <button onClick={onEconomy}>经济与资产</button>
    </div>
    <button className="status-expand" aria-label="展开人物状态" onClick={onProfile}>⌄</button>
  </aside>;
}
