import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useDesktopFeedback } from './Feedback';
import type { FeedbackLevel } from './Feedback';
import './feedback.css';
import { ArchiveHeader } from './ArchiveHeader';
import type { ArchiveHeading } from './ArchiveHeader';

// One body lock for all native modal instances, including viewport transitions.
const modalLocks=new Set<HTMLDialogElement>();
let bodyOverflow='';
function lockBody(dialog:HTMLDialogElement){if(!modalLocks.size)bodyOverflow=document.body.style.overflow;modalLocks.add(dialog);document.body.style.overflow='hidden';}
function unlockBody(dialog:HTMLDialogElement){modalLocks.delete(dialog);if(!modalLocks.size)document.body.style.overflow=bodyOverflow;}

export function Dialog({
  title,
  onClose,
  children,
  small = false,
  className = '',
  closeLabel = '关闭资料界面',
  feedback,
  seal,
  eyebrow,
  badge,
  nonmodal=false,archiveHeading,returnFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  small?: boolean;
  className?: string;
  closeLabel?: string;
  feedback?: FeedbackLevel;
  seal?: string;
  eyebrow?: string;
  badge?: ReactNode;
  nonmodal?:boolean;archiveHeading?:ArchiveHeading;returnFocus?:()=>HTMLElement|null;
}) {
  const desktop = useDesktopFeedback();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose),restore=useRef<HTMLElement|null>(null);
  const initialOpener=useRef<HTMLElement|null>(null),previousMode=useRef<boolean|undefined>(undefined);
  const focusReturn=useRef(returnFocus);focusReturn.current=returnFocus;
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current!;
    if(!initialOpener.current)initialOpener.current=document.activeElement as HTMLElement|null;
    const opener=initialOpener.current;
    const transitioning=previousMode.current!==undefined&&previousMode.current!==nonmodal;previousMode.current=nonmodal;
    const focused=document.activeElement as HTMLElement|null;
    const covering=[...document.querySelectorAll<HTMLDialogElement>('dialog:modal')];
    const above=transitioning?covering:[];
    // A pre-existing confirmation stays above settings across either viewport transition.
    above.sort((a,b)=>Number(a.contains(focused))-Number(b.contains(focused)));
    const body=dialog.querySelector<HTMLElement>('.modal-body,.ar-body'),scroll=body?.scrollTop??0;
    if(nonmodal)dialog.show();else{lockBody(dialog);dialog.showModal();}
    if(restore.current?.isConnected&&dialog.contains(restore.current))restore.current.focus({preventScroll:true});
    else if(nonmodal)dialog.focus({preventScroll:true});
    for(const modal of above){modal.close();modal.showModal();}
    if((transitioning||nonmodal)&&covering.some(modal=>modal.contains(focused)))focused?.focus({preventScroll:true});
    if(body)body.scrollTop=scroll;
    const escape=(event:KeyboardEvent)=>{
      if(!nonmodal||event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog:modal'))return;
      event.preventDefault();close.current();
    };
    if(nonmodal)document.addEventListener('keydown',escape);
    return () => {
      const active=document.activeElement as HTMLElement|null;
      const overlay=active?.closest('dialog:modal');
      const keepOverlayFocus=Boolean(overlay&&overlay!==dialog);
      restore.current=dialog.contains(active)?active:null;
      dialog.close();
      if(!nonmodal)unlockBody(dialog);
      if(keepOverlayFocus)active?.focus({preventScroll:true});
      else if(!nonmodal||document.activeElement===document.body||dialog.contains(document.activeElement))
        (nonmodal?focusReturn.current?.()??opener:opener)?.focus({preventScroll:true});
      document.removeEventListener('keydown',escape);
    };
  }, [nonmodal]);
  return (
    <dialog
      ref={ref}
      className={`${nonmodal?'archive':small ? 'modal modal-small' : 'modal'} ${className} ${feedback ? `feedback-dialog l-${feedback}` : ''}`.trim()}
      aria-labelledby={titleId}
      aria-modal={nonmodal?false:undefined}
      tabIndex={nonmodal?-1:undefined}
      data-tone={nonmodal||archiveHeading?"paper":undefined}
      onKeyDown={(event) => {
        if (nonmodal || event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      {archiveHeading ? <ArchiveHeader {...archiveHeading} titleId={titleId} onClose={onClose} closeLabel={closeLabel}/> : <header className="modal-heading">
        {desktop && seal && (
          <span className="dialog-seal" aria-hidden="true">
            {seal}
          </span>
        )}
        <div>
          <p className="eyebrow" aria-hidden={desktop && eyebrow ? true : undefined}>
            {desktop && eyebrow ? eyebrow : 'HEIJIN / ARCHIVE'}
          </p>
          <h2 id={titleId}>{title}</h2>
        </div>
        {desktop && badge}
        <button type="button" onClick={onClose} aria-label={closeLabel}>
          关闭 <span aria-hidden="true">×</span>
        </button>
      </header>}
      <div className={nonmodal?"ar-body":"modal-body"}>{children}</div>
    </dialog>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail">
      <dt>{label}</dt>
      <dd>
        {children === '' || children === undefined || children === null ? '未填写' : children}
      </dd>
    </div>
  );
}
