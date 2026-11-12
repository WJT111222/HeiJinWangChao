import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import './mobile-workflow-drawer.css';

/** Presentation only: never covers the action row, never makes the page inert. */
export function MobileWorkflowDrawer({ inputRef, onClose, children }: {
  inputRef: RefObject<HTMLTextAreaElement | null>; onClose: () => void; children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [bounds, setBounds] = useState<{top:number; bottom:number} | null>(null);
  const [drag, setDrag] = useState(0);
  const pointer = useRef<{id:number; y:number; dy:number} | undefined>(undefined);
  const suppressClick = useRef(false);
  useLayoutEffect(() => {
    const input = inputRef.current, row = input?.closest('.composer-action-row');
    if (!row) return;
    const measure = () => {
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const bottom = row.getBoundingClientRect().top - 6;
      const top = Math.max(viewportTop, Math.min(viewportTop + 64, bottom - 140));
      setBounds(old => old?.top === top && old.bottom === bottom ? old : { top, bottom });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row); if (input) observer.observe(input);
    const composer = row.closest('.composer'); if (composer) observer.observe(composer);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [inputRef]);
  useLayoutEffect(() => {
    root.current?.focus({preventScroll:true});
    const escape = (event: KeyboardEvent) => {
      if(event.key !== 'Escape' || event.isComposing || event.defaultPrevented || document.querySelector('dialog:modal, .archive')) return;
      event.preventDefault(); close.current();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  const positioned = bounds !== null;
  useLayoutEffect(() => { if (positioned) root.current?.focus({preventScroll:true}); }, [positioned]);
  return createPortal(<div className="app-shell-game workflow-drawer-root">
    {bounds && <>
      <button type="button" className="workflow-drawer-shade" aria-label="收起工作流暗区" tabIndex={-1}
        style={{top:window.visualViewport?.offsetTop ?? 0,height:Math.max(0,bounds.top-(window.visualViewport?.offsetTop ?? 0))}} onClick={onClose}/>
      <div className="workflow-drawer-viewport" style={{top:bounds.top,height:Math.max(0,bounds.bottom-bounds.top)}}>
        <section ref={root} className="mobile-workflow-sheet workflow-floating-drawer" role="dialog" aria-modal="false" aria-label="三阶段工作流" tabIndex={-1} style={{transform:`translateY(${drag}px)`}}>
          <div className="workflow-drawer-tools">
            <button type="button" className="workflow-drawer-grip" aria-label="收起三阶段工作流" onClick={() => {if(suppressClick.current){suppressClick.current=false;return;}onClose();}}
              onPointerDown={event=>{if(event.button!==0)return;pointer.current={id:event.pointerId,y:event.clientY,dy:0};event.currentTarget.setPointerCapture(event.pointerId);}}
              onPointerMove={event=>{const p=pointer.current;if(!p||p.id!==event.pointerId)return;p.dy=Math.max(0,event.clientY-p.y);setDrag(p.dy);}}
              onPointerUp={event=>{const p=pointer.current;if(!p||p.id!==event.pointerId)return;suppressClick.current=p.dy>4;pointer.current=undefined;setDrag(0);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(p.dy>72)onClose();}}
              onPointerCancel={()=>{pointer.current=undefined;suppressClick.current=true;setDrag(0);}}><span aria-hidden="true"/></button>
            <button type="button" className="workflow-drawer-input" onClick={()=>inputRef.current?.focus({preventScroll:true})}>行动输入</button>
          </div>
          {children}
        </section>
      </div>
    </>}
  </div>, document.body);
}
