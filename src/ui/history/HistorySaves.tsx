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
    if (alive.current) setMessage('已导出此节点的标准存档备份，不含草稿、撤回链及其他收藏；可用原备份导入功能恢复。');
  }
  const nodes = (list?.nodes ?? []).filter(node => node.kind === tab), pages = Math.max(1, Math.ceil(nodes.length / 20));
  const pageIndex = Math.min(page, pages - 1);
  return <Dialog title="历史存档" className="history-saves" mobileVariant="sheet" sheetFull closeDisabled={busy}
    onClose={() => { if (!busy) onClose(); }}>
    <p className="history-notice" role="note">{preview ? `只读历史 · 第 ${preview.state.turnNumber} 回合结束。当前正式进度仍是第 ${preview.currentTurn} 回合；浏览不会替换进度或请求 AI。` : '自动历史复用最近五个撤回恢复点（64 MiB 预算）。手动收藏独立保留，只保存已经正式结算的世界。'}</p>
    {busy && <p role="status">正在处理历史数据，请稍候…</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {preview ? <>
      <div className="history-actions"><button disabled={busy} onClick={() => leavePreview()}>返回历史列表</button><button disabled={busy} onClick={() => void run(() => download(preview.node))}>导出此节点</button></div>
      <h3>{preview.node.name}{preview.node.oldTimeline && ' · 旧时间线收藏'}</h3>
      <p>{preview.state.protagonist.name} · {dateTime(preview.state.worldClock)} · 正式历史 {preview.state.journal.length} 回合</p>
      {confirm ? <section className="history-warning" aria-label="覆盖时间线确认">
        <h3>确认覆盖并继续？</h3>
        <p>你正在从第 {preview.state.turnNumber} 回合重新开始。确认后，当前正式时间线{preview.currentTurn > preview.state.turnNumber ? `中第 ${preview.state.turnNumber + 1}～${preview.currentTurn} 回合的剧情与状态` : '的进度'}将被所选节点替换，全部旧自动恢复点及未结算草稿将失效。此操作不能通过撤回恢复。玩家自行保存的历史节点不会被删除。</p>
        <p>新时间线以此节点为起点，只在新回合结算后重新积累撤回记录。保存完成后才会开始正常生成；若模型失败，将保留新的历史基线与已绑定行动。</p>
        <div className="history-actions"><button disabled={busy} onClick={() => setConfirm(false)}>取消，保留原进度</button>
          <button disabled={busy || !input.trim()} className="primary" onClick={() => void run(async () => {
            try {
              const result = await repository.history.restore(preview.confirmation, input, settings.runtime.useVariableStage, settings.runtime.useWorldStage);
              if (alive.current) onRestored(result);
            } catch (failure) {
              // The one-shot authorization is consumed even on failure; require a fresh preview.
              leavePreview(false); await refresh(); throw failure;
            }
          })}>确认覆盖并继续</button></div>
      </section> : <section className="history-restart"><label>从此历史节点开始的行动<textarea value={input} maxLength={100000} disabled={busy} onChange={event => setInput(event.target.value)}/></label>
        <button className="primary" disabled={busy || !input.trim()} onClick={() => setConfirm(true)}>发送新行动（先确认覆盖）</button>
        {preview.hasDraft && <p>当前还有未结算行动或候选。只有确认覆盖后才会丢弃；预览不影响原有断点续写。</p>}
      </section>}
      <HistoryWorld key={`${preview.node.kind}:${preview.node.id}`} preview={preview}/>
    </> : <>
      <div className="history-actions"><button aria-pressed={tab === 'automatic'} onClick={() => { setTab('automatic'); setPage(0); }}>自动历史</button>
        <button aria-pressed={tab === 'manual'} onClick={() => { setTab('manual'); setPage(0); }}>手动收藏</button>
        <button disabled={busy} onClick={() => setEditing({ name: '' })}>保存当前正式节点</button><button disabled={busy} onClick={() => void run(refresh)}>刷新历史列表</button></div>
      <p>手动收藏记录体积：{size(list?.manualBytes ?? 0)}（编码载荷及元数据，不含数据库内部开销）。普通整档备份不含历史收藏，请单独导出重要节点。</p>
      {estimate?.quota !== undefined && <p>浏览器估算：已使用约 {size(estimate.usage ?? 0)} / 配额约 {size(estimate.quota)}，不是精确剩余空间。{(estimate.usage ?? 0) > estimate.quota * .8 && '空间接近配额，请先导出并清理不需要的收藏。'}</p>}
      {list?.notice && <p role="alert">{list.notice}</p>}
      {editing && <form className="history-edit" onSubmit={event => { event.preventDefault(); void run(async () => {
        if (editing.id) await repository.history.rename(saveId, editing.id, editing.name); else await repository.history.create(saveId, editing.name);
        setEditing(undefined); setTab('manual'); setPage(0); await refresh(); setMessage('历史收藏已保存；正式游戏进度未改变。');
      }); }}><label>历史收藏名称<input value={editing.name} maxLength={100} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label>
        <button disabled={busy || !editing.name.trim()} type="submit">{editing.id ? '保存名称' : '保存收藏'}</button><button disabled={busy} type="button" onClick={() => setEditing(undefined)}>取消命名</button></form>}
      {deleting && <section className="history-warning"><p>永久删除收藏「{deleting.name}」？不会删除当前正式存档。建议先导出此节点。</p>
        <button disabled={busy} onClick={() => setDeleting(undefined)}>保留收藏</button><button disabled={busy} onClick={() => void run(async () => { await repository.history.delete(saveId, deleting.id); setDeleting(undefined); await refresh(); setMessage('已删除所选收藏。'); })}>确认删除收藏</button></section>}
      {!list ? <p>正在读取历史元数据…</p> : !nodes.length ? <p>{tab === 'automatic' ? '没有可靠的自动历史节点；开局、旧存档或新回溯根不伪造恢复点。' : '尚未保存手动收藏。'}</p> : <>
        <ul className="history-node-list">{nodes.slice(pageIndex * 20, (pageIndex + 1) * 20).map(node => <li key={node.id}>
          <h3>{node.name}</h3><p>{node.error ?? `第 ${node.turnNumber} 回合结束 · ${node.summary ? dateTime(node.summary.worldClock) : '旧恢复点，选中后读取真实游戏时间'}`}</p>
          <p>{node.summary?.protagonistName} · {size(node.bytes)} · {node.oldTimeline ? '旧时间线收藏' : '当前时间线'}{node.createdAt && ` · 收藏于 ${dateTime(node.createdAt)}`}</p>
          <details><summary>来源时间线</summary><p className="history-source">{node.source}</p></details>
          <div className="history-actions"><button disabled={busy || Boolean(node.error)} onClick={() => void run(() => select(node))}>预览第 {node.turnNumber} 回合</button>
            <button disabled={busy || Boolean(node.error)} onClick={() => void run(() => download(node))}>导出节点备份</button>
            {node.kind === 'manual' && <><button disabled={busy || Boolean(node.error)} onClick={() => setEditing({ id: node.id, name: node.name })}>重命名</button><button disabled={busy} onClick={() => setDeleting(node)}>删除收藏</button></>}</div>
        </li>)}</ul>
        <nav className="history-actions" aria-label="历史列表分页"><button disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页</button><span>{pageIndex + 1} / {pages}</span><button disabled={pageIndex + 1 >= pages} onClick={() => setPage(pageIndex + 1)}>下一页</button></nav>
      </>}
    </>}
  </Dialog>;
}
