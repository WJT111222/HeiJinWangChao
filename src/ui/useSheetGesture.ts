import {useEffect} from 'react';
import type {RefObject} from 'react';

/** Presentation only. Content keeps native scrolling; only a downward pull at its
 * scroll boundary can dismiss. Cancelled pointers/touches always spring back. */
export function useSheetGesture(ref:RefObject<HTMLDialogElement|null>,enabled:boolean,close:RefObject<()=>void>){
 useEffect(()=>{
  const dialog=ref.current,body=dialog?.querySelector<HTMLElement>('.modal-body');
  if(!enabled||!dialog||!body)return;
  let pointer:{id:number;y:number;dy:number}|undefined,touch:{x:number;y:number;dy:number;target:Element}|undefined,outside=false;
  const interactive=(target:Element)=>Boolean(target.closest('button,input,textarea,select,a,summary,[contenteditable="true"],[role="button"]'));
  const owned=(target:EventTarget|null):target is Element=>target instanceof Element&&target.closest('dialog')===dialog;
  const out=(x:number,y:number)=>{const r=dialog.getBoundingClientRect();return x<r.left||x>r.right||y<r.top||y>r.bottom;};
  const reset=()=>{dialog.classList.remove('sheet-dragging');dialog.style.removeProperty('--sheet-drag');};
  const move=(dy:number)=>{dialog.classList.add('sheet-interacted','sheet-dragging');dialog.style.setProperty('--sheet-drag',`${Math.max(0,dy)}px`);};
  const atTop=(target:Element)=>{for(let node:Element|null=target;node&&dialog.contains(node);node=node.parentElement){if(node instanceof HTMLElement&&node.scrollTop>0)return false;if(node===body)return true;}return false;};
  const down=(e:PointerEvent)=>{
   if(!owned(e.target)||e.button!==0)return;
   outside=e.target===dialog&&out(e.clientX,e.clientY);
   if(outside||interactive(e.target)||!e.target.closest('.mobile-sheet-grab,.modal-heading'))return;
   pointer={id:e.pointerId,y:e.clientY,dy:0};dialog.setPointerCapture(e.pointerId);
  };
  const pointerMove=(e:PointerEvent)=>{if(pointer?.id!==e.pointerId)return;pointer.dy=Math.max(0,e.clientY-pointer.y);if(pointer.dy>4)move(pointer.dy);};
  const up=(e:PointerEvent)=>{
   if(pointer?.id===e.pointerId){const dismiss=pointer.dy>110;pointer=undefined;reset();if(dialog.hasPointerCapture(e.pointerId))dialog.releasePointerCapture(e.pointerId);if(dismiss)close.current();}
   else if(outside&&owned(e.target)&&out(e.clientX,e.clientY))close.current();
   outside=false;
  };
  const cancel=()=>{pointer=undefined;touch=undefined;outside=false;reset();};
  const touchStart=(e:TouchEvent)=>{if(e.touches.length!==1||!owned(e.target)||interactive(e.target)||!atTop(e.target))return;const p=e.touches[0];touch={x:p.clientX,y:p.clientY,dy:0,target:e.target};};
  const touchMove=(e:TouchEvent)=>{
   if(!touch||e.touches.length!==1)return;
   const p=e.touches[0],dy=p.clientY-touch.y,dx=Math.abs(p.clientX-touch.x);
   if(dy<0||dx>Math.max(10,dy)||!atTop(touch.target)){touch=undefined;reset();return;}
   if(dy>8&&e.cancelable){e.preventDefault();touch.dy=dy;move(dy);}
  };
  const touchEnd=()=>{const dismiss=Boolean(touch&&touch.dy>110);touch=undefined;reset();if(dismiss)close.current();};
  dialog.addEventListener('pointerdown',down);dialog.addEventListener('pointermove',pointerMove);dialog.addEventListener('pointerup',up);dialog.addEventListener('pointercancel',cancel);
  body.addEventListener('touchstart',touchStart,{passive:true});body.addEventListener('touchmove',touchMove,{passive:false});body.addEventListener('touchend',touchEnd);body.addEventListener('touchcancel',cancel);
  return()=>{cancel();dialog.classList.remove('sheet-interacted');dialog.removeEventListener('pointerdown',down);dialog.removeEventListener('pointermove',pointerMove);dialog.removeEventListener('pointerup',up);dialog.removeEventListener('pointercancel',cancel);body.removeEventListener('touchstart',touchStart);body.removeEventListener('touchmove',touchMove);body.removeEventListener('touchend',touchEnd);body.removeEventListener('touchcancel',cancel);};
 },[ref,enabled,close]);
}
