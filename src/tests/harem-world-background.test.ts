import { describe, expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import type { GameState } from '../domain/state';
import { parseWorld } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { householdFixture } from './fixtures/harem';
import { worldDraft, worldResult } from './fixtures/world';

const background = (changes: unknown[], commandId = 'bg') =>
  ({ type: 'ApplyHaremBackground', commandId, evidence: '场外推进', changes });
const plan = (npcId: string, action = '回老家处理房产') =>
  ({ op: 'plan', npcId, reason: '家里来电', value: { action, status: 'active', visibility: 'internal' } });
const pair = (left: string, right: string) =>
  ({ op: 'pair', reason: '私下见了一面', value: { leftNpcId: left, rightNpcId: right, relationship: '暗中较劲', cooperation: false, conflict: true, visibility: 'internal' } });
const overview = { op: 'overview', reason: '场外矛盾升级', value: { harmony: 55, competition: '两位成员争夺话语权', summary: '表面平静' } };

function offstage(count = 4) {
  const state = householdFixture(count);
  for (const person of Object.values(state.npc)) person.onScene = false;
  return state;
}
function selected(state: GameState, variableCommands: unknown[] = []) {
  const draft = worldDraft(false, 'opening');
  return { ...draft, baseSaveRevision: state.revision,
    stageStatus: { ...draft.stageStatus, variables: 'ready' as const },
    variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const,
      result: { commands: variableCommands.map(c => DomainCommandSchema.parse(c)), rejectedSuggestions: [], unresolved: [] } } };
}
const world = (commands: unknown[]) => JSON.stringify({ ...worldResult(), worldCommands: commands });

describe('World 场外推进后宫：只限计划、成员关系与总体局势', () => {
  it('领域层：World 推进离场成员计划、成员对与总体局势', () => {
    const state = offstage();
    const next = commitCommands(state, 'bg-turn', state.revision, [DomainCommandSchema.parse(background([plan('family-1'), pair('family-1', 'family-2'), overview]))]);
    expect(next.harem!.members['family-1'].plan).toMatchObject({ action: '回老家处理房产', turnId: 'bg-turn' });
    expect(next.harem!.pairs).toHaveLength(1);
    expect(next.harem!.overview?.harmony).toBe(55);
  });

  it('领域层：地位、加入、妊娠、子女不在 World 命令结构里；没有现役成员时拒绝', () => {
    for (const op of [{ op: 'score', npcId: 'family-1', reason: 'x', from: 94, to: 90 }, { op: 'pregnancy', npcId: 'family-1', reason: 'x', value: { status: 'suspected', visibility: 'internal' } },
      { op: 'join', npcId: 'family-9', identityKey: 'x', to: 10, reason: 'x' }])
      expect(DomainCommandSchema.safeParse(background([op])).success).toBe(false);
    const empty = householdFixture(0);
    expect(() => commitCommands(empty, 'bg', empty.revision, [DomainCommandSchema.parse(background([overview]))])).toThrow();
  });

  it('World 输出：离场成员可推进；在场成员被拒绝', () => {
    const state = offstage();
    expect(parseWorld(world([background([plan('family-1'), pair('family-2', 'family-3'), overview])]), state, selected(state)).worldCommands).toHaveLength(1);
    const onScene = structuredClone(state);
    onScene.npc['family-1'].onScene = true;
    expect(() => parseWorld(world([background([plan('family-1')])]), onScene, selected(onScene))).toThrow();
    expect(() => parseWorld(world([background([pair('family-1', 'family-2')])]), onScene, selected(onScene))).toThrow();
  });

  it('World 输出：不覆盖本回合 Variables 已写的同一计划、成员对或总体局势', () => {
    const state = offstage();
    const variables = { type: 'ApplyHaremChanges', commandId: 'vars', evidence: '正文', expectedRevision: state.revision,
      changes: [plan('family-1', '陪主角出差'), pair('family-2', 'family-3'), overview] };
    const draft = selected(state, [variables]);
    expect(() => parseWorld(world([background([plan('family-1')])]), state, draft)).toThrow();
    expect(() => parseWorld(world([background([pair('family-3', 'family-2')])]), state, draft)).toThrow();
    expect(() => parseWorld(world([background([overview])]), state, draft)).toThrow();
    expect(parseWorld(world([background([plan('family-2')])]), state, draft).worldCommands).toHaveLength(1);
  });

  it('World 仍不能写 Variables 的家庭命令；目录只给 World 展示场外命令', () => {
    const state = offstage();
    const variablesCommand = { type: 'ApplyHaremChanges', commandId: 'w', evidence: 'x', expectedRevision: state.revision, changes: [overview] };
    expect(() => parseWorld(world([variablesCommand]), state, selected(state))).toThrow();
    expect(commandCatalog('world').commandTypes).toContain('ApplyHaremBackground');
    expect(commandCatalog('world').commandTypes).not.toContain('ApplyHaremChanges');
    expect(commandCatalog('variables').commandTypes).not.toContain('ApplyHaremBackground');
  });

  it('有现役成员时 World 才收到场外推进边界；无后宫时不注入', async () => {
    const state = offstage();
    const prompt = await composePrompt({ stage: 'world', mode: 'opening', state, draft: selected(state), userInput: '', settings: defaultSettings() });
    expect(prompt.context).toHaveProperty('HAREM_WORLD_POLICY');
    expect(prompt.context.SAVE_STATE).toHaveProperty('harem.members');
    const empty = householdFixture(0);
    const none = await composePrompt({ stage: 'world', mode: 'opening', state: empty, draft: selected(empty), userInput: '', settings: defaultSettings() });
    expect(none.context).not.toHaveProperty('HAREM_WORLD_POLICY');
  });
});
