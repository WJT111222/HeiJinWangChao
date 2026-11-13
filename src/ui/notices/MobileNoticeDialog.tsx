import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Dialog } from '../Dialog';
import { disclaimer } from './disclaimer';
import type { DisclaimerParagraph } from './disclaimer';
import type { NoticeKind } from './useNotices';
import type { Announcement } from '../../services/notices/announcement';
import './mobile-notices.css';

function Paragraphs({items}:{items:readonly DisclaimerParagraph[]}) {
  return items.map(p=><p key={p.text}>{p.emphasis?<strong>{p.text}</strong>:p.text}</p>);
}
const numerals=['壹','贰','叁','肆','伍','陆','柒','捌','玖'];
const number=(i:number)=>i<9?numerals[i]:i===9?'拾':i<19?`拾${numerals[i-10]}`:'贰拾';
export function MobileNoticeDialog({kind,announcement,muted,automatic,onMutedChange,onClose}:{
  kind:NoticeKind;announcement:Announcement;muted:boolean;automatic:boolean;
  onMutedChange:(muted:boolean)=>void;onClose:()=>void;
}) {
  const body=useRef<HTMLDivElement>(null),rail=useRef<HTMLDivElement>(null);
  const [chapter,setChapter]=useState(0),[progress,setProgress]=useState(0),[phase,setPhase]=useState<'idle'|'out'|'in'>('idle');
  const pending=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),previous=useRef(kind);
  const close=useRef(onClose);close.current=onClose;
  function requestClose() {
    if(pending.current)return;
    if(automatic&&kind==='disclaimer'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      pending.current=true;setPhase('out');timer.current=setTimeout(()=>close.current(),225);
    }else{pending.current=true;close.current();}
  }
  useLayoutEffect(()=>{
    body.current?.scrollTo({top:0});setChapter(0);setProgress(0);
    if(previous.current!==kind){
      previous.current=kind;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      setPhase('in');
      clearTimeout(timer.current);timer.current=setTimeout(()=>{pending.current=false;setPhase('idle');},reduced?120:225);
    }
  },[kind]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  function readProgress() {
    const b=body.current;if(!b||kind!=='disclaimer')return;
    const max=b.scrollHeight-b.clientHeight,p=max>0?Math.min(1,Math.max(0,b.scrollTop/max)):1;
    setProgress(Math.round(p*100));let current=0;
    const top=b.getBoundingClientRect().top;
    b.querySelectorAll<HTMLElement>('[data-notice-chapter]').forEach((heading,i)=>{if(heading.getBoundingClientRect().top<=top+80)current=i;});
    if(p>.985)current=disclaimer.sections.length-1;setChapter(current);
  }
  useEffect(()=>{
    const b=body.current;if(!b)return;
    readProgress();const observer=new ResizeObserver(readProgress);observer.observe(b);return()=>observer.disconnect();
  },[kind]);
  useEffect(()=>{const r=rail.current,button=r?.querySelector<HTMLElement>('[aria-current=true]');if(r&&button)r.scrollTo({left:button.offsetLeft-14,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[chapter]);
  const footer=<div className="notice-footer">
    {automatic&&kind==='disclaimer'&&<p className="notice-next-hint">关闭后将显示王朝公告</p>}
    <div><label><input type="checkbox" checked={muted} onChange={e=>onMutedChange(e.target.checked)}/>今日不再弹出</label>
      <button className="notice-primary" disabled={phase!=='idle'} onClick={requestClose}>{!automatic?'关闭':kind==='disclaimer'?'已阅读，查看公告 →':'开始游玩'}</button></div>
  </div>;
  const navigation=<>
    {automatic&&<div className="notice-steps" aria-label={`首次弹出 ${kind==='disclaimer'?1:2} / 2`}><span className={kind==='disclaimer'?'current':'done'}><i>{kind==='disclaimer'?'1':'✓'}</i>须知</span><b/><span className={kind==='announcement'?'current':''}><i>2</i>公告</span></div>}
    {kind==='disclaimer'&&<nav className="notice-chapters" aria-label="须知章节"><div ref={rail}>{disclaimer.sections.map((section,i)=><button type="button" key={section.title} aria-current={chapter===i?'true':undefined} onClick={()=>{
      const b=body.current,h=b?.querySelector<HTMLElement>(`[data-notice-chapter="${i}"]`);if(b&&h)b.scrollTo({top:b.scrollTop+h.getBoundingClientRect().top-b.getBoundingClientRect().top-10,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }}><i aria-hidden="true">{'一二三四五六'[i]}</i>{section.title.replace(/^[一二三四五六]+、/,'')}</button>)}</div><span className="notice-percent">已阅读 {progress}%</span><span className="notice-progress" style={{'--read':`${progress}%`} as CSSProperties}/></nav>}
  </>;
  return <Dialog title={kind==='disclaimer'?disclaimer.title:announcement.title} className={`notice-modal mobile-notice-document notice-page-${phase}`}
    mobileVariant="sheet" sheetFull seal={kind==='disclaimer'?'须':'诏'} eyebrow={kind==='disclaimer'?'HEIJIN · NOTICE':'HEIJIN · BULLETIN'}
    closeLabel={kind==='disclaimer'?'关闭免责声明':'关闭王朝公告'} onClose={requestClose} closeDisabled={phase!=='idle'} beforeBody={navigation} footer={footer}>
    <div className="notice-content" ref={body} tabIndex={0} onScroll={readProgress} aria-label={kind==='disclaimer'?'免责声明内容':'公告内容'}>
      {kind==='disclaimer'?<>
        <div className="notice-age-block"><span className="notice-age" aria-label="仅限 18 岁及以上">18+</span><strong>{disclaimer.ageNotice}</strong></div>
        <Paragraphs items={disclaimer.intro}/>
        {disclaimer.sections.map((section,i)=><section key={section.title}><h3 data-notice-chapter={i}>{section.title}</h3><Paragraphs items={section.paragraphs}/></section>)}
        <div className="notice-divider" aria-hidden="true">◆</div><div className="notice-closing"><Paragraphs items={disclaimer.closing}/><span className="notice-stamp" aria-hidden="true">黑金<br/>王朝</span></div><span className="notice-end" aria-hidden="true">— 全文完 —</span>
      </>:<>
        {announcement.version&&<span className="notice-version">VERSION {announcement.version}</span>}
        <h3 className="notice-theme">{announcement.theme}</h3><ol className="notice-updates">{announcement.updates.map((update,i)=><li key={i}><span aria-hidden="true">{number(i)}</span><p>{update}</p></li>)}</ol>
        <p className="notice-message">{announcement.message}</p><div className="notice-sign"><span className="notice-stamp" aria-hidden="true">黑金<br/>王朝</span></div>
      </>}
    </div>
  </Dialog>;
}
