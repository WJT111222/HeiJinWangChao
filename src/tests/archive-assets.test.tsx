import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { amountSummary, debtProgress, ownedAssets } from '../ui/panels/economyView';
import { money, playerView } from '../ui/panels/playerView';
import { EconomyPanel } from '../ui/panels/EconomyPanel';
import { InventoryPanel } from '../ui/panels/InventoryPanel';
import { protagonistInventory } from '../ui/panels/inventory';
import { GameStateSchema } from '../domain/state';
import { archiveAssetsState } from './fixtures/archiveAssets';

test.each([[0,'0.00 元'],[1,'0.01 元'],[12345,'123.45 元'],[328000,'3,280.00 元'],[123456789,'1,234,567.89 元'],[12345678901,'123,456,789.01 元'],[Number.MAX_SAFE_INTEGER,'90,071,992,547,409.91 元'],[Number.MAX_SAFE_INTEGER-1,'90,071,992,547,409.90 元'],[null,'未确认']] as const)('money %s 精确到分且保持统一单位', (n,text)=>expect(money(n)).toBe(text));
test('派生合计超过 Number 安全范围仍精确，不回写数字',()=>{
 const values=[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER];const before=[...values],summary=amountSummary(values);
 expect(summary.amount).toBe(18014398509481982n);expect(money(summary.amount)).toBe('180,143,985,094,819.82 元');expect(values).toEqual(before);
});
test.each([
 [[],0n,0,0],[[null],null,0,1],[[null,0],0n,1,1],[[100,null,200],300n,2,1],[[0,0],0n,2,0],
] as const)('未知不冒充零：%j',(input,amount,knownCount,unknownCount)=>expect(amountSummary(input)).toMatchObject({amount,knownCount,unknownCount}));
test.each([
 [null,100,undefined],[100,null,undefined],[0,0,undefined],[0,1,undefined],[100,0,0],[100,50,50],[100,100,100],[100,150,100],[-1,10,undefined],[100,-1,undefined],[NaN,0,undefined],[Infinity,0,undefined],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,100],
] as const)('债务比例 %s / %s 有界且有限',(principal,outstanding,width)=>{
 const result=debtProgress(principal,outstanding);expect(result.width).toBe(width);if(result.width!==undefined){expect(Number.isFinite(result.width)).toBe(true);expect(result.width).toBeGreaterThanOrEqual(0);expect(result.width).toBeLessThanOrEqual(100);}
});
test('资产只算主角，债务仅算偿还中；未知合计显式说明，不改任何数据',()=>{
 const state=archiveAssetsState(),before=structuredClone(state),view=playerView(state),assets=ownedAssets(view);
 expect(assets.map(a=>a.id)).toEqual(['asset-home','car','equipment']);expect(amountSummary(assets.map(a=>a.estimatedValue))).toMatchObject({amount:5650000n,unknownCount:1});
 const html=renderToStaticMarkup(<EconomyPanel view={view}/>),text=html.replace(/<[^>]*>/g,'');expect(text).toContain('56,500.00 元');expect(text).toContain('12,600.00 元');expect(html).toContain('合计不完整');expect(html).toContain('仅统计偿还中债务');expect(html).not.toContain('他人资产不应显示');
 for(const label of ['自动还款授权','抵押资产','来源','记录 ID','预计到账时间','实际到账时间','车型','车牌','所有权','抵押债务'])expect(html).toContain(label);
 expect(state).toEqual(before);
});
test('全未知资产/余额不显示零；全空账户列表保持旧降级文案',()=>{
 const state=archiveAssetsState();for(const a of ownedAssets(playerView(state)))a.estimatedValue=null;for(const d of Object.values(state.economy.debts))if(d.status==='active')d.outstanding=null;
 let html=renderToStaticMarkup(<EconomyPanel view={playerView(state)}/>);expect(html.match(/无法计算合计/g)).toHaveLength(2);
 state.economy.incomes={};state.economy.debts={};state.economy.properties={};state.economy.vehicles={};state.economy.otherAssets={};delete state.protagonist.currentWear.currentVehicleAssetId;
 html=renderToStaticMarkup(<EconomyPanel view={playerView(state)}/>);for(const text of ['暂无收入记录','暂无债务记录','暂无记录'])expect(html).toContain(text);
});
test('背包详情完整投影，原属性可见性与装备引用保持，禁止世界物品泄露',()=>{
 const state=archiveAssetsState(),before=structuredClone(state),view=playerView(state);
 const html=renderToStaticMarkup(<InventoryPanel view={view} desktop initialId="coat"/>);
 for(const text of ['日常棉布外套','材质','棉布','尺码','来源回合','roster-turn-0','持有人','林舟','重庆','coat'])expect(html).toContain(text);
 for(const text of ['不适用字段不可见','他人物品不应显示','无主物品不应显示'])expect(html).not.toContain(text);
 state.protagonist.currentWear.accessoryItemIds=['watch','watch'];const inventory=protagonistInventory(view.items,state.protagonist);expect([...inventory.equipped].filter(id=>id==='watch')).toHaveLength(1);
 state.protagonist.currentWear.accessoryItemIds=before.protagonist.currentWear.accessoryItemIds;expect(state).toEqual(before);
});
test('大量物品和经济列表每页最多20，不排序或重写原集合',()=>{
 const state=archiveAssetsState(120),before=structuredClone(state),view=playerView(state);
 const inventory=renderToStaticMarkup(<InventoryPanel view={view} desktop/>);expect(inventory.match(/data-item-id=/g)).toHaveLength(20);expect(inventory).toContain('下一页物品');
 const html=renderToStaticMarkup(<EconomyPanel view={view}/>);expect(html.match(/data-debt-id=/g)).toHaveLength(20);expect(html).toContain('每页 20 条');expect(state).toEqual(before);
});

test('原Schema仍拒绝超本金；仅独立UI投影防御显示，不能写成正式存档',()=>{
 const state=archiveAssetsState();state.economy.debts.loan.principal=100;state.economy.debts.loan.outstanding=150;
 expect(GameStateSchema.safeParse(state).success).toBe(false);
 const html=renderToStaticMarkup(<EconomyPanel view={playerView(state)}/>);expect(html).toContain('aria-valuenow="100"');expect(html).toContain('未偿本金超过本金');expect(html).not.toContain('NaN');expect(html).not.toContain('Infinity');
});
