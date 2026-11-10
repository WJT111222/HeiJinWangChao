import { z } from 'zod';
import {
  ActorRefSchema,
  CountSchema,
  IdSchema,
  MoneySchema,
  TextSchema,
  requireData,
} from './common';
import { AccountSchema } from './economy/schema';
import { ProtagonistSchema } from './protagonist/schema';
import { OrdinaryNpcSchema, SpecialProfileSchema, PromotionProfileSchema } from './npc/schema';
import { NpcMemorySchema } from './memories/schema';
import { ImportantItemSchema } from './items/schema';
import { LocationSchema } from './state';
import type { GameState } from './state';

const base = { commandId: IdSchema, evidence: TextSchema };
const version = { expectedRevision: CountSchema };
const affinity = z.number().min(-100).max(100);
const protagonistChanges = ProtagonistSchema.pick({
  locationId: true,
  healthText: true,
  emotionText: true,
  profession: true,
  professionDescription: true,
  professionLongTermImpact: true,
  publicStatus: true,
  legalStatus: true,
  skills: true,
}).partial();
const npcChanges = OrdinaryNpcSchema.pick({
  name: true,
  aliases: true,
  identity: true,
  locationId: true,
  onScene: true,
  relationshipText: true,
  healthText: true,
  lastInteractionAt: true,
  gender: true,
  phoneContact: true, usualLocations: true,
})
  .partial()
  .extend({
    locationId: IdSchema.nullable()
      .optional()
      .describe('合法地点 ID；null 显式清除未知去向的地点，须同时离场；省略保持原值'),
    detailedBackground: z.string().optional(),
    habits: SpecialProfileSchema.shape.habits.optional(),
    relationshipNetwork: SpecialProfileSchema.shape.relationshipNetwork,
    privateProfile: z.strictObject({
      bodyDescription: z.string().optional(),
      chestDescription: z.string().optional(),
      pussyDescription: z.string().optional(),
      isVirgin: z.boolean().optional(),
      firstExperienceTarget: z.string().optional(),
      firstExperienceTime: z.string().optional(),
      firstExperienceText: z.string().optional(),
    }).optional(),
  });
const itemChanges = ImportantItemSchema.pick({ description: true, referenceValue: true, itemDetails: true, category: true, questItem: true }).partial().extend({
  quantity: CountSchema.optional(),
  conditionText: z.string().optional(),
  locationId: IdSchema.nullable().optional(),
});
export const variableCommandSchemas = [
  z.strictObject({
    ...base,
    ...version,
    type: z.literal('UpdateProtagonist'),
    protagonistId: IdSchema,
    changes: protagonistChanges.refine((v) => Object.keys(v).length > 0, '没有变化字段'),
  }),
  z
    .strictObject({
      ...base,
      ...version,
      type: z.literal('UpdateNpc'),
      npcId: IdSchema,
      changes: npcChanges,
      affinityChange: z
        .strictObject({ from: affinity.nullable(), to: affinity, reason: TextSchema })
        .optional(),
      activeGoals: z.array(TextSchema).optional(),
    })
    .refine(
      (v) => Object.keys(v.changes).length > 0 || v.affinityChange || v.activeGoals,
      '没有变化字段',
    ),
  z.strictObject({
    ...base,
    ...version,
    type: z.literal('RecordNpcMemory'),
    npcId: IdSchema,
    memory: NpcMemorySchema,
    knowledgeKind: z.enum(['observed', 'reported', 'suspected']),
    layer: z.enum(['personal', 'longTerm']).optional(), // legacy input only; both write npc.memories
    addToKnownInformation: z.boolean(),
  }),
  z.strictObject({ ...base, type: z.literal('CreateLocation'), location: LocationSchema }),
  z.strictObject({
    ...base,
    type: z.literal('SpendFunds'),
    account: AccountSchema,
    amount: MoneySchema.refine((n) => n > 0),
    purpose: TextSchema,
  }),
  z.strictObject({ ...base, type: z.literal('AcquireItem'), item: ImportantItemSchema }),
  z
    .strictObject({
      ...base,
      ...version,
      type: z.literal('UpdateItem'),
      itemId: IdSchema,
      expectedQuantity: CountSchema.refine((n) => n > 0),
      changes: itemChanges.refine((v) => Object.keys(v).length > 0, '没有变化字段'),
      quantityReason: z.enum(['consumption', 'gain']).optional(),
    })
    .refine(
      (v) => (v.changes.quantity !== undefined) === (v.quantityReason !== undefined),
      '数量变化必须说明类别',
    ),
  z.strictObject({
    ...base,
    ...version,
    type: z.literal('LoseItem'),
    itemId: IdSchema,
    expectedOwner: ActorRefSchema,
    locationId: IdSchema.optional(),
    conditionText: TextSchema,
  }),
  z.strictObject({...base,...version,type:z.literal('PromoteNpc'),npcId:IdSchema,identityKey:TextSchema,profile:PromotionProfileSchema.optional()}),
] as const;
export const VariableCommandSchema = z.discriminatedUnion('type', variableCommandSchemas);
export type VariableCommand = z.infer<typeof VariableCommandSchema>;

export function unequipItem(state: GameState, itemId: string) {
  const wear = state.protagonist.currentWear;
  for (const slot of [
    'topItemId',
    'bottomItemId',
    'shoesItemId',
    'primaryWeaponItemId',
    'secondaryWeaponItemId',
  ] as const)
    if (wear[slot] === itemId) delete wear[slot];
  wear.accessoryItemIds = wear.accessoryItemIds.filter((id) => id !== itemId);
}
export function assertImportantItem(state: GameState, item: z.infer<typeof ImportantItemSchema>) {
  requireData(
    !(item.category === 'other' && /汽车|轿车|跑车|摩托车|房产|住宅|公寓/.test(item.name)) &&
      ![...Object.values(state.economy.vehicles), ...Object.values(state.economy.properties)].some(
        (asset) => asset.name === item.name,
      ),
    'ASSET_NOT_ITEM',
    '车辆房产不能重复登记为重要物品',
  );
}
export function applyVariableCommand(
  state: GameState,
  command: VariableCommand,
  turnId: string,
  newEntity: (id: string) => void,
  debit: (account: 'cash' | 'onlineBalance', amount: number) => void,
) {
  if ('expectedRevision' in command)
    requireData(
      state.revision === command.expectedRevision,
      'ENTITY_CONFLICT',
      '实体更新依赖的正式版本已过期',
    );
  switch (command.type) {
    case 'UpdateProtagonist': {
      requireData(state.protagonist.id === command.protagonistId, 'NOT_FOUND', '主角 ID 不符');
      // 只合并严格白名单的同级字段，无自由路径或深合并。
      if (command.changes.profession !== undefined && command.changes.profession !== state.protagonist.profession) {
        // 名称变更不沿用旧职业说明，也不删除既有技能。新资料可在同一命令或随后命令中补入。
        state.protagonist.professionDescription = '';
        state.protagonist.professionLongTermImpact = '';
      }
      Object.assign(state.protagonist, command.changes);
      break;
    }
    case 'PromoteNpc': {
      const npc = state.npc[command.npcId];
      requireData(npc?.identityKey === command.identityKey, 'NPC_IDENTITY', '人物身份已改变');
      requireData(npc.importancePreference !== 'ordinary', 'NPC_PLAYER_CHOICE', '玩家已取消特殊身份，AI不能重新升级');
      const archived = state.dormantNpcProfiles?.[npc.id];
      if (npc.kind === 'ordinary' && archived) {
        requireData(!archived.profile.privateProfile || npc.gender === 'female' && (npc.age === undefined || npc.age >= 18), 'NPC_KIND', '私密档案恢复资格不符');
        requireData(!command.profile, 'NPC_PROFILE_EXISTS', '已有专属档案，恢复时不得重新生成');
        state.npc[npc.id] = {...npc,...archived.profile,kind:'special'};
        delete state.dormantNpcProfiles![npc.id];
      } else {
        requireData(command.profile && (npc.kind === 'ordinary' || npc.profilePending), 'NPC_KIND', '仅升级普通人物或完善待补资料');
        if (npc.kind === 'special') for (const [field,value] of Object.entries(command.profile!)) {
          const old = npc[field as keyof typeof npc];
          requireData(!old || Array.isArray(old) && !old.length || old === '' || JSON.stringify(old) === JSON.stringify(value),
            'NPC_PROFILE_EXISTS', '补齐不能覆盖已有专属资料');
        }
        state.npc[npc.id] = {...npc,...command.profile!,kind:'special',longTermMemories:[]};
        delete (state.npc[npc.id] as {profilePending?:true}).profilePending;
      }
      break;
    }
    case 'UpdateNpc': {
      const npc = state.npc[command.npcId];
      requireData(npc, 'NOT_FOUND', 'NPC 不存在');
      if (command.affinityChange) {
        const old =
          npc.id === state.initialCompanionId && !npc.affinityConfirmed ? null : npc.affinity;
        requireData(old === command.affinityChange.from, 'ENTITY_CONFLICT', '关系前值不符');
        requireData(
          command.changes.relationshipText,
          'RELATION_REASON',
          '好感变化必须同时说明关系',
        );
        npc.affinity = command.affinityChange.to;
        npc.affinityConfirmed = true;
      }
      if (command.activeGoals !== undefined) {
        requireData(npc.kind === 'special', 'NPC_KIND', '普通 NPC 无特殊目标字段');
        npc.activeGoals = command.activeGoals;
      }
      if (command.changes.lastInteractionAt)
        requireData(
          Date.parse(command.changes.lastInteractionAt) <= Date.parse(state.worldClock) &&
            (!npc.lastInteractionAt ||
              Date.parse(command.changes.lastInteractionAt) >= Date.parse(npc.lastInteractionAt)),
          'NPC_TIME',
          '互动时间未发生或倒退',
        );
      const { locationId, privateProfile, gender, detailedBackground, habits, relationshipNetwork, ...changes } = command.changes;
      if (detailedBackground !== undefined || habits !== undefined || relationshipNetwork !== undefined) {
        requireData(npc.kind === 'special', 'NPC_KIND', '普通人物不能写入休眠专属资料');
        if (detailedBackground !== undefined) npc.detailedBackground = detailedBackground;
        if (habits !== undefined) npc.habits = habits;
        if (relationshipNetwork !== undefined) npc.relationshipNetwork = relationshipNetwork;
      }
      // 资格：仅 special + female + (年龄未知或 >=18) 可持有私密档案
      const effectiveGender = gender ?? npc.gender;
      const isEligible = npc.kind === 'special' && effectiveGender === 'female' && (npc.age === undefined || npc.age >= 18);
      if (privateProfile !== undefined) {
        requireData(isEligible, 'NPC_KIND', '仅重要成年女性 NPC 可持有私密档案');
        const current = npc.privateProfile ?? {};
        // 已有值的初次经历字段不可覆盖，未填写的允许后续补齐
        const merged = { ...current, ...privateProfile };
        if (current.firstExperienceText != null) merged.firstExperienceText = current.firstExperienceText;
        if (current.firstExperienceTarget != null) merged.firstExperienceTarget = current.firstExperienceTarget;
        if (current.firstExperienceTime != null) merged.firstExperienceTime = current.firstExperienceTime;
        npc.privateProfile = merged;
      }
      // 性别变更后若不再符合资格，清除私密档案
      if (gender !== undefined && gender !== 'female' && npc.kind === 'special' && npc.privateProfile) {
        delete npc.privateProfile;
      }
      if (gender !== undefined) npc.gender = gender;
      Object.assign(npc, changes);
      // null 是命令层的显式清除，正式 NPC 仍使用原 Schema 的可选地点。
      if (locationId === null) {
        delete npc.locationId;
      } else if (locationId !== undefined) npc.locationId = locationId;
      break;
    }
    case 'RecordNpcMemory': {
      const npc = state.npc[command.npcId],
        memory = command.memory;
      requireData(npc, 'NOT_FOUND', 'NPC 不存在');
      const memoryIds = [
        ...Object.values(state.npc).flatMap(person => person.memories),
        ...state.memories.short,
        ...state.memories.medium,
        ...state.memories.long,
        ...Object.values(state.memories.npcSummaries).flat(),
      ].map((m) => m.id);
      requireData(!memoryIds.includes(memory.id), 'DUPLICATE_MEMORY', '记忆 ID 重复');
      requireData(
        memory.sourceTurnIds.length === 1 &&
          memory.sourceTurnIds[0] === turnId &&
          memory.affectedEntityRefs.some((ref) => ref.kind === 'npc' && ref.id === npc.id) &&
          Date.parse(memory.createdAtGameTime) <= Date.parse(state.worldClock),
        'MEMORY_SOURCE',
        '记忆缺少当前回合、人物或合法时间来源',
      );
      requireData(
        command.knowledgeKind === 'observed'
          ? !/^\[(?:转述|推测)\]/.test(memory.text.trimStart())
          : memory.text.trimStart().startsWith(command.knowledgeKind === 'reported' ? '[转述]' : '[推测]'),
        'KNOWLEDGE_KIND',
        '转述或猜测必须保持其知识性质',
      );
      requireData(memory.knowledgeKind === undefined || memory.knowledgeKind === command.knowledgeKind,
        'KNOWLEDGE_KIND', '记忆认知类型与命令不符');
      const recorded = { ...memory, knowledgeKind: command.knowledgeKind };
      npc.memories.push(recorded);
      if (command.addToKnownInformation) {
        requireData(
          !npc.knownInformation.some(
            (entry) => entry.text === memory.text && entry.source === memory.knowledgeSource,
          ),
          'DUPLICATE_MEMORY',
          '知晓信息重复',
        );
        npc.knownInformation.push({
          text: memory.text,
          source: memory.knowledgeSource,
          learnedAt: memory.createdAtGameTime,
        });
      }
      break;
    }
    case 'CreateLocation':
      newEntity(command.location.id);
      state.locations[command.location.id] = command.location;
      break;
    case 'SpendFunds':
      debit(command.account, command.amount);
      break;
    case 'AcquireItem':
      newEntity(command.item.id);
      assertImportantItem(state, command.item);
      requireData(command.item.ownerRef, 'OWNERSHIP', '获得物品需明确归属');
      state.items[command.item.id] = command.item;
      break;
    case 'UpdateItem': {
      const item = state.items[command.itemId];
      requireData(
        item && item.quantity === command.expectedQuantity,
        'ENTITY_CONFLICT',
        '物品不存在或数量前值不符',
      );
      const quantity = command.changes.quantity;
      if (quantity !== undefined)
        requireData(
          command.quantityReason === 'gain' ? quantity > item.quantity : quantity < item.quantity,
          'ITEM_QUANTITY',
          '数量变化方向不符',
        );
      if (quantity === 0) {
        unequipItem(state, item.id);
        delete state.items[item.id];
        break;
      }
      if (quantity !== undefined) item.quantity = quantity;
      if (command.changes.conditionText !== undefined)
        item.conditionText = command.changes.conditionText;
      if (command.changes.locationId === null) delete item.locationId;
      else if (command.changes.locationId !== undefined)
        item.locationId = command.changes.locationId;
      for (const field of ['description', 'referenceValue', 'itemDetails', 'category', 'questItem'] as const)
        if (command.changes[field] !== undefined) Object.assign(item, { [field]: command.changes[field] });
      break;
    }
    case 'LoseItem': {
      const item = state.items[command.itemId];
      requireData(
        item?.ownerRef?.kind === command.expectedOwner.kind &&
          item.ownerRef.id === command.expectedOwner.id,
        'OWNERSHIP',
        '遗失物品归属不符',
      );
      delete item.ownerRef;
      item.locationId = command.locationId;
      item.conditionText = command.conditionText;
      unequipItem(state, item.id);
      break;
    }
  }
}
