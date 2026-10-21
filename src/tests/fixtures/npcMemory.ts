import { GameStateSchema } from '../../domain/state';
import { NpcMemorySchema } from '../../domain/memories/schema';
import { npcSummaryInput } from '../../domain/memories/npcMemory';
import type { NpcMemoryBatch } from '../../domain/memories/npcMemory';
import { npc, gameTime } from './game';
import { historyState } from './history';

// 仅测试使用：秘密人物/经历不能进入正式创角或普通玩家资料。
export function npcMemoryState(count = 21, special = false) {
  const state = historyState(count);
  state.journal.forEach((entry) => { entry.relatedActorRefs = []; }); // 场外秘密人物尚未向主角公开。
  const memories = Array.from({ length: count }, (_, index) => NpcMemorySchema.parse({
    id: `npc-a-memory-${index + 1}`, text: `A的私人经历${index + 1}，保管只有自己知道的钥匙。`,
    sourceTurnIds: [`history-${index + 1}`], affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }],
    createdAtGameTime: new Date(Date.parse(gameTime) - (count - index) * 60000).toISOString(),
    visibility: 'npc_private', knowledgeKind: 'observed', knowledgeSource: '自己的亲身观察',
  }));
  const person = { ...npc(), name: '未公开人物A', onScene: false, memories };
  state.npc['npc-a'] = special ? { ...person, kind: 'special', detailedBackground: '不应发给维护模型的背景秘密',
    activeGoals: ['整理诊室'], habits: [], memories: memories.filter((_, index) => index % 2 === 0), longTermMemories: memories.filter((_, index) => index % 2 === 1), offscreenTaskIds: [] } : person;
  state.npc['npc-b'] = { ...npc('npc-b'), name: '未公开人物B', onScene: false, memories: [{ ...memories[0], id: 'b-memory',
    text: 'B的独占秘密不可进入A的总结', sourceTurnIds: [], affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }] }] };
  return GameStateSchema.parse(state);
}
export function npcSummaryOutput(batch: NpcMemoryBatch) {
  return { summaries: npcSummaryInput(batch).groups.map((group) => ({ groupId: group.groupId, text: `本组经历与未了约定被保留，认知性质为${group.knowledgeKind}。` })), unresolved: [], contradictions: [] };
}
