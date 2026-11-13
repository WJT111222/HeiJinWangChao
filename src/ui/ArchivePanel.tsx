import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { ArchiveHeader } from './ArchiveHeader';
import { Dialog } from './Dialog';
import { useDesktopFeedback } from './Feedback';
import './archive.css';
import './archive-map.css';
import './archive-records.css';
import './archive-assets.css';
import './archive-reading.css';
import './mobile-archives.css';

/** Nonmodal desktop host. Content and navigation remain owned by the caller. */
function ArchiveReader({ title, seal, subtitle, children, onClose, returnFocus, index = 1, total = 7, eyebrow,className }: {
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
    <ArchiveHeader title={title} seal={seal} subtitle={subtitle} eyebrow={eyebrow} index={index} total={total} titleId={id} onClose={onClose}/><div className="ar-body">{children}</div>
  </section>;
}

type ArchiveProps=Parameters<typeof ArchiveReader>[0];
/** Settings retain the same native node and form instance across viewport changes. */
function SettingsArchive(props:ArchiveProps&{inGame:boolean}) {
 const desktop=useDesktopFeedback();
 // Settings can also be opened on the cover: keep its visible bounds above a soft keyboard
 // without changing the game shell viewport or any other dialog.
 useEffect(()=>{
  if(desktop)return;
  const dialog=document.querySelector<HTMLDialogElement>('dialog.settings-mobile-paper'),viewport=window.visualViewport;
  if(!dialog||!viewport)return;
  const update=()=>{if(viewport.scale!==1){dialog.style.removeProperty('--game-viewport-height');dialog.style.removeProperty('--game-viewport-top');return;}dialog.style.setProperty('--game-viewport-height',`${viewport.height}px`);dialog.style.setProperty('--game-viewport-top',`${viewport.offsetTop}px`);};
  update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
  return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);dialog.style.removeProperty('--game-viewport-height');dialog.style.removeProperty('--game-viewport-top');};
 },[desktop]);
 return <Dialog title={props.title} onClose={props.onClose} nonmodal={desktop&&props.inGame}
  mobileVariant="sheet" sheetFull seal={props.seal} eyebrow={props.eyebrow}
  className={desktop?'settings-paper settings-dialog':'mobile-archive settings-mobile-paper'} returnFocus={props.returnFocus}
  archiveHeading={desktop?{title:props.title,seal:props.seal,subtitle:props.subtitle,eyebrow:props.eyebrow}:undefined}>{props.children}</Dialog>;
}
export function ArchivePanel(props:ArchiveProps&{settingsHost?:{inGame:boolean}}) {
 return props.settingsHost ? <SettingsArchive {...props} inGame={props.settingsHost.inGame}/> : <ArchiveReader {...props}/>;
}
