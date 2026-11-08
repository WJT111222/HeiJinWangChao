import { GameStateSchema } from '../../domain/state';
import { contextV2Fixture } from './contextV2';
import { npc, task, event, organizations } from './game';

/** Synthetic stress data, not a player save or a prediction of production growth. */
export function contextScaleFixture(count: number) {
  const a = contextV2Fixture();
  const baseMemory = a.state.npc['scene-ordinary'].memories[0];
  const existingNpcCount = Object.keys(a.state.npc).length;
  for (let i = 0; i < count - existingNpcCount; i++) {
    const id = `scale-npc-${i}`;
    const memory = { ...baseMemory, id: `${id}-memory`,
      text: `合成记忆${i}：${'已确认经历与后续约定。'.repeat(12)}`, affectedEntityRefs: [{ kind: 'npc' as const, id }] };
    a.state.npc[id] = { ...npc(id), kind: 'special', detailedBackground: '合成完整档案', activeGoals: [], habits: [], offscreenTaskIds: [], onScene: i % 3 === 0, background: `合成档案${i}：${'完整背景。'.repeat(24)}`,
      memories: [memory], longTermMemories: [{ ...memory, id: `${id}-long` }] };
    a.state.memories.npcSummaries[id] = [{ id: `${id}-summary`, text: memory.text, sourceTurnIds: memory.sourceTurnIds,
      affectedEntityRefs: memory.affectedEntityRefs, visibility: memory.visibility, createdAtGameTime: memory.createdAtGameTime }];
    a.state.tasks[`scale-task-${i}`] = { ...task(`scale-task-${i}`), actorRef: { kind: 'npc', id }, goal: `合成任务${i}：${'调查与交接。'.repeat(24)}` };
    a.state.events[`scale-event-${i}`] = { ...event(`scale-event-${i}`), actorRefs: [{ kind: 'npc', id }], title: `合成事件${i}`, backgroundText: '完整事件背景。'.repeat(24) };
    a.state.organizations[`scale-org-${i}`] = { ...structuredClone(organizations[0]), id: `scale-org-${i}`, name: `合成组织${i}`, description: '完整组织背景。'.repeat(24) };
    a.state.locations[`scale-location-${i}`] = { id: `scale-location-${i}`, name: `合成地点${i}` };
  }
  const journal = a.state.journal[0];
  a.state.journal = Array.from({ length: count }, (_, i) => ({ ...structuredClone(journal), turnId: `scale-turn-${i}`, revision: i + 1,
    story: { ...journal.story, narrative: `合成历史${i}：${'整理住处与日常工作。'.repeat(24)}` } }));
  a.state.revision = a.state.turnNumber = count;
  a.draft.baseSaveRevision = count;
  a.draft.variables = undefined;
  a.draft.stageStatus.variables = 'pending';
  a.state = GameStateSchema.parse(a.state);
  return a;
}
