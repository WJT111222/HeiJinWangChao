import { useMemo } from 'react';
import type { GameState } from '../../domain/state';
import { openingCity } from '../../domain/openingCity';
import { chinaCalendar } from '../../domain/openingTime';
import { skyline } from '../home/skyline';
import { cn, dx, deriveAtmosphere, locationText, sceneTime, timeOfDayLabel, weatherSeals } from './atmosphere';
import { SceneDetails } from './SceneDetails';

export function CityAtmosphere({ state }: { state: GameState }) {
  const { city, time, weather } = deriveAtmosphere(state);
  // Geometry is deterministic and changes only when switching to another save identity.
  const svg = useMemo(() => city === 'other' ? '' : skyline(city, 'aria-hidden="true"', false), [city]);
  return <div className="atmo" data-city={city} data-time={time} data-wx={weather} aria-hidden="true">
    <div className="stars" /><div className="skyline" dangerouslySetInnerHTML={{ __html: svg }} />
    <div className="wx wx-rain"><i /></div><div className="wx wx-snow" /><div className="wx wx-fog" /><div className="wx wx-cloud" />
    <div className="vignette" /><div className="grain" />
  </div>;
}

export function CityBar({ state }: { state: GameState }) {
  const city = openingCity(state.openingCityId), atmo = deriveAtmosphere(state);
  const place = locationText(state.locations, state.protagonist.locationId);
  const calendar = state.openingTimePending ? undefined : chinaCalendar(state.worldClock);
  const clock = calendar ? `${String(calendar.hour).padStart(2, '0')}:${String(calendar.minute).padStart(2, '0')}` : '--:--';
  const date = calendar ? `${calendar.year}/${calendar.month}/${calendar.day} ${calendar.weekday}` : '开局时间待确认';
  return <header className="bar glass" aria-label="城市与当前场景">
    <div className="bar-city"><span className="seal" aria-hidden="true">黑</span><div><h1 title={city?.name ?? '城市长夜'}>{city?.name ?? '城市长夜'}</h1><small title={city?.english ?? 'A CITY. A TURNING POINT.'}>{city?.english ?? 'A CITY. A TURNING POINT.'}</small></div></div>
    <div className="bar-main">
      <div className="where" title={[place.path, place.name].filter(Boolean).join(' › ')}><span className="path">{place.path || '当前地点'}</span><span className="name">{place.name}</span></div>
      <div className="clock" title={`${date} ${clock}`}><time dateTime={calendar ? state.worldClock : undefined}>{clock}</time><div className="date"><span>{date}</span>{calendar && <span className="tod">{timeOfDayLabel(state)}</span>}</div></div>
      <SceneDetails weatherText={state.weatherText} environmentText={state.environmentText} weatherSeal={weatherSeals[atmo.weather]} />
    </div>
  </header>;
}

export function CityChapter({ number, state, scene, status = 'settled', desktop }: {
  number: number; state: GameState; scene?: GameState['journal'][number]['scene'];
  status?: 'settled' | 'draft' | 'preview'; desktop: boolean;
}) {
  if (!desktop) return <h2 className="chapter-heading">第 {number} 回合</h2>;
  const place = scene && state.locations[scene.locationId] ? locationText(state.locations, scene.locationId) : undefined;
  return <header className="chapter" data-state={status}>
    <span className="plate" aria-hidden="true">
      <span className="p-frost" /><span className="p-num" data-dx={`第${dx(number)}回`}>{number}</span>
      <span><span className="p-cn">第{cn(number)}回</span><span className="p-sub">TURN {String(number).padStart(3, '0')}</span></span>
      <span className="p-rail"><i /><b /><i className="on" /><b /><i /></span>
    </span>
    <h2 className="chapter-heading">第 {number} 回合</h2>
    {deriveAtmosphere(state).city === 'other' && <span className="plain-chapter" aria-hidden="true">第{cn(number)}回</span>}
    <span className="c-sub" aria-hidden="true" data-st={status === 'preview' ? '预览' : '草稿'}>
      {scene ? <>{sceneTime(scene.worldClock)}{place && <> · {place.city && place.city !== place.name && <><b>{place.city}</b> · </>}{place.city === place.name ? <b>{place.name}</b> : place.name}</>}</> : '时间地点未记录'}
    </span>
  </header>;
}
