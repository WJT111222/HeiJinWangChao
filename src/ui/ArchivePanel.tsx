import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import './archive.css';
import './archive-records.css';
import './archive-assets.css';
import './archive-reading.css';

/** Nonmodal desktop host. Content and navigation remain owned by the caller. */
export function ArchivePanel({ title, seal, subtitle, children, onClose, returnFocus, index = 1, total = 7, eyebrow,className }: {
  title: string; seal: string; subtitle: string; children: ReactNode; index?: number; total?: number;
  onClose: () => void; returnFocus?: () => HTMLElement | null; eyebrow?: string;className?:string;
}) {
  const id = useId(), root = useRef<HTMLElement>(null);
  const latest = useRef({onClose, returnFocus}); latest.current = {onClose, returnFocus};
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = root.current;
    if (!element?.contains(document.activeElement)) element?.focus({preventScroll:true});
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault(); latest.current.onClose();
    };
    document.addEventListener('keydown',escape);
    return () => {
      document.removeEventListener('keydown',escape);
      if (document.activeElement === document.body || element?.contains(document.activeElement))
        (latest.current.returnFocus?.() ?? opener)?.focus({preventScroll:true});
    };
  },[]);
  return <section className={`archive${className ? ` ${className}` : ''}`} data-tone="paper" role="dialog" aria-modal="false" aria-labelledby={id} tabIndex={-1} ref={root}>
    <header className="ar-head"><span className="seal" aria-hidden="true">{seal}</span>
      <div className="ar-title"><span className="eyebrow" aria-hidden="true">{eyebrow ?? `WORLD ARCHIVE · ${String(index).padStart(2,'0')} / ${String(total).padStart(2,'0')}`}</span><h2 id={id}>{title}</h2><span className="sub" title={subtitle}>{subtitle}</span></div>
      <span className="esc" aria-hidden="true">ESC</span><button className="ar-close" aria-label="关闭资料界面" onClick={onClose}>关闭 ×</button>
    </header><div className="ar-body">{children}</div>
  </section>;
}
