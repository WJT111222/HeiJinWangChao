import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import { chinaCalendar } from '../../domain/openingTime';
import { locationText } from '../game/atmosphere';
import type { PlayerView } from '../panels/playerView';
import type { ChatExchange } from '../../domain/phoneChat';
import { PrivateChatComposer, type PrivateChatControls } from './PrivateChatComposer';
import { PhoneChats, PhoneThread } from './PhoneChats';
import { PhoneAssets } from './PhoneAssets';
import { contactGroups, phoneDate, phoneDateTime, phoneMoney } from './phoneView';
import type { usePhoneReminders } from './usePhoneReminders';
import './phone.css';

type Page = '锁屏' | '主屏' | '资产' | '信息' | '通知' | '会话';
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
function Contacts({
  view,
  showNpc,
  open,
}: {
  view: PlayerView;
  open: (id: string) => void;
  showNpc: (id: string) => void;
}) {
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
                <button
                  className="ph-peer"
                  onClick={() => open(p.id)}
                  aria-label={'打开与' + p.name + '的会话'}
                >
                  <b>{p.name}</b>
                  <small>{p.phoneContact?.status === 'invalid' ? '号码已失效' : '有号码'}</small>
                </button>
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
  controls,
  pending,
}: {
  controls: PrivateChatControls;
  pending: ChatExchange[];
  state: GameState;
  view: PlayerView;
  mobile: boolean;
  data: ReturnType<typeof usePhoneReminders>;
  close: (action?: boolean) => void;
  showNpc: (id: string) => void;
}) {
  const [page, go] = useState<Page>(() => (data.unreadCount ? '锁屏' : '主屏'));
  const [contacts, setContacts] = useState(false);
  const [peer, setPeer] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{ if (page === '会话' && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; },[page,peer,pending.length]);
  const [previous, setPrevious] = useState<Page>('信息');
  const openThread = (id: string) => {
    setPrevious(page);
    setPeer(id);
    go('会话');
  };
  const npc = Object.hasOwn(state.npc, peer) ? state.npc[peer] : undefined;
  const relation = useMemo(
    () => Object.entries(contactGroups(view)).find(([, people]) => people.some((p) => p.id === peer))?.[0],
    [view, peer],
  );
  useEffect(() => {
    if (page !== '会话') return;
    const keys = data.unreadMessages.filter((m) => m.npcId === peer).map((m) => m.key);
    if (keys.length) data.markRead(...keys);
  }, [page, peer, data]);
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
  const notification = ({ npcId, message }: (typeof data.messages)[number]) => (
    <button key={message.id} className="ph-note" onClick={() => openThread(npcId)}>
      <span className="ph-icon" aria-hidden="true">
        信
      </span>
      <span>
        <b>
          {state.npc[npcId].name} ·{' '}
          {message.source === 'offscreen' ? '场外来信' : message.medium === 'call' ? '通话' : '新消息'}
        </b>
        <time dateTime={message.at}>{phoneDateTime(message.at)}</time>
        <small className="ph-preview">{message.text}</small>
      </span>
    </button>
  );
  const turnMessages = data.messages.filter(
    (row) => row.message.deliveredTurnId === state.journal.at(-1)?.turnId,
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
            <button
              aria-label={page === '会话' ? '返回上一页' : '返回手机主屏'}
              onClick={() => go(page === '会话' ? previous : '主屏')}
            >
              ‹
            </button>
            <h3 ref={heading} tabIndex={-1}>
              {page === '会话' && npc ? (
                <>
                  {npc.name} <small>{relation && relation !== '其他' ? relation : '私聊'}</small>
                </>
              ) : (
                page
              )}
            </h3>
          </header>
        )}
        <div className="ph-scroll" key={page} ref={scroller}>
          {page === '锁屏' && (
            <div className="ph-lock">
              <h3 ref={heading} tabIndex={-1}>
                {clock}
              </h3>
              <p>
                {cal ? phoneDate(state.worldClock) + ' ' + cal.weekday : '开局时间待确认'} ·{' '}
                {location.city || location.name} · 游戏时间
              </p>
              {data.unreadMessages.map(notification)}
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
                    {app === '信息' && <Badge count={data.unreadMessages.length} />}
                    {app === '通知' && <Badge count={data.unreadCount} />}
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
              {contacts ? (
                <Contacts view={view} showNpc={showNpc} open={openThread} />
              ) : (
                <>
                  {pending.length > 0 && <section className="ph-pending-banner"><p>{pending.length} 条聊天待结算，会随下一回合提交。</p>
                    <button disabled={!controls.canEnd} onClick={controls.end}>结束聊天，发起回合</button><button onClick={()=>close(true)}>回到行动框</button></section>}
                  <PhoneChats state={state} view={view} pending={pending} unread={data.unreadMessages} open={openThread} />
                </>
              )}
            </>
          )}
          {page === '会话' && npc && <PhoneThread state={state} npcId={npc.id} pending={pending.filter(row=>row.reply.npcId === npc.id)} />}
          {page === '通知' && (
            <>
              <section className="ph-group">
                <h4>本回合</h4>
                {turnMessages.length ? turnMessages.map(notification) : <small>暂无</small>}
              </section>
              <section className="ph-group">
                <h4>提醒</h4>
                {data.reminders.length ? data.reminders.map(note) : <small>暂无</small>}
              </section>
              <p className="ph-foot">通知在每回合结算后汇总，不调用 AI。</p>
            </>
          )}
        </div>
        {page === '会话' && npc && <PrivateChatComposer npcId={npc.id} contactStatus={npc.phoneContact?.status} controls={controls}/>}
        {!(page === '信息' && !contacts && pending.length > 0) && <button className="ph-exit" onClick={() => close(true)}>
          回到行动框
        </button>}
      </div>
    </dialog>
  );
}
