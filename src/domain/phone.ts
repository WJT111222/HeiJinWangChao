import { GroupThread, appendGroup, groupIds } from './phoneGroup';
import { Topic, topicLimit } from './phoneTopic';
import { isPrivate, type PhoneOperation } from './phoneChat';
import { canonicalJson } from './worldbook/canonical';
import type { TurnDraft } from './drafts';
import type { ChatExchange } from './phoneChat';
import { z } from 'zod';
import { GameTimeSchema, IdSchema, requireData } from './common';
import type { GameState } from './state';

const content = z.string().min(1);
const medium = z.enum(['text', 'call']);
const receipt = z.enum(['delivered', 'read', 'read_unanswered']);
const sender = z.enum(['protagonist', 'npc']);
export const StoryPhoneInput = z.strictObject({
  messageId: IdSchema,
  sender,
  medium,
  text: content,
  status: receipt.optional(),
  at: GameTimeSchema.optional(),
});
export const ScheduledPhoneInput = z.strictObject({
  messageId: IdSchema,
  npcId: IdSchema,
  dueAt: GameTimeSchema,
  text: content,
});
const Message = z.strictObject({
  id: IdSchema,
  sender,
  medium,
  text: content,
  status: receipt.optional(),
  at: GameTimeSchema,
  source: z.enum(['story', 'offscreen','chat']),
  chatOutcome: z.enum(['replied','later','read_unanswered','unread']).optional(),
  sourceTurnId: IdSchema,
  deliveredTurnId: IdSchema,
});
export type PhoneMessage = z.infer<typeof Message>;
const Thread = z.strictObject({
  kind: z.literal('direct'),
  npcId: IdSchema,
  createdAt: GameTimeSchema,
  createdTurnId: IdSchema,
  messages: Message.array().min(1),
});
export const PhoneSchema = z.strictObject({
  version: z.literal(1),
  threads: z.record(IdSchema, Thread),
  scheduled: ScheduledPhoneInput.extend({ sourceTurnId: IdSchema }).array(),
  topics: Topic.array(),
  groups: z.record(z.uuid(),GroupThread).optional(),
});
export const emptyPhone = (): z.infer<typeof PhoneSchema> => ({
  version: 1,
  threads: {},
  scheduled: [],
  topics: [],
});

export function validPhone(state: Pick<GameState, 'phone' | 'npc'>) {
  const ids = new Set<string>();
  function unique(id: string) {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  }
  const groups: Record<string,GroupThread> = {};
  try {
    for (const [id, group] of Object.entries(state.phone.groups ?? {})) {
      for (const operation of group.history) {
        if (operation.groupId !== id || !groupIds(operation).every(unique)) return false;
        appendGroup(groups,operation,operation.turnId,state.npc);
      }
      if (canonicalJson(groups[id]) !== canonicalJson(group)) return false;
    }
  } catch { return false; }
  const counts = new Map<string,number>();
  for(const topic of state.phone.topics){
    const count=(counts.get(topic.turnId)??0)+1;
    if(count>topicLimit || Date.parse(topic.at)>=Date.parse(topic.expiresAt) || !unique(topic.id)) return false;
    counts.set(topic.turnId,count);
  }
  return (
    Object.entries(state.phone.threads).every(
      ([id, t]) =>
        id === t.npcId &&
        Object.hasOwn(state.npc, id) &&
        t.messages.every(
          (m) =>
            unique(m.id) &&
            (!m.status || m.sender === 'protagonist') &&
            (m.source !== 'offscreen' || (m.sender === 'npc' && m.medium === 'text')),
        ),
    ) && state.phone.scheduled.every((m) => Object.hasOwn(state.npc, m.npcId) && unique(m.messageId))
  );
}
function findMessage(s: GameState, id: string) {
  for (const t of Object.values(s.phone.threads)) {
    const message = t.messages.find((m) => m.id === id);
    if (message) return { npcId: t.npcId, message };
  }
}
function append(s: GameState, npcId: string, message: PhoneMessage) {
  if (!Object.hasOwn(s.phone.threads, npcId))
    s.phone.threads[npcId] = {
      kind: 'direct',
      npcId,
      createdAt: message.at,
      createdTurnId: message.deliveredTurnId,
      messages: [],
    };
  s.phone.threads[npcId].messages.push(message);
}
export function chatMessages(row: ChatExchange, turnId: string): PhoneMessage[] {
  const shared = { at: row.at, source: 'chat' as const, medium: 'text' as const, sourceTurnId: row.baseTurnId, deliveredTurnId: turnId };
  const outgoing: PhoneMessage = { ...shared, id: row.id, sender:'protagonist', text:row.text, chatOutcome:row.reply.status,
    status: row.reply.status === 'replied' ? 'read' : row.reply.status === 'unread' ? 'delivered' : 'read_unanswered' };
  return row.reply.status === 'replied'
    ? [outgoing, { ...shared, id:row.id + ':reply', sender:'npc', text:row.reply.text }] : [outgoing];
}
// Project the frozen transcript before model commands. Only commitTurn persists this private copy.
export function chatBase(state: GameState, rows: readonly PhoneOperation[], turnId: string): GameState {
  if (!rows.length) return state;
  const next = { ...state, phone: structuredClone(state.phone) };
  for (const row of rows) {
    requireData(row.baseTurnId === state.journal.at(-1)?.turnId && Date.parse(row.at) === Date.parse(state.worldClock),
      'PHONE_TIMELINE', '待结算私聊的基准回合或游戏时间与存档不符');
    if (!isPrivate(row)) {
      appendGroup(next.phone.groups ??= {},row,turnId,state.npc);
      continue;
    }
    const peer = row.reply.npcId;
    requireData(Object.hasOwn(state.npc, peer), 'PHONE_CONFLICT', '待结算私聊引用的人物不存在');
    for (const message of chatMessages(row, turnId)) append(next, peer, message);
  }
  requireData(validPhone(next), 'PHONE_CONFLICT', '私聊消息 ID 或会话引用冲突');
  return next;
}
// Check the same projection as settlement without persisting it during save management.
export function validatePendingChat(state: GameState, draft?: Pick<TurnDraft, 'phonePending' | 'turnId'>) {
  if (draft?.phonePending?.length) chatBase(state, draft.phonePending, draft.turnId);
}
export function recordPhone(
  s: GameState,
  npcId: string,
  value: z.infer<typeof StoryPhoneInput>,
  turnId: string,
  pendingClock: boolean,
) {
  requireData(Object.hasOwn(s.npc, npcId), 'NOT_FOUND', '消息引用的人物不存在');
  requireData(
    value.sender === 'protagonist' || !value.status,
    'PHONE_STATUS',
    '送达状态仅适用于主角发出的消息',
  );
  const prior = findMessage(s, value.messageId);
  if (prior) {
    const m = prior.message;
    requireData(
      prior.npcId === npcId &&
        m.sender === value.sender &&
        m.medium === value.medium &&
        m.text === value.text &&
        (!value.status || m.status === value.status) &&
        (!value.at || Date.parse(m.at) === Date.parse(value.at)),
      'PHONE_CONFLICT',
      '消息 ID 已属于另一条消息',
    );
    return;
  }
  requireData(
    !s.phone.scheduled.some((m) => m.messageId === value.messageId),
    'PHONE_CONFLICT',
    '此来信尚未投递',
  );
  const at = value.at ?? s.worldClock;
  requireData(
    pendingClock || Date.parse(at) <= Date.parse(s.worldClock),
    'PHONE_TIME',
    '正文消息不能晚于结束时钟',
  );
  append(s, npcId, {
    id: value.messageId,
    sender: value.sender,
    medium: value.medium,
    text: value.text,
    ...(value.sender === 'protagonist' ? { status: value.status ?? 'delivered' } : {}),
    at,
    source: 'story',
    sourceTurnId: turnId,
    deliveredTurnId: turnId,
  });
}
export function schedulePhone(s: GameState, value: z.infer<typeof ScheduledPhoneInput>, turnId: string) {
  const { messageId, npcId, dueAt, text } = value;
  requireData(
    Object.hasOwn(s.npc, npcId) && !s.npc[npcId].onScene,
    'PHONE_TARGET',
    '场外来信须引用已离场人物',
  );
  const prior = s.phone.scheduled.find((m) => m.messageId === messageId);
  const sent = findMessage(s, messageId);
  if (prior || sent) {
    requireData(
      prior
        ? prior.npcId === npcId && prior.text === text && Date.parse(prior.dueAt) === Date.parse(dueAt)
        : sent?.npcId === npcId &&
            sent.message.source === 'offscreen' &&
            sent.message.text === text &&
            Date.parse(sent.message.at) === Date.parse(dueAt),
      'PHONE_CONFLICT',
      '来信 ID 已属于另一条消息',
    );
    return;
  }
  requireData(Date.parse(dueAt) >= Date.parse(s.worldClock), 'PHONE_TIME', '投递时间不能早于本回合结束');
  s.phone.scheduled.push({ messageId, npcId, dueAt, text, sourceTurnId: turnId });
}
// Only the formal settlement calls this on its private projection, immediately before the journal is appended.
export function deliverPhone(s: GameState, turnId: string) {
  const now = Date.parse(s.worldClock);
  const due = s.phone.scheduled
    .filter((m) => Date.parse(m.dueAt) <= now)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  for (const m of due)
    append(s, m.npcId, {
      id: m.messageId,
      sender: 'npc',
      medium: 'text',
      text: m.text,
      at: m.dueAt,
      source: 'offscreen',
      sourceTurnId: m.sourceTurnId,
      deliveredTurnId: turnId,
    });
  if (due.length) s.phone.scheduled = s.phone.scheduled.filter((m) => Date.parse(m.dueAt) > now);
}
