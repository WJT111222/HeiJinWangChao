import { useMemo, useRef, useState } from 'react';
import type { TimelineEntry } from '../../domain/events/schema';
import { historyPageSize, historyProjection } from '../../domain/history/projection';
import type { ChronicleEntry, HistorySlot } from '../../domain/history/projection';
import { historyTimeLabel } from '../../domain/history/time';
import { Empty } from '../Dialog';
import { dateTime } from './playerView';
import type { PlayerView } from './playerView';
import { RecordList } from './WorldRecord';

const categories = { world: '世界重大纪事', protagonist: '主角重大纪事' };
const scopes = { region: '地区', country: '国家', world: '世界', organization: '重大组织' };
const natures = { fact: '已确立事实', statement: '人物陈述', rumor: '传闻', inference: '推测' };
const knowledge = { established: '剧情事实', reported: '人物陈述', suspected: '推测 / 传闻' };
const relations = { follows: '承接', corrects: '更正', parallel: '同事异观' };
function SlotSide({ slot, category, onSelect }: { slot: HistorySlot; category: 'world' | 'protagonist'; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const entries = slot.entries.filter(entry => entry.chronicle.category === category);
  // A same-time group can be large; retain all identities without rendering thousands of long cards.
  return <div className={`history-side history-${category}`}>
    {(expanded ? entries : entries.slice(0, 3)).map(entry => <button className="history-node" key={entry.id} data-history-id={entry.id}
      onClick={() => onSelect(entry.id)}>
      <span className="tag">{categories[category]}</span><h3>{entry.title}</h3><p>{entry.summary}</p>
    </button>)}
    {entries.length > 3 && <button className="history-group-toggle" onClick={() => setExpanded(!expanded)}>
      {expanded ? '收起同组纪事' : `展开同组 ${entries.length} 条纪事`}
    </button>}
  </div>;
}
function ChronicleDetail({ entry, view, onSelect }: { entry: ChronicleEntry; view: PlayerView; onSelect: (id: string) => void }) {
  const c = entry.chronicle;
  const names = new Map([
        ...[...view.npc, ...view.retiredNpcs].map(p => [`npc:${p.id}`, p.name] as const),
    ...view.organizations.map(o => [`organization:${o.id}`, o.name] as const),
  ]);
  const peers = view.timeline.filter(other => other.id !== entry.id && other.chronicle?.milestoneId === c.milestoneId);
  const linked = new Map(view.timeline.map(other => [other.id, other]));
  const links = c.relations ?? [];
  const incoming = view.timeline.flatMap(other => (other.chronicle?.relations ?? []).filter(r => r.entryId === entry.id).map(r => ({ entry: other, kind: r.kind })));
  return <article className="history-detail" aria-label="纪事详情">
    <span className="tag">{categories[c.category]}</span><h3>{entry.title}</h3><p>{entry.summary}</p>
    <dl><div><dt>发生 / 开始</dt><dd>{historyTimeLabel(c.time)}</dd></div>
      {entry.occurredTimeText && <div><dt>原始时间表述</dt><dd>{entry.occurredTimeText}</dd></div>}
      {c.endTime && <div><dt>实际结束</dt><dd>{historyTimeLabel(c.endTime)}</dd></div>}
      {c.category === 'world' && <div><dt>影响范围</dt><dd>{scopes[c.scope]} · {c.scopeText}</dd></div>}
      {(c.locationText || entry.locationId) && <div><dt>地点</dt><dd>{c.locationText ?? view.locations.find(p => p.id === entry.locationId)?.name ?? entry.locationId}</dd></div>}
      {!!entry.actorRefs?.length && <div><dt>涉及人物与组织</dt><dd>{entry.actorRefs.map(ref => ref.kind === 'protagonist' ? view.protagonist.name : names.get(`${ref.kind}:${ref.id}`) ?? ref.id).join('、')}</dd></div>}
      <div><dt>信息性质</dt><dd>{natures[c.nature]}</dd></div>
    </dl>
    <h4>历史纪事</h4><p className="history-narrative">{c.narrative}</p>
    {!!c.process.length && <><h4>主要经过</h4><ol>{c.process.map((text, i) => <li key={i}>{text}</li>)}</ol></>}
    {(['results', 'impacts'] as const).map(field => <section key={field}><h4>{field === 'results' ? '已发生结果' : '已确认影响'}</h4>
      {c[field].length ? <ul>{c[field].map((item, i) => <li key={i}><span className="tag">{natures[item.nature]}</span> {item.text}
        {item.sourceText && <p>来源：{item.sourceText}</p>}</li>)}</ul> : <p>未记录</p>}
    </section>)}
    <section aria-label="关联历史"><h4>关联历史</h4>
      {peers.map(other => <button key={`peer:${other.id}`} onClick={() => onSelect(other.id)}>同一重大事实 · {other.title}</button>)}
      {links.map(r => <button key={`${r.kind}:${r.entryId}`} onClick={() => onSelect(r.entryId)}>{relations[r.kind]} · {linked.get(r.entryId)?.title ?? r.entryId}</button>)}
      {incoming.map(r => <button key={`incoming:${r.kind}:${r.entry.id}`} onClick={() => onSelect(r.entry.id)}>后续{relations[r.kind]} · {r.entry.title}</button>)}
      {entry.relatedEntryIds.map(id => <button key={`related:${id}`} onClick={() => onSelect(id)}>相关史料 · {linked.get(id)?.title ?? id}</button>)}
      {!peers.length && !links.length && !incoming.length && !entry.relatedEntryIds.length && <p>暂无关联</p>}
    </section>
    <HistorySource entry={entry} view={view} />
    <p>来源回合：{[...new Set([entry.sourceTurnId, ...(c.supportingTurnIds ?? [])])].join('、')}</p>
    {entry.eventId && <p>关联事件：{view.events.find(e => e.id === entry.eventId)?.title ?? view.retiredEvents.find(e => e.id === entry.eventId)?.detail?.title ?? entry.eventId}</p>}
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
export function HistoryPanel({ view }: { view: PlayerView }) {
  const projection = useMemo(() => historyProjection(view.timeline), [view.timeline]);
  const [tab, setTab] = useState<'chronicles' | 'records'>(() => projection.slots.length ? 'chronicles' : 'records');
  const [query, setQuery] = useState(''), [year, setYear] = useState('all'), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const root = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null);
  const selectedEntry = view.timeline.find(entry => entry.id === selected);
  const slots = useMemo(() => projection.slots.filter(slot => year === 'all' || String(slot.year ?? 'unknown') === year)
    .map(slot => ({ ...slot, entries: slot.entries.filter(entry => `${entry.title}\n${entry.summary}\n${entry.chronicle.narrative}`.includes(query.trim())) }))
    .filter(slot => slot.entries.length), [projection, query, year]);
  const last = Math.max(0, Math.ceil(slots.length / historyPageSize) - 1), current = Math.min(page, last);
  function select(id: string) { opener.current = document.activeElement as HTMLElement; setSelected(id); root.current?.scrollIntoView({ block: 'start' }); }
  function back() { setSelected(undefined); requestAnimationFrame(() => {
    // The old DOM node was unmounted. Locate it by its stable ID without CSS interpolation.
    const id = opener.current?.dataset.historyId;
    const button = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-history-id]') ?? [])].find(b => b.dataset.historyId === id);
    (button ?? root.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }); }
  return <div className="history-panel" ref={root}>
    {selectedEntry ? <><button onClick={back}>返回时间轴</button>{selectedEntry.chronicle
      ? <ChronicleDetail entry={selectedEntry as ChronicleEntry} view={view} onSelect={select} />
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
        <div className="history-legend"><span>世界重大纪事</span><span>主角重大纪事</span></div>
        <ol className="history-axis" aria-label="统一历史主轴" tabIndex={0}>
          {slots.slice(current * historyPageSize, (current + 1) * historyPageSize).map(slot => <li className="history-slot" data-time-key={slot.key} key={slot.key}>
            <SlotSide slot={slot} category="world" onSelect={select} />
            <div className="history-time"><span className="history-pin" /><time>{slot.label}</time></div>
            <SlotSide slot={slot} category="protagonist" onSelect={select} />
          </li>)}
        </ol>
        {!slots.length && <Empty>暂无符合条件的重大纪事。</Empty>}
        <div className="memory-pagination" aria-label="历史分页"><button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button>
          <span>第 {current + 1} / {last + 1} 页 · {slots.length} 个时间组</span><button disabled={current === last} onClick={() => setPage(current + 1)}>下一页</button></div>
      </>}
    </>}
  </div>;
}
