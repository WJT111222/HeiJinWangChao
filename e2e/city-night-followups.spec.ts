import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import { seedNightSeal, nightSealStored } from './helpers/nightSeal';
import type { Page } from '@playwright/test';

const destination='docs/main-screen-city-night/followups/screenshots';
const health='昨晚休息不足，肩颈仍有些酸痛。沿江步行后呼吸平稳，旧伤没有加重。需要按时吃饭并及时补充水分，长时间站立后应适当坐下休息。';
const emotion='对刚收到的消息略有担忧，但已确认接下来的安排。与熟悉的人交谈后逐渐平静，仍在反复思考线索之间的联系，希望先核实信息再作决定。';
const weather='持续小雨，气温 9℃，江面有雾。雨势会让路面湿滑，能见度有所降低。';
const environment='店里只剩两桌客人，咖啡机的蒸汽声盖过了雨声。窗边能听见远处轻轨经过，门口有行人收起雨伞。';
async function update(page:Page,patch:Record<string,unknown>){
  await page.evaluate(async patch=>{
    const op=indexedDB.open('heijinwangchao');
    await new Promise<void>((resolve,reject)=>{op.onsuccess=()=>{
      const db=op.result,tx=db.transaction('saves','readwrite'),store=tx.objectStore('saves'),get=store.get('save-a');
      get.onsuccess=()=>{const state=get.result;Object.assign(state,patch);store.put(state);};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
    };op.onerror=()=>reject(op.error);});
  },patch);
  await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function seed(page:Page){
  await mkdir(destination,{recursive:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('https://**/*',route=>route.abort()); // No model or image network calls.
  await seedNightSeal(page);
  const before=await nightSealStored(page);
  await update(page,{
    worldClock:'2026-11-12T07:50:00+08:00',weatherText:weather,environmentText:environment,
    protagonist:{...before.state.protagonist,healthText:health,emotionText:emotion},
    economy:{...before.state.economy,cash:123456789,onlineBalance:12345678901},
  });
}
function details(page:Page){return page.getByRole('dialog',{name:'天气与环境详情',exact:true});}
async function openDetails(page:Page,mobile:boolean){
  await page.getByRole('button',{name:mobile?'查看天气与环境详情':'查看天气详情',exact:true}).click();
  await expect(details(page)).toBeVisible();
}
async function insideViewport(page:Page){
  const box=(await details(page).boundingBox())!,viewport=page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test('四项修复：07:50 与完整状态/资金、双端真实 React 截图',async({page},info)=>{
  await page.setViewportSize(info.project.name==='desktop'?{width:1440,height:900}:{width:390,height:844});
  await seed(page);const before=await nightSealStored(page),mobile=info.project.name==='mobile';
  if(!mobile){
    await expect(page.locator('.clock')).toContainText('07:50');await expect(page.locator('.tod')).toHaveText('早晨');
    await expect(page.locator('.clock')).toContainText('星期四');await expect(page.locator('.city-night')).toHaveAttribute('data-time','day');
    await expect(page.locator('.status-condition > span').nth(0)).toHaveText('身体'+health);
    await expect(page.locator('.status-condition > span').nth(1)).toHaveText('情绪'+emotion);
    for(const card of await page.locator('.status-condition > span').all()){
      expect(await card.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
      expect(await card.evaluate(e=>getComputedStyle(e).webkitLineClamp)).toBe('none');
    }
    await expect(page.locator('.status-funds strong')).toHaveText(['1,234,567.89 元','123,456,789.01 元']);
  }else await expect(page.locator('.status-mobile-location')).toContainText('07:50');
  await page.screenshot({path:`${destination}/${info.project.name}-0750-status.png`});
  await openDetails(page,mobile);await expect(details(page).locator('dd')).toHaveText([weather,environment]);await insideViewport(page);
  await page.screenshot({path:`${destination}/${info.project.name}-scene-details.png`});
  await details(page).getByRole('button',{name:'关闭天气与环境详情'}).click();await expect(details(page)).toHaveCount(0);
  expect(await nightSealStored(page)).toEqual(before);
});

test('PC 长段落/异常长字符串完整换行，左栏独立滚动且资金装备与底部按钮可达',async({page},info)=>{
  test.skip(info.project.name!=='desktop');test.setTimeout(90000);await seed(page);
  const state=(await nightSealStored(page)).state;
  const longHealth=(health+'\n').repeat(18)+'身体全文结束';
  const longEmotion=emotion+'A'.repeat(1600)+'情绪全文结束';
  await update(page,{protagonist:{...state.protagonist,healthText:longHealth,emotionText:longEmotion}});
  const before=await nightSealStored(page),measurements=[];
  for(const [width,height] of [[1920,1080],[1440,900],[1280,800],[1100,800],[901,600]]){
    await page.setViewportSize({width,height});
    await expect(page.locator('.tod')).toBeVisible();await expect(page.locator('.tod')).toHaveText('早晨');
    const aside=page.locator('.player-status');
    expect(await aside.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
    expect(await aside.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    for(const card of await page.locator('.status-condition > span').all()){
      const metrics=await card.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,overflow:getComputedStyle(e).overflow,clamp:getComputedStyle(e).webkitLineClamp}));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.height+1);expect(metrics.clamp).toBe('none');expect(metrics.overflow).toBe('visible');
      measurements.push({width,...metrics});
    }
    await aside.evaluate(e=>{e.scrollTop=0;});await expect(page.locator('.status-funds')).toBeInViewport();
    await aside.evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await expect(page.locator('.status-wear dd')).toHaveCount(7);
    for(const row of await page.locator('.status-wear dd').all()){await row.scrollIntoViewIfNeeded();await expect(row).toBeInViewport({ratio:1});}
    for(const name of ['人物档案','经济与资产']){
      const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.click();
      await expect(page.getByRole('dialog',{name,exact:true})).toBeVisible();await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport({ratio:1});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:900});await page.locator('.player-status').evaluate(e=>{e.scrollTop=e.scrollHeight;});
  await page.screenshot({path:`${destination}/desktop-long-status-bottom.png`});
  expect(await nightSealStored(page)).toEqual(before);
  await writeFile('docs/main-screen-city-night/followups/status-measurements.json',JSON.stringify(measurements,null,2)+'\n');
});

test('PC 普通/百万/亿级/极大金额随容器调整字号，下限后排版换行不省略',async({page},info)=>{
  test.skip(info.project.name!=='desktop');test.setTimeout(120000);await seed(page);
  const state=(await nightSealStored(page)).state,measurements=[];
  for(const [amount,expected] of [[138600,'1,386.00 元'],[123456789,'1,234,567.89 元'],[12345678901,'123,456,789.01 元'],[Number.MAX_SAFE_INTEGER,'90,071,992,547,409.91 元']] as const){
    await update(page,{economy:{...state.economy,cash:amount,onlineBalance:amount}});
    const before=await nightSealStored(page);
    for(const width of [1920,1440,1280,1100,901]){
      await page.setViewportSize({width,height:900});
      await expect(page.locator('.status-funds strong')).toHaveText([expected,expected]);
      for(const field of await page.locator('.status-funds strong').all()){
        const geometry=await field.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,height:e.clientHeight,font:parseFloat(getComputedStyle(e).fontSize),overflow:getComputedStyle(e).overflow,textOverflow:getComputedStyle(e).textOverflow,whiteSpace:getComputedStyle(e).whiteSpace}));
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.overflow).toBe('visible');expect(geometry.textOverflow).toBe('clip');expect(geometry.font).toBeGreaterThanOrEqual(12);expect(geometry.font).toBeLessThanOrEqual(18);
        measurements.push({amount,viewportWidth:width,...geometry});
      }
      expect(await page.locator('.player-status').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    }
    expect(await nightSealStored(page)).toEqual(before);
  }
  expect(new Set(measurements.map(m=>m.font)).size).toBeGreaterThan(1);
  await page.setViewportSize({width:1100,height:800});await page.screenshot({path:`${destination}/desktop-extreme-funds.png`});
  await writeFile('docs/main-screen-city-night/followups/funds-measurements.json',JSON.stringify(measurements,null,2)+'\n');
});

test('天气环境详情：悬停跨入可滚动、移出关闭，键盘焦点与 Esc，无数据修改',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await seed(page);
  await update(page,{weatherText:weather.repeat(30)+'天气全文结束',environmentText:environment.repeat(30)+'环境全文结束'});
  const before=await nightSealStored(page),trigger=page.getByRole('button',{name:'查看天气详情',exact:true});
  await trigger.hover();await expect(details(page)).toBeVisible();await details(page).hover();
  await expect(details(page)).toBeVisible();await expect(details(page).locator('dd').nth(0)).toHaveText(weather.repeat(30)+'天气全文结束');
  const scroller=details(page).locator('dl');expect(await scroller.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await scroller.evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(details(page)).toContainText('环境全文结束');await insideViewport(page);
  await page.screenshot({path:`${destination}/desktop-long-scene-details.png`});
  await page.mouse.move(5,5);await expect(details(page)).toHaveCount(0);
  await trigger.focus();await expect(details(page)).toBeVisible();await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'查看环境详情',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(details(page).getByRole('button',{name:'关闭天气与环境详情'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(details(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'查看环境详情',exact:true})).toBeFocused();
  await page.getByTestId('story-reader').focus();await trigger.focus();await expect(details(page)).toBeVisible();await details(page).hover();
  await page.getByRole('button',{name:'人物档案',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'人物档案',exact:true})).toBeVisible();await expect(details(page)).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'人物档案',exact:true})).toHaveCount(0);
  expect(await nightSealStored(page)).toEqual(before);
});

test('触控点击详情、再次点击/关闭/外部点击收起，窄屏与缩放视口不溢出',async({page},info)=>{
  test.skip(info.project.name!=='mobile');await seed(page);const before=await nightSealStored(page);
  for(const width of [320,390,820,1100]){
    await page.setViewportSize({width,height:844});const mobile=width<=900;
    const trigger=page.getByRole('button',{name:mobile?'查看天气与环境详情':'查看天气详情',exact:true});
    await trigger.tap();await expect(details(page)).toBeVisible();await insideViewport(page);
    await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport({ratio:1});
    await trigger.tap();await expect(details(page)).toHaveCount(0);
    await trigger.tap();await details(page).getByRole('button',{name:'关闭天气与环境详情'}).tap();await expect(details(page)).toHaveCount(0);
    await trigger.tap();await page.getByLabel('你的行动',{exact:true}).tap();await expect(details(page)).toHaveCount(0);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'查看天气与环境详情',exact:true}).tap();
  await page.evaluate(()=>{
    const viewport=window.visualViewport!;
    for(const [key,value] of Object.entries({width:240,height:360,offsetLeft:24,offsetTop:12}))Object.defineProperty(viewport,key,{configurable:true,value});
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async()=>{const b=(await details(page).boundingBox())!;return b.x>=36&&b.x+b.width<=252+1&&b.y>=24&&b.y+b.height<=360+1;}).toBe(true);
  await page.screenshot({path:`${destination}/mobile-visual-viewport-details.png`});
  await page.evaluate(()=>{
    const viewport=window.visualViewport!;
    for(const key of ['width','height','offsetLeft','offsetTop'])Reflect.deleteProperty(viewport,key);
    viewport.dispatchEvent(new Event('resize'));
  });
  await details(page).getByRole('button',{name:'关闭天气与环境详情'}).tap();
  await page.getByRole('button',{name:'查看天气与环境详情',exact:true}).tap();
  await page.setViewportSize({width:1100,height:844});
  await expect(page.locator('.scene-details-popover:popover-open')).toHaveCount(0);
  await page.getByRole('button',{name:'查看天气详情',exact:true}).tap();await expect(details(page)).toBeVisible();
  await details(page).getByRole('button',{name:'关闭天气与环境详情'}).tap();
  expect(await nightSealStored(page)).toEqual(before);
});
