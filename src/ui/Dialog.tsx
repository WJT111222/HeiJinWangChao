import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function Dialog({
  title,
  onClose,
  children,
  small = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  small?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={small ? 'modal modal-small' : 'modal'}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
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
      <header className="modal-heading">
        <div>
          <p className="eyebrow">HEIJIN / ARCHIVE</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭资料界面">
          关闭 <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="modal-body">{children}</div>
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
