import type { GameState } from '../../domain/state';
import { openingCity } from '../../domain/openingCity';
import { Detail } from '../Dialog';
import { ProfessionProfile } from '../components/ProfessionProfile';
import { locationText } from '../game/atmosphere';
import { dateTime } from './playerView';

/** Desktop presentation only. The mobile profile remains in its original Dialog. */
export function ProfilePanel({ state, equipment, candidateTime, onEconomy, onNpc, onSaves }: {
  state: GameState; equipment: [string, string][]; candidateTime?: string;
  onEconomy: () => void; onNpc: () => void; onSaves: () => void;
}) {
  const hero = state.protagonist;
  const place = locationText(state.locations, hero.locationId);
  const basics = { 姓名: hero.name, 年龄: hero.age, 性别: hero.gender, 职业: hero.profession,
    外貌: hero.appearance, 性格: hero.personality, 背景: hero.background };
  const conditions = [
    ['身体', hero.healthText || '待开局确认', 'body'],
    ['情绪', hero.emotionText || '待开局确认', 'mood'],
    ['社会状态', hero.publicStatus || '未确认', 'soc'],
    ['法律状态', hero.legalStatus || '未确认', 'law'],
  ];
  return <div className="pf">
    <section className="pf-id">
      <div className="pf-photo" aria-hidden="true">{Array.from(hero.name)[0]}</div>
      <div className="pf-name"><h3>{hero.name}</h3><p className="line">{hero.age} 岁 · {hero.gender} · {hero.profession}</p>
        <p className="no">PROTAGONIST · {place.city || '城市未确认'} · 第 {state.turnNumber} 回合</p></div>
      <span className="pf-stamp" aria-hidden="true">主角</span>
      <div className="pf-entry profile-entrypoints">
        <button onClick={onEconomy}>经济与资产 <span aria-hidden="true">→</span></button>
        <button onClick={onNpc}>NPC 人物资料 <span aria-hidden="true">→</span></button>
        <button onClick={onSaves}>切换存档 <span aria-hidden="true">↗</span></button>
      </div>
    </section>
    <div className="pf-grid"><div>
      <section className="sec"><h4>基本资料</h4><dl className="dl profile-details pf-basics">
        {Object.entries(basics).map(([label,value]) => <Detail key={label} label={label}>{value}</Detail>)}
      </dl></section>
      <div className="sec pf-profession"><ProfessionProfile hero={hero} /></div>
    </div><div>
      <section className="pf-now"><div className="hd"><h4>此时此地</h4>
        <span className="city" aria-hidden="true">{openingCity(state.openingCityId)?.english.split(' · ')[0]}</span></div>
        <dl className="dl profile-details" data-candidate-time={Boolean(candidateTime)}>
          <Detail label="当前时间">{state.openingTimePending ? '开局时间待确认' : dateTime(state.worldClock)}</Detail>
          {candidateTime && <Detail label="候选时间">{dateTime(candidateTime)}（未正式结算）</Detail>}
          <Detail label="地点">{state.locations[hero.locationId]?.name || '地点未确认'}</Detail>
          <Detail label="天气">{state.weatherText || '天气待确认'}</Detail>
          <Detail label="环境">{state.environmentText || '环境将由开局正文确立。'}</Detail>
        </dl>
      </section>
      <section className="sec"><h4>状态</h4><dl className="conds profile-details">
        {conditions.map(([label,value,tone]) => <div className={`cond-card ${tone}`} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl></section>
      <section className="sec"><h4>当前穿戴与装备</h4><dl className="slots">
        {equipment.map(([label,value],index) => <div className={`slot ${value === '无' ? 'empty-slot' : ''}`} key={label}>
          <span className="ic" aria-hidden="true">{['衣','裤','鞋','饰','武','副','车'][index]}</span><dt>{label}</dt><dd title={value}>{value}</dd>
        </div>)}
      </dl></section>
    </div></div>
  </div>;
}
