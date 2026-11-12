import {useEffect,useId,useRef,useState} from 'react';
import type {ReactNode} from 'react';

/** The controllers stay mounted while their secondary controls are folded. */
export function ComposerTools({compact,menu,children}:{compact:boolean;menu:boolean;children:ReactNode}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),fold=compact&&menu;
 useEffect(()=>{if(!fold)setOpen(false);},[fold]);
 useEffect(()=>{
  if(!fold||!open)return;
  root.current?.querySelector<HTMLElement>('.composer-secondary-actions button:not(:disabled)')?.focus({preventScroll:true});
  const outside=(e:PointerEvent)=>{if(e.target instanceof Element&&!e.target.closest('dialog')&&!root.current?.contains(e.target))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[fold,open]);
 return <div className={`composer-roll${fold?' has-tool-menu':''}`} ref={root} onKeyDown={e=>{if(fold&&open&&e.key==='Escape'&&!(e.target as Element).closest('dialog')){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
  {fold&&<button type="button" className="mobile-tools-toggle" ref={trigger} aria-label="回合操作" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>⋯</button>}
  <div className="composer-secondary-actions" id={id} role={fold?'group':undefined} aria-label={fold?'回合操作':undefined} hidden={fold&&!open}>{children}</div>
 </div>;
}
