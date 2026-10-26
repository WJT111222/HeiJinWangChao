import { describe, expect, it } from 'vitest';
import { buildCreationState, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { openingTimeSelection } from '../domain/openingTime';
import { projectTurn } from '../domain/turnProjection';
import { parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { settleTurn } from '../domain/turnCommit';
import { game, npc } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';

const start = '2015-07-08T14:00:00+08:00', end = '2015-07-08T14:02:00+08:00';
const empty = { commands: [], rejectedSuggestions: [], unresolved: [] };
const world = { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] };
function opening() {
  const state = buildCreationState({ ...newCreation(), person: { name: '林舟', age: '30', gender: '女', appearance: '', personality: '' }, profession: '教师' }, defaultSettings());
  state.economy.cash = 10000;
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'opening', 'opening', ''), {
    turnKind: 'opening', narrative: '夜色渐浓，你端起水杯。', summary: '你端起水杯。',
    variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: start, endAt: end }), textEvidence: '按场景安排的开局时间，无需逐字引用。' }],
  });
  return { state, draft };
}
function regular() {
  const state = game();
  return { state, draft: rerollStory(createTurnDraft(state.saveId, 0, 'regular', 'opening', ''), {
    turnKind: 'opening', narrative: '【店员】欢迎光临。你结完账，把东西收好。', summary: '结账后收好东西。', variableGuide: [],
  }) };
}
describe('M8-P0A 最小校验失败复现', () => {
  it('Story结构化时间不需要正文日期/星期/季节逐字互证', () => {
    const { state, draft } = opening();
    expect(openingTimeSelection(state, draft)).toMatchObject({ startAt: start, endAt: end });
  });
  it.each<[string, DomainCommand[]]>([
    ['空变量', []],
    ['在场NPC', [{ type: 'CreateNpc', commandId: 'npc', evidence: '叙事中出现的服务人员', npc: npc() }]],
    ['合法消费', [{ type: 'SpendFunds', commandId: 'meal', evidence: '餐后结账', account: 'cash', amount: 3000, purpose: '午餐' }]],
    ['无偿物品', [{ type: 'AcquireItem', commandId: 'gift', evidence: '临别收到证件', item: { id: 'badge', name: '证件', category: 'document', quantity: 1, conditionText: '完好', ownerRef: { kind: 'protagonist', id: 'hero' } } }]],
  ])('开局%s无需变量重复时钟，世界投影与正式提交一致', (_label, commands) => {
    const { state, draft } = opening();
    // 创角主角ID随机；只在隔离测试数据中绑定物品目标。
    const fixed = commands.map((c) => c.type === 'AcquireItem' ? { ...c, item: { ...c.item, ownerRef: { kind: 'protagonist', id: state.protagonist.id } } } : c);
    const variables = parseVariables(JSON.stringify({ ...empty, commands: fixed }), state, draft);
    const candidate = { ...draft, variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result: variables }, stageStatus: { ...draft.stageStatus, variables: 'ready' as const } };
    expect(projectTurn(state, candidate).worldClock).toBe(end);
    const output = parseWorld(JSON.stringify(world), state, candidate);
    const complete = { ...candidate, world: { storyRevision: draft.storyRevision, basedOnVariableRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result: output }, stageStatus: { ...candidate.stageStatus, world: 'ready' as const } };
    expect(settleTurn(state, complete, state.updatedAt).worldClock).toBe(end);
    expect(state.openingTimePending).toBe(true);
  });
  it.each(['餐后结清账款', '无需逐字引用，也不必写现金金额或完成关键词'])('合法消费来源说明可概括：%s', (evidence) => {
    const { state, draft } = regular();
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'meal', evidence, account: 'cash', amount: 3000, purpose: '午餐' }] }), state, draft)).not.toThrow();
  });
  it('已完成候选可零耗时正式提交，不制造固定步长', () => {
    const { state, draft } = regular();
    const complete = { ...draft, variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result: empty }, world: { storyRevision: draft.storyRevision, basedOnVariableRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result: world }, stageStatus: { story: 'ready' as const, variables: 'ready' as const, world: 'ready' as const } };
    expect(settleTurn(state, complete, state.updatedAt).worldClock).toBe(state.worldClock);
  });
  it.each([
    ['JSON', '{broken', 'invalid_json'],
    ['类型', JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'bad', evidence: '说明', account: 'cash', amount: '3000', purpose: '餐食' }] }), 'schema_fields'],
    ['余额', JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'bad', evidence: '说明', account: 'cash', amount: 999999, purpose: '餐食' }] }), 'amount_balance'],
    ['引用', JSON.stringify({ ...empty, commands: [{ type: 'TransferItem', commandId: 'bad', evidence: '说明', itemId: 'absent', from: null, to: { kind: 'protagonist', id: 'hero' } }] }), 'data_integrity'],
    ['日期', JSON.stringify({ ...empty, commands: [{ type: 'SetWorldClock', commandId: 'bad', evidence: '说明', worldClock: '2015-02-30T14:00:00+08:00' }] }), 'time_data'],
  ])('%s失败有安全分类', (_label, text, code) => {
    const { state, draft } = regular();
    try { parseVariables(text, state, draft); expect.fail('必须拒绝'); }
    catch (error) { expect(error).toMatchObject({ code }); }
  });
  it('普通回合倒退仍拒绝', () => {
    const { state, draft } = regular();
    const commands: DomainCommand[] = [{ type: 'SetWorldClock', commandId: 'back', evidence: '无需逐字互证', worldClock: start }];
    expect(() => parseVariables(JSON.stringify({ ...empty, commands }), state, draft)).toThrow();
  });
});

describe('M8-P0A 安全底线与兼容', () => {
  it('旧开局等值AI时钟兼容，投影只含一条稳定程序时钟命令', () => {
    const { state, draft } = opening();
    const clock: DomainCommand = { type: 'SetWorldClock', commandId: 'legacy-clock', evidence: '旧版来源说明', worldClock: end };
    const withCommands = (commands: DomainCommand[]) => ({ ...draft, variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result: { ...empty, commands } } });
    const first = projectTurn(state, withCommands([])), legacy = projectTurn(state, withCommands([clock]));
    expect(first).toEqual(legacy);
    expect(first.appliedCommands).toHaveLength(1);
    expect(first.appliedCommands[0]).toMatchObject({ turnId: draft.turnId, commandId: `opening-clock:${draft.storyRevision}` });
    expect(projectTurn(state, withCommands([]))).toEqual(first);
  });
  it('Story开局时间冲突不能静默忽略', () => {
    const { state, draft } = opening();
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SetWorldClock', commandId: 'wrong', evidence: '说明', worldClock: start }] }), state, draft)).toThrowError(expect.objectContaining({ code: 'time_data' }));
  });
  it('程序命令保留命名空间碰撞保护', () => {
    const { state, draft } = opening();
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: `opening-clock:${draft.storyRevision}`, evidence: '说明', account: 'cash', amount: 100, purpose: '餐食' }] }), state, draft)).toThrowError(expect.objectContaining({ code: 'candidate_conflict' }));
  });
  it('原始AI重复commandId不能因等值时钟规范化而绕过', () => {
    const { state, draft } = opening();
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [
      { type: 'SetWorldClock', commandId: 'same', evidence: '说明', worldClock: end },
      { type: 'SpendFunds', commandId: 'same', evidence: '餐食', account: 'cash', amount: 100, purpose: '餐食' },
    ] }), state, draft)).toThrowError(expect.objectContaining({ code: 'candidate_conflict' }));
  });
  it('多对象模拟失败整批回滚，不保留先发生的合法扣款', () => {
    const { state, draft } = regular(), before = structuredClone(state);
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [
      { type: 'SpendFunds', commandId: 'first', evidence: '概括', account: 'cash', amount: 100, purpose: '餐食' },
      { type: 'SpendFunds', commandId: 'overdraw', evidence: '另一次概括', account: 'cash', amount: 999999, purpose: '房费' },
    ] }), state, draft)).toThrowError(expect.objectContaining({ code: 'amount_balance' }));
    expect(state).toEqual(before);
  });
  it('未知余额仍不能消费，不猜测零或初始财富', () => {
    const { state, draft } = opening(); state.economy.cash = null;
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'meal', evidence: '用餐', account: 'cash', amount: 1, purpose: '餐食' }] }), state, draft)).toThrowError(expect.objectContaining({ code: 'amount_balance' }));
    expect(state.economy.cash).toBeNull();
  });
  it('白名单诊断只含字段/类型/序号，不含值、非法键或完整响应', () => {
    const { state, draft } = regular(), secret = 'API-Key-PRIVATE-NPC-CONTENT';
    try {
      parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'bad', evidence: secret, account: 'cash', amount: secret, purpose: secret, [secret]: secret }] }), state, draft);
      expect.fail('应拒绝');
    } catch (error) {
      expect(error).toMatchObject({ code: 'schema_fields', details: { commandIndex: 0, commandType: 'SpendFunds', fieldPath: 'commands.0.amount' } });
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('非法整数分金额仍拒绝：%s', (amount) => {
    const { state, draft } = regular();
    expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{ type: 'SpendFunds', commandId: 'meal', evidence: '概括', account: 'cash', amount, purpose: '餐食' }] }), state, draft)).toThrowError(expect.objectContaining({ code: 'amount_balance' }));
  });
});

it('认知类型按结构化协议核验，不因来源说明提到曾经听说而拒绝当前亲历记录', () => {
  const { state, draft } = regular(); state.npc['npc-a'] = npc();
  expect(() => parseVariables(JSON.stringify({ ...empty, commands: [{
    type: 'RecordNpcMemory', commandId: 'memory', evidence: '当前现场核验', expectedRevision: state.revision,
    npcId: 'npc-a', knowledgeKind: 'observed', layer: 'personal', addToKnownInformation: false,
    memory: { id: 'observed-memory', text: '亲眼确认主角在场。', knowledgeSource: '现场核实先前听说的消息',
      knowledgeKind: 'observed', visibility: 'npc_private', sourceTurnIds: [draft.turnId],
      affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }], createdAtGameTime: state.worldClock },
  }] }), state, draft)).not.toThrow();
});
