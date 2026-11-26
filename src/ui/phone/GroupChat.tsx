import { Fragment, useState, useRef, useLayoutEffect } from 'react';
import { groupLabel, groupTypes, type GroupAction, type GroupThread } from '../../domain/phoneGroup';
import type { GameState } from '../../domain/state';
import type { PrivateChatControls } from './PrivateChatComposer';
import { phoneDateTime } from './phoneView';

export function GroupInvitation({
  state,
  thread,
  controls,
  done,
  cancel,
}: {
  state: GameState;
  thread?: GroupThread;
  controls: PrivateChatControls;
  done: (id: string) => void;
  cancel: () => void;
}) {
  const [category, setCategory] = useState<(typeof groupTypes)[number]>('自定义');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [id] = useState(() => thread?.id ?? crypto.randomUUID());
  const disabled = controls.frozen || controls.inactive || controls.chat.busy || !controls.enabled;
  const people = Object.values(state.npc).filter(
    (n) => n.phoneContact && n.phoneContact.status !== 'unknown' && !thread?.members.includes(n.id),
  );
  async function submit() {
    const action: GroupAction = thread
      ? { type: 'invite', invitees: selected }
      : { type: 'create', category, name: name.trim() || category + '群', invitees: selected };
    if (await controls.chat.group(id, action)) done(id);
  }
  const sheet = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = sheet.current!;
    const host = dialog.closest<HTMLDialogElement>('.game-phone')!;
    const align = () => {
      const rect = host.getBoundingClientRect();
      dialog.style.width = rect.width + 'px';
      dialog.style.left = rect.left + 'px';
      dialog.style.bottom = Math.max(0, window.innerHeight - rect.bottom) + 'px';
    };
    align();
    dialog.showModal();
    const observer = new ResizeObserver(align);
    observer.observe(host);
    window.addEventListener('resize', align);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={sheet}
      className="ph-group ph-invite"
      aria-label={thread ? '邀请成员' : '新建群聊'}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (controls.chat.peer === id) controls.chat.cancel();
        cancel();
      }}
    >
      <h4>{thread ? '邀请成员' : '新建群聊'}</h4>
      {!thread && (
        <>
          <label>
            群名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={category + '群'}
            />
          </label>
          <div className="ph-tabs">
            {groupTypes.map((t) => (
              <button key={t} aria-pressed={category === t} onClick={() => setCategory(t)}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}
      {people.map((n) => (
        <label className="ph-person" key={n.id}>
          <input
            type="checkbox"
            checked={selected.includes(n.id)}
            disabled={disabled || n.phoneContact?.status !== 'known'}
            onChange={(e) =>
              setSelected(e.target.checked ? [...selected, n.id] : selected.filter((id) => id !== n.id))
            }
          />
          {n.name}
          {n.phoneContact?.status === 'invalid' ? ' · 号码已失效' : ''}
        </label>
      ))}
      <p className="ph-warning">
        {(thread?.category ?? category) === '后宫'
          ? '拉进群的人会互相看到对方。原本互不知情的人被拉进同一个群，等于当众摊牌，下一回合会写出各人的反应。'
          : '建群算一次行动：群里的人会互相看到对方，下一回合会写出各人的反应。被拉的人可以拒绝或退群。'}
      </p>
      {controls.chat.peer === id && (
        <p role="status">
          正在等待成员回应… <button onClick={controls.chat.cancel}>取消请求</button>
        </p>
      )}
      {controls.chat.error?.npcId === id && <p role="alert">{controls.chat.error.message}</p>}
      <button disabled={controls.chat.peer === id} onClick={cancel}>
        取消
      </button>
      <button disabled={disabled || selected.length < (thread ? 1 : 2)} onClick={() => void submit()}>
        {thread ? '邀请（待结算）' : '建群（待结算）'}
      </button>
    </dialog>
  );
}

const outcomeLabels = {
  joined: '加入了群聊',
  refused: '拒绝加入',
  left: '退出了群聊',
  unread: '未读',
  later: '稍后回复',
  read_unanswered: '已读未回',
};
export function GroupConversation({
  state,
  group,
  pending,
  controls,
  invite,
}: {
  state: GameState;
  group: GroupThread;
  pending: Set<string>;
  controls: PrivateChatControls;
  invite: () => void;
}) {
  const { chat } = controls;
  const disabled =
    controls.frozen || controls.inactive || chat.busy || !controls.enabled || group.playerLeft;
  const text = chat.inputs[group.id] ?? '';
  async function send() {
    if (!disabled && text.trim() && (await chat.group(group.id, { type: 'message', text })))
      chat.edit(group.id, '');
  }
  return (
    <>
      <div className="ph-members">{group.members.map((id) => state.npc[id].name).join('、')}</div>
      <div className="ph-thread" aria-label="群聊记录" aria-live="polite">
        {group.history.map((row) => (
          <Fragment key={row.id}>
            <div className={'ph-message ph-out ' + (pending.has(row.id) ? 'ph-pending' : '')}>
              <p>{groupLabel(row.action)}</p>
              <small>{pending.has(row.id) ? '待结算' : phoneDateTime(row.at)}</small>
            </div>
            {row.outcomes.map((o) =>
              o.status === 'replied' ? (
                <div className={'ph-message ' + (pending.has(row.id) ? 'ph-pending' : '')} key={o.npcId}>
                  <small>{state.npc[o.npcId].name}</small>
                  <p>{o.text}</p>
                  <small>{pending.has(row.id) ? '待结算' : phoneDateTime(row.at)}</small>
                </div>
              ) : (
                <small key={o.npcId} className="ph-system">
                  {state.npc[o.npcId].name} · {outcomeLabels[o.status]}
                </small>
              ),
            )}
          </Fragment>
        ))}
      </div>
      <section className="ph-compose" aria-label="群聊操作">
        {controls.frozen && (
          <p className="ph-warning">回合正在生成，手机只能查看。完成或放弃本回合后才能继续发消息。</p>
        )}
        {chat.peer === group.id && (
          <p role="status">
            对方正在输入… <button onClick={chat.cancel}>取消发送</button>
          </p>
        )}
        {chat.error?.npcId === group.id && <p role="alert">{chat.error.message}</p>}
        {!group.playerLeft && (
          <>
            <div className="ph-input-row">
              <input
                aria-label="群聊消息"
                disabled={disabled}
                value={text}
                onChange={(e) => chat.edit(group.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button onClick={() => void send()} disabled={disabled || !text.trim()}>
                发送
              </button>
            </div>
            <button disabled={disabled} onClick={invite}>
              邀请成员
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                if (window.confirm('退出这个群聊？此操作将在下一回合结算。'))
                  void chat.group(group.id, { type: 'leave' });
              }}
            >
              退出群聊
            </button>
          </>
        )}
        {controls.frozen && controls.canAbandon && (
          <button disabled={controls.inactive || chat.busy} onClick={() => void chat.abandon(group.id)}>
            放弃本回合，继续聊天
          </button>
        )}
        <button disabled={!controls.canEnd} onClick={controls.end}>
          结束聊天
        </button>
      </section>
    </>
  );
}
