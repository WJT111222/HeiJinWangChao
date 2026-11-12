import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PRODUCT_VERSION } from '../../app/product';
import { CITY, ORDER, skyline } from './skyline';
import type { City } from './skyline';
import './home.css';

export function HomeScreen({ count, loading, canCreate, active, hasDraft, notice, children, onCreate, onContinue, onSettings, onRefresh, notices }: {
  count: number; loading: boolean; canCreate: boolean; active?: string; hasDraft: boolean; notice: string; children: ReactNode;
  onCreate: () => void; onContinue: () => void; onSettings: () => void; onRefresh: () => void; notices: ReactNode;
}) {
  const [library, setLibrary] = useState(false), [city, setCity] = useState<City>('cq');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [labelCity, setLabelCity] = useState<City>('cq');
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const coverButton = useRef<HTMLButtonElement>(null), back = useRef<HTMLButtonElement>(null);
  const changed = useRef(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function restart() {
    clearInterval(timer.current);
    if (!reduced && !library) timer.current = setInterval(() => setCity(c => ORDER[(ORDER.indexOf(c) + 1) % ORDER.length]), 7000);
  }
  useEffect(() => {
    restart();
    return () => clearInterval(timer.current);
  }, [reduced, library]);
  useEffect(() => {
    if (!changed.current) return;
    const section = (library ? back : coverButton).current?.closest('section');
    const first = [...(section?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].find(button => button.getClientRects().length > 0);
    first?.focus({ preventScroll: true });
  }, [library]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { changed.current = true; setLibrary(false); }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, []);
  const current = reduced ? 'cq' : city;
  const label = reduced ? 'cq' : labelCity;
  useEffect(() => { if (reduced) return; const timer = setTimeout(() => setLabelCity(current), 450); return () => clearTimeout(timer); }, [current, reduced]);
  function showLibrary(value: boolean) { changed.current = true; setLibrary(value); }
  const brand = (subtitle: string) => <div className="brand"><span className="seal" aria-hidden="true">黑</span><span>黑金王朝<small>{subtitle}</small></span></div>;
  return <main className="home-experience home-page" data-city={current}>
    <section id="cover" className={`screen cover ${library ? 'leaving' : ''}`} hidden={library} inert={library} aria-label="游戏首页">
      <div className="sky" /><div className="stars" />
      <div className={`city-meta ${label !== current ? 'swap' : ''}`}>{CITY[label][1]}<b>{CITY[label][2]}</b></div>
      <div className={`city-ghost ${label !== current ? 'swap' : ''}`} aria-hidden="true">{CITY[label][0]}</div>
      <div className="skyline" aria-hidden="true">{ORDER.map(c => <div key={c} className={`skyline-layer ${c === current ? 'on' : ''}`} dangerouslySetInnerHTML={{ __html: skyline(c, 'aria-hidden="true"') }} />)}</div>
      <div className="grain" />
      <header className="topbar">{brand('HEIJINWANGCHAO')}<span className="spacer" /><button className="ghost-btn" data-go="library" onClick={() => showLibrary(true)}>存档馆</button><button className="ghost-btn" onClick={onSettings}>设置</button><span className="ver">{PRODUCT_VERSION}</span></header>
      <div className="hero">
        <p className="eyebrow">MODERN CITY / OPEN WORLD</p><h1 className="title">黑金王朝</h1>
        <p className="tagline">起点有冲突，人生不预设结局。</p>
        <p className="desc">一款 AI 驱动的现代都市开放世界文字角色扮演游戏。<br />在熟悉的城市里，写下属于你的人生。</p>
        <div className="actions">
          <button ref={coverButton} className="btn-start" disabled={!canCreate} onClick={onCreate}>开始新游戏 <span aria-hidden="true">↗</span></button>
          <button className="btn-continue" disabled={!active || loading} onClick={onContinue}><b>继续游戏</b><small>{active ?? '暂无可继续的存档'}</small><i aria-hidden="true">→</i></button>
          <button className="btn-library" onClick={() => showLibrary(true)}>存档馆<span className="n">{String(count).padStart(2, '0')}</span></button>
        </div>
        {notices}{hasDraft && <p className="hint">有尚未完成的创角资料，开始新游戏可继续填写。</p>}
      </div>
      <footer className="cover-foot"><div className="notes"><span>四座城市 · 自由职业 · 开放人生</span><span>三阶段生成 · 原子结算 · 连续回合</span></div><nav className="cities" aria-label="封面城市">{ORDER.map(c => <button key={c} aria-pressed={current === c} disabled={reduced && c !== 'cq'} onClick={() => { setCity(c); restart(); }}>{CITY[c][0]}</button>)}</nav></footer>
    </section>
    <section id="library" className={`screen library ${library ? 'on' : ''}`} hidden={!library} inert={!library} aria-label="已有存档">
      <div className="lib-skyline" aria-hidden="true" dangerouslySetInnerHTML={{ __html: skyline('cq', 'aria-hidden="true"') }} />
      <header className="lib-top"><button ref={back} className="back" onClick={() => showLibrary(false)}><span aria-hidden="true">←</span> 封面</button>{brand('YOUR STORIES')}<span className="spacer" style={{flex:1}} /><button disabled={!canCreate || loading} onClick={onRefresh}>刷新列表</button></header>
      <div className="lib-main"><div className="lib-head"><div><p className="eyebrow">YOUR STORIES</p><h2>已有存档 <span className="count">{String(count).padStart(2,'0')}</span></h2><p className="muted">每份存档都是一段独立的人生，保存在当前浏览器。</p></div></div>
        {notice && <p className="status-msg" role="status">{notice}</p>}
        <div className="grid save-list"><article className="dossier new"><div className="tabline"><span className="tab">NEW</span></div><button className="body" disabled={!canCreate} onClick={onCreate}><div><div className="plus" aria-hidden="true">＋</div><h3>开启新的人生</h3><p>四座城市 · 自由职业 · 开放人生</p>{hasDraft && <p className="draft">有尚未完成的创角资料，开始新游戏可继续填写。</p>}</div></button></article>
          {children}{loading && Array.from({length:3},(_,i) => <article key={i} className="dossier skeleton" aria-hidden="true"><div className="body" /></article>)}
        </div>
      </div><footer className="lib-foot">本地保存 · 无需账号 <button onClick={onSettings}>打开设置 ↗</button></footer>
    </section>
  </main>;
}
