import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportantItemSchema } from '../domain/items/schema';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { playerView } from '../ui/panels/playerView';
import { Panels } from '../ui/panels/Panels';
import { itemAttributes, itemCategoryGroup, itemDescription, protagonistInventory } from '../ui/panels/inventory';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { migrateSave } from '../services/storage/migrations';
import { game, npc, story } from './fixtures/game';

const owner = { kind: 'protagonist', id: 'hero' } as const;
const item = { name: '保温外套', category: 'top', quantity: 1, conditionText: '袖口轻微磨损', ownerRef: owner };
const set = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
const response = (text: string) => `<thinking>维护本回合物品。</thinking><说明>记录物品资料。</说明><命令>\n${text}\n</命令>`;
function setup() {
  const state = game();
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'inventory-turn', 'opening', ''), { ...story, turnKind: 'opening' });
  return { state, draft };
}

describe('背包 V2 的数据与真实文本执行', () => {
  it('旧物品保持原样，新物品接受描述、分币参考价和独立任务标记', () => {
    expect(ImportantItemSchema.parse({ ...item, id: 'coat' })).toEqual({ ...item, id: 'coat' });
    expect(ImportantItemSchema.parse({ ...item, id: 'coat', description: '厚实棉布外套', referenceValue: 12000, questItem: true }))
      .toMatchObject({ description: '厚实棉布外套', referenceValue: 12000, questItem: true });
  });
  it('工具有稳定类别，不依赖名称猜测，未知价值保留null', () => {
    expect(ImportantItemSchema.parse({ ...item, id: 'torch', category: 'tool', referenceValue: null }).category).toBe('tool');
  });
  it('同批创建、修改描述/价值/附加资料可真实投影，估值不改余额', async () => {
    const { state, draft } = setup(), before = structuredClone(state);
    const result = await parseTextVariables(response([
      set('items[coat]', item), set('items[coat].description', '黑色棉布外套'),
      set('items[coat].referenceValue', 12000), set('items[coat].itemDetails', { material: '棉布', size: 'L' }),
      set('items[coat].questItem', true), set('items[coat].conditionText', '刚洗净'),
    ].join('\n')), state, draft);
    const projected = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
    expect(projected.items.coat).toMatchObject({ description: '黑色棉布外套', referenceValue: 12000, itemDetails: { material: '棉布', size: 'L' }, questItem: true, conditionText: '刚洗净' });
    expect(projected.economy).toEqual(state.economy); expect(state).toEqual(before);
  });
  it('背包不显示NPC、组织或无主物品，也不显示世界经济数据库', () => {
    const state = game(); state.npc.a = npc('a');
    state.items.mine = ImportantItemSchema.parse({ ...item, id: 'mine' });
    state.items.theirs = ImportantItemSchema.parse({ ...item, id: 'theirs', name: '同事私人物品', ownerRef: { kind: 'npc', id: 'a' } });
    state.items.lost = ImportantItemSchema.parse({ ...item, id: 'lost', name: '遗失物品', ownerRef: undefined });
    const html = renderToStaticMarkup(<Panels name="物品栏" view={playerView(state)} />);
    expect(html).toContain('保温外套'); expect(html).not.toContain('同事私人物品'); expect(html).not.toContain('遗失物品');
    expect(html).not.toContain('全部正式经济与资产记录'); expect(html).not.toContain('物品完整资料与持有人');
  });
  it('提供五个明确分类及全部入口，默认只展示紧凑物品按钮', () => {
    const state = game(); state.items.mine = ImportantItemSchema.parse({ ...item, id: 'mine' });
    const html = renderToStaticMarkup(<Panels name="物品栏" view={playerView(state)} />);
    for (const label of ['全部', '衣物穿戴', '电子设备', '证件文件', '工具与武器', '生活用品与杂物']) expect(html).toContain(label);
    expect(html).not.toContain('袖口轻微磨损');
  });
});

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '未知'])('非法参考金额 %s 仍拒绝，不接受字符串或小数', async value => {
  const { state, draft } = setup(), before = structuredClone(state);
  await expect(parseTextVariables(response(set('items[coat]', { ...item, referenceValue: value })), state, draft)).rejects.toBeDefined();
  expect(state).toEqual(before);
});
it.each([undefined, null, 0, 10000])('合法参考值 %s 不被当作交易', async referenceValue => {
  const { state, draft } = setup();
  const result = await parseTextVariables(response(set('items[coat]', { ...item, referenceValue })), state, draft);
  const projected = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
  expect(projected.items.coat.referenceValue).toBe(referenceValue); expect(projected.economy).toEqual(state.economy);
});
it('分类种数仅计主角实体，数量不充当种数；名称不参与分类；装备来自原槽位', () => {
  const state = game();
  for (const category of Object.keys(itemCategoryGroup)) {
    state.items[category] = ImportantItemSchema.parse({ ...item, id: category, name: '工具手机外套', category, quantity: 3 });
  }
  state.items.unknown = ImportantItemSchema.parse({ ...item, id: 'unknown', ownerRef: undefined });
  state.items.wrong = ImportantItemSchema.parse({ ...item, id: 'wrong', ownerRef: { kind: 'protagonist', id: 'not-hero' } });
  state.items.org = ImportantItemSchema.parse({ ...item, id: 'org', ownerRef: { kind: 'organization', id: 'org' } });
  state.protagonist.currentWear = { topItemId: 'top', primaryWeaponItemId: 'weapon', accessoryItemIds: ['accessory'] };
  const before = structuredClone(state), view = protagonistInventory(Object.values(state.items), state.protagonist);
  expect(view.counts).toEqual({ all: 9, clothing: 4, devices: 1, documents: 1, tools: 2, supplies: 1 });
  expect([...view.equipped]).toEqual(['top', 'weapon', 'accessory']); expect(state).toEqual(before);
});
it.each([
  ['top', { material: '棉', size: 'L', batteryText: '一半' }, ['材质', '尺码']],
  ['device', { brandModel: '通用设备', batteryText: '一半', warmth: '保暖' }, ['品牌型号', '电量']],
  ['document', { issuer: '签发机构', validUntil: '长期', size: 'L' }, ['签发方', '有效期限']],
  ['tool', { durabilityText: '完好', reserveText: '未知', shelfLife: '一年' }, ['耐用情况', '燃料或弹药余量']],
  ['other', { remainingText: '半瓶', effectText: '清洁', batteryText: '一半' }, ['剩余用量', '使用效果']],
])('%s 只读展示适用专属字段，不改写旧附加资料', (category, itemDetails, labels) => {
  const value = ImportantItemSchema.parse({ ...item, id: 'fixture', category, itemDetails });
  const before = structuredClone(value);
  expect(itemAttributes(value).map(attribute => attribute.label)).toEqual(labels); expect(value).toEqual(before);
});
it('旧 description 附加资料只作展示回退，自定义字符串保留且不触发原型属性', () => {
  const value = ImportantItemSchema.parse({ ...item, id: 'old', itemDetails: { 描述: '旧档明确的外观', 纪念文字: '纪念旅行', constructor: '厂家标记' } });
  expect(itemDescription(value)).toBe('旧档明确的外观'); expect(value.description).toBeUndefined();
  expect(itemAttributes(value)).toEqual([{ key: '纪念文字', label: '纪念文字', value: '纪念旅行' }, { key: 'constructor', label: 'constructor', value: '厂家标记' }]);
  expect(itemDescription({ ...value, description: '新描述' })).toBe('新描述');
});
it('属性更新为字符串记录，不允许任意深路径、额外归属字段或数字属性', async () => {
  const { state, draft } = setup(); state.items.coat = ImportantItemSchema.parse({ ...item, id: 'coat' });
  for (const text of [set('items[coat].itemDetails.batteryText', '一半'), set('items[coat].itemDetails', { batteryText: 50 }), set('items[coat].ownerRef', owner)])
    await expect(parseTextVariables(response(text), state, draft)).rejects.toBeDefined();
});
it('购买价与参考价独立，赠送及遗失后保留资料并正确卸装备', async () => {
  const { state, draft } = setup(); state.npc.a = npc('a');
  const result = await parseTextVariables(response([
    set('items[coat].purchase', { account: 'cash', price: 2500, item: { ...item, referenceValue: 9000, description: '棉布衣物' } }),
    set('protagonist.currentWear', { topItemId: 'coat', accessoryItemIds: [] }),
    set('items[coat].transfer', { from: owner, to: { kind: 'npc', id: 'a' } }),
    set('items[coat].loss', { expectedOwner: { kind: 'npc', id: 'a' }, locationId: 'chongqing', conditionText: '遗落' }),
  ].join('\n')), state, draft);
  const projected = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
  expect(projected.economy.cash).toBe(7500); expect(projected.items.coat).toMatchObject({ referenceValue: 9000, description: '棉布衣物', conditionText: '遗落' });
  expect(projected.items.coat.ownerRef).toBeUndefined(); expect(projected.protagonist.currentWear.topItemId).toBeUndefined();
  expect(protagonistInventory(Object.values(projected.items), projected.protagonist).items).toEqual([]);
});
it('归零删除及卸装备不被新增资料影响，错误分类/引用整批回滚', async () => {
  const { state, draft } = setup(); state.items.coat = ImportantItemSchema.parse({ ...item, id: 'coat', referenceValue: 10000 });
  state.protagonist.currentWear.topItemId = 'coat'; const before = structuredClone(state);
  for (const text of [set('items[coat].category', 'tool'), set('items[coat].locationId', 'missing'), set('items[coat].transfer', { from: { kind: 'npc', id: 'missing' }, to: owner })])
    await expect(parseTextVariables(response(set('items[coat].description', '更新后描述') + '\n' + text), state, draft)).rejects.toBeDefined();
  const result = await parseTextVariables(response('add items[coat].quantity = -1'), state, draft);
  const projected = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
  expect(projected.items.coat).toBeUndefined(); expect(projected.protagonist.currentWear.topItemId).toBeUndefined(); expect(state).toEqual(before);
});
it('新增字段计划精确重放幂等；revision及Story重Roll仍使旧计划失效', async () => {
  const { state, draft } = setup(), context = { draft, expectedRevision: 0 };
  const ast = parseVariableText(response(set('items[coat]', { ...item, referenceValue: 10000 }) + '\n' + set('items[coat].description', '棉布衣物')));
  if (!ast.ok) throw new Error('fixture');
  const plan = await compileVariableCommands(ast.value, state, context); if (!plan.ok) throw new Error('fixture');
  const result = await simulateVariablePlan(plan.value, state, context); if (!result.ok) throw new Error('fixture');
  const replay = await compileVariableCommands(ast.value, result.value, context); if (!replay.ok) throw new Error('replay');
  expect(await simulateVariablePlan(replay.value, result.value, context)).toEqual(result);
  expect((await simulateVariablePlan(plan.value, { ...state, revision: 1 }, context)).ok).toBe(false);
  expect((await simulateVariablePlan(plan.value, state, { ...context, draft: rerollStory(draft, draft.story!) })).ok).toBe(false);
});
it.each(['opening', 'regular'] as const)('%s 实际Composer具备新增创建及更新协议，不将参考价变成交易', async mode => {
  const { state } = setup();
  const draft = rerollStory(createTurnDraft(state.saveId, 0, 'prompt-inventory', mode, ''), { ...story, turnKind: mode });
  const result = await composePrompt({ stage: 'variables', mode, state, draft, settings: defaultSettings(), domains: ['items'], userInput: '' });
  const text = result.messages.map(m => m.content).join('\n');
  expect(text).toContain('referenceValue'); expect(text).toContain('不自动改余额'); expect(text).toContain('suggestedStringFields');
  for (const field of ['description', 'referenceValue', 'itemDetails', 'category', 'questItem']) expect(text).toContain(`items[id].${field}`);
  expect(text).not.toContain('任意itemDetails修改不支持');
});
it('V6物品可缺少可选描述与估值，读取不改数量、归属及装备',()=>{
 const state=game();state.items.coat=ImportantItemSchema.parse({...item,id:'coat',itemDetails:{描述:'旧外套'}});state.protagonist.currentWear.topItemId='coat';
 const before=structuredClone(state),restored=migrateSave(state);expect(restored.items).toEqual(before.items);expect(restored.protagonist.currentWear).toEqual(before.protagonist.currentWear);expect(restored.items.coat.referenceValue).toBeUndefined();expect(restored.items.coat.description).toBeUndefined();expect(state).toEqual(before);
});
