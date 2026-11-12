import { test, expect } from './helpers/test';
import { seedRoster, openNpcRoster, selectNpc, rosterGame } from './helpers/npcRoster';

test('纸柜非模态焦点、dock切换、关联旧容器、Esc和浏览不写状态',async({page},info)=>{
 if(info.project.name==='mobile') await page.setViewportSize({width:390,height:844});
 await seedRoster(page);let requests=0;await page.route('https://**/*',async r=>{requests++;await r.abort();});
 const before=await rosterGame(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=await openNpcRoster(page);
 if(info.project.name==='mobile'){
  await expect(dialog).toHaveJSProperty('tagName','DIALOG');await selectNpc(page,'许岸');
  await page.screenshot({path:'docs/desktop-npc-cabinet/screenshots/react-mobile.png'});
  await page.keyboard.press('Escape');expect(await rosterGame(page)).toEqual(before);return;
 }
 await expect(dialog).toHaveAttribute('aria-modal','false');await expect(dialog).toBeFocused();
 await expect(page.locator('.story-column')).toHaveAttribute('inert');
 await expect(page.getByRole('button',{name:'NPC',exact:true})).toHaveAttribute('aria-current','true');
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'docs/desktop-npc-cabinet/screenshots/react-list.png'});
 await selectNpc(page,'许岸');await expect(dialog.getByRole('heading',{name:'许岸',exact:true})).toBeFocused();
 for(const size of [{width:1440,height:900},{width:1280,height:800},{width:1100,height:800}]){
  await page.setViewportSize(size);await page.screenshot({path:`docs/desktop-npc-cabinet/screenshots/react-${size.width}.png`});
  const rect=(await dialog.boundingBox())!;expect(rect.x).toBeGreaterThan(200);expect(rect.y).toBe(76);expect(rect.x+rect.width).toBeLessThan(size.width-60);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 const input=page.getByLabel('你的行动',{exact:true});await dialog.press('1');await dialog.press('Control+Enter');await expect(input).toHaveValue('');
 await dialog.getByRole('button',{name:'记忆与总结',exact:true}).click();await expect(dialog.getByRole('button',{name:'记忆与总结',exact:true})).toHaveAttribute('aria-current','true');
 await page.getByRole('button',{name:'NPC',exact:true}).focus();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'NPC',exact:true})).toBeFocused();
 await openNpcRoster(page);await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'NPC',exact:true})).toBeFocused();
 await openNpcRoster(page);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'NPC',exact:true})).toBeFocused();
 await openNpcRoster(page);await page.getByRole('button',{name:'NPC',exact:true}).click();await expect(dialog).toHaveCount(0);
 for(const name of ['势力组织','地图','物品栏','世界事件','历史时间轴','记忆']){
  await openNpcRoster(page);await page.getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('dialog',{name,exact:true})).toHaveJSProperty('tagName',['势力组织','物品栏'].includes(name)?'SECTION':'DIALOG');await page.keyboard.press('Escape');
 }
 expect(await rosterGame(page)).toEqual(before);expect(requests).toBe(0);expect(errors).toEqual([]);
});

test('大量NPC长姓名长描述：独立滚动、筛选、分页与完整字段',async({page},info)=>{
 test.skip(info.project.name!=='desktop','桌面专属布局；手机由原NPC回归覆盖');
 await seedRoster(page);
 await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open();const state=await r.load('save-a');r.close();
  state.npc.special.name='许岸与工作室的长期记录者'.repeat(10);
  for(let i=0;i<125;i++){const id=`stress-${i}`;state.npc[id]={...structuredClone(state.npc.person),id,identityKey:id,name:`名录测试${i}`,aliases:[]};}
  await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction('saves','readwrite');t.objectStore('saves').put(state);t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};});
 });await page.reload();const before=await rosterGame(page);const dialog=await openNpcRoster(page);
 await dialog.getByRole('button',{name:'下一页人物'}).click();await expect(dialog).toContainText('第 2 页');
 await dialog.getByLabel('搜索人物',{exact:true}).fill('许岸');await dialog.getByRole('button',{name:/查看人物：许岸/}).click();
 const detail=dialog.getByRole('region',{name:'人物详情',exact:true});await expect(detail.locator('.npc-detail-heading')).toHaveAttribute('data-long-heading','true');await expect(detail.getByRole('heading',{level:3})).toContainText('许岸与工作室的长期记录者'.repeat(10));
 for(const width of [1440,1280,1100]){await page.setViewportSize({width,height:800});await detail.evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.screenshot({path:`docs/desktop-npc-cabinet/screenshots/stress-${width}.png`});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 expect(await detail.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(dialog).toHaveCSS('animation-name','none');
 expect(await rosterGame(page)).toEqual(before);
});

test('NPC与关联组织往返保留目标定位，手机组织仍为原生模态',async({page},info)=>{
 await seedRoster(page);await page.evaluate(async()=>{
  const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/organizations.ts'];const [{SaveRepository},{organizationState}]=await Promise.all(paths.map(p=>import(p)));const r=await SaveRepository.open(),s=await r.load('save-a');r.close();s.organizations=organizationState().organizations;
  await new Promise<void>(resolve=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction('saves','readwrite');t.objectStore('saves').put(s);t.oncomplete=()=>{db.close();resolve();};};});
 });await page.reload();const before=await rosterGame(page);let dialog=await openNpcRoster(page);await selectNpc(page,'林澄');
 await dialog.getByRole('button',{name:'澄川工贸',exact:true}).click();const org=page.getByRole('dialog',{name:'势力组织',exact:true});await expect(org).toHaveJSProperty('tagName',info.project.name==='desktop'?'SECTION':'DIALOG');await expect(org.getByRole('heading',{name:'澄川工贸',exact:true})).toBeVisible();
 await org.getByRole('button',{name:'林澄',exact:true}).click();dialog=page.getByRole('dialog',{name:'NPC',exact:true});await expect(dialog.getByRole('heading',{name:'林澄',exact:true})).toBeVisible();
 if(info.project.name==='desktop'){
  await dialog.locator('button,input,select,summary').last().focus();let dock=false;for(let i=0;i<20;i++){await page.keyboard.press('Tab');dock=await page.evaluate(()=>Boolean(document.activeElement?.closest('.world-sidebar')));if(dock)break;}expect(dock).toBe(true);
 }
 expect(await rosterGame(page)).toEqual(before);
});
