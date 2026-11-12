import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorldArchive } from './helpers/gameLayout';
async function seed(page:Page,extra=24) {
  await page.goto('/');
  await page.evaluate(async extra=>{
    const fixture='/src/tests/fixtures/eventArchive.ts',schema='/src/domain/state.ts',storage='/src/services/storage/saveRepository.ts',settingsPath='/src/ui/settings/model.ts';
    const {eventArchiveState}=await import(fixture),{GameStateSchema}=await import(schema),{SaveRepository}=await import(storage),{defaultSettings,settingsKey}=await import(settingsPath);
    const settings=defaultSettings();for(const s of Object.values(settings.memory.summaries) as {automatic:boolean}[])s.automatic=false;localStorage.setItem(settingsKey,JSON.stringify(settings));
    const source=eventArchiveState(extra),state=GameStateSchema.parse({...source,revision:1,turnNumber:1,journal:[{turnId:'archive-opening',revision:1,relatedActorRefs:[],story:{turnKind:'opening',narrative:'【旁白】临江的街巷在雨后渐渐安静，修复工程与各方的生活仍在继续。',summary:'修复工作与生活继续。',variableGuide:[]}}]});
    const repo=await SaveRepository.open();repo.close();
    await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('heijinwangchao');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(state);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  },extra);
  await page.goto('/#game/save-a');await expect(page.locator('.game-layout')).toBeVisible();
}
const stored=(page:Page)=>page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});
async function open(page:Page) {await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:/世界事件/}).click();return page.getByRole('dialog',{name:'世界事件',exact:true});}
async function noOverflow(page:Page) {expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.world-events-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
test('事件档案：活动目录、并行成果、退役资料、搜索分页与兼容入口均只读',async({page},info)=>{
  let requests=0;await page.route('https://**',async r=>{requests++;await r.abort();});await seed(page);const before=await stored(page),panel=await open(page);
  const directory=panel.getByRole('region',{name:'活动主事件目录'});await expect(directory.getByRole('button',{name:/查看主事件/})).toHaveCount(20);
  await expect(directory.locator('.event-directory-rows')).not.toContainText('已取消的搬迁计划');await expect(directory.locator('.event-directory-rows')).not.toContainText('馆藏计划');
  await directory.getByRole('button',{name:'下一页主事件'}).click();await expect(directory).toContainText('2/2');
  await directory.getByLabel('搜索活动主事件').fill('临江旧城');await directory.getByRole('button',{name:'查看主事件：临江旧城档案修复工程'}).click();
  const file=panel.getByRole('article',{name:'事件档案'});await expect(file).toContainText('预计整体结束');await expect(file).toContainText('保存原始资料');await expect(file).toContainText('临江公共事务中心');
  await expect(panel.getByRole('region',{name:'正在进行的阶段',exact:true}).getByRole('button')).toHaveCount(3);
  for(const word of ['成功','失败','变化','取消'])await expect(panel.getByRole('region',{name:'已结束的阶段经过',exact:true})).toContainText(word);
  await expect(panel.getByRole('button',{name:/未来纸本复查/})).not.toBeVisible();
  await panel.getByRole('button',{name:/现场核对提前结束/}).click();await expect(panel.getByRole('article',{name:'阶段档案'})).toContainText('2027/01/02');await expect(panel.getByRole('article',{name:'阶段档案'})).toContainText('2027/01/03');
  await panel.getByRole('button',{name:'返回主事件',exact:true}).click();await expect(panel.getByRole('button',{name:/现场核对提前结束/})).toBeFocused();
  await panel.getByRole('button',{name:/已退役的纸本修复阶段/}).click();const stage=panel.getByRole('article',{name:'阶段档案'});await expect(stage).toContainText('陆澄');await expect(stage).toContainText('青禾修复学社');
  await expect(stage).toContainText('已核实事实');await expect(stage).toContainText('转述（未核实）');await expect(stage).toContainText('推测');await expect(stage.getByRole('heading',{name:'背景',exact:true})).toHaveCount(0);
  await stage.getByText('阅读完整阶段经过',{exact:true}).click();await expect(stage).toContainText('完整阶段经过终点');await page.screenshot({path:info.outputPath('retired-stage.png')});
  await panel.getByRole('button',{name:'返回主事件',exact:true}).click();
  if(info.project.name==='mobile')await panel.getByRole('button',{name:'返回事件列表',exact:true}).click();
  await panel.getByText('其他事件家族资料',{exact:false}).first().click();await panel.getByRole('button',{name:/退役家族的后续资料核查/}).click();await expect(panel.getByRole('button',{name:/退役家族仍活动的核查/})).toBeVisible();
  await panel.getByRole('button',{name:/退役家族仍活动的核查/}).click();await expect(panel.getByRole('article',{name:'阶段档案'})).toContainText('进行中');
  await panel.getByRole('button',{name:'返回主事件',exact:true}).click();
  if(info.project.name==='mobile')await panel.getByRole('button',{name:'返回事件列表',exact:true}).click();
  await panel.getByRole('button',{name:/已结案但仍有跟进阶段的工程/}).click();await expect(panel.getByRole('article',{name:'事件档案'})).toContainText('已结案');await expect(panel.getByRole('button',{name:/结案家族的独立跟进/})).toBeVisible();
  await expect(panel.getByRole('region',{name:'相关历史'})).toContainText('临江档案修复正式结案');await panel.getByRole('button',{name:'前往历史时间轴'}).click();
  const history=page.getByRole('dialog',{name:'历史时间轴',exact:true});await expect(history.getByRole('button',{name:/临江档案修复正式结案/})).toBeVisible();await history.getByRole('button',{name:'关闭资料界面'}).click();
  const reopened=await open(page);await reopened.getByText('旧版独立事件资料',{exact:false}).first().click();await reopened.getByRole('button',{name:/旧版独立会面记录/}).click();await expect(reopened.getByRole('article',{name:'事件档案'})).toContainText('完成预约事项');
  if(info.project.name==='mobile')await reopened.getByRole('button',{name:'返回事件列表',exact:true}).click();
  await reopened.getByText('任务进展',{exact:true}).click();await expect(reopened).toContainText('后续材料核对任务');await noOverflow(page);await page.keyboard.press('Escape');
  expect(await stored(page)).toEqual(before);expect(requests).toBe(0);await page.reload();expect((await stored(page)).state).toEqual(before.state);
});

test('双端事件档案尺寸与真实截图，关闭后恢复资料入口焦点',async({page},info)=>{
  test.setTimeout(90000);let requests=0;await page.route('https://**',async r=>{requests++;await r.abort();});await seed(page,0);const before=await stored(page);
  const sizes=info.project.name==='desktop'?[[1650,927],[1440,900],[1280,800],[1024,520]]:[[390,844],[375,812],[320,640],[844,390],[390,500]];
  for(const [width,height] of sizes){await page.setViewportSize({width,height});const panel=await open(page);await noOverflow(page);
    await page.screenshot({path:info.outputPath(`events-list-${width}x${height}.png`)});
    await panel.getByRole('button',{name:'查看主事件：临江旧城档案修复工程'}).click();
    if(width>900){const left=(await panel.locator('.event-directory').boundingBox())!,right=(await panel.locator('.event-detail-pane').boundingBox())!;expect(left.x+left.width).toBeLessThanOrEqual(right.x);}
    else{await expect(panel.getByRole('region',{name:'活动主事件目录'})).not.toBeVisible();}
    await page.screenshot({path:info.outputPath(`events-main-${width}x${height}.png`)});
    await panel.getByRole('button',{name:/已退役的纸本修复阶段/}).click();await noOverflow(page);await page.screenshot({path:info.outputPath(`events-stage-${width}x${height}.png`)});
    await panel.getByRole('button',{name:'返回主事件',exact:true}).click();await expect(panel.getByRole('button',{name:/已退役的纸本修复阶段/})).toBeFocused();
    if(width<=900){await panel.getByRole('button',{name:'返回事件列表',exact:true}).click();await expect(panel.getByRole('button',{name:'查看主事件：临江旧城档案修复工程'})).toBeFocused();}
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'世界事件',exact:true})).toHaveCount(0);await expect(page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:/世界事件/})).toBeFocused();
  }
  expect(await stored(page)).toEqual(before);expect(requests).toBe(0);
});

test('正式资料更新使选中主事件失效时安全回到有效视图',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/ui/Dialog.tsx','/src/ui/panels/WorldEventsPanel.tsx','/src/ui/panels/playerView.ts','/src/tests/fixtures/eventArchive.ts'];
    const [ReactModule,ClientModule,{Dialog},{WorldEventsPanel},{playerView},{eventArchiveState}]=await Promise.all(paths.map(p=>import(p)));
    const React=ReactModule.default??ReactModule,createRoot=ClientModule.createRoot??ClientModule.default.createRoot;
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host),state=eventArchiveState();
    const render=()=>root.render(React.createElement(Dialog,{title:'更新测试档案',className:'world-events-dialog',onClose:()=>root.unmount()},React.createElement(WorldEventsPanel,{view:playerView(state)})));
    Object.assign(window,{refreshArchiveFixture:()=>{state.events['main-stage']={...state.events['main-stage'],status:'resolved',resolvedAt:'2027-03-01T00:00:00+08:00',resolutionText:'总体已结案',outcome:'success'};render();}});render();
  });
  const panel=page.getByRole('dialog',{name:'更新测试档案',exact:true});await panel.getByRole('button',{name:'查看主事件：临江旧城档案修复工程'}).click();
  await page.evaluate(()=>Reflect.get(window,'refreshArchiveFixture')());
  await expect(panel.getByRole('button',{name:'查看主事件：临江旧城档案修复工程'})).toHaveCount(0);await expect(panel.getByRole('region',{name:'活动主事件目录'})).toBeVisible();
  await expect(panel.getByRole('button',{name:'查看主事件：桥南资料移交协作'})).toBeVisible();await noOverflow(page);await page.keyboard.press('Escape');
});
