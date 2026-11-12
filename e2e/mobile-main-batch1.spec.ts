import {test,expect} from './helpers/test';
import type {Page} from '@playwright/test';
import {seedNightSeal,nightSealStored} from './helpers/nightSeal';

const shots='docs/mobile-main-batch1/screenshots';
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort();});
});
async function enter(page:Page,long=false){await seedNightSeal(page,long);await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);}
async function workflow(page:Page){await page.getByRole('button',{name:'三阶段工作流详情',exact:true}).click();return page.getByRole('dialog',{name:'三阶段工作流',exact:true});}

for(const [width,height] of [[375,667],[390,844],[430,932],[750,800],[900,800]])test(`手机骨架 ${width}×${height}：真实数据、建议、发送和抽屉`,async({page})=>{
 await page.setViewportSize({width,height});await enter(page);const before=await nightSealStored(page);
 await expect(page.locator('.mobile-city-pill')).toBeVisible();await expect(page.locator('.player-status')).toHaveCount(0);await expect(page.locator('.atmo')).toHaveAttribute('data-city','cq');await expect(page.locator('.mobile-game-nav button')).toHaveCount(4);
 const input=page.getByLabel('你的行动',{exact:true}),send=page.getByRole('button',{name:'发送',exact:true});await expect(input).toHaveCSS('font-size','16px');await expect(send).toBeDisabled();await expect(send).toBeInViewport({ratio:1});
 await page.getByTestId('story-reader').evaluate(e=>{e.scrollTop=0;});await page.screenshot({path:`${shots}/react-main-${width}.png`});
 const option=page.locator('.rail-cards .opt').first();await option.scrollIntoViewIfNeeded();await option.click();await expect(option.locator('.go')).toBeVisible();await expect(input).toHaveValue('回复编辑，确认明天的会面');await expect(option).toHaveAttribute('aria-pressed','true');await expect(send).toBeEnabled();await expect(input).toBeFocused();
 await input.fill('长输入测试。'.repeat(100));expect((await input.boundingBox())!.height).toBeLessThanOrEqual(120);await expect(send).toBeInViewport({ratio:1});await input.fill('');
 const box=await input.boundingBox(),sheet=await workflow(page);await expect(sheet).toBeFocused();await expect(sheet).toHaveAttribute('aria-modal','true');await expect(sheet.locator('.workflow-stages>li')).toHaveCount(3);await page.screenshot({path:`${shots}/react-workflow-${width}.png`});await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(page.getByRole('button',{name:'三阶段工作流详情'})).toBeFocused();expect(await input.boundingBox()).toEqual(box);
 await page.locator('.mobile-city-pill').click();const status=page.getByRole('dialog',{name:'此时此地',exact:true});await expect(status.locator('.wear dd')).toHaveCount(7);await expect(status).toContainText('身体');await expect(status).toContainText('情绪');await page.screenshot({path:`${shots}/react-status-${width}.png`});await page.keyboard.press('Escape');await expect(page.locator('.mobile-city-pill')).toBeFocused();
 await page.getByRole('button',{name:'世界资料',exact:true}).click();const world=page.getByRole('dialog',{name:'世界资料',exact:true});await expect(world.getByRole('navigation').getByRole('button')).toHaveCount(7);await page.screenshot({path:`${shots}/react-world-${width}.png`});await world.getByRole('button',{name:'NPC',exact:true}).click();await expect(world).toHaveCount(0);await expect(page.getByRole('dialog',{name:'NPC',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('[data-mobile-tab=world]')).toBeFocused();
 await page.getByRole('button',{name:'打开游戏菜单'}).click();const menu=page.getByRole('dialog',{name:'游戏菜单',exact:true});await expect(menu.getByRole('button')).toHaveCount(4);await page.screenshot({path:`${shots}/react-menu-${width}.png`});await menu.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('button',{name:'打开游戏菜单'})).toBeFocused();
 expect(await nightSealStored(page)).toEqual(before);await noOverflow(page);
});

async function seedWorkflow(page:Page,mode:'opening'|'ready'|'error',long=false){
 await page.goto('/');await page.evaluate(async ({mode,long})=>{
  const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
  const [{SaveRepository},{worldState},{completeDraft},{createTurnDraft,TurnDraftSchema,startStageAttempt},{defaultSettings,settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault}]=await Promise.all(paths.map(p=>import(p)));
  const repo=await SaveRepository.open();let state=worldState();if(mode==='opening'){const creationPath='/src/ui/creation/model.ts';const {newCreation,buildCreationState}=await import(creationPath);const form=newCreation();form.saveId='save-a';form.person={name:'林遥',age:'30',gender:'男性',appearance:'',personality:''};form.customProfession='记者';form.city='chongqing';state=buildCreationState(form,defaultSettings());}state.openingCityId='chongqing';state.title='手机测试 · 重庆';state.protagonist.name='林遥';await repo.create(state);
  const settings=defaultSettings();settings.prompts.minNarrativeChars=5;localStorage.setItem(settingsKey,JSON.stringify(settings));
  const config=defaultAiConfig(),channel=newChannel();channel.baseUrl='https://mobile.mock.invalid/v1';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock'};saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'fictional-test-only');
  if(mode==='opening')await repo.saveDraft(createTurnDraft('save-a',0,'opening','opening',''),null);
  else{let draft=await completeDraft(repo,{narrative:(long?'【旁白】沿着旧街前行，路边店铺的招牌逐渐清晰。记录者认真核对每一段完整的信息。\n'.repeat(90):'【旁白】街边店铺刚刚开门。\n')+'【林遥】我想先看看这里的情况。\n【友人】我们一起走走吧。',actionOptions:['先观察街道','询问熟悉的朋友','打开手里的笔记']});if(mode==='error'){draft=await repo.saveDraft(startStageAttempt(draft,['world'],{useVariableStage:true,useWorldStage:true}),draft.draftRevision);await repo.saveDraft(TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1,world:undefined,stageStatus:{...draft.stageStatus,world:'failed'},failures:[{stage:'world',attempt:2,storyRevision:draft.storyRevision,errorCode:'world_schema',retryable:true}]}),draft.draftRevision);}}
  repo.close();
 },{mode,long});await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
}
for(const mode of ['opening','ready','error'] as const)test(`工作流 ${mode}：保留全部操作、候选与正式状态`,async({page})=>{
 await seedWorkflow(page,mode);const before=await nightSealStored(page);
 if(mode==='opening'){await expect(page.locator('.mobile-city-pill')).toContainText('--:--');await page.locator('.mobile-city-pill').click();await expect(page.getByRole('dialog',{name:'此时此地'})).toContainText('开局时间待确认');await expect(page.locator('.st-place')).not.toContainText('早晨');await page.keyboard.press('Escape');await page.getByRole('button',{name:'回合操作',exact:true}).click();await expect(page.getByRole('button',{name:'生成开局正文',exact:true})).toBeVisible();await page.keyboard.press('Escape');}
 const sheet=await workflow(page);await expect(sheet.locator('.workflow-stages>li')).toHaveCount(3);await expect(sheet.getByRole('checkbox',{name:'变量管理',exact:true})).toBeChecked();await expect(sheet.getByRole('checkbox',{name:'动态世界',exact:true})).toBeChecked();
 if(mode==='ready'){
  await expect(sheet.getByRole('button',{name:'完成本回合结算',exact:true})).toBeEnabled();
  for(const label of ['变量','世界']){const trigger=sheet.getByRole('button',{name:`查看${label}候选（未结算）`,exact:true});await trigger.click();const candidate=page.getByRole('dialog',{name:`${label}候选 · 未正式结算`,exact:true});await expect(candidate).toBeVisible();await candidate.getByRole('button',{name:`主动查看完整${label}候选`,exact:true}).click();await expect(candidate.getByLabel(`完整${label}候选`,{exact:true})).not.toBeEmpty();await page.keyboard.press('Escape');await expect(sheet).toBeVisible();await expect(trigger).toBeFocused();}
 }
 if(mode==='error'){await expect(sheet.getByRole('button',{name:'继续未完成阶段',exact:true})).toBeEnabled();await sheet.locator('.workflow-diagnostics>summary').click();await expect(sheet.locator('.workflow-diagnostics')).toContainText('world_schema');}
 await page.screenshot({path:`${shots}/react-${mode}-390.png`});await expect(page.getByRole('button',{name:'重新 Roll',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');expect(await nightSealStored(page)).toEqual(before);await noOverflow(page);
});

test('抽屉：Tab 环、Esc、遮罩、短拉回弹、长拉关闭和取消手势',async({page})=>{
 await enter(page);const before=await nightSealStored(page);const trigger=page.locator('.mobile-city-pill'),sheet=page.getByRole('dialog',{name:'此时此地',exact:true});
 await trigger.click();await expect(sheet).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(sheet.getByRole('button',{name:'经济与资产',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(sheet.getByRole('button',{name:'关闭资料界面',exact:true})).toBeFocused();
 // Test the real header hit target; cancellation is never an implicit close.
 async function drag(distance:number,cancel=false){const box=(await sheet.locator('.mobile-sheet-grab').boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+distance,{steps:5});if(cancel)await sheet.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();}
 await drag(55);await expect(sheet).toBeVisible();await drag(120,true);await expect(sheet).toBeVisible();await drag(125);await expect(sheet).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();const top=(await sheet.boundingBox())!.y;expect(top).toBeGreaterThan(0);await page.mouse.click(4,Math.max(1,top/2));await expect(sheet).toHaveCount(0);await expect(trigger).toBeFocused();expect(await nightSealStored(page)).toEqual(before);
});

test('长正文、完整状态与金额：内部滚动、城市收窄、输入法可视区',async({page})=>{
 await enter(page,true);const before=await nightSealStored(page),reader=page.getByTestId('story-reader');
 await reader.evaluate(e=>{e.scrollTop=0;});await expect(page.locator('.mobile-city-top')).not.toHaveClass(/mini/);await reader.evaluate(e=>{e.scrollTop=90;});await expect(page.locator('.mobile-city-top')).toHaveClass(/mini/);await reader.evaluate(e=>{e.scrollTop=0;});await expect(page.locator('.mobile-city-top')).not.toHaveClass(/mini/);
 await page.locator('.mobile-city-pill').click();const sheet=page.getByRole('dialog',{name:'此时此地'});await expect(sheet.locator('.conds')).toContainText('身体状态保持稳定，需要适时休息。'.repeat(50));await expect(sheet.locator('.money')).toContainText('90,071,992,547,409.91 元');
 await expect(sheet.locator('.conds>div').first()).toHaveCSS('overflow','visible');await sheet.locator('.modal-body').evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(sheet.getByRole('button',{name:'经济与资产',exact:true})).toBeInViewport({ratio:1});await page.screenshot({path:`${shots}/react-status-long-390.png`});await page.keyboard.press('Escape');
 // Exercise the existing visualViewport-driven CSS contract without changing game time or data.
 await page.evaluate(()=>{Object.defineProperty(window.visualViewport!,'height',{configurable:true,value:470});window.visualViewport!.dispatchEvent(new Event('resize'));});
 const send=page.getByRole('button',{name:'发送',exact:true});expect((await send.boundingBox())!.y+(await send.boundingBox())!.height).toBeLessThan(470);await page.getByLabel('你的行动',{exact:true}).fill('输入法长文本'.repeat(50));await page.screenshot({path:`${shots}/react-keyboard-390.png`});await noOverflow(page);expect(await nightSealStored(page)).toEqual(before);
});

test('生成中与失败恢复：关闭抽屉不取消，显式取消，不额外请求',async({page})=>{
 await seedWorkflow(page,'opening');let calls=0,release!:()=>void;const hold=new Promise<void>(r=>{release=r;});await page.route('https://mobile.mock.invalid/**',async route=>{calls++;await hold;await route.fulfill({status:401,body:'mock-only'}).catch(()=>undefined);});
 let sheet=await workflow(page);await sheet.getByRole('button',{name:'自动生成开局',exact:true}).click();await expect.poll(()=>calls).toBe(1);await expect(page.locator('.workflow')).toHaveAttribute('data-state','busy');await page.screenshot({path:`${shots}/react-busy-390.png`});await page.keyboard.press('Escape');expect(calls).toBe(1);await expect(page.locator('.workflow')).toHaveAttribute('data-state','busy');
 sheet=await workflow(page);await sheet.getByRole('button',{name:'取消自动执行',exact:true}).click();release();await expect(sheet.getByRole('button',{name:'继续未完成阶段',exact:true})).toBeEnabled();expect((await nightSealStored(page)).state.turnNumber).toBe(0);expect(calls).toBe(1);
 await sheet.getByRole('button',{name:'继续未完成阶段',exact:true}).click();await expect.poll(()=>calls).toBe(2);await expect(sheet.getByRole('alert').first()).toBeVisible();await expect(sheet.getByRole('button',{name:'继续未完成阶段',exact:true})).toBeEnabled();await page.screenshot({path:`${shots}/react-failure-390.png`});
});

test('正式结算与发送复用原回调，开局不可撤回',async({page})=>{
 await seedWorkflow(page,'ready');let calls=0;await page.route('https://mobile.mock.invalid/**',async r=>{calls++;await r.fulfill({status:401,body:'mock-only'});});
 const sheet=await workflow(page);await sheet.getByRole('button',{name:'完成本回合结算',exact:true}).click();await expect.poll(async()=>(await nightSealStored(page)).state.turnNumber).toBe(1);expect(calls).toBe(0);await page.keyboard.press('Escape');
 const input=page.getByLabel('你的行动',{exact:true});await input.fill('沿着街道继续观察');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>calls).toBe(1);await expect.poll(async()=>(await nightSealStored(page)).draft?.userInput).toBe('沿着街道继续观察');await expect(page.locator('.workflow')).toHaveAttribute('data-state','error');
 await page.getByRole('button',{name:'回合操作',exact:true}).click();await expect(page.getByRole('button',{name:'撤回',exact:true})).toBeDisabled();expect((await nightSealStored(page)).state.turnNumber).toBe(1);
});

for(const width of [901,1440])test(`桌面 ${width}px：与未修改 main 逐像素对照`,async({browser},info)=>{
 const pages:Page[]=[];
 for(const port of [5232,5231]){
  const context=await browser.newContext({baseURL:`http://127.0.0.1:${port}`,viewport:{width,height:900},reducedMotion:'reduce',isMobile:false});await context.addInitScript(()=>{const now=new Date();localStorage.setItem('heijin.notices.hidden-on.v1',[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'));});const page=await context.newPage();await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await enter(page);pages.push(page);
 }
 for(const scene of ['main','workflow','npc']as const){
  const buffers=[];
  for(const [index,page]of pages.entries()){
   if(scene==='main')await page.getByTestId('story-reader').evaluate(e=>{e.scrollTop=0;});
   if(scene==='workflow')await page.locator('.workflow-toggle').click();
   if(scene==='npc'){await page.keyboard.press('Escape');await page.locator('[data-archive-panel=NPC]').click();}
   await page.evaluate(()=>document.fonts.ready);buffers.push(await page.screenshot({path:`${shots}/${index?'react':'main-baseline'}-desktop-${scene}-${width}.png`}));await noOverflow(page);
  }
  expect(buffers[1].equals(buffers[0]),`desktop ${scene} screenshot must remain identical`).toBe(true);
 }
 await info.attach('unchanged-desktop',{body:`${width}px main/workflow/NPC: exact PNG match`,contentType:'text/plain'});for(const page of pages)await page.context().close();
});


test('撤回保留原确认、回填与恢复点；回填后仍可发送',async({page})=>{
 await enter(page);const before=await nightSealStored(page);const undo=page.getByRole('button',{name:/^撤回（/});await expect(undo).toBeEnabled();await undo.click();const confirm=page.getByRole('dialog',{name:'撤回上一回合',exact:true});await expect(confirm).toContainText('此操作不调用 AI');await page.keyboard.press('Escape');await expect(undo).toBeFocused();expect(await nightSealStored(page)).toEqual(before);
 await undo.click();await confirm.getByRole('button',{name:'确认撤回',exact:true}).click();await expect.poll(async()=>(await nightSealStored(page)).state.turnNumber).toBe(1);await expect(page.getByLabel('你的行动',{exact:true})).toHaveValue('沿江步道走一走');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
});

test('真实触屏：长内容原生滚动不误关闭，顶部下拉才关闭；reduced motion',async({page})=>{
 await enter(page,true);const before=await nightSealStored(page);const animations=await page.locator('.atmo *').evaluateAll(es=>es.flatMap(e=>[getComputedStyle(e).animationName,getComputedStyle(e,'::before').animationName,getComputedStyle(e,'::after').animationName]));expect(animations.every(a=>a==='none')).toBe(true);
 await page.locator('.mobile-city-pill').click();const sheet=page.getByRole('dialog',{name:'此时此地'}),body=sheet.locator('.modal-body');const cdp=await page.context().newCDPSession(page);
 async function swipe(y:number,dy:number){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y}]});for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200,y:y+dy*i/6}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 const box=(await body.boundingBox())!;await swipe(box.y+220,-170);await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await expect(sheet).toBeVisible();await page.keyboard.press('Escape');await page.locator('.mobile-city-pill').click();await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBe(0);await swipe(box.y+70,140);await expect(sheet).toHaveCount(0);expect(await nightSealStored(page)).toEqual(before);await cdp.detach();
});


test('沉浸长正文与台词：全文可读，滚动位置保留，状态入口交接',async({page})=>{
 await seedWorkflow(page,'ready',true);const before=await nightSealStored(page),reader=page.getByTestId('story-reader');
 await expect(reader.locator('.story-narration')).toHaveCount(90);await expect(reader.locator('.story-speaker')).toHaveText(['林遥','友人']);await reader.evaluate(e=>{e.scrollTop=1200;});await page.screenshot({path:`${shots}/react-long-reader-390.png`});
 await page.locator('.mobile-city-pill').click();const status=page.getByRole('dialog',{name:'此时此地'});await status.getByRole('button',{name:'人物档案',exact:true}).click();const profile=page.getByRole('dialog',{name:'人物档案',exact:true});await expect(profile.locator('.profile-details>.detail')).toHaveCount(16);await page.keyboard.press('Escape');await expect(page.locator('[data-mobile-tab=hero]')).toBeFocused();expect(await reader.evaluate(e=>e.scrollTop)).toBe(1200);
 await reader.evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(reader.locator('.story-speaker').last()).toBeInViewport();await page.screenshot({path:`${shots}/react-dialogue-390.png`});expect(await nightSealStored(page)).toEqual(before);await noOverflow(page);
});

test('菜单与设置交接：保留既有配置入口、Esc 与回焦，浏览不保存',async({page})=>{
 await enter(page);const before=await nightSealStored(page),config=await page.evaluate(()=>({...localStorage}));
 const menuToggle=page.getByRole('button',{name:'打开游戏菜单',exact:true});await menuToggle.click();await page.getByRole('dialog',{name:'游戏菜单'}).getByRole('button',{name:'设置',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'设置',exact:true});await expect(settings).toBeVisible();for(const name of ['AI 连接','提示词','记忆','运行','提示词管理'])await expect(settings.getByRole('button',{name,exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(menuToggle).toBeFocused();expect(await nightSealStored(page)).toEqual(before);expect(await page.evaluate(()=>({...localStorage}))).toEqual(config);
});

test('正常动效：抽屉短拉回弹不重复入场动画，长拉关闭',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await enter(page);await page.locator('.mobile-city-pill').click();const sheet=page.getByRole('dialog',{name:'此时此地'});
 await expect.poll(()=>sheet.evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 const box=(await sheet.locator('.mobile-sheet-grab').boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+50,{steps:5});await page.mouse.up();await expect(sheet).toBeVisible();await expect(sheet).toHaveClass(/sheet-interacted/);await expect(sheet).toHaveCSS('animation-name','none');await expect.poll(()=>sheet.evaluate(e=>getComputedStyle(e).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+130,{steps:5});await page.mouse.up();await expect(sheet).toHaveCount(0);await expect(page.locator('.mobile-city-pill')).toBeFocused();
});
