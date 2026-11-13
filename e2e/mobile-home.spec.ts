import {test,expect} from './helpers/test';
import {seedTickets,ticketAt,rawSnapshot} from './helpers/mobileHome';
import {readFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';
const shots='docs/mobile-batch3/screenshots';
async function shot(page:Page,name:string){await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${shots}/${name}.png`,fullPage:true,animations:'disabled'});}
async function drag(page:Page,dy:number,cancel=false){
 const stub=page.locator('.mh-ticket-wrap[aria-current=true] .mh-stub'),box=(await stub.boundingBox())!;
 await page.mouse.move(box.x+40,box.y+20);await page.mouse.down();await page.mouse.move(box.x+40,box.y+20+dy,{steps:5});
 if(cancel)await stub.dispatchEvent('pointercancel');await page.mouse.up();
}
const postCalls=new WeakMap<Page,number>();
test.beforeEach(async({page})=>{postCalls.set(page,0);await page.route('**/*',r=>{if(r.request().method()==='POST'){postCalls.set(page,(postCalls.get(page)??0)+1);return r.abort('blockedbyclient');}return r.continue();});});
test.afterEach(({page})=>expect(postCalls.get(page)).toBe(0));

test('排序、四城、中性、页码、键盘与横滑纯浏览不写入',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page),selection=await page.evaluate(()=>localStorage.getItem('heijin.selected.v1'));
 await expect(page.locator('.mh-ticket').first()).toHaveAttribute('data-city','sh');await expect(page.locator('.mh-ticket').last()).toHaveClass(/blank/);
 await expect(page.locator('.mh-board')).toHaveAccessibleName(/上海.*23:41.*已选择/);await shot(page,'selected-sh-390');
 for(const [i,city] of ['sh','cq','hrb','gz','neutral'].entries()){
  await ticketAt(page,i);await expect(page.locator('.mh-ticket').nth(i)).toHaveAttribute('data-city',city);await shot(page,`ticket-${city}-390`);
 }
 await expect(page.locator('.mh-ticket').nth(4).locator('.mh-co')).toHaveCount(0);await expect(page.locator('.mh-board')).toHaveAccessibleName(/未知/);
 const rail=page.locator('.mh-rail');await rail.focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.mh-board')).toHaveAccessibleName(/新人生/);await shot(page,'blank-draft-390');
 await page.keyboard.press('ArrowLeft');await expect(page.locator('.mh-ticket-wrap').nth(4)).toHaveAttribute('aria-current','true');
 await expect(page.locator('.mh-ticket-content[tabindex="0"]')).toHaveCount(1);await page.locator('.mh-dots [aria-current=true]').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.mh-dots button').last()).toBeFocused();
 await rail.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));await expect(page.locator('.mh-dots button').first()).toHaveAttribute('aria-current','true');
 expect(await rawSnapshot(page)).toEqual(before);expect(await page.evaluate(()=>localStorage.getItem('heijin.selected.v1'))).toBe(selection);expect(new URL(page.url()).hash).toBe('');
});
test('真实触摸横滑同步当前页和发车屏，不读取也不写正式数据',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page),client=await page.context().newCDPSession(page),box=(await page.locator('.mh-rail').boundingBox())!;
 const y=box.y+100;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y}]});
 for(const x of [270,230,190,150,110,70])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.locator('.mh-ticket-wrap').nth(1)).toHaveAttribute('aria-current','true');await expect(page.locator('.mh-board')).toHaveAccessibleName(/重庆/);expect(new URL(page.url()).hash).toBe('');expect(await rawSnapshot(page)).toEqual(before);
});
test('明确选择持久化、重新排序且重载恢复首张',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page);await ticketAt(page,3);await page.getByRole('button',{name:'选择',exact:true}).click();
 await expect(page.locator('.mh-ticket').first()).toHaveAttribute('data-city','gz');await expect(page.locator('.mh-board')).toHaveAccessibleName(/广州.*已选择/);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('heijin.selected.v1')!))).toBe('ticket-3');expect(await rawSnapshot(page)).toEqual(before);
 await page.reload();await expect(page.locator('.mh-ticket').first()).toHaveAttribute('data-city','gz');await expect(page.locator('.mh-ticket-wrap').first()).toHaveAttribute('aria-current','true');
});
test('短拖与 pointercancel 不读取；reduced-motion 撕票立即进入同一存档',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page);await drag(page,40);await expect(page.locator('.mh-stub.torn')).toHaveCount(0);expect(new URL(page.url()).hash).toBe('');
 await drag(page,90,true);expect(new URL(page.url()).hash).toBe('');expect(await rawSnapshot(page)).toEqual(before);
 await drag(page,70);await expect(page).toHaveURL(/#game\/ticket-1$/);await expect(page.locator('.game-layout')).toBeVisible();
});
test('金色按钮等价读取，快速双击只导航一次',async({page})=>{
 await seedTickets(page);await ticketAt(page,1);await page.evaluate(()=>{let n=0;window.addEventListener('hashchange',()=>Reflect.set(window,'hashEvents',++n));});
 await page.getByRole('button',{name:/^读取存档/}).click({clickCount:2});await expect(page).toHaveURL(/#game\/ticket-0$/);await expect(page.locator('.game-layout')).toBeVisible();expect(await page.evaluate(()=>Reflect.get(window,'hashEvents'))).toBe(1);
});
test('真实撕票动画、重复操作锁与切换/刷新/卸载清理',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await seedTickets(page);
 await drag(page,72);await expect(page.locator('.mh-stub.torn')).toHaveCount(1);await expect(page.locator('.mh-primary')).toBeDisabled();await shot(page,'tear-action-390');
 await ticketAt(page,2);await expect(page.locator('.mh-stub.torn')).toHaveCount(0);await page.waitForTimeout(800);expect(new URL(page.url()).hash).toBe('');
 await page.locator('.mh-primary').click();await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.waitForTimeout(800);expect(new URL(page.url()).hash).toBe('');
 await page.locator('.mh-primary').click();await page.goto('/#create');await page.waitForTimeout(800);await expect(page).toHaveURL(/#create$/);
 await page.goto('/');await page.locator('.mh-primary').click();await expect(page).toHaveURL(/#game\/ticket-1$/);
});
test('空白车票恢复正式创角草稿；无草稿空态按钮可达',async({page})=>{
 await seedTickets(page,0,true);await expect(page.locator('.mh-draft')).toContainText('尚未完成');await drag(page,70);await expect(page).toHaveURL(/#create$/);await expect(page.getByLabel('姓名',{exact:true})).toHaveValue('待发车的旅人');
 await page.evaluate(()=>localStorage.removeItem('heijin.creation.v1'));await page.goto('/');await page.reload();await expect(page.locator('.mh-draft')).toHaveCount(0);await expect(page.locator('.mh-dots button')).toHaveCount(1);await shot(page,'empty-390');
 await page.getByRole('button',{name:/^开始新游戏/}).click();await expect(page.getByLabel('姓名',{exact:true})).toHaveValue('');
});
test('删除取消不写；只有原子删除成功才作废，关联记录和选择保护',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page);await page.getByRole('button',{name:'删除',exact:true}).click();const dialog=page.getByRole('dialog',{name:'删除这份存档？'});
 await expect(dialog).toContainText('ticket-1');await expect(dialog).toContainText('此操作无法撤销');await shot(page,'delete-confirm-390');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await rawSnapshot(page)).toEqual(before);await expect(page.getByRole('button',{name:'删除',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'删除',exact:true}).click();await dialog.getByRole('button',{name:'确认删除'}).click();
 await expect(page.locator('.void-chop')).toBeVisible();const after=await rawSnapshot(page);expect(after).toEqual(before.filter(v=>v.records.saves[0].key!=='ticket-1'));await shot(page,'void-390');
 await expect(page.locator('.mh-ticket')).toHaveCount(5);await expect(page.locator('.mh-status')).toContainText('已删除');await page.reload();await expect(page.locator('.mh-ticket')).toHaveCount(5);
});
test('删除飞行中禁用操作、Esc 不取消提交；成功后才显示作废',async({page})=>{
 await seedTickets(page);await page.evaluate(async()=>{const rp='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(rp),remove=SaveRepository.prototype.delete;SaveRepository.prototype.delete=async function(...args:Parameters<typeof remove>){await new Promise(r=>setTimeout(r,1000));return remove.apply(this,args);};});
 await page.getByRole('button',{name:'删除',exact:true}).click();const dialog=page.getByRole('dialog',{name:'删除这份存档？'});await dialog.getByRole('button',{name:'确认删除'}).click();
 await expect(dialog.getByRole('button',{name:'正在删除…'})).toBeDisabled();await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'刷新列表',exact:true})).toBeDisabled();await expect(page.locator('.void-chop')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(page.locator('.void-chop')).toBeVisible();await expect(page.locator('.mh-ticket')).toHaveCount(5);
});
test('删除存储失败保留记录，不显示作废，刷新后可恢复',async({page})=>{
 await seedTickets(page);const before=await rawSnapshot(page);await page.getByRole('button',{name:'删除',exact:true}).click();
 await page.evaluate(async()=>{const rp='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(rp),repo=await SaveRepository.open();repo.close();
  const remove=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(this.name==='saves')throw new DOMException('denied','SecurityError');return remove.call(this,key);};Reflect.set(window,'restoreDelete',()=>{IDBObjectStore.prototype.delete=remove;});});
 await page.getByRole('button',{name:'确认删除'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('本次未删除数据');await expect(page.locator('.void-chop')).toHaveCount(0);expect(await rawSnapshot(page)).toEqual(before);
 await page.evaluate(()=>Reflect.get(window,'restoreDelete')());await page.keyboard.press('Escape');await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.mh-ticket')).toHaveCount(6);
});
test('删除版本冲突保留正式新版本，不能误删或提前盖作废章',async({page})=>{
 await seedTickets(page);await page.getByRole('button',{name:'删除',exact:true}).click();
 await page.evaluate(async()=>{const rp='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(rp),repo=await SaveRepository.open();await repo.save('ticket-1',0,'external-turn',[{type:'SetWorldClock',commandId:'advance-for-cas',worldClock:'2026-10-18T08:10:00+08:00',evidence:'经过十分钟'}]);repo.close();});
 const before=await rawSnapshot(page);await page.getByRole('button',{name:'确认删除'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('删除失败');await expect(page.locator('.void-chop')).toHaveCount(0);expect(await rawSnapshot(page)).toEqual(before);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.mh-ticket-wrap')).toHaveCount(6);
});
test('无法读取保留异常 ID，不能撕，原始导出完整且不改库',async({page})=>{
 await page.route('**/prepare-storage',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated legacy database setup</title>'}));
 await page.goto('/prepare-storage');
 const broken={saveId:'ticket-foreign',title:'旧版'.repeat(40),schemaVersion:999,original:'原文\n原始资料'};
 await page.evaluate(async(broken)=>{await new Promise<void>((resolve,reject)=>{
  const r=indexedDB.open('heijinwangchao',3);
  r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('saves');db.createObjectStore('drafts',{keyPath:'saveId'});db.createObjectStore('turnReceipts',{keyPath:['saveId','turnId']}).createIndex('saveId','saveId');db.createObjectStore('turnUndo',{keyPath:['saveId','turnId']}).createIndex('saveId','saveId');db.createObjectStore('saveControls',{keyPath:'saveId'});};
  r.onsuccess=()=>{const db=r.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(broken,'strange-key');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
 });},broken);
 await page.goto('/');await expect(page.locator('.mh-ticket')).toHaveCount(2);await expect(page.locator('.mh-ticket-wrap').first()).toHaveAttribute('aria-current','true');const before=await rawSnapshot(page);
 await expect(page.locator('.mh-ticket.bad')).toContainText('存档记录 ID：strange-key');await expect(page.locator('.mh-ticket.bad')).toContainText('内容中的存档 ID：ticket-foreign');await expect(page.locator('.mh-primary')).toHaveCount(0);await drag(page,90);expect(new URL(page.url()).hash).toBe('');
 await shot(page,'unreadable-390');const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出原始数据',exact:true}).click();const dl=await pending;
 const data=JSON.parse(await readFile((await dl.path())!,'utf8'));expect(data.records.saves).toEqual([{key:'strange-key',value:broken}]);expect(await rawSnapshot(page)).toEqual(before);await expect(page.locator('.mh-acts [role=status]')).toContainText('数据库未修改');
});
test('真实 Repository loading 与 listError，刷新恢复，不假冒空列表',async({page})=>{
 await seedTickets(page);await page.evaluate(async()=>{const rp='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(rp),list=SaveRepository.prototype.list;SaveRepository.prototype.list=async function(){await new Promise(r=>setTimeout(r,1200));return list.call(this);};});
 await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.mh-skeleton')).toHaveCount(2);await expect(page.locator('.mh-board')).toHaveAccessibleName(/读取中/);await shot(page,'loading-390');await expect(page.locator('.mh-ticket-wrap')).toHaveCount(6);
 await page.evaluate(()=>{const get=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.name==='saves')throw new DOMException('denied','SecurityError');return get.apply(this,args);};Reflect.set(window,'restoreList',()=>{IDBObjectStore.prototype.getAll=get;});});
 await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.mh-error')).toHaveText('存档列表暂时无法访问，请检查浏览器存储权限后重试。原始数据未修改。');await expect(page.locator('.mh-board')).toHaveAccessibleName(/暂停检票/);await shot(page,'list-error-390');await expect(page.getByRole('button',{name:/^开始新游戏/})).toBeEnabled();await expect(page.locator('.mh-empty')).toHaveCount(0);
 await page.evaluate(()=>Reflect.get(window,'restoreList')());await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.mh-ticket-wrap')).toHaveCount(6);
});
test('Repository 不可用时错误原文保留、创建和票根禁用',async({page})=>{
 await page.addInitScript(()=>{IDBFactory.prototype.open=()=>{throw new DOMException('denied','SecurityError');};});await page.goto('/');await expect(page.locator('.mh-error')).toContainText('本地存档无法打开');await expect(page.getByRole('button',{name:/^开始新游戏/})).toBeDisabled();await expect(page.getByRole('button',{name:'刷新列表'})).toBeDisabled();await shot(page,'repository-disabled-390');
});
for(const [width,height] of [[375,667],[390,844],[430,932],[750,800],[900,800]])test(`长文本与大量存档 ${width}×${height} 无溢出，底部和设置/公告可达`,async({page})=>{
 await page.setViewportSize({width,height});await seedTickets(page,25,true,true);const before=await rawSnapshot(page);
 await expect(page.locator('.mh-ticket')).toHaveCount(26);await expect(page.locator('.mh-dots button')).toHaveCount(26);
 await page.locator('.mh-ticket-content').first().evaluate(el=>{el.scrollTop=el.scrollHeight;});await shot(page,`stress-${width}`);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const name of ['游玩须知与免责声明','王朝公告']){const link=page.getByRole('button',{name,exact:true});await link.scrollIntoViewIfNeeded();await expect(link).toBeInViewport();await link.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');}
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await page.keyboard.press('Escape');expect(await rawSnapshot(page)).toEqual(before);
});
