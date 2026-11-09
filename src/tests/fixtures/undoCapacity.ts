import { GameStateSchema } from '../../domain/state';
import { historyState } from './history';
import { npc, gameTime } from './game';

/** Deterministic synthetic data only. Not a migration or a player-save generator. */
export function undoCapacityState(turns: number, npcCount: number, narrativeChars = 6000) {
  const state = historyState(turns);
  const text = (label: string, length: number) => {
    const unit = `${label}：合成生活经历和人物资料，仅供容量测试。`;
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };
  state.npc = {};
  for (let i = 0; i < npcCount; i++) {
    const id = `npc-${i}`;
    state.npc[id] = { ...npc(id), onScene: false, background: text(id, 4000), memories: [] };
  }
  state.memories.short = [];
  state.journal.forEach((entry, index) => {
    entry.relatedActorRefs = [];
    entry.story.narrative = text(entry.turnId, narrativeChars);
    entry.story.summary = text(`摘要${index}`, 300);
    if (index >= turns - 30) state.memories.short.push({ id: `public-${index}`, text: entry.story.summary,
      sourceTurnIds: [entry.turnId], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: gameTime });
    for (let j = 0; j < 3; j++) {
      const person = state.npc[`npc-${(index * 3 + j) % npcCount}`];
      person.memories.push({ id: `memory-${index}-${j}`, text: text(`经历${index}-${j}`, 450),
        sourceTurnIds: [entry.turnId], affectedEntityRefs: [{ kind: 'npc', id: person.id }], visibility: 'npc_private',
        createdAtGameTime: gameTime, knowledgeKind: 'observed', knowledgeSource: '合成亲历' });
    }
    for (let j = 0; j < 8; j++) state.appliedCommands.push({ turnId: entry.turnId, commandId: `command-${j}`,
      fingerprint: JSON.stringify({ syntheticMeasurement: true, text: text(`命令${index}-${j}`, 350) }) });
  });
  return GameStateSchema.parse(state);
}
