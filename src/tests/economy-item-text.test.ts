import { describe, expect, it } from 'vitest';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import type { ExecutionResult } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story, gameTime } from './fixtures/game';

const hero = { kind: 'protagonist', id: 'hero' } as const;
const person = (id = 'a') => ({ kind: 'npc', id } as const);
const item = (extra = {}) => ({ name:'手机',category:'device',quantity:1,ownerRef:hero,conditionText:'完好',...extra });
const income = (extra = {}) => ({source:'本轮报酬',amount:1000,status:'received',account:'cash',receivedAt:gameTime,...extra});
const debt = (extra = {}) => ({creditor:'朋友',principal:1000,outstanding:1000,status:'active',repaymentTerms:'协商还款',collateralAssetIds:[],autoPaymentAuthorized:false,source:'本轮借款',...extra});
const vehicle = (extra = {}) => ({kind:'vehicle',name:'轿车',ownerRef:hero,estimatedValue:2000,acquiredAt:gameTime,source:'购买',statusText:'完好',model:'普通车型',locationId:'chongqing',...extra});
const set = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
const push = (path: string, value: unknown) => `push ${path} = ${JSON.stringify(value)}`;
function setup(body: string) {
  const state = game(); state.turnNumber = 1; state.journal = [{turnId:'old',revision:0,story,relatedActorRefs:[]}];
  state.npc.a = npc('a'); state.npc.b = {...npc('b'),onScene:false};
  state.items.old_phone = {id:'old_phone',name:'旧手机',category:'device',quantity:2,ownerRef:hero,conditionText:'旧'};
  state.items.shirt = {id:'shirt',name:'上衣',category:'top',quantity:1,ownerRef:hero,conditionText:'完好'};
  const draft = rerollStory(createTurnDraft(state.saveId,state.revision,'economy-turn','regular','进行本轮行动'),story);
  const ast = parseVariableText(`<命令>\n${body}\n</命令>`); if (!ast.ok) throw new Error('固定样本语法失败');
  return {state,context:{draft,expectedRevision:state.revision},ast:ast.value};
}
function unwrap<T>(r: ExecutionResult<T>): T { if (!r.ok) throw new Error(r.error.code); return r.value; }
async function run(d: ReturnType<typeof setup>) {
  const plan = await compileVariableCommands(d.ast,d.state,d.context);
  return plan.ok ? simulateVariablePlan(plan.value,d.state,d.context) : plan;
}
async function execute(body: string) {
  const d=setup(body),before=structuredClone(d);
  const plan=unwrap(await compileVariableCommands(d.ast,d.state,d.context));
  const after=unwrap(await simulateVariablePlan(plan,d.state,d.context)); expect(d).toEqual(before);
  return {...d,plan,after};
}
describe('M8-P0C-3C2 资金与物品流转',()=>{
  it('收入到账并创建完整记录',async()=>{
    const r=await execute(set('economy.incomes[pay]',income()));
    expect(r.after.economy.cash).toBe(11000); expect(r.after.economy.incomes.pay).toEqual({id:'pay',...income()});
  });
  it('收到收入后可以立即消费，不再只检查初始余额',async()=>{
    const r=await execute(set('economy.incomes[pay]',income({amount:10000}))+'\nadd economy.cash = -15000');
    expect(r.after.economy.cash).toBe(5000);
  });
  it('现金线上双向转账不生成收入',async()=>{
    const r=await execute(push('economy.transfers',{from:'cash',to:'onlineBalance',amount:1000})+'\n'+push('economy.transfers',{from:'onlineBalance',to:'cash',amount:500}));
    expect(r.after.economy.cash).toBe(9500); expect(r.after.economy.onlineBalance).toBe(20500); expect(r.after.economy.incomes).toEqual({});
  });
  it('借款、部分还款及还清',async()=>{
    const r=await execute(set('economy.debts[loan]',{account:'cash',debt:debt()})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount:300})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount:700}));
    expect(r.after.economy.cash).toBe(10000); expect(r.after.economy.debts.loan).toMatchObject({outstanding:0,status:'repaid',principal:1000});
  });
  it('获得新物品后可立即增减数量、状态和位置',async()=>{
    const r=await execute(set('items[phone]',item())+'\nadd items[phone].quantity = 2\nadd items[phone].quantity = -1\n'+set('items[phone].conditionText','划痕')+'\n'+set('items[phone].locationId','chongqing'));
    expect(r.after.items.phone).toMatchObject({quantity:2,conditionText:'划痕',locationId:'chongqing'}); expect(r.after.economy.cash).toBe(10000);
  });
  it('购买物品同时扣款与入库',async()=>{
    const r=await execute(set('items[phone].purchase',{account:'cash',price:3000,item:item()}));
    expect(r.after.economy.cash).toBe(7000); expect(r.after.items.phone.ownerRef).toEqual(hero);
  });
  it('多人物品转移和遗失保留真实状态',async()=>{
    const r=await execute(set('items[old_phone].transfer',{from:hero,to:person()})+'\n'+set('items[old_phone].transfer',{from:person(),to:person('b')})+'\n'+set('items[old_phone].loss',{expectedOwner:person('b'),locationId:'chongqing',conditionText:'遗落'}));
    expect(r.after.items.old_phone.ownerRef).toBeUndefined(); expect(r.after.items.old_phone).toMatchObject({locationId:'chongqing',conditionText:'遗落',quantity:2});
  });
  it('装备及赠送自动解除引用',async()=>{
    const r=await execute(set('protagonist.currentWear',{topItemId:'shirt',accessoryItemIds:[]})+'\n'+set('items[shirt].transfer',{from:hero,to:person('b')}));
    expect(r.after.protagonist.currentWear.topItemId).toBeUndefined(); expect(r.after.items.shirt.ownerRef).toEqual(person('b'));
  });
  it('车辆购买同时扣款和登记资产，可设为当前载具',async()=>{
    const r=await execute(set('economy.vehicles[car].purchase',{account:'onlineBalance',price:2000,vehicle:vehicle()})+'\n'+set('protagonist.currentWear',{currentVehicleAssetId:'car',accessoryItemIds:[]}));
    expect(r.after.economy.onlineBalance).toBe(18000); expect(r.after.economy.vehicles.car.ownerRef).toEqual(hero); expect(r.after.items.car).toBeUndefined();
  });
});

it('不能先透支再用后面的收入补回',async()=>{
  const d=setup('add economy.cash = -15000\n'+set('economy.incomes[pay]',income({amount:10000}))),before=structuredClone(d);
  expect((await run(d)).ok).toBe(false); expect(d).toEqual(before);
});
