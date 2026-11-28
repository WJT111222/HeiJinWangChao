import { z } from 'zod';
import { GameTimeSchema, IdSchema, IdsSchema, requireData } from './common';
import type { GameState } from './state';

export const groupTypes = ['家庭', '后宫', '工作', '自定义'] as const;
export const GroupAction = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create'),
    name: z.string().trim().min(1),
    category: z.enum(groupTypes),
    invitees: IdsSchema,
  }),
  z.strictObject({ type: z.literal('invite'), invitees: IdsSchema }),
  z.strictObject({ type: z.literal('message'), text: z.string().min(1) }),
  z.strictObject({ type: z.literal('leave') }),
]);
export type GroupAction = z.infer<typeof GroupAction>;
export const GroupOutcome = z.discriminatedUnion('status', [
  z.strictObject({ npcId: IdSchema, status: z.literal('replied'), text: z.string().min(1) }),
  z.strictObject({
    npcId: IdSchema,
    status: z.enum(['joined', 'refused', 'left', 'read_unanswered', 'later', 'unread']),
  }),
]);
export const GroupExchange = z.strictObject({
  kind: z.literal('group'),
  id: z.uuid(),
  groupId: z.uuid(),
  at: GameTimeSchema,
  baseTurnId: IdSchema,
  action: GroupAction,
  audience: IdsSchema,
  outcomes: z.array(GroupOutcome),
});
export type GroupExchange = z.infer<typeof GroupExchange>;
export const GroupThread = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  category: z.enum(groupTypes),
  members: IdsSchema,
  playerLeft: z.boolean(),
  history: z.array(GroupExchange.extend({ turnId: IdSchema })).min(1),
});
export type GroupThread = z.infer<typeof GroupThread>;

export function groupAudience(group: GroupThread | undefined, action: GroupAction) {
  if (action.type === 'create') return action.invitees;
  return [...(group?.members ?? []), ...(action.type === 'invite' ? action.invitees : [])];
}

export function appendGroup(
  groups: Record<string, GroupThread>,
  row: GroupExchange,
  turnId: string,
  npc: GameState['npc'],
) {
  const { groupId, action, outcomes } = row;
  let group = groups[groupId];
  const create = action.type === 'create';
  requireData(
    create ? !group && groupId === row.id : group && !group.playerLeft,
    'PHONE_CONFLICT',
    '群聊或成员状态已变化',
  );
  const inviting = action.type === 'create' || action.type === 'invite';
  const audience = groupAudience(group, action);
  requireData(
    audience.length === row.audience.length &&
      audience.every((id, i) => Object.hasOwn(npc, id) && id === row.audience[i]),
    'PHONE_CONFLICT',
    '群成员清单与操作不符',
  );
  const recipients = inviting ? action.invitees : action.type === 'message' ? audience : [];
  requireData(
    new Set(audience).size === audience.length && (!inviting || recipients.length >= (create ? 2 : 1)),
    'PHONE_CONFLICT',
    '邀请人数不足或成员重复',
  );
  requireData(
    outcomes.length === recipients.length &&
      new Set(outcomes.map((o) => o.npcId)).size === outcomes.length &&
      outcomes.every(
        (o) =>
          recipients.includes(o.npcId) && inviting === (o.status === 'joined' || o.status === 'refused'),
      ),
    'PHONE_CONFLICT',
    '群聊回执与接收人不匹配',
  );
  if (create)
    group = groups[groupId] = {
      id: groupId,
      name: action.name,
      category: action.category,
      members: [],
      playerLeft: false,
      history: [],
    };
  for (const o of outcomes) {
    if (o.status === 'joined') group.members.push(o.npcId);
    if (o.status === 'left') group.members = group.members.filter((id) => id !== o.npcId);
  }
  if (action.type === 'leave') group.playerLeft = true;
  group.history.push({ ...row, turnId });
}

export function groupIds(row: GroupExchange) {
  return [row.id, ...row.outcomes.map((_, i) => row.id + ':' + i)];
}

export function groupLabel(action: GroupAction) {
  switch (action.type) {
    case 'create':
      return '建立了「' + action.name + '」';
    case 'invite':
      return '邀请成员加入群聊';
    case 'message':
      return action.text;
    case 'leave':
      return '退出了群聊';
  }
}
