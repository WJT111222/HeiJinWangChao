import { isPrivate, isGroup, participants, type PhoneOperation } from '../domain/phoneChat';
import { groupTranscript } from './phoneKnowledge';
import type { GroupThread } from '../domain/phoneGroup';
import { chatMessages } from '../domain/phone';
import type { TurnDraft } from '../domain/drafts';
import type { GameState } from '../domain/state';

export const recentCount = 8;
export function recentPhoneHistory<T extends { at: string; text: string }>(history: readonly T[]) {
  const ordered = [...history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const older = ordered.slice(0, -recentCount);
  return {
    recent: ordered.slice(-recentCount),
    ...(older.length
      ? {
          earlier: {
            count: older.length,
            from: older[0].at,
            to: older.at(-1)!.at,
            lastExcerpt: older.at(-1)!.text.slice(0, 100),
          },
        }
      : {}),
  };
}
function groupHistory(group: GroupThread) {
  return {
    groupId: group.id,
    name: group.name,
    category: group.category,
    members: group.members,
    ...recentPhoneHistory(group.history.flatMap(groupTranscript)),
  };
}
export function frozenChatContext(
  state: GameState,
  draft: TurnDraft | undefined,
  stage: 'story' | 'entities' | 'variables' | 'world',
) {
  const rows = draft?.phoneFreeze && draft.phonePending;
  if (!rows?.length) return {};
  const people = [...new Set(rows.flatMap(participants))];
  if (stage === 'variables')
    return {
      PHONE_CHAT_TIME: {
        exchanges: rows.length,
        participants: people,
        rule: '普通现场回合估算耗时时计入手机交谈，沿用本回合时钟规则。聊天中的承诺仍待履行。',
      },
    };
  if (stage === 'world') {
    const waiting = rows
      .filter(isPrivate)
      .filter(
        (row) =>
          !state.npc[row.reply.npcId]?.onScene &&
          ['later', 'read_unanswered'].includes(row.reply.status),
      )
      .map((row) => ({ npcId: row.reply.npcId, messageId: row.id, status: row.reply.status }));
    return waiting.length
      ? {
          PHONE_CHAT_FOLLOWUP: {
            waiting,
            rule: '已读未回的场外人物可视情况用 SchedulePhoneMessage 安排后续来信。结合已有排期和正文，避免重复。',
          },
        }
      : {};
  }
  return {
    PHONE_CHAT: {
      rule:
        stage === 'story'
          ? '以下聊天已发生，可概述或引用，不改写原话，不替主角继续回复。单独结束聊天的行动也要承接随后的日常。'
          : '以下原话由程序结算。只处理参与者的记忆、知情、关系和约定等后果，不重复记录这些消息。',
      // All exchanges in this turn share a clock. Preserve the freeze order across recipients.
      ...(rows.some(isGroup)
        ? {
            operationOrder: rows.map((row) => row.id),
            groupOperations: rows.filter(isGroup),
            groupParticipants: [...new Set(rows.filter(isGroup).flatMap((row) => row.audience))].map(
              (id) => ({ id, name: state.npc[id].name }),
            ),
            groupHistory: [...new Set(rows.filter(isGroup).map((row) => row.groupId))].flatMap((id) =>
              state.phone.groups?.[id] ? [groupHistory(state.phone.groups[id])] : [],
            ),
            groupRule:
              '群中可见的发言、邀请与成员变化已发生。正文承接群成员相见的反应，人物阶段按实际接触记录各自知情与记忆，未读内容不作已知。按回执顺序处理退群，不补发缺席期间的发言，不把群外秘密传播给他人。',
          }
        : {}),
      frozenMessages: rows
        .filter(isPrivate)
        .flatMap((row) =>
          chatMessages(row, draft!.turnId).map((message) => ({ npcId: row.reply.npcId, ...message })),
        ),
      threads: [...new Set(rows.filter(isPrivate).map((row) => row.reply.npcId))].map((npcId) => ({
        npcId,
        name: state.npc[npcId].name,
        ...recentPhoneHistory(state.phone.threads[npcId]?.messages ?? []),
      })),
    },
  };
}
export function phoneContext(
  state: GameState,
  stage: 'story' | 'entities' | 'world',
  text: string,
  frozen: readonly PhoneOperation[] = [],
) {
  const frozenPeers = new Set(frozen.filter(isPrivate).map(row => row.reply.npcId));
  const frozenGroups = new Set(frozen.filter(isGroup).map(row => row.groupId));
  const lastTurn = state.journal.at(-1)?.turnId;
  const scheduled = stage === 'world' ? state.phone.scheduled : [];
  const pendingPeers = new Set(scheduled.map((m) => m.npcId));
  const threads = Object.values(state.phone.threads).flatMap((thread) => {
    const npc = state.npc[thread.npcId];
    if (frozenPeers.has(npc.id)) return []; // Included once in PHONE_CHAT with the same history window.
    const incoming = thread.messages.some((m) => m.sender === 'npc' && m.deliveredTurnId === lastTurn);
    const mentioned = [npc.name, ...npc.aliases].some((name) => name && text.includes(name));
    const awaiting = thread.messages.at(-1)?.status === 'read_unanswered';
    if (
      stage === 'world'
        ? npc.onScene || !(pendingPeers.has(npc.id) || mentioned || incoming || awaiting)
        : !(npc.onScene || mentioned || incoming)
    )
      return [];
    return [{ npcId: npc.id, name: npc.name, ...recentPhoneHistory(thread.messages) }];
  });
  if (stage === 'world')
    return {
      PHONE_INBOX: {
        appearedNpcIds: Object.values(state.npc)
          .filter((n) => n.appearedInStory && !n.onScene)
          .map((n) => n.id),
        scheduled: scheduled.map(({ messageId, npcId, dueAt }) => ({ messageId, npcId, dueAt })),
        threads,
        rule: '只有在正文出场或被提及过的场外人物才可以主动来信。按需要安排私下来信，复用既有消息 ID，不重复排期。dueAt 不早于本回合结束，可等于结束时钟。',
      },
    };
  const groups = Object.values(state.phone.groups ?? {})
    .filter((group) => !frozenGroups.has(group.id) && text.includes(group.name))
    .map(groupHistory);
  return {
    PHONE_STORY: {
      threads,
      ...(groups.length ? { groups } : {}),
      rule:
        stage === 'story'
          ? '可自然承接已收到的消息与通话。只有玩家行动明确授权，才替主角回复；未授权可停在来信处。'
          : '只记录正文已发生的消息和通话，尽量保留原话与方向。已存同一条复用消息 ID，不重复记录，不把阅读当成回复。',
    },
  };
}
