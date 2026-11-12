import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Organization } from '../../domain/organizations/schema';
import { Detail, Empty } from '../Dialog';
import { RecordList, WorldRecord } from './WorldRecord';
import { money, orgLabels } from './playerView';
import type { PlayerView } from './playerView';
import { organizationDynamics, organizationNpcIds } from './organizationView';
import { eventStatusLabels } from './eventArchive';

export interface ArchiveLinks {
  npc: (id: string) => void;
  organization: (id: string) => void;
  event: (id: string) => void;
}
function CompactRecords<T>({label,entries,render}:{label:string;entries:readonly T[];render:(entry:T,index:number)=>ReactNode}) {
  return entries.length>20?<RecordList label={label} entries={entries} render={render}/>:<div role="region" aria-label={label}>{entries.length?entries.map((entry,index)=><div key={index}>{render(entry,index)}</div>):<Empty>暂无记录</Empty>}</div>;
}
function CurrentState({ org, desktop }: { org: Organization; desktop: boolean }) {
  const fields: [string, string | number | string[] | undefined][] = org.kind === 'gang'
    ? [['活动与控制范围',org.territoryText],['主要产业',org.industries],['人员与实力',org.powerText],['内部现状',org.internalStatus],['组织持有资金（非主角账户）',org.funds]]
    : org.kind === 'government' ? [['管辖范围',org.jurisdictionText],['法定职权',org.lawfulPowers],['主要案件',org.cases],['行政事务',org.administrativeAffairs],['执行能力',org.enforcementCapacityText],['公众信任',org.publicTrustText],['内部现状',org.internalStatus]]
      : org.kind === 'civil' ? [['组织宗旨',org.missionText],['成员与参与者',org.membershipText],['支持者',org.supportersText],['主要活动',org.activities],['活动范围',org.activityAreaText],['社会影响',org.publicInfluenceText]]
        : [['行业与业务',org.sectors],['股权与控制',org.ownershipText],['经营与内部现状',org.operatingStatus],['资产估值',org.assetsEstimate],['流动资金估计',org.liquidityEstimate]];
  const present=fields.filter(([,value])=>Array.isArray(value)?value.length:value!==undefined && value!=='');
  return present.length?<dl className={desktop ? 'dl org-state' : undefined}>{present.map(([label,value])=><Detail key={label} label={label}>{typeof value==='number'?(desktop ? <span className="money">{money(value)}</span> : money(value)):Array.isArray(value)?value.join('；'):value}</Detail>)}</dl>:<Empty>暂无补充的当前状况</Empty>;
}
export function OrganizationPanel({ view, initialId, links, desktop = false, onSelect }: { view: PlayerView; initialId?: string; links?: ArchiveLinks; desktop?: boolean; onSelect?: (id: string) => void }) {
  const anchorId = useId(), heading = useRef<HTMLElement>(null);
  const [activeSection,setActiveSection] = useState('summary');
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[page,setPage]=useState(0),[selectedId,setSelectedId]=useState(initialId);
  const directory=useRef<HTMLElement>(null),detail=useRef<HTMLElement>(null),title=useRef<HTMLHeadingElement>(null),search=useRef<HTMLInputElement>(null),scroll=useRef(0);
  const needle=query.trim().toLocaleLowerCase();
  const matches=useMemo(()=>view.organizations.filter(org=>(kind==='all'||org.kind===kind) &&
    [org.name,orgLabels[org.kind],org.description,org.protagonistRelation].some(text=>text.toLocaleLowerCase().includes(needle))),[view.organizations,kind,needle]);
  const last=Math.max(0,Math.ceil(matches.length/20)-1),current=Math.min(page,last);
  const selected=view.organizations.find(org=>org.id===selectedId) ?? matches[0];
  const dynamics=useMemo(()=>selected?organizationDynamics(view,selected.id):undefined,[view,selected]);
  useEffect(()=>{
    if(!desktop || !selected) return;
    const pane=detail.current,head=heading.current;if(!pane || !head) return;
    const update=()=>{
      if(!head.isConnected) return;
      const sections=[...pane.querySelectorAll<HTMLElement>('[data-org-section]')];
      const boundary=(head.dataset.longHeading==='true'?pane.getBoundingClientRect().top:head.getBoundingClientRect().bottom)+12;
      let active=sections[0]?.dataset.orgSection ?? 'summary';
      for(const section of sections) if(section.getBoundingClientRect().top<=boundary) active=section.dataset.orgSection!;
      if(pane.scrollTop+pane.clientHeight>=pane.scrollHeight-2) active=sections.at(-1)?.dataset.orgSection ?? active;
      setActiveSection(active);
    };
    const size=()=>{const long=head.scrollHeight>pane.clientHeight*.4;head.dataset.longHeading=String(long);pane.style.setProperty('--org-head',`${long?0:head.offsetHeight+16}px`);update();};
    const observer=new ResizeObserver(size);observer.observe(head);observer.observe(pane);
    pane.addEventListener('scroll',update,{passive:true});size();
    return ()=>{observer.disconnect();pane.removeEventListener('scroll',update);};
  },[desktop,selected]);
  useEffect(()=>{if(initialId)setSelectedId(initialId);},[initialId]);
  useEffect(()=>{if(selectedId && detail.current){detail.current.scrollTop=0;title.current?.focus({preventScroll:true});}},[selectedId]);
  function select(id:string){scroll.current=directory.current?.scrollTop??0;setSelectedId(id);onSelect?.(id);}
  function jump(key:string){
    const pane=detail.current,target=document.getElementById(`${anchorId}-${key}`);
    if(!pane || !target) return;
    pane.scrollTo({top:pane.scrollTop+target.getBoundingClientRect().top-pane.getBoundingClientRect().top-(heading.current?.dataset.longHeading==='true'?0:heading.current?.offsetHeight??0)-12,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});setActiveSection(key);
  }
  function back(){setSelectedId(undefined);requestAnimationFrame(()=>{if(directory.current)directory.current.scrollTop=scroll.current;const button=directory.current?.querySelector<HTMLButtonElement>(`[data-org-id="${selectedId}"]`);(button??search.current)?.focus({preventScroll:true});});}
  return <div className="organization-panel" data-detail={Boolean(selectedId && selected)}>
    <div className="organization-layout">
      <section className="organization-directory" ref={directory} aria-label="组织名录">
        <div className="organization-directory-tools"><h3>势力档案馆 <small>{view.organizations.length}</small></h3>
        <label>搜索组织<input className={desktop?'f-input search':undefined} ref={search} value={query} maxLength={4000} placeholder="名称、类型或概况" onChange={e=>{setQuery(e.target.value);setPage(0);setSelectedId(undefined);}}/></label>
        <label>组织类别<select className={desktop?'f-select':undefined} aria-label="组织类别" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);setSelectedId(undefined);}}>
          <option value="all">全部组织 · {view.organizations.length}</option>
          {Object.entries(orgLabels).map(([key,label])=><option key={key} value={key}>{label} · {view.organizations.filter(o=>o.kind===key).length}</option>)}
        </select></label></div>
        <div className="organization-rows">{matches.slice(current*20,(current+1)*20).map(org=><button key={org.id} className={desktop?'org-row':undefined} data-kind={org.kind} data-org-id={org.id} aria-label={`查看组织：${org.name}`} aria-pressed={selected?.id===org.id} onClick={()=>select(org.id)}>
          <strong>{org.name}</strong><span className={desktop?'kpill':'tag'}>{orgLabels[org.kind]}</span><span className="organization-snippet">{org.description||'概况未记录'}</span><span className={desktop?'rel':undefined}>与主角：{org.protagonistRelation}</span>
        </button>)}</div>
        {!matches.length&&<Empty>暂无符合条件的组织</Empty>}
        {last>0&&<nav className="memory-pagination" aria-label="组织分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页组织</button><span>{current+1}/{last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页组织</button></nav>}
      </section>
      <section className="organization-detail" ref={detail} aria-label="组织详情" data-kind={selected?.kind}>
        {selected && dynamics ? <>
          <button className="organization-back" onClick={back}>← 返回组织名录</button>
          {desktop?<header className="organization-detail-heading" ref={heading}>
            <div className="nd-hero"><span className="og-emblem" aria-hidden="true">{Array.from(selected.name)[0]}</span>
              <div className="nd-name"><span className="kpill">{orgLabels[selected.kind]}</span><h3 ref={title} tabIndex={-1}>{selected.name}</h3></div>
              <div className="og-rel"><small>与主角</small>{selected.protagonistRelation}</div></div>
            <nav className="nd-tabs" aria-label="组织资料分节">{[['summary','组织概况'],['state','当前状况'],['leadership','管理层'],['relations','势力关系'],['dynamics','当前动态'],['protagonist','与主角关系']].map(([key,label])=><button key={key} aria-current={activeSection===key?'true':undefined} aria-controls={`${anchorId}-${key}`} onClick={()=>jump(key)}>{label}</button>)}</nav>
          </header>:<header><span className="tag">{orgLabels[selected.kind]}</span><h3 ref={title} tabIndex={-1}>{selected.name}</h3></header>}
          <section className={desktop?'sec':undefined} data-org-section="summary" id={`${anchorId}-summary`}><h4>组织概况</h4>{selected.description.length>500?<><p className="prose">{selected.description.slice(0,260)}…</p><details><summary>阅读完整组织概况</summary><p className="prose">{selected.description}</p></details></>:<p className="prose">{selected.description||'未记录'}</p>}</section>
          <section className={desktop?'sec':undefined} data-org-section="state" id={`${anchorId}-state`}><h4>当前状况</h4><CurrentState org={selected} desktop={desktop}/></section>
          <section className={desktop?'sec':undefined} data-org-section="leadership" id={`${anchorId}-leadership`}><h4>管理层与关键人物</h4>
            {selected.leadership?.length?<ul className={desktop?'roster':undefined}>{selected.leadership.map((row,i)=><li key={i}>
              <strong className={desktop?'pos':undefined}>{row.position}：</strong>{row.npcId && row.publicName && links?<button className={desktop?'who link-btn':undefined} onClick={()=>links.npc(row.npcId!)}>{row.publicName}</button>:<span className={desktop?`who ${row.publicName===null?'unknown':''}`:undefined}>{row.publicName??'未知'}</span>}
              {row.description&&<p className="prose">{row.description}</p>}
            </li>)}</ul>:<Empty>管理层尚未记录</Empty>}
            {organizationNpcIds(selected).filter(id=>!selected.leadership?.some(row=>row.npcId===id)).map(id=>{const person=view.npc.find(n=>n.id===id);return person?<p key={id}>{links?<button className={desktop?'chip-btn':undefined} onClick={()=>links.npc(id)}>人物资料：{person.name}</button>:person.name}</p>:null;})}
          </section>
          <section className={desktop?'sec':undefined} data-org-section="relations" id={`${anchorId}-relations`}><h4>势力关系</h4>
            {selected.relations?.length?<ul className={desktop?'orel':undefined}>{selected.relations.map(relation=><li className={desktop?'entry':undefined} data-kind={view.organizations.find(o=>o.id===relation.organizationId)?.kind} key={relation.organizationId}>
              {desktop&&<span className="seal" aria-hidden="true">{Array.from(view.organizations.find(o=>o.id===relation.organizationId)?.name??'势')[0]}</span>}
              {links?<button className={desktop?'link-btn':undefined} onClick={()=>{select(relation.organizationId);links.organization(relation.organizationId);}}>{view.organizations.find(o=>o.id===relation.organizationId)?.name??'组织资料'}</button>:view.organizations.find(o=>o.id===relation.organizationId)?.name}
              <span className="tag">{relation.relation}</span><p className="prose">{relation.description}</p>
            </li>)}</ul>:<Empty>暂无已记录的组织关系</Empty>}
            {selected.kind==='business'&&selected.businessRelations.length>0&&<details><summary>既有文字业务关系</summary><ul>{selected.businessRelations.map((text,i)=><li key={i}>{text}</li>)}</ul></details>}
          </section>
          <section className={desktop?'sec':undefined} data-org-section="dynamics" id={`${anchorId}-dynamics`}><h4>当前动态</h4>
            <h5>进行中事件</h5><CompactRecords label="组织进行中事件" entries={dynamics.currentEvents} render={event=><p className={desktop?'dyn-entry':undefined}>{links?<button className={desktop?'link-btn':undefined} onClick={()=>links.event(event.id)}>{event.title}</button>:event.title} <span className={desktop?`st ${event.status}`:'tag'}>{eventStatusLabels[event.status]}</span></p>}/>
            <h5>当前任务</h5><CompactRecords label="组织当前任务" entries={dynamics.tasks} render={task=><p className={desktop?'dyn-entry':undefined}>{task.goal} · <span className={desktop?`st ${task.status}`:undefined}>{{planned:'计划中',active:'进行中',blocked:'受阻',completed:'已完成',cancelled:'已取消'}[task.status]}</span></p>}/>
            <details><summary>已结束事件 · {dynamics.endedEvents.length}</summary><CompactRecords label="组织已结束事件" entries={dynamics.endedEvents} render={event=><p className={desktop?'dyn-entry':undefined}>{links?<button className={desktop?'link-btn':undefined} onClick={()=>links.event(event.id)}>{event.title}</button>:event.title} · <span className={desktop?`st ${event.status}`:undefined}>{eventStatusLabels[event.status]}</span></p>}/></details>
          </section>
          <section className={desktop?'sec':undefined} data-org-section="protagonist" id={`${anchorId}-protagonist`}><h4>与主角关系</h4><p>{selected.protagonistRelation}</p>
            <details><summary>关系历史 · {selected.relationHistory.length}</summary>{desktop&&selected.relationHistory.length>20?<RecordList label="组织关系历史" entries={selected.relationHistory} text={text=>text} render={text=><p className="prose history-entry">{text}</p>}/>:selected.relationHistory.length?<ul className={desktop?'hist':undefined}>{selected.relationHistory.map((text,i)=><li key={i} className="prose">{text}</li>)}</ul>:<Empty>暂无关系变更记录</Empty>}</details>
          </section>
          <WorldRecord title="组织技术记录" value={selected}/>
        </>:<Empty>选择组织，阅读势力档案</Empty>}
      </section>
    </div>
  </div>;
}
