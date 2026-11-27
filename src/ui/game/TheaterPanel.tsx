import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Dialog } from '../Dialog';
import { DataError } from '../../domain/common';
import { maxTheaterBody, theaterLengths, theaterStates } from '../../domain/theater/record';
import type { TheaterPerspective } from '../../domain/theater/record';
import { selectedModelRoute } from '../../services/ai/snapshot';
import { readAiConfig } from '../../services/ai/configuration';
import type { Channel } from '../../services/ai/configuration';
import type { OpenTheater, TheaterCursor, TheaterListItem, TheaterOwner, TheaterRepository } from '../../services/storage/theaters';
import type { Settings } from '../settings/model';
import { checkTheaterTitle, prepareTheater, runTheater, theaterCredentials, theaterError, theaterPerspectives, theaterRoute } from '../../workflows/theater';
import type { TheaterAction, TheaterRunResult } from '../../workflows/theater';
import { parseStoryReading } from './storyReading';
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
/** 列表与文章头部用的短时间：今天 / 昨天 / 月日，完整时间放在 title 里。 */
function when(value: string) {
  const at = new Date(value), now = new Date();
  const time = at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `昨天 ${time}`;
  return `${at.getFullYear() === now.getFullYear() ? '' : at.getFullYear() + '/'}${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')} ${time}`;
}
/** 游戏内时间（ISO，带时区）只取字面的日期与时刻，不按浏览器时区换算。 */
function clock(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u);
  return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : undefined;
}
const Icon = ({ d, fill }: { d: string; fill?: boolean }) =>
  <svg className="th-ico" viewBox="0 0 16 16" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const icons = {
  back: 'M10 3 5 8l5 5', next: 'M6 3l5 5-5 5', plus: 'M8 3v10M3 8h10', pen: 'M3 13h3l7-7-3-3-7 7z',
  roll: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5', copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  more: 'M3.5 6.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6M8 6.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6M12.5 6.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6',
  stop: 'M4.5 4.5h7v7h-7z', model: 'M2.5 5h7M12.5 5h1M2.5 11h4M9.5 11h4M11 3.5v3M8 9.5v3',
  remake: 'M3 3.5h6.5l3.5 3.5v5.5H3zM9.5 3.5V7H13M8 8.5v3M6.5 10h3', trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
} as const;
const ideas = ['某个 NPC 的一天', '如果那晚做了另一个选择', '多年以后的重逢'];

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

/** 书页排版：沿用主线的台词解析，旁白按行拆成段落，便于首行缩进；不改动正文本身。 */
function TheaterProse({ text, protagonist }: { text: string; protagonist: string }) {
  const blocks = useMemo(() => parseStoryReading(text, protagonist), [text, protagonist]);
  return <div className="story-reading">
    {blocks.map((block, index) => block.kind === 'dialogue' ? (
      <div className={`story-dialogue${block.isProtagonist ? ' story-dialogue-hero' : ''}`} key={index}>
        <span className="avatar story-avatar" aria-hidden="true">{Array.from(block.speaker)[0]}</span>
        <div className="story-speech">
          <p className="story-speaker">{block.speaker}</p>
          <p className="prose story-bubble">{block.text.trim()}</p>
        </div>
      </div>
    ) : block.text.split(/\r?\n/u).map(line => line.replace(/^[\s\u3000]+|\s+$/gu, '')).filter(Boolean).map((line, part) =>
      <p className="prose story-narration" key={`${index}:${part}`}>{line}</p>))}
  </div>;
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
    <article ref={article} aria-label="小剧场正文" className="th-novel"><TheaterProse text={parts[visible] ?? ''} protagonist={protagonist} /></article>
    {parts.length > 1 && <nav className="th-pager" aria-label="正文分页">
      <button className="th-btn ghost" disabled={visible === 0} onClick={() => goTo(visible - 1)}>上一段</button>
      <span className="th-dots" aria-hidden="true">{parts.map((_, index) => <i key={index} data-on={index === visible || undefined} />)}</span>
      <span>第 {visible + 1} / {parts.length} 段</span>
      <button className="th-btn ghost" disabled={visible + 1 >= parts.length} onClick={() => goTo(visible + 1)}>下一段</button>
    </nav>}
  </>;
}

export function TheaterPanel({ repository, owner, settings, leaveGuard, latest }: {
  repository: TheaterRepository; owner: TheaterOwner; settings: Settings; leaveGuard: RefObject<TheaterLeaveGuard | null>;
  /** 当前已结算主线的回合与时间，仅用于新建页提示背景会冻结在哪里；实际背景仍在创建时读取。 */
  latest?: { turn: number; time: string | null };
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
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);

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

  /** 新建；从已有作品「以此主题新建」时带上原主题与设置，背景在生成时按最新主线重新读取，原作品不变。 */
  function newTheater(from?: { theme: string; config?: OpenTheater['record']['config']; title?: string }) {
    navRevision.current++;
    clearMessages(); setMenu(false); setOpened(undefined); setPreview(undefined); setRename(undefined); setConfirm(undefined); setRouteEditor(false);
    const config = from?.config, preset = config && theaterLengths.find(value => value.target === config.target);
    setTitle(from?.title ?? ''); setTheme(from?.theme ?? '');
    setTier(config ? preset?.id ?? 'custom' : settings.theater?.length ?? 'medium');
    setCustom(config ? (preset ? '' : String(config.target)) : String(settings.theater?.customChars ?? ''));
    setPerspective(config ? (config.followsPerspective ? 'follow' : config.perspective) : settings.theater?.perspective ?? 'follow');
    setIndependent(config?.routeMode === 'independent');
    setChannelId(config?.routeMode === 'independent' ? config.route.channelId : '');
    setModel(config?.routeMode === 'independent' ? config.route.model : '');
    setStream(config ? config.stream : settings.runtime.streamStory); setView('new');
  }
  const aiConfig = view === 'new' || routeEditor ? readAiConfig(localStorage) : undefined;
  const channels = aiConfig?.channels ?? [];
  const chooseChannel = (id: string) => {
    setChannelId(id); setModel(channels.find(channel => channel.id === id)?.defaultModel ?? '');
  };
  const busy = Boolean(running || saving);
  const record = opened?.record;
  const forkPreview = preview?.action === 'reroll' && Boolean(record?.body);
  const shown = running ? live : preview?.result.body ?? record?.body ?? '';
  const liveCount = useMemo(() => count(shown), [shown]);

  const status = running ? 'live' : preview ? preview.result.status : record?.status;
  const statusText = running ? saving ? '正在保存' : '正在生成' : preview ? theaterStates[preview.result.status] : record ? theaterStates[record.status] : '';
  const target = tier === 'custom' ? Number(custom) || 0 : theaterLengths.find(value => value.id === tier)?.target ?? 0;
  const defaultRoute = aiConfig && selectedModelRoute(aiConfig, 'theater');
  const ticketChannel = channels.find(channel => channel.id === (independent ? channelId : defaultRoute?.channelId));
  const ticketModel = independent ? model : defaultRoute?.modelId || ticketChannel?.defaultModel;
  const menuItem = (label: string, icon: keyof typeof icons, run: () => void, danger?: boolean) =>
    <button type="button" className={danger ? 'th-danger' : undefined} disabled={busy} onClick={() => { setMenu(false); run(); }}><Icon d={icons[icon]} />{label}</button>;

  return <section className="theater-panel" aria-label="小剧场工作台">
    <header className="theater-bar">
      {view === 'list' ? <>
        <h3 className="th-count">戏单{items && items.length > 0 && <small>{cursor ? `已载入 ${items.length} 篇` : `共 ${items.length} 篇`}</small>}</h3>
        <span className="th-end">
          <span className="th-seal-note" title={disclaimer}><i>非正史</i><span>不影响主线进度与世界状态</span></span>
          <button className="th-btn primary" onClick={() => newTheater()}><Icon d={icons.plus} />新建小剧场</button>
        </span>
      </> : <>
        <nav className="th-crumb" aria-label="小剧场位置">
          <button aria-label="返回列表" onClick={() => leaveGuard.current ? leaveGuard.current(list) : list()}><Icon d={icons.back} />戏单</button>
          <span aria-hidden="true">/</span><strong>{view === 'new' ? '新建小剧场' : record?.title}</strong>
        </nav>
        {view === 'read' && record && <span className="th-end"><span className="th-chip plain th-mono" title="生成模型">{record.config.route.model}</span></span>}
      </>}
    </header>
    <div className="theater-scroll" ref={reading} onScroll={event => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 45;
    }}>
      <div className="th-inner">
      {error && <p role="alert" className="th-banner" data-tone="err">{error}</p>}
      {notice && <p role="status" className="th-banner" data-tone={/已保存|已复制|已保留/u.test(notice) ? 'ok' : undefined}>
        <span>{notice}</span><button type="button" className="th-x" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></p>}
      {view === 'list' && <>
        {items?.length === 0 && <div className="th-empty">
          <div className="th-stamp" aria-hidden="true">剧</div>
          <h3>档案尚空</h3>
          <p>从一段番外、一场未发生的相遇，或一个人物的独白开始。<br />{disclaimer}</p>
          <div className="th-ideas" aria-label="主题示例">{ideas.map(idea =>
            <button key={idea} type="button" onClick={() => newTheater({ theme: idea })}>{idea}</button>)}</div>
        </div>}
        {!items && !error && <p role="status" className="th-hint">正在读取小剧场…</p>}
        {items && items.length > 0 && <p className="th-lead">每篇都以创建时的主线背景为底稿；之后主线怎么走，都不会改动已写好的小剧场。</p>}
        <ul className="theater-list">{items?.map(item => <li className="th-bill" key={item.id} data-status={item.status}>
          <span className="th-no" aria-hidden="true"><b>{Array.from(item.title)[0]}</b></span>
          <span className="th-bd">
            <h4><button onClick={() => void open(item.id)} className="theater-title">{item.title}</button></h4>
            <p>{item.theme || '（未填写主题）'}</p>
            <span className="th-ft">
              <span className="th-chip" data-s={item.status}>{theaterStates[item.status]}</span>
              <span><b className="th-mono">{item.length.toLocaleString('zh-CN')}</b> 字</span>
              <span className="th-mono th-model">{item.model}</span>
              <time dateTime={item.updatedAt} title={`创建 ${date(item.createdAt)} · 更新 ${date(item.updatedAt)}`}>{when(item.updatedAt)}</time>
            </span>
          </span>
        </li>)}</ul>
        {cursor && <div className="th-more"><button className="th-btn ghost" onClick={() => void loadList(cursor)}>加载更多小剧场</button></div>}
      </>}
      {view === 'new' && <form id="theater-new" className="theater-form th-compose" onSubmit={event => { event.preventDefault(); void generate('initial', true); }}>
        <div className="th-compose-main">
          <div className="th-field"><span className="th-lbl">剧本<small>标题选填，留空时由主题生成</small></span>
            <div className="th-script">
              <input className="th-title-input" aria-label="标题（选填）" placeholder="给这一场起个名字（选填）" maxLength={100} value={title} onChange={event => setTitle(event.target.value)} />
              <textarea className="th-theme-input" aria-label="主题" placeholder="写下主题：谁、在哪、发生了什么……" rows={5} required maxLength={4000} value={theme} onChange={event => setTheme(event.target.value)} />
              <span className="th-script-meta"><span>主题必填</span><span className="th-mono">{Array.from(theme).length} / 4000</span></span>
            </div>
          </div>
          <fieldset className="th-field"><legend className="th-lbl">正文篇幅<small>创作节奏的目标；实际长度受模型输出上限影响，可以续写</small></legend>
            <div className="th-seg">{lengths.map(length => {
              const preset = theaterLengths.find(value => value.id === length.id);
              return <label key={length.id} data-checked={tier === length.id || undefined}>
                <input className="th-radio" type="radio" name="theater-length" value={length.id} checked={tier === length.id} onChange={() => setTier(length.id)} />
                <b>{preset?.name ?? '自定义'}</b><small>{preset ? `约 ${preset.target.toLocaleString('zh-CN')} 字` : '100～100,000'}</small>
              </label>;
            })}</div>
            {tier === 'custom' && <label className="th-custom">目标字数<input className="th-number" required type="number" min={100} max={100000} value={custom}
              onChange={event => setCustom(event.target.value)} />字</label>}
          </fieldset>
          <fieldset className="th-field"><legend className="th-lbl">叙事人称</legend>
            <div className="th-seg small">{([['follow', '跟随主线'], ...Object.entries(theaterPerspectives)] as [typeof perspective, string][]).map(([value, label]) =>
              <label key={value} data-checked={perspective === value || undefined}>
                <input className="th-radio" type="radio" name="theater-perspective" value={value} checked={perspective === value} onChange={() => setPerspective(value)} /><b>{label}</b>
              </label>)}</div>
          </fieldset>
          <fieldset className="th-field"><legend className="th-lbl">生成模型</legend>
            <div className="th-seg small">{([['story', '用默认模型'], ['independent', '单独指定']] as const).map(([value, label]) =>
              <label key={value} data-checked={(value === 'independent') === independent || undefined}>
                <input className="th-radio" type="radio" name="theater-route" value={value} checked={(value === 'independent') === independent} onChange={() => setIndependent(value === 'independent')} /><b>{label}</b>
              </label>)}</div>
            {!independent && <small>{ticketChannel?.name ?? '未选渠道'} · {ticketModel || '未选模型'}</small>}
            {independent && <div className="th-row2"><ModelChoice channels={channels} channelId={channelId} model={model} onChannel={chooseChannel} onModel={setModel} /></div>}
          </fieldset>
          <label className="th-switch"><input className="th-switch-input" type="checkbox" checked={stream} onChange={event => setStream(event.target.checked)} />
            <i aria-hidden="true" /><span>流式显示正文<small>默认跟随当前正文设置</small></span></label>
        </div>
        <aside className="th-ticket" aria-label="本场设定">
          <h4>本场设定</h4>
          <dl>
            <dt>篇幅</dt><dd>{tier === 'custom' ? '自定义' : theaterLengths.find(value => value.id === tier)?.name} · {target ? `约 ${target.toLocaleString('zh-CN')} 字` : '待填写'}</dd>
            <dt>人称</dt><dd>{perspective === 'follow' ? `跟随主线（${theaterPerspectives[settings.prompts.perspective as TheaterPerspective] ?? '主线设置'}）` : theaterPerspectives[perspective]}</dd>
            <dt>模型</dt><dd><span className="th-mono">{ticketModel || '未选择'}</span>{ticketChannel && <small>{ticketChannel.name}</small>}</dd>
            <dt>显示</dt><dd>{stream ? '流式' : '整段返回'}</dd>
          </dl>
          <div className="th-tear" aria-hidden="true" />
          <dl><dt>背景</dt><dd>{latest ? `主线第 ${latest.turn} 回合` : '最新已结算的主线'}{clock(latest?.time) && <small>{clock(latest?.time)}</small>}</dd></dl>
          <p className="th-fine">背景取最新已结算的公开资料，创建时冻结。{disclaimer}</p>
        </aside>
      </form>}
      {view === 'read' && record && <>
        {preview && <div className="th-preview">
          <b>{preview.result.status === 'stopped' ? '这次生成被停止了' : '这次生成没有写完'}</b>
          <p>{forkPreview ? '原正文仍已保存。可将这次结果另存为未完篇。' : '可保留已写部分，稍后主动续写。'}</p>
          <div className="theater-actions">
            <button className="th-btn primary" disabled={busy} onClick={() => void keepPreview()}>
              {forkPreview ? '另存为未完篇' : '保留已写部分'}
            </button>
            <button className="th-btn" disabled={busy} onClick={() => { setPreview(undefined); clearMessages(); }}>放弃这次结果</button>
          </div>
        </div>}
        <header className="th-read-head">
          <div className="th-kicker"><span className="th-chip" data-s={status}>{statusText}</span>
            <span title={`创建 ${date(record.createdAt)} · 更新 ${date(record.updatedAt)}`}>创建 {when(record.createdAt)} · 更新 {when(record.updatedAt)}</span></div>
          <h2 className="theater-heading">{record.title}</h2>
          {record.theme !== record.title && <p className="theater-theme">{record.theme}</p>}
          <div className="th-facts">
            <span className="th-chip plain">主线第 {record.background.turn} 回合</span>
            {clock(record.background.time) && <span className="th-chip plain">{clock(record.background.time)}</span>}
            <span className="th-chip plain">{theaterPerspectives[record.config.perspective]}</span>
          </div>
          <p className="theater-count th-progress" aria-live="off"><b className="th-mono">{liveCount.toLocaleString('zh-CN')}</b> 字
            <span className="th-track" data-live={running ? '' : undefined} data-over={liveCount >= record.config.target ? '' : undefined} aria-hidden="true">
              <i style={{ width: `${Math.min(100, liveCount / record.config.target * 100)}%` }} /></span>
            目标 {record.config.target.toLocaleString('zh-CN')}</p>
        </header>
        {shown ? running
          ? <article aria-label="小剧场正文" className="th-novel" data-live="">{shown.length > 16000 && <p className="th-hint">生成时预览最新正文，保存后可阅读全文。</p>}
            <TheaterProse text={shown.slice(-16000)} protagonist={record.background.protagonist} /></article>
          : <NovelReader key={record.id + ':' + record.revision + ':' + Boolean(preview)} text={shown} protagonist={record.background.protagonist} />
          : running ? <p className="th-waiting"><i aria-hidden="true" />正在落笔，等待模型返回正文…</p>
            : <p className="th-hint th-nobody">目前没有已保存正文。</p>}
        {thoughts && <details className="theater-thoughts"><summary>供应商公开思考<small>{Array.from(thoughts).length.toLocaleString('zh-CN')} 字</small></summary><p>{thoughts}</p></details>}
        {rename !== undefined && <form className="theater-form th-inline" onSubmit={event => {
          event.preventDefault();
          void edit(async () => {
            if (!opened) return;
            const { config, vault } = theaterCredentials();
            setOpened(await repository.rename(opened, checkTheaterTitle(rename, config, vault))); setRename(undefined);
          });
        }}>
          <label className="th-lbl">新标题<input className="th-rename-input" required maxLength={100} value={rename} onChange={event => setRename(event.target.value)} /></label>
          <div className="theater-actions"><button type="button" className="th-btn ghost" onClick={() => setRename(undefined)}>取消重命名</button><button className="th-btn primary" disabled={busy}>保存标题</button></div>
        </form>}
        {routeEditor && <form className="theater-form th-inline" onSubmit={event => {
          event.preventDefault();
          void edit(async () => {
            if (!opened) return;
            const { config, vault } = theaterCredentials();
            setOpened(await repository.changeRoute(opened, await theaterRoute(config, vault, { channelId, model })));
            setRouteEditor(false); setNotice('已保存所选模型。');
          });
        }}>
          <span className="th-lbl">更换模型<small>只影响之后的续写和重新 Roll</small></span>
          <div className="th-row2"><ModelChoice channels={channels} channelId={channelId} model={model} onChannel={chooseChannel} onModel={setModel} /></div>
          <div className="theater-actions"><button type="button" className="th-btn ghost" onClick={() => setRouteEditor(false)}>取消选择</button><button className="th-btn primary" disabled={busy}>保存模型</button></div>
        </form>}
      </>}
      </div>
    </div>
    {view === 'new' && <footer className="th-dock">
      <span className="th-hint">新建、续写、重新 Roll 各发起一次模型请求。</span>
      <button className="th-btn primary" form="theater-new" disabled={busy}>新建并生成</button>
    </footer>}
    {running && <footer className="th-dock">
      <span className="th-hint">可以停止后查看已写部分，再决定是否保留。</span>
      <button className="th-btn" disabled={saving} onClick={() => active.current?.abort()}><Icon d={icons.stop} fill />停止生成</button>
    </footer>}
    {view === 'read' && record && !running && !preview && !rename && !routeEditor && !confirm &&
      <footer className="th-dock" aria-label="正文操作">
        {record.body ? <>
          <button className="th-btn primary" disabled={busy || record.body.length >= maxTheaterBody} onClick={() => void generate('continue')}><Icon d={icons.pen} />继续写作</button>
          <span className="th-tools">
            <button className="th-btn" disabled={busy} onClick={() => setConfirm('reroll')}><Icon d={icons.roll} />重新 Roll</button>
            <button className="th-btn" disabled={busy} onClick={() => {
              if (!navigator.clipboard) { setError('复制失败，可以选中正文复制。'); return; }
              void navigator.clipboard.writeText(record.body).then(() => setNotice('已复制全文。'), () => setError('复制失败，可以选中正文复制。'));
            }}><Icon d={icons.copy} />复制全文</button>
          </span>
        </> : <button className="th-btn primary" disabled={busy} onClick={() => void generate('initial')}>生成正文</button>}
        <div className="th-menu-wrap" ref={menuRef}>
          <button className="th-btn ghost" aria-haspopup="true" aria-expanded={menu} disabled={busy} onClick={() => setMenu(value => !value)}><Icon d={icons.more} fill />更多</button>
          {menu && <div className="th-menu" aria-label="更多操作">
            {menuItem('重命名', 'pen', () => setRename(record.title))}
            {menuItem('更换模型', 'model', () => { setChannelId(record.config.route.channelId); setModel(record.config.route.model); setRouteEditor(true); })}
            {menuItem('以此主题新建', 'remake', () => newTheater({ theme: record.theme, config: record.config, title: record.title }))}
            <hr />
            {menuItem('删除小剧场', 'trash', () => setConfirm('delete'), true)}
          </div>}
        </div>
      </footer>}
    {confirm && <footer className="theater-confirm th-dock" data-tone={confirm === 'reroll' ? 'gold' : 'danger'}>
      <p><b>{confirm === 'reroll' ? '重新 Roll？' : '删除本篇小剧场？'}</b>{confirm === 'reroll' ? '重新生成会发起一次模型请求，仍使用本篇创建时冻结的背景。只有新正文完整保存后才会替换原文。' : '删除后无法恢复。'}</p>
      <div className="theater-actions">
        <button className="th-btn" disabled={busy} onClick={() => setConfirm(undefined)}>取消</button>
        {confirm === 'reroll' ? <button className="th-btn primary" disabled={busy} onClick={() => void generate('reroll')}>确认重新 Roll</button>
          : <button className="th-btn danger" disabled={busy} onClick={() => void edit(async () => { if (opened) { await repository.delete(opened); list(); } })}>确认删除小剧场</button>}
      </div>
    </footer>}
    {leaveRequest && <Dialog title="离开小剧场？" onClose={() => setLeaveRequest(undefined)} small mobileVariant="confirm">
      {saving ? <p>正在保存，请等待本次操作完成。</p> : running ? <p>仍在生成正文。可以停止请求，查看已写部分后再决定是否保留。</p>
        : preview ? <p>{forkPreview ? '原正文已保留。可以将这次尚未保存的正文另存为未完篇。' : '还有尚未保存的正文。'}</p>
          : <p>本次操作已结束，可以离开小剧场。</p>}
      {!running && error && <p role="alert">{error}</p>}
      <div className="theater-actions">
        <button className="th-btn" onClick={() => setLeaveRequest(undefined)}>{running && !saving ? '继续生成' : '留在小剧场'}</button>
        {!saving && (running ? <button className="th-btn primary" onClick={() => { active.current?.abort(); setLeaveRequest(undefined); }}>停止并查看正文</button>
          : preview ? <>
            <button className="th-btn primary" onClick={() => void keepPreview(finishLeaving)}>{forkPreview ? '另存为未完篇并离开' : '保留并离开'}</button>
            <button className="th-btn" onClick={finishLeaving}>放弃并离开</button>
          </> : <button className="th-btn primary" onClick={finishLeaving}>离开小剧场</button>)}
      </div>
    </Dialog>}
  </section>;
}
