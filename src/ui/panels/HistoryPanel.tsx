import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineEntry } from '../../domain/events/schema';
import { historyPageSize, historyProjection } from '../../domain/history/projection';
import type { ChronicleEntry, HistorySlot } from '../../domain/history/projection';
import { historyTimeLabel } from '../../domain/history/time';
import type { ReactNode } from 'react';
import { Empty } from '../Dialog';
import { dateTime } from './playerView';
import type { PlayerView } from './playerView';
import { RecordList } from './WorldRecord';

const categories = { world: '世界重大纪事', protagonist: '主角重大纪事' };
const scopes = { region: '地区', country: '国家', world: '世界', organization: '重大组织' };
const scopeLabels = { region: '地区重大事件', country: '国家重大事件', world: '世界重大事件', organization: '重大组织事件' };
const natures = { fact: '已确立事实', statement: '人物陈述', rumor: '传闻', inference: '推测' };
const knowledge = { established: '剧情事实', reported: '人物陈述', suspected: '推测 / 传闻' };
const relations = { follows: '承接', corrects: '更正', parallel: '同事异观' };
function SlotSide({ slot, category, onSelect,initialPage=0,onPage }: { slot: HistorySlot; category: 'world' | 'protagonist'; onSelect: (id: string) => void;initialPage?:number;onPage?:(page:number)=>void }) {
  const [page, setPage] = useState(initialPage);
  function changePage(next:number){setPage(next);onPage?.(next);}
  const entries = slot.entries.filter(entry => entry.chronicle.category === category);
  const last = Math.max(0, Math.ceil(entries.length / 3) - 1), current = Math.min(page, last);
  // Even one same-time group is paged, so large coincident sets cannot flood the DOM.
  return <div className={`history-side history-${category}`}>
    {entries.slice(current * 3, (current + 1) * 3).map(entry => <button className="history-node" key={entry.id} data-history-id={entry.id}
      onClick={() => onSelect(entry.id)}>
      <span className="tag">{entry.chronicle.category === 'world' ? scopeLabels[entry.chronicle.scope] : '主角重大事件'}</span><h3>{entry.title}</h3><p>{entry.summary}</p>
    </button>)}
    {entries.length > 3 && <div className="history-group-pages" aria-label={`${categories[category]}同组分页`}>
      <button disabled={!current} aria-label="同组上一页" onClick={() => changePage(current - 1)}>‹</button>
      <span>{current + 1}/{last + 1} · 共{entries.length}条</span>
      <button disabled={current === last} aria-label="同组下一页" onClick={() => changePage(current + 1)}>›</button>
    </div>}
  </div>;
}
function SourceFooter({desktop,children}:{desktop:boolean;children:ReactNode}){return desktop ? <footer className="src-foot">{children}</footer> : <>{children}</>;}
function ChronicleDetail({ entry, view, onSelect,desktop=false }: { entry: ChronicleEntry; view: PlayerView; onSelect: (id: string) => void;desktop?:boolean }) {
  const c = entry.chronicle;
  const names = new Map([
        ...[...view.npc, ...view.retiredNpcs].map(p => [`npc:${p.id}`, p.name] as const),
    ...view.organizations.map(o => [`organization:${o.id}`, o.name] as const),
  ]);
  const peers = view.timeline.filter(other => other.id !== entry.id && other.chronicle?.milestoneId === c.milestoneId);
  const linked = new Map(view.timeline.map(other => [other.id, other]));
  const links = c.relations ?? [];
  const incoming = view.timeline.flatMap(other => (other.chronicle?.relations ?? []).filter(r => r.entryId === entry.id).map(r => ({ entry: other, kind: r.kind })));
  return <article className={desktop ? "history-detail chron" : "history-detail"} aria-label="纪事详情">
    <span className="tag">{categories[c.category]}</span><h3 tabIndex={desktop?-1:undefined} data-history-heading={desktop?true:undefined}>{entry.title}</h3><p className={desktop?"lead":undefined}>{entry.summary}</p>
    <dl className={desktop?"facts-grid":undefined}><div><dt>发生 / 开始</dt><dd>{historyTimeLabel(c.time)}</dd></div>
      {entry.occurredTimeText && <div><dt>原始时间表述</dt><dd>{entry.occurredTimeText}</dd></div>}
      {c.endTime && <div><dt>实际结束</dt><dd>{historyTimeLabel(c.endTime)}</dd></div>}
      {c.category === 'world' && <div><dt>影响范围</dt><dd>{scopes[c.scope]} · {c.scopeText}</dd></div>}
      {(c.locationText || entry.locationId) && <div><dt>地点</dt><dd>{c.locationText ?? view.locations.find(p => p.id === entry.locationId)?.name ?? entry.locationId}</dd></div>}
      {!!entry.actorRefs?.length && <div><dt>涉及人物与组织</dt><dd>{entry.actorRefs.map(ref => ref.kind === 'protagonist' ? view.protagonist.name : names.get(`${ref.kind}:${ref.id}`) ?? ref.id).join('、')}</dd></div>}
      <div><dt>信息性质</dt><dd>{natures[c.nature]}</dd></div>
    </dl>
    <h4>历史纪事</h4><p className="history-narrative">{c.narrative}</p>
    {!!c.process.length && <><h4>主要经过</h4><ol className={desktop?"proc":undefined}>{c.process.map((text, i) => <li key={i}>{text}</li>)}</ol></>}
    {(['results', 'impacts'] as const).map(field => <section key={field}><h4>{field === 'results' ? '已发生结果' : '已确认影响'}</h4>
      {c[field].length ? <ul className={desktop?"res-list":undefined}>{c[field].map((item, i) => <li key={i}><span className={desktop?`nat ${item.nature}`:"tag"}>{natures[item.nature]}</span> {item.text}
        {item.sourceText && <p>来源：{item.sourceText}</p>}</li>)}</ul> : <p>未记录</p>}
    </section>)}
    <section aria-label="关联历史"><h4>关联历史</h4>
      {peers.map(other => <button key={`peer:${other.id}`} onClick={() => onSelect(other.id)}>同一重大事实 · {other.title}</button>)}
      {links.map(r => <button key={`${r.kind}:${r.entryId}`} onClick={() => onSelect(r.entryId)}>{relations[r.kind]} · {linked.get(r.entryId)?.title ?? r.entryId}</button>)}
      {incoming.map(r => <button key={`incoming:${r.kind}:${r.entry.id}`} onClick={() => onSelect(r.entry.id)}>后续{relations[r.kind]} · {r.entry.title}</button>)}
      {entry.relatedEntryIds.map(id => <button key={`related:${id}`} onClick={() => onSelect(id)}>相关史料 · {linked.get(id)?.title ?? id}</button>)}
      {!peers.length && !links.length && !incoming.length && !entry.relatedEntryIds.length && <p>暂无关联</p>}
    </section>
    <SourceFooter desktop={desktop}><HistorySource entry={entry} view={view} />
    <p>来源回合：{[...new Set([entry.sourceTurnId, ...(c.supportingTurnIds ?? [])])].join('、')}</p>
    {entry.eventId && <p>关联事件：{view.events.find(e => e.id === entry.eventId)?.title ?? view.retiredEvents.find(e => e.id === entry.eventId)?.detail?.title ?? entry.eventId}</p>}</SourceFooter>
  </article>;
}
function HistorySource({ entry, view }: { entry: TimelineEntry; view: PlayerView }) {
  const ref = entry.sourceRef;
  return <>
    {ref && <p>记录来源：{ref.kind === 'protagonist' ? view.protagonist.name : ref.kind === 'organization'
      ? view.organizations.find(o => o.id === ref.id)?.name ?? ref.id
      : [...view.npc, ...view.retiredNpcs].find(p => p.id === ref.id)?.name ?? ref.id}</p>}
    {entry.sourceText && <p>来源说明：{entry.sourceText}</p>}
    <small>记录于 {dateTime(entry.recordedAt)}</small>
  </>;
}
function OrdinaryRecord({ entry, view }: { entry: TimelineEntry; view: PlayerView }) {
  return <article className="card entry"><time>{entry.occurredAt ? dateTime(entry.occurredAt) : entry.occurredTimeText ?? '发生时间未知'}</time>
    <h3>{entry.title}</h3><p>{entry.summary}</p><span className="tag">{knowledge[entry.knowledgeKind]}</span>
    <HistorySource entry={entry} view={view} />
  </article>;
}
export interface HistoryUiState {tab:'chronicles'|'records';query:string;year:string;page:number;selected?:string;groupPages:Record<string,number>;returnId?:string;listScroll?:number}
export function HistoryPanel({ view,desktop=false,uiState,onUiStateChange }: { view: PlayerView;desktop?:boolean;uiState?:HistoryUiState;onUiStateChange?:(state:HistoryUiState)=>void }) {
  const projection = useMemo(() => historyProjection(view.timeline), [view.timeline]);
  const [tab, setTab] = useState<'chronicles' | 'records'>(() => uiState?.tab??(projection.slots.length ? 'chronicles' : 'records'));
  const [query, setQuery] = useState(uiState?.query??''), [year, setYear] = useState(uiState?.year??'all'), [page, setPage] = useState(uiState?.page??0);
  const [selected, setSelected] = useState<string|undefined>(uiState?.selected);
  const groupPages=useRef<Record<string,number>>(uiState?.groupPages??{}),listScroll=useRef(uiState?.listScroll??0),returnId=useRef<string|undefined>(uiState?.returnId);
  useEffect(()=>{if(desktop)onUiStateChange?.({tab,query,year,page,selected,groupPages:groupPages.current,returnId:returnId.current,listScroll:listScroll.current});},[desktop,tab,query,year,page,selected,onUiStateChange]);
  const root = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null);
  const selectedEntry = view.timeline.find(entry => entry.id === selected);
  const slots = useMemo(() => projection.slots.filter(slot => year === 'all' || String(slot.year ?? 'unknown') === year)
    .map(slot => ({ ...slot, entries: slot.entries.filter(entry => `${entry.title}\n${entry.summary}\n${entry.chronicle.narrative}`.includes(query.trim())) }))
    .filter(slot => slot.entries.length), [projection, query, year]);
  const last = Math.max(0, Math.ceil(slots.length / historyPageSize) - 1), current = Math.min(page, last);
  function select(id: string) { if(!selected) {opener.current = document.activeElement as HTMLElement;returnId.current=opener.current?.dataset.historyId;if(desktop)listScroll.current=root.current?.scrollTop??0;} setSelected(id);if(desktop)requestAnimationFrame(()=>{if(root.current)root.current.scrollTop=0;root.current?.querySelector<HTMLElement>('[data-history-heading]')?.focus({preventScroll:true});});else root.current?.scrollIntoView({ block: 'start' }); }
  function back() { setSelected(undefined); requestAnimationFrame(() => {
    // The old DOM node was unmounted. Locate it by its stable ID without CSS interpolation.
    if(desktop&&root.current)root.current.scrollTop=listScroll.current;
    const id = opener.current?.dataset.historyId??returnId.current;
    const button = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-history-id]') ?? [])].find(b => b.dataset.historyId === id);
    (button ?? root.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }); }
  return <div className={desktop ? "history-panel hp" : "history-panel"} ref={root}>
    {selectedEntry ? <><button onClick={back}>返回时间轴</button>{selectedEntry.chronicle
      ? <ChronicleDetail entry={selectedEntry as ChronicleEntry} view={view} onSelect={select} desktop={desktop} />
      : <OrdinaryRecord entry={selectedEntry} view={view} />}</> : <>
      <div className="history-tabs" role="group" aria-label="历史视图">
        <button aria-pressed={tab === 'chronicles'} onClick={() => setTab('chronicles')}>重大纪事</button>
        <button aria-pressed={tab === 'records'} onClick={() => setTab('records')}>史料记录 · {projection.records.length}</button>
      </div>
      {tab === 'records' ? <RecordList label="史料记录" entries={projection.records} render={entry => <OrdinaryRecord entry={entry} view={view} />} /> : <>
        <div className="history-filters"><label>搜索纪事<input value={query} maxLength={400} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
          <label>年代<select value={year} onChange={e => { setYear(e.target.value); setPage(0); }}><option value="all">全部年代</option>
            {[...new Set(projection.slots.map(s => s.year))].map(y => <option key={y ?? 'unknown'} value={y ?? 'unknown'}>{y === undefined ? '时间待考' : `${y}年`}</option>)}
          </select></label></div>
        <div className="history-legend"><span>世界重大纪事</span>{desktop&&<i aria-hidden="true">TIME</i>}<span>主角重大纪事</span></div>
        <ol className="history-axis" aria-label="统一历史主轴" tabIndex={0}>
          {slots.slice(current * historyPageSize, (current + 1) * historyPageSize).map(slot => <li className="history-slot" data-time-key={slot.key} key={slot.key}>
            <SlotSide slot={slot} category="world" onSelect={select} initialPage={desktop?groupPages.current[`${slot.key}:world`]:0} onPage={desktop?p=>{groupPages.current[`${slot.key}:world`]=p;}:undefined} />
            <div className="history-time"><span className="history-pin" /><time>{slot.label}</time></div>
            <SlotSide slot={slot} category="protagonist" onSelect={select} initialPage={desktop?groupPages.current[`${slot.key}:protagonist`]:0} onPage={desktop?p=>{groupPages.current[`${slot.key}:protagonist`]=p;}:undefined} />
          </li>)}
        </ol>
        {!slots.length && <Empty>暂无符合条件的重大纪事。</Empty>}
        <div className="memory-pagination" aria-label="历史分页"><button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button>
          <span>第 {current + 1} / {last + 1} 页 · {slots.length} 个时间组</span><button disabled={current === last} onClick={() => setPage(current + 1)}>下一页</button></div>
      </>}
    </>}
  </div>;
}
