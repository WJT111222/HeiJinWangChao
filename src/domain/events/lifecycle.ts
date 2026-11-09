import { requireData } from '../common';
import type { GameState } from '../state';
import { plannedEventSchema } from './schema';
import type { WorldEvent, RetiredEvent } from './schema';

type EventState = { events: Record<string,WorldEvent>; retiredEvents: Record<string,RetiredEvent> };
export const terminalEvent = (event: {status:string}) => ['resolved','cancelled'].includes(event.status);
export function eventById(state: EventState, id: string) { return state.events[id] ?? state.retiredEvents[id]; }
export function historicalEvent(state: EventState, id: string) {
  const event=state.events[id],record=state.retiredEvents[id];
  if(event)return event;
  if(!record?.detail)return undefined;
  return {...record.detail,id:record.id,status:record.status,sourceTurnIds:record.sourceTurnIds,linkedTaskIds:record.linkedTaskIds,
    ...(record.eventKind ? {eventKind:record.eventKind,parentEventId:record.parentEventId,fixedEndAt:record.fixedEndAt} : {})};
}
const same = (a: unknown,b: unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** 新规划必须完整；历史旧记录只读容忍缺规划，不把条件当调度时间。 */
export function validateEventWrite(old: WorldEvent | undefined, event: WorldEvent) {
  if(!old) plannedEventSchema(event).parse(event);
  else {
    requireData(old.eventKind===event.eventKind && old.parentEventId===event.parentEventId
      && old.fixedEndAt===event.fixedEndAt, 'EVENT_CONTEXT','事件类型、父事件与固定终止时间不可改写');
    requireData(old.startAt===event.startAt
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
  for (const event of Object.values(state.events)) {
    if (event.eventKind) plannedEventSchema(event).parse(event);
    else requireData(!event.parentEventId && !event.fixedEndAt,'EVENT_CONTEXT','旧事件不能单独填写主子事件字段');
  }
  for (const event of [...Object.values(state.events), ...Object.values(state.retiredEvents)]) {
    if (event.eventKind==='sub') {
      const parent=event.parentEventId && state.events[event.parentEventId];
      requireData(parent && parent.eventKind==='main' && parent.id!==event.id,'EVENT_PARENT','小事件必须关联现存主事件');
      requireData(event.startAt && event.fixedEndAt && Date.parse(event.fixedEndAt)>=Date.parse(event.startAt)
        && Date.parse(event.startAt)>=Date.parse(parent.startAt),'EVENT_TIME','小事件时间范围不合法');
    } else requireData(!event.parentEventId && !event.fixedEndAt,'EVENT_CONTEXT','非小事件不能填写父事件或固定终止时间');
  }
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
    if(event.parentEventId) visit(event.parentEventId);
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
    || [...Object.values(state.events),...Object.values(state.retiredEvents)].some(e=>e.parentEventId===event.id)
    || [...memories,...Object.values(state.organizations)].some(m=>JSON.stringify(m).includes(`event:${event.id}`)||JSON.stringify(m).includes(`event-result:${event.id}`)||JSON.stringify(m).includes(`event-plan:${event.id}`)||JSON.stringify(m).includes(JSON.stringify(event.id)));
}

/** 清理无必要引用的终态，不按重要性准入；轻量身份阻止ID重用。 */
export function deleteEvent(state: GameState,eventId:string,expectedStatus:'resolved'|'cancelled',turnId:string) {
  const event=state.events[eventId];
  requireData(event && event.status===expectedStatus && terminalEvent(event),'EVENT_NOT_TERMINAL','只能清理已结束事件');
  // Until authoritative stage summaries exist, the full sub-event is the only result record.
  requireData(event.eventKind!=='sub','EVENT_RETAINED','阶段摘要尚未持久化，子事件结案成果必须保留');
  requireData(!state.retiredEvents[eventId],'DUPLICATE_ID','事件已清理');
  // 未处理入场和必要引用继续保护；不按事件影响等级判断保留资格。
  requireData(!['pending','presented'].includes(event.protagonistEntry?.status??'') && !hasReferences(state,event),
    'EVENT_RETAINED','存在未处理入场或必要引用的事件不能直接清理');
  state.retiredEvents[eventId]={id:event.id,status:expectedStatus,retiredAt:state.worldClock,
    sourceTurnIds:[...new Set([...event.sourceTurnIds,turnId])],linkedTaskIds:event.linkedTaskIds,
    predecessorEventIds:event.predecessorEventIds??[]};
  if(event.eventKind) Object.assign(state.retiredEvents[eventId],{eventKind:event.eventKind,startAt:event.startAt,
    ...(event.parentEventId ? {parentEventId:event.parentEventId,fixedEndAt:event.fixedEndAt} : {})});
  delete state.events[eventId];
}
