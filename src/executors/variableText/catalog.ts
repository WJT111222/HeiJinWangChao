import { z } from 'zod';
import { ActorRefSchema, GameTimeSchema, MoneySchema, TextSchema } from '../../domain/common';
import { OrdinaryNpcSchema, SpecialNpcSchema } from '../../domain/npc/schema';
import { GangOrgSchema, GovernmentOrgSchema, CivilOrgSchema, BusinessOrgSchema } from '../../domain/organizations/schema';
import { AccountSchema, IncomeRecordSchema, DebtRecordSchema, VehicleAssetSchema } from '../../domain/economy/schema';
import { ImportantItemSchema } from '../../domain/items/schema';
import { EquipmentSchema } from '../../domain/protagonist/schema';
import { LocationSchema } from '../../domain/state';
import { variableCommandSchemas } from '../../domain/variableCommands';
import type { DomainCommand } from '../../domain/commands';
import type { VariableOperation } from '../../parsers/variableText';
import { variableTextLimits } from '../../parsers/variableText';
import { memoryInputSchema, textInputSchema } from './entities';
import { WorldEventSchema, WorldTaskSchema } from '../../domain/events/schema';

const positive = MoneySchema.refine(n=>n>0);
const npcChanges = variableCommandSchemas[1].shape.changes.shape;
const heroChanges = variableCommandSchemas[0].shape.changes.shape;
interface Entry { operation:VariableOperation; path:string; commandType:DomainCommand['type']; value:z.ZodType }
const entries:Entry[] = [
  {operation:'set',path:'events[id]',commandType:'SaveEvent',value:WorldEventSchema.omit({id:true})},
  {operation:'set',path:'tasks[id]',commandType:'SaveTask',value:WorldTaskSchema.omit({id:true})},
  ...Object.entries(heroChanges).map(([field,value]):Entry=>({operation:'set',path:`protagonist.${field}`,commandType:'UpdateProtagonist',
    value:['healthText','emotionText'].includes(field)?textInputSchema:value.unwrap()})),
  {operation:'set',path:'worldClock',commandType:'SetWorldClock',value:GameTimeSchema},
  {operation:'set',path:'locations[id]',commandType:'CreateLocation',value:LocationSchema.omit({id:true})},
  ...Object.entries(npcChanges).map(([field,value]):Entry=>({operation:'set',path:`npc[id].${field}`,commandType:'UpdateNpc',
    value:['healthText','relationshipText'].includes(field)?textInputSchema:value.unwrap()})),
  ...(['memories','longTermMemories','knownInformation'] as const).map((field):Entry=>({operation:'push',path:`npc[id].${field}`,commandType:'RecordNpcMemory',value:memoryInputSchema})),
  {operation:'set',path:'npc[id]',commandType:'CreateNpc',value:z.union([OrdinaryNpcSchema.omit({id:true}),SpecialNpcSchema.omit({id:true})])},
  {operation:'set',path:'npc[id].affinityChange',commandType:'UpdateNpc',value:variableCommandSchemas[1].shape.affinityChange.unwrap().extend({relationshipText:TextSchema})},
  {operation:'set',path:'npc[id].activeGoals',commandType:'UpdateNpc',value:variableCommandSchemas[1].shape.activeGoals.unwrap()},
  {operation:'set',path:'npc[id].contact',commandType:'RegisterContact',value:z.strictObject({reason:TextSchema})},
  {operation:'set',path:'organizations[id]',commandType:'CreateOrganization',value:z.union([
    GangOrgSchema.omit({id:true}),GovernmentOrgSchema.omit({id:true}),CivilOrgSchema.omit({id:true}),BusinessOrgSchema.omit({id:true})])},
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
  ...(['conditionText','locationId'] as const).map((field):Entry=>({operation:'set',path:`items[id].${field}`,commandType:'UpdateItem',value:variableCommandSchemas[6].shape.changes.shape[field].unwrap()})),
  {operation:'set',path:'protagonist.currentWear',commandType:'SetEquipment',value:EquipmentSchema},
  {operation:'set',path:'economy.vehicles[id].purchase',commandType:'PurchaseVehicle',value:z.strictObject({account:AccountSchema,price:positive,vehicle:VehicleAssetSchema.omit({id:true})})},
];
/** 正式及离线文本组装共用的值结构目录；不执行、审批或写入状态。 */
export function textVariableCatalog() {
  return { protocol:'VARIABLE_TEXT_V1', currencyUnit:'CNY_FEN_INTEGER', limits:variableTextLimits,
    entries:entries.map(({value,...entry})=>({...entry,valueSchema:z.toJSONSchema(value,{target:'draft-7',unrepresentable:'any'})})),
    rules:[
      '只输出一个<命令>块；set/add/push 操作 路径 = JSON值，以换行分隔；值可多行。不输出DomainCommand JSON、commandId、evidence、expectedRevision。',
      '[id]替换为真实稳定ID；创建对象省略id，由路径注入。条目是有限操作入口，不是任意深层赋值。',
      '内联NPC初始记忆保持空；用push记忆路径新增，由程序填充当前回合、人物引用和游戏时间。knownInformation同时记录一条个人记忆。',
      '只能更新目录内字段。没有原生命令的余额初始化、旧资产无交易登记、房产购买写入<说明>，不伪造路径。events/tasks仅记录正文已发生的现场结果，不推演场外任务或事件；保留原有提交权限、状态和时间校验。',
      '开局程序统一注入Story时间，不重复计时。普通回合set worldClock为合法ISO时间且不倒退。',
    ] };
}
