import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { PRODUCT_VERSION } from '../../app/product';
import type { SaveSummary } from '../../services/storage/saveManagement';
import { saveKeyText } from '../../services/storage/saveManagement';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { CITY, CITY_TICKET_META, saveCity } from './skyline';
import { departure, guilloche, ticketKey, ticketName, ticketOrder, ticketTime } from './ticketView';
import { useRawSaveExport } from './useRawSaveExport';
import { useTicketTear } from './useTicketTear';
import './mobile-home.css';
import './backup.css';
import type { BackupStatus } from './backupStatus';

const BLANK = 'new-life';
type Props = {
  saves: SaveSummary[]; active?: string; loading: boolean; busy: boolean; blocked: boolean;
  repository?: SaveRepository; hasDraft: boolean; notice: string; listError: string; notices: ReactNode;
  deletion?: SaveSummary; onVoidShown: () => void;
  onCreate: () => void; onOpen: (id:string) => void; onSelect: (id:string) => void;
  onDelete: (save:SaveSummary) => void; onSettings: () => void; onRefresh: () => void;
  /** 存档备份：导入、单份导出、票面状态与提醒；状态只存在本机。 */
  onImport?: () => void; onExport?: (save:SaveSummary) => void; backupExporting?: boolean;
  backupOf?: (save:SaveSummary) => BackupStatus|undefined; noticeAction?: ReactNode; backupReminder?: string;
};

function Flaps({text,mono=false}:{text:string;mono?:boolean}) {
  const previous = useRef(text);
  useEffect(()=>{previous.current=text;},[text]);
  return <span className={`mh-flaps ${mono?'mono':''}`}>{[...text].map((char,i)=><span key={`${i}:${char}`} className={`mh-flap ${previous.current[i]!==char?'flipping':''}`} style={{animationDelay:`${i*60}ms`}}>{char}</span>)}</span>;
}

function Ticket({save,index,selected,hasDraft,voided,focused,backup,children}:{save?:SaveSummary;index:number;selected:boolean;hasDraft:boolean;voided:boolean;focused:boolean;backup?:BackupStatus;children:ReactNode}) {
  const city = save?.status==='readable'?saveCity(save.title):undefined;
  const meta = city ? CITY_TICKET_META[city] : undefined, time=ticketTime(save?.updatedAt);
  const paths=useMemo(()=>guilloche(city),[city]);
  const bad=save?.status==='unreadable';
  const label = !save?'空白车票：开启新的人生':`${bad?'无法读取的存档：':''}${save.title}，${time.full}${selected?'，已选择':''}${voided?'，已作废':''}`;
  return <article className={`mh-ticket ${!save?'blank':''} ${bad?'bad':''} ${voided?'void':''}`} data-city={city??'neutral'} aria-label={label} style={{'--tint':meta?.tint??'#928478'} as CSSProperties}>
    <div className="mh-paper">
      <div className="mh-band"><b>{!save?'空白车票':bad?'未知':city?CITY[city][0]:''}</b><small>{!save?'NEW LIFE':bad?'UNREADABLE':city?CITY[city][1].split(' · ')[0]:''}</small><span>{save?`ARCHIVE ${String(index+1).padStart(2,'0')}`:'NEW'}</span></div>
      <div className="mh-ticket-content" tabIndex={focused?0:-1}>
        <div className="mh-route"><div><small>FROM</small><span>{save?(bad?save.title:ticketName(save.title)):'？'}</span></div>{!bad&&<><div className="mh-arrow" aria-hidden="true">单程<i/></div><div className="mh-to"><small>TO</small><span>{save?(city?CITY[city][0]:''):'？'}</span></div></>}</div>
        {bad?<><p className="mh-keys">存档记录 ID：{saveKeyText(save.storageKey)}</p>{save.saveId&&save.saveId!==save.storageKey&&<p className="mh-keys">内容中的存档 ID：{save.saveId}</p>}<p className="mh-bad-note">当前版本无法读取这条记录。其他存档不受影响；可先导出原始数据，再决定是否删除。</p></>:
          <dl className="mh-info"><div><dt>{save?'保存日期':'城市'}</dt><dd>{save?time.date:<span className="mh-blank-line"/>}</dd></div><div><dt>{save?'时刻':'职业'}</dt><dd>{save?time.time:<span className="mh-blank-line"/>}</dd></div><div>{selected?<span className="mh-chop" aria-hidden="true">已检票<small>SELECTED</small></span>:<><dt>存档</dt><dd>{save?'本地':'—'}</dd></>}</div></dl>}
        {save&&!bad&&backup&&<p className={`mh-backup ${backup.tone}`}>{backup.text}</p>}
        {!save?<><p className="mh-pitch">四座城市 · 自由职业 · 开放人生</p>{hasDraft&&<p className="mh-draft">✎ 有尚未完成的创角资料，可继续填写</p>}</>:
          !bad&&<div className="mh-mid" aria-hidden="true"><svg viewBox="0 0 320 74" preserveAspectRatio="none">{paths.map((d,k)=><path key={k} d={d} className={k%4?'':'deep'}/>)}</svg>{city&&meta&&<><span className="mh-co">{CITY[city][1].split(' · ')[1]} · {meta.longitude}</span><span className="mh-im">{CITY[city][2]}</span><span className="mh-em">{meta.seal}</span></>}</div>}
      </div>
      {(bad||voided)&&<span className={`mh-chop mh-status-chop ${voided?'void-chop':''}`} aria-hidden="true">{voided?'作废':<>无法<br/>读取</>}</span>}
    </div>
    <div className="mh-perf" aria-hidden="true"/>{children}
  </article>;
}

function TicketActions({save,selected,repository,disabled,backupExporting=false,onActivate,onSelect,onDelete,onExport}:{save?:SaveSummary;selected:boolean;repository?:SaveRepository;disabled:boolean;backupExporting?:boolean;onActivate:()=>void;onSelect:(id:string)=>void;onDelete:(save:SaveSummary)=>void;onExport?:(save:SaveSummary)=>void}) {
  const {exporting,notice,exportRaw}=useRawSaveExport(repository,save?.storageKey??'');
  return <div className="mh-acts">
    {save?.status!=='unreadable'&&<button className="mh-primary" disabled={disabled} onClick={onActivate}>{!save?'开始新游戏':selected?'继续游戏':'读取存档'} <span aria-hidden="true">{selected?'→':'↗'}</span></button>}
    {save&&<div className="mh-secondary">{save.status==='unreadable'?<button disabled={disabled||exporting||!repository} onClick={()=>void exportRaw()}>{exporting?'正在导出…':'导出原始数据'}</button>:<>{onExport&&<button className="mh-export" disabled={disabled||backupExporting} onClick={()=>onExport(save)}>{backupExporting?'正在导出…':'导出备份'}</button>}{!selected&&<button disabled={disabled} onClick={()=>onSelect(save.saveId)}>选择</button>}</>}<button className="mh-delete" disabled={disabled||exporting} onClick={()=>onDelete(save)}>{save.status==='unreadable'?'删除存档':'删除'}</button></div>}
    {notice&&<p className="mh-status" role="status">{notice}</p>}
  </div>;
}

export function MobileHomeScreen(props: Props) {
  const {saves,active,loading,busy,blocked,repository,hasDraft,notice,listError,deletion,onVoidShown,onCreate,onOpen,onSelect,onDelete,onSettings,onRefresh,notices,onImport,onExport,backupExporting,backupOf,noticeAction,backupReminder}=props;
  const ordered=useMemo(()=>ticketOrder(saves,active),[saves,active]);
  const [currentKey,setCurrentKey]=useState(()=>ordered[0]?ticketKey(ordered[0]):BLANK);
  const [ghost,setGhost]=useState<{save:SaveSummary;index:number}>();
  const lastKeys=useRef<string[]>([]),rail=useRef<HTMLDivElement>(null);
  const keys=ordered.map(ticketKey);
  if(ghost&&!keys.includes(ticketKey(ghost.save)))keys.splice(Math.min(ghost.index,keys.length),0,ticketKey(ghost.save));
  keys.push(BLANK);
  const index=Math.max(0,keys.indexOf(currentKey)),effectiveKey=keys[index];
  const current=ordered.find(save=>ticketKey(save)===effectiveKey)??(ghost&&ticketKey(ghost.save)===effectiveKey?ghost.save:undefined);
  const isVoid=Boolean(ghost&&effectiveKey===ticketKey(ghost.save));
  const disabled=blocked||busy||loading||!repository||isVoid;
  const tear=useTicketTear(effectiveKey,disabled||current?.status==='unreadable',()=>current?.status==='readable'?onOpen(current.saveId):!current?onCreate():undefined);
  const board=departure(current,active,loading,listError);
  const city=current?.status==='readable'?saveCity(current.title):undefined;
  function go(i:number,smooth=true) {
    tear.reset();
    const next=Math.max(0,Math.min(keys.length-1,i));setCurrentKey(keys[next]);
    const node=rail.current, first=node?.firstElementChild as HTMLElement|undefined;
    if(node&&first)node.scrollTo({left:next*(first.offsetWidth+12),behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
  }
  useLayoutEffect(()=>{
    if(!deletion)return;
    const key=ticketKey(deletion),at=lastKeys.current.indexOf(key);
    setGhost({save:deletion,index:Math.max(0,at)});setCurrentKey(key);onVoidShown();
  },[deletion]);
  useEffect(()=>{
    if(!ghost)return;
    const timer=setTimeout(()=>{setGhost(undefined);setCurrentKey(old=>old===ticketKey(ghost.save)?(ordered[0]?ticketKey(ordered[0]):BLANK):old);if(document.activeElement===document.body)rail.current?.focus({preventScroll:true});},650);
    return()=>clearTimeout(timer);
  },[ghost,ordered]);
  const initialListShown=useRef(false);
  useLayoutEffect(()=>{
    if(!loading&&!initialListShown.current){initialListShown.current=true;if(ordered[0])setCurrentKey(ticketKey(ordered[0]));}
  },[loading,ordered]);
  const previousActive=useRef(active);
  useLayoutEffect(()=>{
    if(previousActive.current!==active&&!deletion&&!ghost){setCurrentKey(ordered[0]?ticketKey(ordered[0]):BLANK);previousActive.current=active;}
    if(!loading)lastKeys.current=keys;
  });
  // Data refresh, reordering and viewport changes realign to the same ticket.
  const sequence=JSON.stringify(keys), position=useRef(index);position.current=index;
  useLayoutEffect(()=>{
    const node=rail.current;if(!node)return;
    const align=()=>{const first=node.firstElementChild as HTMLElement|null;if(first)node.scrollTo({left:position.current*(first.offsetWidth+12),behavior:'instant'});};
    align();const observer=new ResizeObserver(align);observer.observe(node);return()=>observer.disconnect();
  },[sequence,loading]);
  return <main className="mobile-home" aria-label="游戏首页与存档馆" data-city={city??'neutral'} style={{'--tint':city?CITY_TICKET_META[city].tint:'#c9a961'} as CSSProperties}>
    <header className="mh-top"><span className="mh-seal" aria-hidden="true">黑</span><span className="mh-brand">黑金王朝<small>HEIJINWANGCHAO</small></span><span className="mh-spacer"/><button data-settings-open onClick={onSettings}>设置</button><span className="mh-version">{PRODUCT_VERSION}</span></header>
    <div className="mh-hero"><p>MODERN CITY / OPEN WORLD</p><h1>黑金王朝</h1><p>起点有冲突，人生不预设结局。</p></div>
    <div className="mh-board" role="status" aria-live="polite" aria-label={`终点 ${board.dest}，时刻 ${board.time}，${board.status}`}><span className="mh-board-label">终点<b>DEST</b></span><Flaps text={board.dest.padEnd(3,'　')}/><Flaps text={board.time} mono/><span className={`mh-board-status ${board.tone}`}>{board.status}</span></div>
    <div className="mh-meta"><span>车票 <b>{String(saves.length).padStart(2,'0')}</b></span><span>本地保存 · 无需账号</span><span className="mh-spacer"/>{onImport&&<button className="mh-import" disabled={!repository||loading||busy||blocked} onClick={()=>{tear.reset();onImport();}}><span aria-hidden="true">⤓ </span>导入备份</button>}<button disabled={!repository||loading||busy} onClick={()=>{tear.reset();onRefresh();}}>刷新列表</button></div>
    {loading?<><div className="mh-rail mh-skeletons" aria-hidden="true"><div className="mh-ticket mh-skeleton"/><div className="mh-ticket mh-skeleton"/></div><p className="mh-printer" role="status">正在读取本地存档…</p></>:listError?<p className="mh-error">{listError}</p>:<>
      <div className="mh-rail" ref={rail} tabIndex={0} role="region" aria-label="车票栏，左右方向键切换" aria-roledescription="轮播" onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();go(index+(event.key==='ArrowRight'?1:-1));}}} onScroll={event=>{
        const node=event.currentTarget,first=node.firstElementChild as HTMLElement|null;if(!first)return;
        const i=Math.max(0,Math.min(keys.length-1,Math.round(node.scrollLeft/(first.offsetWidth+12))));
        if(keys[i]!==currentKey){tear.reset();setCurrentKey(keys[i]);}
      }}>
        {keys.map((key,i)=>{
          const save=ordered.find(s=>ticketKey(s)===key)??(ghost&&ticketKey(ghost.save)===key?ghost.save:undefined),sel=save?.status==='readable'&&save.saveId===active;
          const unavailable=i!==index||disabled||save?.status==='unreadable';
          return <div className={`mh-ticket-wrap ${i!==index?'side':''}`} key={key} style={{'--rotation':`${Math.sign(i-index)*3}deg`} as CSSProperties} aria-current={i===index?'true':undefined}>
            <Ticket save={save} index={i} selected={sel} hasDraft={hasDraft} voided={Boolean(ghost&&key===ticketKey(ghost.save))} focused={i===index} backup={save&&backupOf?backupOf(save):undefined}>
              <div className={`mh-stub ${i===index&&tear.torn?'torn':''} ${i===index&&tear.drag?'dragging':''}`} aria-disabled={unavailable} {...(i===index?tear.handlers:{})} style={i===index&&tear.drag?{transform:`translateY(${tear.drag*.6}px) rotate(${-tear.drag/12}deg)`}:undefined}>
                <span>{save?.status==='unreadable'?'保存时间无法读取':!save?'开启新的人生':sel?'继续游戏':'读取存档'}{save?.status!=='unreadable'&&<small>↓ 按住票根往下撕</small>}</span><i className="mh-barcode" aria-hidden="true"/>
              </div>
            </Ticket>
          </div>;
        })}
      </div>
      <nav className="mh-dots" aria-label="车票页码" onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=Math.max(0,Math.min(keys.length-1,index+(event.key==='ArrowRight'?1:-1)));go(next);event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus({preventScroll:true});}}}>{keys.map((key,i)=><button key={key} tabIndex={i===index?0:-1} aria-label={`第 ${i+1} 张${key===BLANK?'，空白车票':''}`} aria-current={i===index?'true':undefined} className={key===BLANK?'new':''} onClick={()=>go(i)}/>)}</nav>
      {!saves.length&&!ghost&&<p className="mh-empty">还没有开始的人生。<br/>创建角色，留下第一份存档。</p>}
    </>}
    {backupReminder&&!loading&&<p className="mh-reminder" role="note">{backupReminder}</p>}
    {notice&&<p className="mh-status" role="status">{notice}{noticeAction}</p>}
    {!loading&&<TicketActions key={effectiveKey} save={listError?undefined:current} selected={current?.status==='readable'&&current.saveId===active} repository={repository} disabled={disabled||tear.torn} onActivate={listError?onCreate:tear.activate} onSelect={onSelect} onDelete={onDelete} onExport={onExport} backupExporting={backupExporting}/>}
    <footer className="mh-foot">{notices}<p>四座城市 · 自由职业 · 开放人生<br/>三阶段生成 · 原子结算 · 连续回合</p></footer>
  </main>;
}
