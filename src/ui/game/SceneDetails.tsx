import { useEffect, useId, useRef, useState } from 'react';

/** Nonmodal top-layer details: the backdrop-filtered header must not clip the panel. */
export function SceneDetails({ weatherText, environmentText, weatherSeal = '天', compactLabel }: {
  weatherText: string; environmentText: string; weatherSeal?: string; compactLabel?: string;
}) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovering = useRef(false), pinned = useRef(false), suppressFocus = useRef(false);
  const [open, setOpen] = useState(false);
  function cancelClose() { clearTimeout(timer.current); }
  function close(restoreFocus = false) {
    cancelClose(); pinned.current = false; setOpen(false);
    if (restoreFocus && panel.current?.contains(document.activeElement)) {
      suppressFocus.current = true; trigger.current?.focus();
    }
  }
  function scheduleClose() {
    cancelClose();
    timer.current = setTimeout(() => {
      const active = document.activeElement;
      const keyboardWithin = active?.matches(':focus-visible') && (group.current?.contains(active) || panel.current?.contains(active));
      if (!hovering.current && !pinned.current && !keyboardWithin) setOpen(false);
    }, 180);
  }
  function enter() { hovering.current = true; cancelClose(); }
  function leave() { hovering.current = false; scheduleClose(); }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    function position() {
      if (!element || !trigger.current) return;
      const viewport = window.visualViewport, inset = 12;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const anchor = (group.current ?? trigger.current).getBoundingClientRect();
      if (!anchor.width || !anchor.height) { close(); return; }
      element.style.maxWidth = `${Math.max(0, width - inset * 2)}px`;
      // Keep the action composer clear; very small viewports still get a scrollable panel.
      element.style.maxHeight = `${Math.min(height - inset * 2, Math.max(96, Math.min(480, y + height - anchor.bottom - 180)))}px`;
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(x + inset, Math.min(anchor.right - box.width, x + width - box.width - inset))}px`;
      element.style.top = `${Math.max(y + inset, Math.min(anchor.bottom + 8, y + height - box.height - inset))}px`;
    }
    element.showPopover(); position();
    const observer = new ResizeObserver(position); observer.observe(element);
    if (group.current) observer.observe(group.current);
    const outside = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node) && !element?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A subsequently opened cabinet or modal owns its own Escape key.
      if (document.activeElement?.closest('dialog[open], .archive')) { close(); return; }
      event.preventDefault(); event.stopPropagation(); close(true);
    };
    const blur = () => {
      if (!group.current?.contains(document.activeElement) && !element?.contains(document.activeElement)) {
        if (document.activeElement?.closest('dialog[open], .archive')) close();
        else { pinned.current = false; scheduleClose(); }
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('focusin', blur);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('focusin', blur);
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [open]);
  const fields = [['天气', weatherText || '天气待确认', weatherSeal], ['环境', environmentText || '环境待确认', '境']];
  return <div ref={group} className={compactLabel ? 'compact-scene-details' : 'chips'} onBlur={scheduleClose}
    onPointerLeave={event => { if (event.pointerType === 'mouse') leave(); }}>
    {(compactLabel ? [['天气与环境', compactLabel, '']] : fields).map(([label, text, seal]) => <button key={label} type="button"
      className={compactLabel ? 'status-mobile-location' : 'chip'} aria-label={`查看${label}详情`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onPointerEnter={event => { if (event.pointerType === 'mouse') { trigger.current = event.currentTarget; enter(); setOpen(true); } }}
      onFocus={event => {
        if (suppressFocus.current) { suppressFocus.current = false; return; }
        if (event.currentTarget.matches(':focus-visible')) { trigger.current = event.currentTarget; cancelClose(); setOpen(true); }
      }}
      onClick={event => {
        trigger.current = event.currentTarget; cancelClose();
        pinned.current = !pinned.current; setOpen(pinned.current);
      }}>
      {compactLabel ? text : <><span className="seal" aria-hidden="true">{seal}</span><small>{label}</small><span>{text}</span></>}
    </button>)}
    <div ref={panel} id={id} popover="manual" className="scene-details-popover" role="dialog" aria-label="天气与环境详情"
      onPointerEnter={event => { if (event.pointerType === 'mouse') enter(); }} onPointerLeave={event => { if (event.pointerType === 'mouse') leave(); }}
      onFocus={cancelClose} onBlur={scheduleClose} onKeyDown={event => event.stopPropagation()}>
      <header><span>城市此刻</span><button type="button" aria-label="关闭天气与环境详情" onClick={() => close(true)}>关闭 ×</button></header>
      <dl>{fields.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
    </div>
  </div>;
}
