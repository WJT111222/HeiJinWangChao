import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import { chinaCalendar } from '../../domain/openingTime';
import { locationText } from '../game/atmosphere';
import type { PlayerView } from '../panels/playerView';
import { PhoneAssets } from './PhoneAssets';
import { contactGroups, phoneDate, phoneMoney } from './phoneView';
import type { usePhoneReminders } from './usePhoneReminders';
import './phone.css';

type Page = '锁屏' | '主屏' | '资产' | '信息' | '通知';
function Badge({ count }: { count: number }) {
  return count > 0 ? (
    <span className="ph-badge" aria-label={count + ' 条未读'}>
      {count}
    </span>
  ) : null;
}
export function PhoneEntry({
  mobile = false,
  count,
  open,
  onClick,
}: {
  mobile?: boolean;
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-phone-entry={mobile ? 'mobile' : 'desktop'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <span className={mobile ? 'mobile-seal' : 'ph-seal'} aria-hidden="true">
        机
      </span>
      手机
      <Badge count={count} />
    </button>
  );
}
function Contacts({ view, showNpc }: { view: PlayerView; showNpc: (id: string) => void }) {
  const groups = useMemo(() => contactGroups(view), [view]);
  return (
    <>
      {Object.entries(groups).map(([name, people]) => (
        <section key={name} className="ph-group">
          <h4>{name}</h4>
          {people.length ? (
            people.map((p) => (
              <div className="ph-person" key={p.id}>
                <span className="ph-avatar" aria-hidden="true">
                  {Array.from(p.name)[0]}
                </span>
                <span>
                  <b>{p.name}</b>
                  <small>{p.phoneContact?.status === 'invalid' ? '号码已失效' : '有号码'}</small>
                </span>
                <button type="button" aria-label={'查看' + p.name + '的档案'} onClick={() => showNpc(p.id)}>
                  查看档案 ›
                </button>
              </div>
            ))
          ) : (
            <small>暂无</small>
          )}
        </section>
      ))}
      <p className="ph-foot">只有拿到号码的人会出现在这里。同学、同事、亲戚建档时默认有号码。</p>
    </>
  );
}

export function GamePhone({
  state,
  view,
  mobile,
  data,
  close,
  showNpc,
}: {
  state: GameState;
  view: PlayerView;
  mobile: boolean;
  data: ReturnType<typeof usePhoneReminders>;
  close: (action?: boolean) => void;
  showNpc: (id: string) => void;
}) {
  const [page, go] = useState<Page>(() => (data.unread.length ? '锁屏' : '主屏'));
  const [contacts, setContacts] = useState(false);
  const [selected, setSelected] = useState<{ id: string }>();
  const select = (id: string) => setSelected({ id });
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closer = useRef(close);
  useLayoutEffect(() => {
    closer.current = close;
  }, [close]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    if (mobile) element.showModal();
    else element.show();
    element.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (
        !mobile &&
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog:modal')
      ) {
        event.preventDefault();
        closer.current();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      element.close();
    };
  }, [mobile]);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    if (!selected) return;
    const timeout = window.setTimeout(() => setSelected(undefined), 1600);
    return () => clearTimeout(timeout);
  }, [selected]);
  const cal = !state.openingTimePending && chinaCalendar(state.worldClock);
  const clock = cal ? String(cal.hour).padStart(2, '0') + ':' + String(cal.minute).padStart(2, '0') : '--:--';
  const location = locationText(state.locations, state.protagonist.locationId);
  const label = state.protagonist.name + '的手机 · 游戏内';
  const note = (loan: (typeof data.loans)[number]) => (
    <button
      className="ph-note"
      key={loan.key}
      onClick={() => {
        data.markRead(loan.key);
        go('资产');
        select(loan.debt.id);
      }}
    >
      <span className="ph-icon" aria-hidden="true">
        贷
      </span>
      <span>
        <b>
          {loan.debt.source || loan.debt.creditor} · {loan.deadline}
        </b>
        <small>
          {phoneDate(loan.dueAt)}应还 {phoneMoney(loan.debt.outstanding)}
          {loan.debt.autoPaymentAuthorized && '，自动扣款'}
        </small>
      </span>
    </button>
  );
  const nearest = data.loans[0];
  return (
    <dialog
      ref={dialog}
      className={'game-phone ' + (mobile ? 'ph-mobile' : 'ph-desktop')}
      aria-label={label}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      {mobile && (
        <header className="ph-sheet">
          <span>{label}</span>
          <button onClick={() => close()}>返回游戏</button>
        </header>
      )}
      <div className="ph-os">
        <div className="ph-status">
          <time>{clock}</time>
          <svg viewBox="0 0 60 12" aria-hidden="true">
            <path d="M0 8h3v4H0zM5 5h3v7H5zM10 2h3v10h-3z" />
            <rect x="34" y="1" width="22" height="10" rx="2" fill="none" stroke="currentColor" />
            <path d="M36 3h14v6H36z" />
          </svg>
        </div>
        {page !== '锁屏' && page !== '主屏' && (
          <header className="ph-appbar">
            <button aria-label="返回手机主屏" onClick={() => go('主屏')}>
              ‹
            </button>
            <h3 ref={heading} tabIndex={-1}>
              {page}
            </h3>
          </header>
        )}
        <div className="ph-scroll" key={page}>
          {page === '锁屏' && (
            <div className="ph-lock">
              <h3 ref={heading} tabIndex={-1}>
                {clock}
              </h3>
              <p>
                {cal ? phoneDate(state.worldClock) + ' ' + cal.weekday : '开局时间待确认'} ·{' '}
                {location.city || location.name} · 游戏时间
              </p>
              {data.unread.map(note)}
              <button className="ph-unlock" onClick={() => go('主屏')}>
                点按进入
              </button>
            </div>
          )}
          {page === '主屏' && (
            <>
              <h3 className="sr-only" tabIndex={-1} ref={heading}>
                手机主屏
              </h3>
              <div className="ph-grid">
                {(['资产', '信息', '小黑书', '通知', '日程'] as const).map((app, i) => (
                  <button
                    key={app}
                    disabled={app === '小黑书' || app === '日程'}
                    onClick={() => {
                      if (app === '信息') setContacts(false);
                      if (app === '资产' || app === '信息' || app === '通知') go(app);
                    }}
                  >
                    <span className={'ph-icon' + (app === '小黑书' ? ' ph-book' : '')} aria-hidden="true">
                      {['资', '信', '书', '通', '程'][i]}
                    </span>
                    {app}
                    {app === '通知' && <Badge count={data.unread.length} />}
                  </button>
                ))}
              </div>
              <section className="ph-widget">
                <small>存款</small>
                <strong className="ph-money">{phoneMoney(state.economy.onlineBalance)}</strong>
                <small>
                  {nearest
                    ? (nearest.debt.source || nearest.debt.creditor) +
                      ' · ' +
                      phoneDate(nearest.dueAt) +
                      '到期 · ' +
                      phoneMoney(nearest.debt.outstanding)
                    : '暂无到期贷款'}
                </small>
              </section>
            </>
          )}
          {page === '资产' && (
            <PhoneAssets
              state={state}
              soon={new Set(data.reminders.map((row) => row.debt.id))}
              selected={selected}
              select={select}
            />
          )}
          {page === '信息' && (
            <>
              <div className="ph-tabs">
                {['聊天', '通讯录'].map((name, i) => (
                  <button
                    key={name}
                    aria-pressed={contacts === Boolean(i)}
                    onClick={() => setContacts(Boolean(i))}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {contacts ? <Contacts view={view} showNpc={showNpc} /> : <p className="ph-foot">暂无聊天</p>}
            </>
          )}
          {page === '通知' && (
            <>
              <section className="ph-group">
                <h4>本回合</h4>
                <small>暂无</small>
              </section>
              <section className="ph-group">
                <h4>提醒</h4>
                {data.reminders.length ? data.reminders.map(note) : <small>暂无</small>}
              </section>
              <p className="ph-foot">通知在每回合结算后汇总，不调用 AI。</p>
            </>
          )}
        </div>
        <button className="ph-exit" onClick={() => close(true)}>
          回到行动框
        </button>
      </div>
    </dialog>
  );
}
