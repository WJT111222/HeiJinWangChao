import { describe, expect, it } from 'vitest';
import { buildCreationState, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { openingTimeBase } from '../domain/openingTime';
import { parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { parseVariableText } from '../parsers/variableText';
import { worldResult } from './fixtures/world';
import { game } from './fixtures/game';
import { projectTurn } from '../domain/turnProjection';
import { variableTextEnvelope } from './fixtures/variableReply';

const startAt = '2015-07-08T08:00:00+08:00', endAt = '2015-07-08T08:05:00+08:00';
const income = { id: 'salary', source: '教师工资', amount: 580000, status: 'expected', account: 'onlineBalance', scheduleText: '每月15日发薪' };
const initial = { weatherText: '夏日多云', environmentText: '住宅楼下早餐铺刚开门，楼道传来邻居的脚步声。', cash: 30000, onlineBalance: 3200000, expectedIncomes: [income] };
const block = (value: unknown, suffix = '') => variableTextEnvelope(`<命令>\nset opening.initialState = ${JSON.stringify(value)}\n${suffix}\n</命令>`);
function setup() {
  const form = newCreation(); form.saveId = 'save-a';
  form.person = { name: '林舟', age: '30', gender: '男', appearance: '', personality: '沉稳' };
  form.profession = 'custom'; form.customProfession = '教师'; form.background = '普通家庭长大，在重庆工作。';
  const state = buildCreationState(form, defaultSettings());
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'opening', 'opening', ''), {
    turnKind: 'opening', narrative: '【旁白】林舟收好教案，准备出门。', summary: '在家收拾教案准备上班。',
    variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt, endAt }) }],
  });
  return { state, draft };
}
describe('新游戏开局基础生活初始化', () => {
  it('正文没有天气或具体余额，也能经真实文本解析模拟初始化；不制造到账', async () => {
    const { state, draft } = setup(), before = structuredClone(state);
    const result = await parseTextVariables(block(initial), state, draft);
    const next = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
    expect(next).toMatchObject({ weatherText: initial.weatherText, environmentText: initial.environmentText, economy: { cash: 30000, onlineBalance: 3200000, incomes: { salary: income } } });
    expect(result.commands.map(c => c.type)).toEqual(['SetWorldClock', 'InitializeOpeningState']);
    expect(next.economy.debts).toEqual({}); expect(next.economy.incomes.salary.receivedAt).toBeUndefined();
    expect(state).toEqual(before);
  });
  it('新创角带一次性初始化状态，旧存档不推定获得该状态', () => {
    expect(setup().state).toHaveProperty('openingInitializationPending', true);
  });
});

const normalized = (draft: ReturnType<typeof setup>['draft'], result: Awaited<ReturnType<typeof parseTextVariables>>) =>
  ({ ...draft, variables: { storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' as const, result } });
async function simulate(value: unknown, suffix = '') {
  const { state, draft } = setup(), result = await parseTextVariables(block(value, suffix), state, draft);
  return { state, draft, result, next: projectTurn(state, normalized(draft, result)) };
}

describe('初始化严格数据与一次性边界', () => {
  it.each([
    ['cash', -1], ['cash', 1.5], ['cash', '100'], ['cash', null], ['onlineBalance', Number.MAX_SAFE_INTEGER + 1],
    ['weatherText', ''], ['environmentText', ''], ['unknownField', 100],
    ['expectedIncomes', [{ ...income, status: 'received', receivedAt: endAt }]],
    ['expectedIncomes', [{ ...income, receivedAt: endAt }]],
    ['expectedIncomes', [{ ...income, sourceTurnId: 'invented' }]],
    ['expectedIncomes', [{ ...income, amount: null }]],
    ['expectedIncomes', [{ ...income, amount: -10 }]],
    ['expectedIncomes', [{ ...income, scheduleText: '' }]],
    ['expectedIncomes', [{ ...income, expectedAt: 'not-a-date' }]],
  ])('非法字段 %s=%j 整批拒绝', async (field, value) => {
    const { state, draft } = setup(), before = structuredClone(state);
    await expect(parseTextVariables(block({ ...initial, [String(field)]: value }), state, draft)).rejects.toThrow();
    expect(state).toEqual(before);
  });
  it.each(['cash', 'onlineBalance', 'weatherText', 'environmentText'] as const)('已明确%s不能被覆盖；相同值或省略可保留', async field => {
    const { state, draft } = setup();
    if (field === 'cash' || field === 'onlineBalance') state.economy[field] = 0;
    else state[field] = '玩家明确设定';
    const before = structuredClone(state);
    await expect(parseTextVariables(block(initial), state, draft)).rejects.toMatchObject({ details: expect.objectContaining({ domainRule: 'initial_value_conflict' }) });
    const value = { ...initial, [field]: field === 'cash' || field === 'onlineBalance' ? 0 : '玩家明确设定' };
    const result = await parseTextVariables(block(value), state, draft);
    const after = projectTurn(state, normalized(draft, result));
    expect(field === 'cash' || field === 'onlineBalance' ? after.economy[field] : after[field]).toEqual(value[field]);
    const omitted = { ...value }; delete (omitted as Record<string, unknown>)[field];
    const partial = await parseTextVariables(block(omitted), state, draft);
    const kept = projectTurn(state, normalized(draft, partial));
    expect(field === 'cash' || field === 'onlineBalance' ? kept.economy[field] : kept[field]).toEqual(value[field]);
    expect(state).toEqual(before);
  });
  it('预期收入ID必须唯一且不可碰撞主角或地点，不可写入过去安排', async () => {
    for (const expectedIncomes of [[income, income], [{ ...income, id: 'protagonist' }], [{ ...income, id: 'chongqing' }], [{ ...income, expectedAt: startAt }]]) {
      const { state, draft } = setup();
      await expect(parseTextVariables(block({ ...initial, expectedIncomes }), state, draft)).rejects.toThrow();
      expect(state.economy.incomes).toEqual({});
    }
  });
  it('预期收入不占用未来到账记录，原有记录不可覆盖', async () => {
    const { state, draft } = setup(); delete state.openingTimePending; state.worldClock = startAt;
    state.economy.incomes.salary = { ...income, status: 'expected', account: 'onlineBalance' };
    await expect(parseTextVariables(block(initial), state, draft)).rejects.toThrow();
    const result = await parseTextVariables(block({ ...initial, expectedIncomes: [] }), state, draft);
    expect(projectTurn(state, normalized(draft, result)).economy.incomes.salary).toEqual(state.economy.incomes.salary);
  });
  it('先初始化再消费；未来预期工资不提供余额，任一失败不产生部分修改', async () => {
    const r = await simulate(initial, 'add economy.cash = -1000');
    expect(r.next.economy.cash).toBe(29000); expect(r.next.openingInitializationPending).toBeUndefined();
    const { state, draft } = setup(), before = structuredClone(state);
    await expect(parseTextVariables(block({ ...initial, cash: 0 }, 'add economy.cash = -100'), state, draft)).rejects.toThrow();
    await expect(parseTextVariables(block(initial, 'set protagonist.locationId = "missing"'), state, draft)).rejects.toThrow();
    expect(state).toEqual(before);
  });
  it('同批第二条初始化拒绝，精确重放维持原有commandId与时钟语义', async () => {
    const { state, draft } = setup();
    await expect(parseTextVariables(block(initial, 'set opening.initialState = {"cash":30000}'), state, draft)).rejects.toThrow();
    const ast = parseVariableText(block(initial)); if (!ast.ok) throw Error(ast.error.code);
    const context = { draft, expectedRevision: 0 }, plan = await compileVariableCommands(ast.value, state, context);
    if (!plan.ok) throw Error(plan.error.code);
    const next = await simulateVariablePlan(plan.value, state, context); if (!next.ok) throw Error(next.error.code);
    const replay = await compileVariableCommands(ast.value, next.value, context); if (!replay.ok) throw Error(replay.error.code);
    expect(replay.value.commands).toEqual(plan.value.commands);
    expect(await simulateVariablePlan(replay.value, next.value, context)).toEqual(next);
    expect(next.value.appliedCommands).toHaveLength(2);
  });
  it('旧开局档没有标记时不得重新初始化，旧合法空候选仍可模拟', async () => {
    const { state, draft } = setup(); delete state.openingInitializationPending;
    expect(GameStateSchema.parse(state)).not.toHaveProperty('openingInitializationPending');
    await expect(parseTextVariables(block(initial), state, draft)).rejects.toThrow();
    expect(await parseTextVariables(variableTextEnvelope('<命令></命令>'), state, draft)).toHaveProperty('commands');
  });
  it('普通回合文本及伪造的领域候选均不能初始化', async () => {
    const state = game(); state.turnNumber = 1;
    const draft = rerollStory(createTurnDraft(state.saveId, 0, 'regular', 'regular', '继续'), { turnKind: 'regular', narrative: '继续生活。', summary: '继续生活', variableGuide: [] });
    await expect(parseTextVariables(block(initial), state, draft)).rejects.toThrow();
    const c = { type: 'InitializeOpeningState', commandId: 'forged', evidence: '初始化', changes: initial };
    expect(() => parseVariables(JSON.stringify({ commands: [c], rejectedSuggestions: [], unresolved: [] }), state, draft)).toThrow();
    expect(() => commitCommands(state, draft.turnId, 0, [DomainCommandSchema.parse(c)])).toThrow();
    expect(() => GameStateSchema.parse({ ...state, openingInitializationPending: true })).toThrow();
  });
  it('World不能使用新增领域命令替主角初始化', async () => {
    const { state, draft } = setup(), result = await parseTextVariables(variableTextEnvelope('<命令></命令>'), state, draft);
    expect(() => parseWorld(JSON.stringify({ ...worldResult(), worldCommands: [{ type: 'InitializeOpeningState', commandId: 'forged', evidence: '测试', changes: initial }] }), state, normalized(draft, result))).toThrow();
  });
  it.each(['story', 'revision'] as const)('旧初始化计划不能跨%s变更执行', async change => {
    const { state, draft } = setup(), ast = parseVariableText(block(initial)); if (!ast.ok) throw Error(ast.error.code);
    const context = { draft, expectedRevision: 0 }, plan = await compileVariableCommands(ast.value, state, context); if (!plan.ok) throw Error(plan.error.code);
    const changed = change === 'story' ? { draft: rerollStory(draft, draft.story!), expectedRevision: 0 } : context;
    const next = change === 'revision' ? { ...openingTimeBase(state, draft), openingInitializationPending: undefined, revision: 1 } : state;
    expect((await simulateVariablePlan(plan.value, next, changed)).ok).toBe(false);
  });
});
