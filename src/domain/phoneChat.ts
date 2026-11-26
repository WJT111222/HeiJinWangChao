import { z } from 'zod';
import { GameTimeSchema, IdSchema, requireData } from './common';
import { canonicalJson } from './worldbook/canonical';
import { hash53 } from './worldbook/triggerSupport';
import type { GameState } from './state';
import { chatMessages } from './phone';

export const ChatReply = z.discriminatedUnion('status', [
  z.strictObject({ npcId: IdSchema, status: z.literal('replied'), text: z.string().min(1) }),
  z.strictObject({ npcId: IdSchema, status: z.enum(['read_unanswered', 'later', 'unread']) }),
]);
export const ChatExchange = z.strictObject({
  id: z.uuid(),
  baseTurnId: IdSchema,
  at: GameTimeSchema,
  text: z.string().min(1),
  reply: ChatReply,
});
export type ChatExchange = z.infer<typeof ChatExchange>;
export const ChatPending = ChatExchange.array().refine(
  (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
  '私聊操作 ID 重复',
);
export const ChatFreeze = z.strictObject({ ids: IdSchema.array(), checksum: z.number().int().nonnegative() });
export function freezeChat(rows: readonly ChatExchange[]) {
  return {
    ids: rows.flatMap((row) => (row.reply.status === 'replied' ? [row.id, row.id + ':reply'] : [row.id])),
    checksum: hash53(canonicalJson(rows)),
  };
}
export function sameChatFreeze(rows: ChatExchange[], frozen?: z.infer<typeof ChatFreeze>) {
  return Boolean(frozen && canonicalJson(freezeChat(rows)) === canonicalJson(frozen));
}
export function restoreChat(
  state: GameState,
  rows: readonly ChatExchange[],
  choice?: 'keep' | 'discard',
  snapshot: readonly ChatExchange[] = [],
) {
  const base = state.journal.at(-1)?.turnId;
  const pending = new Map(snapshot.map(row => [row.id, row]));
  for (const row of rows) {
    const sameTime = row.baseTurnId === base && Date.parse(row.at) === Date.parse(state.worldClock);
    if (!sameTime && choice === 'discard') continue;
    const messages = state.phone.threads[row.reply.npcId]?.messages ?? [];
    const sent = messages.find(message => message.id === row.id && message.source === 'chat');
    if (sent) {
      const matches = chatMessages(row, sent.deliveredTurnId).every(message => {
        const stored = messages.find(item => item.id === message.id);
        return stored && canonicalJson(stored) === canonicalJson(message);
      });
      requireData(matches, 'PHONE_CONFLICT', '历史会话中同一消息 ID 的原文、回执或时间线与待结算私聊不符');
      continue;
    }
    let restored = row;
    if (!sameTime) {
      requireData(choice, 'PHONE_TIMELINE', '请选择丢弃待结算聊天，或视为在恢复后的时间重新发生。');
      requireData(base && Object.hasOwn(state.npc, row.reply.npcId), 'PHONE_TIMELINE',
        '此历史节点没有聊天对象，请选择丢弃该批聊天。');
      restored = { ...row, baseTurnId: base, at: state.worldClock };
    }
    const previous = pending.get(row.id);
    requireData(!previous || canonicalJson(previous) === canonicalJson(restored), 'PHONE_CONFLICT',
      '恢复点中同一操作 ID 的待结算私聊存在冲突');
    pending.set(row.id, restored);
  }
  return [...pending.values()];
}
