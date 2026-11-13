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

test('手机跨档案目标优先于旧层级、搜索与分页：父层、区域块及详情一致',()=>{
 const view=playerView(mobileArchivesState(80));
 const uiState={selected:'map-cross-city',layer:'map-abroad',expanded:[],query:'旧宿舍',limits:{'mobile:map-region':2}};
 const html=renderToStaticMarkup(<MapPanel view={view} mobile initialId="map-extra-0070" uiState={uiState} onNpc={()=>{}} onEvent={()=>{}}/>);
 expect(html).toMatch(/aria-current="location">沿江资料区<\/button>/);
 expect(html).toMatch(/data-location-id="map-extra-0070" aria-label="查看地点：地点档案70" aria-pressed="true"/);
 expect(html).not.toContain('value="旧宿舍"');expect(html).toContain('地点档案70</h3>');
 expect(uiState).toEqual({selected:'map-cross-city',layer:'map-abroad',expanded:[],query:'旧宿舍',limits:{'mobile:map-region':2}});
});
test('手机普通重开保留合法层级、选中、搜索及全部根地点视图',()=>{
 const view=playerView(mobileArchivesState());
 const props={view,mobile:true,onNpc:()=>{},onEvent:()=>{}};
 const uiState={selected:'map-cross-city',layer:'map-abroad',expanded:[],query:'',limits:{}};
 const saved=renderToStaticMarkup(<MapPanel {...props} uiState={uiState}/>);
 expect(saved).toMatch(/aria-current="location">国外的工作地点<\/button>/);
 expect(saved).toMatch(/data-location-id="map-cross-city"[^>]+aria-pressed="true"/);
 const roots=renderToStaticMarkup(<MapPanel {...props} uiState={{...uiState,layer:undefined}}/>);
 expect(roots).toMatch(/aria-current="location">全部地点<\/button>/);
 const search=renderToStaticMarkup(<MapPanel {...props} uiState={{...uiState,query:'跨城关联'}}/>);
 expect(search).toContain('value="跨城关联"');expect(search).toContain('地点搜索结果');
});
test('手机无效目标与失效阅读引用安全回退；异常父级按原森林定位',()=>{
 const view=playerView(mobileArchivesState()),before=structuredClone(view);
 const props={view,mobile:true,onNpc:()=>{},onEvent:()=>{}};
 const html=renderToStaticMarkup(<MapPanel {...props} initialId="not-recorded" uiState={{selected:'removed',layer:'removed-parent',expanded:[],query:'',limits:{}}}/>);
 expect(html).toMatch(/aria-current="location">旧厂房街区<\/button>/);
 expect(html).toMatch(/data-location-id="map-cafe"[^>]+aria-pressed="true"/);
 expect(html).not.toContain('not-recorded');expect(view).toEqual(before);
 const broken={...view,locations:[{id:'orphan',name:'孤立地点',parentId:'missing'}]};
 const orphan=renderToStaticMarkup(<MapPanel {...props} view={broken} initialId="orphan"/>);
 expect(orphan).toMatch(/aria-current="location">全部地点<\/button>/);
 expect(orphan).toMatch(/data-location-id="orphan"[^>]+aria-pressed="true"/);
 expect(orphan).toContain('上级地点记录缺失');
});
