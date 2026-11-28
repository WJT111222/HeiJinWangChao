import { useRef } from 'react';
import type { usePrivateChat } from './usePrivateChat';

export interface PrivateChatControls {
  chat: ReturnType<typeof usePrivateChat>;
  frozen: boolean;
  inactive: boolean;
  enabled: boolean;
  canAbandon: boolean;
  canEnd: boolean;
  end: () => void;
}

export function PrivateChatComposer({
  npcId,
  contactStatus,
  controls,
}: {
  npcId: string;
  contactStatus?: 'known' | 'unknown' | 'invalid';
  controls: PrivateChatControls;
}) {
  const { chat, frozen, enabled, inactive } = controls;
  const value = chat.inputs[npcId] ?? '';
  const composing = useRef(false);
  const disabled = !enabled || inactive || frozen || chat.busy;
  async function send() {
    if (disabled || !value.trim()) return;
    if (await chat.send(npcId, value)) chat.edit(npcId, '');
  }
  if (contactStatus !== 'known') return <p className="ph-foot">{contactStatus === 'invalid' ? '号码已失效，不能发送' : '尚未获得号码，不能发送'}</p>;
  return (
    <section className="ph-compose" aria-label="私聊操作">
      {frozen && <p className="ph-warning">回合正在生成，手机只能查看。完成或放弃本回合后才能继续发消息。</p>}
      <>
        {!enabled && <p className="ph-foot">手机聊天已关闭，可在运行设置中开启。</p>}
        {chat.peer === npcId && (
          <div role="status">
            对方正在输入… <button onClick={chat.cancel}>取消发送</button>
          </div>
        )}
        <div className="ph-input-row">
          <input
            aria-label="私聊消息"
            placeholder="发消息…"
            disabled={disabled}
            value={value}
            onChange={(e) => chat.edit(npcId, e.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !composing.current &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button disabled={disabled || !value.trim()} onClick={() => void send()}>
            发送
          </button>
        </div>
      </>
      {chat.error?.npcId === npcId && <p role="alert">{chat.error.message}</p>}
      {frozen && controls.canAbandon && (
        <button disabled={inactive || chat.busy} onClick={() => void chat.abandon(npcId)}>
          放弃本回合，继续聊天
        </button>
      )}
      <button disabled={!controls.canEnd} onClick={controls.end}>
        结束聊天
      </button>
      <small>单独成一回合，正文写这段聊天和之后的日常；也可以回到行动框，随下一个行动提交。</small>
    </section>
  );
}
