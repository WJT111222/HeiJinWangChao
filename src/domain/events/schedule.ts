import { pendingEventEntries } from './interactions';
import type { GameState } from '../state';
import { terminalEvent } from './lifecycle';

export function worldEventSchedule(before:GameState,projected:GameState) {
  const to=Date.parse(projected.worldClock);
  const deadline=(e:GameState['events'][string])=>e.eventKind==='sub'?e.fixedEndAt:e.estimatedEndAt;
  const due=Object.values(projected.events).filter(e=>e.eventKind!=='main'&&!terminalEvent(e)
    && (e.eventKind==='sub'||!['pending','presented'].includes(e.protagonistEntry?.status??''))
    && deadline(e)&&Date.parse(deadline(e)!)<=to)
    .sort((a,b)=>Date.parse(deadline(a)!)-Date.parse(deadline(b)!)||a.id.localeCompare(b.id));
  const actionable=(e:typeof due[number])=>e.eventKind==='sub' || e.continuation?.direction==='protagonist' || (e.actorRefs.length>0 && e.actorRefs.every(ref=>ref.kind==='organization'
    || (ref.kind==='npc'&&!(before.turnNumber===0 && ref.id===before.initialCompanionId)&&Boolean(projected.npc[ref.id])&&!projected.npc[ref.id].onScene&&!before.npc[ref.id]?.onScene)));
  const actions=due.filter(actionable).map(e=>{
    const entry=e.eventKind==='sub'?e.protagonistEntry:undefined;
    const entryHandoff=entry?.status==='pending'||entry?.status==='presented' ? {
      status:entry.status, ...(e.entryIntent ? {entryIntent:e.entryIntent} : {}), channel:entry.channel, cue:entry.cue, locationId:entry.locationId,
    } : undefined;
    return {eventId:e.id,eventKind:e.eventKind,parentEventId:e.parentEventId,
      fixedEndAt:e.eventKind==='sub'?e.fixedEndAt:undefined,estimatedEndAt:e.eventKind==='sub'?undefined:e.estimatedEndAt,
      overdue:Date.parse(deadline(e)!)<Date.parse(before.worldClock),
      status:e.status,mode:e.eventKind==='sub'?'stage_resolution':e.continuation?.direction==='protagonist'?'protagonist_handoff':'offscreen_evolution',
      predecessorEventIds:e.predecessorEventIds??[],prerequisites:e.prerequisites,blockers:e.blockers,
      ...(entryHandoff ? {entryHandoff} : {})};
  });
  return {from:before.worldClock,to:projected.worldClock,
    due:actions,
    pendingEntries:pendingEventEntries(projected),
    scenePending:due.filter(e=>!actionable(e)).map(e=>e.id),
    unplannedLegacy:Object.values(projected.events).filter(e=>!e.eventKind&&!terminalEvent(e)&&!e.estimatedEndAt).map(e=>e.id),
    policy:'sub到期按原fixedEndAt结案，结果由AI决定；无法合法结案时保留原记录与入场，下回正常推进仍列为积压；未到期不例行修改；main估期不是截止期限。旧事件到期只要求评估，不代表完成。按预计时间和来源依赖在同一次World请求处理；终结或给出理由延期到窗口之后。场内缺少实际事实时不代主角行动；旧缺规划记录不补造历史日期。'
      + (actions.some(e=>e.entryHandoff)
        ? '业务无需后续就结束；entryHandoff 另外标明仍开放的入场，按共享契约处理，不编造后续互动。'
        : '无后续必要就结束清理，不强制承接。')};
}
