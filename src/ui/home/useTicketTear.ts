import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

/** An optional presentation delay; every entry goes through the same guarded action. */
export function useTicketTear(identity: string, blocked: boolean, action: () => void) {
  const [torn, setTorn] = useState(false), [drag, setDrag] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lock = useRef(false), pointer = useRef<{id:number;y:number;dy:number;node:HTMLElement} | undefined>(undefined);
  const current = useRef({identity, blocked, action}); current.current = {identity, blocked, action};
  function reset() {
    clearTimeout(timer.current); timer.current = undefined; lock.current = false;
    const p = pointer.current; pointer.current = undefined;
    if (p?.node.hasPointerCapture(p.id)) p.node.releasePointerCapture(p.id);
    setTorn(false); setDrag(0);
  }
  useEffect(() => {
    reset();
    return () => {clearTimeout(timer.current); pointer.current = undefined; lock.current = false;};
  }, [identity, blocked]);
  function activate() {
    if (current.current.blocked || lock.current) return;
    lock.current = true;
    const id = current.current.identity;
    const run = () => {
      if (current.current.identity !== id || current.current.blocked) return;
      current.current.action();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {run(); return;}
    setTorn(true);
    try {navigator.vibrate?.([10,30,18]);} catch { /* Optional device feedback. */ }
    timer.current = setTimeout(() => {timer.current = undefined; run();}, 700);
  }
  return {torn, drag, activate, reset,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (current.current.blocked || lock.current || pointer.current || !event.isPrimary || event.button !== 0) return;
        const node = event.currentTarget;
        node.setPointerCapture(event.pointerId);
        pointer.current = {id:event.pointerId,y:event.clientY,dy:0,node};
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const p = pointer.current;
        if (!p || p.id !== event.pointerId) return;
        p.dy = Math.max(0,event.clientY-p.y); setDrag(Math.min(p.dy,90));
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const p = pointer.current;
        if (!p || p.id !== event.pointerId) return;
        pointer.current = undefined; setDrag(0);
        if (p.node.hasPointerCapture(p.id)) p.node.releasePointerCapture(p.id);
        if (p.dy > 60) activate();
      },
      onPointerCancel() {pointer.current = undefined; setDrag(0);},
      onLostPointerCapture() {pointer.current = undefined; setDrag(0);},
    },
  };
}
