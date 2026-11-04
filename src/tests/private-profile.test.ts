import { describe, expect, it } from 'vitest';
import { applyVariableCommand } from '../domain/variableCommands';
import type { GameState } from '../domain/state';
import { NpcSchema } from '../domain/npc/schema';

function makeState(npc: ReturnType<typeof NpcSchema.parse>): GameState {
  return {
    revision: 1,
    npc: { [npc.id]: npc },
    // minimal stubs for other required fields if tests touch them
  } as unknown as GameState;
}

describe('privateProfile via UpdateNpc', () => {
  it('creates and merges privateProfile on special female NPC without clearing other fields', () => {
    const npc = NpcSchema.parse({
      id: 'n1', identityKey: 'k1', aliases: [], name: '测试', age: 22, gender: 'female', skills: [],
      kind: 'special', detailedBackground: 'bg', activeGoals: [], habits: [],
      longTermMemories: [], offscreenTaskIds: [],
      onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
    });
    const state = makeState(npc);
    applyVariableCommand(state, {
      type: 'UpdateNpc', commandId: 'c1', evidence: 'e', expectedRevision: 1, npcId: 'n1',
      changes: { privateProfile: { chestDescription: '描述A', isVirgin: true } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n1 as any).privateProfile?.chestDescription).toBe('描述A');
    expect((state.npc.n1 as any).privateProfile?.isVirgin).toBe(true);
    expect((state.npc.n1 as any).privateProfile?.buttocksDescription).toBeUndefined();

    applyVariableCommand(state, {
      type: 'UpdateNpc', commandId: 'c2', evidence: 'e', expectedRevision: 1, npcId: 'n1',
      changes: { privateProfile: { buttocksDescription: '描述B' } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n1 as any).privateProfile?.chestDescription).toBe('描述A');
    expect((state.npc.n1 as any).privateProfile?.buttocksDescription).toBe('描述B');
  });

  it('does not overwrite existing first experience', () => {
    const npc = NpcSchema.parse({
      id: 'n2', identityKey: 'k2', aliases: [], name: '测试2', age: 20, gender: 'female', skills: [],
      kind: 'special', detailedBackground: 'bg', activeGoals: [], habits: [],
      longTermMemories: [], offscreenTaskIds: [],
      onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
      privateProfile: { firstExperienceText: '原记录', firstExperienceTarget: '原对象', isVirgin: false },
    });
    const state = makeState(npc);
    applyVariableCommand(state, {
      type: 'UpdateNpc', commandId: 'c3', evidence: 'e', expectedRevision: 1, npcId: 'n2',
      changes: { privateProfile: { firstExperienceText: '新记录', chestDescription: '新胸' } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n2 as any).privateProfile?.firstExperienceText).toBe('原记录');
    expect((state.npc.n2 as any).privateProfile?.firstExperienceTarget).toBe('原对象');
    expect((state.npc.n2 as any).privateProfile?.chestDescription).toBe('新胸');
  });
});
