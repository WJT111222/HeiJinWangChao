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
  const context = { draft, expectedRevision: state.revision, interactions: [], proofs: [
    { commandIndex: 1, evidence: '当前情绪' },
    { commandIndex: 2, evidence: '本轮关系变化' },
    { commandIndex: 3, evidence: '抵达车站', memorySource: { kind: 'scene' as const, npcId: 'npc_001', identityKey: state.npc.npc_001.identityKey } },
  ] };
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

// 下列助手仅创建固定测试来源；生产集成必须从已验证的回合建立这些可信元数据。
function setup(body: string) {
  const { state, context } = fixture();
  state.items.item_001 = { id: 'item_001', name: '普通用品', category: 'other', quantity: 3,
    ownerRef: { kind: 'protagonist', id: state.protagonist.id }, conditionText: '完好' };
  const parsed = parseVariableText(`<命令>\n${body}\n</命令>`);
  if (!parsed.ok) throw new Error('固定文本语法错误');
  context.proofs = parsed.value.map((_, index) => ({ commandIndex: index + 1, evidence: '本轮已确认的变化' }));
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
  data.context.proofs[0] = { commandIndex: 1, evidence: '一起抵达', memorySource: { kind: 'scene', npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey } };
  return data;
}
function expenseSetup(value = -300, account: 'cash' | 'onlineBalance' = 'cash') {
  const data = setup(`add economy.${account} = ${value}`);
  return { ...data, context: { ...data.context, proofs: [{ commandIndex: 1, evidence: '已支付普通餐费', expense: { account, amount: Math.abs(value), purpose: '餐费' } }] } };
}

describe('精确路径与操作白名单', () => {
  it.each(['protagonist.healthText', 'protagonist.emotionText', 'npc[npc_001].healthText', 'npc[npc_001].relationshipText'])(
    'set %s 只生成获准文本更新', async (path) => {
      const data = await compile(`set ${path} = "新的普通文本状态"`);
      const plan = unwrap(data.result);
      expect(plan.commands).toHaveLength(1);
      expect((await simulateVariablePlan(plan, data.state, data.context)).ok).toBe(true);
    });
  it.each(['protagonist', 'protagonist.id', 'protagonist.age', 'protagonist.currentWear', 'protagonist.locationId',
    'npc[npc_001].identity', 'npc[npc_001].onScene', 'npc[npc_001].locationId', 'npc[npc_001].knownInformation',
    'npc[0].healthText', 'npc[npc_001].memories[0].visibility', 'npc[npc_001].affinity', '角色.当前精力',
    'worldClock', '环境.时间', 'revision', 'schemaVersion', 'appliedCommands', 'memories.npcSummaries', 'items[item_001].ownerRef', 'economy.incomes'])(
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

describe('NPC访问权限与稳定身份', () => {
  it('未知NPC不自动建档', async () => expectCode((await compile('set npc[missing].healthText = "健康"')).result, 'entity_not_found'));
  it('离场且无可信互动，拒绝更新', async () => {
    const data = setup('set npc[npc_001].healthText = "健康"'); data.state.npc.npc_001.onScene = false;
    expectCode(await run(data), 'permission_denied');
  });
  it('独立可信的本回合互动授权允许离场NPC文本更新，不改变在场状态', async () => {
    const data = setup('set npc[npc_001].healthText = "健康"'); data.state.npc.npc_001.onScene = false;
    const context = { ...data.context, interactions: [{ npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey,
      turnId: data.context.draft.turnId, storyRevision: data.context.draft.storyRevision }] };
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, context));
    expect(unwrap(await simulateVariablePlan(plan, data.state, context)).npc.npc_001.onScene).toBe(false);
  });
  it.each(['identityKey', 'turnId', 'storyRevision'] as const)('伪造或过期互动 %s 拒绝', async (field) => {
    const data = setup('set npc[npc_001].healthText = "健康"'); data.state.npc.npc_001.onScene = false;
    const grant = { npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, turnId: data.context.draft.turnId, storyRevision: data.context.draft.storyRevision };
    const context = { ...data.context, interactions: [{ ...grant, [field]: field === 'storyRevision' ? 99 : 'wrong' }] };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'permission_denied');
  });
  it('AST不能先设置在场，再给自己授予NPC修改权限', async () => {
    const data = setup('set npc[npc_001].onScene = true\nset npc[npc_001].healthText = "健康"');
    data.state.npc.npc_001.onScene = false; expectCode(await run(data), 'unsupported_path');
  });
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
  it.each(['npc', 'organization', 'unowned'] as const)('非主角持有：%s', async (kind) => {
    const data = setup('add items[item_001].quantity = -1');
    if (kind === 'npc') data.state.items.item_001.ownerRef = { kind, id: 'npc_001' };
    else if (kind === 'unowned') delete data.state.items.item_001.ownerRef;
    else { // 合法组织归属仍不授予此精简协议扣除他人物品的权限。
      const { organizations } = await import('./fixtures/game'); data.state.organizations['org-a'] = organizations[0];
      data.state.items.item_001.ownerRef = { kind, id: 'org-a' };
    }
    expectCode(await run(data), 'permission_denied');
  });
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
    expect(plan.commands[0]).toMatchObject({ type: 'SpendFunds', amount: 300, purpose: '餐费', account });
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    expect(result.economy[account]).toBe(data.state.economy[account]! - 300); expect(result.economy.incomes).toEqual({});
  });
  it('没有可信用途时不猜测支出原因', async () => expectCode((await compile('add economy.cash = -300')).result, 'missing_provenance'));
  it('支出来源金额不符拒绝', async () => {
    const data = expenseSetup(); data.context.proofs[0].expense.amount = 301; expectCode(await run(data), 'missing_provenance');
  });
  it('未知余额不作零处理', async () => {
    const data = expenseSetup(); data.state.economy.cash = null; expectCode(await run(data), 'invalid_amount');
  });
  it('余额不足整批拒绝，即使之前的状态更新合法', async () => {
    const data = setup('set protagonist.emotionText = "轻松"\nadd economy.cash = -10001');
    const context = { ...data.context, proofs: [data.context.proofs[0], { commandIndex: 2, evidence: '消费', expense: { account: 'cash' as const, amount: 10001, purpose: '普通消费' } }] };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'invalid_amount'); expect(data.state.protagonist.emotionText).toBe('平静');
  });
  it.each([-0.1, 0, -9007199254740992])('金额 %s 非法', async (value) => expectCode((await compile(`add economy.cash = ${value}`)).result, 'invalid_amount'));
  it('正向收入不自动构造IncomeRecord', async () => expectCode((await compile('add economy.cash = 100')).result, 'unsupported_operation'));
  it('多笔消费整体核对余额而不是只核对单笔', async () => {
    const data = setup('add economy.cash = -6000\nadd economy.cash = -6000');
    const context = { ...data.context, proofs: [1, 2].map((commandIndex) => ({ commandIndex, evidence: '两笔独立消费', expense: { account: 'cash' as const, amount: 6000, purpose: '已确认消费' } })) };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'invalid_amount'); expect(data.state.economy.cash).toBe(10000);
  });
});

describe('NPC记忆知识性质和来源', () => {
  it('来源、人物、时间和回合由程序生成，已知信息不自动增加', async () => {
    const data = memorySetup(), result = unwrap(await run(data)), memory = result.npc.npc_001.memories[0];
    expect(memory).toMatchObject({ sourceTurnIds: ['turn-a'], affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }],
      knowledgeKind: 'observed', visibility: 'npc_private', createdAtGameTime: data.state.worldClock });
    expect(memory.knowledgeSource).toContain('scene:npc_001:turn-a:s1');
    expect(result.npc.npc_001.knownInformation).toEqual([]); expect(result.memories.short).toEqual([]);
  });
  it.each(['knowledgeKind', 'knowledgeSource', 'visibility'] as const)('缺少必要元数据 %s 拒绝', async (field) => {
    const obj: Record<string, string> = { text: '抵达', knowledgeKind: 'observed', knowledgeSource: '现场', visibility: 'npc_private' }; delete obj[field];
    const data = setup(`push npc[npc_001].memories = ${JSON.stringify(obj)}`); expectCode(await run(data), 'type_mismatch');
  });
  it('普通记忆没有来源授权时不能只凭AI自称亲历', async () => expectCode((await compile(`push npc[npc_001].memories = ${memoryText()}`)).result, 'missing_provenance'));
  it.each(['id', 'sourceTurnIds', 'createdAtGameTime', 'affectedEntityRefs', 'addToKnownInformation'])(
    '输入不能伪造技术或越权字段 %s', async (field) => expectCode(await run(memorySetup({ [field]: 'forged' })), 'type_mismatch'));
  it('不能将私人记忆公开', async () => expectCode(await run(memorySetup({ visibility: 'player_known' })), 'permission_denied'));
  it('离场NPC不能声称现场观察', async () => {
    const data = memorySetup(); data.state.npc.npc_001.onScene = false;
    expectCode(await run(data), 'permission_denied');
  });
  it.each(['reported', 'suspected'] as const)('独立的本NPC原始来源保留 %s 性质', async (kind) => {
    const data = memorySetup({ knowledgeKind: kind, text: '同事可能已到车站' });
    const prefix = kind === 'reported' ? '[转述]' : '[推测]';
    data.state.npc.npc_001.memories.push({ id: 'own-source', text: `${prefix}同事可能已到车站`, knowledgeKind: kind, knowledgeSource: '旧回合来源',
      createdAtGameTime: data.state.worldClock, sourceTurnIds: ['old-turn'], affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }], visibility: 'npc_private' });
    const context = { ...data.context, proofs: [{ commandIndex: 1, evidence: '延续自身已知', memorySource: { kind: 'npc_memory' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, memoryId: 'own-source' } }] };
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, context));
    const result = unwrap(await simulateVariablePlan(plan, data.state, context));
    expect(result.npc.npc_001.memories[1].text).toBe(`${prefix}同事可能已到车站`);
    expect(result.npc.npc_001.memories[1].knowledgeKind).toBe(kind);
    expect(result.npc.npc_001.memories[1].knowledgeSource).toContain('npc-memory:npc_001:own-source');
  });
  it.each(['reported', 'suspected'])('现场来源不能自行解释为 %s', async (kind) => expectCode(await run(memorySetup({ knowledgeKind: kind })), 'permission_denied'));
  it('观察与转述标记冲突拒绝，不通过剥除前缀伪造事实', async () => expectCode(await run(memorySetup({ text: '[转述]一起抵达' })), 'missing_provenance'));
  it('A的秘密不能通过来源ID转给B', async () => {
    const data = memorySetup(); data.state.npc.other = npc('other');
    data.state.npc.other.memories.push({ id: 'private-source', text: '独占秘密', knowledgeKind: 'observed', knowledgeSource: '亲历',
      sourceTurnIds: ['old'], createdAtGameTime: data.state.worldClock, visibility: 'npc_private', affectedEntityRefs: [{ kind: 'npc', id: 'other' }] });
    const context = { ...data.context, proofs: [{ commandIndex: 1, evidence: '无法授权的引用', memorySource: { kind: 'npc_memory' as const, npcId: 'other', identityKey: data.state.npc.other.identityKey, memoryId: 'private-source' } }] };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'missing_provenance');
    context.proofs[0].memorySource.npcId = 'npc_001'; context.proofs[0].memorySource.identityKey = data.state.npc.npc_001.identityKey;
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'missing_provenance');
    expect(data.state.npc.npc_001.memories).toHaveLength(0);
  });
  it('缺少稳定地点的旧档NPC不能凭空声称现场观察', async () => {
    const data = memorySetup(); delete data.state.npc.npc_001.locationId; expectCode(await run(data), 'permission_denied');
  });
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
  it('两个相同push不制造重复记忆', async () => {
    const data = memorySetup(); const parsed = parseVariableText(`<命令>push npc[npc_001].memories = ${memoryText()}\npush npc[npc_001].memories = ${memoryText()}</命令>`);
    if (!parsed.ok) throw new Error('样本失败');
    const context = { ...data.context, proofs: [data.context.proofs[0], { ...data.context.proofs[0], commandIndex: 2 }] };
    expectCode(await compileVariableCommands(parsed.value, data.state, context), 'duplicate_or_conflicting_command');
  });
  it('保存版本已变化拒绝旧计划', async () => {
    const data = setup('set protagonist.emotionText = "轻松"'), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const changed = { ...data.state, revision: 1 };
    expectCode(await simulateVariablePlan(plan, changed, data.context), 'revision_conflict');
  });
  it('同revision NPC来源变化也拒绝旧计划', async () => {
    const data = memorySetup(), plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const changed = structuredClone(data.state); changed.npc.npc_001.identityKey = 'different';
    expectCode(await simulateVariablePlan(plan, changed, data.context), 'missing_provenance');
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
    const context = { ...full.context, proofs: [full.context.proofs[0], { ...data.context.proofs[0], commandIndex: 2 }] };
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
    data.state.protagonist.emotionText = '外部改动'; data.context.proofs[0].evidence = '外部改动';
    const plan = unwrap(await pending);
    expect(plan.commands[0].evidence).toBe('一起抵达');
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
    expectCode(await run(data), 'missing_provenance');
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

describe('额外来源、运行边界与旧流程回归', () => {
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
    const context = { ...data.context, proofs: [{ commandIndex: 1, evidence: '回顾自身经历', memorySource: { kind: 'npc_memory' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, memoryId: 'long-source' } }] };
    const result = unwrap(await simulateVariablePlan(unwrap(await compileVariableCommands(data.ast, data.state, context)), data.state, context));
    expect(result.npc.npc_001.memories).toHaveLength(1);
    expect(result.npc.npc_001.kind === 'special' && result.npc.npc_001.longTermMemories).toHaveLength(1);
    expect(data.state.npc.npc_001.memories).toHaveLength(0);
  });
  it.each(['unknown', 'internal', 'future', 'wrong-kind'] as const)('不可靠原始记忆来源 %s 拒绝', async (scenario) => {
    const data = memorySetup();
    data.state.npc.npc_001.memories.push({ id: 'source', text: '可能存在尚未确认的事情', knowledgeSource: '旧档记录', sourceTurnIds: ['old'],
      affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }], visibility: scenario === 'internal' ? 'internal' : 'npc_private',
      createdAtGameTime: scenario === 'future' ? '2030-01-01T00:00:00+08:00' : data.state.worldClock,
      ...(scenario !== 'unknown' ? { knowledgeKind: 'observed' as const } : {}) });
    const context = { ...data.context, proofs: [{ commandIndex: 1, evidence: '来源不能升级', memorySource: { kind: 'npc_memory' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, memoryId: 'source' } }] };
    if (scenario === 'wrong-kind') data.state.npc.npc_001.memories[0] = { ...data.state.npc.npc_001.memories[0], text: '[推测]可能存在事情', knowledgeKind: 'suspected' };
    expectCode(await compileVariableCommands(data.ast, data.state, context), scenario === 'future' ? 'missing_provenance' : 'permission_denied');
  });
  it('原始记忆为转述时，不允许输出观察事实', async () => {
    const data = memorySetup();
    data.state.npc.npc_001.memories.push({ id: 'source', text: '[转述]听闻有人抵达', knowledgeKind: 'reported', knowledgeSource: '他人告知', sourceTurnIds: ['old'],
      affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }], visibility: 'npc_private', createdAtGameTime: data.state.worldClock });
    const context = { ...data.context, proofs: [{ commandIndex: 1, evidence: '转述不能变亲历', memorySource: { kind: 'npc_memory' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, memoryId: 'source' } }] };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'permission_denied');
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
  it('来源序号重复或缺失拒绝，不隐式复制用途/来源', async () => {
    const data = memorySetup(); data.context.proofs.push(data.context.proofs[0]);
    expectCode(await run(data), 'duplicate_or_conflicting_command'); data.context.proofs = [];
    expectCode(await run(data), 'missing_provenance');
  });
  it('空白正文或尚无保存正文的草稿不能授权执行', async () => {
    const data = setup('set protagonist.emotionText = "平静"');
    const context = { ...data.context, draft: createTurnDraft(data.state.saveId, 0, 'turn-a', 'opening', '') };
    expectCode(await compileVariableCommands(data.ast, data.state, context), 'missing_provenance');
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
  it('新模块不被业务调用，不导入存储、UI或AI运行时', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const name of readdirSync('src/executors/variableText')) {
      const source = readFileSync(`src/executors/variableText/${name}`, 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*(?:storage|ui\/|workflows|services\/ai)/);
      expect(source).not.toMatch(/\beval\s*\(|new\s+Function|\bfetch\s*\(|\bconsole\./);
    }
    expect(readFileSync('src/services/validation/aiOutputs.ts', 'utf8')).not.toContain('executors/variableText');
  });
});

describe('PR35复审：事实身份去重不依赖自由说明', () => {
  function batch(sourceKind: 'scene' | 'npc_memory', secondValue = {}, withUpdate = false) {
    const body = `${withUpdate ? 'set protagonist.emotionText = "轻松"\n' : ''}push npc[npc_001].memories = ${memoryText()}\npush npc[npc_001].memories = ${memoryText(secondValue)}`;
    const data = setup(body);
    data.state.npc.npc_001.memories.push(...['source-a', 'source-b'].map((id) => ({
      id, text: '曾经与同伴抵达车站', knowledgeKind: 'observed' as const, knowledgeSource: '原始亲历记录',
      sourceTurnIds: [`turn-${id}`], affectedEntityRefs: [{ kind: 'npc' as const, id: 'npc_001' }],
      createdAtGameTime: data.state.worldClock, visibility: 'npc_private' as const,
    })));
    const source = sourceKind === 'scene'
      ? { kind: 'scene' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey }
      : { kind: 'npc_memory' as const, npcId: 'npc_001', identityKey: data.state.npc.npc_001.identityKey, memoryId: 'source-a' };
    const context: import('../executors/variableText').VariableExecutionContext = {
      ...data.context, proofs: data.ast.map((_, i) => ({ commandIndex: i + 1, evidence: '共同抵达',
        ...(withUpdate && i === 0 ? {} : { memorySource: source }) })),
    };
    return { ...data, context };
  }
  for (const source of ['scene', 'npc_memory'] as const) {
    it.each(['evidence', 'knowledgeSource', 'both', 'trimmedText'] as const)(
      `${source}来源相同：仅修改%s不能绕过去重`, async (difference) => {
        const data = batch(source, difference === 'knowledgeSource' || difference === 'both'
          ? { knowledgeSource: '本人经历的换一种说法' } : difference === 'trimmedText' ? { text: '  一起抵达车站  ' } : {});
        if (difference === 'evidence' || difference === 'both') data.context.proofs[1].evidence = '二人已经到达目的地';
        const before = structuredClone(data), result = await compileVariableCommands(data.ast, data.state, data.context);
        expectCode(result, 'duplicate_or_conflicting_command');
        expect(result).not.toHaveProperty('value');
        if (!result.ok) expect(result.error).toMatchObject({ commandIndex: 2, source: data.ast[1].source });
        expect(data).toEqual(before);
      });
  }
  it('只切换私人/内部可见性也不把同一次经历变成第二次', async () => {
    const data = batch('scene', { visibility: 'internal' });
    expectCode(await compileVariableCommands(data.ast, data.state, data.context), 'duplicate_or_conflicting_command');
  });
  it('两个合法不同原始来源的独立经历，即使最终文本与说明相同也可分别记录', async () => {
    const data = batch('npc_memory'), second = data.context.proofs[1].memorySource;
    if (second?.kind !== 'npc_memory') throw new Error('固定来源类型');
    // 第一、二项原始经历属于不同旧回合，只改变第二条的可信来源ID，不靠说明换词区分。
    data.context.proofs[1].memorySource = { ...second, memoryId: 'source-b' };
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const result = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    const memories = result.npc.npc_001.memories.slice(2);
    expect(memories).toHaveLength(2); expect(memories.map((m) => m.text)).toEqual(['一起抵达车站', '一起抵达车站']);
    expect(memories[0].knowledgeSource).toContain('npc-memory:npc_001:source-a');
    expect(memories[1].knowledgeSource).toContain('npc-memory:npc_001:source-b');
    expect(memories[0].id).not.toBe(memories[1].id); expect(data.state.npc.npc_001.memories).toHaveLength(2);
  });
  it('合法状态修改后跟随两条换说明的重复记忆，整批失败且没有部分计划或状态', async () => {
    const data = batch('scene', { knowledgeSource: '亲历过程的另一种描述' }, true);
    data.context.proofs[2].evidence = '已到车站的另一个说明';
    const before = structuredClone(data), result = await compileVariableCommands(data.ast, data.state, data.context);
    expectCode(result, 'duplicate_or_conflicting_command'); expect(result).not.toHaveProperty('value');
    if (!result.ok) expect(result.error).toMatchObject({ commandIndex: 3, source: data.ast[2].source });
    expect(data).toEqual(before); expect(data.state.protagonist.emotionText).toBe('平静');
  });
  it('两个独立来源的批次精确重放不再写入，commandId和memoryId算法不变', async () => {
    const data = batch('npc_memory'), second = data.context.proofs[1].memorySource;
    if (second?.kind !== 'npc_memory') throw new Error('固定来源类型');
    data.context.proofs[1].memorySource = { ...second, memoryId: 'source-b' };
    const plan = unwrap(await compileVariableCommands(data.ast, data.state, data.context));
    const first = unwrap(await simulateVariablePlan(plan, data.state, data.context));
    const repeated = unwrap(await compileVariableCommands(data.ast, first, data.context));
    expect(repeated.commands).toEqual(plan.commands);
    expect(unwrap(await simulateVariablePlan(repeated, first, data.context))).toEqual(first);
    const { createHash } = await import('node:crypto');
    for (const [i, command] of plan.commands.entries()) {
      expect(command.commandId).toBe(`text-v1:s1:c${i + 1}`);
      if (command.type !== 'RecordNpcMemory') throw new Error('固定命令类型');
      const expected = createHash('sha256').update(JSON.stringify([data.state.saveId, data.context.draft.turnId, 1, i + 1, 'npc_001'])).digest('hex');
      expect(command.memory.id).toBe(`text-memory:${expected}`);
    }
    expect(first.npc.npc_001.memories).toHaveLength(4);
  });
  it('另一回合重新经历同一场景，不以旧记忆文本作全局去重', async () => {
    const data = memorySetup(); data.context.draft.turnId = 'new-independent-turn';
    data.state.npc.npc_001.memories.push({ id: 'old-scene', text: '一起抵达车站', knowledgeKind: 'observed', knowledgeSource: '旧回合亲历',
      sourceTurnIds: ['previous-turn'], affectedEntityRefs: [{ kind: 'npc', id: 'npc_001' }],
      createdAtGameTime: data.state.worldClock, visibility: 'npc_private' });
    const result = unwrap(await run(data)); expect(result.npc.npc_001.memories).toHaveLength(2);
    expect(result.npc.npc_001.memories[1].sourceTurnIds).toEqual(['new-independent-turn']);
  });
});
