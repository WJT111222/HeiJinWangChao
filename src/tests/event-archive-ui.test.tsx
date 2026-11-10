import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { playerView } from '../ui/panels/playerView';
import { eventArchive, eventFamily } from '../ui/panels/eventArchive';
import { WorldEventsPanel } from '../ui/panels/WorldEventsPanel';
import { eventArchiveState } from './fixtures/eventArchive';
function frozen<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(frozen);}return value;}
it('主目录仅为active/blocked main，旧事件和其他家族单独只读保留',()=>{
  const state=eventArchiveState(),before=structuredClone(state),view=playerView(state),archive=eventArchive(view);
  expect(archive.active.map(e=>e.id)).toEqual(['blockedMain','main-stage']);expect(archive.active.map(e=>e.status)).toContain('blocked');
  expect(archive.otherFamilies.map(e=>e.id).sort()).toEqual(['cancelledMain','closedMain','retiredMain','scheduledMain']);
  expect(archive.legacy.map(e=>e.id).sort()).toEqual(['legacy','oldRetired']);expect(state).toEqual(before);
});
it('并行阶段、未来阶段和成果分开，成功/失败/变化/取消均保留真实字段',()=>{
  const view=playerView(eventArchiveState()),family=eventFamily(eventArchive(view),'main-stage',view.worldClock);
  expect(family.running.map(e=>e.id).sort()).toEqual(['investigation','publicity','rescue']);expect(family.upcoming.map(e=>e.id)).toEqual(['future']);
  expect(family.ended.map(e=>e.detail?.outcome).sort()).toEqual(['cancelled','changed','failure','success','success']);
  expect(family.ended.find(e=>e.id==='early')).toMatchObject({fixedEndAt:'2027-01-03T00:00:00+08:00',detail:{resolvedAt:'2027-01-02T00:00:00+08:00'}});
});
it('退役阶段保留唯一成果，不以清理时间或固定时间冒充实际结案，不编造背景目标',()=>{
  const view=playerView(eventArchiveState()),archive=eventArchive(frozen(view)),family=eventFamily(archive,'main-stage',view.worldClock),retired=family.ended.find(e=>e.id==='retired-stage')!;
  expect(retired.retired).toBe(true);expect(retired.detail?.resolvedAt).not.toBe((retired.raw as {retiredAt:string}).retiredAt);expect(retired.detail).not.toHaveProperty('backgroundText');expect(retired.detail).not.toHaveProperty('goalText');
  expect(retired.result.resolutionText).toContain('完整阶段经过终点');expect(retired.result.resultKnowledge?.reported).toHaveLength(1);expect(retired.result.actorRefs?.map(a=>a.id)).toContain('archive-researcher');
  const duplicate={...view,retiredEvents:[...view.retiredEvents,{...view.retiredEvents[0],id:'finished'}]};
  expect(eventFamily(eventArchive(duplicate),'main-stage',view.worldClock).ended.filter(e=>e.id==='finished')).toHaveLength(1);
});
it('已结案或退役主事件的活动子事件仍可读取，不将其父改成active',()=>{
  const view=playerView(eventArchiveState()),archive=eventArchive(view);
  for(const [parent,child] of [['closedMain','closedChild'],['retiredMain','retiredChild']]){
    const family=eventFamily(archive,parent,view.worldClock);expect(family.parent?.status).toBe('resolved');expect(family.running.map(e=>e.id)).toContain(child);expect(archive.active.some(e=>e.id===parent)).toBe(false);
  }
  expect(view.timeline[0].chronicle?.time).toEqual({precision:'instant',at:'2027-01-01T00:00:00+08:00'});
});
it('真实阅读组件安全转义，首屏不以技术记录平铺世界；未匹配名称保留ID',()=>{
  const view=playerView(eventArchiveState());view.events.find(e=>e.id==='main-stage')!.title='<img src=x onerror=alert(1)>';view.events.find(e=>e.id==='blockedMain')!.actorRefs=[{kind:'organization',id:'unknown-org-id'}];view.events.find(e=>e.id==='blockedMain')!.locationId='unknown-location-id';const before=structuredClone(view);
  const html=renderToStaticMarkup(<WorldEventsPanel view={frozen(view)}/>);
  expect(html).toContain('unknown-org-id');expect(html).toContain('unknown-location-id');expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');expect(html).toContain('正在发展的主事件');expect(html).toContain('旧版独立事件资料');expect(html).toContain('并行阶段');expect(view).toEqual(before);
});
it('大型资料纯投影稳定，目录分页20条且不生成第二份正式摘要',()=>{
  const state=eventArchiveState(1000),before=JSON.stringify(state),view=playerView(state),started=performance.now(),archive=eventArchive(view);
  expect(archive.active).toHaveLength(1002);expect(eventFamily(archive,'main-stage',view.worldClock).ended).toHaveLength(5);
  const html=renderToStaticMarkup(<WorldEventsPanel view={view}/>);expect((html.match(/class="event-directory-row"/g)??[])).toHaveLength(20);expect(html).toContain('下一页主事件');expect(JSON.stringify(state)).toBe(before);
  console.info('archive synthetic measurement',JSON.stringify({mainRecords:archive.active.length,eventRecords:archive.records.size,sourceBytes:new TextEncoder().encode(before).length,projectionAndRenderMs:performance.now()-started}));
});
it('大阶段目录保留搜索和分页，仅渲染当前20项；少量阶段直接阅读',()=>{
  const state=eventArchiveState();delete state.events.blockedMain;
  for(let i=0;i<40;i++){const id=`extra-stage-${i}`;state.events[id]={...state.events.rescue,id,title:`并行合成阶段${i}`};}
  const view=playerView(state),archive=eventArchive(view);expect(eventFamily(archive,'main-stage',view.worldClock).running).toHaveLength(43);
  const html=renderToStaticMarkup(<WorldEventsPanel view={view}/>),running=html.split('aria-label="正在进行的阶段"')[1].split('</section>')[0];
  expect(running).toContain('搜索正在进行的阶段');expect((running.match(/class="event-stage-row"/g)??[])).toHaveLength(20);expect(running).toContain('下一页');
});
