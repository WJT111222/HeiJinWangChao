import { requireData } from '../common';
import type { GameState } from '../state';
import { WorldEventSchema } from './schema';
import type { WorldEvent, RetiredEvent, TimelineEntry } from './schema';

type EventState = { events: Record<string,WorldEvent>; retiredEvents: Record<string,RetiredEvent> };
export const terminalEvent = (event: {status:string}) => ['resolved','cancelled'].includes(event.status);
export function eventById(state: EventState, id: string) { return state.events[id] ?? state.retiredEvents[id]; }
export function historicalEvent(state: EventState, id: string) {
  const event=state.events[id],record=state.retiredEvents[id];
  if(event)return event;
  if(!record?.detail)return undefined;
  return {...record.detail,id:record.id,status:record.status,sourceTurnIds:record.sourceTurnIds,linkedTaskIds:record.linkedTaskIds};
}
export function isHistoricalEntry(state: EventState, entry: TimelineEntry) {
  const event=historicalEvent(state,entry.eventId),publication=state.retiredEvents[entry.eventId]?.publication;
  return Boolean(event && terminalEvent(event) && event.impact==='major' && event.resolvedAt
    && Date.parse(event.resolvedAt)===Date.parse(entry.occurredAt)
    && (!publication || (publication.title===entry.title && publication.summary===entry.outcome
      && publication.summary===entry.summary && entry.sourceTurnIds.includes(publication.sourceTurnId))));
}
const same = (a: unknown,b: unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** 新规划必须完整；历史旧记录只读容忍缺规划，不把条件当调度时间。 */
export function validateEventWrite(old: WorldEvent | undefined, event: WorldEvent) {
  if(!old) WorldEventSchema.parse(event);
  else {
    requireData(old.startAt===event.startAt && same(old.actorRefs,event.actorRefs)
      && old.completionCondition===event.completionCondition, 'EVENT_CONTEXT','既有事件身份、起点和条件不可改写');
    requireData(!terminalEvent(old) || same(old,event),'TERMINAL_EVENT','终态事件不能再次改写');
    requireData(!['active','blocked'].includes(old.status)||event.status!=='scheduled','EVENT_STATUS','活动不能退回计划');
    // 缺规划旧事件可记录已发生现场状态，不编造日期；新增/调整预计时间时必须合法。
    if(event.estimatedEndAt!==undefined) requireData(Date.parse(event.estimatedEndAt)>=Date.parse(event.startAt),'EVENT_TIME','预计终止早于开始');
  }
  if (!terminalEvent(event)) requireData(event.resolvedAt===undefined && event.resolutionText===undefined && event.resultKnowledge===undefined && event.outcome===undefined,'EVENT_TIME','未结束事件不能预填结果');
  if(event.estimatedEndAt)requireData(Date.parse(event.estimatedEndAt)>=Date.parse(event.startAt),'EVENT_TIME','预计终止早于开始');
}
export function validateEventLinks(state: EventState) {
  const visiting=new Set<string>(),visited=new Set<string>();
  function visit(id:string) {
    requireData(!visiting.has(id),'EVENT_CYCLE','事件承接存在环'); if(visited.has(id))return;
    const event=eventById(state,id);requireData(event,'EVENT_SOURCE','事件前序不存在');visiting.add(id);
    for(const priorId of event.predecessorEventIds??[]) {
      const prior=eventById(state,priorId);requireData(prior && terminalEvent(prior),'EVENT_SOURCE','承接必须引用已结束事件');
      const history=historicalEvent(state,priorId);
      if('startAt' in event) {
        const end = history?.resolvedAt ?? ('retiredAt' in prior && typeof prior.retiredAt==='string' ? prior.retiredAt : undefined);
        requireData(end && Date.parse(end)<=Date.parse(event.startAt),'EVENT_TIME','后续事件必须晚于已成立的前序终止');
      }
      visit(priorId);
    }
    visiting.delete(id);visited.add(id);
  }
  Object.keys(state.events).forEach(visit);Object.keys(state.retiredEvents).forEach(visit);
}
function hasReferences(state: GameState,event:WorldEvent) {
  const refs=[...Object.values(state.tasks),...Object.values(state.events).filter(e=>e.id!==event.id)];
  const condition=(ref:string)=>ref===event.id||ref===`event:${event.id}`;
  const memories=[...state.memories.short,...state.memories.medium,...state.memories.long,...Object.values(state.memories.npcSummaries).flat(),
    ...Object.values(state.npc).flatMap(n=>[...n.memories,...n.knownInformation,...(n.kind==='special'?n.longTermMemories:[])])];
  return event.linkedTaskIds.length>0 || state.timeline.some(e=>e.eventId===event.id)
    || refs.some(r=>('linkedEventId' in r && r.linkedEventId===event.id)||[...r.prerequisites,...r.blockers].some(condition)
      || ('predecessorEventIds' in r && r.predecessorEventIds?.includes(event.id)))
    || Object.values(state.retiredEvents).some(r=>r.predecessorEventIds.includes(event.id))
    || [...memories,...Object.values(state.organizations)].some(m=>JSON.stringify(m).includes(`event:${event.id}`)||JSON.stringify(m).includes(`event-result:${event.id}`)||JSON.stringify(m).includes(`event-plan:${event.id}`)||JSON.stringify(m).includes(JSON.stringify(event.id)));
}

function mainlineRelated(state: GameState, event: WorldEvent, visited = new Set<string>()): boolean {
  if(visited.has(event.id))return false;
  visited.add(event.id);
  if(event.actorRefs.some(ref=>ref.kind==='protagonist'))return true;
  return (event.predecessorEventIds??[]).some(id=> {
    const prior=historicalEvent(state,id);
    return prior && (prior.actorRefs.some(ref=>ref.kind==='protagonist') || (state.events[id] && mainlineRelated(state,state.events[id],visited)));
  });
}
/** 新清理只允许独立普通终态。存量retiredEvents仍原样保留用于兼容引用。 */
export function deleteEvent(state: GameState,eventId:string,expectedStatus:'resolved'|'cancelled',turnId:string) {
  const event=state.events[eventId];
  requireData(event && event.status===expectedStatus && terminalEvent(event),'EVENT_NOT_TERMINAL','只能清理已结束事件');
  requireData(!state.retiredEvents[eventId],'DUPLICATE_ID','事件已清理');
  // 没有独立主线字段：主角参与、任务/事件承接、时间线或知识引用一律保守保留。
  requireData(event.impact==='minor' && !mainlineRelated(state,event) && !hasReferences(state,event),
    'EVENT_RETAINED','重要、主角相关或存在必要引用的事件不能按普通杂事清理');
  state.retiredEvents[eventId]={id:event.id,status:expectedStatus,retiredAt:state.worldClock,
    sourceTurnIds:[...new Set([...event.sourceTurnIds,turnId])],linkedTaskIds:event.linkedTaskIds,
    predecessorEventIds:event.predecessorEventIds??[]};
  delete state.events[eventId];
}
/** 世界事实历史与角色知情无关；重要完整事件保留，旧retired记录仍可补充归档。 */
export function archiveEvent(state:GameState,eventId:string,title:string,summary:string,turnId:string) {
  const view=historicalEvent(state,eventId);
  requireData(view && terminalEvent(view)&&view.impact==='major'&&view.resolvedAt
    && Date.parse(view.resolvedAt)<=Date.parse(state.worldClock),'TIMELINE_NOT_PUBLIC','仅重大实际结案可以归档');
  requireData(!state.timeline.some(e=>e.eventId===eventId),'TIMELINE_DUPLICATE','事件已归档');
  const record=state.retiredEvents[eventId];
  if(record) { requireData(record.detail,'EVENT_SOURCE','缺少必要历史成果'); record.publication={title,summary,at:state.worldClock,sourceTurnId:turnId}; }
  state.timeline.push({eventId,occurredAt:view.resolvedAt,title,summary,outcome:summary,longTermImpact:'',actorRefs:[],sourceTurnIds:[turnId]});
}
