import { z } from 'zod';
import { validateChronicles } from './history/validation';
import { pendingOpeningClock } from './openingTime';
import { ActorRefSchema, IdsSchema, CountSchema, GameTimeSchema, IdSchema, TextSchema, entityTable } from './common';
import { ProtagonistSchema } from './protagonist/schema';
import { NpcSchema, SpecialNpcSchema, DormantNpcProfileSchema, SpecialProfileSchema } from './npc/schema';
import { ImportantItemSchema } from './items/schema';
import { EconomySchema } from './economy/schema';
import { OrganizationSchema } from './organizations/schema';
import { TimelineEntrySchema, StoredWorldEventSchema, WorldTaskSchema, RetiredEventSchema, EventInteractionSchema } from './events/schema';
import { eventById, validateEventLinks } from './events/lifecycle';
import { MemoryStateSchema, npcKnowledgeKind } from './memories/schema';

export const LocationSchema = z.strictObject({ id: IdSchema, name: TextSchema, parentId: IdSchema.optional() });
export const StorySchema = z.strictObject({
  turnKind: z.enum(['opening', 'regular']), narrative: TextSchema, summary: z.string(),
  variableGuide: z.array(z.strictObject({
    group: z.enum(['protagonist', 'npc', 'items', 'economy', 'organization', 'time', 'event']),
    subjectHint: z.string().optional(), observedFact: TextSchema, textEvidence: z.string().optional(),
    eventInteraction: EventInteractionSchema.optional(),
    eventNarration: z.strictObject({eventId:IdSchema,mode:z.enum(['enter','mention']),at:GameTimeSchema}).optional(),
  })), actionOptions: z.array(TextSchema).optional(),
});
export const RetiredNpcSchema = z.strictObject({
  id: IdSchema, identityKey: TextSchema, name: TextSchema, aliases: z.array(TextSchema),
  retiredAt: GameTimeSchema, sourceTurnIds: IdsSchema,
});
export const SaveShape = {
  schemaVersion: z.literal(9), saveId: IdSchema, title: TextSchema,
  createdAt: GameTimeSchema, updatedAt: GameTimeSchema, revision: CountSchema, turnNumber: CountSchema,
  worldClock: GameTimeSchema, openingTimePending: z.literal(true).optional(), weatherText: z.string(), environmentText: z.string(),
  openingInitializationPending: z.literal(true).optional(),
  npcManagementRevision: CountSchema.optional(),
  protagonist: ProtagonistSchema, initialCompanionId: IdSchema.optional(),
  contactNpcIds: IdsSchema, contactReviewNpcIds: IdsSchema, retiredNpcs: entityTable(RetiredNpcSchema),
  npc: entityTable(NpcSchema), items: entityTable(ImportantItemSchema), economy: EconomySchema,
  dormantNpcProfiles: entityTable(DormantNpcProfileSchema).optional(),
  organizations: entityTable(OrganizationSchema), locations: entityTable(LocationSchema),
  events: entityTable(StoredWorldEventSchema), retiredEvents: entityTable(RetiredEventSchema), tasks: entityTable(WorldTaskSchema), memories: MemoryStateSchema,
  timeline: z.array(TimelineEntrySchema),
  journal: z.array(z.strictObject({
    turnId: IdSchema, revision: CountSchema, story: StorySchema, relatedActorRefs: z.array(ActorRefSchema),
  })),
  appliedCommands: z.array(z.strictObject({
    turnId: IdSchema, commandId: IdSchema, fingerprint: TextSchema,
  })),
};

export const GameStateSchema = z.strictObject(SaveShape).superRefine((s, ctx) => {
  function check(ok: unknown, message: string, path: (string | number)[] = [], integrityRule = 'domain_state') {
    if (!ok) ctx.addIssue({ code: 'custom', message, path, params: { integrityRule } });
  }
  // Absence means unavailable, including all older saves. Never infer this right from turnNumber.
  if (s.openingInitializationPending) check(s.revision === 0 && s.turnNumber === 0
    && s.journal.length === 0 && s.appliedCommands.length === 0, '开局初始化标记仅限尚未执行命令的新存档');
  if (s.openingTimePending) check(s.worldClock === pendingOpeningClock && s.revision === 0 && s.turnNumber === 0
    && s.journal.length === 0 && s.appliedCommands.length === 0 && Object.keys(s.events).length === 0
    && Object.keys(s.retiredEvents).length === 0 && Object.keys(s.tasks).length === 0 && s.timeline.length === 0
    && [...s.memories.short, ...s.memories.medium, ...s.memories.long, ...Object.values(s.memories.npcSummaries).flat(),
      ...Object.values(s.npc).flatMap((npc) => npc.memories)].length === 0
    && Object.values(s.npc).every((npc) => !npc.lastInteractionAt) && Object.keys(s.retiredNpcs).length === 0
    && Object.keys(s.economy.incomes).length === 0, '待定开局只能保留无已发生时间事实的初始存档');
  const allIds = [s.protagonist.id, ...s.timeline.map(entry => entry.id)];
  const tables = [s.npc, s.retiredNpcs, s.items, s.organizations, s.locations, s.events, s.retiredEvents, s.tasks,
    s.economy.incomes, s.economy.debts, s.economy.properties, s.economy.vehicles, s.economy.otherAssets];
  for (const table of tables) allIds.push(...Object.keys(table));
  check(new Set(allIds).size === allIds.length, '实体 ID 必须在存档内全局唯一', ['entities'], 'entity_id');
  function actor(ref: z.infer<typeof ActorRefSchema>, historical = false, path: (string | number)[] = []) {
    check(ref.kind === 'protagonist' ? ref.id === s.protagonist.id
      : ref.kind === 'npc' ? (Object.hasOwn(s.npc, ref.id) || (historical && Object.hasOwn(s.retiredNpcs, ref.id))) : Object.hasOwn(s.organizations, ref.id), '参与者引用不存在', path, 'actor_reference');
  }
  function location(id?: string, path: (string | number)[] = []) { if (id) check(Object.hasOwn(s.locations, id), '地点引用不存在', path, 'location_reference'); }
  function timeRange(start: string, end?: string, path: (string | number)[] = []) {
    if (end) check(Date.parse(end) >= Date.parse(start), '结束时间早于开始时间', path, 'event_time');
  }
  timeRange(s.createdAt, s.updatedAt);
  location(s.protagonist.locationId);
  if (s.initialCompanionId) check(Boolean(s.npc[s.initialCompanionId]), '初始同伴必须保留正式身份');
  for (const id of s.contactNpcIds) check(Object.hasOwn(s.npc, id), '联系人必须保留完整 NPC');
  for (const id of s.contactReviewNpcIds) check(Object.hasOwn(s.npc, id) && !s.contactNpcIds.includes(id), '旧档待复核人物须存在且不是正式联系人');
  for (const retired of Object.values(s.retiredNpcs)) check(Date.parse(retired.retiredAt) <= Date.parse(s.worldClock), '退场时间在未来');
  const identities = [...Object.values(s.npc), ...Object.values(s.retiredNpcs)].map((npc) => npc.identityKey);
  check(new Set(identities).size === identities.length, 'NPC 稳定身份重复', ['npc'], 'entity_id');
  for (const node of Object.values(s.locations)) {
    location(node.parentId, ['locations', node.id, 'parentId']);
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent && s.locations[parent]) {
      if (visited.has(parent)) { check(false, '地点层级存在环', ['locations', node.id, 'parentId'], 'location_cycle'); break; }
      visited.add(parent); parent = s.locations[parent].parentId;
    }
  }
  for (const npc of Object.values(s.npc)) {
    check(!npc.importancePreference || npc.importancePreference === npc.kind, '玩家重要性意图与人物身份不一致', ['npc',npc.id,'importancePreference']);
    location(npc.locationId, ['npc', npc.id, 'locationId']);
    for (const [index, place] of (npc.usualLocations ?? []).entries())
      location(place.locationId, ['npc', npc.id, 'usualLocations', index, 'locationId']);
    if (npc.onScene && npc.locationId) check(npc.locationId === s.protagonist.locationId, '在场 NPC 与主角地点不一致');
    if (npc.kind === 'special') validateSpecialProfile(npc, npc.id, ['npc', npc.id]);
    for (const memory of npc.memories) {
      for (const ref of memory.affectedEntityRefs) actor(ref, true);
    }
  }
  function validateSpecialProfile(profile: z.infer<typeof SpecialProfileSchema>, npcId: string, path: (string | number)[]) {
    for (const [index, id] of profile.offscreenTaskIds.entries())
      check(s.tasks[id]?.actorRef.kind === 'npc' && s.tasks[id]?.actorRef.id === npcId,
        'NPC 任务归属错误', [...path, 'offscreenTaskIds', index], 'actor_reference');
    for (const [index, relation] of (profile.relationshipNetwork ?? []).entries()) if (relation.npcId)
      check(relation.npcId !== npcId && (Object.hasOwn(s.npc, relation.npcId) || Object.hasOwn(s.retiredNpcs, relation.npcId)),
        '人物关系引用不存在或指向自身', [...path, 'relationshipNetwork', index, 'npcId'], 'actor_reference');
  }
  for (const [id, archived] of Object.entries(s.dormantNpcProfiles ?? {})) {
    const npc = s.npc[id], path = ['dormantNpcProfiles', id];
    check(npc?.kind === 'ordinary' && npc.identityKey === archived.identityKey,
      '休眠专属档案必须属于同一稳定身份的普通人物', path, 'npc_profile_owner');
    validateSpecialProfile(archived.profile, id, [...path, 'profile']);
    for (const memory of archived.profile.longTermMemories) memory.affectedEntityRefs.forEach(ref => actor(ref, true, path));
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
    const path = (field: string) => ['events', event.id, field];
    if(event.eventKind==='sub') {
      check(Boolean(event.parentEventId && eventById(s,event.parentEventId)?.eventKind==='main' && event.parentEventId!==event.id),
        '小事件父事件不存在或不是主事件', path('parentEventId'), 'event_reference');
      timeRange(event.startAt,event.fixedEndAt,path('fixedEndAt'));
    }
    if(event.continuation?.direction==='protagonist') location(event.continuation.entry.locationId, [...path('continuation'), 'entry', 'locationId']);
    const entry=event.protagonistEntry;
    if(entry) {
      location(entry.locationId, [...path('protagonistEntry'), 'locationId']);
      check(Date.parse(entry.queuedAt)<=Date.parse(s.worldClock) && event.sourceTurnIds.includes(entry.sourceTurnId), '入场安排时间或来源不合法');
      check(entry.status==='pending' ? !entry.handledTurnId && !entry.textEvidence && !['resolved','cancelled'].includes(event.status)
        : Boolean(entry.handledTurnId && entry.textEvidence && event.sourceTurnIds.includes(entry.handledTurnId)), '入场处理缺少合法回执');
    }
    if (event.resultKnowledge) check(['resolved', 'cancelled'].includes(event.status), '未结案事件不能预存成果分类', path('resultKnowledge'), 'event_transition');
    location(event.locationId, path('locationId')); event.actorRefs.forEach((ref, index) => actor(ref, true, [...path('actorRefs'), index])); timeRange(event.startAt, event.estimatedEndAt, path('estimatedEndAt'));
    if(event.status!=='cancelled')timeRange(event.startAt, event.resolvedAt, path('resolvedAt'));
    if(event.resolvedAt)check(Date.parse(event.resolvedAt)<=Date.parse(s.worldClock),'事件实际终止时间在未来', path('resolvedAt'), 'event_time');
    if (event.status === 'resolved') check(event.resolvedAt && event.resolutionText
      && Date.parse(event.resolvedAt) <= Date.parse(s.worldClock), '已完成事件缺少合法结案时间或结局', path('status'), 'event_transition');
    event.linkedTaskIds.forEach((id, index) => check(s.tasks[id]?.linkedEventId === event.id, '事件关联任务错误', [s.events[event.id] ? 'events' : 'retiredEvents', event.id, 'linkedTaskIds', index], 'task_event_link'));
  }
  for (const task of Object.values(s.tasks)) {
    const path = (field: string) => ['tasks', task.id, field];
    actor(task.actorRef, ['completed', 'cancelled'].includes(task.status), path('actorRef')); location(task.locationId, path('locationId')); timeRange(task.startAt, task.dueAt, path('dueAt'));
    if (task.resolution) {
      check(['completed', 'cancelled'].includes(task.status), '未终结任务不能预存成果', path('resolution'), 'task_state');
      check((task.status === 'completed') === (task.resolution.outcome === 'success'), '成果与任务终态不符', [...path('resolution'), 'outcome'], 'task_state');
      check(Date.parse(task.resolution.at) <= Date.parse(s.worldClock), '任务成果时间在未来', [...path('resolution'), 'at'], 'event_time');
      if (task.status === 'completed') timeRange(task.startAt, task.resolution.at, [...path('resolution'), 'at']);
    }
    if (task.handoff) {
      const prior = s.tasks[task.handoff.fromTaskId];
      check(prior && ['completed', 'cancelled'].includes(prior.status) && prior.resolution, '交接缺少已成立的前序成果', [...path('handoff'), 'fromTaskId'], 'task_state');
      check(prior?.resolution && Date.parse(prior.resolution.at) <= Date.parse(task.handoff.at)
        && Date.parse(task.handoff.at) <= Date.parse(task.startAt), '交接时间不合法', [...path('handoff'), 'at'], 'event_time');
      const visited = new Set([task.id]);
      let cursor: typeof task | undefined = prior;
      while (cursor) {
        if (visited.has(cursor.id)) { check(false, '任务交接存在环', [...path('handoff'), 'fromTaskId'], 'task_state'); break; }
        visited.add(cursor.id); cursor = cursor.handoff ? s.tasks[cursor.handoff.fromTaskId] : undefined;
      }
    }
    if (task.linkedEventId) check(eventById(s, task.linkedEventId)?.linkedTaskIds.includes(task.id), '任务关联事件错误', path('linkedEventId'), 'task_event_link');
  }
  const historyIds = new Set(s.timeline.map(entry => entry.id));
  for (const [index, entry] of s.timeline.entries()) {
    const path = (field: string) => ['timeline', index, field];
    check(Date.parse(entry.recordedAt) <= Date.parse(s.worldClock), '历史记录时间在未来', path('recordedAt'), 'event_time');
    if (entry.occurredAt) check(Date.parse(entry.occurredAt) <= Date.parse(entry.recordedAt), '历史发生时间晚于记录时间', path('occurredAt'), 'event_time');
    if (entry.eventId) check(Boolean(eventById(s, entry.eventId)), '历史关联事件不存在', path('eventId'), 'event_reference');
    for (const id of entry.relatedEntryIds) check(id !== entry.id && historyIds.has(id), '关联历史记录不存在或自引用', path('relatedEntryIds'), 'history_reference');
    if (entry.sourceRef) actor(entry.sourceRef, true, path('sourceRef'));
    location(entry.locationId, path('locationId')); entry.actorRefs.forEach((ref, i) => actor(ref, true, [...path('actorRefs'), i]));
  }
  validateChronicles(s, check);
  for (const event of Object.values(s.retiredEvents)) {
    check(Date.parse(event.retiredAt) <= Date.parse(s.worldClock), '事件清理时间在未来');
    if (event.detail) {
      location(event.detail.locationId); event.detail.actorRefs.forEach((ref) => actor(ref, true));
      timeRange(event.detail.startAt, event.detail.estimatedEndAt);
      if(event.status!=='cancelled')timeRange(event.detail.startAt,event.detail.resolvedAt);
      if (event.detail.resolvedAt) check(Date.parse(event.detail.resolvedAt) <= Date.parse(s.worldClock), '事件结案时间在未来');
    }
    event.linkedTaskIds.forEach((id, index) => check(s.tasks[id]?.linkedEventId === event.id, '事件关联任务错误', [s.events[event.id] ? 'events' : 'retiredEvents', event.id, 'linkedTaskIds', index], 'task_event_link'));
  }
  for (const event of [...Object.values(s.events), ...Object.values(s.retiredEvents)]) {
    for (const id of event.predecessorEventIds ?? []) check(Boolean(eventById(s, id)), '事件前序来源不存在');
  }
  try { validateEventLinks(s); } catch { check(false,'事件承接来源无效或成环'); }
  const memoryIds = [...Object.values(s.npc).flatMap(npc => npc.memories), ...s.memories.short, ...s.memories.medium, ...s.memories.long, ...Object.values(s.memories.npcSummaries).flat()].map(entry => entry.id);
  check(new Set(memoryIds).size === memoryIds.length, '记忆ID冲突，无法确定唯一原始来源', ['memories'], 'memory_id');
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
      const raw = npc ? npc.memories : [];
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
    schemaVersion: 9, saveId: input.saveId, title: input.title, worldClock: input.worldClock,
    createdAt: now, updatedAt: now, revision: 0, turnNumber: 0,
    weatherText: '', environmentText: '', protagonist: input.protagonist,
    initialCompanionId: input.companion?.id,
    contactReviewNpcIds: [],
    contactNpcIds: input.companion ? [input.companion.id] : [], retiredNpcs: {},
    npc: input.companion ? { [input.companion.id]: input.companion } : {},
    locations: input.locations, items: {}, organizations: {}, events: {}, retiredEvents: {}, tasks: {},
    economy: { cash: input.cash ?? null, onlineBalance: input.onlineBalance ?? null,
      incomes: {}, debts: {}, properties: {}, vehicles: {}, otherAssets: {} },
    memories: { immediateWindowSize: 10, short: [], medium: [], long: [], npcSummaries: {} },
    timeline: [], journal: [], appliedCommands: [],
  });
}
