import { pendingEventEntries } from './interactions';
import type { GameState } from '../state';
import { terminalEvent } from './lifecycle';

export function worldEventSchedule(before:GameState,projected:GameState) {
  const to=Date.parse(projected.worldClock);
  const due=Object.values(projected.events).filter(e=>!terminalEvent(e)&&!['pending','presented'].includes(e.protagonistEntry?.status??'')&&e.estimatedEndAt&&Date.parse(e.estimatedEndAt)<=to)
    .sort((a,b)=>Date.parse(a.estimatedEndAt!)-Date.parse(b.estimatedEndAt!)||a.id.localeCompare(b.id));
  const actionable=(e:typeof due[number])=>e.continuation?.direction==='protagonist' || (e.actorRefs.length>0 && e.actorRefs.every(ref=>ref.kind==='organization'
    || (ref.kind==='npc'&&!(before.turnNumber===0 && ref.id===before.initialCompanionId)&&Boolean(projected.npc[ref.id])&&!projected.npc[ref.id].onScene&&!before.npc[ref.id]?.onScene)));
  return {from:before.worldClock,to:projected.worldClock,
    due:due.filter(actionable).map(e=>({eventId:e.id,estimatedEndAt:e.estimatedEndAt!,overdue:Date.parse(e.estimatedEndAt!)<Date.parse(before.worldClock),
      status:e.status,mode:e.continuation?.direction==='protagonist'?'protagonist_handoff':'offscreen_evolution',predecessorEventIds:e.predecessorEventIds??[],prerequisites:e.prerequisites,blockers:e.blockers})),
    pendingEntries:pendingEventEntries(projected),
    scenePending:due.filter(e=>!actionable(e)).map(e=>e.id),
    unplannedLegacy:Object.values(projected.events).filter(e=>!e.eventKind&&!terminalEvent(e)&&!e.estimatedEndAt).map(e=>e.id),
    policy:'到期只要求评估，不代表完成。按预计时间和来源依赖在同一次World请求处理；终结或给出理由延期到窗口之后。场内缺少实际事实时不代主角行动；旧缺规划记录不补造历史日期。无后续必要就结束清理，不强制承接。'};
}
