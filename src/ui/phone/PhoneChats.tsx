import type { GameState } from '../../domain/state';
import type { PlayerView } from '../panels/playerView';
import { contactGroups, phoneDateTime } from './phoneView';

const receipts = { delivered: '已送达', read: '已读', read_unanswered: '已读未回' };
export function PhoneChats({
  state,
  view,
  unread,
  open,
}: {
  state: GameState;
  view: PlayerView;
  unread: { npcId: string }[];
  open: (id: string) => void;
}) {
  const groups = contactGroups(view);
  const rows = Object.values(state.phone.threads)
    .map((thread) => {
      const latest = thread.messages.reduce((a, b) => (Date.parse(a.at) > Date.parse(b.at) ? a : b));
      return { id: thread.npcId, latest };
    })
    .sort((a, b) => Date.parse(b.latest.at) - Date.parse(a.latest.at));
  return rows.length ? (
    <div className="ph-chats">
      {rows.map(({ id, latest }) => {
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
export function PhoneThread({ state, npcId }: { state: GameState; npcId: string }) {
  const messages = [...(state.phone.threads[npcId]?.messages ?? [])].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  return (
    <section className="ph-thread" aria-label="会话记录">
      {!messages.length && <p className="ph-foot">暂无消息</p>}
      {messages.map((m) => (
        <div key={m.id} className={'ph-message ' + (m.sender === 'protagonist' ? 'ph-out' : '')}>
          <p>{m.text}</p>
          <small>
            {m.source === 'offscreen' ? '场外来信 · ' : m.medium === 'call' ? '通话 · ' : ''}
            {phoneDateTime(m.at)}
            {m.status ? ' · ' + receipts[m.status] : ''}
          </small>
        </div>
      ))}
      {state.npc[npcId].phoneContact?.status === 'invalid' && (
        <p className="ph-foot">号码已失效，历史记录保留</p>
      )}
    </section>
  );
}
