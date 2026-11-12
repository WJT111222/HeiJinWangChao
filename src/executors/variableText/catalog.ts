import { PromotionProfileSchema } from '../../domain/npc/schema';
import { z } from 'zod';
import { OpeningInitialStateSchema } from '../../domain/openingInitialization';
import { ActorRefSchema, GameTimeSchema, MoneySchema, TextSchema } from '../../domain/common';
import { OrdinaryNpcCreationSchema, SpecialNpcCreationSchema } from '../../domain/npc/schema';
import { GangOrgSchema, GovernmentOrgSchema, CivilOrgSchema, BusinessOrgSchema, OrganizationChangesSchema, FinancialBasisSchema, organizationChangeFields } from '../../domain/organizations/schema';
import { AccountSchema, IncomeRecordSchema, DebtRecordSchema, VehicleAssetSchema } from '../../domain/economy/schema';
import { ImportantItemSchema } from '../../domain/items/schema';
import { itemDetailFields, itemCategoryGroup } from '../../domain/items/details';
import { EquipmentSchema } from '../../domain/protagonist/schema';
import { LocationSchema } from '../../domain/state';
import { variableCommandSchemas } from '../../domain/variableCommands';
import type { DomainCommand } from '../../domain/commands';
import type { VariableOperation } from '../../parsers/variableText';
import { variableTextLimits } from '../../parsers/variableText';
import { memoryInputSchema, textInputSchema } from './entities';
import { SceneEventStateSchema, WorldTaskSchema } from '../../domain/events/schema';

const positive = MoneySchema.refine(n=>n>0);
const npcChanges = variableCommandSchemas[1].shape.changes.shape;
const heroChanges = variableCommandSchemas[0].shape.changes.shape;
interface Entry { operation:VariableOperation; path:string; commandType:DomainCommand['type']; value:z.ZodType }
const slotFields = ['topItemId','bottomItemId','shoesItemId','primaryWeaponItemId','secondaryWeaponItemId','currentVehicleAssetId'];
const entries:Entry[] = [
  {operation:'set',path:'opening.initialState',commandType:'InitializeOpeningState',value:OpeningInitialStateSchema},
  {operation:'set',path:'protagonist',commandType:'UpdateProtagonist',value:variableCommandSchemas[0].shape.changes},
  {operation:'push',path:'protagonist.skills',commandType:'UpdateProtagonist',value:TextSchema},
  {operation:'set',path:'protagonist.skills[index]',commandType:'UpdateProtagonist',value:TextSchema},
  {operation:'delete',path:'protagonist.skills[index]',commandType:'UpdateProtagonist',value:z.null()},
  {operation:'push',path:'npc[id].activeGoals',commandType:'UpdateNpc',value:TextSchema},
  {operation:'set',path:'npc[id].activeGoals[index]',commandType:'UpdateNpc',value:TextSchema},
  {operation:'delete',path:'npc[id].activeGoals[index]',commandType:'UpdateNpc',value:z.null()},
  {operation:'set',path:'npc[id].affinity',commandType:'UpdateNpc',value:z.number().min(-100).max(100)},
  {operation:'add',path:'npc[id].affinity',commandType:'UpdateNpc',value:z.number()},
  {operation:'set',path:'items[id].quantity',commandType:'UpdateItem',value:z.number().int().nonnegative()},
  {operation:'delete',path:'items[id]',commandType:'UpdateItem',value:z.null()},
  ...slotFields.flatMap((slot):Entry[]=>[
    {operation:'set',path:`protagonist.currentWear.${slot}`,commandType:'SetEquipment',value:ActorRefSchema.shape.id},
    {operation:'delete',path:`protagonist.currentWear.${slot}`,commandType:'SetEquipment',value:z.null()}]),
  {operation:'push',path:'protagonist.currentWear.accessoryItemIds',commandType:'SetEquipment',value:ActorRefSchema.shape.id},
  {operation:'delete',path:'protagonist.currentWear.accessoryItemIds[index]',commandType:'SetEquipment',value:z.null()},
  {operation:'set',path:'events[id].sceneState',commandType:'SaveEvent',value:SceneEventStateSchema},
  {operation:'set',path:'tasks[id]',commandType:'SaveTask',value:WorldTaskSchema.omit({id:true})},
  ...Object.entries(heroChanges).map(([field,value]):Entry=>({operation:'set',path:`protagonist.${field}`,commandType:'UpdateProtagonist',
    value:['healthText','emotionText'].includes(field)?textInputSchema:value.unwrap()})),
  {operation:'set',path:'worldClock',commandType:'SetWorldClock',value:GameTimeSchema},
  {operation:'set',path:'locations[id]',commandType:'CreateLocation',value:LocationSchema.omit({id:true})},
  ...Object.entries(npcChanges).map(([field,value]):Entry=>({operation:'set',path:`npc[id].${field}`,commandType:'UpdateNpc',
    value:['healthText','relationshipText'].includes(field)?textInputSchema:value.unwrap()})),
  ...(['memories','knownInformation'] as const).map((field):Entry=>({operation:'push',path:`npc[id].${field}`,commandType:'RecordNpcMemory',value:memoryInputSchema})),
  {operation:'set',path:'npc[id]',commandType:'CreateNpc',value:z.union([OrdinaryNpcCreationSchema.omit({id:true}),SpecialNpcCreationSchema.omit({id:true,longTermMemories:true})])},
  {operation:'set',path:'npc[id].affinityChange',commandType:'UpdateNpc',value:variableCommandSchemas[1].shape.affinityChange.unwrap().extend({relationshipText:TextSchema})},
  {operation:'set',path:'npc[id].activeGoals',commandType:'UpdateNpc',value:variableCommandSchemas[1].shape.activeGoals.unwrap()},
  {operation:'set',path:'npc[id].specialProfile',commandType:'PromoteNpc',value:z.union([PromotionProfileSchema,z.strictObject({})])},
  {operation:'set',path:'npc[id].contact',commandType:'RegisterContact',value:z.strictObject({reason:TextSchema})},
  {operation:'set',path:'organizations[id]',commandType:'CreateOrganization',value:z.union([
    GangOrgSchema.omit({id:true}),GovernmentOrgSchema.omit({id:true}),CivilOrgSchema.omit({id:true}),BusinessOrgSchema.omit({id:true})])},
  {operation:'set',path:'organizations[id].state',commandType:'UpdateOrganization',value:OrganizationChangesSchema.safeExtend({financialBasis:FinancialBasisSchema.optional()})},
  {operation:'set',path:'organizations[id].protagonistRelation',commandType:'RecordOrgRelation',value:z.strictObject({relation:TextSchema,reason:TextSchema})},
  ...(['cash','onlineBalance'] as const).map((field):Entry=>({operation:'add',path:`economy.${field}`,commandType:'SpendFunds',value:z.number().int().negative()})),
  {operation:'set',path:'economy.incomes[id]',commandType:'ReceiveIncome',value:IncomeRecordSchema.omit({id:true}).extend({amount:positive,status:z.literal('received'),receivedAt:GameTimeSchema})},
  {operation:'push',path:'economy.transfers',commandType:'TransferFunds',value:z.strictObject({from:AccountSchema,to:AccountSchema,amount:positive})},
  {operation:'set',path:'economy.debts[id]',commandType:'Borrow',value:z.strictObject({account:AccountSchema,debt:DebtRecordSchema.omit({id:true}).extend({principal:positive,outstanding:positive,status:z.literal('active')})})},
  {operation:'push',path:'economy.debts[id].repayments',commandType:'RepayDebt',value:z.strictObject({account:AccountSchema,amount:positive})},
  {operation:'set',path:'items[id]',commandType:'AcquireItem',value:ImportantItemSchema.omit({id:true})},
  {operation:'set',path:'items[id].purchase',commandType:'PurchaseItem',value:z.strictObject({account:AccountSchema,price:positive,item:ImportantItemSchema.omit({id:true})})},
  {operation:'set',path:'items[id].transfer',commandType:'TransferItem',value:z.strictObject({from:ActorRefSchema.nullable(),to:ActorRefSchema})},
  {operation:'set',path:'items[id].loss',commandType:'LoseItem',value:variableCommandSchemas[7].omit({type:true,commandId:true,evidence:true,expectedRevision:true,itemId:true})},
  {operation:'add',path:'items[id].quantity',commandType:'UpdateItem',value:z.number().int().refine(n=>n!==0)},
  ...(['conditionText','locationId','description','referenceValue','itemDetails','category','questItem'] as const).map((field):Entry=>({operation:'set',path:`items[id].${field}`,commandType:'UpdateItem',value:variableCommandSchemas[6].shape.changes.shape[field].unwrap()})),
  {operation:'set',path:'protagonist.currentWear',commandType:'SetEquipment',value:EquipmentSchema},
  {operation:'set',path:'economy.vehicles[id].purchase',commandType:'PurchaseVehicle',value:z.strictObject({account:AccountSchema,price:positive,vehicle:VehicleAssetSchema.omit({id:true})})},
];
/** 正式及离线文本组装共用的值结构目录；不执行、审批或写入状态。 */
export function textVariableCatalog() {
  return { protocol:'VARIABLE_TEXT_V1', currencyUnit:'CNY_FEN_INTEGER', limits:variableTextLimits,
    organizationUpdateFields: organizationChangeFields,
    itemDetailsGuide: { categoryGroups: itemCategoryGroup, suggestedStringFields: itemDetailFields },
    entries:entries.map(({value,...entry})=>({...entry,...(entry.operation==='delete'?{valueRequired:false}:{}),valueSchema:{...z.toJSONSchema(value,{target:'draft-7',unrepresentable:'any'}),...(entry.commandType==='SaveTask'?{anyOf:[{required:['dueAt']},{required:['completionCondition'],properties:{completionCondition:{type:'string',pattern:'\\S'}}}]}:{})}})),
    usageExamples: {
      affinityChange: 'set npc[example-npc].affinityChange = {"from":0,"to":5,"reason":"共同核对材料","relationshipText":"愿意继续协作"}',
      memory: 'push npc[example-npc].memories = {"text":"自己与对方核对材料并约定继续合作，尚有问题待确认。","knowledgeKind":"observed","knowledgeSource":"本人参与本轮交谈","visibility":"npc_private"}',
      caution: '示例只说明结构，替换人物ID、数值和剧情。affinityChange.from须等于正式前值（同批连续更新用上一笔结果，未确认用null），reason和relationshipText不可缺；可与healthText、lastInteractionAt及四字段记忆同批写入。记忆ID、来源回合、时间和人物引用由程序生成。',
    },
    rules:[
      'events[id].sceneState只写本轮Story实际成立且满足现场权限的变化；active仍为active不是变化，提及、讨论风险、等待发展均不授予介入权限。eventNarration.mode=enter与既有eventInteraction沿用正式语义，mention不授权，不得靠改状态绕过权限。没有合法事件变化省略此命令，其他合法人物、情绪、好感和记忆仍完整记录。合法现场更新和提前结案不禁用；后台推进属于World。无交易不生成经济命令。',
      '物品description是稳定外观/功能/背景，conditionText是当前状态；referenceValue为单件参考价值（人民币非负整数分），未知省略或null，不用0代替未知，不代表购买price，不生成交易。不可交易证件不编造市价。itemDetails复用字符串附加资料，按itemDetailsGuide选适用字段，未知省略；set items[id].itemDetails替换该记录，保留仍有效的旧属性，不支持任意深层赋值。tool为工具类，weapon仍为武器；旧other不按名称猜类。questItem仅在确有任务用途时标true。',
      '同一次响应依次输出完整<thinking>、<说明>、<命令>。只执行命令块；set/add/push 路径 = JSON值；delete 路径，无操作数。以换行分隔，值可多行。不输出DomainCommand JSON、commandId、evidence、expectedRevision。',
      '可选gameState.前缀与源仓库一致，根和字段仍以本目录为准；[index]仅用于列明的普通数组，NPC/实体表必须用稳定ID。[id]替换为真实稳定ID；创建对象省略id，由路径注入。条目是有限操作入口，不是任意深层赋值。',
      '建档须有Story/正式设定明确姓名及持续关系/事件追踪价值，由AI判断；不编造无名路人姓名，不以角色称呼建档，不按次数或职业地位机械升级。specialProfile为PromoteNpc入口：升级或完善profilePending，已有休眠档案用空对象恢复；AI不得降级或覆盖玩家ordinary选择。电话/常驻地点/专属关系字段仅Variables更新，私密档案仍按原privateProfile路径和初次经历保护。',
      '记忆内容遵守共享协议的人物原始记忆内容质量：以本人认知保留背景、经过、自身行动、结果与持续影响，不写成事件标题，不补造事实；长度仅为弹性参考，普通/特殊同标，不强迫每回合写入。',
      '内联NPC初始记忆保持空；用push记忆路径新增，由程序填充当前回合、人物引用和游戏时间。knownInformation同时记录一条个人记忆。',
      '所有普通/特殊NPC统一push npc[id].memories；不选择记忆层，不因special强制增加条目，无值得保存的新经历时可不写。knownInformation仍是知晓状态入口，push会同时建立唯一原始记忆，同一事实不要再重复push memories。两入口使用{text,knowledgeKind,knowledgeSource,visibility}四项。存档中的source/learnedAt只读，不是命令格式；不填id/sourceTurnIds/createdAtGameTime/affectedEntityRefs。亲历、转述和推测由模型区分，不由程序猜测补全。',
      '组织state仅合并白名单当前字段，id/kind及关系历史只读；按组织类型使用organizationUpdateFields。金额仅gang.funds、business.assetsEstimate/liquidityEstimate，需同值内financialBasis={at,note}且不晚于当前时钟；不改变主角余额。leadership公开姓名或null，关联须稳定NPC ID；relations每目标唯一、可空、可单向。无变化不输出更新，不自动创建NPC。',
      '只能更新目录内字段。旧资产无交易登记、历史债务无到账登记、房产购买尚无原生命令，写入<说明>，不伪造交易。events[id].sceneState仅更新已存在现场事件的实际状态和结果；所选Story的eventNarration.enter可明确授权该事件实际介入，mention无此权限，提前结案用实际at且保留fixedEndAt，程序保留旧规划并填写来源；新事件、预计终止时间、延期、承接及清理由World处理。tasks仍须截止时间或非空完成条件，不套用事件新规。',
      'opening.initialState仅供带openingInitializationPending=true的新游戏开局，一批最多一条set。填写缺失weatherText/environmentText、原有cash/onlineBalance及expectedIncomes，不覆盖明确数据。expectedIncomes内每条需稳定id、source、整数分amount、status=expected、account、scheduleText，可选expectedAt不早于当前候选游戏时间；不是到账，不填receivedAt/sourceTurnId，不增加余额。普通回合及无标记旧档禁用。先初始化再处理真实交易。',
      '数组set替换、push追加一个元素、delete按当前索引删除；同一数组多个delete按索引从大到小输出，程序按文本顺序执行，不静默重排。NPC整体/原始记忆、账目记录、地点和组织整体删除没有安全领域命令，明确拒绝；不采用任意深合并。',
      '开局程序统一注入Story时间，不重复计时。普通回合set worldClock为合法ISO时间且不倒退；需要推进时明确输出set worldClock，程序会将时钟优先应用，互动、记忆和实际到账使用本批最终时钟；其他命令保持文本顺序。lastInteractionAt不晚于执行时钟且不早于本人已有互动时间；receivedAt不晚于执行时钟。',
    ] };
}
