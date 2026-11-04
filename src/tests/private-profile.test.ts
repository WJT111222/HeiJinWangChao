import { describe, expect, it } from 'vitest';
import { applyVariableCommand } from '../domain/variableCommands';
import type { GameState } from '../domain/state';
import { NpcSchema } from '../domain/npc/schema';

function makeState(npc: ReturnType<typeof NpcSchema.parse>): GameState {
  return { revision: 1, npc: { [npc.id]: npc } } as unknown as GameState;
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

    applyVariableCommand(state, {
      type: 'UpdateNpc', commandId: 'c2', evidence: 'e', expectedRevision: 1, npcId: 'n1',
      changes: { privateProfile: { buttocksDescription: '描述B' } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n1 as any).privateProfile?.chestDescription).toBe('描述A');
    expect((state.npc.n1 as any).privateProfile?.buttocksDescription).toBe('描述B');
  });

  it('rejects privateProfile on ordinary or male NPC', () => {
    const ordinary = NpcSchema.parse({
      id: 'o1', identityKey: 'ko', aliases: [], name: '普通', skills: [],
      kind: 'ordinary', onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
    });
    const stateO = makeState(ordinary);
    expect(() => applyVariableCommand(stateO, {
      type: 'UpdateNpc', commandId: 'c', evidence: 'e', expectedRevision: 1, npcId: 'o1',
      changes: { privateProfile: { chestDescription: 'x' } },
    } as any, 't1', () => {}, () => {})).toThrow();

    const male = NpcSchema.parse({
      id: 'm1', identityKey: 'km', aliases: [], name: '男', age: 25, gender: 'male', skills: [],
      kind: 'special', detailedBackground: 'bg', activeGoals: [], habits: [],
      longTermMemories: [], offscreenTaskIds: [],
      onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
    });
    const stateM = makeState(male);
    expect(() => applyVariableCommand(stateM, {
      type: 'UpdateNpc', commandId: 'c', evidence: 'e', expectedRevision: 1, npcId: 'm1',
      changes: { privateProfile: { chestDescription: 'x' } },
    } as any, 't1', () => {}, () => {})).toThrow();
  });

  it('protects partial first experience records', () => {
    const npc = NpcSchema.parse({
      id: 'n3', identityKey: 'k3', aliases: [], name: '测试3', age: 21, gender: 'female', skills: [],
      kind: 'special', detailedBackground: 'bg', activeGoals: [], habits: [],
      longTermMemories: [], offscreenTaskIds: [],
      onScene: true, affinity: 0, relationshipText: 'r', memories: [], knownInformation: [],
      privateProfile: { firstExperienceTarget: '原对象', isVirgin: false },
    });
    const state = makeState(npc);
    applyVariableCommand(state, {
      type: 'UpdateNpc', commandId: 'c', evidence: 'e', expectedRevision: 1, npcId: 'n3',
      changes: { privateProfile: { firstExperienceText: '试图覆盖', chestDescription: '新' } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n3 as any).privateProfile?.firstExperienceTarget).toBe('原对象');
    expect((state.npc.n3 as any).privateProfile?.firstExperienceText).toBeUndefined();
    expect((state.npc.n3 as any).privateProfile?.chestDescription).toBe('新');
  });
});
