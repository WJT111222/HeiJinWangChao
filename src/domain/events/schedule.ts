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
  return {from:before.worldClock,to:projected.worldClock,
    due:due.filter(actionable).map(e=>({eventId:e.id,eventKind:e.eventKind,parentEventId:e.parentEventId,
      fixedEndAt:e.eventKind==='sub'?e.fixedEndAt:undefined,estimatedEndAt:e.eventKind==='sub'?undefined:e.estimatedEndAt,
      overdue:Date.parse(deadline(e)!)<Date.parse(before.worldClock),
      status:e.status,mode:e.eventKind==='sub'?'stage_resolution':e.continuation?.direction==='protagonist'?'protagonist_handoff':'offscreen_evolution',predecessorEventIds:e.predecessorEventIds??[],prerequisites:e.prerequisites,blockers:e.blockers})),
    pendingEntries:pendingEventEntries(projected),
    scenePending:due.filter(e=>!actionable(e)).map(e=>e.id),
    unplannedLegacy:Object.values(projected.events).filter(e=>!e.eventKind&&!terminalEvent(e)&&!e.estimatedEndAt).map(e=>e.id),
    policy:'sub按fixedEndAt到期须在该时刻结案，结果由AI决定；未到期不例行修改；main估期不是截止期限。旧事件到期只要求评估，不代表完成。按预计时间和来源依赖在同一次World请求处理；终结或给出理由延期到窗口之后。场内缺少实际事实时不代主角行动；旧缺规划记录不补造历史日期。无后续必要就结束清理，不强制承接。'};
}
