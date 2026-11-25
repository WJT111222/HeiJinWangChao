import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Dialog } from '../Dialog';
import { DataError } from '../../domain/common';
import { maxTheaterBody, theaterLengths, theaterStates } from '../../domain/theater/record';
import type { TheaterPerspective } from '../../domain/theater/record';
import { readAiConfig } from '../../services/ai/configuration';
import type { Channel } from '../../services/ai/configuration';
import type { OpenTheater, TheaterCursor, TheaterListItem, TheaterOwner, TheaterRepository } from '../../services/storage/theaters';
import type { Settings } from '../settings/model';
import { checkTheaterTitle, prepareTheater, runTheater, theaterCredentials, theaterError, theaterPerspectives, theaterRoute } from '../../workflows/theater';
import type { TheaterAction, TheaterRunResult } from '../../workflows/theater';
import { StoryReading } from './StoryReadingView';
import './theater.css';

const disclaimer = '小剧场为非正史内容，不影响当前游戏进度、人物关系与世界状态。';
type Preview = Extract<TheaterRunResult, { kind: 'incomplete' }>;
export type TheaterLeaveGuard = (leave: () => void) => void;
const lengths = [...theaterLengths.map(tier => ({ id: tier.id, label: `${tier.name} · 约 ${tier.target.toLocaleString('zh-CN')} 字` })),
  { id: 'custom', label: '自定义' }];

const sameOwner = (a: TheaterOwner, b: TheaterOwner) =>
  a.saveId === b.saveId && a.createdAt === b.createdAt && a.instance === b.instance;
function count(value: string) {
  let length = 0;
  for (const char of value) if (!/\s/u.test(char)) length++;
  return length;
}
function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ModelChoice({ channels, channelId, model, onChannel, onModel }: {
  channels: Channel[]; channelId: string; model: string; onChannel: (id: string) => void; onModel: (model: string) => void;
}) {
  return <>
    <label>选择渠道<select required value={channelId} onChange={event => onChannel(event.target.value)}>
      <option value="">请选择</option>
      {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.protocol}</option>)}
    </select></label>
    <label>模型 ID<input required value={model} maxLength={200} onChange={event => onModel(event.target.value)} /></label>
  </>;
}

function NovelReader({ text, protagonist }: { text: string; protagonist: string }) {
  const [page, setPage] = useState(0);
  const parts = useMemo(() => {
    const result: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(text.length, offset + 24_000);
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end);
        if (newline > offset + 12_000) end = newline + 1;
        else if (/^[\uDC00-\uDFFF]$/u.test(text[end])) end--;
      }
      result.push(text.slice(offset, end));
      offset = end;
    }
    return result;
  }, [text]);
  const article = useRef<HTMLElement>(null);
  function goTo(next: number) {
    setPage(next);
    const reader = article.current?.closest('.theater-scroll');
    if (reader) reader.scrollTop = 0;
  }
  const visible = Math.max(0, Math.min(page, parts.length - 1));
  return <>
    <article ref={article} aria-label="小剧场正文"><StoryReading narrative={parts[visible] ?? ''} protagonistName={protagonist} /></article>
    {parts.length > 1 && <nav className="theater-actions" aria-label="正文分页">
      <button disabled={visible === 0} onClick={() => goTo(visible - 1)}>上一段</button>
      <span>第 {visible + 1} / {parts.length} 段</span>
      <button disabled={visible + 1 >= parts.length} onClick={() => goTo(visible + 1)}>下一段</button>
    </nav>}
  </>;
}

export function TheaterPanel({ repository, owner, settings, leaveGuard }: {
  repository: TheaterRepository; owner: TheaterOwner; settings: Settings; leaveGuard: RefObject<TheaterLeaveGuard | null>;
}) {
  const [view, setView] = useState<'list' | 'new' | 'read'>('list');
  const [items, setItems] = useState<TheaterListItem[]>();
  const [cursor, setCursor] = useState<TheaterCursor>();
  const [opened, setOpened] = useState<OpenTheater>();
  const [title, setTitle] = useState(''), [theme, setTheme] = useState('');
  const [tier, setTier] = useState('medium'), [custom, setCustom] = useState('');
  const [perspective, setPerspective] = useState<'follow' | TheaterPerspective>('follow');
  const [stream, setStream] = useState(settings.runtime.streamStory);
  const [independent, setIndependent] = useState(false), [routeEditor, setRouteEditor] = useState(false);
  const [channelId, setChannelId] = useState(''), [model, setModel] = useState('');
  const [rename, setRename] = useState<string>();
  const [confirm, setConfirm] = useState<'delete' | 'reroll'>();
  const [running, setRunning] = useState<TheaterAction>();
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState(''), [thoughts, setThoughts] = useState('');
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [preview, setPreview] = useState<{ result: Preview; action: TheaterAction }>();
  const [leaveRequest, setLeaveRequest] = useState<(() => void)>();
  const lifetime = useRef<AbortController | undefined>(undefined);
  const active = useRef<AbortController | undefined>(undefined);
  const pageLoad = useRef(false);
  const follow = useRef(true);
  const reading = useRef<HTMLDivElement>(null);
  const navRevision = useRef(0);
  const needsLeaveConfirmation = Boolean(running || saving || preview);

  useLayoutEffect(() => {
    if (!needsLeaveConfirmation) return;
    const guard: TheaterLeaveGuard = leave => setLeaveRequest(current => current ?? leave);
    leaveGuard.current = guard;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => {
      if (leaveGuard.current === guard) leaveGuard.current = null;
      window.removeEventListener('beforeunload', unload);
    };
  }, [leaveGuard, needsLeaveConfirmation]);

  useLayoutEffect(() => {
    const session = new AbortController();
    lifetime.current = session;
    let visible = true;
    void repository.list(owner.saveId, undefined, owner).then(
      page => { if (visible) { setItems(page.items); setCursor(page.next); } },
      failure => { if (visible) setError(theaterError(failure)); },
    );
    return () => { visible = false; session.abort(); active.current?.abort(); };
  }, [repository, owner.saveId, owner.instance, owner.createdAt]);

  useEffect(() => {
    if (running && follow.current && reading.current) reading.current.scrollTop = reading.current.scrollHeight;
  }, [live, running]);

  function clearMessages() { setError(''); setNotice(''); }

  async function loadList(after?: TheaterCursor) {
    if (after && pageLoad.current) return;
    const session = lifetime.current, revision = navRevision.current;
    pageLoad.current = true;
    try {
      const page = await repository.list(owner.saveId, after, owner);
      if (!session?.signal.aborted && revision === navRevision.current) {
        setItems(current => after ? [...(current ?? []), ...page.items.filter(item => !current?.some(old => old.id === item.id))] : page.items);
        setCursor(page.next);
      }
    } catch (failure) { if (!session?.signal.aborted) setError(theaterError(failure)); }
    finally { pageLoad.current = false; }
  }

  function list() {
    navRevision.current++;
    clearMessages(); setOpened(undefined); setPreview(undefined); setRename(undefined); setConfirm(undefined); setRouteEditor(false);
    setView('list'); setItems(undefined); setCursor(undefined); void loadList();
  }

  async function open(id: string) {
    const session = lifetime.current, revision = ++navRevision.current;
    clearMessages();
    try {
      const item = await repository.open(owner.saveId, id);
      if (!sameOwner(item.owner, owner)) throw new DataError('THEATER_OWNER', '所属存档已被替换，请重新读档。');
      if (!session?.signal.aborted && revision === navRevision.current) {
        setOpened(item); setView('read'); setLive(''); setThoughts(''); setPreview(undefined);
      }
    } catch (failure) { if (!session?.signal.aborted) setError(theaterError(failure)); }
  }

  async function generate(action: TheaterAction, create?: boolean) {
    const session = lifetime.current;
    if (!session || session.signal.aborted || active.current || (!create && !opened)) return;
    const current = new AbortController();
    active.current = current;
    clearMessages(); setPreview(undefined); setLive(''); setThoughts(''); setConfirm(undefined);
    follow.current = true;
    setRunning(action);
    let frame = 0, text = '', reasoning = '';
    const display = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!session.signal.aborted) { setLive(text); setThoughts(reasoning); }
      });
    };
    try {
      const { config, vault } = theaterCredentials();
      let item = opened;
      if (create) {
        const target = tier === 'custom' ? Number(custom) : theaterLengths.find(value => value.id === tier)!.target;
        const project = await prepareTheater({ title, theme, target, perspective, stream,
          choice: independent ? { channelId, model } : undefined }, settings, config, vault);
        if (session.signal.aborted || current.signal.aborted) return;
        item = await repository.create(owner.saveId, project, owner, session.signal);
        if (session.signal.aborted) return;
        setOpened(item); setView('read');
      }
      if (!item) return;
      const result = await runTheater(repository, item, action, {
        config, vault, signal: current.signal, lifetime: session.signal,
        onText: value => { text = value; display(); },
        onReasoning: value => { reasoning = value; display(); },
        onSaving: () => { if (!session.signal.aborted) setSaving(true); },
      });
      if (session.signal.aborted) return;
      setThoughts(reasoning);
      if (result.kind === 'saved') { setOpened(result.value); setNotice('正文已保存。'); }
      else if (result.kind === 'failed') { if (result.value) setOpened(result.value); setError(result.message); }
      else { setPreview({ result, action }); setNotice(result.message); }
    } catch (failure) {
      if (!session.signal.aborted) setError(theaterError(failure));
    } finally {
      cancelAnimationFrame(frame);
      active.current = undefined;
      if (!session.signal.aborted) { setRunning(undefined); setSaving(false); setLive(''); }
    }
  }

  async function edit(work: () => Promise<void>) {
    const session = lifetime.current;
    if (!session || session.signal.aborted || active.current) return;
    const lock = new AbortController();
    active.current = lock; setSaving(true); clearMessages();
    try { await work(); }
    catch (failure) { if (!session.signal.aborted) setError(theaterError(failure)); }
    finally { active.current = undefined; if (!session.signal.aborted) setSaving(false); }
  }

  async function keepPreview(afterSave?: () => void) {
    if (!opened || !preview) return;
    const session = lifetime.current;
    const { result, action } = preview;
    await edit(async () => {
      const next = action === 'reroll' && opened.record.body
        ? await repository.fork(opened, crypto.randomUUID(), result.body, result.status, session?.signal)
        : await repository.saveText(opened, result.body, result.status, session?.signal);
      if (!session?.signal.aborted) {
        setOpened(next); setPreview(undefined); setNotice('已保留这段正文，可手动续写。');
        afterSave?.();
      }
    });
  }

  function finishLeaving() {
    // The confirmed navigation can also enter the shared app guard (e.g. href changes).
    leaveGuard.current = null;
    setLeaveRequest(undefined);
    setPreview(undefined);
    leaveRequest?.();
  }

  function newTheater() {
    navRevision.current++;
    clearMessages(); setTitle(''); setTheme(''); setTier('medium'); setCustom(''); setPerspective('follow');
    setIndependent(false); setChannelId(''); setModel(''); setStream(settings.runtime.streamStory); setView('new');
  }
  const channels = view === 'new' || routeEditor ? readAiConfig(localStorage).channels : [];
  const chooseChannel = (id: string) => {
    setChannelId(id); setModel(channels.find(channel => channel.id === id)?.defaultModel ?? '');
  };
  const busy = Boolean(running || saving);
  const record = opened?.record;
  const forkPreview = preview?.action === 'reroll' && Boolean(record?.body);
  const shown = running ? live : preview?.result.body ?? record?.body ?? '';
  const liveCount = useMemo(() => count(shown), [shown]);

  return <section className="theater-panel" aria-label="小剧场工作台">
    <header className="theater-bar">
      {view !== 'list' && <button onClick={() => leaveGuard.current ? leaveGuard.current(list) : list()}>返回列表</button>}
      {view === 'list' ? <button className="primary" onClick={newTheater}>新建小剧场</button>
        : view === 'read' && record && <span>{record.config.route.model}</span>}
    </header>
    <div className="theater-scroll" ref={reading} onScroll={event => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 45;
    }}>
      {error && <p role="alert" className="theater-notice">{error}</p>}
      {notice && <p role="status" className="theater-notice">{notice}</p>}
      {view === 'list' && <>
        <p className="field-hint">{disclaimer}</p>
        {items?.length === 0 && <div className="theater-empty"><h3>档案尚空</h3><p>从一段番外、一场未发生的相遇，或一个人物的独白开始。</p></div>}
        {!items && !error && <p role="status">正在读取小剧场…</p>}
        <ul className="theater-list">{items?.map(item => <li className="card" key={item.id}>
          <button onClick={() => void open(item.id)} className="theater-title">{item.title}</button>
          <p>{item.theme}</p>
          <small>{theaterStates[item.status]} · {item.length.toLocaleString('zh-CN')} 字 · {item.model}</small>
          <small>创建 {date(item.createdAt)} · 更新 {date(item.updatedAt)}</small>
        </li>)}</ul>
        {cursor && <button onClick={() => void loadList(cursor)}>加载更多小剧场</button>}
      </>}
      {view === 'new' && <form className="theater-form" onSubmit={event => { event.preventDefault(); void generate('initial', true); }}>
        <p className="field-hint">{disclaimer}</p>
        <label>标题（选填）<input maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>主题<textarea rows={4} required maxLength={4000} value={theme} onChange={event => setTheme(event.target.value)} /></label>
        <label>正文篇幅<select value={tier} onChange={event => setTier(event.target.value)}>
          {lengths.map(length => <option key={length.id} value={length.id}>{length.label}</option>)}
        </select></label>
        {tier === 'custom' && <label>目标字数<input required type="number" min={100} max={100000} value={custom}
          onChange={event => setCustom(event.target.value)} /></label>}
        <p className="field-hint">目标字数用于创作节奏。实际长度受模型输出能力影响，达到上限后可以手动续写。</p>
        <label>叙事人称<select value={perspective} onChange={event => setPerspective(event.target.value as typeof perspective)}>
          <option value="follow">跟随主线</option>
          {Object.entries(theaterPerspectives).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>生成模型<select value={independent ? 'independent' : 'story'} onChange={event => setIndependent(event.target.value === 'independent')}>
          <option value="story">跟随正文模型</option><option value="independent">单独指定</option>
        </select></label>
        {independent && <ModelChoice channels={channels} channelId={channelId} model={model} onChannel={chooseChannel} onModel={setModel} />}
        <label className="toggle"><input type="checkbox" checked={stream} onChange={event => setStream(event.target.checked)} />流式显示正文</label>
        <button className="primary" disabled={busy}>新建并生成</button>
      </form>}
      {view === 'read' && record && <>
        <h2 className="theater-heading">{record.title}</h2>
        {record.theme !== record.title && <p className="theater-theme">{record.theme}</p>}
        <p className="field-hint">主线第 {record.background.turn} 回合的背景 · {theaterPerspectives[record.config.perspective]} · 目标 {record.config.target.toLocaleString('zh-CN')} 字</p>
        <p className="theater-count" aria-live="off">{running ? saving ? '正在保存' : '正在生成' : preview ? theaterStates[preview.result.status] : theaterStates[record.status]} · {liveCount.toLocaleString('zh-CN')} 字</p>
        {preview && <>
          <p className="field-hint">{forkPreview ? '原正文仍已保存。可将这次结果另存为未完篇。' : '可保留已写部分，稍后主动续写。'}</p>
          <div className="theater-actions">
            <button className="primary" disabled={busy} onClick={() => void keepPreview()}>
              {forkPreview ? '另存为未完篇' : '保留已写部分'}
            </button>
            <button disabled={busy} onClick={() => { setPreview(undefined); clearMessages(); }}>放弃这次结果</button>
          </div>
        </>}
        {shown ? running
          ? <article aria-label="小剧场正文">{shown.length > 16000 && <p className="field-hint">生成时预览最新正文，保存后可阅读全文。</p>}
            <StoryReading narrative={shown.slice(-16000)} protagonistName={record.background.protagonist} /></article>
          : <NovelReader key={record.id + ':' + record.revision + ':' + Boolean(preview)} text={shown} protagonist={record.background.protagonist} />
          : <p>{running ? '等待模型返回正文…' : '目前没有已保存正文。'}</p>}
        {thoughts && <details className="theater-thoughts"><summary>供应商公开思考</summary><p>{thoughts}</p></details>}
        {rename !== undefined && <form className="theater-form" onSubmit={event => {
          event.preventDefault();
          void edit(async () => {
            if (!opened) return;
            const { config, vault } = theaterCredentials();
            setOpened(await repository.rename(opened, checkTheaterTitle(rename, config, vault))); setRename(undefined);
          });
        }}>
          <label>新标题<input required maxLength={100} value={rename} onChange={event => setRename(event.target.value)} /></label>
          <div className="theater-actions"><button disabled={busy}>保存标题</button><button type="button" onClick={() => setRename(undefined)}>取消重命名</button></div>
        </form>}
        {routeEditor && <form className="theater-form" onSubmit={event => {
          event.preventDefault();
          void edit(async () => {
            if (!opened) return;
            const { config, vault } = theaterCredentials();
            setOpened(await repository.changeRoute(opened, await theaterRoute(config, vault, { channelId, model })));
            setRouteEditor(false); setNotice('已保存所选模型。');
          });
        }}>
          <ModelChoice channels={channels} channelId={channelId} model={model} onChannel={chooseChannel} onModel={setModel} />
          <div className="theater-actions"><button disabled={busy}>保存模型</button><button type="button" onClick={() => setRouteEditor(false)}>取消选择</button></div>
        </form>}
      </>}
    </div>
    {running && <footer className="theater-actions"><button disabled={saving} onClick={() => active.current?.abort()}>停止生成</button></footer>}
    {view === 'read' && record && !running && !preview && !rename && !routeEditor && !confirm &&
      <footer className="theater-actions" aria-label="正文操作">
        {record.body ? <>
          <button className="primary" disabled={busy || record.body.length >= maxTheaterBody} onClick={() => void generate('continue')}>继续写作</button>
          <button disabled={busy} onClick={() => setConfirm('reroll')}>重新 Roll</button>
          <button disabled={busy} onClick={() => {
            if (!navigator.clipboard) { setError('复制失败，可以选中正文复制。'); return; }
            void navigator.clipboard.writeText(record.body).then(() => setNotice('已复制全文。'), () => setError('复制失败，可以选中正文复制。'));
          }}>复制全文</button>
        </> : <button className="primary" disabled={busy} onClick={() => void generate('initial')}>生成正文</button>}
        <button disabled={busy} onClick={() => setRename(record.title)}>重命名</button>
        <button disabled={busy} onClick={() => { setChannelId(record.config.route.channelId); setModel(record.config.route.model); setRouteEditor(true); }}>更换模型</button>
        <button disabled={busy} onClick={() => setConfirm('delete')}>删除小剧场</button>
      </footer>}
    {confirm && <footer className="theater-confirm">
      <p>{confirm === 'reroll' ? '重新生成会发起一次模型请求。只有新正文完整保存后才会替换原文。' : '删除本篇小剧场？删除后无法恢复。'}</p>
      <div className="theater-actions">
        <button disabled={busy} onClick={() => setConfirm(undefined)}>取消</button>
        {confirm === 'reroll' ? <button className="primary" disabled={busy} onClick={() => void generate('reroll')}>确认重新 Roll</button>
          : <button className="danger" disabled={busy} onClick={() => void edit(async () => { if (opened) { await repository.delete(opened); list(); } })}>确认删除小剧场</button>}
      </div>
    </footer>}
    {leaveRequest && <Dialog title="离开小剧场？" onClose={() => setLeaveRequest(undefined)} small mobileVariant="confirm">
      {saving ? <p>正在保存，请等待本次操作完成。</p> : running ? <p>仍在生成正文。可以停止请求，查看已写部分后再决定是否保留。</p>
        : preview ? <p>{forkPreview ? '原正文已保留。可以将这次尚未保存的正文另存为未完篇。' : '还有尚未保存的正文。'}</p>
          : <p>本次操作已结束，可以离开小剧场。</p>}
      {!running && error && <p role="alert">{error}</p>}
      <div className="theater-actions">
        <button onClick={() => setLeaveRequest(undefined)}>{running && !saving ? '继续生成' : '留在小剧场'}</button>
        {!saving && (running ? <button className="primary" onClick={() => { active.current?.abort(); setLeaveRequest(undefined); }}>停止并查看正文</button>
          : preview ? <>
            <button className="primary" onClick={() => void keepPreview(finishLeaving)}>{forkPreview ? '另存为未完篇并离开' : '保留并离开'}</button>
            <button onClick={finishLeaving}>放弃并离开</button>
          </> : <button className="primary" onClick={finishLeaving}>离开小剧场</button>)}
      </div>
    </Dialog>}
  </section>;
}
