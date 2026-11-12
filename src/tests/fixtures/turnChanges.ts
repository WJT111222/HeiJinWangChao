import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { eventArchiveState,retiredArchiveEvent } from './eventArchive';
import { npc } from './game';
import { subStage } from './eventStages';
import { chronicle,historyEntry } from './historyV2';
import { createTurnDraft } from '../../domain/drafts';
import { newSaveControl } from '../../services/storage/turnUndo';

/** Isolated display fixture, never design demo data or a production save. */
export function turnChangesPair(extra=0,none=false){
 const source=eventArchiveState();source.openingCityId='chongqing';source.title='回合变化验收档案';
 source.npc['npc-a'].name='裴知远';
 source.revision=2;source.turnNumber=2;
 source.journal=[1,2].map(n=>({turnId:`changes-turn-${n}`,revision:n,story:{turnKind:n===1?'opening' as const:'regular' as const,narrative:'【旁白】你在资料室核对记录。\n\n【裴知远】请把尚未确认的说法单独保存。',summary:'核对记录并保留信息性质。',variableGuide:[]},relatedActorRefs:[],scene:{worldClock:source.worldClock,locationId:source.protagonist.locationId}}));
 const hero={kind:'protagonist' as const,id:source.protagonist.id};
 source.items={jacket:{id:'jacket',name:'棉布外套',category:'top',quantity:1,ownerRef:hero,conditionText:'完好'},clips:{id:'clips',name:'资料夹扣',category:'tool',quantity:10,ownerRef:hero,conditionText:'可用'},oldPaper:{id:'oldPaper',name:'已归还的借阅凭据',category:'document',quantity:1,ownerRef:hero,conditionText:'已登记'}};
 const baseMemory={id:'old-short',text:'此前的公开经历。',sourceTurnIds:['changes-turn-1'],affectedEntityRefs:[],visibility:'player_known' as const,createdAtGameTime:source.worldClock};
 source.memories.short=[baseMemory];
 const before=GameStateSchema.parse(source),after=structuredClone(before);
 after.revision=before.revision+1;after.turnNumber=3;after.updatedAt='2027-04-02T00:00:00+08:00';
 after.journal.push({turnId:'changes-turn-3',revision:after.revision,story:{turnKind:'regular',narrative:'【旁白】整理工作告一段落，你核对了刚才发生的变化。\n\n【裴知远】确认的事实与转述分开保存。\n\n【旁白】窗外的灯光依次亮起，资料室重新安静下来。',summary:'整理资料，保留各自的信息来源。',variableGuide:[],actionOptions:['继续核对资料','稍作休息','询问后续安排']},relatedActorRefs:[],scene:{worldClock:before.worldClock,locationId:before.protagonist.locationId}});
 if(!none){
  after.worldClock=new Date(Date.parse(before.worldClock)+18*60000).toISOString();
  after.weatherText='小雨，风势渐缓';after.environmentText='资料室窗边的灯已亮起，走廊仍有交谈声。';
  after.locations.readingRoom={id:'readingRoom',name:'南桥资料室',parentId:'chongqing'};after.protagonist.locationId='readingRoom';
  after.protagonist.healthText='右肩稍感疲倦，需要短暂休息。';after.protagonist.emotionText='心绪安定，仍有疑问。';after.protagonist.publicStatus='资料整理的参与者';after.protagonist.legalStatus='无新增法律事项';after.protagonist.currentWear.topItemId='jacket';
  after.economy.cash=7200;after.economy.onlineBalance=25000;
  for(const n of Object.values(after.npc))n.onScene=false;
  const person=after.npc['npc-a'];person.onScene=true;person.locationId='readingRoom';person.affinity=34;person.relationshipText='彼此信任，保持独立判断';person.knownInformation=[{text:'南桥将保留原始资料，待进一步核对。',source:'当面确认',learnedAt:after.worldClock}];
  person.memories=[{...baseMemory,id:'npc-report',text:'[转述]来访者说有一份补充记录，尚待核实。',visibility:'npc_private',createdAtGameTime:after.worldClock,knowledgeSource:'来访者转述',knowledgeKind:'reported'}];
  after.npc.newReader={...npc('newReader'),name:'贺书宁',identity:'资料室志愿协作者',onScene:false,locationId:'readingRoom'};
  for(let i=0;i<extra;i++){const id=`changes-extra-${i}`;after.npc[id]={...npc(id),name:i===0?'名录长姓名'.repeat(20)+'W'.repeat(140):`协作人员${i}`,identity:'合成压力资料',onScene:false};}
  after.items.clips.quantity=12;after.items.clips.conditionText='补齐两枚备用夹扣';delete after.items.oldPaper;
  after.items.folder={id:'folder',name:'纸质归档袋',category:'document',quantity:1,ownerRef:hero,conditionText:'新领用',description:'用于分别保留已核实记录与尚未核实的说明。'};
  after.organizations.newGroup={id:'newGroup',name:'南桥互助组',kind:'civil',description:'新建立的资料协作组织，各成员保持独立职责。',protagonistRelation:'参与一次协作',relationHistory:[],keyNpcIds:[],currentTaskIds:[],activities:[]};
  after.organizations['org-stage-b'].protagonistRelation='已确认协作安排';
  after.events['main-stage'].status='blocked';
  for(const id of ['changes-sub-one','changes-sub-two'])after.events[id]={...subStage(id,before.worldClock,'2027-05-15T00:00:00+08:00'),title:id.endsWith('one')?'独立补充记录核对':'并行的资料来源核查',sourceTurnIds:['changes-turn-3']};
  after.events.finished.resultKnowledge={facts:['已完成一批登记'],reported:['来访者提出另一种说法'],suspected:['可能还有一份遗漏清单']};
  after.retiredEvents.failed=retiredArchiveEvent(after.events.failed);delete after.events.failed;
  after.tasks['archive-task'].status='active';
  after.memories.short.push({...baseMemory,id:'changes-turn-3',text:after.journal[2].story.summary,sourceTurnIds:['changes-turn-3'],createdAtGameTime:after.worldClock});
  after.memories.medium.push({...baseMemory,id:'new-medium',text:'将待核实的说法与已确认记录分别保留。'});
  after.memories.long.push({...baseMemory,id:'new-long',text:'长期保留各自独立判断与原始资料来源。'});
  after.timeline.push({...historyEntry('changes-history',chronicle('changes-milestone',{precision:'year',year:2026})),title:'决定保留原始资料',summary:'协作者约定保存来源，并继续核查。',sourceTurnId:'changes-turn-3'});
 }
 return {before,after:GameStateSchema.parse(after)};
}
export function comparisonCheckpoint(before:GameState,after:GameState){
 const latest=after.journal.at(-1)!,snapshot={version:1 as const,saveId:after.saveId,turnId:latest.turnId,beforeTurnId:before.journal.at(-1)!.turnId,input:'核对资料',stateJSON:JSON.stringify(before)};
 const control=newSaveControl(after.saveId);control.records=[{turnId:snapshot.turnId,beforeTurnId:snapshot.beforeTurnId,bytes:new TextEncoder().encode(JSON.stringify(snapshot)).byteLength}];
 return {snapshot,control,draft:createTurnDraft(after.saveId,after.revision,'changes-next-turn','regular','')};
}
