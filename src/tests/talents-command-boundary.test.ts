import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { VariableCommandSchema } from '../domain/variableCommands';
import { VariableResultSchema, WorldResultSchema } from '../domain/drafts';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { talentDefinitions } from '../domain/protagonist/talents';
import type { TalentId } from '../domain/protagonist/talents';
import { worldState, worldDraft } from './fixtures/world';
import { completeDraft } from './fixtures/turn';

const noWorldChanges = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] };
const variants = [undefined, ...talentDefinitions.map(t => t.id)];
const network = vi.fn(() => { throw new Error('No talent request is authorized'); });
beforeEach(() => { network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function fixture(id?: TalentId) {
  const state = worldState(); state.openingCityId = 'chongqing';
  if (id !== undefined) state.protagonist.talentId = id;
  const draft = worldDraft(true, 'opening');
  return { state, draft, context: { draft, expectedRevision: state.revision } };
}
const update = (changes: object) => ({ type: 'UpdateProtagonist', commandId: 'attack', protagonistId: 'hero', expectedRevision: 0, changes, evidence: '模型声称的更新' });

describe('AI / Variables / World 不能写入天赋 T11–T13', () => {
  it.each(['cyber_tyrant', 'underworld_aura', null, undefined, ['underworld_aura', 'cyber_tyrant']])(
    '拒绝直接赋值、清除、重申或多选：%j', value => {
      const command = update({ emotionText: '不能部分生效', talentId: value });
      expect(VariableCommandSchema.safeParse(command).success).toBe(false);
      expect(DomainCommandSchema.safeParse(command).success).toBe(false);
      expect(VariableResultSchema.safeParse({ commands: [command], rejectedSuggestions: [], unresolved: [] }).success).toBe(false);
    },
  );

  it.each([
    'set protagonist.talentId = "cyber_tyrant"',
    'set protagonist = {"emotionText":"不能生效","talentId":"cyber_tyrant"}',
    'push protagonist.talentId = "cyber_tyrant"',
    'delete protagonist.talentId',
    'delete protagonist.talentId = null',
    'delete protagonist',
    'push protagonist = {"talentId":"cyber_tyrant"}',
    'set opening.initialState = {"cash":10000,"talentId":"cyber_tyrant"}',
  ])('合法前缀后夹带 %s，整批编译拒绝', async text => {
    const { state, context } = fixture('underworld_aura'), before = structuredClone(state);
    const parsed = parseVariableText(`<命令>\nset protagonist.emotionText = "普通状态更新"\n${text}\n</命令>`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Probe must reach the real command compiler');
    const result = await compileVariableCommands(parsed.value, state, context);
    expect(result.ok).toBe(false); expect(result).not.toHaveProperty('value'); expect(state).toEqual(before);
    if (!result.ok) expect(result.error.commandIndex).toBe(2);
  });

  it.each(variants)('整体白名单更新、模拟与独立合法领域提交不覆盖既有 %s', async id => {
    const { state, context } = fixture(id), before = structuredClone(state);
    const parsed = parseVariableText('<命令>set protagonist = {"emotionText":"平静","profession":"观察员","skills":["观察"]}</命令>');
    if (!parsed.ok) throw new Error('Expected valid text commands');
    const plan = await compileVariableCommands(parsed.value, state, context);
    if (!plan.ok) throw new Error('Expected valid whitelisted update');
    const result = await simulateVariablePlan(plan.value, state, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected successful simulation');
    const saved = commitCommands(state, context.draft.turnId, state.revision, plan.value.commands);
    for (const next of [result.value, saved]) {
      expect(next.protagonist.talentId).toBe(id);
      expect(Object.hasOwn(next.protagonist, 'talentId')).toBe(id !== undefined);
      expect(next.protagonist.emotionText).toBe('平静'); expect(next.protagonist.profession).toBe('观察员');
    }
    expect(state).toEqual(before);
  });

  it.each(['worldCommands', 'taskCommands', 'eventCommands'] as const)('World %s 通过正式 JSON 解析也无法混入天赋', field => {
    const { state, draft } = fixture('underworld_aura'), before = structuredClone(state);
    const result = { ...noWorldChanges, [field]: [update({ talentId: 'cyber_tyrant' })] };
    expect(WorldResultSchema.safeParse(result).success).toBe(false);
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow();
    expect(state).toEqual(before);
  });

  it('开局初始化与装备命令不能携带主角天赋/整体主角替换', () => {
    for (const command of [
      { type: 'InitializeOpeningState', commandId: 'initial', evidence: '初始化', changes: { cash: 10000, talentId: 'cyber_tyrant' } },
      { type: 'InitializeOpeningState', commandId: 'initial', evidence: '初始化', changes: { protagonist: { talentId: 'cyber_tyrant' } } },
      { type: 'SetEquipment', commandId: 'equipment', evidence: '更换装备', equipment: { accessoryItemIds: [], talentId: 'cyber_tyrant' } },
    ]) expect(DomainCommandSchema.safeParse(command).success).toBe(false);
  });
});

describe('真实 Repository 失败原子性 T14–T15', () => {
  it.each([undefined, 'underworld_aura'] as const)('合法前缀 + 非法改写，独立 save 的五仓库完全不变：%s', async id => {
    const repo = await SaveRepository.open('talent-invalid-command', new IDBFactory());
    try {
      const { state } = fixture(id); await repo.create(state);
      await completeDraft(repo);
      const before = await repo.exportRaw('save-a');
      const legitimate = update({ emotionText: '不能部分写入' });
      for (const value of ['cyber_tyrant', null, undefined]) {
        const malicious = { ...update({ talentId: value }), commandId: 'illegal' };
        await expect(Reflect.apply(repo.save, repo, ['save-a', 0, 'blocked-talent', [legitimate, malicious]])).rejects.toBeDefined();
        expect(await repo.exportRaw('save-a')).toEqual(before);
      }
    } finally { repo.close(); }
  });

  it.each(['variables', 'worldCommands', 'taskCommands', 'eventCommands'] as const)(
    '非法 %s 候选不能保存草稿或提交；五仓库、回合和合法字段原样保留', async field => {
      const repo = await SaveRepository.open('talent-invalid-candidate', new IDBFactory());
      try {
        const { state } = fixture('underworld_aura'); await repo.create(state);
        const draft = await completeDraft(repo), before = await repo.exportRaw('save-a');
        const forged = structuredClone(draft), malicious = update({ talentId: 'cyber_tyrant', emotionText: '不能部分写入' });
        if (field === 'variables') Reflect.set(forged.variables!.result, 'commands', [...forged.variables!.result.commands, malicious]);
        else Reflect.set(forged.world!.result, field, [...forged.world!.result[field], malicious]);
        // Bypass only TypeScript in this hostile-input probe; production schemas still run.
        await expect(repo.saveDraft(forged, draft.draftRevision)).rejects.toBeDefined();
        await expect(repo.commitTurn({ draft: forged, nextAction: '', useVariableStage: true, useWorldStage: true })).rejects.toBeDefined();
        expect(await repo.exportRaw('save-a')).toEqual(before);
        expect((await repo.load('save-a')).turnNumber).toBe(0);
        expect((await repo.load('save-a')).protagonist.talentId).toBe('underworld_aura');
      } finally { repo.close(); }
    },
  );
});
