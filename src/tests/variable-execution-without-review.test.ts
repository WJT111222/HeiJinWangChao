import { describe, expect, it } from 'vitest';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { captureVariableTextPreviewBasis, previewVariableTextReply } from '../bridges/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseVariables } from '../services/validation/aiOutputs';
import { game, npc, story } from './fixtures/game';

function setup() {
  const state = game(); state.npc.npc_001 = { ...npc('npc_001'), onScene: false };
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'no-review', 'opening', ''), { ...story, turnKind: 'opening' });
  return { state, draft };
}
const block = (text: string) => `<命令>\n${text}\n</命令>`;
async function execute(text: string) {
  const { state, draft } = setup(), before = structuredClone(state);
  const ast = parseVariableText(block(text)); if (!ast.ok) throw new Error('样本语法错误');
  // 不提供proofs、interaction或独立事实凭据。
  const context = { draft, expectedRevision: state.revision };
  const compiled = await compileVariableCommands(ast.value, state, context);
  expect(compiled.ok).toBe(true); if (!compiled.ok) throw new Error(compiled.error.code);
  const simulated = await simulateVariablePlan(compiled.value, state, context);
  expect(simulated.ok).toBe(true); if (!simulated.ok) throw new Error(simulated.error.code);
  expect(state).toEqual(before);
  return { state: simulated.value, plan: compiled.value, context, before };
}
describe('删除额外变量审查后的执行回归', () => {
  it('消费不需要额外交易凭据', async () => {
    const result = await execute('add economy.cash = -300');
    expect(result.state.economy.cash).toBe(9700);
    expect(result.state.economy.incomes).toEqual(result.before.economy.incomes);
  });
  it('离场NPC的健康更新不需要独立互动授权', async () => {
    const result = await execute('set npc[npc_001].healthText = "疲惫"');
    expect(result.state.npc.npc_001.healthText).toBe('疲惫');
    expect(result.state.npc.npc_001.onScene).toBe(false);
  });
  it.each(['observed', 'reported', 'suspected'])('新增%s记忆不需要额外memorySource', async (kind) => {
    const result = await execute(`push npc[npc_001].memories = ${JSON.stringify({ text: '接到同事的消息', knowledgeKind: kind, knowledgeSource: '本轮剧情', visibility: 'npc_private' })}`);
    expect(result.state.npc.npc_001.memories).toHaveLength(1);
    expect(result.state.npc.npc_001.memories[0].knowledgeKind).toBe(kind);
    expect(result.state.npc.npc_001.knownInformation).toEqual([]);
  });
  it('离线桥接不再要求资金来源审批', async () => {
    const { state, draft } = setup(), basis = await captureVariableTextPreviewBasis(state, draft);
    if (!basis.ok) throw new Error('基线错误');
    const result = await previewVariableTextReply(block('add economy.cash = -300'), state, draft, basis.value);
    expect(result.ok).toBe(true); expect(state.economy.cash).toBe(10000);
  });
  it('现有JSON变量入口不再要求离场NPC互动许可', () => {
    const { state, draft } = setup();
    expect(() => parseVariables(JSON.stringify({ commands: [{ type: 'UpdateNpc', npcId: 'npc_001', commandId: 'health', expectedRevision: 0,
      evidence: '本轮人物变化', changes: { healthText: '疲惫' } }], rejectedSuggestions: [], unresolved: [] }), state, draft)).not.toThrow();
  });
});

describe('只保留执行和数据安全边界', () => {
  it('现有NPC持有的物品可按文本指令改变数量，不要求主角持有审批', async () => {
    const { state, draft } = setup();
    state.items.item_001 = { id: 'item_001', name: '用品', category: 'other', quantity: 3,
      ownerRef: { kind: 'npc', id: 'npc_001' }, conditionText: '完好' };
    const ast = parseVariableText(block('add items[item_001].quantity = -1')); if (!ast.ok) throw new Error('样本');
    const context = { draft, expectedRevision: 0 }, plan = await compileVariableCommands(ast.value, state, context);
    if (!plan.ok) throw new Error(plan.error.code);
    const result = await simulateVariablePlan(plan.value, state, context);
    expect(result.ok).toBe(true); if (result.ok) expect(result.value.items.item_001.quantity).toBe(2);
    expect(state.items.item_001.quantity).toBe(3);
  });
  it('新增私人记忆只写目标NPC，不自动公开或复制给其他NPC', async () => {
    const { state, draft } = setup(); state.npc.other = npc('other');
    const ast = parseVariableText(block('push npc[npc_001].memories = {"text":"私人经历","knowledgeKind":"observed","knowledgeSource":"本轮经历","visibility":"npc_private"}'));
    if (!ast.ok) throw new Error('样本');
    const context = { draft, expectedRevision: 0 }, plan = await compileVariableCommands(ast.value, state, context);
    if (!plan.ok) throw new Error(plan.error.code);
    const result = await simulateVariablePlan(plan.value, state, context); if (!result.ok) throw new Error(result.error.code);
    expect(result.value.npc.other.memories).toEqual([]);
    expect(result.value.memories).toEqual(state.memories);
    expect(result.value.npc.npc_001.memories[0].visibility).toBe('npc_private');
  });
  it('合法的显式player_known记忆不再要求额外公开许可', async () => {
    const result = await execute('push npc[npc_001].memories = {"text":"一起聊天","knowledgeKind":"observed","knowledgeSource":"本轮经历","visibility":"player_known"}');
    expect(result.state.npc.npc_001.memories[0].visibility).toBe('player_known');
  });
  it('同批同文的独立push不再由事实指纹审批，精确重放仍不重复写入', async () => {
    const text = 'push npc[npc_001].memories = {"text":"普通经历","knowledgeKind":"observed","knowledgeSource":"本轮经历","visibility":"npc_private"}';
    const result = await execute(`${text}\n${text}`);
    expect(result.state.npc.npc_001.memories).toHaveLength(2);
    expect(new Set(result.state.npc.npc_001.memories.map((m) => m.id)).size).toBe(2);
    const repeated = await compileVariableCommands(result.plan.ast, result.state, result.context);
    if (!repeated.ok) throw new Error(repeated.error.code);
    const replayed = await simulateVariablePlan(repeated.value, result.state, result.context);
    expect(replayed).toEqual({ ok: true, value: result.state });
  });
  it.each(['add economy.cash = -10001', 'add items[missing].quantity = -1', 'set npc[missing].healthText = "健康"'])(
    '非法数据仍整批拒绝：%s', async (body) => {
      const { state, draft } = setup(), before = structuredClone(state);
      const ast = parseVariableText(block(`set protagonist.emotionText = "轻松"\n${body}`)); if (!ast.ok) throw new Error('样本');
      const result = await compileVariableCommands(ast.value, state, { draft, expectedRevision: 0 });
      expect(result.ok).toBe(false); expect(result).not.toHaveProperty('value'); expect(state).toEqual(before);
    });
});
