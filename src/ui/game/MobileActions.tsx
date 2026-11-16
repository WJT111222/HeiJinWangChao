import {useRef,useState} from 'react';
import {includesActionOption} from './actionOptions';

/** Suggestions remain a local input choice (stacked into the input, never submitted automatically). */
export function MobileActions({options,value,onChoose,source,referenceOnly=false}:{options:string[];value:string;onChoose:(value:string)=>void;source?:string;referenceOnly?:boolean}){
 const rail=useRef<HTMLDivElement>(null),[page,setPage]=useState(0);
 return <section className="action-options mobile-actions-rail" aria-label="行动建议"><p>{source??'接下来你想做什么'}<span aria-live="polite">{Math.min(page+1,options.length)} / {options.length}</span></p>
  {referenceOnly&&<p className="field-hint">仅供参考；请先完成当前回合，不能替换已绑定行动。</p>}
  <div className="rail-cards" ref={rail} onScroll={()=>{const root=rail.current!;let closest=0,distance=Infinity;[...root.children].forEach((child,index)=>{const next=Math.abs((child as HTMLElement).offsetLeft-(root.firstElementChild as HTMLElement).offsetLeft-root.scrollLeft);if(next<distance){distance=next;closest=index;}});setPage(closest);}}>
   {options.map((option,index)=><button key={option} className="opt" disabled={referenceOnly} aria-pressed={includesActionOption(value,option)} onClick={()=>{onChoose(option);document.getElementById('player-input')?.focus({preventScroll:true});if(!matchMedia('(prefers-reduced-motion: reduce)').matches)navigator.vibrate?.(8);}}><span className="n" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span className="t">{option}</span><span className="go" aria-hidden="true">{referenceOnly?'仅供参考':'点按填入 →'}</span></button>)}
  </div><div className="dots-pg" aria-hidden="true">{options.map((option,index)=><i key={option} className={index===Math.min(page,options.length-1)?'on':undefined}/>)}</div>
 </section>;
}
