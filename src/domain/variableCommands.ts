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
import { OrdinaryNpcSchema } from './npc/schema';
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
  publicStatus: true,
  legalStatus: true,
  skills: true,
}).partial();
const npcChanges = OrdinaryNpcSchema.pick({
  locationId: true,
  onScene: true,
  relationshipText: true,
  healthText: true,
  lastInteractionAt: true,
})
  .partial()
  .extend({
    locationId: IdSchema.nullable()
      .optional()
      .describe('合法地点 ID；null 显式清除未知去向的地点，须同时离场；省略保持原值'),
  });
const itemChanges = z.strictObject({
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
    layer: z.enum(['personal', 'longTerm']),
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
      Object.assign(state.protagonist, command.changes);
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
      const { locationId, ...changes } = command.changes;
      Object.assign(npc, changes);
      // null 是命令层的显式清除，正式 NPC 仍使用原 Schema 的可选地点。
      if (locationId === null) {
        requireData(!npc.onScene, 'SCENE_LOCATION', '在场 NPC 不能清除地点');
        delete npc.locationId;
      } else if (locationId !== undefined) npc.locationId = locationId;
      if (command.changes.onScene === true)
        requireData(npc.locationId, 'SCENE_LOCATION', '入场必须明确地点');
      break;
    }
    case 'RecordNpcMemory': {
      const npc = state.npc[command.npcId],
        memory = command.memory;
      requireData(npc, 'NOT_FOUND', 'NPC 不存在');
      const memoryIds = [
        ...Object.values(state.npc).flatMap((person) => [
          ...person.memories,
          ...(person.kind === 'special' ? person.longTermMemories : []),
        ]),
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
          ? !/^\[(?:转述|推测)\]/.test(memory.text)
          : memory.text.startsWith(command.knowledgeKind === 'reported' ? '[转述]' : '[推测]'),
        'KNOWLEDGE_KIND',
        '转述或猜测必须保持其知识性质',
      );
      requireData(memory.knowledgeKind === undefined || memory.knowledgeKind === command.knowledgeKind,
        'KNOWLEDGE_KIND', '记忆认知类型与命令不符');
      const recorded = { ...memory, knowledgeKind: command.knowledgeKind };
      if (command.layer === 'longTerm') {
        requireData(npc.kind === 'special', 'NPC_KIND', '普通 NPC 无长期记忆字段');
        npc.longTermMemories.push(recorded);
      } else npc.memories.push(recorded);
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
