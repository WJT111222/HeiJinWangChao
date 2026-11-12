import type { GameState } from '../../domain/state';
import { GameStateSchema } from '../../domain/state';
import { organizationArchiveState } from './organizations';

/** Synthetic data only; never imported by product code. */
export function archiveAssetsState(extra=0) {
 const state=organizationArchiveState(),ownerRef={kind:'protagonist' as const,id:state.protagonist.id},now=state.worldClock;
 state.openingCityId='chongqing';
 const records=[
  {id:'coat',name:'日常棉布外套',category:'top',description:'黑色棉布外套，内侧保留着修补的针脚。\n适合日常通勤。',itemDetails:{material:'棉布',size:'L',batteryText:'不适用字段不可见'}},
  {id:'pants',name:'深色长裤',category:'bottom'}, {id:'shoes',name:'旧运动鞋',category:'shoes'},
  {id:'watch',name:'旧机械腕表',category:'accessory',questItem:true,referenceValue:null,itemDetails:{material:'不锈钢',纪念文字:'家人留下的纪念物'}},
  {id:'phone',name:'日常手机',category:'device',itemDetails:{brandModel:'旧款智能手机',batteryText:'约一半'}},
  {id:'card',name:'身份证件',category:'document',itemDetails:{issuer:'签发机构',purpose:'身份核验'}},
  {id:'torch',name:'金属手电',category:'tool',quantity:2,itemDetails:{durabilityText:'完好'}},
  {id:'umbrella',name:'加固折叠伞',category:'weapon'}, {id:'box',name:'旧工具盒',category:'other'},
 ];
 state.items={};
 for(const item of records)state.items[item.id]={quantity:1,conditionText:'保存完好',referenceValue:12000,ownerRef,locationId:'chongqing',createdByTurnId:'roster-turn-0',...item} as GameState['items'][string];
 state.items.private={id:'private',name:'他人物品不应显示',category:'device',quantity:1,ownerRef:{kind:'npc',id:'person'},conditionText:'完好'};
 state.items.unowned={id:'unowned',name:'无主物品不应显示',category:'other',quantity:1,conditionText:'遗落',locationId:'chongqing'};
 state.protagonist.currentWear={topItemId:'coat',bottomItemId:'pants',shoesItemId:'shoes',accessoryItemIds:['watch'],primaryWeaponItemId:'umbrella',currentVehicleAssetId:'car'};
 state.economy={cash:328000,onlineBalance:4691520,incomes:{
  wage:{id:'wage',source:'教学工作报酬',amount:320000,status:'received',account:'onlineBalance',expectedAt:now,receivedAt:now,sourceTurnId:'roster-turn-0',scheduleText:'按已确认的工作安排入账'},
  pending:{id:'pending',source:'待确认的协作收入',amount:null,status:'expected',account:'cash',scheduleText:'金额尚未确定'},
  cancelled:{id:'cancelled',source:'取消的项目收入',amount:150000,status:'cancelled',account:'onlineBalance',scheduleText:'项目已取消'},
 },debts:{
  loan:{id:'loan',creditor:'合作贷款机构',principal:1800000,outstanding:1260000,status:'active',dueAt:now,repaymentTerms:'按现有合同分期偿还。',collateralAssetIds:['asset-home'],autoPaymentAuthorized:false,source:'已登记的借款合同'},
  unknown:{id:'unknown',creditor:'待核对的旧借款',principal:null,outstanding:null,status:'active',repaymentTerms:'本金和余额待核对。',collateralAssetIds:[],autoPaymentAuthorized:false,source:'旧记录'},
  dispute:{id:'dispute',creditor:'存在争议的记录',principal:100000,outstanding:100000,status:'disputed',repaymentTerms:'继续保留原始争议记录。',collateralAssetIds:[],autoPaymentAuthorized:false,source:'既有记录'},
  paid:{id:'paid',creditor:'已偿还的借款',principal:50000,outstanding:0,status:'repaid',repaymentTerms:'原约定已经履行。',collateralAssetIds:[],autoPaymentAuthorized:true,source:'既有记录'},
 },properties:{'asset-home':{id:'asset-home',kind:'property',name:'沿江小住宅',ownerRef,estimatedValue:5000000,locationId:'chongqing',ownershipText:'已登记的权属份额',mortgageDebtId:'loan',acquiredAt:now,source:'既有购置记录',statusText:'自住'}},vehicles:{car:{id:'car',kind:'vehicle',name:'日常代步车',ownerRef,estimatedValue:650000,model:'旧款小型车',plate:'渝A·00001',locationId:'chongqing',source:'既有购置记录',statusText:'停放在住处',acquiredAt:now}},otherAssets:{
  equipment:{id:'equipment',kind:'other',name:'旧器材一套',ownerRef,estimatedValue:null,category:'器材',details:'保留原始器材清单。',source:'家人留下',statusText:'保养中'},
  npcAsset:{id:'npcAsset',kind:'other',name:'他人资产不应显示',ownerRef:{kind:'npc',id:'person'},estimatedValue:999999,category:'器材',details:'他人记录',source:'他人持有',statusText:'完好'},
 }};
 for(let i=0;i<extra;i++){
  const id=`extra-item-${i}`;state.items[id]={...structuredClone(state.items.box),id,name:`库存记录${String(i).padStart(4,'0')}`,quantity:i+1};
  const income=`extra-income-${i}`;state.economy.incomes[income]={...structuredClone(state.economy.incomes.wage),id:income,source:`收入记录${i}`};
  const debt=`extra-debt-${i}`;state.economy.debts[debt]={...structuredClone(state.economy.debts.loan),id:debt,creditor:`债务记录${i}`};
  const asset=`extra-asset-${i}`;state.economy.otherAssets[asset]={...structuredClone(state.economy.otherAssets.equipment),id:asset,name:`资产记录${i}`};
 }
 return GameStateSchema.parse(state);
}
