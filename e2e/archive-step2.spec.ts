import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedRoster, rosterGame, selectNpc } from './helpers/npcRoster';
import { openProfile, openWorldArchive } from './helpers/gameLayout';

async function seed(page:Page,stress=false){
 await seedRoster(page);
 await page.evaluate(async stress=>{
  const paths=['/src/tests/fixtures/organizations.ts','/src/domain/drafts.ts'];
  const [{organizationArchiveState},{createTurnDraft}]=await Promise.all(paths.map(p=>import(p))),state=organizationArchiveState(stress?45:0);
  state.protagonist.professionDescription='负责授课与教学准备。';state.protagonist.professionLongTermImpact='教学经验影响交流和观察习惯。';state.protagonist.skills=['授课','沟通'];
  if(stress){
   const org=state.organizations['org-business'];org.name='澄川长期协作与维修制造联合企业'.repeat(12);org.description='沿江社区的业务、经营背景与合作情况。'.repeat(350);
   org.relationHistory=Array.from({length:45},(_,i)=>i===44?'没有日期的原始关系记录':`2026-10-18T08:00:00.123+08:00 原始关系记录 ${i}`);
   org.leadership!.push(...Array.from({length:24},(_,i)=>({position:`业务负责人${i}`,publicName:`正式登记人物${i}`,description:'已登记的管理职责与项目说明。'.repeat(10)})));
   for(let i=0;i<45;i++){
    const id=`extra-event-${i}`;state.events[id]={...structuredClone(state.events['org-active']),id,title:`正式业务事件${i}`};
    const taskId=`extra-task-${i}`;state.tasks[taskId]={...structuredClone(state.tasks['org-work']),id:taskId,goal:`正式业务任务${i}`};
   }
   for(const key of ['healthText','emotionText','publicStatus','legalStatus'])state.protagonist[key]='保留完整状态描述与异常长文本。'.repeat(80)+'W'.repeat(400);
  }
  await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction(['saves','drafts'],'readwrite');t.objectStore('saves').put(state);t.objectStore('drafts').put(createTurnDraft(state.saveId,state.revision,'step2-draft','regular',''));t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};q.onerror=()=>reject(q.error);});
 },stress);await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function org(page:Page){await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:'势力组织',exact:true}).click();return page.getByRole('dialog',{name:'势力组织',exact:true});}
async function fit(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const dialog=page.locator('.archive');if(await dialog.count())expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
async function readonly(page:Page){let calls=0;const errors:string[]=[];await page.route('https://**/*',async r=>{calls++;await r.abort();});page.on('pageerror',e=>errors.push(e.message));return ()=>{expect(calls).toBe(0);expect(errors).toEqual([]);};}

 test('人物档案真实字段、职业七槽、三入口、四尺寸与关闭回焦，手机保持原生资料',async({page},info)=>{
 await seed(page);const verify=await readonly(page),before=await rosterGame(page),desktop=info.project.name==='desktop';
 await page.getByLabel('你的行动',{exact:true}).fill('保持原行动输入');await openProfile(page);let dialog=page.getByRole('dialog',{name:'人物档案',exact:true});
 await expect(dialog).toHaveJSProperty('tagName',desktop?'SECTION':'DIALOG');
 const labels=await dialog.locator('.profile-details dt').allTextContents();expect(labels.filter(x=>x!=='候选时间')).toEqual(expect.arrayContaining(['姓名','年龄','性别','职业','外貌','性格','背景','当前时间','地点','天气','环境','身体','情绪','社会状态','法律状态']));
 expect(labels).toHaveLength(desktop?15:16);await expect(dialog.getByRole('region',{name:'职业档案',exact:true})).toContainText(before.state.protagonist.professionDescription!);
 await expect(dialog.getByRole('region',{name:'职业档案',exact:true})).toContainText(before.state.protagonist.professionLongTermImpact!);
 expect(await dialog.getByRole('heading',{name:'当前穿戴与装备',exact:true}).locator('xpath=following-sibling::dl[1]').locator('dt').allTextContents()).toEqual(['上衣','下装','鞋子','饰品','主武器','副武器','载具']);
 const sizes=desktop?[{width:1440,height:900},{width:1280,height:800},{width:1920,height:1080},{width:1100,height:800}]:[{width:390,height:844}];
 for(const size of sizes){await page.setViewportSize(size);await fit(page);await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step2/screenshots/profile-${desktop?size.width:'mobile'}.png`});if(desktop){await expect(page.locator('[data-archive-panel="人物档案"]')).toHaveAttribute('aria-current','true');await expect(dialog.locator('.pf-stamp')).toHaveAttribute('aria-hidden','true');if(size.width===1440){await dialog.locator('.pf').evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/profile-equipment-1440.png'});await dialog.locator('.pf').evaluate(e=>{e.scrollTop=0;});}if(size.width<1200)await expect(dialog.locator('.pf-stamp')).toBeHidden();}}
 if(desktop){await expect(dialog.locator('.sec').first()).toHaveCSS('background-color','rgb(239, 232, 217)');await expect(page.locator('.story-column')).toHaveAttribute('inert');await dialog.press('1');await dialog.press('Control+Enter');}
 await dialog.getByRole('button',{name:'经济与资产',exact:true}).click();const economy=page.getByRole('dialog',{name:'经济与资产',exact:true});await expect(economy).toHaveJSProperty('tagName','DIALOG');
 for(const name of ['收入','债务','房产','车辆','其他资产'])await expect(economy.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(economy).toHaveJSProperty('open',true);expect(await economy.evaluate(e=>e.matches(':modal'))).toBe(true);if(desktop)await expect.poll(()=>economy.evaluate(e=>e.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(economy).toHaveCount(0);
 await expect(page.getByLabel('你的行动',{exact:true})).toHaveValue('保持原行动输入');await openProfile(page);dialog=page.getByRole('dialog',{name:'人物档案',exact:true});await dialog.getByRole('button',{name:'NPC 人物资料',exact:true}).click();await expect(page.getByRole('dialog',{name:'NPC',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await openProfile(page);dialog=page.getByRole('dialog',{name:'人物档案',exact:true});await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();if(desktop)await expect(page.locator('[data-archive-panel="人物档案"]')).toBeFocused();
 await openProfile(page);await page.getByRole('dialog',{name:'人物档案',exact:true}).getByRole('button',{name:'切换存档',exact:true}).click();await expect(page.locator('.game-layout')).toHaveCount(0);
 expect(await rosterGame(page)).toEqual(before);verify();
});

 test('四种组织颜色、完整字段、折叠、双滚动、纸色吸顶及桌面矩阵',async({page},info)=>{
 await seed(page);const verify=await readonly(page),before=await rosterGame(page),desktop=info.project.name==='desktop';let dialog=await org(page);
 await expect(dialog).toHaveJSProperty('tagName',desktop?'SECTION':'DIALOG');
 if(desktop){for(const [kind,color] of Object.entries({gang:'#a3412e',government:'#2d5e7d',civil:'#2f7a58',business:'#8e6c25'})){expect((await dialog.locator(`.org-row[data-kind="${kind}"]`).evaluate(e=>getComputedStyle(e).getPropertyValue('--k'))).trim().toLowerCase()).toBe(color);}}
 await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();const detail=dialog.getByRole('region',{name:'组织详情',exact:true});
 await expect(detail).toContainText('实际控制人：未知');await expect(detail.getByRole('button',{name:'顾行远',exact:true})).toHaveCount(0);await expect(detail.locator('details.world-record')).not.toHaveAttribute('open');
 await detail.getByText('阅读完整组织概况',{exact:true}).click();await expect(detail.getByText('阅读完整组织概况',{exact:true}).locator('..').locator('p')).toHaveText(before.state.organizations['org-business'].description);await detail.getByText('阅读完整组织概况',{exact:true}).click();
 for(const size of desktop?[{width:1440,height:900},{width:1280,height:800},{width:1920,height:1080},{width:1100,height:800}]:[{width:390,height:844}]){
  await page.setViewportSize(size);await detail.evaluate(e=>{e.scrollTop=0;});await fit(page);if(desktop){await expect(detail.locator('.organization-detail-heading')).toHaveCSS('background-color','rgb(228, 220, 202)');await expect(detail.locator('.organization-detail-heading')).toHaveCSS('opacity','1');}
  await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step2/screenshots/organization-${desktop?size.width:'mobile'}.png`});if(desktop&&size.width===1440){await detail.evaluate(e=>{const target=e.querySelector('[data-org-section=state]')!,head=e.querySelector('.organization-detail-heading')!;e.scrollTop+=target.getBoundingClientRect().top-e.getBoundingClientRect().top-head.getBoundingClientRect().height-12;});await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/organization-details-1440.png'});}
 }
 if(desktop){await dialog.getByRole('button',{name:'当前动态',exact:true}).click();await expect(dialog.getByRole('button',{name:'当前动态',exact:true})).toHaveAttribute('aria-current','true');await expect.poll(()=>detail.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await expect(dialog.getByLabel('搜索组织',{exact:true})).toBeInViewport();}
 await detail.locator('details.world-record > summary').click();await expect(detail.locator('details.world-record')).toHaveAttribute('open','');await expect(detail.locator('details.world-record')).toContainText('org-business');
 await page.keyboard.press('Escape');if(desktop)await expect(page.locator('[data-archive-panel="势力组织"]')).toBeFocused();
 dialog=await org(page);const back=dialog.getByRole('button',{name:'← 返回组织名录',exact:true});if(await back.isVisible())await back.click();
 await dialog.getByLabel('组织类别',{exact:true}).selectOption('government');await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(1);await dialog.getByLabel('搜索组织',{exact:true}).fill('不存在的组织');await expect(dialog).toContainText('暂无符合条件的组织');
 expect(await rosterGame(page)).toEqual(before);verify();
});

 test('人物→NPC⇄组织→组织→旧事件，返回保留目标、焦点与输入隔离',async({page},info)=>{
 await seed(page);const verify=await readonly(page),before=await rosterGame(page),desktop=info.project.name==='desktop';await openProfile(page);await page.getByRole('dialog',{name:'人物档案',exact:true}).getByRole('button',{name:'NPC 人物资料',exact:true}).click();
 let npc=page.getByRole('dialog',{name:'NPC',exact:true});await selectNpc(page,'林澄');if(desktop)await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/npc-to-organization.png'});await npc.getByRole('button',{name:'澄川工贸',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'势力组织',exact:true}),detail=dialog.getByRole('region',{name:'组织详情',exact:true});await expect(detail.getByRole('heading',{name:'澄川工贸',exact:true})).toBeVisible();if(desktop){await expect(detail.getByRole('heading',{name:'澄川工贸',exact:true})).toBeFocused();await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/organization-from-npc.png'});}
 await detail.getByRole('button',{name:'林澄',exact:true}).click();npc=page.getByRole('dialog',{name:'NPC',exact:true});await expect(npc.getByRole('heading',{name:'林澄',exact:true})).toBeVisible();if(desktop){await expect(npc.getByRole('heading',{name:'林澄',exact:true})).toBeFocused();await expect(npc.locator('.npc-detail-heading')).toHaveCSS('background-color','rgb(228, 220, 202)');}
 await npc.getByRole('button',{name:'澄川工贸',exact:true}).click();dialog=page.getByRole('dialog',{name:'势力组织',exact:true});detail=dialog.getByRole('region',{name:'组织详情',exact:true});await detail.getByRole('button',{name:'旧城互助会',exact:true}).click();await expect(detail.getByRole('heading',{name:'旧城互助会',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 dialog=await org(page);if(desktop)await expect(dialog.getByRole('heading',{name:'旧城互助会',exact:true})).toBeVisible();const back=dialog.getByRole('button',{name:'← 返回组织名录',exact:true});if(await back.isVisible())await back.click();await dialog.getByLabel('搜索组织',{exact:true}).fill('澄川');await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();
 await dialog.getByRole('button',{name:'业务整合与新车间交接',exact:true}).click();const event=page.getByRole('dialog',{name:'世界事件',exact:true});await expect(event).toHaveJSProperty('tagName','DIALOG');await expect(event.getByRole('heading',{name:'业务整合与新车间交接',exact:true})).toBeVisible();if(desktop)await expect(event.locator('[data-file-heading]:visible').first()).toBeFocused();else{expect(await event.evaluate(e=>e.matches(':modal'))).toBe(true);await page.keyboard.press('Tab');await expect.poll(()=>event.evaluate(e=>e.contains(document.activeElement))).toBe(true);}await event.press('Control+Enter');await page.keyboard.press('Escape');
 if(desktop)await expect(page.locator('[data-archive-panel="势力组织"]')).toBeFocused();dialog=await org(page);if(desktop)await expect(dialog.getByRole('heading',{name:'澄川工贸',exact:true})).toBeVisible();
 expect(await rosterGame(page)).toEqual(before);verify();
});

 test('长组织名/概况/状态、49组织与大量任务事件历史：独立滚动和分页不丢字段',async({page},info)=>{
 test.skip(info.project.name!=='desktop','桌面专属压力布局；手机原有压力回归另行执行');await seed(page,true);const verify=await readonly(page),before=await rosterGame(page),dialog=await org(page);
 await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(20);await dialog.getByRole('button',{name:'下一页组织',exact:true}).click();await dialog.getByRole('button',{name:'下一页组织',exact:true}).click();await expect(dialog).toContainText('3/3');
 await dialog.getByLabel('搜索组织',{exact:true}).fill('澄川');await dialog.getByRole('button',{name:/查看组织：澄川/}).click();const detail=dialog.getByRole('region',{name:'组织详情',exact:true});await expect(detail.locator('.organization-detail-heading')).toHaveAttribute('data-long-heading','true');
 await detail.getByText('阅读完整组织概况',{exact:true}).click();await expect(detail.getByText('阅读完整组织概况',{exact:true}).locator('..').locator('p')).toHaveText(before.state.organizations['org-business'].description);await detail.getByText('阅读完整组织概况',{exact:true}).click();
 const events=detail.getByRole('region',{name:'组织进行中事件',exact:true});await expect(events.locator('.dyn-entry')).toHaveCount(20);await events.getByRole('button',{name:'下一页',exact:true}).click();await expect(events).toContainText('第 2 页');
 const tasks=detail.getByRole('region',{name:'组织当前任务',exact:true});await expect(tasks.locator('.dyn-entry')).toHaveCount(20);await tasks.getByRole('button',{name:'下一页',exact:true}).click();await expect(tasks).toContainText('第 2 页');
 await detail.getByText('关系历史 · 45',{exact:true}).click();const history=detail.getByRole('region',{name:'组织关系历史',exact:true});await expect(history.locator('.history-entry')).toHaveCount(20);await history.getByRole('button',{name:'下一页',exact:true}).click();await expect(history).toContainText('2026-10-18T08:00:00.123+08:00 原始关系记录 20');await history.getByLabel('搜索组织关系历史',{exact:true}).fill('没有日期');await expect(history).toContainText('没有日期的原始关系记录');
 for(const width of [1440,1280,1100]){await page.setViewportSize({width,height:800});await detail.evaluate(e=>{e.scrollTop=e.scrollHeight;});await fit(page);expect(await detail.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2)).toBe(true);await page.screenshot({animations:'disabled',path:`docs/desktop-archive-step2/screenshots/organization-stress-${width}.png`});}
 await page.keyboard.press('Escape');await openProfile(page);const profile=page.getByRole('dialog',{name:'人物档案',exact:true});
 for(const [index,key] of ['healthText','emotionText','publicStatus','legalStatus'].entries()){const card=profile.locator('.cond-card').nth(index);await expect(card.locator('dd')).toHaveText(String(before.state.protagonist[key as keyof typeof before.state.protagonist]));expect(await card.locator('dd').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);}
 await profile.locator('.pf').evaluate(e=>{e.scrollTop=e.scrollHeight;});await fit(page);await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/profile-long-1100.png'});await page.emulateMedia({reducedMotion:'reduce'});await expect(profile).toHaveCSS('animation-name','none');
 expect(await rosterGame(page)).toEqual(before);verify();
});

 test('正式待确认开局：16字段含真实候选时间，当前时间保持待确认',async({page},info)=>{
 await seedRoster(page);const verify=await readonly(page);
 await page.evaluate(async()=>{
  const paths=['/src/ui/creation/model.ts','/src/ui/settings/model.ts','/src/domain/drafts.ts','/src/domain/openingTime.ts'];const [{newCreation,buildCreationState},{defaultSettings},{createTurnDraft,rerollStory},{openingTimeSelection}]=await Promise.all(paths.map(p=>import(p)));
  const form={...newCreation(),person:{name:'林舟',age:'30',gender:'男性',appearance:'深色外套',personality:'谨慎'},profession:'教师'},state=buildCreationState(form,defaultSettings());state.saveId='save-a';
  const time={startAt:'2026-10-18T08:00:00+08:00',endAt:'2026-10-18T08:01:00+08:00'},anchor='2026年10月18日08:00，重庆街头。';
  const draft=rerollStory(createTurnDraft(state.saveId,state.revision,'profile-opening','opening',''),{turnKind:'opening',narrative:anchor+'主角开始新的一天。',summary:'开始新一天。',variableGuide:[{group:'time',subjectHint:'time:opening',observedFact:JSON.stringify(time),textEvidence:anchor}]});
  if(!openingTimeSelection(state,draft))throw new Error('invalid fixture opening time');
  await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction(['saves','drafts'],'readwrite');t.objectStore('saves').put(state);t.objectStore('drafts').put(draft);t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};});
 });await page.reload();await expect(page.locator('.game-layout')).toBeVisible();const before=await rosterGame(page);await openProfile(page);const dialog=page.getByRole('dialog',{name:'人物档案',exact:true});await expect(dialog.locator('.profile-details dt')).toHaveCount(16);await expect(dialog).toContainText('开局时间待确认');await expect(dialog).toContainText('2026/10/18 08:01（未正式结算）');await expect(dialog).not.toContainText('0001/');
 if(info.project.name==='desktop')await page.screenshot({animations:'disabled',path:'docs/desktop-archive-step2/screenshots/profile-candidate.png'});expect(await rosterGame(page)).toEqual(before);verify();
});

 test('正式空组织名录保持空态，浏览不创建组织或请求模型',async({page},info)=>{
 await seedRoster(page);const verify=await readonly(page),before=await rosterGame(page),dialog=await org(page);
 await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(0);await expect(dialog).toContainText('暂无符合条件的组织');await expect(dialog).toContainText('选择组织，阅读势力档案');
 if(info.project.name==='desktop')await expect(dialog).toHaveAttribute('aria-modal','false');expect(await rosterGame(page)).toEqual(before);verify();
});
