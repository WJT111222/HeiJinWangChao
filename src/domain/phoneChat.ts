import { z } from 'zod';
import { GameTimeSchema, IdSchema, requireData } from './common';
import { canonicalJson } from './worldbook/canonical';
import { hash53 } from './worldbook/triggerSupport';
import type { GameState } from './state';

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
export function restoreChat(state: GameState, rows: readonly ChatExchange[], choice?: 'keep' | 'discard') {
  const base = state.journal.at(-1)?.turnId;
  return rows.flatMap((row) => {
    if (
      state.phone.threads[row.reply.npcId]?.messages.some(
        (message) => message.id === row.id && message.source === 'chat',
      )
    )
      return [];
    if (row.baseTurnId === base && Date.parse(row.at) === Date.parse(state.worldClock)) return [row];
    requireData(choice, 'PHONE_TIMELINE', '请选择丢弃待结算聊天，或视为在恢复后的时间重新发生。');
    if (choice === 'discard') return [];
    requireData(
      base && Object.hasOwn(state.npc, row.reply.npcId),
      'PHONE_TIMELINE',
      '此历史节点没有聊天对象，请选择丢弃该批聊天。',
    );
    return [{ ...row, baseTurnId: base, at: state.worldClock }];
  });
}
