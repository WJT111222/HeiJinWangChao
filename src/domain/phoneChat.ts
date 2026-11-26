import { GroupExchange, groupIds } from './phoneGroup';
import { z } from 'zod';
import { GameTimeSchema, IdSchema, requireData } from './common';
import { canonicalJson } from './worldbook/canonical';
import { hash53 } from './worldbook/triggerSupport';
import type { GameState } from './state';
import { chatMessages, chatBase } from './phone';

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
export const PhoneOperation = z.union([ChatExchange, GroupExchange]);
export type PhoneOperation = z.infer<typeof PhoneOperation>;
export function isPrivate(row:PhoneOperation):row is ChatExchange { return 'reply' in row; }
export function isGroup(row:PhoneOperation):row is GroupExchange { return 'kind' in row; }
export function participants(row:PhoneOperation) { return isPrivate(row) ? [row.reply.npcId] : row.audience; }
export const ChatPending = PhoneOperation.array().refine(
  (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
  '私聊操作 ID 重复',
);
export const ChatFreeze = z.strictObject({ ids: IdSchema.array(), checksum: z.number().int().nonnegative() });
export function freezeChat(rows: readonly PhoneOperation[]) {
  return {
    ids: rows.flatMap((row) => !isPrivate(row) ? groupIds(row) : row.reply.status === 'replied' ? [row.id, row.id + ':reply'] : [row.id]),
    checksum: hash53(canonicalJson(rows)),
  };
}
export function sameChatFreeze(rows: PhoneOperation[], frozen?: z.infer<typeof ChatFreeze>) {
  return Boolean(frozen && canonicalJson(freezeChat(rows)) === canonicalJson(frozen));
}
export function restoreChat(
  state: GameState,
  rows: readonly PhoneOperation[],
  choice?: 'keep' | 'discard',
  snapshot: readonly PhoneOperation[] = [],
) {
  const base = state.journal.at(-1)?.turnId;
  const pending = new Map(snapshot.map(row => [row.id, row]));
  for (const row of rows) {
    const sameTime = row.baseTurnId === base && Date.parse(row.at) === Date.parse(state.worldClock);
    if (!sameTime && choice === 'discard') continue;
    if (!isPrivate(row)) {
      const found = state.phone.groups?.[row.groupId]?.history.find(op=>op.id === row.id);
      if (found) {
        requireData(canonicalJson({...row,turnId:found.turnId}) === canonicalJson(found),'PHONE_CONFLICT','历史群聊与待结算操作冲突');
        continue;
      }
    }
    const messages = isPrivate(row) ? state.phone.threads[row.reply.npcId]?.messages ?? [] : [];
    const sent = messages.find(message => message.id === row.id && message.source === 'chat');
    if (sent && isPrivate(row)) {
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
      requireData(base && participants(row).every(id=>Object.hasOwn(state.npc,id)), 'PHONE_TIMELINE',
        '此历史节点没有聊天对象，请选择丢弃该批聊天。');
      restored = { ...row, baseTurnId: base, at: state.worldClock };
    }
    const previous = pending.get(row.id);
    requireData(!previous || canonicalJson(previous) === canonicalJson(restored), 'PHONE_CONFLICT',
      '恢复点中同一操作 ID 的待结算私聊存在冲突');
    pending.set(row.id, restored);
  }
  const result = [...pending.values()];
  chatBase(state,result,base ?? 'restore');
  return result;
}
