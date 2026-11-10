import { GameStateSchema } from '../../domain/state';
import { NpcMemoryBatchSchema, npcSummaryInput, parseNpcSummary } from '../../domain/memories/npcMemory';
import { npc, task, event } from './game';
import { npcRosterState } from './npcRoster';

/** Deterministic, invented long-running world. No player exports or model calls. */
export function npcAcceptanceState(count = 30, turns = 100) {
  const state = npcRosterState();
  state.revision = state.turnNumber = turns;
  state.journal = Array.from({ length: turns }, (_, i) => ({ turnId: `roster-turn-${i}`, revision: i + 1,
    relatedActorRefs: [{ kind: 'npc' as const, id: 'special' }],
    story: { turnKind: i ? 'regular' as const : 'opening' as const,
      narrative: `【旁白】第${i + 1}日的社区工作。` + '人物各自处理工作、家庭与日常安排，按约保持联系。'.repeat(8),
      summary: `社区工作记录${i + 1}`, variableGuide: [] } }));
  for (let i = 3; i < count; i++) {
    const id = `citizen-${i}`;
    const base = { ...npc(id), name: `合成人物${i}`, aliases: [`合成别名${i}`], identity: `社区职业${i % 7}`,
      onScene: i % 4 < 2, background: '在本地成长，工作后维持家庭和朋友关系。'.repeat(4),
      appearance: '日常工作装束', temperament: '保持自己的判断',
      memories: Array.from({ length: i % 5 === 0 ? 8 : 2 }, (_, j) => ({ id: `${id}-memory-${j}`,
        text: `人物${i}第${j + 1}次参与工作交流，确认各自职责。`, knowledgeKind: 'observed' as const,
        knowledgeSource: '本人亲历', visibility: 'npc_private' as const, createdAtGameTime: state.worldClock,
        sourceTurnIds: [`roster-turn-${j}`], affectedEntityRefs: [{ kind: 'npc' as const, id }] })) };
    state.npc[id] = i % 5 === 0 ? { ...base, kind: 'special', detailedBackground: '完成学业后从事社区工作，重视家庭与承诺。'.repeat(6),
      activeGoals: ['完成现有合作'], habits: ['整理工作记录'], longTermMemories: [], offscreenTaskIds: [] } : base;
    if (i % 10 === 0) {
      const t = task(`${id}-task`);
      state.tasks[t.id] = { ...t, actorRef: { kind: 'npc', id }, status: 'active', dueAt: new Date(Date.parse(state.worldClock) + 3600000).toISOString() };
      state.organizations[`cooperative-${i}`] = { id: `cooperative-${i}`, kind: 'business', name: `合成合作社${i}`,
        description: '在社区中提供日常服务与合作机会', protagonistRelation: '尚无正式往来', relationHistory: [], keyNpcIds: [id], currentTaskIds: [], sectors: ['社区服务'], businessRelations: [] };
      state.events[`${id}-event`] = { ...event(`${id}-event`), title: `人物${i}合作安排`, status: 'active', impact: 'minor',
        estimatedEndAt: new Date(Date.parse(state.worldClock) + 7200000).toISOString(),
        actorRefs: [{ kind: 'npc', id }], sourceTurnIds: ['roster-turn-0'] };
    }
  }
  state.npc.special.memories = Array.from({ length: 42 }, (_, i) => ({ id: `long-memory-${i}`, text: `合成长期经历${i + 1}。\n本人在社区工作中逐渐理解合作与独立判断。`,
    sourceTurnIds: [`roster-turn-${i % turns}`], affectedEntityRefs: [{ kind: 'npc' as const, id: 'special' }], knowledgeKind: 'observed' as const,
    knowledgeSource: '本人亲历', visibility: 'npc_private' as const, createdAtGameTime: state.worldClock }));
  state.memories.npcSummaries.special = [0, 1].flatMap(i => {
    const batch = NpcMemoryBatchSchema.parse({ saveId: state.saveId, saveCreatedAt: state.createdAt, npcId: 'special',
      identityKey: state.npc.special.identityKey, entries: state.npc.special.memories.slice(i * 15, i * 15 + 15), expectedCount: 15 });
    return parseNpcSummary(JSON.stringify({ summaries: npcSummaryInput(batch).groups.map(g => ({ groupId: g.groupId, text: `第${i + 1}批工作经历与心理变化。` })), unresolved: [], contradictions: [] }), batch, `long-summary-${i}`);
  });
  state.timeline = [{ id: 'community-history', title: '社区工作室成立', summary: '合成人物共同建立工作室。', occurredAt: state.worldClock,
    recordedAt: state.worldClock, sourceTurnId: 'roster-turn-0', knowledgeKind: 'established', actorRefs: [{ kind: 'npc', id: 'special' }], relatedEntryIds: [] }];
  return GameStateSchema.parse(state);
}
