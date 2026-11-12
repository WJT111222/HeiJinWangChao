import { test,expect } from './helpers/test';
import type { Page } from '@playwright/test';
import type { ImportantItem } from '../src/domain/items/schema';
import { writeFileSync } from 'node:fs';
import { seedRoster,rosterGame } from './helpers/npcRoster';
import { openProfile,openWorldArchive,openWorkflow } from './helpers/gameLayout';

async function seed(page:Page,extra=0){
 await seedRoster(page);await page.evaluate(async extra=>{
  const paths=['/src/tests/fixtures/archiveAssets.ts','/src/domain/drafts.ts'];const [{archiveAssetsState},{createTurnDraft}]=await Promise.all(paths.map(p=>import(p))),state=archiveAssetsState(extra);
  await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction(['saves','drafts'],'readwrite');t.objectStore('saves').put(state);t.objectStore('drafts').put(createTurnDraft(state.saveId,state.revision,'s3-draft','regular',''));t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};q.onerror=()=>reject(q.error);});
 },extra);await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function inventory(page:Page){await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:'物品栏',exact:true}).click();return page.getByRole('dialog',{name:'物品栏',exact:true});}
async function economy(page:Page){const directory=page.getByRole('dialog',{name:'世界资料',exact:true});if(await directory.isVisible())await directory.getByRole('button',{name:'关闭资料界面',exact:true}).click();await page.getByRole('button',{name:'经济与资产',exact:true}).click();return page.getByRole('dialog',{name:'经济与资产',exact:true});}
async function fit(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const drawer=page.locator('.archive');if(await drawer.count())expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
async function readonly(page:Page){let calls=0;const errors:string[]=[];await page.route('https://**/*',async r=>{calls++;await r.abort();});page.on('pageerror',e=>errors.push(e.message));return ()=>{expect(calls).toBe(0);expect(errors).toEqual([]);};}
const sizes=[{width:1920,height:1080},{width:1440,height:900},{width:1280,height:800},{width:1100,height:800},{width:901,height:800}];

test('物品分类、只读搜索、三栏和选中详情，901边界、原槽位与归属跳转',async({page},info)=>{
 const desktop=info.project.name==='desktop';if(!desktop)await page.setViewportSize({width:390,height:844});await seed(page);const verify=await readonly(page),before=await rosterGame(page);
 await openWorkflow(page);let dialog=await inventory(page);await expect(dialog).toHaveJSProperty('tagName',desktop?'SECTION':'DIALOG');
 await expect(dialog.locator('.inventory-tile')).toHaveCount(9);for(const text of ['他人物品不应显示','无主物品不应显示','不适用字段不可见'])await expect(dialog).not.toContainText(text);
 const groups=[['全部',9],['衣物穿戴',4],['电子设备',1],['证件文件',1],['工具与武器',2],['生活用品与杂物',1]] as const;
 for(const [name,count] of groups){await dialog.getByRole('button',{name:`${name}，${count}种物品`,exact:true}).click();await expect(dialog.locator('.inventory-tile')).toHaveCount(count);}
 await dialog.getByRole('button',{name:'全部，9种物品',exact:true}).click();
 if(desktop){await dialog.getByLabel('搜索物品',{exact:true}).fill('日常棉布');await expect(dialog.locator('.inventory-tile')).toHaveCount(1);await dialog.getByLabel('搜索物品',{exact:true}).fill('');}
 const tile=dialog.locator('.inventory-tile').filter({hasText:'日常棉布外套'});await tile.focus();await page.keyboard.press('Enter');await expect(dialog.getByRole('heading',{name:'日常棉布外套',exact:true})).toBeFocused();
 await expect(dialog).toContainText('120.00 元');await expect(dialog).toContainText('材质');await expect(dialog).not.toContainText('不适用字段不可见');
 for(const size of desktop?sizes:[{width:390,height:844}]){
  await page.setViewportSize(size);await fit(page);await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step3/screenshots/inventory-${desktop?size.width:'mobile'}.png`});
  if(desktop){await expect(tile).toHaveAttribute('aria-pressed','true');const rail=(await dialog.locator('.inv-rail').boundingBox())!,mid=(await dialog.locator('.inv-mid').boundingBox())!,detail=(await dialog.locator('.inv-detail').boundingBox())!;expect(rail.x+rail.width).toBeLessThanOrEqual(mid.x+1);if(size.width>=1200)expect(mid.x+mid.width).toBeLessThanOrEqual(detail.x+1);else expect(detail.y).toBeGreaterThanOrEqual(mid.y+mid.height-1);}
 }
 if(desktop){await expect(page.locator('.story-column')).toHaveAttribute('inert');await dialog.press('1');await dialog.press('Control+Enter');await dialog.getByText('来源与归属',{exact:true}).click();await expect(dialog).toContainText('roster-turn-0');await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/inventory-provenance-901.png'});await dialog.getByRole('button',{name:'林舟 · 主角档案',exact:true}).click();await expect(page.getByRole('dialog',{name:'人物档案',exact:true})).toBeVisible();dialog=await inventory(page);await expect(dialog.getByRole('heading',{name:'日常棉布外套',exact:true})).toBeVisible();}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);if(desktop)await expect(page.locator('[data-archive-panel="物品栏"]')).toBeFocused();
 expect(await rosterGame(page)).toEqual(before);verify();
});

test('经济资金、部分未知合计、全字段与原生手机，人物入口/旧Dialog/焦点闭环',async({page},info)=>{
 const desktop=info.project.name==='desktop';if(!desktop)await page.setViewportSize({width:390,height:844});await seed(page);const verify=await readonly(page),before=await rosterGame(page);
 await page.getByLabel('你的行动',{exact:true}).fill('保留行动输入');await openProfile(page);await page.getByRole('dialog',{name:'人物档案',exact:true}).getByRole('button',{name:'经济与资产',exact:true}).click();let dialog=page.getByRole('dialog',{name:'经济与资产',exact:true});await expect(dialog).toHaveJSProperty('tagName',desktop?'SECTION':'DIALOG');
 await expect(dialog).toContainText('3,280.00 元');await expect(dialog).toContainText('46,915.20 元');await expect(dialog).not.toContainText('他人资产不应显示');
 if(desktop){await expect(dialog.getByRole('region',{name:'资产估值合计',exact:true})).toContainText('56,500.00 元');await expect(dialog.getByRole('region',{name:'资产估值合计',exact:true})).toContainText('合计不完整');await expect(dialog.getByRole('region',{name:'未偿本金合计',exact:true})).toContainText('12,600.00 元');await expect(dialog.locator('[data-debt-id="loan"] [role="progressbar"]')).toHaveAttribute('aria-valuenow','70');await expect(dialog.locator('[data-debt-id="unknown"] [role="progressbar"]')).toHaveCount(0);await expect(dialog).toContainText('渝A·00001');await expect(dialog).toContainText('当前载具');}
 for(const size of desktop?sizes:[{width:390,height:844}]){await page.setViewportSize(size);await fit(page);await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step3/screenshots/economy-${desktop?size.width:'mobile'}.png`});}
 if(desktop){await expect(page.locator('[data-archive-panel="经济与资产"]')).toHaveAttribute('aria-current','true');await expect(page.locator('.story-column')).toHaveAttribute('inert');await dialog.press('Control+Enter');await expect(page.getByLabel('你的行动',{exact:true})).toHaveValue('保留行动输入');
  await page.setViewportSize({width:1440,height:900});await dialog.locator('.eco').evaluate(e=>{const target=e.querySelector('[data-asset-id="asset-home"]')!;e.scrollTop+=target.getBoundingClientRect().top-e.getBoundingClientRect().top-20;});await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/economy-assets-1440.png'});
  const loan=dialog.locator('[data-debt-id="loan"]');await loan.getByText('债务完整记录',{exact:true}).click();await expect(loan).toContainText('自动还款授权');await expect(loan).toContainText('asset-home');await expect(loan).toContainText(before.state.economy.debts.loan.source);await dialog.locator('.eco').evaluate(e=>{const target=e.querySelector('[data-debt-id="loan"]')!;e.scrollTop+=target.getBoundingClientRect().top-e.getBoundingClientRect().top-20;});await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/economy-debt-1440.png'});await page.setViewportSize({width:901,height:800});
  await dialog.locator('.eco').evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/economy-details-901.png'});
  await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:'地图',exact:true}).click();const map=page.getByRole('dialog',{name:'地图',exact:true});await expect(map).toHaveJSProperty('tagName','SECTION');await expect.poll(()=>map.evaluate(e=>e.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');dialog=await economy(page);
 }
 await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();if(desktop)await expect(page.locator('[data-archive-panel="经济与资产"]')).toBeFocused();
 if(desktop){dialog=await economy(page);await page.locator('[data-archive-panel="经济与资产"]').click();await expect(dialog).toHaveCount(0);}
 expect(await rosterGame(page)).toEqual(before);verify();
});

test('大量物品收入资产债务分页、独立滚动，原集合顺序和正式状态不变',async({page},info)=>{
 test.skip(info.project.name!=='desktop','桌面分页与分栏专属；手机原有界面另测');await seed(page,120);const verify=await readonly(page),before=await rosterGame(page),started=Date.now(),dialog=await inventory(page);
 const inventoryOpenMs=Date.now()-started;
 const expected=Object.values(before.state.items as Record<string,ImportantItem>).filter(i=>i.ownerRef?.kind==='protagonist'&&i.ownerRef.id===before.state.protagonist.id).map(i=>i.id);
 await expect(dialog.locator('.inventory-tile')).toHaveCount(20);expect(await dialog.locator('.inventory-tile').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-item-id')))).toEqual(expected.slice(0,20));
 await dialog.getByRole('button',{name:'下一页物品',exact:true}).click();expect(await dialog.locator('.inventory-tile').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-item-id')))).toEqual(expected.slice(20,40));
 const tile=dialog.locator('.inventory-tile').last();await tile.scrollIntoViewIfNeeded();const scroll=await dialog.locator('.inv-mid').evaluate(e=>e.scrollTop);await tile.click();expect(await dialog.locator('.inv-mid').evaluate(e=>e.scrollTop)).toBe(scroll);
 await dialog.getByLabel('搜索物品',{exact:true}).fill('库存记录0119');await expect(dialog.locator('.inventory-tile')).toHaveCount(1);await dialog.locator('.inventory-tile').click();
 await page.setViewportSize({width:1100,height:800});await fit(page);await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/inventory-many-1100.png'});await page.keyboard.press('Escape');
 const economyStarted=Date.now(),eco=await economy(page),economyOpenMs=Date.now()-economyStarted;for(const label of ['收入记录','债务记录','其他资产记录']){const list=eco.getByRole('region',{name:label,exact:true});await expect(list).toContainText('每页 20 条');await list.getByRole('button',{name:'下一页',exact:true}).click();await expect(list).toContainText('第 2 页');}
 await eco.locator('.eco').evaluate(e=>{e.scrollTop=e.scrollHeight;});await fit(page);await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/economy-many-1100.png'});await page.emulateMedia({reducedMotion:'reduce'});await expect(eco).toHaveCSS('animation-name','none');
 writeFileSync('docs/desktop-archive-step3/validation/performance.json',JSON.stringify({note:'End-to-end browser automation latency, including waits; not a pure render benchmark.',inventoryOpenMs,economyOpenMs,ownedItemCount:expected.length,renderedItemsPerPage:20,incomeCount:Object.keys(before.state.economy.incomes).length,debtCount:Object.keys(before.state.economy.debts).length},null,2)+'\n');
 expect(await rosterGame(page)).toEqual(before);verify();
});

test('极端金额、超安全范围合计、未知/零债务以及长文本边界',async({page},info)=>{
 test.skip(info.project.name!=='desktop','桌面金额排版；共用money精度由单元覆盖');await seed(page);const verify=await readonly(page);
 await page.evaluate(async()=>{
  const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open(),s=await r.load('save-a');r.close();s.economy.cash=Number.MAX_SAFE_INTEGER;s.economy.onlineBalance=1234567890123;
  s.economy.properties['asset-home'].estimatedValue=Number.MAX_SAFE_INTEGER;s.economy.vehicles.car.estimatedValue=Number.MAX_SAFE_INTEGER;delete s.economy.otherAssets.equipment;
  s.economy.debts.loan.principal=0;s.economy.debts.loan.outstanding=0;s.economy.debts.dispute.principal=100;s.economy.debts.dispute.outstanding=100;
  s.items.coat.name='长期保存的棉布衣物'.repeat(30);s.items.coat.quantity=Number.MAX_SAFE_INTEGER;s.items.coat.description='完整描述，不删除任何文字。'.repeat(180)+'W'.repeat(600);s.items.coat.referenceValue=Number.MAX_SAFE_INTEGER;
  await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction('saves','readwrite');t.objectStore('saves').put(s);t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};});
 });await page.reload();await expect(page.locator('.game-layout')).toBeVisible();const before=await rosterGame(page);let dialog=await economy(page);
 await expect(dialog.getByRole('region',{name:'现金',exact:true})).toContainText('90,071,992,547,409.91 元');await expect(dialog.getByRole('region',{name:'资产估值合计',exact:true})).toContainText('180,143,985,094,819.82 元');await expect(dialog.locator('[data-debt-id="loan"] [role="progressbar"]')).toHaveCount(0);await expect(dialog.locator('[data-debt-id="dispute"] [role="progressbar"]')).toHaveAttribute('aria-valuenow','100');
 const measurements=[];for(const size of sizes){await page.setViewportSize(size);await fit(page);measurements.push(await dialog.locator('.metric-amount').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize,width:e.clientWidth,scrollWidth:e.scrollWidth}))));await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step3/screenshots/economy-extreme-${size.width}.png`});}
 writeFileSync('docs/desktop-archive-step3/validation/amount-layout.json',JSON.stringify(measurements,null,2)+'\n');
 await page.keyboard.press('Escape');dialog=await inventory(page);await dialog.locator('[data-item-id="coat"]').click();const detail=dialog.getByRole('region',{name:'物品详情',exact:true});await expect(detail.locator('.inventory-description')).toHaveText(before.state.items.coat.description!);await expect(detail).toContainText('9007199254740991');await expect(detail).toContainText('90,071,992,547,409.91 元');await detail.evaluate(e=>{e.scrollTop=e.scrollHeight;});await fit(page);await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step3/screenshots/inventory-long-901.png'});
 expect(await rosterGame(page)).toEqual(before);verify();
});
