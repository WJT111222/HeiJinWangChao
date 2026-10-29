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
export function isPublicHistory(state: EventState, entry: TimelineEntry) {
  const event=historicalEvent(state,entry.eventId),publication=state.retiredEvents[entry.eventId]?.publication;
  return Boolean(event && terminalEvent(event) && event.impact==='major' && event.resolvedAt
    && Date.parse(event.resolvedAt)===Date.parse(entry.occurredAt)
    && (event.visibility==='known' || (publication && publication.title===entry.title && publication.summary===entry.outcome
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
    || memories.some(m=>JSON.stringify(m).includes(`event:${event.id}`)||JSON.stringify(m).includes(`event-result:${event.id}`)||JSON.stringify(m).includes(`event-plan:${event.id}`));
}
/** 清理的是活跃完整对象；最小身份阻止重建同ID，重要/引用成果才保留紧凑资料。 */
export function deleteEvent(state: GameState,eventId:string,expectedStatus:'resolved'|'cancelled',turnId:string) {
  const event=state.events[eventId];
  requireData(event && event.status===expectedStatus && terminalEvent(event),'EVENT_NOT_TERMINAL','只能清理已结束事件');
  requireData(!state.retiredEvents[eventId],'DUPLICATE_ID','事件已清理');
  const detail = event.impact==='major'||hasReferences(state,event) ? {
    title:event.title,startAt:event.startAt,estimatedEndAt:event.estimatedEndAt,resolvedAt:event.resolvedAt,
    actorRefs:event.actorRefs,locationId:event.locationId,visibility:event.visibility,impact:event.impact,
    resolutionText:event.resolutionText,resultKnowledge:event.resultKnowledge,outcome:event.outcome,
  }:undefined;
  state.retiredEvents[eventId]={id:event.id,status:expectedStatus,retiredAt:state.worldClock,
    sourceTurnIds:[...new Set([...event.sourceTurnIds,turnId])],linkedTaskIds:event.linkedTaskIds,
    predecessorEventIds:event.predecessorEventIds??[],...(detail?{detail}:{})};
  delete state.events[eventId];
}
/** 公布的只有本次公开来源支持的标题/摘要，不把秘密完整成果公开。 */
export function archiveEvent(state:GameState,eventId:string,title:string,summary:string,turnId:string) {
  const view=historicalEvent(state,eventId);
  requireData(view && terminalEvent(view)&&view.impact==='major'&&view.resolvedAt
    && Date.parse(view.resolvedAt)<=Date.parse(state.worldClock),'TIMELINE_NOT_PUBLIC','仅重大实际结案可以归档');
  requireData(!state.timeline.some(e=>e.eventId===eventId),'TIMELINE_DUPLICATE','事件已归档');
  if(state.events[eventId])deleteEvent(state,eventId,view.status==='resolved'?'resolved':'cancelled',turnId);
  const record=state.retiredEvents[eventId];requireData(record?.detail,'EVENT_SOURCE','缺少必要历史成果');
  record.publication={title,summary,at:state.worldClock,sourceTurnId:turnId};
  state.timeline.push({eventId,occurredAt:view.resolvedAt,title,summary,outcome:summary,longTermImpact:'',actorRefs:[],sourceTurnIds:[turnId]});
}
