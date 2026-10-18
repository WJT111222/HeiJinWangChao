import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../domain/state';
import { DomainCommandSchema, commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { SpecialNpcSchema } from '../domain/npc/schema';
import { game, gameTime, npc, purchase, event, task, organizations } from './fixtures/game';

const commit = (commands: DomainCommand[]) => commitCommands(game(), 'turn-a', 0, commands);

describe('领域命令与不变量', () => {
  it('购买同时扣款并建立唯一物品，原快照保持不变', () => {
    const before = game();
    const after = commitCommands(before, 'turn-a', 0, [purchase()]);
    expect(after.economy.cash).toBe(7500);
    expect(after.items.shirt.ownerRef).toEqual({ kind: 'protagonist', id: 'hero' });
    expect(after.revision).toBe(1);
    expect(before.economy.cash).toBe(10000);
    expect(before.items).toEqual({});
  });
  it('资金不足时整个命令批次失败', () => {
    const before = game();
    expect(() => commitCommands(before, 'turn-a', 0, [purchase(), purchase('buy2', 99999, 'shirt2')])).toThrow();
    expect(before.economy.cash).toBe(10000);
    expect(before.items).toEqual({});
  });
  it('未知余额不能当作零或免费购买', () => {
    const before = game(); before.economy.cash = null;
    expect(() => commitCommands(before, 'turn-a', 0, [purchase()])).toThrow('余额未定');
  });
  it('内部转账一增一减，不创建收入', () => {
    const after = commit([{ commandId: 'transfer', type: 'TransferFunds', evidence: '现金存入银行', from: 'cash', to: 'onlineBalance', amount: 2000 }]);
    expect(after.economy.cash).toBe(8000); expect(after.economy.onlineBalance).toBe(22000);
    expect(after.economy.incomes).toEqual({});
  });
  it('工资入账建立明细，借款只增加余额和债务，还款同步减债', () => {
    const after = commit([
      { commandId: 'income', type: 'ReceiveIncome', evidence: '工资到账', income: {
        id: 'salary', source: '工资', amount: 1000, account: 'onlineBalance', status: 'received', receivedAt: gameTime } },
      { commandId: 'borrow', type: 'Borrow', evidence: '借款到账', account: 'cash', debt: {
        id: 'debt', creditor: '朋友', principal: 5000, outstanding: 5000, status: 'active', repaymentTerms: '月底还清',
        collateralAssetIds: [], autoPaymentAuthorized: false, source: '借款约定' } },
      { commandId: 'repay', type: 'RepayDebt', evidence: '已还款', account: 'cash', debtId: 'debt', amount: 2000 },
    ]);
    expect(after.economy.cash).toBe(13000); expect(after.economy.onlineBalance).toBe(21000);
    expect(after.economy.debts.debt.outstanding).toBe(3000);
    expect(Object.keys(after.economy.incomes)).toEqual(['salary']);
  });
  it('购车只创建车辆资产，不复制到物品栏', () => {
    const after = commit([{ commandId: 'vehicle', type: 'PurchaseVehicle', evidence: '购车付款', account: 'cash', price: 5000,
      vehicle: { id: 'car', kind: 'vehicle', name: '二手车', model: '测试车型', estimatedValue: null,
        ownerRef: { kind: 'protagonist', id: 'hero' }, source: '购入', statusText: '可使用' } },
    { commandId: 'equip-car', type: 'SetEquipment', evidence: '开始使用车辆', equipment: { accessoryItemIds: [], currentVehicleAssetId: 'car' } }]);
    expect(after.economy.vehicles.car).toBeDefined(); expect(after.items).toEqual({});
  });
  it('同 ID 或同稳定身份的 NPC 不能重复建档', () => {
    const create: DomainCommand = { commandId: 'npc1', type: 'CreateNpc', evidence: '持续互动', npc: npc() };
    expect(() => commit([create, { ...create, commandId: 'npc2' }])).toThrow('ID 已存在');
    expect(() => commit([create, { ...create, commandId: 'npc2', npc: { ...npc(), id: 'npc-b' } }])).toThrow('稳定身份');
  });
  it('不同 NPC 可以同名，别名不产生第二份档案', () => {
    const after = commit(['npc-a', 'npc-b'].map((id) => ({ commandId: id, type: 'CreateNpc', evidence: '确认不同身份', npc: npc(id) })));
    expect(Object.keys(after.npc)).toHaveLength(2);
  });
  it('装备必须归主角、类别兼容，转移时解除槽位引用', () => {
    const after = commit([purchase(), { commandId: 'equip', type: 'SetEquipment', evidence: '穿上衣服', equipment: { accessoryItemIds: [], topItemId: 'shirt' } },
      { commandId: 'npc', type: 'CreateNpc', evidence: '同事互动', npc: npc() },
      { commandId: 'gift', type: 'TransferItem', evidence: '送出衣服', itemId: 'shirt', from: { kind: 'protagonist', id: 'hero' }, to: { kind: 'npc', id: 'npc-a' } }]);
    expect(after.protagonist.currentWear.topItemId).toBeUndefined();
    expect(after.items.shirt.ownerRef?.id).toBe('npc-a');
    expect(() => commitCommands(after, 'turn-b', 1, [{ commandId: 'equip-again', type: 'SetEquipment', evidence: '错误装备', equipment: { accessoryItemIds: [], topItemId: 'shirt' } }])).toThrow();
  });
  it('不能将上衣放入武器槽或重复装备同一实体', () => {
    for (const equipment of [{ accessoryItemIds: [], primaryWeaponItemId: 'shirt' }, { accessoryItemIds: ['shirt'], topItemId: 'shirt' }]) {
      expect(() => commit([purchase(), { commandId: 'equip', type: 'SetEquipment', evidence: '装备', equipment }])).toThrow();
    }
  });
  it('游戏时间按绝对时刻比较，拒绝倒退', () => {
    expect(() => commit([{ commandId: 'clock', type: 'SetWorldClock', evidence: '时间变化', worldClock: '2026-10-17T23:00:00Z' }])).toThrow('倒退');
    expect(commit([{ commandId: 'clock', type: 'SetWorldClock', evidence: '等候一小时', worldClock: '2026-10-18T01:00:00Z' }]).worldClock).toBe('2026-10-18T01:00:00Z');
  });
  it('重复命令重放为无副作用，相同 ID 改内容则报冲突', () => {
    const once = commit([purchase()]);
    expect(commitCommands(once, 'turn-a', 0, [purchase()])).toEqual(once);
    expect(() => commitCommands(once, 'turn-a', 1, [purchase('buy-shirt', 1000)])).toThrow('内容发生变化');
    expect(() => commitCommands(once, 'turn-b', 0, [purchase('next', 1000, 'new')])).toThrow('版本已变化');
  });
  it('同批相同命令 ID 拒绝执行', () => expect(() => commit([purchase(), purchase()])).toThrow('同批命令'));
  it('事件与任务可在一次原子批次建立双向关联，结案后不可再次改写', () => {
    const e = { ...event(), linkedTaskIds: ['task-a'] };
    const t = { ...task(), linkedEventId: 'event-a' };
    const linked = commit([{ commandId: 'event', type: 'SaveEvent', evidence: '已有预约', event: e },
      { commandId: 'task', type: 'SaveTask', evidence: '安排任务', task: t }]);
    const resolved = commitCommands(linked, 'turn-b', 1, [{ commandId: 'resolve', type: 'SaveEvent', evidence: '预约结束',
      event: { ...e, status: 'resolved', resolvedAt: gameTime, resolutionText: '已完成' } }]);
    expect(() => commitCommands(resolved, 'turn-c', 2, [{ commandId: 'rewrite', type: 'SaveEvent', evidence: '错误重开', event: e }])).toThrow('不能再次');
  });
});

describe('运行时 Schema', () => {
  it.each(organizations)('独立接受 $kind 结构，拒绝其他类别属性', (org) => {
    const state = game(); state.organizations[org.id] = org;
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(GameStateSchema.safeParse({ ...state, organizations: { [org.id]: { ...org, rpgPower: 100 } } }).success).toBe(false);
  });
  it('官方机构拒绝黑帮资金与地盘字段', () => {
    const state = game();
    expect(GameStateSchema.safeParse({ ...state, organizations: { 'org-a': { ...organizations[1], funds: 100, territoryText: '全城' } } }).success).toBe(false);
  });
  it('特殊 NPC 与初始同伴保留目标、习惯和长期记忆字段', () => {
    const special = SpecialNpcSchema.parse({ ...npc(), kind: 'special', detailedBackground: '多年朋友', activeGoals: ['继续工作'], habits: ['晨跑'], longTermMemories: [], offscreenTaskIds: [] });
    const state = game(); state.npc[special.id] = special; state.initialCompanionId = special.id;
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    state.npc[special.id] = npc();
    expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
  it.each([-101, 101, NaN, Infinity])('拒绝非法好感度 %s', (affinity) => {
    const state = game(); state.npc['npc-a'] = { ...npc(), affinity };
    expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
  it('主角不接受传统 RPG 属性', () => {
    const state = game();
    expect(GameStateSchema.safeParse({ ...state, protagonist: { ...state.protagonist, strength: 99 } }).success).toBe(false);
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝无效分金额 %s', (price) => {
    expect(DomainCommandSchema.safeParse({ ...purchase(), price }).success).toBe(false);
  });
  it('拒绝悬空、错键、跨表重复 ID 与错误物品类别', () => {
    const state = game(); state.npc.wrong = npc();
    expect(GameStateSchema.safeParse(state).success).toBe(false);
    state.npc = { hero: { ...npc(), id: 'hero' } };
    expect(GameStateSchema.safeParse(state).success).toBe(false);
    state.npc = {}; state.protagonist.locationId = 'missing';
    expect(GameStateSchema.safeParse(state).success).toBe(false);
    expect(DomainCommandSchema.safeParse({ ...purchase(), item: { id: 'car', name: '车', category: 'vehicle', quantity: 1, conditionText: '' } }).success).toBe(false);
  });
  it('历史引用只允许已知重大结案事件，重复归档被拒绝', () => {
    const state = game(); const e = { ...event(), status: 'resolved' as const, resolvedAt: gameTime, resolutionText: '结束', visibility: 'known' as const };
    state.events[e.id] = e;
    const entry = { eventId: e.id, occurredAt: gameTime, title: e.title, summary: '摘要', outcome: '结束', longTermImpact: '', actorRefs: [], sourceTurnIds: [] };
    state.timeline.push(entry); expect(GameStateSchema.safeParse(state).success).toBe(true);
    state.events[e.id].visibility = 'hidden'; expect(GameStateSchema.safeParse(state).success).toBe(false);
    state.events[e.id].visibility = 'known'; state.timeline.push(entry); expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
  it('事件和任务需要结束时间或明确完成条件，但不自动推进或结算', () => {
    const state = game();
    state.events['event-a'] = { ...event(), estimatedEndAt: undefined };
    state.tasks['task-a'] = { ...task(), dueAt: undefined };
    expect(GameStateSchema.safeParse(state).success).toBe(false);
    state.events['event-a'].completionCondition = '当事人结束会面';
    state.tasks['task-a'].completionCondition = '完成预约';
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(state.events['event-a'].status).toBe('scheduled');
  });
});
