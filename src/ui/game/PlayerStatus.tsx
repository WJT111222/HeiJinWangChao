import type { GameState } from '../../domain/state';
import { dateTime, money } from '../panels/playerView';

// A read-only projection of the same save shown in the profile/economy dialogs.
export function PlayerStatus({ state, equipment, onProfile, onEconomy }: {
  state: GameState; equipment: [string, string][]; onProfile: () => void; onEconomy: () => void;
}) {
  const hero = state.protagonist;
  const clock = state.openingTimePending ? '开局时间待确认' : dateTime(state.worldClock);
  const place = state.locations[hero.locationId]?.name || '地点未确认';
  return <aside className="player-status" aria-label="主角信息">
    <div className="status-identity">
      <span className="status-seal" aria-hidden="true">{Array.from(hero.name)[0] || '人'}</span>
      <div>
        <h2 title={hero.name}>{hero.name}</h2>
        <p className="status-demographics" title={`${hero.age} 岁 · ${hero.gender} · ${hero.profession || '职业未确认'}`}>{hero.age} 岁 · {hero.gender} · {hero.profession || '职业未确认'}</p>
        <p className="status-mobile-location">{clock} · {place}</p>
      </div>
    </div>
    <div className="status-place"><time title={clock}>{clock}</time><p title={`${place} · ${state.weatherText || '天气待确认'}`}>{place} · {state.weatherText || '天气待确认'}</p>
      <p className="status-environment" title={state.environmentText || '环境待确认'}>{state.environmentText || '环境待确认'}</p>
    </div>
    <p className="status-section-title">资金</p>
    <div className="status-funds">
      <span><small>现金</small><strong title={money(state.economy.cash)}>{money(state.economy.cash)}</strong></span>
      <span className="status-online"><small>线上资金</small><strong title={money(state.economy.onlineBalance)}>{money(state.economy.onlineBalance)}</strong></span>
    </div>
    <p className="status-section-title">状态</p>
    <div className="status-condition">
      <span title={hero.healthText || '待开局确认'}><small>身体</small>{hero.healthText || '待开局确认'}</span>
      <span title={hero.emotionText || '待开局确认'}><small>情绪</small>{hero.emotionText || '待开局确认'}</span>
    </div>
    <section className="status-wear" aria-label="当前穿戴与装备">
      <p className="status-section-title">当前穿戴与装备</p>
      <dl>{equipment.map(([label, value]) => <div key={label} data-empty={value === '无' ? '' : undefined}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
    </section>
    <div className="status-actions">
      <button onClick={onProfile}>人物档案</button>
      <button onClick={onEconomy}>经济与资产</button>
    </div>
    <button className="status-expand" aria-label="展开人物状态" onClick={onProfile}>⌄</button>
  </aside>;
}
