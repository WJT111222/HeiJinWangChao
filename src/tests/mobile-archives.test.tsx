import { expect,test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mobileArchivesState } from './fixtures/mobileArchives';
import { playerView,money } from '../ui/panels/playerView';
import { MapPanel } from '../ui/panels/MapPanel';
import { EconomyPanel } from '../ui/panels/EconomyPanel';
import { InventoryPanel } from '../ui/panels/InventoryPanel';
import { HistoryPanel } from '../ui/panels/HistoryPanel';
import { mapProjection } from '../ui/panels/mapView';
import { amountSummary,ownedAssets } from '../ui/panels/economyView';

test('手机地图使用安全森林、直接下级、真实人数和同一地点详情，无递归树和写入',()=>{
 const state=mobileArchivesState(),before=structuredClone(state),view=playerView(state);
 const html=renderToStaticMarkup(<MapPanel view={view} mobile onNpc={()=>{}} onEvent={()=>{}}/>);
 for(const text of ['逐层地点地图','地图层级','定位到我','街角阅览室','主角未确认','陆澄'])expect(html).toContain(text);
 expect(html).not.toContain('旧宿舍');expect(html).not.toContain('class="map-tree"');expect(html).not.toContain('自动寻路');expect(state).toEqual(before);
});
test.each([
 [{id:'a',name:'孤立地点',parentId:'absent'}],
 [{id:'a',name:'循环一',parentId:'b'},{id:'b',name:'循环二',parentId:'a'}],
 [],
].map(locations=>[locations]))('异常手机地图仍完整可达并保留原始层级 %j',locations=>{
 const state=mobileArchivesState(),before=structuredClone(locations),view={...playerView(state),locations};
 const map=mapProjection(locations,'unknown');expect(map.order.length).toBe(locations.length);
 const html=renderToStaticMarkup(<MapPanel view={view} mobile onNpc={()=>{}} onEvent={()=>{}}/>);
 expect(html).toContain('定位到我');for(const p of locations)expect(html).toContain(p.name);expect(locations).toEqual(before);
});
test('深层和大量地点展示不递归展开整棵树，真实森林保持完整',()=>{
 const view=playerView(mobileArchivesState());view.locations=Array.from({length:1500},(_,i)=>({id:`depth-${i}`,name:`深层地点${i}`,...(i?{parentId:`depth-${i-1}`}:{})}));
 view.protagonist={...view.protagonist,locationId:'depth-1499'};
 const html=renderToStaticMarkup(<MapPanel view={view} mobile onNpc={()=>{}} onEvent={()=>{}}/>);
 expect(html).not.toContain('class="map-tree"');expect(html).toContain('深层地点1499');expect(mapProjection(view.locations,view.protagonist.locationId).currentPath).toHaveLength(1500);
});
test('手机经济复用已知/未知合计和正式分值；取消收入仍是取消',()=>{
 const state=mobileArchivesState(),before=structuredClone(state),view=playerView(state);
 view.economy={...view.economy,cash:null};
 const html=renderToStaticMarkup(<EconomyPanel view={view} mobile/>),total=amountSummary(ownedAssets(view).map(a=>a.estimatedValue));
 expect(html).toContain('经济分类');expect(html).toContain('未偿本金合计');expect(html.replace(/<[^>]+>/g,'')).toContain(money(total.amount));expect(html).toContain('合计不完整');expect(html).toContain(money(null));expect(html).toContain('已取消');expect(html).not.toContain('他人资产不应显示');expect(state).toEqual(before);
});
test('物品仍仅属主角；旧物品估值、同组历史及史料不因手机展示改变',()=>{
 const state=mobileArchivesState(),before=structuredClone(state),view=playerView(state);
 const inventory=renderToStaticMarkup(<InventoryPanel view={view}/>),history=renderToStaticMarkup(<HistoryPanel view={view}/>);
 expect(inventory).toContain('全部，9种物品');expect(inventory).not.toContain('他人物品不应显示');expect(inventory).not.toContain('无主物品不应显示');
 expect(history).toContain('统一历史主轴');expect(history).toContain('纪事范围');expect(history).toContain('时间待考');expect(history).toContain('史料记录');expect(state).toEqual(before);
});
