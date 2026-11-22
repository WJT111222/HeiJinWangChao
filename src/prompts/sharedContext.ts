import { householdContext } from '../domain/harem/projection';
import { currentStanding } from '../domain/harem/schema';

// 只在存在现役成员时注入；地位、加入退出、妊娠与子女仍只属于 Variables。
const HAREM_WORLD_POLICY = '后宫成员也是世界里的人：场外安排其行动时须符合其后宫身份、地位、妊娠与子女状况，不写与之矛盾的后台剧情。World只能用ApplyHaremBackground推进离场成员的重要计划（plan）、离场成员之间的关系（pair）和家庭总体局势（overview）；在场成员与本回合Variables已写的同一项不碰。地位、加入退出、妊娠、子女与亲子知情只由Variables在剧情中写入。没有实质场外变化就不写。';
import type { GameState } from '../domain/state';
import { npcContext } from './npcContext';
import { recallJournal } from '../domain/memories/recall';
import type { RecallCues } from '../domain/memories/recall';
import { talentContext } from './talentContext';

/** 普通笔记只供当轮 Variables。旧草稿保留原有结构化上下文。 */
export function storyForSubsequentStages(story: GameState['journal'][number]['story']) {
  const { variableGuideRaw, variableGuideRawTruncated, variableGuideReferences, ...facts } = story;
  void variableGuideRawTruncated;
  void variableGuideReferences;
  if (variableGuideRaw !== undefined)
    facts.variableGuide = facts.variableGuide.filter(guide => guide.eventInteraction || guide.eventNarration ||
      (guide.group === 'time' && guide.subjectHint === 'time:retrospective'));
  return facts;
}

/** 三阶段共用的模型只读背景。调用方决定正式基线或合法 Variables 投影；
 * 阅读范围不参与任何命令授权。永久 journal 保持现有窗口/检索，幂等凭据不注入。 */
export function sharedContext(state: GameState, windowSize: number, query: string, recall: boolean, cues: RecallCues = { stage: 'story', playerInput: query }) {
  const { harem, journal, appliedCommands, dormantNpcProfiles, npc, memories, ...snapshot } = state;
  void npc;
  void appliedCommands;
  void dormantNpcProfiles; // Persistence-only: not author context, knowledge, retrieval or summary input.
  const memory = recallJournal(state, windowSize, cues, recall);
  const recent = journal.slice(-windowSize);
  const sources=new Set([...recent.map(t=>t.turnId),...memory.recalledTurns.map(t=>t.turnId)]);
  const people=npcContext(state,cues,sources);
  const talent = talentContext(state.protagonist.talentId, cues.stage);
  const householdPolicy = harem && cues.stage === 'world' && Object.values(harem.members).some(m => currentStanding(m) !== null) ? HAREM_WORLD_POLICY : undefined;
  return {
    ...(talent ? { PROTAGONIST_TALENT: talent } : {}),
    ...(householdPolicy ? { HAREM_WORLD_POLICY: householdPolicy } : {}),
    SAVE_STATE: { ...snapshot, ...(harem ? {harem:householdContext(harem,state.npc,cues.stage!=='story',query)} : {}), npc:people.npc, memories:{...memories,npcSummaries:people.npcSummaries}, worldClock: state.openingTimePending ? null : state.worldClock },
    MEMORY_CONTEXT: {
      ...memory,
      immediateWindowSize: windowSize,
      // 分层记忆与人物只读投影仅位于SAVE_STATE；召回只补journal经过，不重抄摘要。
      summaries: [],
      summarySource: 'SAVE_STATE.memories',
      summaryPolicy: '分层记忆完整保留，人物记忆按NPC_CONTEXT只读投影；同一sourceTurnId在近期正文、旧史原文与多层总结中表示同一来源，不是多次独立事件，不重新记账。',
      // 普通坏项原文只供生成当轮 Variables，和历史事实、检索材料分开。
      recentTurns: recent.map((entry, index) => {
        return { turnId: entry.turnId, turnNumber: journal.length - recent.length + index + 1,
          revision: entry.revision, relatedActorRefs: entry.relatedActorRefs, ...storyForSubsequentStages(entry.story) };
      }),
    },
    NPC_CONTEXT: people.index,
    NPC_KNOWLEDGE_POLICY: '人物资料以SAVE_STATE.npc稳定ID归属，总结以SAVE_STATE.memories.npcSummaries同ID归属；模型可读取世界作者背景，分层不授予其他角色知识，阅读不授予主角或其他NPC知识。亲历、转述、推测及可见性标记保留；总结是历史认知，较新原始记忆中的纠正优先。初始同伴缺少affinityConfirmed时，好感数值仍是未确认占位。客观事件、参与者列表和历史记录不表示每个人已经知晓。Story以全局作者视角保持因果连续，人物言行与叙事披露仍须符合各自知情范围，不自动泄露私人背景。完整状态仅供阅读，不扩大Variables/World命令权限；World仍遵守PROTECTED_SCENE与命令目录。',
  };
}
