import {useId} from 'react';
import type {GameState} from '../../domain/state';
import {chinaCalendar} from '../../domain/openingTime';
import {openingCity} from '../../domain/openingCity';
import {deriveAtmosphere,locationText,timeOfDayLabel,weatherSeals} from './atmosphere';
import {money} from '../panels/playerView';
import {fundStyle} from './PlayerStatus';

function scene(state:GameState){
 const place=locationText(state.locations,state.protagonist.locationId),calendar=state.openingTimePending?undefined:chinaCalendar(state.worldClock);
 return {place,clock:calendar?`${String(calendar.hour).padStart(2,'0')}:${String(calendar.minute).padStart(2,'0')}`:'--:--',date:calendar?`${calendar.year}/${calendar.month}/${calendar.day} ${calendar.weekday}`:'开局时间待确认',period:timeOfDayLabel(state)};
}
export function mobileCitySeal(state:GameState){return ({cq:'渝',sh:'沪',hrb:'冰',gz:'穗',other:'城'})[deriveAtmosphere(state).city];}
export function MobileCityBar({state,mini,onStatus}:{state:GameState;mini:boolean;onStatus:()=>void}){
 const id=useId(),{place,clock,date}=scene(state),weather=weatherSeals[deriveAtmosphere(state).weather];
 return <header className={`mobile-city-top${mini?' mini':''}`} aria-label="城市与当前场景">
  <button className="mobile-city-pill" data-mobile-status aria-label="此时此地与主角状态" aria-haspopup="dialog" aria-describedby={id} onClick={onStatus} title={[place.path,place.name,date,clock].filter(Boolean).join(' · ')}>
   <span className="mobile-seal" aria-hidden="true">{mobileCitySeal(state)}</span><span className="where"><small>{place.path||openingCity(state.openingCityId)?.name||'当前地点'}</small><b>{place.name}</b></span>
   <time dateTime={state.openingTimePending?undefined:state.worldClock}>{clock}</time><span className="mobile-weather" aria-label={`天气：${state.weatherText||'天气待确认'}`}>{state.weatherText.trim()?weather:"—"}</span>
  </button><span id={id} className="sr-only">{place.path} {place.name}，{date} {clock}，天气：{state.weatherText||'天气待确认'}</span>
 </header>;
}
export function MobileStatus({state,equipment,onProfile,onEconomy}:{state:GameState;equipment:[string,string][];onProfile:()=>void;onEconomy:()=>void}){
 const {place,clock,date,period}=scene(state),hero=state.protagonist;
 return <div className="mobile-status-content">
  <section className="st-place" aria-label="此时此地详情"><p className="path">{place.path||'当前地点'}</p><h3>{place.name}</h3><div className="clock"><time dateTime={state.openingTimePending?undefined:state.worldClock}>{clock}</time><span>{date}{period&&<><br/>{period}</>}</span></div>
   <dl><div><dt>天气</dt><dd>{state.weatherText||'天气待确认'}</dd></div><div><dt>环境</dt><dd>{state.environmentText||'环境待确认'}</dd></div></dl>
  </section>
  <section aria-label="主角信息"><div className="st-hero"><span className="mobile-seal" aria-hidden="true">{Array.from(hero.name)[0]||'人'}</span><div><h3>{hero.name}</h3><p>{hero.age} 岁 · {hero.gender} · {hero.profession||'职业未确认'}</p></div></div>
   <div className="money"><div className="cash" style={fundStyle(money(state.economy.cash),2)}><small>现金</small><b>{money(state.economy.cash)}</b></div><div style={fundStyle(money(state.economy.onlineBalance),4)}><small>线上资金</small><b>{money(state.economy.onlineBalance)}</b></div></div>
   <div className="conds"><div><small>身体</small>{hero.healthText||'待开局确认'}</div><div><small>情绪</small>{hero.emotionText||'待开局确认'}</div></div>
   <dl className="wear" aria-label="当前穿戴与装备">{equipment.map(([label,value])=><div key={label} data-empty={value==='无'?'':undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
  <div className="st-acts"><button onClick={onProfile}>人物档案</button><button onClick={onEconomy}>经济与资产</button></div>
 </div>;
}
