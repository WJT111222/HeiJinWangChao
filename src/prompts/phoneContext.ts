import type { GameState } from '../domain/state';

const recentCount = 8;
export function phoneContext(state: GameState, stage: 'story' | 'entities' | 'world', text: string) {
  const lastTurn = state.journal.at(-1)?.turnId;
  const scheduled = stage === 'world' ? state.phone.scheduled : [];
  const pendingPeers = new Set(scheduled.map((m) => m.npcId));
  const threads = Object.values(state.phone.threads).flatMap((thread) => {
    const npc = state.npc[thread.npcId];
    const incoming = thread.messages.some((m) => m.sender === 'npc' && m.deliveredTurnId === lastTurn);
    const mentioned = [npc.name, ...npc.aliases].some((name) => name && text.includes(name));
    const awaiting = thread.messages.at(-1)?.status === 'read_unanswered';
    if (
      stage === 'world'
        ? npc.onScene || !(pendingPeers.has(npc.id) || mentioned || incoming || awaiting)
        : !(npc.onScene || mentioned || incoming)
    )
      return [];
    const messages = [...thread.messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const older = messages.slice(0, -recentCount);
    return [
      {
        npcId: npc.id,
        name: npc.name,
        recent: messages.slice(-recentCount),
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
      },
    ];
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
  return {
    PHONE_STORY: {
      threads,
      rule:
        stage === 'story'
          ? '可自然承接已收到的消息与通话。只有玩家行动明确授权，才替主角回复；未授权可停在来信处。'
          : '只记录正文已发生的消息和通话，尽量保留原话与方向。已存同一条复用消息 ID，不重复记录，不把阅读当成回复。',
    },
  };
}
