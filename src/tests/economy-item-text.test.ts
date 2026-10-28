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

const chain = [
  set('economy.incomes[pay]',income({amount:5000})),
  set('items[phone].purchase',{account:'cash',price:8000,item:item()}),
  set('items[old_phone].transfer',{from:hero,to:person('b')}),
  set('economy.debts[loan]',{account:'cash',debt:debt({principal:3000,outstanding:3000})}),
  push('economy.debts[loan].repayments',{account:'cash',amount:1000}),
  'add economy.cash = -1000',
].join('\n');
describe('连续交易、顺序和精确重放',()=>{
  it('报酬→购买→赠送→借还款→消费依次执行',async()=>{
    const r=await execute(chain);
    expect(r.after.economy.cash).toBe(8000); expect(r.after.items.phone.ownerRef).toEqual(hero);
    expect(r.after.items.old_phone.ownerRef).toEqual(person('b')); expect(r.after.economy.debts.loan.outstanding).toBe(2000);
    expect(r.after.revision).toBe(1); expect(r.plan.commands.map(c=>c.type)).toEqual(['ReceiveIncome','PurchaseItem','TransferItem','Borrow','RepayDebt','SpendFunds']);
    expect(r.plan.commands.map(c=>c.commandId)).toEqual([1,2,3,4,5,6].map(i=>`text-v1:s1:c${i}`));
    expect(r.plan.origins.map(o=>o?.commandIndex)).toEqual([1,2,3,4,5,6]);
  });
  it.each([
    set('economy.incomes[pay]',income()),
    push('economy.transfers',{from:'cash',to:'onlineBalance',amount:1000}),
    set('economy.debts[loan]',{account:'cash',debt:debt()})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount:1000}),
    set('items[phone]',item())+'\nadd items[phone].quantity = -1',
    set('items[phone].purchase',{account:'cash',price:1000,item:item()})+'\n'+set('items[phone].conditionText','划痕')+'\nadd items[phone].quantity = -1',
    set('items[old_phone].conditionText','变化')+'\nadd items[old_phone].quantity = -2',
    set('items[old_phone].transfer',{from:hero,to:person('b')}),
    set('items[old_phone].loss',{expectedOwner:hero,conditionText:'遗落'}),
    set('economy.vehicles[car].purchase',{account:'cash',price:1000,vehicle:vehicle()}),
    set('protagonist.currentWear',{topItemId:'shirt',accessoryItemIds:[]}), chain,
  ])('批次精确重放保持同一状态：%s',async(body)=>{
    const r=await execute(body),plan=unwrap(await compileVariableCommands(r.ast,r.after,r.context));
    expect(plan.commands).toEqual(r.plan.commands);
    expect(unwrap(await simulateVariablePlan(plan,r.after,r.context))).toEqual(r.after);
  });
  it('借款可供同批后续消费；收入与转账后余额真实可用',async()=>{
    const r=await execute(set('economy.debts[loan]',{account:'cash',debt:debt({principal:20000,outstanding:20000})})+'\nadd economy.cash = -25000');
    expect(r.after.economy.cash).toBe(5000); expect(r.after.economy.debts.loan.outstanding).toBe(20000);
    const t=await execute(set('economy.incomes[pay]',income({account:'onlineBalance',amount:10000}))+'\n'+push('economy.transfers',{from:'onlineBalance',to:'cash',amount:25000})+'\nadd economy.cash = -30000');
    expect(t.after.economy.cash).toBe(5000); expect(t.after.economy.onlineBalance).toBe(5000);
  });
  it('同金额不同稳定收入ID可分别入账',async()=>{
    const r=await execute(set('economy.incomes[one]',income())+'\n'+set('economy.incomes[two]',income()));
    expect(r.after.economy.cash).toBe(12000); expect(Object.keys(r.after.economy.incomes)).toEqual(['one','two']);
  });
  it('时间仍按原规则前置，收入必须在实际本轮时钟范围内',async()=>{
    const r=await execute(set('economy.incomes[pay]',income({receivedAt:'2026-10-18T08:05:00+08:00'}))+'\nset worldClock = "2026-10-18T08:05:00+08:00"');
    expect(r.after.economy.cash).toBe(11000); expect(r.after.worldClock).toBe('2026-10-18T08:05:00+08:00');
    expect(r.plan.origins.map(o=>o?.commandIndex)).toEqual([2,1]);
  });
});

describe('物品归属、数量与装备',()=>{
  it.each([person(),person('b')])('获得物品可归指定NPC，不需要互动授权：%o',async(ownerRef)=>{
    const r=await execute(set('items[phone]',item({ownerRef})));
    expect(r.after.items.phone.ownerRef).toEqual(ownerRef); expect(r.after.npc.b.onScene).toBe(false);
  });
  it('赠送、交付及无主物品拾回均更新原实体',async()=>{
    const r=await execute(set('items[old_phone].loss',{expectedOwner:hero,locationId:'chongqing',conditionText:'遗落'})+'\n'+set('items[old_phone].transfer',{from:null,to:person()})+'\n'+set('items[old_phone].transfer',{from:person(),to:hero}));
    expect(r.after.items.old_phone.ownerRef).toEqual(hero); expect(Object.keys(r.after.items)).toEqual(['old_phone','shirt']);
  });
  it('位置可显式清空，状态可为空字符串',async()=>{
    const r=await execute(set('items[old_phone].locationId','chongqing')+'\n'+set('items[old_phone].locationId',null)+'\n'+set('items[old_phone].conditionText',''));
    expect(r.after.items.old_phone.locationId).toBeUndefined(); expect(r.after.items.old_phone.conditionText).toBe('');
  });
  it.each(['gift','loss','consumption'] as const)('失去装备%s自动解除引用',async(kind)=>{
    const operation=kind==='gift'?set('items[shirt].transfer',{from:hero,to:person('b')}):kind==='loss'?set('items[shirt].loss',{expectedOwner:hero,conditionText:'遗失',locationId:'chongqing'}):'add items[shirt].quantity = -1';
    const r=await execute(set('protagonist.currentWear',{topItemId:'shirt',accessoryItemIds:[]})+'\n'+operation);
    expect(r.after.protagonist.currentWear.topItemId).toBeUndefined();
  });
  it('本轮购买后装备，清空装备槽不会丢物品',async()=>{
    const r=await execute(set('items[jacket].purchase',{account:'cash',price:100,item:item({category:'top',name:'外套'})})+'\n'+set('protagonist.currentWear',{topItemId:'jacket',accessoryItemIds:[]})+'\n'+set('protagonist.currentWear',{accessoryItemIds:[]}));
    expect(r.after.items.jacket.ownerRef).toEqual(hero); expect(r.after.protagonist.currentWear).toEqual({accessoryItemIds:[]});
  });
  it('已有债务可以部分偿还而不改变本金',async()=>{
    const d=setup(push('economy.debts[old].repayments',{account:'onlineBalance',amount:200}));
    d.state.economy.debts.old={...debt(),id:'old',status:'active'};
    const r=unwrap(await run(d)); expect(r.economy.debts.old).toMatchObject({principal:1000,outstanding:800,status:'active'}); expect(r.economy.onlineBalance).toBe(19800);
  });
});

const invalid = [
  set('economy.incomes[pay]',income({amount:0})),set('economy.incomes[pay]',income({amount:-1})),
  set('economy.incomes[pay]',income({amount:0.5})),set('economy.incomes[pay]',income({amount:null})),
  set('economy.incomes[pay]',income({status:'expected'})),set('economy.incomes[pay]',income({receivedAt:'2030-01-01T00:00:00+08:00'})),
  set('economy.incomes[pay]',{amount:100}),set('economy.incomes[pay]',income({id:'different'})),
  set('economy.incomes[pay]',income({amount:9007199254740992})),
  push('economy.transfers',{from:'cash',to:'cash',amount:1}),push('economy.transfers',{from:'cash',to:'onlineBalance',amount:10001}),
  push('economy.transfers',{from:'cash',to:'onlineBalance',amount:-1}),push('economy.transfers',{from:'bank',to:'cash',amount:1}),
  set('economy.debts[loan]',{account:'cash',debt:debt({outstanding:500})}),
  set('economy.debts[loan]',{account:'cash',debt:debt({principal:null})}),set('economy.debts[loan]',{account:'cash',debt:debt({status:'repaid'})}),
  push('economy.debts[missing].repayments',{account:'cash',amount:1}),push('economy.debts[missing].repayments',{account:'cash',amount:0}),
  set('items[old_phone]',item()),set('items[phone]',item({quantity:0})),set('items[phone]',item({quantity:0.5})),
  set('items[phone]',item({ownerRef:undefined})),set('items[phone]',item({ownerRef:person('missing')})),
  set('items[phone].purchase',{account:'cash',price:10001,item:item()}),set('items[phone].purchase',{account:'cash',price:1,item:item({ownerRef:person()})}),
  set('items[old_phone].transfer',{from:person(),to:hero}),set('items[old_phone].transfer',{from:hero,to:person('missing')}),
  set('items[old_phone].loss',{expectedOwner:person(),conditionText:'丢失'}),set('items[old_phone].loss',{expectedOwner:hero,conditionText:'丢失',locationId:'missing'}),
  set('items[missing].conditionText','完好'),set('items[old_phone].locationId','missing'),set('items[old_phone].conditionText',1),
  set('protagonist.currentWear',{topItemId:'missing',accessoryItemIds:[]}),set('protagonist.currentWear',{topItemId:'old_phone',accessoryItemIds:[]}),
  set('protagonist.currentWear',{accessoryItemIds:['shirt','shirt']}),set('protagonist.currentWear',{}),
  set('economy.vehicles[car].purchase',{account:'cash',price:1,vehicle:vehicle({ownerRef:person()})}),
  set('economy.vehicles[car].purchase',{account:'onlineBalance',price:20001,vehicle:vehicle()}),
  set('economy.vehicles[car].purchase',{account:'cash',price:1,vehicle:vehicle({kind:'property'})}),
  set('items[phone]',item({name:'汽车',category:'other'})),set('items[phone]',item({name:'房产',category:'other'})),
];
describe('原数据规则的整批拒绝',()=>{
  it.each(invalid)('不合法操作不产生部分状态：%s',async(body)=>{
    const d=setup('set protagonist.emotionText = "轻松"\n'+body),before=structuredClone(d);
    const r=await run(d); expect(r.ok).toBe(false); expect(r).not.toHaveProperty('value'); expect(d).toEqual(before);
  });
  it.each(['cash','onlineBalance'] as const)('未知%s余额不是0，也不能入账推算余额',async(account)=>{
    const d=setup(set('economy.incomes[pay]',income({account})));d.state.economy[account]=null;
    const before=structuredClone(d);expect((await run(d)).ok).toBe(false);expect(d).toEqual(before);
  });
  it('不能把未来收入挪到前面来完成购买',async()=>{
    const d=setup(set('items[phone].purchase',{account:'cash',price:15000,item:item()})+'\n'+set('economy.incomes[pay]',income({amount:20000})));
    expect((await run(d)).ok).toBe(false);expect(d.state.items.phone).toBeUndefined();
  });
  it('过量还款、还清后再次还款及负数还款均失败',async()=>{
    for (const amount of [1001,-1,0]) {
      const d=setup(set('economy.debts[loan]',{account:'cash',debt:debt()})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount}));
      expect((await run(d)).ok).toBe(false);
    }
    const d=setup(set('economy.debts[loan]',{account:'cash',debt:debt()})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount:1000})+'\n'+push('economy.debts[loan].repayments',{account:'cash',amount:1}));expect((await run(d)).ok).toBe(false);
  });
  it('两笔已到账收入ID重复或跨记录类型ID重复不会重复入账',async()=>{
    for (const body of [set('economy.incomes[pay]',income())+'\n'+set('economy.incomes[pay]',income()),set('items[same]',item())+'\n'+set('economy.debts[same]',{account:'cash',debt:debt()})]) {
      const d=setup(body);expect((await run(d)).ok).toBe(false);expect(d.state.economy.cash).toBe(10000);
    }
  });
  it('创建→耗尽→同ID再创建不产生两个实体身份',async()=>{
    const d=setup(set('items[phone]',item())+'\nadd items[phone].quantity = -1\n'+set('items[phone]',item()));
    expect((await run(d)).ok).toBe(false);expect(d.state.items.phone).toBeUndefined();
  });
});

describe('输入结构与既有版本机制',()=>{
  it.each([
    set('economy',{cash:1}),set('economy.cash',1),'add economy.cash = 100',
    set('economy.properties[house].purchase',{}),set('economy.otherAssets[asset]',{}),
    set('items[old_phone].ownerRef',person()),set('items[old_phone].itemDetails.foo','自由补丁'),
    push('items[phone].purchase',{account:'cash',price:1,item:item()}),
    set('economy.incomes[pay]',income({commandId:'override'})),
    push('economy.transfers',{from:'cash',to:'onlineBalance',amount:1,evidence:'自定义审批'}),
    set('items[old_phone].transfer',{from:hero,to:person(),itemId:'other'}),
    push('economy.debts[loan].repayments',{account:'cash',amount:1,debtId:'other'}),
    set('economy.vehicles[car].purchase',{account:'cash',price:1,vehicle:vehicle({id:'other'})}),
  ])('不支持路径、操作或覆盖程序元数据：%s',async(body)=>{
    const d=setup(body);expect((await run(d)).ok).toBe(false);
  });
  it.each(['revision','story','attempt'] as const)('旧计划在%s变化后不能写入',async(change)=>{
    const d=setup(chain),plan=unwrap(await compileVariableCommands(d.ast,d.state,d.context));
    if(change==='revision')d.state.revision++;
    if(change==='story')d.context.draft=rerollStory(d.context.draft,{...story,narrative:'新的正文'});
    if(change==='attempt'){const {startStageAttempt}=await import('../domain/drafts');d.context.draft=startStageAttempt(d.context.draft,['variables']);}
    const before=structuredClone(d);expect((await simulateVariablePlan(plan,d.state,d.context)).ok).toBe(false);expect(d).toEqual(before);
  });
  it('已执行批次修改收入金额或变更命令顺序会冲突',async()=>{
    const r=await execute(chain),changed=setup(chain.replace('"amount":5000','"amount":6000'));
    expect((await compileVariableCommands(changed.ast,r.after,r.context)).ok).toBe(false);
    const reversed=setup(chain.split('\n').reverse().join('\n'));
    expect((await compileVariableCommands(reversed.ast,r.after,r.context)).ok).toBe(false);
  });
  it('编译计划不允许篡改交易金额',async()=>{
    const d=setup(push('economy.transfers',{from:'cash',to:'onlineBalance',amount:1000})),plan=unwrap(await compileVariableCommands(d.ast,d.state,d.context));
    const changed={...plan,commands:plan.commands.map(c=>c.type==='TransferFunds'?{...c,amount:1}:c)};
    expect((await simulateVariablePlan(changed,d.state,d.context)).ok).toBe(false);expect(d.state.economy.cash).toBe(10000);
  });
  it('没有网络、AI和数据库调用',async()=>{
    const {vi}=await import('vitest'),fetch=vi.fn(),indexedDB={open:vi.fn()};vi.stubGlobal('fetch',fetch);vi.stubGlobal('indexedDB',indexedDB);
    try{expect((await execute(chain)).after.economy.cash).toBe(8000);expect(fetch).not.toHaveBeenCalled();expect(indexedDB.open).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
  });
  it('旧JSON变量入口和领域模拟使用同样的交易语义',async()=>{
    const {parseVariables}=await import('../services/validation/aiOutputs'),r=await execute(chain);
    expect(parseVariables(JSON.stringify({commands:r.plan.commands,rejectedSuggestions:[],unresolved:[]}),r.state,r.context.draft).commands).toEqual(r.plan.commands);
  });
});
