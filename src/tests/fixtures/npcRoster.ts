import { GameStateSchema } from '../../domain/state';
import { npcV2State } from './npcV2';
import { npc, task } from './game';
import { fullPrivateProfile } from './npcUnified';

/** Fully synthetic roster: current and original identities are not player data. */
export function npcRosterState() {
  const state = npcV2State();
  state.revision = state.turnNumber = 10;
  state.journal = Array.from({ length: 10 }, (_, i) => ({ turnId: `roster-turn-${i}`, revision: i + 1,
    story: { turnKind: i ? 'regular' as const : 'opening' as const, narrative: `【旁白】第${i + 1}回合的工作与交流。`, summary: '工作与交流', variableGuide: [] }, relatedActorRefs: [] }));
  state.npc.person = { ...state.npc.person, aliases: ['阿澄'], onScene: true, age: 29, gender: 'male',
    identity: '设计师', appearance: '深色外套', temperament: '耐心', skills: ['绘图', '沟通'],
    background: '在社区中长大，工作后与家人保持联系。\n' + '假日会修理旧家具，平时认真维护合作关系。'.repeat(30),
    healthText: '身体良好', lastInteractionAt: state.worldClock };
  state.npc.special = { ...state.npc.special, kind: 'special', identity: '工作室负责人', affinity: 0,
    detailedBackground: '在沿江社区成长，学习设计，后来经营工作室。\n' + '始终与家人和旧友保持联系。'.repeat(30),
    activeGoals: ['完成长期合作'], habits: ['记录灵感'], longTermMemories: [], offscreenTaskIds: [], privateProfile: { ...fullPrivateProfile } };
  state.tasks['roster-duty'] = { ...task('roster-duty'), actorRef: { kind: 'npc', id: 'special' }, goal: '维护正式合作记录与工作室安排' };
  // The stored relationship can use an old alias; its stable ID still names 林澄.
  if (state.npc.special.kind === 'special') state.npc.special.relationshipNetwork![0].name = '阿澄';
  state.initialCompanionId = 'special'; // Legacy unconfirmed affinity stays unknown.
  state.npc.other = { ...npc('other'), name: '周闻', identity: '记者', onScene: false, phoneContact: { status: 'invalid', note: '旧联系途径已停用' } };
  const owner = state.npc.special;
  owner.memories = [0, 1].map(i => ({ id: `roster-memory-${i}`, text: `本人参与第${i + 1}次合作。\n保留完整原文与心理变化。`,
    sourceTurnIds: [`roster-turn-${i}`], affectedEntityRefs: [{ kind: 'npc' as const, id: owner.id }],
    visibility: 'npc_private' as const, knowledgeKind: 'observed' as const, knowledgeSource: '本人亲历', createdAtGameTime: state.worldClock }));
  state.memories.npcSummaries.special = [{ id: 'roster-summary', text: '她回顾合作过程，珍惜信任，但仍有顾虑。',
    sourceTurnIds: ['roster-turn-0', 'roster-turn-1'], affectedEntityRefs: [{ kind: 'npc', id: owner.id }], visibility: 'npc_private', createdAtGameTime: state.worldClock,
    npcProvenance: { npcId: owner.id, identityKey: owner.identityKey, sourceMemoryIds: owner.memories.map(m => m.id), sourceVisibility: 'npc_private', knowledgeKind: 'observed' } }];
  state.contactNpcIds = ['person']; // Does not imply known phone details.
  return GameStateSchema.parse(state);
}
