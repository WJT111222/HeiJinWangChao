import { z } from 'zod';
import { AccountSchema, DebtRecordSchema, IncomeRecordSchema, VehicleAssetSchema } from './economy/schema';
import { ActorRefSchema, CountSchema, IdSchema, IdsSchema, MoneySchema, TextSchema, GameTimeSchema, requireData } from './common';
import { EquipmentSchema } from './protagonist/schema';
import { ImportantItemSchema } from './items/schema';
import { NpcSchema } from './npc/schema';
import { OrganizationSchema } from './organizations/schema';
import { WorldEventSchema, WorldTaskSchema } from './events/schema';
import { GameStateSchema } from './state';
import type { GameState } from './state';
import { variableCommandSchemas, applyVariableCommand, assertImportantItem, unequipItem } from './variableCommands';
import { ContactReviewSchema } from './npc/contactReview';
import { retireNpc, validateTaskTransitions } from './npc/lifecycle';
import { validateSceneTransition } from './sceneTransitions';

const base = { commandId: IdSchema, evidence: TextSchema };
const positiveMoney = MoneySchema.refine((amount) => amount > 0, '金额必须为正');
export const DomainCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('PurchaseItem'), account: AccountSchema, price: positiveMoney, item: ImportantItemSchema }),
  z.strictObject({ ...base, type: z.literal('PurchaseVehicle'), account: AccountSchema, price: positiveMoney, vehicle: VehicleAssetSchema }),
  z.strictObject({ ...base, type: z.literal('TransferFunds'), from: AccountSchema, to: AccountSchema, amount: positiveMoney }),
  z.strictObject({ ...base, type: z.literal('ReceiveIncome'), income: IncomeRecordSchema.extend({ amount: positiveMoney, status: z.literal('received'), receivedAt: GameTimeSchema }) }),
  z.strictObject({ ...base, type: z.literal('Borrow'), account: AccountSchema, debt: DebtRecordSchema.extend({ principal: positiveMoney, outstanding: positiveMoney, status: z.literal('active') }) }),
  z.strictObject({ ...base, type: z.literal('RepayDebt'), account: AccountSchema, debtId: IdSchema, amount: positiveMoney }),
  z.strictObject({ ...base, type: z.literal('CreateNpc'), npc: NpcSchema }),
  z.strictObject({ ...base, type: z.literal('SetEquipment'), equipment: EquipmentSchema }),
  z.strictObject({ ...base, type: z.literal('TransferItem'), itemId: IdSchema, from: ActorRefSchema.nullable(), to: ActorRefSchema }),
  z.strictObject({ ...base, type: z.literal('SetWorldClock'), worldClock: GameTimeSchema }),
  z.strictObject({ ...base, type: z.literal('SaveEvent'), event: WorldEventSchema }),
  z.strictObject({ ...base, type: z.literal('SaveTask'), task: WorldTaskSchema }),
  z.strictObject({ ...base, type: z.literal('CreateOrganization'), organization: OrganizationSchema }),
  z.strictObject({ ...base, type: z.literal('RecordOrgRelation'), organizationId: IdSchema, relation: TextSchema, reason: TextSchema }),
  z.strictObject({ ...base, type: z.literal('RegisterContact'), npcId: IdSchema, reason: TextSchema }),
  z.strictObject({ ...base, type: z.literal('RetireNpc'), npcId: IdSchema, expectedIdentityKey: TextSchema, reason: TextSchema, retainMemoryIds: IdsSchema, contactReview: ContactReviewSchema.optional() }),
  ...variableCommandSchemas,
]);
export type DomainCommand = z.infer<typeof DomainCommandSchema>;

// 确定性编码：字段顺序变化不影响幂等比较，数组顺序仍有语义。
export function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${fingerprint(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function allEntityIds(s: GameState): string[] {
  return [s.protagonist.id, ...[s.npc, s.retiredNpcs, s.items, s.organizations, s.events, s.tasks, s.locations,
    s.economy.incomes, s.economy.debts, s.economy.properties, s.economy.vehicles, s.economy.otherAssets].flatMap(Object.keys)];
}
function newEntity(s: GameState, id: string) {
  requireData(!allEntityIds(s).includes(id), 'DUPLICATE_ID', `实体 ID 已存在：${id}`);
}
function balance(s: GameState, account: 'cash' | 'onlineBalance', change: number) {
  const old = s.economy[account];
  requireData(old !== null, 'UNKNOWN_BALANCE', '余额未定，不能执行交易');
  const next = old + change;
  requireData(Number.isSafeInteger(next) && next >= 0, 'INSUFFICIENT_FUNDS', '资金不足或金额超出安全范围');
  s.economy[account] = next;
}
function ownedByProtagonist(s: GameState, ref: z.infer<typeof ActorRefSchema> | undefined) {
  requireData(ref?.kind === 'protagonist' && ref.id === s.protagonist.id, 'OWNERSHIP', '购买对象必须归主角持有');
}
function apply(s: GameState, c: DomainCommand, turnId: string) {
  switch (c.type) {
    case 'PurchaseItem':
      newEntity(s, c.item.id); ownedByProtagonist(s, c.item.ownerRef); assertImportantItem(s, c.item);
      balance(s, c.account, -c.price); s.items[c.item.id] = c.item; break;
    case 'PurchaseVehicle':
      newEntity(s, c.vehicle.id); ownedByProtagonist(s, c.vehicle.ownerRef);
      balance(s, c.account, -c.price); s.economy.vehicles[c.vehicle.id] = c.vehicle; break;
    case 'TransferFunds':
      requireData(c.from !== c.to, 'SAME_ACCOUNT', '内部转账需要两个不同账户');
      balance(s, c.from, -c.amount); balance(s, c.to, c.amount); break;
    case 'ReceiveIncome':
      newEntity(s, c.income.id);
      requireData(Date.parse(c.income.receivedAt) <= Date.parse(s.worldClock), 'FUTURE_INCOME', '未来收入不能提前入账');
      balance(s, c.income.account, c.income.amount); s.economy.incomes[c.income.id] = c.income; break;
    case 'Borrow':
      newEntity(s, c.debt.id);
      requireData(c.debt.principal === c.debt.outstanding, 'DEBT_AMOUNT', '新借款本金与未偿本金不一致');
      balance(s, c.account, c.debt.principal); s.economy.debts[c.debt.id] = c.debt; break;
    case 'RepayDebt': {
      const debt = s.economy.debts[c.debtId];
      requireData(debt && debt.status === 'active' && debt.outstanding !== null
        && debt.outstanding >= c.amount, 'DEBT_AMOUNT', '债务不存在、未定或还款金额过大');
      balance(s, c.account, -c.amount); debt.outstanding -= c.amount;
      if (debt.outstanding === 0) debt.status = 'repaid';
      break;
    }
    case 'CreateNpc':
      // 再出现只能复用历史稳定身份，不能把旧人换ID重新建档或恢复不存在的旧关系。
      if (s.retiredNpcs[c.npc.id]) {
        const prior = s.retiredNpcs[c.npc.id];
        requireData(prior.identityKey === c.npc.identityKey && prior.name === c.npc.name, 'NPC_IDENTITY', '历史身份不一致');
        delete s.retiredNpcs[c.npc.id];
      }
      newEntity(s, c.npc.id);
      requireData(!Object.values(s.retiredNpcs).some((n) => n.identityKey === c.npc.identityKey), 'DUPLICATE_NPC', '历史人物应复用稳定ID');
      requireData(!Object.values(s.npc).some((npc) => npc.identityKey === c.npc.identityKey), 'DUPLICATE_NPC', 'NPC 稳定身份已存在');
      requireData(!Object.values(s.npc).some((npc) => npc.aliases.includes(c.npc.name)
        || c.npc.aliases.includes(npc.name) || npc.aliases.some((alias) => c.npc.aliases.includes(alias))
        || (npc.id === s.initialCompanionId && npc.name === c.npc.name)),
        'AMBIGUOUS_NPC', '别名或初始同伴身份重叠，需先确认已有稳定 ID');
      s.npc[c.npc.id] = c.npc; break;
    case 'RegisterContact':
      requireData(s.npc[c.npcId], 'NOT_FOUND', '联系人不存在');
      if (!s.contactNpcIds.includes(c.npcId)) s.contactNpcIds.push(c.npcId);
      s.contactReviewNpcIds = s.contactReviewNpcIds.filter((id) => id !== c.npcId);
      break;
    case 'RetireNpc': retireNpc(s, c.npcId, c.expectedIdentityKey, c.retainMemoryIds, turnId, c.contactReview); break;
    case 'SetEquipment': s.protagonist.currentWear = c.equipment; break;
    case 'TransferItem': {
      const item = s.items[c.itemId];
      requireData(item && (c.from === null ? item.ownerRef === undefined : fingerprint(item.ownerRef) === fingerprint(c.from)), 'OWNERSHIP', '物品前持有人不符');
      item.ownerRef = c.to;
      if (c.to.kind !== 'protagonist' || c.to.id !== s.protagonist.id) {
        unequipItem(s, item.id);
      }
      break;
    }
    case 'SetWorldClock':
      requireData(Date.parse(c.worldClock) >= Date.parse(s.worldClock), 'TIME_REVERSED', '游戏时间不可倒退');
      s.worldClock = c.worldClock; break;
    case 'SaveEvent': {
      const old = s.events[c.event.id];
      if (!old) newEntity(s, c.event.id);
      requireData(!old || !['resolved', 'cancelled'].includes(old.status) || fingerprint(old) === fingerprint(c.event),
        'TERMINAL_EVENT', '已结案或取消事件不能再次变更');
      s.events[c.event.id] = c.event; break;
    }
    case 'SaveTask': {
      const old = s.tasks[c.task.id];
      if (!old) newEntity(s, c.task.id);
      requireData(!old || !['completed', 'cancelled'].includes(old.status) || fingerprint(old) === fingerprint(c.task),
        'TERMINAL_TASK', '已完成或取消任务不能再次变更');
      s.tasks[c.task.id] = c.task; break;
    }
    case 'CreateOrganization': newEntity(s, c.organization.id); s.organizations[c.organization.id] = c.organization; break;
    case 'RecordOrgRelation': {
      const org = s.organizations[c.organizationId];
      requireData(org, 'NOT_FOUND', '组织不存在');
      org.protagonistRelation = c.relation; org.relationHistory.push(c.reason); break;
    }
    default: applyVariableCommand(s, c, turnId, (id) => newEntity(s, id), (account, amount) => balance(s, account, -amount));
  }
}

export function commitCommands(state: GameState, turnId: string, expectedRevision: number,
  commands: readonly DomainCommand[], now = new Date().toISOString()): GameState {
  const current = GameStateSchema.parse(state);
  requireData(!current.openingTimePending, 'OPENING_TIME', '开局时间待确认，不能将内部占位时钟用于命令执行');
  IdSchema.parse(turnId);
  CountSchema.parse(expectedRevision);
  const parsed = z.array(DomainCommandSchema).parse(commands);
  requireData(new Set(parsed.map((c) => c.commandId)).size === parsed.length, 'DUPLICATE_COMMAND', '同批命令 ID 重复');
  const fresh = parsed.filter((command) => {
    const prior = current.appliedCommands.find((c) => c.turnId === turnId && c.commandId === command.commandId);
    if (!prior) return true;
    requireData(prior.fingerprint === fingerprint(command), 'COMMAND_CONFLICT', '相同命令 ID 的内容发生变化');
    return false;
  });
  if (parsed.length > 0 && fresh.length === 0) return current;
  requireData(current.revision === expectedRevision, 'REVISION_CONFLICT', '存档版本已变化，请重新读取');
  if (fresh.length === 0) return current;
  // 退场最后执行，先让同批经过验证的成果、后续职责及记忆完整落到投影。
  const ordered = [...fresh.filter((c) => c.type !== 'RetireNpc'), ...fresh.filter((c) => c.type === 'RetireNpc')];
  for (const command of ordered) {
    apply(current, command, turnId);
    current.appliedCommands.push({ turnId, commandId: command.commandId, fingerprint: fingerprint(command) });
  }
  validateTaskTransitions(state, current, fresh.flatMap((c) => c.type === 'SaveTask' ? [c.task] : []));
  validateSceneTransition(state, current, fresh);
  current.revision += 1;
  current.updatedAt = now;
  return GameStateSchema.parse(current);
}
