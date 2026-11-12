import { expect,test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { archiveReadingState } from './fixtures/archiveReading';
import { playerView } from '../ui/panels/playerView';
import { WorldEventsPanel } from '../ui/panels/WorldEventsPanel';
import { HistoryPanel } from '../ui/panels/HistoryPanel';
import { MemoryPanel } from '../ui/panels/MemoryPanel';
import type { Level,MemoryUiState } from '../ui/panels/MemoryPanel';
import { eventArchive,eventFamily } from '../ui/panels/eventArchive';
import { historyProjection } from '../domain/history/projection';
import { historyTimeLabel } from '../domain/history/time';
const memoryState=(level:Level):MemoryUiState=>({level,query:'',memoryQuery:'',page:0,sourceIds:[],sourcePage:0});
test('夹具通过现有Schema，世界并行阶段和退休成果保持正式投影，只读绘制不变',()=>{
 const state=archiveReadingState(),before=structuredClone(state),view=playerView(state),archive=eventArchive(view),family=eventFamily(archive,'main-stage',view.worldClock);
 expect(family.running.map(e=>e.id)).toEqual(['publicity','rescue','investigation']);expect(family.ended.map(e=>e.id)).toContain('retired-stage');
 const html=renderToStaticMarkup(<WorldEventsPanel view={view} desktop uiState={{query:'',page:0,selection:{id:'main-stage',origin:'active'}}}/>);
 for(const text of ['并行阶段','材料抢救','独立资料核查','已退役的纸本修复阶段','未来纸本复查','预计整体结束','（预计）','完整技术记录','其他事件家族资料','旧版独立事件资料','任务进展'])expect(html).toContain(text);
 expect(html).not.toContain('倒计时');expect(state).toEqual(before);
});
test('退役阶段原文及已核实/转述/推测完整保留；缺失成果不补造',()=>{
 const view=playerView(archiveReadingState());
 let html=renderToStaticMarkup(<WorldEventsPanel view={view} desktop uiState={{query:'',page:0,selection:{id:'main-stage',origin:'active',stageId:'retired-stage'}}}/>);
 for(const text of ['陆澄','青禾修复学社','完整阶段经过终点','已核实事实','转述（未核实）','推测','退役保留档案'])expect(html).toContain(text);
 html=renderToStaticMarkup(<WorldEventsPanel view={view} desktop uiState={{query:'',page:0,selection:{id:'oldRetired',origin:'legacy'}}}/>);
 for(const text of ['开始时间','未保留','oldRetired'])expect(html).toContain(text);expect(html).not.toContain('成果分类');expect(html).not.toContain('未知背景');
});
test('双轨只取既有历史投影与精度，未知、范围和毫秒时间原样可读',()=>{
 const state=archiveReadingState(),before=structuredClone(state),view=playerView(state),projection=historyProjection(view.timeline);
 const html=renderToStaticMarkup(<HistoryPanel view={view} desktop/>);
 const keys=[...html.matchAll(/data-time-key="([^"]+)"/g)].map(m=>m[1]);expect(keys).toEqual(projection.slots.slice(0,12).map(s=>s.key));
 for(const entry of view.timeline.filter(e=>e.chronicle)){
  const detail=renderToStaticMarkup(<HistoryPanel view={view} desktop uiState={{tab:'chronicles',query:'',year:'all',page:0,selected:entry.id,groupPages:{}}}/>);
  expect(detail).toContain(historyTimeLabel(entry.chronicle!.time));expect(detail).toContain(entry.chronicle!.narrative);
 }
 expect(state).toEqual(before);
});
test.each(['immediate','short','medium','long','npc','archive'] as const)('记忆 %s 层保留正式来源和内容，无维护或写操作入口',level=>{
 const state=archiveReadingState(),before=structuredClone(state),view=playerView(state);
 const html=renderToStaticMarkup(<MemoryPanel view={view} desktop uiState={memoryState(level)}/>);
 expect(html).toContain('阅读不会让主角或其他人物自动知情');expect(html).not.toContain('立即总结');expect(html).not.toContain('重新 Roll');
 if(level==='long')expect(html).toContain('长期原文终点');
 if(level==='medium'){expect(html).toContain('内部世界记录 · 不代表任何角色已知');expect(html).toContain('资料修复的中期约定');}
 if(level==='npc'){expect(html).toContain('人物私有记录 · 不代表主角已知');expect(html).toContain('人物自己的资料核查总结');}
 if(!['immediate','archive'].includes(level))expect(html).toContain('记忆来源记录');
 expect(state).toEqual(before);
});
test('多来源原文选择、正式归属与未知时间不伪造，分页有界',()=>{
 const state=archiveReadingState(90),before=structuredClone(state),view=playerView(state);
 const source=renderToStaticMarkup(<MemoryPanel view={view} desktop uiState={{...memoryState('medium'),sourceIds:state.journal.slice(0,25).map(t=>t.turnId)}}/>);
 expect(source).toContain('来源回合选择');expect(source).toContain('后续来源');
 const panel=renderToStaticMarkup(<MemoryPanel view={view} desktop uiState={{...memoryState('long'),sourceId:state.journal[0].turnId}}/>);
 expect(panel).toContain('摘要来源原文');expect(panel).toContain(state.journal[0].story.narrative);
 const unknown=renderToStaticMarkup(<MemoryPanel view={{...view,memories:view.memories.map(m=>({...m,createdAtGameTime:undefined}))}} desktop uiState={memoryState('medium')}/>);
 expect(unknown).toContain('历史回合时间未记录');
 const large=renderToStaticMarkup(<WorldEventsPanel view={view} desktop uiState={{query:'',page:0,selection:{id:'main-stage',origin:'active'}}}/>);
 expect(large).toContain('每页 20 条');expect((large.match(/aria-label="查看主事件/g)??[])).toHaveLength(20);
 expect(state).toEqual(before);
});
