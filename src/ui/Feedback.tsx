import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

const desktopMedia = '(min-width: 901px)';
function subscribe(change: () => void) {
  const media = window.matchMedia(desktopMedia);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
export function useDesktopFeedback() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(desktopMedia).matches,
    () => false,
  );
}
export type FeedbackLevel = 'err' | 'warn' | 'info' | 'ok';
export function splitFeedback(text: string): [string, string] {
  const end = text.search(/[。；;]/);
  return end < 0 ? [text, ''] : [text.slice(0, end + 1), text.slice(end + 1)];
}
export function Feedback({
  children,
  level = 'info',
  role,
  className = '',
  embedded = false,
  actions,
  mobileChildren,
  mobileAs = 'div',
}: {
  children: ReactNode;
  level?: FeedbackLevel;
  role?: 'alert' | 'note' | 'status';
  className?: string;
  embedded?: boolean;
  actions?: ReactNode;
  mobileChildren?: ReactNode;
  mobileAs?: 'p' | 'div';
}) {
  const desktop = useDesktopFeedback();
  if (children === '') {
    const Tag=mobileAs;return <Tag className={className||undefined} role={role}>{mobileChildren??children}{actions}</Tag>;
  }
  if (!desktop) {
    const Tag = mobileAs;
    return (
      <Tag className={`${embedded?"feedback-message":"feedback"} l-${level} ${className}`} role={role}>
        {!embedded&&<span className="feedback-icon" aria-hidden="true">{{err:"误",warn:"注",info:"示",ok:"成"}[level]}</span>}
        <span className="feedback-text">{mobileChildren ?? children}</span>
        {actions}
      </Tag>
    );
  }
  const [lead, detail] = typeof children === 'string' ? splitFeedback(children) : [children, ''];
  return (
    <div
      role={role}
      className={`${embedded ? 'feedback-message' : 'feedback'} l-${level} ${className}`}
    >
      {!embedded && (
        <span className="feedback-icon" aria-hidden="true">
          {{ err: '误', warn: '注', info: '示', ok: '成' }[level]}
        </span>
      )}
      <div className="feedback-text">
        <b>{lead}</b>
        {detail && <small>{detail}</small>}
      </div>
      {actions && <div className="feedback-actions">{actions}</div>}
    </div>
  );
}
