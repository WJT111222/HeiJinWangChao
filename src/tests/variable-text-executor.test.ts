import { describe, expect, it } from 'vitest';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

const sample = `<thinking>普通剧情状态分析</thinking>
<说明>更新角色状态和一条 NPC 记忆。</说明>
<命令>
set protagonist.emotionText = "心情平静"
set npc[npc_001].relationshipText = "彼此更加熟悉"
push npc[npc_001].memories = {
  "text": "一起抵达车站",
  "knowledgeKind": "observed",
  "knowledgeSource": "现场亲历",
  "visibility": "npc_private"
}
</命令>`;
function fixture() {
  const state = game();
  state.npc.npc_001 = npc('npc_001');
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'opening', ''), { ...story, turnKind: 'opening' });
  const context = { draft, expectedRevision: state.revision };
  return { state, context };
}
describe('M8-P0C-2 文本变量执行器', () => {
  it('真实 AST 到领域命令，再原子内存模拟；原对象不变', async () => {
    const { state, context } = fixture(), before = structuredClone(state);
    const parsed = parseVariableText(sample);
    if (!parsed.ok) throw new Error('样本解析失败');
    const plan = await compileVariableCommands(parsed.value, state, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.commands.map((command) => command.type)).toEqual(['UpdateProtagonist', 'UpdateNpc', 'RecordNpcMemory']);
    const result = await simulateVariablePlan(plan.value, state, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.protagonist.emotionText).toBe('心情平静');
    expect(result.value.npc.npc_001.relationshipText).toBe('彼此更加熟悉');
    expect(result.value.npc.npc_001.memories[0]).toMatchObject({ text: '一起抵达车站', sourceTurnIds: ['turn-a'], visibility: 'npc_private' });
    expect(state).toEqual(before);
  });
});

// 固定样本只提供执行所需的草稿与版本，不提供额外事实审批。
function setup(body: string) {
  const { state, context } = fixture();
  state.items.item_001 = { id: 'item_001', name: '普通用品', category: 'other', quantity: 3,
    ownerRef: { kind: 'protagonist', id: state.protagonist.id }, conditionText: '完好' };
  const parsed = parseVariableText(`<命令>\n${body}\n</命令>`);
  if (!parsed.ok) throw new Error('固定文本语法错误');
  return { state, context, ast: parsed.value };
}
async function compile(body: string) {
  const data = setup(body);
  return { ...data, result: await compileVariableCommands(data.ast, data.state, data.context) };
}
function unwrap<T>(result: import('../executors/variableText').ExecutionResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function expectCode(result: import('../executors/variableText').ExecutionResult<unknown>, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}
async function run(data: ReturnType<typeof setup>) {
  const plan = await compileVariableCommands(data.ast, data.state, data.context);
  return plan.ok ? simulateVariablePlan(plan.value, data.state, data.context) : plan;
}
const memoryText = (overrides = {}) => JSON.stringify({ text: '一起抵达车站', knowledgeKind: 'observed', knowledgeSource: '现场亲历', visibility: 'npc_private', ...overrides });
function memorySetup(overrides = {}) {
  const data = setup(`push npc[npc_001].memories = ${memoryText(overrides)}`);
  return data;
}
function expenseSetup(value = -300, account: 'cash' | 'onlineBalance' = 'cash') {
  const data = setup(`add economy.${account} = ${value}`);
  return data;
}

describe('精确路径与操作白名单', () => {
  it.each(['protagonist.healthText', 'protagonist.emotionText', 'npc[npc_001].healthText', 'npc[npc_001].relationshipText'])(
    'set %s 只生成获准文本更新', async (path) => {
      const data = await compile(`set ${path} = "新的普通文本状态"`);
      const plan = unwrap(data.result);
      expect(plan.commands).toHaveLength(1);
      expect((await simulateVariablePlan(plan, data.state, data.context)).ok).toBe(true);
    });
  it.each(['protagonist', 'protagonist.id', 'protagonist.age',
    'npc[npc_001].identity', 'npc[npc_001].knownInformation[0]',
    'npc[0].healthText', 'npc[npc_001].memories[0].visibility', 'npc[npc_001].affinity', '角色.当前精力',
    '环境.时间', 'revision', 'schemaVersion', 'appliedCommands', 'memories.npcSummaries', 'items[item_001].ownerRef', 'economy.incomes'])(
    '未注册路径 %s 明确拒绝', async (path) => {
      const { result } = await compile(`set ${path} = "不能写入"`);
      expectCode(result, 'unsupported_path');
    });
  it.each(['add protagonist.healthText = 1', 'push protagonist.emotionText = {}', 'set items[item_001].quantity = 1', 'set economy.cash = 0', 'set npc[npc_001].memories = []'])(
    '路径已注册但操作不支持：%s', async (body) => expectCode((await compile(body)).result, 'unsupported_operation'));
  it.each(['null', '3', 'true', '[]', '{}', '""', '"   "'])(
    '文本状态拒绝非文本或空值 %s', async (value) => expectCode((await compile(`set protagonist.healthText = ${value}`)).result, 'type_mismatch'));
  it('前一条合法、后一条未注册字段：不返回部分计划', async () => {
    const { state, context, ast } = setup('set protagonist.emotionText = "平静"\nset protagonist.age = 18');
    const before = structuredClone(state), result = await compileVariableCommands(ast, state, context);
    expectCode(result, 'unsupported_path');
    if (!result.ok) expect(result.error).toMatchObject({ commandIndex: 2, source: ast[1].source });
    expect(result).not.toHaveProperty('value'); expect(state).toEqual(before);
  });
});

describe('安全校验诊断（不改变执行器接受/拒绝结果）', () => {
  it('bool 字段收到字符串时，指明规范化路径与两侧类型，不泄露实体 ID 或值', async () => {
    const { result } = await compile('set npc[npc_001].onScene = "secret-should-not-appear"');
    expectCode(result, 'type_mismatch');
    if (result.ok) return;
    expect(result.error).toMatchObject({
      commandIndex: 1,
      diagnostic: {
        valuePath: 'npc[id].onScene', expectedType: 'boolean',
        actualType: 'string', validationRule: 'invalid_type',
      },
    });
    expect(JSON.stringify(result.error)).not.toContain('npc_001');
    expect(JSON.stringify(result.error)).not.toContain('secret-should-not-appear');
  });

  it('NPC记忆字段格式约束只暴露静态字段名与值类型', async () => {
    const { result } = await compile(`push npc[npc_001].memories = ${memoryText({ visibility: 12345 })}`);
    expectCode(result, 'type_mismatch');
    if (result.ok) return;
    expect(result.error.diagnostic).toMatchObject({
      valuePath: 'npc[id].memories.visibility', actualType: 'number',
      validationRule: 'schema_constraint',
    });
    expect(result.error.diagnostic).not.toHaveProperty('expectedType');
    expect(JSON.stringify(result.error)).not.toContain('npc_001');
  });

  it('交易对象不应提交字符串，不复制内容到诊断', async () => {
    const { result } = await compile('set items[item_001] = "private-text"');
    expectCode(result, 'type_mismatch');
    if (result.ok) return;
    expect(result.error.diagnostic).toMatchObject({
      valuePath: 'items[id]', expectedType: 'object',
      actualType: 'string', validationRule: 'invalid_type',
    });
    expect(JSON.stringify(result.error)).not.toContain('private-text');
    expect(JSON.stringify(result.error)).not.toContain('item_001');
  });
});

describe('NPC实体与稳定身份', () => {
  it('未知NPC不自动建档', async () => expectCode((await compile('set npc[missing].healthText = "健康"')).result, 'entity_not_found'));
  it('合法在场字段更新与健康状态可同批执行，不需要互动许可', async () => {
    const data = setup('set npc[npc_001].onScene = true\nset npc[npc_001].healthText = "健康"');
    data.state.npc.npc_001.onScene = false;
    const after = unwrap(await run(data));
    expect(after.npc.npc_001).toMatchObject({ onScene: true, healthText: '健康' });
    expect(data.state.npc.npc_001.onScene).toBe(false);
  });
  it.each(['protagonist.locationId', 'npc[npc_001].onScene', 'npc[npc_001].locationId', 'worldClock', 'protagonist.currentWear'])(
    '新注册路径%s仍拒绝错误字段类型', async (path) => expectCode((await compile(`set ${path} = "不能写入"`)).result, 'type_mismatch'));

  it('同名NPC始终由稳定ID区分，不影响另一个人', async () => {
    const data = setup('set npc[npc_001].healthText = "疲惫"'); data.state.npc.other = npc('other');
    const result = unwrap(await run(data)); expect(result.npc.npc_001.healthText).toBe('疲惫'); expect(result.npc.other.healthText).toBeUndefined();
  });
});

describe('物品数量和所有权', () => {
  it.each([[-1, 2, 'consumption'], [2, 5, 'gain'], [-3, 0, 'consumption']] as const)('数量增减 %i', async (delta, quantity, reason) => {
    const data = await compile(`add items[item_001].quantity = ${delta}`), plan = unwrap(data.result);
    expect(plan.commands[0]).toMatchObject({ type: 'UpdateItem', expectedQuantity: 3, expectedRevision: 0, changes: { quantity }, quantityReason: reason });
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    if (quantity) expect(result.items.item_001.quantity).toBe(quantity); else expect(result.items).not.toHaveProperty('item_001');
    expect(data.state.items.item_001.quantity).toBe(3);
  });
  it('同批多次数量变化使用顺序前值，整批只增加一个模拟revision', async () => {
    const data = setup('add items[item_001].quantity = 2\nadd items[item_001].quantity = -1');
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expect(plan.commands[1]).toMatchObject({ expectedQuantity: 5, changes: { quantity: 4 } });
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context)); expect(result.items.item_001.quantity).toBe(4); expect(result.revision).toBe(1);
  });
  it('已耗尽物品不能在同一计划后续命令中复活', async () => expectCode((await compile('add items[item_001].quantity = -3\nadd items[item_001].quantity = 1')).result, 'entity_not_found'));
  it.each(['0', '-4', '0.1', '9007199254740992', '9007199254740991'])(
    '无效数量或安全整数溢出 %s', async (delta) => expectCode((await compile(`add items[item_001].quantity = ${delta}`)).result, 'invalid_quantity'));
  it('不存在的物品拒绝', async () => expectCode((await compile('add items[missing].quantity = -1')).result, 'entity_not_found'));
  it('装备耗尽复用原有自动解除引用，不修改原对象', async () => {
    const data = setup('add items[item_001].quantity = -3'); data.state.items.item_001.category = 'top';
    data.state.protagonist.currentWear.topItemId = 'item_001';
    const result = unwrap(await run(data)); expect(result.protagonist.currentWear.topItemId).toBeUndefined();
    expect(data.state.protagonist.currentWear.topItemId).toBe('item_001');
  });
});

describe('明确资金支出', () => {
  it.each(['cash', 'onlineBalance'] as const)('整数分支出 %s，不制造收入', async (account) => {
    const data = expenseSetup(-300, account), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expect(plan.commands[0]).toMatchObject({ type: 'SpendFunds', amount: 300, purpose: '剧情消费', account });
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    expect(result.economy[account]).toBe(data.state.economy[account]! - 300); expect(result.economy.incomes).toEqual({});
  });
  it('未知余额不作零处理', async () => {
    const data = expenseSetup(); data.state.economy.cash = null; expectCode(await run(data), 'invalid_amount');
  });
  it('余额不足整批拒绝，即使之前的状态更新合法', async () => {
    const data = setup('set protagonist.emotionText = "轻松"\nadd economy.cash = -10001');
    expectCode(await run(data), 'invalid_amount'); expect(data.state.protagonist.emotionText).toBe('平静');
  });
  it.each([-0.1, 0, -9007199254740992])('金额 %s 非法', async (value) => expectCode((await compile(`add economy.cash = ${value}`)).result, 'invalid_amount'));
  it('正向收入不自动构造IncomeRecord', async () => expectCode((await compile('add economy.cash = 100')).result, 'unsupported_operation'));
  it('多笔消费整体核对余额而不是只核对单笔', async () => {
    const data = setup('add economy.cash = -6000\nadd economy.cash = -6000');
    expectCode(await run(data), 'invalid_amount'); expect(data.state.economy.cash).toBe(10000);
  });
});

describe('NPC记忆知识性质和来源', () => {
  it('来源、人物、时间和回合由程序生成，已知信息不自动增加', async () => {
    const data = memorySetup(), result = unwrap(await run(data)), memory = result.npc.npc_001.memories[0];
    expect(memory).toMatchObject({ sourceTurnIds: ['turn-a'], affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }],
      knowledgeKind: 'observed', visibility: 'npc_private', createdAtGameTime: data.state.worldClock });
    expect(memory.knowledgeSource).toBe('现场亲历');
    expect(result.npc.npc_001.knownInformation).toEqual([]); expect(result.memories.short).toEqual([]);
  });
  it.each(['knowledgeKind', 'knowledgeSource', 'visibility'] as const)('缺少必要元数据 %s 拒绝', async (field) => {
    const obj: Record<string, string> = { text: '抵达', knowledgeKind: 'observed', knowledgeSource: '现场', visibility: 'npc_private' }; delete obj[field];
    const data = setup(`push npc[npc_001].memories = ${JSON.stringify(obj)}`); expectCode(await run(data), 'type_mismatch');
  });
  it.each(['id', 'sourceTurnIds', 'createdAtGameTime', 'affectedEntityRefs', 'addToKnownInformation'])(
    '输入不能伪造技术或越权字段 %s', async (field) => expectCode(await run(memorySetup({ [field]: 'forged' })), 'type_mismatch'));
  it('记忆知识类型与既有领域格式不一致仍拒绝', async () => expectCode(await run(memorySetup({ text: '[转述]一起抵达' })), 'domain_validation_failed'));
});

describe('确定性、重放、正文重Roll和计划防篡改', () => {
  it('同一AST/版本/上下文生成等价计划，不取系统时钟或随机数', async () => {
    const data = memorySetup();
    const a = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const b = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expect(a).toEqual(b); expect(a.commands[0].commandId).toBe('text-v1:s1:c1');
    expect(a.commands[0].type === 'RecordNpcMemory' && a.commands[0].memory.id).toMatch(/^text-memory:[a-f0-9]{64}$/);
  });
  it.each(['expense', 'quantity', 'depleted', 'memory'] as const)('整批重放 %s 不重复扣款/数量/记忆', async (kind) => {
    const data = kind === 'expense' ? expenseSetup() : kind === 'memory' ? memorySetup()
      : setup(`add items[item_001].quantity = ${kind === 'depleted' ? -3 : -1}`);
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const first = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    const replay = unwrap(await compileVariableCommands(data.ast, first, data.context));
    const second = unwrap(await simulateVariablePlan(replay, first, data.context));
    expect(second).toEqual(first); expect(data.state.revision).toBe(0);
  });
  it('多次数量变化后耗尽的完整重放不复活实体', async () => {
    const data = setup('add items[item_001].quantity = 2\nadd items[item_001].quantity = -5');
    const first = unwrap(await run(data));
    const plan = unwrap(await compileVariableCommands(data.ast, first, data.context));
    expect(unwrap(await simulateVariablePlan(plan, first, data.context))).toEqual(first);
  });
  it('同回合同commandId改内容拒绝，不覆盖已有状态', async () => {
    const data = expenseSetup(), first = unwrap(await run(data)), changed = expenseSetup(-400);
    expectCode(await compileVariableCommands(changed.ast, first, changed.context), 'duplicate_or_conflicting_command');
    expect(first.economy.cash).toBe(9700);
  });
  it('同回合重放删去已执行命令或追加新命令拒绝', async () => {
    const data = setup('set protagonist.healthText = "健康"\nset protagonist.emotionText = "轻松"'), first = unwrap(await run(data));
    const shorter = setup('set protagonist.healthText = "健康"');
    expectCode(await compileVariableCommands(shorter.ast, first, shorter.context), 'duplicate_or_conflicting_command');
    const longer = setup('set protagonist.healthText = "健康"\nset protagonist.emotionText = "轻松"\nset npc[npc_001].healthText = "健康"');
    expectCode(await compileVariableCommands(longer.ast, first, longer.context), 'duplicate_or_conflicting_command');
  });
  it('重Roll在原始基线上生成新身份，不在已执行旧尝试之上重复push', async () => {
    const data = memorySetup(), oldPlan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const draft = rerollStory(data.context.draft, { ...story, turnKind: 'opening' });
    const context = { ...data.context, draft };
    const newPlan = unwrap(await compileVariableCommands(data.ast, data.state, context));
    expect(newPlan.commands[0].commandId).not.toBe(oldPlan.commands[0].commandId);
    expectCode(await simulateVariablePlan(oldPlan, data.state, context), 'revision_conflict');
    const first = unwrap(await simulateVariablePlan(oldPlan, data.state, data.context));
    expectCode(await compileVariableCommands(data.ast, first, context), 'duplicate_or_conflicting_command');
    expect(unwrap(await simulateVariablePlan(newPlan, data.state, context)).npc.npc_001.memories).toHaveLength(1);
  });
  it('保存版本已变化拒绝旧计划', async () => {
    const data = setup('set protagonist.emotionText = "轻松"'), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const changed = { ...data.state, revision: 1 };
    expectCode(await simulateVariablePlan(plan, changed, data.context), 'revision_conflict');
  });
  it('同revision NPC身份变化也拒绝旧计划', async () => {
    const data = memorySetup(), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const changed = structuredClone(data.state); changed.npc.npc_001.identityKey = 'different';
    expectCode(await simulateVariablePlan(plan, changed, data.context), 'revision_conflict');
  });
  it('不得修改计划内的领域命令以绕过白名单', async () => {
    const data = setup('set protagonist.emotionText = "轻松"'), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const altered = { ...plan, commands: [{ type: 'SetWorldClock' as const, commandId: 'hack', evidence: '无法授权', worldClock: '2040-01-01T00:00:00+08:00' }] };
    expectCode(await simulateVariablePlan(altered, data.state, data.context), 'duplicate_or_conflicting_command');
  });
  it('其他存档、其他回合、过期正式版本拒绝', async () => {
    const data = memorySetup();
    expectCode(await compileVariableCommands(data.ast, { ...data.state, saveId: 'other-save' }, data.context), 'revision_conflict');
    expectCode(await compileVariableCommands(data.ast, data.state, { ...data.context, expectedRevision: 1 }), 'revision_conflict');
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expectCode(await simulateVariablePlan(plan, data.state, { ...data.context, draft: { ...data.context.draft, turnId: 'other-turn' } }), 'revision_conflict');
  });
});

describe('内存事务、开局基线及旧系统隔离', () => {
  it('首个命令合法、末条命令触发领域错误，整体回滚', async () => {
    const data = memorySetup();
    const memoryPlan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const memory = memoryPlan.commands[0]; if (memory.type !== 'RecordNpcMemory') throw new Error('固定类型失败');
    // 来源ID碰撞是正式领域校验错误，不是文学审查；先前文本更新也不能部分落下。
    const full = setup(`set protagonist.emotionText = "轻松"\npush npc[npc_001].memories = ${memoryText()}`);
    const context = full.context;
    const preliminary = unwrap(await compileVariableCommands(full.ast, full.state, context));
    const pushed = preliminary.commands[1]; if (pushed.type !== 'RecordNpcMemory') throw new Error('固定类型失败');
    full.state.npc.npc_001.memories.push({ ...memory.memory, id: pushed.memory.id });
    const plan = unwrap(await compileVariableCommands(full.ast, full.state, context)), before = structuredClone(full.state);
    expectCode(await simulateVariablePlan(plan, full.state, context), 'duplicate_or_conflicting_command');
    expect(full.state).toEqual(before); expect(full.state.protagonist.emotionText).toBe('平静');
  });
  it('空命令不产生伪造状态或revision', async () => {
    const data = setup(''), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expect(plan.commands).toEqual([]); expect(unwrap(await simulateVariablePlan(plan, data.state, data.context))).toEqual(data.state);
  });
  it('冻结原对象与AST后仍可执行且不修改输入', async () => {
    const data = memorySetup(), before = structuredClone(data);
    function freeze(value: unknown) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } }
    freeze(data); expect((await run(data)).ok).toBe(true); expect(data).toEqual(before);
  });
  it('await期间外部对象修改不偷换已冻结的计划和模拟输入', async () => {
    const data = memorySetup(), stable = structuredClone(data), pending = compileVariableCommands(data.ast, data.state, data.context);
    data.state.protagonist.emotionText = '外部改动'; data.context.expectedRevision = 99;
    const plan = unwrap(await pending);
    expect(plan.commands[0].evidence).toBe('文本变量指令第1条');
    const next = simulateVariablePlan(plan, stable.state, stable.context);
    stable.state.worldClock = '2030-01-01T00:00:00+08:00';
    const result = unwrap(await next); expect(result.worldClock).not.toBe(stable.state.worldClock);
  });
  it('跨时间和场景不一致的存档仍被原Schema阻止，不提供修复补丁', async () => {
    const data = setup('set protagonist.emotionText = "轻松"');
    data.state.locations.remote = { id: 'remote', name: '远处' }; data.state.npc.npc_001.locationId = 'remote';
    expectCode(await run(data), 'domain_validation_failed');
  });
  it('原有场景切换校验仍要求显式处理在场NPC', async () => {
    const { commitCommands } = await import('../domain/commands');
    const data = setup(''); data.state.locations.remote = { id: 'remote', name: '远处' };
    expect(() => commitCommands(data.state, 'independent', 0, [{ type: 'UpdateProtagonist', protagonistId: 'hero', commandId: 'move', evidence: '移动', expectedRevision: 0, changes: { locationId: 'remote' } }])).toThrowError(expect.objectContaining({ code: 'SCENE_TRANSITION' }));
  });
  it('开局待定但没有合法Story时间时，不使用占位时钟', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime');
    const data = memorySetup(); data.state.worldClock = pendingOpeningClock; data.state.openingTimePending = true;
    expectCode(await run(data), 'domain_validation_failed');
  });
  it('开局复用程序时钟：正文、领域模拟使用相同endAt，原存档仍待定', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime');
    const data = memorySetup(); data.state.worldClock = pendingOpeningClock; data.state.openingTimePending = true;
    data.context.draft.story!.variableGuide.push({ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:05:00+08:00' }) });
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    expect(plan.commands[0]).toMatchObject({ type: 'SetWorldClock', commandId: 'opening-clock:1', worldClock: '2015-06-01T08:05:00+08:00' });
    expect(plan.origins[0]).toBeNull();
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    expect(result.worldClock).toBe('2015-06-01T08:05:00+08:00');
    expect(result.npc.npc_001.memories[0].createdAtGameTime).toBe(result.worldClock);
    expect(result.openingTimePending).toBeUndefined(); expect(data.state.openingTimePending).toBe(true); expect(data.state.worldClock).toBe(pendingOpeningClock);
  });
  it('没有开局待定标记的旧档沿用旧时钟，不重解释年代', async () => {
    const data = memorySetup(), result = unwrap(await run(data)); expect(result.worldClock).toBe(data.state.worldClock);
    expect(result.appliedCommands.some((entry) => entry.commandId.startsWith('opening-clock:'))).toBe(false);
  });
  it('普通回合正常执行，时钟不凭空推进', async () => {
    const data = setup('set protagonist.emotionText = "平静"');
    data.state.turnNumber = 1; data.state.journal.push({ turnId: 'old', revision: 0, story, relatedActorRefs: [] });
    data.context.draft = rerollStory(createTurnDraft(data.state.saveId, 0, 'new-turn', 'regular', '观察'), story);
    const result = unwrap(await run(data)); expect(result.worldClock).toBe(data.state.worldClock); expect(result.journal).toEqual(data.state.journal);
  });
  it('安全错误不回显秘密、路径或原始AI回复', async () => {
    const data = setup('set npc[secret-npc].healthText = "PRIVATE-SECRET"'), result = await run(data);
    expectCode(result, 'entity_not_found'); expect(JSON.stringify(result)).not.toContain('PRIVATE-SECRET'); expect(JSON.stringify(result)).not.toContain('secret-npc');
    if (!result.ok) expect(result.error.source).toEqual(data.ast[0].source);
  });
});

describe('运行边界与旧流程回归', () => {
  it('开局模拟清除待定标记后，精确重放仍保持幂等', async () => {
    const { pendingOpeningClock } = await import('../domain/openingTime');
    const data = memorySetup(); data.state.worldClock = pendingOpeningClock; data.state.openingTimePending = true;
    data.context.draft.story!.variableGuide.push({ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:05:00+08:00' }) });
    const first = unwrap(await run(data));
    const repeated = unwrap(await compileVariableCommands(data.ast, first, data.context));
    expect(unwrap(await simulateVariablePlan(repeated, first, data.context))).toEqual(first);
  });
  it('特殊NPC可使用自己的长期原始记忆，不提升其他人物知识', async () => {
    const data = memorySetup();
    data.state.npc.npc_001 = { ...npc('npc_001'), kind: 'special', detailedBackground: '', activeGoals: [], habits: [], offscreenTaskIds: [],
      longTermMemories: [{ id: 'long-source', text: '曾抵达车站', knowledgeKind: 'observed', knowledgeSource: '亲历', sourceTurnIds: ['old'],
        createdAtGameTime: data.state.worldClock, visibility: 'npc_private', affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }] }] };
    const context = data.context;
    const result = unwrap(await simulateVariablePlan(unwrap(await compileVariableCommands(data.ast, data.state, context)), data.state, context));
    expect(result.npc.npc_001.memories).toHaveLength(1);
    expect(result.npc.npc_001.kind === 'special' && result.npc.npc_001.longTermMemories).toHaveLength(1);
    expect(data.state.npc.npc_001.memories).toHaveLength(0);
  });
  it('长期回合ID不会截断或溢出记忆ID，同序号不同回合/人物保持不同身份', async () => {
    const data = memorySetup(); data.context.draft.turnId = 't'.repeat(128);
    const a = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    data.context.draft.turnId = 'u'.repeat(128);
    const b = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    if (a.commands[0].type !== 'RecordNpcMemory' || b.commands[0].type !== 'RecordNpcMemory') throw new Error('样本类型');
    expect(a.commands[0].memory.id.length).toBeLessThanOrEqual(128);
    expect(a.commands[0].memory.id).not.toBe(b.commands[0].memory.id);
  });
  it('空白正文或尚无保存正文的草稿不能授权执行', async () => {
    const data = setup('set protagonist.emotionText = "平静"');
    const context = { ...data.context, draft: createTurnDraft(data.state.saveId, 0, 'turn-a', 'opening', '') };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'domain_validation_failed');
  });
  it('手工伪造危险路径AST仍被重新校验', async () => {
    const data = setup('set protagonist.emotionText = "平静"');
    data.ast[0].path.nodes.push({ kind: 'field', name: '__proto__' });
    expectCode(await run(data), 'unsupported_path');
  });
  it('现有parseVariables仍接受旧JSON格式且未接入新执行器', async () => {
    const { parseVariables } = await import('../services/validation/aiOutputs'); const data = setup('');
    expect(parseVariables('{"commands":[],"rejectedSuggestions":[],"unresolved":[]}', data.state, data.context.draft)).toEqual({ commands: [], rejectedSuggestions: [], unresolved: [] });
  });
  it('编译、模拟不访问网络或数据库，也不调用AI', async () => {
    const { vi } = await import('vitest'); const fetch = vi.fn(), indexedDB = { open: vi.fn() };
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('indexedDB', indexedDB);
    try { expect((await run(memorySetup())).ok).toBe(true); expect(fetch).not.toHaveBeenCalled(); expect(indexedDB.open).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it('正式入口调用执行器，但执行器仍不导入存储、UI或AI运行时', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const name of readdirSync('src/executors/variableText')) {
      const source = readFileSync(`src/executors/variableText/${name}`, 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*(?:storage|ui\/|workflows|services\/ai)/);
      expect(source).not.toMatch(/\beval\s*\(|new\s+Function|\bfetch\s*\(|\bconsole\./);
    }
    expect(readFileSync('src/services/validation/aiOutputs.ts', 'utf8')).toContain('executors/variableText');
  });
});
