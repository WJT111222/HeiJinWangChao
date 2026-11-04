import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from '../Dialog';
import { dateTime } from './playerView';
import type { PlayerView } from './playerView';
import { historySearchLimit, searchHistory } from '../../domain/memories/history';
import type { HistoryRecord } from '../../domain/memories/history';
import { MemoryRecord } from './MemoryRecord';

const levels = [
  ['immediate', '即时记忆'], ['short', '短期记忆'], ['medium', '中期记忆'], ['long', '长期记忆'], ['npc', '人物记忆'], ['archive', '永久正文档案'],
] as const;
type Level = typeof levels[number][0];
const emptyText = {
  immediate: '还没有正式提交的经历。当前正文候选会在正式结算后进入记忆。',
  short: '暂时没有短期摘要；永久正文仍保留在档案中。',
  medium: '尚无中期记忆。经历整理后，会在这里留下重要的约定与因果。',
  long: '尚无长期记忆。值得长久铭记的经历，会在这里保存。',
  npc: '尚无已保存的人物记忆或总结。',
};
function RecordedTime({ time }: { time?: string }) {
  return time ? <time>{dateTime(time)}</time> : <span className="muted">历史回合时间未记录</span>;
}
export function MemoryPanel({ view }: { view: PlayerView }) {
  const [level, setLevel] = useState<Level>('immediate');
  const [query, setQuery] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sourceId, setSourceId] = useState<string>();
  const [sources, setSources] = useState<HistoryRecord[]>([]);
  const [sourcePage, setSourcePage] = useState(0);
  const sourceArea = useRef<HTMLElement>(null), sourcePicker = useRef<HTMLElement>(null);
  useEffect(() => {
    const target = sourceId ? sourceArea.current : sources.length ? sourcePicker.current : undefined;
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start' });
  }, [sourceId, sources]);
  const turns = useMemo(() => new Map(view.journal.map((entry) => [entry.turnId, entry])), [view.journal]);
  const results = useMemo(() => query.trim() ? searchHistory(view.journal, query) : [...view.journal].reverse(), [view.journal, query]);
  const memories = view.memories.filter(memory => memory.tier === level &&
    [memory.text, memory.knowledgeSource, memory.ownerNpcId && view.npc.find(npc => npc.id === memory.ownerNpcId)?.name]
      .some(text => text?.toLocaleLowerCase().includes(memoryQuery.trim().toLocaleLowerCase())));
  const count = level === 'immediate' ? view.immediateMemories.length : level === 'archive' ? results.length : memories.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / historySearchLimit) - 1));
  const visibleTurns = (level === 'immediate' ? view.immediateMemories : results).slice(currentPage * historySearchLimit, (currentPage + 1) * historySearchLimit);
  const source = sourceId ? turns.get(sourceId) : undefined;
  const turnTime = (id: string) => view.memories.find((memory) => memory.visibility === 'player_known' && memory.layer === '短期' && memory.origin === 'stored'
    && memory.sourceTurnIds.length === 1 && memory.sourceTurnIds[0] === id)?.createdAtGameTime;
  function changeLevel(next: Level) {
    setLevel(next); setPage(0); setSourceId(undefined); setSources([]);
  }
  function showSources(ids: string[]) {
    const originals = ids.flatMap((id) => { const turn = turns.get(id); return turn ? [turn] : []; });
    if (originals.length === 1) { setSourceId(originals[0].turnId); setSources([]); }
    else { setSources(originals); setSourcePage(0); setSourceId(undefined); }
  }
  const label = levels.find(([key]) => key === level)![1];
  return <div className="memory-reader">
    <p className="muted">即时窗口：最近 {view.immediateWindowSize} 回合。玩家可查看全部已保存记录；阅读不会让主角或其他人物自动知情。内部记录不代表人物记忆。</p>
    <nav className="memory-navigation" aria-label="记忆层级">
      {levels.map(([key, name]) => <button key={key} aria-label={name} aria-pressed={level === key} onClick={() => changeLevel(key)}>
        {key === 'short' ? '短期' : key === 'medium' ? '中期' : key === 'long' ? '长期' : name}{' '}
        <span aria-hidden="true">{key === 'immediate' ? view.immediateMemories.length : key === 'archive' ? view.journal.length : view.memoryLayers[key]}</span>
      </button>)}
    </nav>
    <label className="search">搜索历史回合
      <input value={query} onChange={(event) => { setQuery(event.target.value); changeLevel('archive'); }} placeholder="搜索人物、约定、地点或经历" maxLength={4000} />
    </label>
    {level !== 'immediate' && level !== 'archive' && <label className="search">搜索当前记忆层级
      <input value={memoryQuery} maxLength={4000} onChange={event => { setMemoryQuery(event.target.value); setPage(0); }} placeholder="人物、内容或知识来源" />
    </label>}
    {source && <section ref={sourceArea} tabIndex={-1} className="card entry" aria-label="摘要来源原文">
      <h3>第 {source.turnNumber} 回合原文</h3>
      <RecordedTime time={turnTime(source.turnId)} />
      <p>摘要：{source.summary || '未提供摘要，原文仍完整保留'}</p>
      <p className="prose">{source.narrative}</p>
      <button onClick={() => setSourceId(undefined)}>关闭来源原文</button>
    </section>}
    {sources.length > 0 && <section ref={sourcePicker} tabIndex={-1} className="card entry" aria-label="来源回合选择">
      <h3>对应的经历</h3>
      <div className="memory-source-list">{sources.slice(sourcePage * historySearchLimit, (sourcePage + 1) * historySearchLimit).map((turn) =>
        <button key={turn.turnId} onClick={() => setSourceId(turn.turnId)}>查看第 {turn.turnNumber} 回合原文</button>)}</div>
      {sources.length > historySearchLimit && <div className="memory-pagination">
        <button disabled={!sourcePage} onClick={() => setSourcePage(sourcePage - 1)}>较早来源</button>
        <span>来源第 {sourcePage + 1} 页</span>
        <button disabled={(sourcePage + 1) * historySearchLimit >= sources.length} onClick={() => setSourcePage(sourcePage + 1)}>后续来源</button>
      </div>}
      <button onClick={() => setSources([])}>关闭来源列表</button>
    </section>}
    <section aria-label={label}>
      <h3>{label}</h3>
      {level === 'immediate' && <p className="muted">按回合顺序回顾已提交的经历，展开可读完整正文。</p>}
      {level === 'short' && <p className="muted">已保存摘要与旧档只读摘要分别标记，原文始终保留。</p>}
      {level === 'archive' && <p className="muted" role="status">{query.trim() ? `本地相关结果 ${results.length} 条，最多 ${historySearchLimit} 条；姓名匹配仅为文本线索。` : `共 ${view.journal.length} 个已提交回合，每页 ${historySearchLimit} 条。`}</p>}
      {level === 'immediate' || level === 'archive' ? <>
        {visibleTurns.map((entry) => <article className="card entry" key={entry.turnId}>
          <RecordedTime time={turnTime(entry.turnId)} />
          <details><summary>第 {entry.turnNumber} 回合 · {entry.summary || '未提供摘要，正文记录'}</summary>
            <p className="prose">{entry.narrative}</p>
          </details>
          <button onClick={() => { setSources([]); setSourceId(entry.turnId); }}>查看第 {entry.turnNumber} 回合原文</button>
        </article>)}
        {!count && <Empty>{level === 'immediate' ? emptyText.immediate : query.trim() ? '未找到相关的已提交历史。' : '开局尚未提交，正文档案为空。'}</Empty>}
      </> : <>
        {memories.slice(currentPage * historySearchLimit, (currentPage + 1) * historySearchLimit).map((memory, index) => {
          const originals = memory.sourceTurnIds.flatMap((id) => { const entry = turns.get(id); return entry ? [entry] : []; });
          return <article className="card entry" key={`${memory.id}-${index}`}>
            <span className="tag">{memory.origin === 'journal' ? '历史摘要，只读' : '已保存摘要'}</span>{' '}
            <RecordedTime time={memory.createdAtGameTime} />
            <MemoryRecord memory={memory} view={view} />
            <p className="muted">{originals.length ? `对应 ${originals.length} 个已提交回合` : '来源回合未记录或原文档案暂不可用'}</p>
            {originals.length > 0 && <button onClick={() => showSources(memory.sourceTurnIds)}>
              {originals.length === 1 ? `查看第 ${originals[0].turnNumber} 回合原文` : '查看来源回合'}
            </button>}
          </article>;
        })}
        {!count && <Empty>{emptyText[level]}</Empty>}
      </>}
      {count > historySearchLimit && <div className="memory-pagination">
        <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{level === 'archive' ? '查看较新回合' : '上一页记忆'}</button>
        <span>第 {currentPage + 1} 页</span>
        <button disabled={(currentPage + 1) * historySearchLimit >= count} onClick={() => setPage(currentPage + 1)}>{level === 'archive' ? '查看更早回合' : '下一页记忆'}</button>
      </div>}
    </section>
  </div>;
}
