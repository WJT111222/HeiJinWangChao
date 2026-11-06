/* eslint-disable @typescript-eslint/no-explicit-any */
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
      changes: { privateProfile: { bodyDescription: '描述B' } },
    } as any, 't1', () => {}, () => {});
    expect((state.npc.n1 as any).privateProfile?.chestDescription).toBe('描述A');
    expect((state.npc.n1 as any).privateProfile?.bodyDescription).toBe('描述B');
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
    expect((state.npc.n3 as any).privateProfile?.firstExperienceText).toBe('试图覆盖');
    expect((state.npc.n3 as any).privateProfile?.chestDescription).toBe('新');
  });
});

import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

describe('privateProfile text integration', () => {
  it('parses, compiles and applies privateProfile via text command', async () => {
    const state = game();
    const female = npc('f1');
    (female as any).kind = 'special';
    (female as any).gender = 'female';
    (female as any).age = 22;
    (female as any).detailedBackground = 'bg';
    (female as any).activeGoals = [];
    (female as any).habits = [];
    (female as any).longTermMemories = [];
    (female as any).offscreenTaskIds = [];
    state.npc.f1 = female;
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 't1', 'opening', ''), { ...story, turnKind: 'opening' });
    const context = { draft, expectedRevision: state.revision };
    const textCmd = `<命令>
set npc[f1].privateProfile = {"chestDescription":"文字描述","isVirgin":true}
</命令>`;
    const parsed = parseVariableText(textCmd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = await compileVariableCommands(parsed.value, state, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = await simulateVariablePlan(plan.value, state, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.npc.f1 as any).privateProfile?.chestDescription).toBe('文字描述');
    expect((result.value.npc.f1 as any).privateProfile?.isVirgin).toBe(true);
  });
});

import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { game as makeGame, npc as makeNpc } from './fixtures/game';

describe('privateProfile IndexedDB round-trip', () => {
  it('saves privateProfile, closes, reopens and retains data', async () => {
    const factory = new IDBFactory();
    let repo = await SaveRepository.open('pp-test', factory);
    const state = makeGame('pp-save');
    const female = makeNpc('f1');
    (female as any).kind = 'special';
    (female as any).gender = 'female';
    (female as any).age = 24;
    (female as any).detailedBackground = 'bg';
    (female as any).activeGoals = [];
    (female as any).habits = [];
    (female as any).longTermMemories = [];
    (female as any).offscreenTaskIds = [];
    (female as any).privateProfile = { chestDescription: '测试描述', isVirgin: true };
    state.npc.f1 = female;
    await repo.create(state);
    repo.close();
    repo = await SaveRepository.open('pp-test', factory);
    const loaded = await repo.load('pp-save');
    expect((loaded.npc.f1 as any).privateProfile?.chestDescription).toBe('测试描述');
    expect((loaded.npc.f1 as any).privateProfile?.isVirgin).toBe(true);
    repo.close();
  });

  it('loads old save without privateProfile', async () => {
    const factory = new IDBFactory();
    let repo = await SaveRepository.open('old-test', factory);
    const state = makeGame('old-save');
    const ordinary = makeNpc('o1');
    state.npc.o1 = ordinary;
    await repo.create(state);
    repo.close();
    repo = await SaveRepository.open('old-test', factory);
    const loaded = await repo.load('old-save');
    expect(loaded.npc.o1.kind).toBe('ordinary');
    expect((loaded.npc.o1 as any).privateProfile).toBeUndefined();
    repo.close();
  });
});
