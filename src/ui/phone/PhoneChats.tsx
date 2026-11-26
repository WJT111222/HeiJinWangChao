import { Fragment } from 'react';
import type { ChatExchange } from '../../domain/phoneChat';
import { chatMessages } from '../../domain/phone';
import type { GameState } from '../../domain/state';
import type { PlayerView } from '../panels/playerView';
import { contactGroups, phoneDateTime } from './phoneView';

const receipts = { delivered: '已送达', read: '已读', read_unanswered: '已读未回' };
export function PhoneChats({
  state,
  view,
  unread,
  pending,
  open,
}: {
  state: GameState;
  view: PlayerView;
  pending: ChatExchange[];
  unread: { npcId: string }[];
  open: (id: string) => void;
}) {
  const groups = contactGroups(view);
  const latestByPeer = new Map(
    Object.values(state.phone.threads).map((thread) => [
      thread.npcId,
      {
        latest: thread.messages.reduce((a, b) => (Date.parse(a.at) > Date.parse(b.at) ? a : b)),
        pendingIndex: -1,
      },
    ]),
  );
  pending.forEach((row, index) =>
    latestByPeer.set(row.reply.npcId, {
      latest: chatMessages(row, row.baseTurnId).at(-1)!,
      pendingIndex: index,
    }),
  );
  const rows = [...latestByPeer]
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => Date.parse(b.latest.at) - Date.parse(a.latest.at) || b.pendingIndex - a.pendingIndex);
  return rows.length ? (
    <div className="ph-chats">
      {rows.map(({ id, latest, pendingIndex }) => {
        const p = state.npc[id];
        const label = Object.entries(groups).find(([, people]) =>
          people.some((person) => person.id === id),
        )?.[0];
        return (
          <button
            className={'ph-chat-row' + (p.phoneContact?.status === 'invalid' ? ' ph-invalid' : '')}
            key={id}
            onClick={() => open(id)}
          >
            <span className="ph-avatar" aria-hidden="true">
              {Array.from(p.name)[0]}
            </span>
            <span className="ph-chat-body">
              <b>{p.name}</b> <small>{label && label !== '其他' ? label : '私聊'}</small>
              <span className="ph-preview">
                {pendingIndex >= 0 && <b className="ph-pending-label">[待结算] </b>}
                {latest.status === 'read_unanswered' ? '已读未回 · ' : ''}
                {latest.medium === 'call' ? '通话 · ' : ''}
                {latest.text}
              </span>
            </span>
            <span>
              <time>{phoneDateTime(latest.at)}</time>
              {unread.some((m) => m.npcId === id) && <i className="ph-dot" aria-label="有未读消息" />}
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <p className="ph-foot">暂无聊天</p>
  );
}
export function PhoneThread({
  state,
  npcId,
  pending,
}: {
  state: GameState;
  npcId: string;
  pending: ChatExchange[];
}) {
  const messages = [...(state.phone.threads[npcId]?.messages ?? [])].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const rows = [
    ...messages.map((m) => ({ m, pending: false })),
    ...pending.flatMap((row) => chatMessages(row, row.baseTurnId).map((m) => ({ m, pending: true }))),
  ];
  return (
    <section className="ph-thread" aria-label="会话记录">
      {!rows.length && <p className="ph-foot">暂无消息</p>}
      {rows.map(({ m, pending }) => (
        <Fragment key={m.id}>
          <div
            className={
              'ph-message ' + (pending ? 'ph-pending ' : '') + (m.sender === 'protagonist' ? 'ph-out' : '')
            }
          >
            <p>{m.text}</p>
            <small>
              {m.source === 'offscreen' ? '场外来信 · ' : m.medium === 'call' ? '通话 · ' : ''}
              {pending ? '待结算' : phoneDateTime(m.at)}
              {m.status
                ? ' · ' + (m.chatOutcome === 'unread' ? '未读' : m.chatOutcome ? '已读' : receipts[m.status])
                : ''}
            </small>
          </div>
          {(m.chatOutcome === 'read_unanswered' || m.chatOutcome === 'later') && (
            <small className="ph-system">对方已读，暂未回复</small>
          )}
        </Fragment>
      ))}
      {state.npc[npcId].phoneContact?.status === 'invalid' && (
        <p className="ph-foot">号码已失效，历史记录保留</p>
      )}
    </section>
  );
}
