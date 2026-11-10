import type { GameState } from '../domain/state';
import { rawNpcMemories } from '../domain/memories/npcMemory';
import { recallJournal } from '../domain/memories/recall';
import type { RecallCues } from '../domain/memories/recall';

/** 三阶段共用的模型只读背景。调用方决定正式基线或合法 Variables 投影；
 * 阅读范围不参与任何命令授权。永久 journal 保持现有窗口/检索，幂等凭据不注入。 */
export function sharedContext(state: GameState, windowSize: number, query: string, recall: boolean, cues: RecallCues = { stage: 'story', playerInput: query }) {
  const { journal, appliedCommands, dormantNpcProfiles, ...snapshot } = state;
  void appliedCommands;
  void dormantNpcProfiles; // Persistence-only: not author context, knowledge, retrieval or summary input.
  const memory = recallJournal(state, windowSize, cues, recall);
  const recent = journal.slice(-windowSize);
  return {
    SAVE_STATE: { ...snapshot, worldClock: state.openingTimePending ? null : state.worldClock },
    MEMORY_CONTEXT: {
      ...memory,
      immediateWindowSize: windowSize,
      // 分层与NPC记忆已经完整位于SAVE_STATE；召回只补journal经过，不重抄摘要。
      summaries: [],
      summarySource: 'SAVE_STATE.memories',
      summaryPolicy: '全部正式分层/NPC记忆保留在SAVE_STATE；同一sourceTurnId在近期正文、旧史原文与多层总结中表示同一来源，不是多次独立事件，不重新记账。',
      // 完整已提交 Story，包括变量指导和行动选项；当前候选只在 STORY_RESULT 中。
      recentTurns: recent.map((entry, index) => ({
        turnId: entry.turnId,
        turnNumber: journal.length - recent.length + index + 1,
        revision: entry.revision,
        relatedActorRefs: entry.relatedActorRefs,
        ...entry.story,
      })),
    },
    NPC_KNOWLEDGE: Object.values(state.npc).map((npc) => ({
      ownerNpcId: npc.id,
      raw: rawNpcMemories(npc),
      summaries: state.memories.npcSummaries[npc.id] ?? [],
      knownInformation: npc.knownInformation,
    })),
    NPC_KNOWLEDGE_POLICY: '模型可读取全部正式世界背景；内部角色认知按ownerNpcId归属，阅读不授予主角或其他NPC知识。亲历、转述、推测及可见性标记保留；总结是历史认知，较新原始记忆中的纠正优先。初始同伴缺少affinityConfirmed时，好感数值仍是未确认占位。客观事件、参与者列表和历史记录不表示每个人已经知晓。Story以全局作者视角保持因果连续，人物言行与叙事披露仍须符合各自知情范围，不自动泄露私人背景。完整状态仅供阅读，不扩大Variables/World命令权限；World仍遵守PROTECTED_SCENE与命令目录。',
  };
}
