import { stageResults } from '../../domain/events/stages';
import type { WorldEvent, RetiredEvent } from '../../domain/events/schema';
import type { PlayerView } from './playerView';

export const eventStatusLabels = {scheduled:'尚未开始',active:'进行中',blocked:'受阻',resolved:'已结案',cancelled:'已取消'};
export const eventOutcomeLabels = {success:'成功',failure:'失败',changed:'变化',cancelled:'取消'};
export const eventImpactLabels = {minor:'局部影响',significant:'显著影响',major:'重大影响'};
export interface ArchiveEvent {
  id:string; title:string; status:WorldEvent['status']; eventKind?:WorldEvent['eventKind']; parentEventId?:string;
  startAt?:string; fixedEndAt?:string; retired:boolean;
  detail?:WorldEvent|NonNullable<RetiredEvent['detail']>;
  raw:WorldEvent|RetiredEvent;
}
const terminal=(e:ArchiveEvent)=>e.status==='resolved'||e.status==='cancelled';
const byStart=(a:ArchiveEvent,b:ArchiveEvent)=>(Date.parse(a.startAt??'')||0)-(Date.parse(b.startAt??'')||0)||a.id.localeCompare(b.id);
/** Read-only projection. Live identity wins defensively; formal state itself forbids duplicate IDs. */
export function eventArchive(view:Pick<PlayerView,'events'|'retiredEvents'>) {
  const live=Object.fromEntries(view.events.map(e=>[e.id,e]));
  const retired=Object.fromEntries(view.retiredEvents.filter(e=>!live[e.id]).map(e=>[e.id,e]));
  const records=new Map<string,ArchiveEvent>([...Object.values(retired),...Object.values(live)].map(raw=>{
    const detail='title' in raw?raw:raw.detail;
    return [raw.id,{id:raw.id,title:detail?.title??raw.id,status:raw.status,eventKind:raw.eventKind,parentEventId:raw.parentEventId,
      startAt:raw.startAt??detail?.startAt,fixedEndAt:raw.fixedEndAt,retired:!('title' in raw),detail,raw}];
  }));
  const all=[...records.values()].sort(byStart);
  return {records,source:{events:live,retiredEvents:retired},
    active:all.filter(e=>e.eventKind==='main'&&!e.retired&&(e.status==='active'||e.status==='blocked')),
    otherFamilies:all.filter(e=>e.eventKind==='main'&&(e.retired||!['active','blocked'].includes(e.status))),
    legacy:all.filter(e=>!e.eventKind),
    unassigned:all.filter(e=>e.eventKind==='sub'&&records.get(e.parentEventId??'')?.eventKind!=='main')};
}
export function eventFamily(archive:ReturnType<typeof eventArchive>,id:string,worldClock:string) {
  const children=[...archive.records.values()].filter(e=>e.eventKind==='sub'&&e.parentEventId===id).sort(byStart);
  const results=stageResults(archive.source,id),resultIds=new Set(results.map(r=>r.id));
  return {parent:archive.records.get(id),
    running:children.filter(e=>!terminal(e)&&e.status!=='scheduled'&&Date.parse(e.startAt!)<=Date.parse(worldClock)),
    upcoming:children.filter(e=>!terminal(e)&&(e.status==='scheduled'||Date.parse(e.startAt!)>Date.parse(worldClock))),
    ended:results.flatMap(r=>archive.records.has(r.id)?[{...archive.records.get(r.id)!,result:r}]:[]),
    // Conservative fallback for malformed display-only input; never fabricate a result.
    incomplete:children.filter(e=>terminal(e)&&!resultIds.has(e.id))};
}
