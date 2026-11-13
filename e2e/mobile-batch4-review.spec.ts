import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

async function seed(page:Page, step:1|5, withPack=false) {
  await page.goto('/');
  const form=await page.evaluate(async({step,withPack})=>{
    const modelPath='/src/ui/creation/model.ts',packPath='/src/ui/creation/openingPacks.ts';
    const {newCreation}=await import(modelPath),{OpeningPackStore}=await import(packPath);
    const form=newCreation();form.step=step;
    form.person={name:'沈砚',age:'27',gender:'男性',appearance:'衣着素净',personality:'沉稳谨慎'};
    form.customProfession='旧书修复师';form.skills='修补\n记录';form.skillsSource='manual';
    form.openingPreference='2015年秋天，从旧书店开始。';
    localStorage.setItem('heijin.creation.v1',JSON.stringify(form));
    if(withPack)new OpeningPackStore(localStorage).save('山城人生',form);
    return form;
  },{step,withPack});
  await page.goto('/#create');await page.reload();
  await expect(page.locator('.mobile-creation')).toBeVisible();return form;
}
async function savedGames(page:Page) {
  return page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.list();}finally{repo.close();}});
}
async function packSnapshot(page:Page) {
  return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('heijin.opening-pack.v1:'))));
}
let posts=0;
test.beforeEach(async({page})=>{
  posts=0;await page.route('**/*',route=>{if(route.request().method()==='POST'){posts++;return route.abort('blockedbyclient');}return route.continue();});
});
test.afterEach(()=>expect(posts).toBe(0));

test('复审：手机开局包删除赭红、覆盖金色、取消中性；PC 不附加这些样式',async({page})=>{
  await seed(page,1,true);const original=await packSnapshot(page);
  await page.getByRole('button',{name:'我的开局包',exact:true}).click();
  let dialog=page.getByRole('dialog');await dialog.getByRole('radio').check();
  await dialog.getByRole('button',{name:'删除',exact:true}).click();
  const remove=dialog.getByRole('button',{name:'确认删除',exact:true});
  await expect(remove).toHaveClass('opening-pack-confirm-delete');
  await expect(remove).toHaveCSS('background-color','rgb(163, 65, 46)');
  await expect(remove).toHaveCSS('color','rgb(255, 241, 232)');
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveClass('opening-pack-confirm-cancel');
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveCSS('background-image','none');
  await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);
  await page.screenshot({path:'docs/mobile-batch4/screenshots/pack-delete-390.png',animations:'disabled'});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await packSnapshot(page)).toEqual(original);
  await dialog.getByRole('button',{name:'关闭开局包'}).click();
  await page.getByRole('navigation',{name:'角色创建步骤'}).getByRole('button',{name:'确认与开局',exact:true}).click();
  await page.getByRole('button',{name:'保存为开局包'}).click();dialog=page.getByRole('dialog');
  await dialog.getByRole('radio',{name:'覆盖：山城人生',exact:true}).click();
  await dialog.getByRole('button',{name:'保存开局包',exact:true}).click();
  const overwrite=dialog.getByRole('button',{name:'确认覆盖',exact:true});
  await expect(overwrite).toHaveClass('opening-pack-confirm-overwrite');
  await expect(overwrite).toHaveCSS('background-image','linear-gradient(rgb(240, 219, 162), rgb(197, 164, 90))');
  await expect(overwrite).toHaveCSS('color','rgb(23, 24, 16)');
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveCSS('background-image','none');
  await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);
  await page.screenshot({path:'docs/mobile-batch4/screenshots/pack-overwrite-390.png',animations:'disabled'});
  expect(await packSnapshot(page)).toEqual(original);
  await page.setViewportSize({width:901,height:900});
  await expect(overwrite).not.toHaveAttribute('class');
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).not.toHaveAttribute('class');
  await expect(dialog).not.toHaveClass(/mobile-opening-pack/);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  expect(await packSnapshot(page)).toEqual(original);expect(await savedGames(page)).toEqual([]);
});

test('复审：第五站 CDP 真实触摸短拉与 touchCancel 零建档，超过60px松开只建一份原开局草稿',async({page})=>{
  const form=await seed(page,5);
  // Browser-generated pointer events confirm this test does not use a mouse.
  await page.evaluate(()=>{
    Reflect.set(window,'tearTouchEvidence',[]);Reflect.set(window,'creationSubmitCount',0);
    document.addEventListener('pointerdown',event=>{if((event.target as Element).closest('.creation-ticket-stub'))Reflect.get(window,'tearTouchEvidence').push({type:event.type,pointerType:event.pointerType});},true);
    document.addEventListener('pointercancel',event=>{if((event.target as Element).closest('.creation-ticket-stub'))Reflect.get(window,'tearTouchEvidence').push({type:event.type,pointerType:event.pointerType});},true);
    document.querySelector('.mobile-creation>form')!.addEventListener('submit',()=>Reflect.set(window,'creationSubmitCount',Reflect.get(window,'creationSubmitCount')+1),true);
  });
  const client=await page.context().newCDPSession(page);
  async function touch(dy:number,cancel=false) {
    const stub=page.locator('.creation-card .creation-ticket-stub');await stub.scrollIntoViewIfNeeded();
    const box=(await stub.boundingBox())!,x=box.x+40,y=box.y+16;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y,radiusX:4,radiusY:4,force:1}]});
    for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+dy*i/6,radiusX:4,radiusY:4,force:1}]});
    await client.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  }
  await touch(40);expect(await savedGames(page)).toEqual([]);
  expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(0);
  await touch(85,true);expect(await savedGames(page)).toEqual([]);
  expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(0);
  await touch(75);await expect(page.locator('.game-layout')).toBeVisible();
  const list=await savedGames(page);expect(list).toHaveLength(1);expect(list[0].saveId).toBe(form.saveId);
  const loaded=await page.evaluate(async(id)=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.loadGame(id);}finally{repo.close();}},form.saveId);
  expect(loaded.state).toMatchObject({saveId:form.saveId,revision:0,turnNumber:0,openingTimePending:true,openingInitializationPending:true,openingCityId:form.city});
  expect(loaded.draft).toMatchObject({saveId:form.saveId,turnId:`opening-${form.saveId}`,turnKind:'opening',baseSaveRevision:0,userInput:form.openingPreference});
  expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(1);
  const evidence=await page.evaluate(()=>Reflect.get(window,'tearTouchEvidence') as {type:string;pointerType:string}[]);
  expect(evidence.filter(event=>event.type==='pointerdown').map(event=>event.pointerType)).toEqual(['touch','touch','touch']);
  expect(evidence.some(event=>event.type==='pointercancel'&&event.pointerType==='touch')).toBe(true);
  expect(posts).toBe(0);
});
