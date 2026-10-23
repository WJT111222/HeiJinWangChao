import { z } from 'zod';
import { ActorRefSchema, IdsSchema, CountSchema, GameTimeSchema, IdSchema, TextSchema, entityTable } from './common';
import { ProtagonistSchema } from './protagonist/schema';
import { NpcSchema, SpecialNpcSchema } from './npc/schema';
import { ImportantItemSchema } from './items/schema';
import { EconomySchema } from './economy/schema';
import { OrganizationSchema } from './organizations/schema';
import { TimelineEntrySchema, WorldEventSchema, WorldTaskSchema } from './events/schema';
import { MemoryStateSchema, npcKnowledgeKind } from './memories/schema';

export const LocationSchema = z.strictObject({ id: IdSchema, name: TextSchema, parentId: IdSchema.optional() });
export const StorySchema = z.strictObject({
  turnKind: z.enum(['opening', 'regular']), narrative: TextSchema, summary: z.string(),
  variableGuide: z.array(z.strictObject({
    group: z.enum(['protagonist', 'npc', 'items', 'economy', 'organization', 'time', 'event']),
    subjectHint: z.string().optional(), observedFact: TextSchema, textEvidence: z.string().optional(),
  })), actionOptions: z.array(TextSchema).optional(),
});
export const RetiredNpcSchema = z.strictObject({
  id: IdSchema, identityKey: TextSchema, name: TextSchema, aliases: z.array(TextSchema),
  retiredAt: GameTimeSchema, sourceTurnIds: IdsSchema,
});
export const SaveShape = {
  schemaVersion: z.literal(4), saveId: IdSchema, title: TextSchema,
  createdAt: GameTimeSchema, updatedAt: GameTimeSchema, revision: CountSchema, turnNumber: CountSchema,
  worldClock: GameTimeSchema, weatherText: z.string(), environmentText: z.string(),
  protagonist: ProtagonistSchema, initialCompanionId: IdSchema.optional(),
  contactNpcIds: IdsSchema, contactReviewNpcIds: IdsSchema, retiredNpcs: entityTable(RetiredNpcSchema),
  npc: entityTable(NpcSchema), items: entityTable(ImportantItemSchema), economy: EconomySchema,
  organizations: entityTable(OrganizationSchema), locations: entityTable(LocationSchema),
  events: entityTable(WorldEventSchema), tasks: entityTable(WorldTaskSchema), memories: MemoryStateSchema,
  timeline: z.array(TimelineEntrySchema),
  journal: z.array(z.strictObject({
    turnId: IdSchema, revision: CountSchema, story: StorySchema, relatedActorRefs: z.array(ActorRefSchema),
  })),
  appliedCommands: z.array(z.strictObject({
    turnId: IdSchema, commandId: IdSchema, fingerprint: TextSchema,
  })),
};

export const GameStateSchema = z.strictObject(SaveShape).superRefine((s, ctx) => {
  function check(ok: unknown, message: string) {
    if (!ok) ctx.addIssue({ code: 'custom', message });
  }
  const allIds = [s.protagonist.id];
  const tables = [s.npc, s.retiredNpcs, s.items, s.organizations, s.locations, s.events, s.tasks,
    s.economy.incomes, s.economy.debts, s.economy.properties, s.economy.vehicles, s.economy.otherAssets];
  for (const table of tables) allIds.push(...Object.keys(table));
  check(new Set(allIds).size === allIds.length, '实体 ID 必须在存档内全局唯一');
  function actor(ref: z.infer<typeof ActorRefSchema>, historical = false) {
    check(ref.kind === 'protagonist' ? ref.id === s.protagonist.id
      : ref.kind === 'npc' ? (Object.hasOwn(s.npc, ref.id) || (historical && Object.hasOwn(s.retiredNpcs, ref.id))) : Object.hasOwn(s.organizations, ref.id), '参与者引用不存在');
  }
  function location(id?: string) { if (id) check(Object.hasOwn(s.locations, id), '地点引用不存在'); }
  function timeRange(start: string, end?: string) {
    if (end) check(Date.parse(end) >= Date.parse(start), '结束时间早于开始时间');
  }
  timeRange(s.createdAt, s.updatedAt);
  location(s.protagonist.locationId);
  if (s.initialCompanionId) check(s.npc[s.initialCompanionId]?.kind === 'special', '初始同伴必须是特殊 NPC');
  for (const id of s.contactNpcIds) check(Object.hasOwn(s.npc, id), '联系人必须保留完整 NPC');
  for (const id of s.contactReviewNpcIds) check(Object.hasOwn(s.npc, id) && !s.contactNpcIds.includes(id), '旧档待复核人物须存在且不是正式联系人');
  for (const retired of Object.values(s.retiredNpcs)) check(Date.parse(retired.retiredAt) <= Date.parse(s.worldClock), '退场时间在未来');
  const identities = [...Object.values(s.npc), ...Object.values(s.retiredNpcs)].map((npc) => npc.identityKey);
  check(new Set(identities).size === identities.length, 'NPC 稳定身份重复');
  for (const node of Object.values(s.locations)) {
    location(node.parentId);
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent && s.locations[parent]) {
      if (visited.has(parent)) { check(false, '地点层级存在环'); break; }
      visited.add(parent); parent = s.locations[parent].parentId;
    }
  }
  for (const npc of Object.values(s.npc)) {
    location(npc.locationId);
    if (npc.onScene && npc.locationId) check(npc.locationId === s.protagonist.locationId, '在场 NPC 与主角地点不一致');
    if (npc.kind === 'special') for (const id of npc.offscreenTaskIds) {
      check(s.tasks[id]?.actorRef.kind === 'npc' && s.tasks[id]?.actorRef.id === npc.id, 'NPC 任务归属错误');
    }
    for (const memory of [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])]) {
      for (const ref of memory.affectedEntityRefs) actor(ref, true);
    }
  }
  const wear = s.protagonist.currentWear;
  const equipped = [wear.topItemId, wear.bottomItemId, wear.shoesItemId,
    ...wear.accessoryItemIds, wear.primaryWeaponItemId, wear.secondaryWeaponItemId].filter((id) => id !== undefined);
  check(new Set(equipped).size === equipped.length, '同一物品不能重复装备');
  const slots = [[wear.topItemId, 'top'], [wear.bottomItemId, 'bottom'], [wear.shoesItemId, 'shoes'],
    ...wear.accessoryItemIds.map((id) => [id, 'accessory']),
    [wear.primaryWeaponItemId, 'weapon'], [wear.secondaryWeaponItemId, 'weapon']];
  for (const [id, category] of slots) if (id) {
    const item = s.items[id];
    check(item?.category === category && item?.ownerRef?.kind === 'protagonist'
      && item?.ownerRef?.id === s.protagonist.id, '装备类别或物品归属错误');
  }
  if (wear.currentVehicleAssetId) {
    const vehicle = s.economy.vehicles[wear.currentVehicleAssetId];
    check(vehicle?.ownerRef.kind === 'protagonist' && vehicle?.ownerRef.id === s.protagonist.id, '载具引用归属错误');
  }
  for (const item of Object.values(s.items)) { if (item.ownerRef) actor(item.ownerRef); location(item.locationId); }
  const assets = [...Object.values(s.economy.properties), ...Object.values(s.economy.vehicles), ...Object.values(s.economy.otherAssets)];
  for (const asset of assets) {
    actor(asset.ownerRef);
    if ('locationId' in asset) location(asset.locationId);
    if (asset.kind === 'property' && asset.mortgageDebtId) check(Object.hasOwn(s.economy.debts, asset.mortgageDebtId), '房贷不存在');
  }
  for (const debt of Object.values(s.economy.debts)) {
    for (const id of debt.collateralAssetIds) check(assets.some((a) => a.id === id), '抵押资产不存在');
    if (debt.principal !== null && debt.outstanding !== null) check(debt.outstanding <= debt.principal, '未偿本金超过本金');
    if (debt.status === 'repaid') check(debt.outstanding === 0, '已还清债务余额必须为零');
  }
  for (const income of Object.values(s.economy.incomes)) if (income.status === 'received') {
    check(income.amount !== null && income.receivedAt && Date.parse(income.receivedAt) <= Date.parse(s.worldClock), '已入账收入缺少实际金额或合法到账时间');
  }
  for (const org of Object.values(s.organizations)) {
    for (const id of org.keyNpcIds) check(Object.hasOwn(s.npc, id), '组织成员不存在');
    for (const id of org.currentTaskIds) check(s.tasks[id]?.actorRef.kind === 'organization'
      && s.tasks[id]?.actorRef.id === org.id, '组织任务归属错误');
  }
  for (const event of Object.values(s.events)) {
    location(event.locationId); event.actorRefs.forEach((ref) => actor(ref, true)); timeRange(event.startAt, event.estimatedEndAt);
    check(event.estimatedEndAt || event.resolvedAt || event.completionCondition?.trim(), '事件缺少预计结束时间或完成条件');
    timeRange(event.startAt, event.resolvedAt);
    if (event.status === 'resolved') check(event.resolvedAt && event.resolutionText
      && Date.parse(event.resolvedAt) <= Date.parse(s.worldClock), '已完成事件缺少合法结案时间或结局');
    for (const id of event.linkedTaskIds) check(s.tasks[id]?.linkedEventId === event.id, '事件关联任务错误');
  }
  for (const task of Object.values(s.tasks)) {
    actor(task.actorRef, ['completed', 'cancelled'].includes(task.status)); location(task.locationId); timeRange(task.startAt, task.dueAt);
    check(task.dueAt || task.completionCondition?.trim(), '任务缺少截止时间或完成条件');
    if (task.resolution) {
      check(['completed', 'cancelled'].includes(task.status), '未终结任务不能预存成果');
      check((task.status === 'completed') === (task.resolution.outcome === 'success'), '成果与任务终态不符');
      check(Date.parse(task.resolution.at) <= Date.parse(s.worldClock), '任务成果时间在未来');
      if (task.status === 'completed') timeRange(task.startAt, task.resolution.at);
    }
    if (task.handoff) {
      const prior = s.tasks[task.handoff.fromTaskId];
      check(prior && ['completed', 'cancelled'].includes(prior.status) && prior.resolution, '交接缺少已成立的前序成果');
      check(prior?.resolution && Date.parse(prior.resolution.at) <= Date.parse(task.handoff.at)
        && Date.parse(task.handoff.at) <= Date.parse(task.startAt), '交接时间不合法');
      check(prior?.resolution?.result.includes(task.handoff.summaryBasis?.resultExcerpt ?? task.handoff.content), '交接内容超出实际成果');
      const visited = new Set([task.id]);
      let cursor: typeof task | undefined = prior;
      while (cursor) {
        if (visited.has(cursor.id)) { check(false, '任务交接存在环'); break; }
        visited.add(cursor.id); cursor = cursor.handoff ? s.tasks[cursor.handoff.fromTaskId] : undefined;
      }
    }
    if (task.linkedEventId) check(s.events[task.linkedEventId]?.linkedTaskIds.includes(task.id), '任务关联事件错误');
  }
  check(new Set(s.timeline.map((entry) => entry.eventId)).size === s.timeline.length, '历史事件重复归档');
  for (const entry of s.timeline) {
    const event = s.events[entry.eventId];
    check(event?.status === 'resolved' && event.impact === 'major' && event.visibility === 'known', '历史条目必须引用已知重大结案事件');
    location(entry.locationId); entry.actorRefs.forEach((ref) => actor(ref, true));
  }
  for (const id of Object.keys(s.memories.npcSummaries)) check(Object.hasOwn(s.npc, id), '记忆所属 NPC 不存在');
  for (const [id, summaries] of Object.entries(s.memories.npcSummaries)) {
    const covered = summaries.flatMap((entry) => entry.npcProvenance?.sourceMemoryIds ?? []);
    check(new Set(covered).size === covered.length, '私人总结重复覆盖原始来源');
    for (const summary of summaries) {
      const source = summary.npcProvenance;
      if (!source) continue; // 旧档不补造来源。
      const npc = s.npc[id];
      check(npc && source.npcId === id && source.identityKey === npc.identityKey, '私人总结所属身份不符');
      check(summary.visibility === (source.sourceVisibility === 'internal' ? 'internal' : 'npc_private'), '私人总结权限升级');
      const raw = npc ? [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])] : [];
      const selected = raw.filter((entry) => source.sourceMemoryIds.includes(entry.id));
      for (const memoryId of source.sourceMemoryIds) {
        const entries = raw.filter((memory) => memory.id === memoryId);
        check(entries.length === 1 && entries[0].visibility === source.sourceVisibility && npcKnowledgeKind(entries[0]) === source.knowledgeKind, '私人总结来源或认知性质不符');
      }
      check(selected.every((entry) => entry.affectedEntityRefs.some((ref) => ref.kind === 'npc' && ref.id === id)), '私人总结缺少原始所属引用');
      const sameIds = (a: string[], b: string[]) => [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|');
      check(sameIds(summary.sourceTurnIds, selected.flatMap((entry) => entry.sourceTurnIds)), '私人总结回合来源不符');
      check(sameIds(summary.affectedEntityRefs.map((ref) => `${ref.kind}:${ref.id}`), selected.flatMap((entry) => entry.affectedEntityRefs.map((ref) => `${ref.kind}:${ref.id}`))), '私人总结对象来源不符');
      check(Date.parse(summary.createdAtGameTime) === Math.max(...selected.map((entry) => Date.parse(entry.createdAtGameTime))), '私人总结时间来源不符');
    }
  }
  for (const entry of s.memories.long) if (entry.retiredNpcSource) check(Object.hasOwn(s.retiredNpcs, entry.retiredNpcSource.npcId) || Object.hasOwn(s.npc, entry.retiredNpcSource.npcId), '退场历史材料所属身份不存在');
  for (const memory of [...s.memories.short, ...s.memories.medium, ...s.memories.long, ...Object.values(s.memories.npcSummaries).flat()]) memory.affectedEntityRefs.forEach((ref) => actor(ref, true));
  check(new Set(s.journal.map((entry) => entry.turnId)).size === s.journal.length, '回合原文重复');
  check(s.turnNumber === s.journal.length, '已提交回合数与永久原文数量不一致');
  for (const entry of s.journal) { check(entry.revision <= s.revision, '回合版本超前'); entry.relatedActorRefs.forEach((ref) => actor(ref, true)); }
  check(new Set(s.appliedCommands.map((c) => JSON.stringify([c.turnId, c.commandId]))).size === s.appliedCommands.length, '幂等凭据重复');
});
export type GameState = z.infer<typeof GameStateSchema>;

export function createGameState(input: {
  saveId: string; title: string; worldClock: string;
  protagonist: z.infer<typeof ProtagonistSchema>;
  locations: Record<string, z.infer<typeof LocationSchema>>;
  cash?: number | null; onlineBalance?: number | null;
  companion?: z.infer<typeof SpecialNpcSchema>;
}, now = new Date().toISOString()): GameState {
  return GameStateSchema.parse({
    schemaVersion: 4, saveId: input.saveId, title: input.title, worldClock: input.worldClock,
    createdAt: now, updatedAt: now, revision: 0, turnNumber: 0,
    weatherText: '', environmentText: '', protagonist: input.protagonist,
    initialCompanionId: input.companion?.id,
    contactReviewNpcIds: [],
    contactNpcIds: input.companion ? [input.companion.id] : [], retiredNpcs: {},
    npc: input.companion ? { [input.companion.id]: input.companion } : {},
    locations: input.locations, items: {}, organizations: {}, events: {}, tasks: {},
    economy: { cash: input.cash ?? null, onlineBalance: input.onlineBalance ?? null,
      incomes: {}, debts: {}, properties: {}, vehicles: {}, otherAssets: {} },
    memories: { immediateWindowSize: 10, short: [], medium: [], long: [], npcSummaries: {} },
    timeline: [], journal: [], appliedCommands: [],
  });
}
