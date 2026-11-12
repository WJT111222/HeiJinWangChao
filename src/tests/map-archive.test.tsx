import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {mapProjection} from '../ui/panels/mapView';
import {MapPanel} from '../ui/panels/MapPanel';
import {playerView} from '../ui/panels/playerView';
import {GameStateSchema} from '../domain/state';
import {mapArchiveState} from './fixtures/mapArchive';
test('多根、海外、跨城父级和五级链只按正式ID投影，当前位置和原顺序不变',()=>{
 const state=mapArchiveState(),before=structuredClone(state),view=playerView(state),p=mapProjection(view.locations,state.protagonist.locationId,view.npc);
 expect(p.currentPath.map(n=>n.id)).toEqual(['chongqing','map-region','map-street','map-old-block','map-cafe']);
 expect(p.path('map-cross-city').map(n=>n.id)).toEqual(['map-overseas','map-abroad','map-cross-city']);
 expect(p.descendants.get('map-region')).toBe(4);expect(p.people.get('map-region')).toBe(1);
 expect(p.order).toHaveLength(view.locations.length);expect(new Set(p.order.map(n=>n.id)).size).toBe(view.locations.length);expect(state).toEqual(before);
});
test.each([
 [{id:'one',name:'孤立档案',parentId:'missing'}],
 [{id:'one',name:'自指档案',parentId:'one'}],
 [{id:'one',name:'循环一',parentId:'two'},{id:'two',name:'循环二',parentId:'one'},{id:'three',name:'循环下级',parentId:'two'}],
].map(locations=>[locations]))('异常显示输入全部可达且不改原始关系：%j',locations=>{
 const before=structuredClone(locations),p=mapProjection(locations,'one');expect(p.order).toHaveLength(locations.length);expect(p.issues.size).toBeGreaterThan(0);expect(p.path('one').length).toBeGreaterThan(0);expect(locations).toEqual(before);
 const state=mapArchiveState();Object.assign(state.locations,Object.fromEntries(locations.map(p=>[p.id,p])));expect(GameStateSchema.safeParse(state).success).toBe(false);
 const html=renderToStaticMarkup(<MapPanel view={{...playerView(mapArchiveState()),locations}} onNpc={()=>{}} onEvent={()=>{}}/>);for(const p of locations)expect(html).toContain(p.name);
});
test('根地点无下级、缺失当前位置和深层叶子均安全，不根据名字生成行政关系',()=>{
 const places=Array.from({length:80},(_,i)=>({id:`deep-${i}`,name:i?'同名城市':'特殊根',...(i?{parentId:`deep-${i-1}`}:{})})),p=mapProjection(places,'absent');
 expect(p.currentPath).toEqual([]);expect(p.path('deep-79')).toHaveLength(80);expect(p.descendants.get('deep-0')).toBe(79);expect(p.leaves('deep-0').map(n=>n.id)).toEqual(['deep-79']);
 expect(mapProjection([],'none').roots).toEqual([]);
});
test('地点卡保留真实详情与精确关联，资产沿用主角口径，阅读不写入',()=>{
 const state=mapArchiveState(),before=structuredClone(state),view=playerView(state),html=renderToStaticMarkup(<MapPanel view={view} onNpc={()=>{}} onEvent={()=>{}}/>);
 for(const value of ['街角阅览室','map-cafe','map-old-block','地点资料','陆澄','主角未确认','临江旧城档案修复工程','沿江小住宅']){
  expect(html).toContain(value);
 }
 expect(html).not.toContain('经纬度');expect(html).not.toContain('移动到');expect(html).not.toContain('自动寻路');expect(state).toEqual(before);
});
test('大型集合按50个树节点、20个示意区域分段显示，完整数据仍在只读投影',()=>{
 const state=mapArchiveState(250),before=structuredClone(state),view=playerView(state),p=mapProjection(view.locations,view.protagonist.locationId);
 expect(p.descendants.get('map-region')).toBe(254);const html=renderToStaticMarkup(<MapPanel view={view} onNpc={()=>{}} onEvent={()=>{}}/>);
 expect(html).toContain('显示更多地点');expect(html).not.toContain('地点档案249');expect(p.nodes.has('map-extra-0249')).toBe(true);expect(state).toEqual(before);
});
