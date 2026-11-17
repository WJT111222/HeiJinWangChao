import { useEffect, useMemo, useRef, useState } from 'react';
import type { SaveRepository } from '../../services/storage/saveRepository';
import type { HistoryNode } from '../../services/storage/history/model';
import type { HistoryPreview } from '../../services/storage/history/repository';
import { historyError } from '../../services/storage/history/repository';
import { PRODUCT_VERSION } from '../../app/product';
import { Dialog } from '../Dialog';
import { playerView, dateTime } from '../panels/playerView';
import { Panels, panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
import { ProfilePanel } from '../panels/ProfilePanel';
import { EconomyPanel } from '../panels/EconomyPanel';
import { StoryReading } from '../game/StoryReadingView';
import type { Settings } from '../settings/model';
import './history-saves.css';

type Restored = Awaited<ReturnType<SaveRepository['history']['restore']>>;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
function HistoryWorld({ preview }: { preview: HistoryPreview }) {
  const [panel, setPanel] = useState<PanelName | '正文' | '人物档案' | '经济与资产'>('正文');
  const state = preview.state, view = useMemo(() => playerView(state), [state]);
  const wear = state.protagonist.currentWear, item = (id?: string) => id ? state.items[id]?.name ?? '无' : '无';
  const equipment: [string, string][] = [['上衣', item(wear.topItemId)], ['下装', item(wear.bottomItemId)], ['鞋子', item(wear.shoesItemId)],
    ['饰品', wear.accessoryItemIds.map(item).join('、') || '无'], ['主武器', item(wear.primaryWeaponItemId)], ['副武器', item(wear.secondaryWeaponItemId)],
    ['载具', wear.currentVehicleAssetId ? state.economy.vehicles[wear.currentVehicleAssetId]?.name ?? '无' : '无']];
  const [chapter, setChapter] = useState(state.journal.length - 1), story = state.journal[chapter]?.story;
  return <section className="history-world" aria-label="只读历史世界">
    <label>历史阅读内容<select value={panel} onChange={e => setPanel(e.target.value as typeof panel)}>
      {['正文', '人物档案', '经济与资产', ...panelNames].map(name => <option key={name}>{name}</option>)}
    </select></label>
    {panel === '正文' ? <><label>历史章节<select value={chapter} onChange={e => setChapter(Number(e.target.value))}>
      {state.journal.map((entry, i) => <option value={i} key={entry.turnId}>第 {i + 1} 回合</option>)}
    </select></label><article className="history-story">{story && <StoryReading narrative={story.narrative} protagonistName={state.protagonist.name}/>}</article></>
      : panel === '人物档案' ? <ProfilePanel state={state} equipment={equipment} onEconomy={() => setPanel('经济与资产')} onNpc={() => setPanel('NPC')} onSaves={() => setPanel('正文')}/>
        : panel === '经济与资产' ? <EconomyPanel view={view}/> : <Panels name={panel} view={view}/>}
  </section>;
}
export function HistorySaves({ repository, saveId, settings, onClose, onRestored }: {
  repository: SaveRepository; saveId: string; settings: Settings; onClose: () => void; onRestored: (result: Restored) => void;
}) {
  const [list, setList] = useState<Awaited<ReturnType<SaveRepository['history']['list']>>>();
  const [preview, setPreview] = useState<HistoryPreview>();
  const previewRef = useRef<HistoryPreview | undefined>(undefined);
  const [busy, setBusy] = useState(false), running = useRef(false), alive = useRef(true);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [tab, setTab] = useState<'automatic' | 'manual'>('automatic'), [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ id?: string; name: string }>(), [deleting, setDeleting] = useState<HistoryNode>();
  const [input, setInput] = useState(''), [confirm, setConfirm] = useState(false);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>();
  useEffect(() => {
    alive.current = true;
    void repository.history.list(saveId).then(value => { if (alive.current) setList(value); }).catch(failure => { if (alive.current) setError(historyError(failure)); });
    void navigator.storage?.estimate?.().then(value => { if (alive.current) setEstimate(value); }).catch(() => undefined);
    return () => { alive.current = false; if (previewRef.current) repository.history.release(previewRef.current.confirmation); };
  }, [repository, saveId]);
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (failure) { if (alive.current) setError(historyError(failure)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function refresh() {
    const value = await repository.history.list(saveId); if (alive.current) setList(value);
  }
  function leavePreview(clearInput = true) {
    if (previewRef.current) repository.history.release(previewRef.current.confirmation);
    previewRef.current = undefined; setPreview(undefined); if (clearInput) setInput(''); setConfirm(false);
  }
  async function select(node: HistoryNode) {
    const value = await repository.history.preview(saveId, node);
    if (!alive.current) { repository.history.release(value.confirmation); return; }
    leavePreview(false); previewRef.current = value; setPreview(value);
  }
  async function download(node: HistoryNode) {
    const exported = await repository.history.exportNode(saveId, node, PRODUCT_VERSION);
    const url = URL.createObjectURL(new Blob([exported.text], { type: 'application/json' })), link = document.createElement('a');
    try { link.href = url; link.download = exported.name; document.body.append(link); link.click(); }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    if (alive.current) setMessage('已导出节点备份，不含未结算内容和其他收藏。');
  }
  const nodes = (list?.nodes ?? []).filter(node => node.kind === tab), pages = Math.max(1, Math.ceil(nodes.length / 20));
  const pageIndex = Math.min(page, pages - 1);
  return <Dialog title="历史存档" className="history-saves" mobileVariant="sheet" sheetFull closeDisabled={busy}
    onClose={() => { if (!busy) onClose(); }}>
    <p className="history-notice" role="note">{preview ? `只读历史 · 第 ${preview.state.turnNumber} 回合结束。当前第 ${preview.currentTurn} 回合。` : '自动保留最近 5 个恢复点；手动收藏不会自动轮换删除。'}</p>
    {busy && <p role="status">正在处理…</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {preview ? <>
      <div className="history-actions"><button aria-label="返回历史列表" disabled={busy} onClick={() => leavePreview()}>返回列表</button><button aria-label="导出此节点" disabled={busy} onClick={() => void run(() => download(preview.node))}>导出</button></div>
      <h3>{preview.node.name}{preview.node.oldTimeline && ' · 旧时间线收藏'}</h3>
      <p>{preview.state.protagonist.name} · {dateTime(preview.state.worldClock)} · 共 {preview.state.journal.length} 回合</p>
      {confirm ? <section className="history-warning" aria-label="覆盖时间线确认">
        <h3>确认覆盖并继续？</h3>
        <p>从第 {preview.state.turnNumber} 回合继续，将覆盖{preview.currentTurn > preview.state.turnNumber ? `第 ${preview.state.turnNumber + 1}～${preview.currentTurn} 回合的剧情与状态` : '当前进度'}，并清除现有恢复点和未结算内容。无法撤销，手动收藏会保留。</p>
        <p>确认后保存此进度并生成下一章；即使生成失败，也不会恢复被覆盖的时间线。</p>
        <div className="history-actions"><button aria-label="取消，保留原进度" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
          <button aria-label="确认覆盖并继续" disabled={busy || !input.trim()} className="primary" onClick={() => void run(async () => {
            try {
              const result = await repository.history.restore(preview.confirmation, input, settings.runtime.useVariableStage, settings.runtime.useWorldStage);
              if (alive.current) onRestored(result);
            } catch (failure) {
              // The one-shot authorization is consumed even on failure; require a fresh preview.
              leavePreview(false); await refresh(); throw failure;
            }
          })}>确认覆盖</button></div>
      </section> : <section className="history-restart"><label>下一步行动<textarea aria-label="从此历史节点开始的行动" value={input} maxLength={100000} disabled={busy} onChange={event => setInput(event.target.value)}/></label>
        <button aria-label="发送新行动（先确认覆盖）" className="primary" disabled={busy || !input.trim()} onClick={() => setConfirm(true)}>从此继续</button>
        {preview.hasDraft && <p>当前有未结算内容，仅在确认覆盖后清除。</p>}
      </section>}
      <HistoryWorld key={`${preview.node.kind}:${preview.node.id}`} preview={preview}/>
    </> : <>
      <div className="history-toolbar"><div className="history-tabs" role="group" aria-label="历史节点分类"><button aria-pressed={tab === 'automatic'} onClick={() => { setTab('automatic'); setPage(0); }}>自动历史</button>
        <button aria-pressed={tab === 'manual'} onClick={() => { setTab('manual'); setPage(0); }}>手动收藏</button></div><div className="history-actions">
        <button aria-label="保存当前正式节点" className="primary" disabled={busy} onClick={() => setEditing({ name: '' })}>收藏</button><button aria-label="刷新历史列表" disabled={busy} onClick={() => void run(refresh)}>刷新</button></div></div>
      <p className="history-backup-note">普通备份不含历史收藏，重要节点请单独导出。</p>
      <details className="history-storage"><summary>存储详情</summary>
      <p>收藏占用：{size(list?.manualBytes ?? 0)}。</p>
      {estimate?.quota !== undefined && <p>浏览器存储：已使用约 {size(estimate.usage ?? 0)} / 配额约 {size(estimate.quota)}（估算）。{(estimate.usage ?? 0) > estimate.quota * .8 && '空间不足时请先导出，再删除不需要的收藏。'}</p>}
      </details>
      {list?.notice && <p role="alert">{list.notice}</p>}
      {editing && <form className="history-edit" onSubmit={event => { event.preventDefault(); void run(async () => {
        if (editing.id) await repository.history.rename(saveId, editing.id, editing.name); else await repository.history.create(saveId, editing.name);
        setEditing(undefined); setTab('manual'); setPage(0); await refresh(); setMessage('已保存收藏。');
      }); }}><label>历史收藏名称<input value={editing.name} maxLength={100} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label>
        <button className="primary" disabled={busy || !editing.name.trim()} type="submit">{editing.id ? '保存名称' : '保存收藏'}</button><button aria-label="取消命名" disabled={busy} type="button" onClick={() => setEditing(undefined)}>取消</button></form>}
      {deleting && <section className="history-warning history-delete" aria-label="删除收藏确认"><h3>永久删除收藏</h3><p>删除「{deleting.name}」后无法恢复，当前进度不受影响。重要节点请先导出。</p>
        <button aria-label="保留收藏" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button><button aria-label="确认删除收藏" className="history-danger" disabled={busy} onClick={() => void run(async () => { await repository.history.delete(saveId, deleting.id); setDeleting(undefined); await refresh(); setMessage('已删除收藏。'); })}>永久删除</button></section>}
      {!list ? <p>正在读取历史存档…</p> : !nodes.length ? <p>{tab === 'automatic' ? '暂无自动恢复点。' : '尚未保存手动收藏。'}</p> : <>
        <ul className="history-node-list">{nodes.slice(pageIndex * 20, (pageIndex + 1) * 20).map(node => <li key={node.id} data-kind={node.oldTimeline ? 'old' : node.kind}>
          <div className="history-turn" aria-label={`第 ${node.turnNumber} 回合`}><span aria-hidden="true">第</span><b>{node.turnNumber}</b><span aria-hidden="true">回合</span></div>
          <div className="history-node-content"><span className="history-badge">{node.oldTimeline ? '旧时间线收藏' : node.kind === 'manual' ? '手动收藏' : '自动历史'}</span><h3>{node.name}</h3><p>{node.error ?? (node.summary ? dateTime(node.summary.worldClock) : '游戏时间待读取')}</p>
          <p className="history-meta">{node.summary?.protagonistName}</p>
          <details><summary>详情</summary><p>{size(node.bytes)} · {node.oldTimeline ? '旧时间线收藏' : '当前时间线'}{node.createdAt && ` · 收藏于 ${dateTime(node.createdAt)}`}</p><p className="history-source">来源时间线：{node.source}</p></details></div>
          <div className="history-actions history-node-actions"><button aria-label={`预览第 ${node.turnNumber} 回合`} disabled={busy || Boolean(node.error)} onClick={() => void run(() => select(node))}>预览</button>
            <button aria-label="导出节点备份" disabled={busy || Boolean(node.error)} onClick={() => void run(() => download(node))}>导出</button>
            {node.kind === 'manual' && <><button disabled={busy || Boolean(node.error)} onClick={() => setEditing({ id: node.id, name: node.name })}>重命名</button><button aria-label="删除收藏" className="history-danger" disabled={busy} onClick={() => setDeleting(node)}>删除</button></>}</div>
        </li>)}</ul>
        <nav className="history-actions" aria-label="历史列表分页"><button disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页</button><span>{pageIndex + 1} / {pages}</span><button disabled={pageIndex + 1 >= pages} onClick={() => setPage(pageIndex + 1)}>下一页</button></nav>
      </>}
    </>}
  </Dialog>;
}
