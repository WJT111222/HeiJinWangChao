import type { GameState } from '../../domain/state';
import { dateTime, money } from '../panels/playerView';

// A read-only projection of the same save shown in the profile/economy dialogs.
export function PlayerStatus({ state, onProfile, onEconomy }: {
  state: GameState; onProfile: () => void; onEconomy: () => void;
}) {
  const hero = state.protagonist;
  const clock = state.openingTimePending ? '开局时间待确认' : dateTime(state.worldClock);
  const place = state.locations[hero.locationId]?.name || '地点未确认';
  return <aside className="player-status" aria-label="主角信息">
    <div className="status-identity">
      <span className="status-seal" aria-hidden="true">{Array.from(hero.name)[0] || '人'}</span>
      <div>
        <h2>{hero.name}</h2>
        <p className="status-demographics">{hero.age} 岁 · {hero.gender} · {hero.profession || '职业未确认'}</p>
        <p className="status-mobile-location">{clock} · {place}</p>
      </div>
    </div>
    <div className="status-place"><time>{clock}</time><p>{place} · {state.weatherText || '天气待确认'}</p></div>
    <div className="status-funds">
      <span><small>现金</small><strong>{money(state.economy.cash)}</strong></span>
      <span className="status-online"><small>线上资金</small><strong>{money(state.economy.onlineBalance)}</strong></span>
    </div>
    <div className="status-condition">
      <span title={hero.healthText || '待开局确认'}><small>身体</small>{hero.healthText || '待开局确认'}</span>
      <span title={hero.emotionText || '待开局确认'}><small>情绪</small>{hero.emotionText || '待开局确认'}</span>
    </div>
    <div className="status-actions">
      <button onClick={onProfile}>人物档案</button>
      <button onClick={onEconomy}>经济与资产</button>
    </div>
    <button className="status-expand" aria-label="展开人物状态" onClick={onProfile}>⌄</button>
  </aside>;
}
