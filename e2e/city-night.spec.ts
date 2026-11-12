import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import { seedNightSeal, nightSealStored } from './helpers/nightSeal';
import type { Page } from '@playwright/test';

const directory = 'docs/main-screen-city-night/screenshots';
async function enter(page: Page) {
  await seedNightSeal(page);
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function changeScene(page: Page, values: { city?: string | null; place?: string; time?: string; weather?: string; long?: boolean; legacy?: boolean; title?: string }) {
  await page.evaluate(async values => {
    const op = indexedDB.open('heijinwangchao');
    const db = await new Promise<IDBDatabase>((resolve,reject) => { op.onsuccess=()=>resolve(op.result);op.onerror=()=>reject(op.error); });
    await new Promise<void>((resolve,reject) => {
      const tx=db.transaction('saves','readwrite'),store=tx.objectStore('saves'),get=store.get('save-a');
      get.onsuccess=()=>{
        const state=get.result;
        if(values.city!==undefined)state.openingCityId=values.city;
        if(values.legacy)delete state.openingCityId;
        if(values.title)state.title=values.title;
        if(values.place){state.locations.shanghai={id:'shanghai',name:'上海',parentId:'china'};state.locations.china={id:'china',name:'中国'};state.locations.shop={id:'shop',name:'北京东路通宵便利店',parentId:'shanghai'};state.protagonist.locationId='shop';Object.values(state.npc).forEach((npc: unknown)=>{(npc as {onScene:boolean}).onScene=false;});}
        if(values.time)state.worldClock=values.time;
        if(values.weather)state.weatherText=values.weather;
        if(values.long){state.environmentText='店里只剩两桌客人，咖啡机的蒸汽声盖过了雨声。'.repeat(20);state.weatherText='阵雨、气温九摄氏度、江面起雾。'.repeat(20);}
        store.put(state);
      };
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });db.close();
  },values);
  await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
}

test('UI-2：真实 React 双端截图、五视口对齐与 HTML 对照', async ({page},info)=>{
  test.skip(info.project.name!=='desktop'); test.setTimeout(90000);
  await mkdir(directory,{recursive:true}); await page.emulateMedia({reducedMotion:'reduce'});
  const external: string[]=[]; await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  await enter(page);
  const measures=[];
  for(const [width,height] of [[1920,1080],[1440,900],[1280,800],[1100,800],[390,844]]){
    await page.setViewportSize({width,height});
    await page.getByTestId('story-reader').evaluate(e=>{e.scrollTop=0;});
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport({ratio:1});
    await expect(page.getByLabel('你的行动',{exact:true})).toBeInViewport({ratio:1});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
    if(width>900){
      const reader=(await page.locator('.reader-heading').boundingBox())!, composer=(await page.locator('.composer-action-row').boundingBox())!;
      expect(Math.abs(reader.x-composer.x)).toBeLessThan(2);expect(Math.abs(reader.width-composer.width)).toBeLessThan(2);
      expect(reader.width).toBeLessThanOrEqual(1120);
      await expect(page.locator('.bar')).toBeVisible();await expect(page.locator('.status-wear dd')).toHaveCount(7);
      measures.push({width,height,reader,composer});
    } else {
      await expect(page.locator('.bar')).toHaveCount(0);await expect(page.locator('.atmo')).toHaveCount(0);
      await expect(page.getByRole('navigation',{name:'底部导航'})).toBeVisible();
    }
    await page.screenshot({path:`${directory}/react-${width}x${height}.png`});
    await page.getByTestId('story-reader').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.screenshot({path:`${directory}/react-actions-${width}x${height}.png`});
  }
  const reference=await page.context().newPage();
  for(const [width,height] of [[1920,1080],[1440,900],[1280,800],[1100,800]]){
    await reference.setViewportSize({width,height});await reference.emulateMedia({reducedMotion:'reduce'});
    await reference.goto('/docs/main-screen-city-night/heijin-main.html#city=cq&time=day&wx=rain');
    await reference.locator('#reader').evaluate(e=>{e.scrollTop=0;});
    await reference.screenshot({path:`${directory}/html-${width}x${height}.png`});
  }
  await reference.close();expect(external).toEqual([]);
  await writeFile('docs/main-screen-city-night/layout-measurements.json',JSON.stringify(measures,null,2)+'\n');
});

test('UI-2：固定身份、跨城、历史副标题、日期与天气独立更新',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await enter(page);await page.emulateMedia({reducedMotion:'reduce'});
  const before=await nightSealStored(page), skyline=await page.locator('.atmo .skyline').innerHTML();
  const history=await page.locator('.c-sub').allTextContents();
  await changeScene(page,{place:'shanghai',time:'2026-11-11T00:05:00+08:00',weather:'雪'});
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','cq');
  expect(await page.locator('.atmo .skyline').innerHTML()).toBe(skyline);
  await expect(page.locator('.where')).toContainText('上海');await expect(page.locator('.where')).toContainText('北京东路');
  await expect(page.locator('.clock')).toContainText('00:05');await expect(page.locator('.clock')).toContainText('星期三');
  await expect(page.locator('.atmo')).toHaveAttribute('data-wx','snow');
  expect(await page.locator('.c-sub').allTextContents()).toEqual(history);
  const after=await nightSealStored(page);expect(after.state.journal).toEqual(before.state.journal);
  await page.screenshot({path:`${directory}/react-cq-in-shanghai.png`});
  await page.reload();await expect(page.locator('.city-night')).toHaveAttribute('data-city','cq');
});

test('UI-2：旧档身份一次恢复与未知身份的持久降级',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await enter(page);
  await changeScene(page,{legacy:true,title:'人物 · 上海'});
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','sh');
  expect((await nightSealStored(page)).state.openingCityId).toBe('shanghai');
  await changeScene(page,{title:'重命名 · 广州',place:'shanghai'});
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','sh');
  await changeScene(page,{legacy:true,title:'未知起点'});
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','other');
  expect((await nightSealStored(page)).state.openingCityId).toBeNull();
  await expect(page.locator('.atmo .skyline svg')).toHaveCount(0);
  await expect(page.locator('.plain-chapter')).toHaveCount(2);
  await changeScene(page,{title:'新的标题 · 重庆'});
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','other');
});

test('UI-2：四城五时段五天气、长文本及 reduced-motion',async({page},info)=>{
  test.skip(info.project.name!=='desktop');test.setTimeout(300000);await enter(page);await page.emulateMedia({reducedMotion:'reduce'});
  for(const [city,key] of [['chongqing','cq'],['shanghai','sh'],['harbin','hrb'],['guangzhou','gz']]){
    for(const [hour,time] of [[6,'dawn'],[14,'day'],[18,'dusk'],[21,'night'],[23,'late']] as const){
      for(const [weather,wx] of [['晴','clear'],['阴','cloud'],['雨夹雪','rain'],['雪','snow'],['雾霾','fog']]){
        await changeScene(page,{city,time:`2026-11-12T${String(hour).padStart(2,'0')}:05:00+08:00`,weather});
        await expect(page.locator('.atmo')).toHaveAttribute('data-city',key);await expect(page.locator('.atmo')).toHaveAttribute('data-time',time);await expect(page.locator('.atmo')).toHaveAttribute('data-wx',wx);
        expect(await page.locator('.atmo').evaluate(e=>getComputedStyle(e).pointerEvents)).toBe('none');
        const layer=wx==='clear'?undefined:page.locator(`.wx-${wx}`);
        if(layer)await expect(layer).toHaveCSS('opacity','1');
        else await expect(page.locator('.wx-rain')).toHaveCSS('opacity','0');
      }
    }
    await page.screenshot({path:`${directory}/react-city-${key}.png`});
  }
  await changeScene(page,{long:true});
  for(const width of [901,1100,1280,1440,1920]){
    await page.setViewportSize({width,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('.chip').first()).toHaveAttribute('title',/阵雨/);
  }
  const animations=await page.locator('.atmo *').evaluateAll(elements=>elements.flatMap(e=>[getComputedStyle(e).animationName,getComputedStyle(e,'::before').animationName,getComputedStyle(e,'::after').animationName]));
  expect(animations.every(a=>a==='none')).toBe(true);
  await page.screenshot({path:`${directory}/react-long-text.png`});
});

test('UI-2：行动快捷键遵守输入、IME、弹窗与发送条件',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await enter(page);
  const input=page.getByLabel('你的行动',{exact:true});
  await page.getByTestId('story-reader').focus();await page.keyboard.press('1');
  await expect(input).toHaveValue('回复编辑，确认明天的会面');
  await input.fill('输入中');await input.press('2');await expect(input).toHaveValue('输入中2');
  await input.fill('');await input.press('Control+Enter');
  expect((await nightSealStored(page)).state.turnNumber).toBe(2);
  await page.getByRole('button',{name:'人物档案',exact:true}).click();
  await page.keyboard.press('2');await expect(input).toHaveValue('');await page.keyboard.press('Escape');
  await page.getByTestId('story-reader').focus();
  await page.getByTestId('story-reader').dispatchEvent('keydown',{key:'1',isComposing:true});await expect(input).toHaveValue('');
});

test('UI-2：待定开局不显示设备日期，旧回合缺 scene 时保持主题',async({page},info)=>{
  test.skip(info.project.name!=='desktop');
  await page.goto('/');
  await page.evaluate(async()=>{
    const model='/src/ui/creation/model.ts',settings='/src/ui/settings/model.ts',storage='/src/services/storage/saveRepository.ts';
    const {newCreation,buildCreationState}=await import(model),{defaultSettings}=await import(settings),{SaveRepository}=await import(storage);
    const form=newCreation();form.saveId='save-a';form.person={name:'林舟',age:'30',gender:'男性',appearance:'',personality:''};form.customProfession='记者';form.city='harbin';
    const repo=await SaveRepository.open();await repo.create(buildCreationState(form,defaultSettings()));repo.close();
  });
  await page.goto('/#game/save-a');await page.reload();await expect(page.locator('.clock')).toContainText('--:--');
  await expect(page.locator('.clock')).toContainText('开局时间待确认');await expect(page.locator('.atmo')).toHaveAttribute('data-time','night');
  await expect(page.locator('.clock')).not.toContainText('0001');
  await page.screenshot({path:`${directory}/react-pending-opening.png`});
  await page.goto('/');
  // A separate legacy save, with journal scenes removed, must still render fixed city plates.
  await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{const op=indexedDB.open('heijinwangchao');op.onsuccess=()=>{const db=op.result,tx=db.transaction(['saves','drafts'],'readwrite');tx.objectStore('saves').clear();tx.objectStore('drafts').clear();tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});});
  await enter(page);
  await page.evaluate(async()=>{const op=indexedDB.open('heijinwangchao');await new Promise<void>((resolve,reject)=>{op.onsuccess=()=>{const db=op.result,tx=db.transaction('saves','readwrite'),store=tx.objectStore('saves'),get=store.get('save-a');get.onsuccess=()=>{const state=get.result;state.journal.forEach((entry:{scene?:unknown})=>{delete entry.scene;});store.put(state);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});});
  await page.reload();await expect(page.locator('.c-sub')).toHaveText(['时间地点未记录','时间地点未记录']);
  await expect(page.locator('.city-night')).toHaveAttribute('data-city','cq');
});

test('UI-2：剧本台词、草稿与详情的真实 React 截图',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await enter(page);await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{
    const storage='/src/services/storage/saveRepository.ts',drafts='/src/domain/drafts.ts';
    const {SaveRepository}=await import(storage),{rerollStory}=await import(drafts),repo=await SaveRepository.open();
    let draft=await repo.loadDraft('save-a');draft=await repo.bindTurnAction(draft,'继续采访',true,true);
    await repo.saveDraft(rerollStory(draft,{turnKind:'regular',narrative:'【旁白】雨渐渐停了。沈砚站在街边，翻开手中的采访记录。\n【许知遥】那家旧书店就在前面。我们明天还可以再来。\n【沈砚】好。我会把这些记下来。\n【许知遥】第一行的约定。\n第二行的补充。',summary:'沈砚和许知遥确认了明天的安排。',variableGuide:[],actionOptions:['继续沿江采访','回到旧书店核对记录','联系编辑说明情况']}),draft.draftRevision);repo.close();
  });
  await page.reload();
  for(const [width,height] of [[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await page.getByTestId('story-reader').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    const latest=page.locator('.story-entry').last();await expect(latest.locator('.story-speaker')).toHaveText(['许知遥','沈砚','许知遥']);
    await expect(latest.locator('.story-bubble').last()).toContainText('第二行的补充');
    if(width>900){
      const avatar=(await latest.locator('.story-dialogue-hero .story-avatar').boundingBox())!,speech=(await latest.locator('.story-dialogue-hero .story-bubble').boundingBox())!;
      expect(avatar.x+avatar.width).toBeLessThan(speech.x);
    }
    await page.screenshot({path:`${directory}/react-dialogue-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1440,height:900});await page.locator('.workflow-disclosure > summary').click();
  await expect(page.locator('.workflow-details')).toBeVisible();await page.screenshot({path:`${directory}/react-workflow-details.png`});
});
