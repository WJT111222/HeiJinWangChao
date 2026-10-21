import { useMemo, useState } from 'react';
import { Empty } from '../Dialog';
import { dateTime } from './playerView';
import type { PlayerView } from './playerView';
import { historySearchLimit, searchHistory } from '../../domain/memories/history';

export function MemoryPanel({ view }: { view: PlayerView }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sourceId, setSourceId] = useState<string>();
  const results = useMemo(() => query.trim()
    ? searchHistory(view.journal, query)
    : [...view.journal].reverse().slice(page * historySearchLimit, (page + 1) * historySearchLimit),
  [view.journal, query, page]);
  const source = view.journal.find((entry) => entry.turnId === sourceId);
  return <>
    <div className="metric-row">
      <span>即时窗口：最近 {view.immediateWindowSize} 回合</span>
      <span>短期 {view.memoryLayers.short}</span>
      <span>中期 {view.memoryLayers.medium}</span>
      <span>长期 {view.memoryLayers.long}</span>
    </div>
    <p className="muted">显示当前已保存的记忆设置；修改窗口不会删除永久正文。这里的查看与检索不请求 AI。</p>
    <h3>已知记忆</h3>
    {view.memories.length ? view.memories.map((memory, index) => <article className="card entry" key={`${memory.id}-${index}`}>
      <span className="tag">{memory.layer}</span>{' '}
      {memory.createdAtGameTime ? <time>{dateTime(memory.createdAtGameTime)}</time> : <span className="muted">历史回合时间未记录</span>}
      <p className="prose">{memory.text}</p>
      <small>来源回合：{memory.sourceTurnIds.join('、') || '未记录'}</small>
      <div>{memory.sourceTurnIds.map((id) => {
        const original = view.journal.find((entry) => entry.turnId === id);
        return original && <button key={id} onClick={() => setSourceId(id)}>查看第 {original.turnNumber} 回合原文</button>;
      })}</div>
    </article>) : <Empty>尚无可查看的记忆摘要。</Empty>}
    {source && <section className="card entry" aria-label="摘要来源原文">
      <h3>第 {source.turnNumber} 回合原文</h3>
      <small>{source.turnId}</small>
      <p>摘要：{source.summary || '未提供摘要，原文仍完整保留'}</p>
      <p className="prose">{source.narrative}</p>
      <button onClick={() => setSourceId(undefined)}>关闭来源原文</button>
    </section>}
    <h3>永久正文档案</h3>
    <label className="search">
      搜索历史回合
      <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="输入人物 ID、事件、地点、物品或正文关键词" maxLength={4000} />
    </label>
    <p className="muted" role="status">{query.trim() ? `本地相关结果 ${results.length} 条，最多 ${historySearchLimit} 条；姓名匹配仅为文本线索。` : `共 ${view.journal.length} 个已提交回合，每页 ${historySearchLimit} 条。`}</p>
    {results.length ? results.map((entry) => <details className="card entry" key={entry.turnId}>
      <summary>第 {entry.turnNumber} 回合 · {entry.summary || '未提供摘要，正文记录'}</summary>
      <small>{entry.turnId}</small>
      <p className="prose">{entry.narrative}</p>
    </details>) : <Empty>{query.trim() ? '未找到相关的已提交历史。' : '开局尚未提交，正文档案为空。'}</Empty>}
    {!query.trim() && view.journal.length > historySearchLimit && <div className="metric-row">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>查看较新回合</button>
      <span>第 {page + 1} 页</span>
      <button disabled={(page + 1) * historySearchLimit >= view.journal.length} onClick={() => setPage(page + 1)}>查看更早回合</button>
    </div>}
  </>;
}
