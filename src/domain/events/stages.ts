import type { SceneIntervention } from './narration';
import { requireData } from '../common';
import type { GameState } from '../state';
import type { WorldEvent, RetiredEvent } from './schema';

const ended = (e: {status:string}) => ['resolved','cancelled'].includes(e.status);
const same = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b);
export function validateStageResult(event: WorldEvent | RetiredEvent) {
  const detail='title' in event ? event : event.detail;
  requireData(event.eventKind==='sub' && event.parentEventId && event.startAt && event.fixedEndAt
    && ended(event) && detail?.resolvedAt && detail.resolutionText?.trim() && detail.outcome,
  'STAGE_RESULT','子事件结案必须保留实际时间、结果及阶段经过');
  if(!('title' in event)) requireData(event.startAt===detail.startAt,'STAGE_RESULT','退役阶段起点与成果记录冲突');
  requireData(event.status==='cancelled' ? detail.outcome==='cancelled' : detail.outcome!=='cancelled',
    'STAGE_RESULT','子事件终态与结果不一致');
}
/** Validate writes after the entire batch, not against the order of clock commands. */
export function validateStageWrite(old:WorldEvent|undefined,event:WorldEvent,clock:string,turnId:string,intervention?:SceneIntervention) {
  if(event.eventKind!=='sub' || (old && ended(old)))return;
  const receipt=event.protagonistEntry;
  const scene=Boolean(old?.protagonistEntry && receipt?.id===old.protagonistEntry.id
    && receipt.handledTurnId===turnId && receipt.status!=='pending' && receipt.status!=='invalidated');
  if(ended(event)) {
    validateStageResult(event);
    requireData(Date.parse(event.resolvedAt!)===Date.parse(event.fixedEndAt!)
      || ((scene || (intervention?.eventId===event.id && Date.parse(event.resolvedAt!)===Date.parse(intervention.at)))
        && Date.parse(event.resolvedAt!)<Date.parse(event.fixedEndAt!)),
    'STAGE_TIME','场外子事件实际结案时间必须为固定终止时间；提前结案仅限本轮现场回执');
  } else if(old && !scene && intervention?.eventId!==event.id) {
    requireData(same(old,event),'STAGE_EARLY_WRITE','场外小事件不可例行改写，须到固定时间结案');
  } else if(!old) requireData(Date.parse(clock)<Date.parse(event.fixedEndAt!),'STAGE_DUE','本窗口已到期的新阶段须保存最终结案对象');
}
/** Final World/turn boundary only: Variables may simulate a clock crossing before World runs. */
export function validateStageSettlement(before:GameState,after:GameState,turnId:string) {
  const now=Date.parse(after.worldClock);
  const candidates=new Map([...Object.values(after.events),...Object.values(before.events)].map(e=>[e.id,e]));
  for(const event of candidates.values()) {
    if(event.eventKind!=='sub'||ended(event)||Date.parse(event.fixedEndAt!)>now)continue;
    const result=after.events[event.id]??after.retiredEvents[event.id];
    requireData(result && ended(result),'STAGE_DUE','到期子事件必须结案，不能以待入场或新预计时间无限延期');
    validateStageResult(result);
    const record=result as WorldEvent|RetiredEvent;
    if(Date.parse(('title' in record ? record.resolvedAt : record.detail?.resolvedAt)!)!==Date.parse(event.fixedEndAt!))
      requireData(false,'STAGE_TIME','World不能覆盖尚未结案的子事件为提前结案');
    const entry=event.protagonistEntry;
    if(entry && ['pending','presented'].includes(entry.status)) {
      const source=after.events[event.id];
      const next=Object.values(after.events).filter(e=>!e.eventKind && !ended(e) && e.predecessorEventIds?.includes(event.id)
        && e.protagonistEntry?.id===`stage-entry:${before.revision}`);
      const closed=entry.status==='pending' && next.length===0 && (!source || source.continuation?.direction!=='protagonist');
      requireData(!source || same(source.protagonistEntry,{...entry,status:'invalidated',handledTurnId:turnId,
        textEvidence:closed?'阶段到期，未呈现的原入场安排已结束':'阶段固定到期，入场职责转交后续事件'}),'STAGE_ENTRY','阶段不能伪造玩家处理回执');
      if(closed)continue;
      requireData(next.length===1 && same(next[0].protagonistEntry,{...entry,id:`stage-entry:${before.revision}`}),
        'STAGE_ENTRY','到期入场必须由唯一后继互动事件承接，不能伪造接受或丢失参与');
    }
  }
}
/** One read-only view over the single authoritative live OR retired stage record. */
export function stageResults(state:Pick<GameState,'events'|'retiredEvents'>,parentId:string) {
  return [...Object.values(state.events),...Object.values(state.retiredEvents)]
    .filter(e=>e.eventKind==='sub' && e.parentEventId===parentId && ended(e))
    .map(e=>{
      const detail='title' in e?e:e.detail;
      return {id:e.id,parentEventId:e.parentEventId,title:detail?.title,startAt:e.startAt,fixedEndAt:e.fixedEndAt,
        resolvedAt:detail?.resolvedAt,outcome:detail?.outcome,resolutionText:detail?.resolutionText,
        actorRefs:detail?.actorRefs.map(ref=>({...ref})),resultKnowledge:detail?.resultKnowledge?structuredClone(detail.resultKnowledge):undefined,sourceTurnIds:[...e.sourceTurnIds]};
    }).sort((a,b)=>Date.parse(a.resolvedAt??a.fixedEndAt!)-Date.parse(b.resolvedAt??b.fixedEndAt!)||a.id.localeCompare(b.id));
}
