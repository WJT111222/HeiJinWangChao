import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useDesktopFeedback} from './Feedback';

/** Keep the existing alert and dismissal, above the current native modal on phones.
 * A manual popover stays within that modal's DOM/focus boundary and never times out. */
export function GlobalFeedback({children,className,disabled=false}:{children:ReactNode;className:string;disabled?:boolean}){
 const desktop=useDesktopFeedback(),[host,setHost]=useState<Element|null>(null),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(desktop||disabled)return;
  const update=()=>setHost(document.activeElement?.closest('dialog:modal')??[...document.querySelectorAll('dialog:modal')].at(-1)??null);
  update();const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});return()=>observer.disconnect();
 },[desktop,disabled]);
 useLayoutEffect(()=>{
  const alert=ref.current;if(desktop||disabled||!alert?.showPopover)return;
  alert.showPopover();return()=>{if(alert.matches(':popover-open'))alert.hidePopover();};
 },[desktop,host,disabled]);
 const content=<div ref={ref} className={className} role="alert" {...(!desktop&&!disabled?{popover:'manual' as const}: {})}>{children}</div>;
 return !desktop&&!disabled&&host?createPortal(content,host):content;
}
