import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Detail, Empty } from '../Dialog';
import { RecordList, WorldRecord } from './WorldRecord';
import { dateTime } from './playerView';
import type { PlayerView } from './playerView';
import { eventArchive, eventFamily, eventImpactLabels, eventOutcomeLabels, eventStatusLabels } from './eventArchive';
import type { ArchiveEvent } from './eventArchive';
import { historyTimeLabel } from '../../domain/history/time';

export type Selection={id:string;origin:'active'|'other'|'legacy'|'unassigned';stageId?:string};
function DesktopGroup({desktop,className="bg-goal",children}:{desktop:boolean;className?:string;children:ReactNode}) { return desktop ? <div className={className}>{children}</div> : <>{children}</>; }
function EventTime({time,desktop}:{time:string;desktop:boolean}) {return desktop ? <time dateTime={time} title={time}>{dateTime(time)}</time> : dateTime(time);}
function LongText({text,label}:{text?:string;label:string}) {
  if(!text)return <p className="muted">未记录</p>;
  return text.length<=500?<p className="event-prose">{text}</p>:<><p className="event-prose">{text.slice(0,260)}…</p><details><summary>阅读完整{label}</summary><p className="event-prose">{text}</p></details></>;
}
type Position={id:string;scroll:number;pane:number};
export interface WorldEventsUiState { query:string; page:number; selection?:Selection;positions?:{list?:Position;family?:Position} }
function Outcome({event,desktop=false}:{event:ArchiveEvent;desktop?:boolean}) {
  return <span className={desktop ? `ev-st ${event.detail?.outcome??event.status}` : `event-status event-status-${event.detail?.outcome??event.status}`}>{eventStatusLabels[event.status]}{event.detail?.outcome?` · ${eventOutcomeLabels[event.detail.outcome]}`:''}</span>;
}
function EventFile({event,view,archive,onSelect,onOpenHistory,children,desktop=false}:{event:ArchiveEvent;view:PlayerView;archive:ReturnType<typeof eventArchive>;onSelect:(id:string)=>void;onOpenHistory?:()=>void;children?:ReactNode;desktop?:boolean}) {
  const d=event.detail,raw=event.raw;
  const actors=d?.actorRefs.map(ref=>ref.kind==='protagonist'?view.protagonist.name:ref.kind==='npc'
    ?[...view.npc,...view.retiredNpcs].find(n=>n.id===ref.id)?.name??ref.id:view.organizations.find(o=>o.id===ref.id)?.name??ref.id);
  const actorTags=d?.actorRefs.map((ref,i)=>{
    const org=ref.kind==='organization'?view.organizations.find(o=>o.id===ref.id):undefined;
    return <span key={`${ref.kind}:${ref.id}:${i}`} className={`actor ${ref.kind==='protagonist'?'a-me':ref.kind==='organization'?'a-org':'a-npc'}`} data-kind={org?.kind}><i aria-hidden="true">{Array.from(actors?.[i]??'')[0]}</i>{actors?.[i]}</span>;
  });
  const locationField=<Detail label="地点">{d?.locationId?view.locations.find(l=>l.id===d.locationId)?.name??d.locationId:'未记录'}</Detail>;
  const history=view.timeline.filter(h=>h.eventId===event.id);
  return <article className="event-file" aria-label={event.eventKind==='sub'?'阶段档案':'事件档案'}>
    {desktop ? <header className="ev-file-hd"><div className="row"><Outcome event={event} desktop/>{d?.impact&&<span className={`impact ${d.impact}`}>{eventImpactLabels[d.impact]}</span>}<span className="pill">{event.eventKind==='main'?'主事件':event.eventKind==='sub'?'阶段':'旧版独立事件'}</span></div>
      <h3 tabIndex={-1} data-file-heading>{event.title}</h3><span className={`case-stamp ${d?.outcome??event.status}`} aria-hidden="true">{eventStatusLabels[event.status]}<small>CASE · {event.id}</small></span></header>
      : <><Outcome event={event}/><h3 tabIndex={-1} data-file-heading>{event.title}</h3></>}
    <dl className={desktop ? "event-facts facts-grid" : "event-facts"}>
      <Detail label="开始时间">{event.startAt?<EventTime time={event.startAt} desktop={desktop}/>:'未保留'}</Detail>
      {event.eventKind==='sub'&&<Detail label="固定终止时间">{event.fixedEndAt?<EventTime time={event.fixedEndAt} desktop={desktop}/>:'未保留'}</Detail>}
      {event.eventKind!=='sub'&&d?.estimatedEndAt&&<Detail label={event.eventKind==='main'?'预计整体结束':'预计结束'}>{<EventTime time={d.estimatedEndAt} desktop={desktop}/>}（预计）</Detail>}
      {d?.resolvedAt&&<Detail label="实际结案时间">{<EventTime time={d.resolvedAt} desktop={desktop}/>}</Detail>}
      {desktop&&locationField}
      {desktop ? <div className="detail fact-actors"><dt>参与人物与势力</dt><dd>{actorTags?.length ? actorTags : '未保留'}</dd></div> : <Detail label="参与人物与势力">{actors?.join('、')||'未保留'}</Detail>}
      {!desktop&&locationField}
      {d?.impact&&<Detail label="影响描述">{eventImpactLabels[d.impact]}</Detail>}
      {event.parentEventId&&<Detail label="所属主事件">{archive.records.get(event.parentEventId)?.title??event.parentEventId}</Detail>}
    </dl>
    <DesktopGroup desktop={desktop}>
    {'backgroundText' in (d??{})&&<section className={desktop ? "sec" : undefined}><h4>背景</h4><LongText text={(d as {backgroundText?:string}).backgroundText} label="背景"/></section>}
    {'goalText' in (d??{})&&<section className={desktop ? "sec" : undefined}><h4>目标</h4><LongText text={(d as {goalText?:string}).goalText} label="目标"/></section>}
    </DesktopGroup>
    {event.retired&&<p className="tag">退役保留档案</p>}
    {d?.resolutionText&&<section className={desktop ? "sec" : undefined}><h4>阶段经过与结果</h4><LongText text={d.resolutionText} label="阶段经过"/></section>}
    {desktop&&children}
    {d?.resultKnowledge&&<section className={desktop ? "event-knowledge sec" : "event-knowledge"} aria-label="成果分类"><h4>成果分类</h4><DesktopGroup desktop={desktop} className="know">{(['facts','reported','suspected'] as const).map(key=><div key={key} className={desktop ? `k-${key}` : undefined}><h5>{{facts:'已核实事实',reported:'转述（未核实）',suspected:'推测'}[key]}</h5>{d.resultKnowledge![key].length?<ul>{d.resultKnowledge![key].map((text,i)=><li key={i}><LongText text={text} label="成果"/></li>)}</ul>:<p className="muted">无记录</p>}</div>)}</DesktopGroup></section>}
    {!!raw.predecessorEventIds?.length&&<section className={desktop ? "sec" : undefined} aria-label="前序关联"><h4>正式前序</h4>{raw.predecessorEventIds.map(id=><button className={desktop ? "chip-btn" : undefined} key={id} disabled={!archive.records.has(id)} onClick={()=>onSelect(id)}>{archive.records.get(id)?.title??id}</button>)}</section>}
    {!!raw.linkedTaskIds.length&&<section className={desktop ? "sec" : undefined}><h4>关联任务</h4><ul>{raw.linkedTaskIds.map(id=><li key={id}>{view.tasks.find(t=>t.id===id)?.goal??id}</li>)}</ul></section>}
    {!!history.length&&<section className={desktop ? "sec" : undefined} aria-label="相关历史"><h4>正式历史引用</h4>{history.map(h=><p className={desktop ? "hist-ref" : undefined} key={h.id}><span className="tag">{h.chronicle?'重大纪事':'史料记录'}</span> {h.title} · {h.chronicle?historyTimeLabel(h.chronicle.time):h.occurredAt?dateTime(h.occurredAt):h.occurredTimeText??'时间待考'}</p>)}{onOpenHistory&&<button className={desktop ? "chip-btn" : undefined} onClick={onOpenHistory}>前往历史时间轴</button>}</section>}
    {!desktop&&children}
    <details className={desktop ? "sec" : undefined}><summary>关联与来源</summary>{'blockers' in raw&&<><h4>叙事阻碍</h4><ul>{raw.blockers.map((t,i)=><li key={i}>{t}</li>)}</ul><h4>前置背景</h4><ul>{raw.prerequisites.map((t,i)=><li key={i}>{t}</li>)}</ul></>}<p>来源回合：{raw.sourceTurnIds.join('、')||'未记录'}</p></details>
    <WorldRecord title="完整技术记录" value={raw}/>
  </article>;
}
export function WorldEventsPanel({view,onOpenHistory,initialId,desktop=false,uiState,onUiStateChange}:{view:PlayerView;onOpenHistory?:()=>void;initialId?:string;desktop?:boolean;uiState?:WorldEventsUiState;onUiStateChange?:(state:WorldEventsUiState)=>void}) {
  const archive=useMemo(()=>eventArchive(view),[view]),[query,setQuery]=useState(uiState?.query??''),[page,setPage]=useState(uiState?.page??0),[selection,setSelection]=useState<Selection|undefined>(uiState?.selection);
  const root=useRef<HTMLDivElement>(null),pane=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(desktop)onUiStateChange?.({query,page,selection,positions:positions.current});},[desktop,query,page,selection,onUiStateChange]);
  const positions=useRef<{list?:Position;family?:Position}>(uiState?.positions??{});
  const matches=archive.active.filter(e=>`${e.title}\n${e.id}\n${'backgroundText' in (e.detail??{})?(e.detail as {backgroundText?:string}).backgroundText:''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const last=Math.max(0,Math.ceil(matches.length/20)-1),current=Math.min(page,last);
  const valid=selection&&(selection.origin==='active'?archive.active:selection.origin==='other'?archive.otherFamilies:selection.origin==='legacy'?archive.legacy:archive.unassigned).some(e=>e.id===selection.id)?selection:undefined;
  const main=valid?archive.records.get(valid.id):matches[0],family=main?.eventKind==='main'?eventFamily(archive,main.id,view.worldClock):undefined;
  const child=valid?.stageId&&archive.records.get(valid.stageId)?.parentEventId===main?.id?archive.records.get(valid.stageId):undefined;
  const level=!valid?'list':child?'stage':family?'family':'record';
  function remember(id:string) {return {id,scroll:root.current?.closest(desktop?'.event-detail-pane':'.modal-body')?.scrollTop??0,pane:pane.current?.scrollTop??0};}
  const pendingFocus=useRef(false);
  function moveFileFocus(){requestAnimationFrame(()=>{if(pane.current)pane.current.scrollTop=0;const body=root.current?.closest('.modal-body');if(body&&!desktop)body.scrollTop=0;[...(root.current?.querySelectorAll<HTMLElement>('[data-file-heading]')??[])].find(e=>e.getClientRects().length)?.focus({preventScroll:true});});}
  function focusFile(){if(desktop)pendingFocus.current=true;else moveFileFocus();}
  useEffect(()=>{if(pendingFocus.current){pendingFocus.current=false;moveFileFocus();}},[selection]);
  function select(id:string,origin:Selection['origin']='active') {positions.current.list=remember(id);setSelection({id,origin});focusFile();}
  function selectStage(id:string) {if(!main)return;positions.current.family=remember(id);setSelection({id:main.id,origin:valid?.origin??'active',stageId:id});focusFile();}
  function restore(kind:'list'|'family') {const pos=positions.current[kind];requestAnimationFrame(()=>{const body=root.current?.closest(desktop?'.event-detail-pane':'.modal-body');if(body)body.scrollTop=pos?.scroll??0;if(pane.current)pane.current.scrollTop=pos?.pane??0;const button=[...(root.current?.querySelectorAll<HTMLButtonElement>('[data-event-id]')??[])].find(e=>e.dataset.eventId===pos?.id);(button??root.current?.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});});}
  function related(id:string) {const e=archive.records.get(id);if(!e)return;if(e.eventKind==='sub'&&e.parentEventId&&archive.records.has(e.parentEventId)){const parent=archive.records.get(e.parentEventId)!;setSelection({id:parent.id,origin:archive.active.some(x=>x.id===parent.id)?'active':'other',stageId:id});focusFile();}else select(id,e.eventKind==='main'?(archive.active.some(x=>x.id===id)?'active':'other'):'legacy');}
  useEffect(()=>{if(initialId)related(initialId);},[initialId]);
  const stageRow=(e:ArchiveEvent)=><button className="event-stage-row" data-status={desktop?e.detail?.outcome??e.status:undefined} data-event-id={e.id} onClick={()=>selectStage(e.id)}><span><strong>{e.title}</strong><small>{e.startAt?dateTime(e.startAt):'开始未保留'} · 固定终止 {e.fixedEndAt?dateTime(e.fixedEndAt):'未保留'}</small></span><Outcome event={e} desktop={desktop}/></button>;
  const stages=(label:string,entries:ArchiveEvent[])=>entries.length>20
    ? <RecordList key={`${main?.id}:${label}`} label={label} entries={entries} render={stageRow}/>
    : <section aria-label={label}><h5>{label} · {entries.length}</h5>{entries.map(e=><div className={desktop ? "stage-track-row" : undefined} key={e.id}>{stageRow(e)}</div>)}{!entries.length&&<Empty>暂无记录</Empty>}</section>;
  const secondary=(title:string,entries:ArchiveEvent[],origin:Selection['origin'])=><details className="event-secondary"><summary>{title} · {entries.length}</summary><RecordList label={title} entries={entries} render={e=><button className="event-stage-row" data-event-id={e.id} onClick={()=>select(e.id,origin)}><span>{e.title}</span><Outcome event={e} desktop={desktop}/></button>}/></details>;
  const auxiliary=<div className={desktop ? 'event-auxiliary aux' : 'event-auxiliary'}>{desktop&&<p className="lbl">更多档案</p>}
      {secondary('其他事件家族资料',archive.otherFamilies,'other')}
      {secondary('旧版独立事件资料',archive.legacy,'legacy')}
      {!!archive.unassigned.length&&secondary('未归属阶段资料',archive.unassigned,'unassigned')}
      <details className="event-secondary"><summary>任务进展</summary><RecordList label="世界任务" entries={view.tasks} render={t=><article className="card"><h4>{t.goal}</h4><p>{{planned:'计划中',active:'进行中',blocked:'受阻',completed:'已完成',cancelled:'已取消'}[t.status]}</p><WorldRecord title="完整任务记录" value={t}/></article>}/></details>
    </div>;
  return <div ref={root} className="world-events-panel" data-level={level}>
    <div className="event-archive-layout">
      <section className="event-directory" aria-label="活动主事件目录"><DesktopGroup desktop={desktop} className="event-directory-tools"><h3>正在发展的主事件{desktop&&<small>{archive.active.length}</small>}</h3>
        <label className="search">搜索活动主事件<input maxLength={400} value={query} placeholder="标题或背景" onChange={e=>{setQuery(e.target.value);setPage(0);setSelection(undefined);}}/></label></DesktopGroup>
        <div className="event-directory-rows">{matches.slice(current*20,(current+1)*20).map(e=><button key={e.id} data-event-id={e.id} className={desktop ? "event-directory-row ev-row" : "event-directory-row"} aria-label={`查看主事件：${e.title}`} aria-pressed={main?.id===e.id} onClick={()=>select(e.id)}><strong>{e.title}</strong><Outcome event={e} desktop={desktop}/><small>{e.startAt?dateTime(e.startAt):'开始未记录'}</small></button>)}</div>
        {!matches.length&&<Empty>暂无符合条件的活动主事件</Empty>}
        {last>0&&<div className="memory-pagination" aria-label="主事件分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页主事件</button><span>{current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页主事件</button></div>}
        {desktop&&auxiliary}
      </section>
      <div className="event-detail-pane" ref={pane}>
        {main?<>
          <div className="event-back-links">{child?<button onClick={()=>{setSelection({id:main.id,origin:valid?.origin??'active'});restore('family');}}>返回主事件</button>:null}<button className="event-back-list" onClick={()=>{setSelection(undefined);restore('list');}}>返回事件列表</button></div>
          <div hidden={Boolean(child)}><EventFile key={main.id} event={main} view={view} archive={archive} onSelect={related} onOpenHistory={onOpenHistory} desktop={desktop}>
            {family&&<section className={desktop ? "event-stages sec" : "event-stages"} aria-label="主事件阶段"><h4>并行阶段</h4>{stages('正在进行的阶段',family.running)}{stages('已结束的阶段经过',[...family.ended,...family.incomplete])}
              <details><summary>尚未开始的阶段 · {family.upcoming.length}</summary>{stages('尚未开始的阶段',family.upcoming)}</details></section>}
          </EventFile></div>
          {child&&<EventFile key={child.id} event={child} view={view} archive={archive} onSelect={related} onOpenHistory={onOpenHistory} desktop={desktop}/>}
        </>:<Empty>选择主事件，阅读世界档案</Empty>}
      </div>
    </div>
    {!desktop&&auxiliary}
  </div>;
}
