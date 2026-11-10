import type { GameState } from '../domain/state';
import { npcContext } from './npcContext';
import { recallJournal } from '../domain/memories/recall';
import type { RecallCues } from '../domain/memories/recall';

/** 三阶段共用的模型只读背景。调用方决定正式基线或合法 Variables 投影；
 * 阅读范围不参与任何命令授权。永久 journal 保持现有窗口/检索，幂等凭据不注入。 */
export function sharedContext(state: GameState, windowSize: number, query: string, recall: boolean, cues: RecallCues = { stage: 'story', playerInput: query }) {
  const { journal, appliedCommands, dormantNpcProfiles, npc, memories, ...snapshot } = state;
  void npc;
  void appliedCommands;
  void dormantNpcProfiles; // Persistence-only: not author context, knowledge, retrieval or summary input.
  const memory = recallJournal(state, windowSize, cues, recall);
  const recent = journal.slice(-windowSize);
  const sources=new Set([...recent.map(t=>t.turnId),...memory.recalledTurns.map(t=>t.turnId)]);
  const people=npcContext(state,cues,sources);
  return {
    SAVE_STATE: { ...snapshot, npc:people.npc, memories:{...memories,npcSummaries:people.npcSummaries}, worldClock: state.openingTimePending ? null : state.worldClock },
    MEMORY_CONTEXT: {
      ...memory,
      immediateWindowSize: windowSize,
      // 分层记忆与人物只读投影仅位于SAVE_STATE；召回只补journal经过，不重抄摘要。
      summaries: [],
      summarySource: 'SAVE_STATE.memories',
      summaryPolicy: '分层记忆完整保留，人物记忆按NPC_CONTEXT只读投影；同一sourceTurnId在近期正文、旧史原文与多层总结中表示同一来源，不是多次独立事件，不重新记账。',
      // 完整已提交 Story，包括变量指导和行动选项；当前候选只在 STORY_RESULT 中。
      recentTurns: recent.map((entry, index) => ({
        turnId: entry.turnId,
        turnNumber: journal.length - recent.length + index + 1,
        revision: entry.revision,
        relatedActorRefs: entry.relatedActorRefs,
        ...entry.story,
      })),
    },
    NPC_CONTEXT: people.index,
    NPC_KNOWLEDGE_POLICY: '人物资料以SAVE_STATE.npc稳定ID归属，总结以SAVE_STATE.memories.npcSummaries同ID归属；模型可读取世界作者背景，分层不授予其他角色知识，阅读不授予主角或其他NPC知识。亲历、转述、推测及可见性标记保留；总结是历史认知，较新原始记忆中的纠正优先。初始同伴缺少affinityConfirmed时，好感数值仍是未确认占位。客观事件、参与者列表和历史记录不表示每个人已经知晓。Story以全局作者视角保持因果连续，人物言行与叙事披露仍须符合各自知情范围，不自动泄露私人背景。完整状态仅供阅读，不扩大Variables/World命令权限；World仍遵守PROTECTED_SCENE与命令目录。',
  };
}
