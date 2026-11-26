import { HaremBackgroundCommandSchema, HaremCommandSchema } from './harem/schema';
import { applyHarem, applyHaremBackground } from './harem/apply';
import type { SceneIntervention } from './events/narration';
import { validateStageWrite } from './events/stages';
import { z } from 'zod';
import { AccountSchema, DebtRecordSchema, IncomeRecordSchema, OtherAssetSchema, PropertyAssetSchema, VehicleAssetSchema } from './economy/schema';
import { ActorRefSchema, CommandDataError, DataError, CountSchema, IdSchema, MoneySchema, TextSchema, GameTimeSchema, requireData } from './common';
import { EquipmentSchema } from './protagonist/schema';
import { OwnedItemInputSchema } from './items/schema';
import { NpcCreationSchema, NpcSchema } from './npc/schema';
import { FactionBindingSchema, FinancialBasisSchema, OrganizationChangesSchema, OrganizationSchema, ProtagonistOrgKnowledgeSchema, organizationChangeFields } from './organizations/schema';
import { StoredWorldEventSchema, WorldTaskSchema, HistoryRecordSchema } from './events/schema';
import { GameStateSchema } from './state';
import type { GameState } from './state';
import { variableCommandSchemas, applyVariableCommand, assertImportantItem, unequipItem } from './variableCommands';
import { validateTaskTransitions } from './npc/lifecycle';
import { deleteEvent, validateEventLinks, validateEventWrite } from './events/lifecycle';
import { maintainSceneTransition } from './sceneTransitions';
import { completeTaskEventLinks } from './events/taskLinks';
import { OpeningInitialStateSchema, initializeOpeningState } from './openingInitialization';

const base = { commandId: IdSchema, evidence: TextSchema };
const positiveMoney = MoneySchema.refine((amount) => amount > 0, '金额必须为正');
export const SceneDescriptionField = z.enum(['weatherText', 'environmentText']);
export const DomainCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('InitializeOpeningState'), changes: OpeningInitialStateSchema }),
  z.strictObject({ ...base, type: z.literal('PurchaseItem'), account: AccountSchema, price: positiveMoney, item: OwnedItemInputSchema }),
  z.strictObject({ ...base, type: z.literal('PurchaseVehicle'), account: AccountSchema, price: positiveMoney, vehicle: VehicleAssetSchema }),
  z.strictObject({ ...base, type: z.literal('PurchaseProperty'), account: AccountSchema, price: positiveMoney, property: PropertyAssetSchema }),
  z.strictObject({ ...base, type: z.literal('PurchaseOtherAsset'), account: AccountSchema, price: positiveMoney, asset: OtherAssetSchema }),
  // 原本持有、继承、受赠等不经本回合付款的资产登记；不改变余额。
  z.strictObject({ ...base, type: z.literal('AcquireAsset'), asset: z.discriminatedUnion('kind', [PropertyAssetSchema, VehicleAssetSchema, OtherAssetSchema]) }),
  z.strictObject({ ...base, type: z.literal('TransferFunds'), from: AccountSchema, to: AccountSchema, amount: positiveMoney }),
  z.strictObject({ ...base, type: z.literal('ReceiveIncome'), income: IncomeRecordSchema.extend({ amount: positiveMoney, status: z.literal('received'), receivedAt: GameTimeSchema }) }),
  z.strictObject({ ...base, type: z.literal('Borrow'), account: AccountSchema, debt: DebtRecordSchema.extend({ principal: positiveMoney, outstanding: positiveMoney, status: z.literal('active') }) }),
  z.strictObject({ ...base, type: z.literal('RepayDebt'), account: AccountSchema, debtId: IdSchema, amount: positiveMoney }),
  z.strictObject({ ...base, type: z.literal('CreateNpc'), npc: NpcCreationSchema }),
  z.strictObject({ ...base, type: z.literal('SetEquipment'), equipment: EquipmentSchema }),
  z.strictObject({ ...base, type: z.literal('TransferItem'), itemId: IdSchema, from: ActorRefSchema.nullable(), to: ActorRefSchema }),
  z.strictObject({ ...base, type: z.literal('SetSceneDescription'), field: SceneDescriptionField, value: z.string() }),
  z.strictObject({ ...base, type: z.literal('SetWorldClock'), worldClock: GameTimeSchema }),
  z.strictObject({ ...base, type: z.literal('SaveEvent'), event: StoredWorldEventSchema }),
  z.strictObject({ ...base, type: z.literal('DeleteEvent'), eventId: IdSchema, expectedStatus: z.enum(['resolved','cancelled']), reason: TextSchema }),
  z.strictObject({ ...base, type: z.literal('RecordHistory'), entry: HistoryRecordSchema }),
  z.strictObject({ ...base, type: z.literal('SaveTask'), task: WorldTaskSchema }),
  z.strictObject({ ...base, type: z.literal('CreateOrganization'), organization: OrganizationSchema }),
  z.strictObject({ ...base, type: z.literal('UpdateOrganization'), organizationId: IdSchema, expectedRevision: CountSchema, changes: OrganizationChangesSchema, financialBasis: FinancialBasisSchema.optional() }),
  z.strictObject({ ...base, type: z.literal('RecordOrgRelation'), organizationId: IdSchema, relation: TextSchema, reason: TextSchema, faction: FactionBindingSchema.optional() }),
  z.strictObject({ ...base, type: z.literal('RecordOrgKnowledge'), organizationId: IdSchema, entry: ProtagonistOrgKnowledgeSchema }),
  z.strictObject({ ...base, type: z.literal('RegisterContact'), npcId: IdSchema, reason: TextSchema }),
  // Parse historical drafts/receipts, but never authorize a fresh deletion.
  ...variableCommandSchemas,
  HaremCommandSchema,
  HaremBackgroundCommandSchema,
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
  return [s.protagonist.id, ...s.timeline.map(entry => entry.id), ...[s.npc, s.items, s.organizations, s.events, s.retiredEvents, s.tasks, s.locations,
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
/** 本批新登记的房产关联了房贷时，由程序把房产补进该房贷的抵押物；不因模型漏写而拒绝。只处理本批新登记的房产。 */
function linkMortgages(s: GameState, commands: readonly DomainCommand[]) {
  for (const c of commands) {
    const property = c.type === 'PurchaseProperty' ? c.property : c.type === 'AcquireAsset' && c.asset.kind === 'property' ? c.asset : undefined;
    const debt = property?.mortgageDebtId ? s.economy.debts[property.mortgageDebtId] : undefined;
    if (property && debt && !debt.collateralAssetIds.includes(property.id)) debt.collateralAssetIds.push(property.id);
  }
}
function apply(s: GameState, c: DomainCommand, turnId: string, acknowledgedReceipts: ReadonlySet<string>, pendingSceneClock = false) {
  switch (c.type) {
    case 'ApplyHaremChanges': applyHarem(s,c,turnId,pendingSceneClock); break;
    case 'ApplyHaremBackground': applyHaremBackground(s,c,turnId); break;
    case 'InitializeOpeningState': initializeOpeningState(s, c.changes, (id) => newEntity(s, id)); break;
    case 'PurchaseItem':
      newEntity(s, c.item.id); ownedByProtagonist(s, c.item.ownerRef); assertImportantItem(s, c.item);
      balance(s, c.account, -c.price); s.items[c.item.id] = c.item; break;
    case 'PurchaseVehicle':
      newEntity(s, c.vehicle.id); ownedByProtagonist(s, c.vehicle.ownerRef);
      balance(s, c.account, -c.price); s.economy.vehicles[c.vehicle.id] = c.vehicle; break;
    case 'PurchaseProperty':
      newEntity(s, c.property.id); ownedByProtagonist(s, c.property.ownerRef);
      balance(s, c.account, -c.price); s.economy.properties[c.property.id] = c.property; break;
    case 'PurchaseOtherAsset':
      newEntity(s, c.asset.id); ownedByProtagonist(s, c.asset.ownerRef);
      balance(s, c.account, -c.price); s.economy.otherAssets[c.asset.id] = c.asset; break;
    case 'AcquireAsset':
      newEntity(s, c.asset.id); ownedByProtagonist(s, c.asset.ownerRef);
      if (c.asset.kind === 'property') s.economy.properties[c.asset.id] = c.asset;
      else if (c.asset.kind === 'vehicle') s.economy.vehicles[c.asset.id] = c.asset;
      else s.economy.otherAssets[c.asset.id] = c.asset;
      break;
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
      // 仅重要成年女性可携带私密档案
      if (c.npc.kind === 'special' && c.npc.privateProfile) {
        requireData(c.npc.gender === 'female' && (c.npc.age === undefined || c.npc.age >= 18),
          'NPC_KIND', '仅重要成年女性 NPC 可持有私密档案');
      }
      newEntity(s, c.npc.id);
      requireData(!Object.values(s.npc).some((npc) => npc.identityKey === c.npc.identityKey), 'DUPLICATE_NPC', 'NPC 稳定身份已存在');
      requireData(!Object.values(s.npc).some((npc) => npc.aliases.includes(c.npc.name)
        || c.npc.aliases.includes(npc.name) || npc.aliases.some((alias) => c.npc.aliases.includes(alias))
        || (npc.id === s.initialCompanionId && npc.name === c.npc.name)),
        'AMBIGUOUS_NPC', '别名或初始同伴身份重叠，需先确认已有稳定 ID');
      s.npc[c.npc.id] = NpcSchema.parse(c.npc.kind === 'special'
        ? { ...c.npc, memories: [...c.npc.memories, ...(c.npc.longTermMemories ?? [])], longTermMemories: [] } : c.npc); break;
    case 'RegisterContact':
      requireData(s.npc[c.npcId], 'NOT_FOUND', '联系人不存在');
      if (!s.contactNpcIds.includes(c.npcId)) s.contactNpcIds.push(c.npcId);
      break;
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
    case 'SetSceneDescription':
      requireData(s.turnNumber > 0, 'OPENING_INITIALIZATION', '开局天气与环境须通过开局初始化写入');
      s[c.field] = c.value;
      break;
    case 'SetWorldClock':
      requireData(Date.parse(c.worldClock) >= Date.parse(s.worldClock), 'TIME_REVERSED', '游戏时间不可倒退');
      s.worldClock = c.worldClock; break;
    case 'SaveEvent': {
      const old = s.events[c.event.id];
      if (!old) newEntity(s, c.event.id);
      requireData(!old || !['resolved', 'cancelled'].includes(old.status) || fingerprint(old) === fingerprint(c.event),
        'TERMINAL_EVENT', '已结案或取消事件不能再次变更');
      const previous = old?.protagonistEntry, entry = c.event.protagonistEntry;
      const sameEntry = fingerprint(previous) === fingerprint(entry);
      requireData(previous?.status !== 'acknowledged' || sameEntry, 'EVENT_ENTRY', '已收悉的回执不可改写');
      if (entry?.status === 'acknowledged' && !sameEntry) {
        requireData(acknowledgedReceipts.has(c.commandId)
          && (old?.entryIntent === 'notification' || (old?.entryIntent === undefined && old?.eventKind === 'sub'
            && previous?.status === 'presented' && entry.recoverySource === 'player-confirmed-legacy-notification'))
          && previous?.id === entry.id && (previous.status === 'pending' || previous.status === 'presented'),
          'EVENT_ENTRY', '收悉状态只能来自本轮合法 Story 回执');
      }
      validateEventWrite(old,c.event);
      s.events[c.event.id] = c.event; break;
    }
    case 'DeleteEvent': deleteEvent(s,c.eventId,c.expectedStatus,turnId); break;
    case 'RecordHistory':
      newEntity(s, c.entry.id);
      s.timeline.push({ ...c.entry, recordedAt: s.worldClock, sourceTurnId: turnId }); break;
    case 'SaveTask': {
      requireData(c.task.dueAt || c.task.completionCondition?.trim(),'TASK_PLAN','任务新写入需要截止时间或完成条件');
      const old = s.tasks[c.task.id];
      if (!old) newEntity(s, c.task.id);
      requireData(!old || !['completed', 'cancelled'].includes(old.status) || fingerprint(old) === fingerprint(c.task),
        'TERMINAL_TASK', '已完成或取消任务不能再次变更');
      s.tasks[c.task.id] = c.task; break;
    }
    case 'CreateOrganization':
      newEntity(s, c.organization.id);
      requireData(!c.organization.protagonistKnown?.length, 'ORGANIZATION_KNOWLEDGE', '主角已知条目只能用RecordOrgKnowledge逐条记录');
      requireData(!Object.values(s.organizations).some(org => org.kind === c.organization.kind && org.name === c.organization.name), 'DUPLICATE_ORGANIZATION', '同类组织名称已存在，应复用稳定ID');
      s.organizations[c.organization.id] = c.organization; break;
    case 'UpdateOrganization': {
      const old = s.organizations[c.organizationId];
      requireData(old, 'NOT_FOUND', '组织不存在');
      requireData(s.revision === c.expectedRevision, 'ENTITY_CONFLICT', '组织更新版本冲突');
      requireData(Object.keys(c.changes).every(key => organizationChangeFields[old.kind].includes(key)), 'ORGANIZATION_FIELD', '字段不属于该类组织');
      if (c.changes.name !== undefined) requireData(!Object.values(s.organizations).some(org => org.id !== old.id && org.kind === old.kind && org.name === c.changes.name), 'DUPLICATE_ORGANIZATION', '同类组织名称已存在');
      const financial = ['funds', 'assetsEstimate', 'liquidityEstimate'].some(key => Object.hasOwn(c.changes, key));
      requireData(!financial || c.financialBasis, 'ORGANIZATION_FINANCE', '组织金额更新需要结构化时间与依据说明');
      if (c.financialBasis) requireData(Date.parse(c.financialBasis.at) <= Date.parse(s.worldClock), 'FUTURE_ORGANIZATION_FINANCE', '组织财务依据时间不能晚于当前游戏时间');
      // These are organization-owned figures, never player transactions or income.
      const changes = { ...c.changes };
      if (changes.departments) {
        // 部门撤销或重组：指向已撤销部门的成员与主角部门归属同步清空，职位保留，不让正常重组卡住整回合。
        // 只处理原有、本次被撤销的部门；从未存在的部门引用仍按坏数据拒绝。
        const kept = new Set(changes.departments.map(row => row.id));
        const removed = new Set((old.departments ?? []).map(row => row.id).filter(id => !kept.has(id)));
        const members = changes.members ?? old.members;
        if (members && removed.size) changes.members = members.map(({ departmentId, ...row }) => departmentId && removed.has(departmentId) ? row : { ...row, ...(departmentId ? { departmentId } : {}) });
        const faction = s.protagonistFaction;
        if (faction?.organizationId === old.id && faction.departmentId && removed.has(faction.departmentId)) {
          const { departmentId: _removed, ...rest } = faction; void _removed;
          s.protagonistFaction = rest;
        }
      }
      s.organizations[old.id] = OrganizationSchema.parse({ ...old, ...changes });
      break;
    }
    case 'RecordOrgRelation': {
      const org = s.organizations[c.organizationId];
      requireData(org, 'NOT_FOUND', '组织不存在');
      org.protagonistRelation = c.relation; org.relationHistory.push(c.reason);
      if (c.faction) applyFactionBinding(s, org.id, c.faction);
      break;
    }
    case 'RecordOrgKnowledge': {
      const org = s.organizations[c.organizationId];
      requireData(org, 'NOT_FOUND', '组织不存在');
      requireData(!(org.protagonistKnown ?? []).some(row => row.id === c.entry.id), 'DUPLICATE_ORGANIZATION_KNOWLEDGE', '已知条目ID重复');
      requireData(Date.parse(c.entry.learnedAt) <= Date.parse(s.worldClock), 'ORGANIZATION_KNOWLEDGE', '得知时间不能晚于当前游戏时间');
      org.protagonistKnown = [...(org.protagonistKnown ?? []), c.entry];
      break;
    }
    default: applyVariableCommand(s, c, turnId, (id) => newEntity(s, id), (account, amount) => balance(s, account, -amount), pendingSceneClock);
  }
}

/** 主势力绑定只有一份：绑定新势力即解除旧势力，旧组织关系历史留一条程序记录。 */
function applyFactionBinding(s: GameState, organizationId: string, binding: z.infer<typeof FactionBindingSchema>) {
  const current = s.protagonistFaction, org = s.organizations[organizationId];
  if (binding.action === 'bind') {
    if (current && current.organizationId !== organizationId)
      s.organizations[current.organizationId]?.relationHistory.push(`主角改以「${org.name}」为主势力，不再以本组织为主势力`);
    s.protagonistFaction = { organizationId, position: binding.position, bondText: binding.bondText,
      ...(binding.departmentId ? { departmentId: binding.departmentId } : {}),
      joinedAt: current?.organizationId === organizationId ? current.joinedAt : s.worldClock };
    return;
  }
  requireData(current?.organizationId === organizationId, 'FACTION_BINDING', '主角当前不以该组织为主势力');
  if (binding.action === 'unbind') { delete s.protagonistFaction; return; }
  const { departmentId, ...rest } = current;
  s.protagonistFaction = { ...rest,
    ...(binding.position !== undefined ? { position: binding.position } : {}),
    ...(binding.bondText !== undefined ? { bondText: binding.bondText } : {}),
    ...(binding.departmentId === null ? {} : binding.departmentId !== undefined ? { departmentId: binding.departmentId } : departmentId ? { departmentId } : {}) };
}

/** Provisional entity state retains the formal revision. The scene supplies the upper time bound at settlement. */
export function projectEntityChanges(state: GameState, turnId: string, commands: readonly DomainCommand[]) {
  const projected = structuredClone(state);
  const receipts = new Set<string>();
  const family = commands.filter(command => command.type === 'ApplyHaremChanges');
  requireData(family.length <= 1, 'HAREM_BATCH', '同阶段只能提交一组家庭变更');
  for (const command of [...commands.filter(command => command.type !== 'ApplyHaremChanges'), ...family]) {
    try {
      apply(projected, structuredClone(command), turnId, receipts, true);
    } catch (error) {
      if (error instanceof DataError) throw new CommandDataError(error, commands.indexOf(command), command.type);
      throw error;
    }
  }
  return projected;
}

export function commitCommands(state: GameState, turnId: string, expectedRevision: number,
  commands: readonly DomainCommand[], now = new Date().toISOString(),
  sceneAuthority: ReadonlyMap<string,SceneIntervention> = new Map(),
  acknowledgedReceipts: ReadonlySet<string> = new Set()): GameState {
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
  // 事件清理在引用写入后执行。
  const cleanup = (c: DomainCommand) => c.type==='DeleteEvent';
  // Family references and timestamps use the final NPCs and clock of this batch.
  // Variables 的家庭变更先落地，World 的场外推进在其结果上执行。
  const household = fresh.filter(c => c.type === 'ApplyHaremChanges'), background = fresh.filter(c => c.type === 'ApplyHaremBackground');
  requireData(household.length <= 1 && background.length <= 1, 'HAREM_BATCH', '同一批次每个阶段只能提交一组家庭变更');
  const ordered = [...fresh.filter(c => !cleanup(c) && c.type !== 'ApplyHaremChanges' && c.type !== 'ApplyHaremBackground'), ...household, ...background, ...fresh.filter(cleanup)];
  for (const command of ordered) {
    try { apply(current, command, turnId, acknowledgedReceipts); }
    catch (error) {
      if (error instanceof DataError) throw new CommandDataError(error, parsed.indexOf(command), command.type);
      throw error;
    }
    current.appliedCommands.push({ turnId, commandId: command.commandId, fingerprint: fingerprint(command) });
  }
  linkMortgages(current, fresh);
  validateTaskTransitions(state, current, fresh.flatMap((c) => c.type === 'SaveTask' ? [c.task] : []));
  completeTaskEventLinks(state, current);
  maintainSceneTransition(state, current, fresh);
  for(const command of fresh) if(command.type==='SaveEvent')
    validateStageWrite(state.events[command.event.id],command.event,current.worldClock,turnId,sceneAuthority.get(command.commandId), acknowledgedReceipts.has(command.commandId));
  validateEventLinks(current);
  // A first committed batch consumes the opening-only right even if the model omitted initialization.
  // Projections mutate only this parsed copy; failed/cancelled drafts keep the formal marker.
  delete current.openingInitializationPending;
  current.revision += 1;
  current.updatedAt = now;
  return GameStateSchema.parse(current);
}
