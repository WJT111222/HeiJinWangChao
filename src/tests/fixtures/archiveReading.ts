import { GameStateSchema } from '../../domain/state';
import { eventArchiveState } from './eventArchive';
import { compressionState } from './compression';
import { historyDisplayCommands, historyEntry, chronicle } from './historyV2';
import { subStage } from './eventStages';

/** Synthetic fixtures only; all records pass the unchanged formal schema. */
export function archiveReadingState(extra=0) {
 const state=eventArchiveState(extra),mem=compressionState('short',70);
 state.title='档案柜阅读验收';state.openingCityId='chongqing';
 state.journal=mem.journal;state.revision=mem.revision;state.turnNumber=mem.turnNumber;
 state.memories=mem.memories;state.npc['npc-a']=mem.npc['npc-a'];
 const base=state.memories.short[0];
 state.memories.medium=[{...base,id:'reading-medium',text:'资料修复的中期约定：各方独立核查；转述仍需核实。',sourceTurnIds:state.journal.slice(0,25).map(t=>t.turnId)}];
 state.memories.long=[{...base,id:'reading-long',text:'长期保留的完整文字。'.repeat(500)+'长期原文终点',sourceTurnIds:state.journal.slice(0,2).map(t=>t.turnId)}];
 state.memories.npcSummaries['npc-a']=[{...base,id:'reading-npc-summary',text:'人物自己的资料核查总结。',visibility:'npc_private'}];
 state.memories.medium.push({...base,id:'reading-internal',text:'后台记录只供玩家观察，不自动成为角色已知。',visibility:'internal'});
 state.timeline.push(...historyDisplayCommands(extra).map(cmd=>({...cmd.entry,recordedAt:state.worldClock,sourceTurnId:state.journal[0].turnId})));
 state.timeline.push(historyEntry('reading-range',chronicle('reading-range',{precision:'range',from:{precision:'year',year:2011},to:{precision:'month',year:2012,month:3},text:'档案仅有时间范围'})));
 state.timeline.push(historyEntry('reading-instant',chronicle('reading-instant',{precision:'instant',at:'2021-06-02T08:09:10.123+08:00'})));
 for(let i=0;i<extra;i++) {
  const id=`reading-parallel-${i}`;
  state.events[id]={...subStage(id,'2027-02-01T00:00:00+08:00','2027-05-01T00:00:00+08:00'),title:`并行资料核查${i}`,sourceTurnIds:[]};
  state.memories.medium.push({...base,id:`reading-memory-${i}`,text:`合成中期资料${i}。`,sourceTurnIds:[state.journal[0].turnId]});
 }
 if(extra){
  state.journal[20].story.narrative='来源正文逐字保留，不进行自动摘要。'.repeat(300)+'来源原文终点';
  state.events['extra-main-0000'].title='长主事件：'+('完整名称与来源记录'.repeat(40))+'W'.repeat(150);
  const long=state.timeline.find(t=>t.id==='hero-opening')!;long.title='长纪事：'+('历史标题保留'.repeat(18));long.chronicle!.narrative='完整历史正文。'.repeat(400)+'历史原文终点';
 }
 // Existing formal organization -> event navigation; never infer links from names.
 state.organizations['org-stage-b'].keyNpcIds=['archive-researcher'];
 state.organizations['org-stage-a'].description='联合核查与历史资料修复。';
 return GameStateSchema.parse(state);
}
