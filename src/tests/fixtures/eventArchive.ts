import { stageContext, mainStage, subStage, endStage, stageStart, stageNow } from './eventStages';
import { event, npc, task } from './game';
import { GameStateSchema } from '../../domain/state';
import type { WorldEvent, RetiredEvent } from '../../domain/events/schema';
import { historyEntry, chronicle } from './historyV2';
export function retiredArchiveEvent(e:WorldEvent):RetiredEvent {
  return {id:e.id,status:e.status==='cancelled'?'cancelled':'resolved',retiredAt:stageNow,eventKind:e.eventKind,parentEventId:e.parentEventId,
    startAt:e.startAt,fixedEndAt:e.fixedEndAt,sourceTurnIds:e.sourceTurnIds,linkedTaskIds:e.linkedTaskIds,predecessorEventIds:e.predecessorEventIds??[],
    detail:{title:e.title,startAt:e.startAt,estimatedEndAt:e.estimatedEndAt,resolvedAt:e.resolvedAt,actorRefs:e.actorRefs,locationId:e.locationId,
      visibility:e.visibility,impact:e.impact,resolutionText:e.resolutionText,resultKnowledge:e.resultKnowledge,outcome:e.outcome}};
}
/** Fictional display fixture, validated as V6; no player conversations or production data. */
export function eventArchiveState(extra=0) {
  const {state}=stageContext();state.worldClock=stageNow;state.events={};
  state.organizations['org-stage-a'].name='临江公共事务中心';state.organizations['org-stage-b'].name='青禾修复学社';
  state.npc['archive-researcher']={...npc('archive-researcher'),name:'陆澄',onScene:false};
  const main={...mainStage(),status:'active' as const,title:'临江旧城档案修复工程',locationId:'chongqing',backgroundText:'旧城档案在搬迁中受损，公共事务中心与修复学社分别开展核对和修复。\n双方保留独立职责，不以展示顺序决定行动顺序。',goalText:'保存原始资料，完成可追溯的修复档案。',sourceTurnIds:[]};
  state.events[main.id]=main;state.events.blockedMain={...main,id:'blockedMain',title:'桥南资料移交协作',status:'blocked'};
  state.events.scheduledMain={...main,id:'scheduledMain',title:'尚未开始的馆藏计划',status:'scheduled',startAt:'2027-05-01T00:00:00+08:00',estimatedEndAt:'2027-09-01T00:00:00+08:00'};
  const closed={...main,id:'closedMain',title:'已结案但仍有跟进阶段的工程',status:'resolved' as const,resolvedAt:'2027-03-01T00:00:00+08:00',outcome:'success' as const,resolutionText:'总体工程结案，剩余核对仍正常推进。'};
  state.events[closed.id]=closed;state.events.cancelledMain={...closed,id:'cancelledMain',title:'已取消的搬迁计划',status:'cancelled',outcome:'cancelled'};
  const retiredParent={...closed,id:'retiredMain',title:'退役家族的后续资料核查'};state.retiredEvents[retiredParent.id]=retiredArchiveEvent(retiredParent);
  for(const [id,title,status,org] of [['rescue','材料抢救','active','org-stage-a'],['investigation','独立资料核查','active','org-stage-b'],['publicity','对外资料说明','blocked','org-stage-b']] as const)
    state.events[id]={...subStage(id,stageStart,'2027-05-15T00:00:00+08:00'),title,status,actorRefs:[{kind:'organization',id:org}],sourceTurnIds:[]};
  const ended=[['finished','首批修复','success'],['failed','第一轮查找','failure'],['early','现场核对提前结束','changed'],['cancelled','取消旧批次转移','cancelled']] as const;
  for(const [id,title,outcome] of ended){const e={...endStage(subStage(id),outcome),title,sourceTurnIds:[]};if(id==='early')e.resolvedAt='2027-01-02T00:00:00+08:00';state.events[id]=e;}
  const retired={...endStage(subStage('retired-stage')) ,title:'已退役的纸本修复阶段',sourceTurnIds:[],actorRefs:[{kind:'npc' as const,id:'archive-researcher'},{kind:'organization' as const,id:'org-stage-b'}],resolutionText:'纸本完成分类核对，保留了原始编号。\n'+('修复人员记录了处理过程，并将疑点留在后续档案中。'.repeat(60))+'完整阶段经过终点。'};
  state.retiredEvents[retired.id]=retiredArchiveEvent(retired);
  state.events.investigation.predecessorEventIds=[retired.id];state.events.investigation.startAt='2027-01-04T00:00:00+08:00';
  state.events.future={...subStage('future','2027-05-01T00:00:00+08:00','2027-06-01T00:00:00+08:00'),status:'scheduled',title:'未来纸本复查',sourceTurnIds:[]};
  state.events.closedChild={...subStage('closedChild',stageStart,'2027-06-01T00:00:00+08:00'),parentEventId:closed.id,title:'结案家族的独立跟进',sourceTurnIds:[]};
  state.events.retiredChild={...subStage('retiredChild',stageStart,'2027-06-01T00:00:00+08:00'),parentEventId:retiredParent.id,title:'退役家族仍活动的核查',sourceTurnIds:[]};
  state.events.legacy={...event('legacy'),title:'旧版独立会面记录',visibility:'hidden',sourceTurnIds:[]};
  state.retiredEvents.oldRetired={id:'oldRetired',status:'resolved',retiredAt:stageNow,sourceTurnIds:[],linkedTaskIds:[],predecessorEventIds:[]};
  state.tasks['archive-task']={...task('archive-task'),goal:'后续材料核对任务',actorRef:{kind:'npc',id:'archive-researcher'},status:'blocked'};
  const h=historyEntry('archive-history',{...chronicle('archive-world-history',{precision:'instant',at:stageStart}),category:'world',scope:'region',scopeText:'临江地区',basis:'event_result',endTime:{precision:'instant',at:closed.resolvedAt}});
  state.timeline=[{...h,title:'临江档案修复正式结案',summary:'工程实际完成，总体结案后的核对继续进行。',eventId:closed.id,recordedAt:stageNow}];
  for(let i=0;i<extra;i++){const id=`extra-main-${String(i).padStart(4,'0')}`;state.events[id]={...main,id,title:`地方档案工程${i}`,backgroundText:'合成工程背景。'.repeat(80)};}
  return GameStateSchema.parse(state);
}
