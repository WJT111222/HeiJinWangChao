import { expect, it } from 'vitest';
import { planNpcSummary, parseNpcSummary, applyNpcSummary, npcSummaryCandidates } from '../domain/memories/npcMemory';
import { planCompression } from '../domain/memories/compression';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { compressionState } from './fixtures/compression';
it('NPC在20条触发，准确处理15条且保留全部原始来源和5条活跃记忆', () => {
  const state = npcMemoryState(20), batch = planNpcSummary(state, 'npc-a');
  expect(batch?.entries).toHaveLength(15);
  const result = parseNpcSummary(JSON.stringify(npcSummaryOutput(batch!)), batch!, 'v2');
  const after = applyNpcSummary(state, batch!, result);
  expect(after.npc).toEqual(state.npc);
  expect(npcSummaryCandidates(after, 'npc-a')).toHaveLength(5);
});
it('完整公共批次超预算时整批失败，不能默默改小', () => {
  const state = compressionState();
  state.memories.short.forEach(entry => { entry.text = '完整的真实历史'.repeat(300); });
  expect(() => planCompression(state)).toThrow();
});
