import type {ReactNode} from 'react';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {PlayerView} from './playerView';
import {mapProjection} from './mapView';
import type {MapUiState,Place} from './mapView';
import {WorldRecord,RecordList} from './WorldRecord';
import {Empty} from '../Dialog';
import {openingCity} from '../../domain/openingCity';
import {eventArchive,eventStatusLabels} from './eventArchive';
import {ownedAssets} from './economyView';

function MapRecords<T>({label,entries,text,render}:{label:string;entries:readonly T[];text:(entry:T)=>string;render:(entry:T)=>ReactNode}){
 return entries.length>20?<RecordList label={label} entries={entries} text={text} render={render}/>:<section aria-label={label}>{entries.length?entries.map((e,i)=><div key={i}>{render(e)}</div>):<Empty>暂无记录</Empty>}</section>;
}
const rivers={cq:<><path d="M-20 60 C160 40 260 150 420 120 S700 40 900 90"/><path className="thin" d="M380 260 C420 200 400 150 430 118"/><text x="610" y="58">长江</text><text x="360" y="250">嘉陵江</text></>,sh:<><path d="M120 -10 C200 80 140 170 260 240 S520 290 700 320"/><text x="300" y="232">黄浦江</text></>,hrb:<><path d="M-20 40 C200 70 420 20 900 60"/><text x="520" y="34">松花江</text></>,gz:<><path d="M-20 200 C200 170 380 230 560 200 S800 170 900 190"/><text x="420" y="196">珠江</text></>};
export function MapPanel({view,initialId,uiState,onUiStateChange,onNpc,onEvent,mobile=false}:{view:PlayerView;mobile?:boolean;initialId?:string;uiState?:MapUiState;onUiStateChange?:(state:MapUiState)=>void;onNpc:(id:string)=>void;onEvent:(id:string)=>void}){
 const map=useMemo(()=>mapProjection(view.locations,view.protagonist.locationId,view.npc),[view.locations,view.protagonist.locationId,view.npc]);
 // A phone cross-archive target is a navigation request, above saved reading state.
 const target=mobile&&initialId&&map.nodes.has(initialId)?initialId:undefined;
 const savedSelected=uiState?.selected&&map.nodes.has(uiState.selected)?uiState.selected:undefined;
 const fallback=map.nodes.has(view.protagonist.locationId)?view.protagonist.locationId:map.roots[0]?.id;
 const phoneSelected=target??savedSelected??fallback;
 const savedLayer=uiState&&Object.hasOwn(uiState,'layer')&&savedSelected&&(!uiState.layer||map.nodes.has(uiState.layer));
 function revealTarget(previous:Record<string,number>,id:string){
  const parent=map.parent.get(id),siblings=parent?map.children.get(parent)??[]:map.roots,key=`mobile:${parent??'roots'}`;
  return {...previous,[key]:Math.max(previous[key]??50,siblings.findIndex(p=>p.id===id)+1)};
 }
 const [selected,setSelected]=useState(mobile?phoneSelected:initialId??uiState?.selected??view.protagonist.locationId),[expanded,setExpanded]=useState(()=>new Set(uiState?.expanded??map.currentPath.map(p=>p.id))),[query,setQuery]=useState(target?'':uiState?.query??''),[limits,setLimits]=useState<Record<string,number>>(()=>target?revealTarget(uiState?.limits??{},target):uiState?.limits??{});
 const [layerId,setLayerId]=useState<string|undefined>(mobile?(target?map.parent.get(target):savedLayer?uiState?.layer:map.parent.get(phoneSelected??'')):uiState?.layer??map.parent.get(initialId??selected??''));
 const lastInitialId=useRef(initialId);
 const layerTitle=useRef<HTMLHeadingElement>(null);
 const main=useRef<HTMLElement>(null),treePane=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),pendingFocus=useRef(Boolean(initialId));
 useEffect(()=>{onUiStateChange?.({selected,expanded:[...expanded],query,limits,...(mobile?{layer:layerId}: {})});},[selected,expanded,query,limits,layerId,mobile,onUiStateChange]);
 useEffect(()=>{if(pendingFocus.current){pendingFocus.current=false;if(mobile){layerTitle.current?.focus({preventScroll:true});return;}heading.current?.focus({preventScroll:true});const card=heading.current?.closest('.place-card');if(card&&main.current)main.current.scrollTop+=card.getBoundingClientRect().top-main.current.getBoundingClientRect().top-12;const node=[...(treePane.current?.querySelectorAll<HTMLElement>('[data-location-id]')??[])].find(n=>n.dataset.locationId===selected);if(node&&treePane.current){const box=node.getBoundingClientRect(),pane=treePane.current.getBoundingClientRect();if(box.top<pane.top||box.bottom>pane.bottom)treePane.current.scrollTop+=box.top-pane.top-20;}}},[selected,expanded,mobile]);
 const place=map.nodes.get(selected)??map.nodes.get(view.protagonist.locationId)??map.roots[0],path=place?map.path(place.id):[],root=path[0],chain=new Set(path.map(p=>p.id)),me=new Set(map.currentPath.map(p=>p.id));
 // Consume only a changed target; rerenders must not undo manual drill/search/breadcrumbs.
 useEffect(()=>{
  if(!mobile)return;
  const changed=lastInitialId.current!==initialId;lastInitialId.current=initialId;
  const next=changed&&target?target:!map.nodes.has(selected??'')?fallback:undefined;
  if(next){pendingFocus.current=true;setSelected(next);setLayerId(map.parent.get(next));setQuery('');setExpanded(previous=>new Set([...previous,...map.path(next).map(p=>p.id)]));setLimits(previous=>revealTarget(previous,next));}
  else if(layerId&&!map.nodes.has(layerId))setLayerId(map.parent.get(selected??''));
 },[mobile,initialId,map,selected,layerId,target,fallback]);
 const needle=query.trim().toLocaleLowerCase(),matches=needle?view.locations.filter(p=>p.name.toLocaleLowerCase().includes(needle)):view.locations,visible=mobile?new Set<string>():new Set(matches.flatMap(p=>map.path(p.id).map(n=>n.id)));
 function choose(id:string){if(!map.nodes.has(id))return;pendingFocus.current=true;setSelected(id);setExpanded(prev=>new Set([...prev,...map.path(id).map(p=>p.id)]));if(needle&&!visible.has(id))setQuery('');
  setLimits(prev=>{const next={...prev};for(const p of map.path(id)){const up=map.parent.get(p.id),siblings=up?map.children.get(up)??[]:map.roots;next[up??'__roots__']=Math.max(next[up??'__roots__']??50,siblings.findIndex(n=>n.id===p.id)+1);}return next;});
 }
 const more=(key:string,total:number,base=50)=>(limits[key]??base)<total?<button className="map-more" onClick={()=>setLimits(p=>({...p,[key]:(p[key]??base)+base}))}>显示更多地点 · 尚余 {total-(limits[key]??base)}</button>:null;
 const tree=(rows:Place[],depth=0,key='__roots__')=>{const entries=rows.filter(p=>!needle||visible.has(p.id));return <><ul className="map-tree">{entries.slice(0,limits[key]??50).map(p=>{const ks=map.children.get(p.id)??[],open=expanded.has(p.id);return <li key={p.id} className={depth===0?'mt-lv0':undefined}>
  <div className="mt-line">{ks.length?<button className={`mt-tog ${open?'open':''}`} aria-label={`${open?'收起':'展开'}${p.name}`} aria-expanded={open} onClick={()=>setExpanded(prev=>{const next=new Set(prev);if(next.has(p.id))next.delete(p.id);else next.add(p.id);return next;})}>▶</button>:<span className="mt-tog leaf" aria-hidden="true"/>}
   <button className="mt-row" data-location-id={p.id} aria-label={`查看地点：${p.name}`} aria-pressed={place?.id===p.id} onClick={()=>choose(p.id)}><span className="mt-name" title={p.name}>{p.name}</span>{p.id===view.protagonist.locationId&&<span className="here" aria-label="主角当前位置">你</span>}{ks.length>0&&<span className="mt-n">{map.descendants.get(p.id)??0}</span>}</button></div>
  {open&&ks.length>0&&tree(ks,depth+1,p.id)}
 </li>;})}</ul>{more(key,entries.length)}</>;};
 const city=root&&openingCity(root.id),districts=root?map.children.get(root.id)??[]:[];
 const pin=(p:Place)=><button key={p.id} className={`pin ${chain.has(p.id)?'on':''} ${p.id===view.protagonist.locationId?'me':''}`} data-map-pin={p.id} aria-pressed={place?.id===p.id} onClick={()=>choose(p.id)}>{p.name}{(map.people.get(p.id)??0)>0&&<span className="ppl">{map.people.get(p.id)}</span>}</button>;
 const people=view.npc.filter(n=>n.locationId===place?.id),usual=view.npc.flatMap(n=>(n.usualLocations??[]).filter(p=>p.locationId===place?.id).map(p=>({npc:n,...p})));
 const events=[...eventArchive(view).records.values()].filter(e=>e.detail?.locationId===place?.id),assets=ownedAssets(view).filter(a=>(a.kind==='property'||a.kind==='vehicle')&&a.locationId===place?.id);
 const layer=layerId?map.nodes.get(layerId):undefined,layerPath=layer?map.path(layer.id):[];
 const layerCity=layerPath[0]&&openingCity(layerPath[0].id);
 const zones=layer?map.children.get(layer.id)??[]:map.roots,zoneKey=`mobile:${layer?.id??'roots'}`;
 function drill(id:string){choose(id);if(map.children.get(id)?.length)setLayerId(id);}
 const phoneMap=<section className="mobile-map" aria-label="逐层地点地图">
  <label className="search">搜索地点<input value={query} maxLength={4000} onChange={e=>setQuery(e.target.value)} placeholder="按地点名称查找"/></label>
  {needle?<section className="map-search-results" aria-label="地点搜索结果">{matches.slice(0,limits['mobile-search']??50).map(p=><button key={p.id} onClick={()=>{choose(p.id);setLayerId(map.parent.get(p.id));setQuery('');}}><strong>{p.name}</strong><small>{map.path(p.id).slice(0,-1).map(x=>x.name).join(' › ')||'层级根地点'}</small></button>)}{!matches.length&&<Empty>没有找到匹配的地点</Empty>}{more('mobile-search',matches.length)}</section>:<>
   <nav className="map-breadcrumb" aria-label="地图层级"><button aria-current={!layer?'location':undefined} onClick={()=>setLayerId(undefined)}>全部地点</button>{layerPath.map(p=><button key={p.id} aria-current={p.id===layer?.id?'location':undefined} onClick={()=>{setLayerId(p.id);choose(p.id);}}>{p.name}</button>)}</nav>
   <section className="mobile-map-box" aria-label="当前层区域示意"><h4 ref={layerTitle} tabIndex={-1}>{layer?.name??'全部已记录地点'}</h4><small>地点层级示意 · 非地理地图</small>
    {layerCity&&<svg className="river" viewBox="0 0 880 320" preserveAspectRatio="none" aria-hidden="true">{rivers[layerCity.key]}</svg>}
    <div className="map-zones">{zones.slice(0,limits[zoneKey]??50).map(p=>{const kids=map.children.get(p.id)??[];return <button className={`map-zone ${chain.has(p.id)?'on':''} ${me.has(p.id)?'has-me':''}`} key={p.id} data-location-id={p.id} aria-label={`查看地点：${p.name}`} aria-pressed={place?.id===p.id} onClick={()=>drill(p.id)}><strong>{p.name}</strong><small>{map.descendants.get(p.id)??0} 处地点 · {map.people.get(p.id)??0} 人</small><span className="map-zone-tags">{kids.slice(0,4).map(k=><span key={k.id}>{k.name}</span>)}</span>{me.has(p.id)&&<i className="map-you" aria-label="主角所在链">你</i>}{kids.length>0&&<span className="map-chevron" aria-hidden="true">›</span>}</button>;})}</div>
    {!zones.length&&<Empty>该地点尚无下级地点记录</Empty>}{more(zoneKey,zones.length)}
    <button className="map-locate" disabled={!map.nodes.has(view.protagonist.locationId)} onClick={()=>{choose(view.protagonist.locationId);setLayerId(map.parent.get(view.protagonist.locationId));setQuery('');}}>定位到我</button>
   </section>
  </>}
 </section>;
 return <div className="mp" data-mobile={mobile||undefined}>{mobile&&phoneMap}{!mobile&&<section className="mp-tree" ref={treePane} aria-label="地点层级"><p className="muted">全部已记录地点 · 地理层级随世界发展扩展。</p><label className="f-label">搜索地点<input className="f-input search" value={query} maxLength={4000} onChange={e=>{const value=e.target.value;setQuery(value);if(value.trim())setExpanded(prev=>new Set([...prev,...view.locations.filter(p=>p.name.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())).flatMap(p=>map.path(p.id).map(n=>n.id))]));}} placeholder="按地点名称查找"/></label>
  {tree(map.roots)}{!matches.length&&<Empty>暂无符合条件的地点。</Empty>}</section>}
  <section className="mp-main map-surface" ref={main} aria-label="地点详情">{place&&root?<>
   {!mobile&&<section className="city-map" data-city={city?.key??'other'} aria-label="地点层级示意"><div className="cm-hd"><h4>{root.name}</h4><span className="en">地点层级示意 · 非地理地图</span><span className="legend"><span><span className="here" aria-hidden="true">你</span>主角所在</span><span>虚线框 = 下级区域</span><span>◆ = 末级地点</span></span></div>
    {city&&<svg className="river" viewBox="0 0 880 320" preserveAspectRatio="none" aria-hidden="true">{rivers[city.key]}</svg>}
    <div className="cm-body">{districts.length?districts.slice(0,limits['diagram']??20).map(d=><section key={d.id} className={`district ${chain.has(d.id)?'on':''} ${me.has(d.id)?'has-me':''}`}>
     <button className="dn" onClick={()=>choose(d.id)}>{d.name}{me.has(d.id)&&<span className="here" aria-label="主角在此区域内">你</span>}<small>{map.people.get(d.id)??0} 人</small></button>
     <div className="blocks">{(map.children.get(d.id)??[]).slice(0,limits[`blocks:${d.id}`]??20).map(b=><section key={b.id} className={`block ${chain.has(b.id)?'on':''}`}><button className="bn" onClick={()=>choose(b.id)}>{b.name}</button><div className="pins">{(map.children.get(b.id)?.length?map.leaves(b.id):[b]).slice(0,limits[`pins:${b.id}`]??20).map(pin)}</div>{more(`pins:${b.id}`,map.children.get(b.id)?.length?map.leaves(b.id).length:1,20)}</section>)}</div>{more(`blocks:${d.id}`,(map.children.get(d.id)??[]).length,20)}
     {!map.children.get(d.id)?.length&&<div className="pins">{pin(d)}</div>}
    </section>):<Empty>该地点尚无下级地点记录</Empty>}{more('diagram',districts.length,20)}</div>
   </section>}
   <article className="place-card"><nav className="pc-crumb" aria-label="地点路径">{path.map((p,i)=><span key={p.id}>{i>0&&' › '}{i===path.length-1?<span aria-current="location">{p.name}</span>:<button onClick={()=>choose(p.id)}>{p.name}</button>}</span>)}</nav>
    <div className="pc-title"><h3 ref={heading} tabIndex={-1}>{place.name}</h3><span className="lv">{path.length===1?'层级根地点':map.children.has(place.id)?`区域 · 第 ${path.length} 级`:'具体地点'}</span></div>
    {me.has(place.id)&&<span className="pc-here">{place.id===view.protagonist.locationId?'你 · 主角当前所在':'主角在此区域内'}</span>}
    {map.issues.has(place.id)&&<p className="map-issue" role="note">{map.issues.get(place.id)}</p>}
    {Boolean(map.children.get(place.id)?.length)&&<section className="sec"><h4>下级地点</h4><div className="kids">{(map.children.get(place.id)??[]).slice(0,limits['kids']??50).map(p=><button key={p.id} onClick={()=>mobile?drill(p.id):choose(p.id)}>{p.name}<small>{map.descendants.get(p.id)??0}</small></button>)}</div>{!map.children.get(place.id)?.length&&<Empty>暂无下级地点</Empty>}{more('kids',(map.children.get(place.id)??[]).length)}</section>}
    <div className="pc-grid"><section className="sec"><h4>此地人物</h4><p className="derived-note">按人物当前位置汇总</p><MapRecords label="此地人物" entries={people} text={n=>n.name} render={n=><p className="who-row"><span className="seal" aria-hidden="true">{Array.from(n.name)[0]}</span><button className="link-btn" onClick={()=>onNpc(n.id)}>{n.name}</button><span className="pill">{n.onScene?'本幕在场':'场外人物'}</span></p>}/>
     <h5>常驻于此</h5><MapRecords label="常驻人物" entries={usual} text={row=>row.npc.name} render={row=><p className="who-row"><button className="link-btn" onClick={()=>onNpc(row.npc.id)}>{row.npc.name}</button><span className="pill">{{home:'住处',work:'工作地点',frequent:'经常活动'}[row.role]} · {row.knownToProtagonist?'主角已知':'主角未确认'}</span></p>}/></section>
     <section className="sec"><h4>此地动态</h4><MapRecords label="地点事件" entries={events} text={e=>e.title} render={e=><p><button className="link-btn" onClick={()=>onEvent(e.id)}>{e.title}</button> <span className="ev-st">{eventStatusLabels[e.status]}</span></p>}/><h5>主角资产</h5><MapRecords label="地点资产" entries={assets} text={a=>a.name} render={a=><p>{a.name} · {a.kind==='property'?'房产':'车辆'} · {a.statusText}</p>}/></section></div>
    <WorldRecord title="地点资料" value={place}/>
   </article>
  </>:<Empty>尚无地点记录</Empty>}</section>
 </div>;
}
