# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-batch4-review.spec.ts >> 复审：手机开局包删除赭红、覆盖金色、取消中性；PC 不附加这些样式
- Location: e2e/mobile-batch4-review.spec.ts:32:1

# Error details

```
Error: expect(locator).toHaveCSS(expected) failed

Locator:  getByRole('dialog').getByRole('button', { name: '确认删除', exact: true })
Expected: "rgb(163, 65, 46)"
Received: "rgb(32, 39, 32)"
Timeout:  5000ms

Call log:
  - Expect "toHaveCSS" getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }) with timeout 5000ms
  - waiting for getByRole('dialog').getByRole('button', { name: '确认删除', exact: true })
    14 × locator resolved to <button type="button" class="opening-pack-confirm-delete">确认删除</button>
       - unexpected value "rgb(32, 39, 32)"

```

```yaml
- button "确认删除"
```

# Test source

```ts
  1  | import { test, expect } from './helpers/test';
  2  | import type { Page } from '@playwright/test';
  3  |
  4  | async function seed(page:Page, step:1|5, withPack=false) {
  5  |   await page.goto('/');
  6  |   const form=await page.evaluate(async({step,withPack})=>{
  7  |     const modelPath='/src/ui/creation/model.ts',packPath='/src/ui/creation/openingPacks.ts';
  8  |     const {newCreation}=await import(modelPath),{OpeningPackStore}=await import(packPath);
  9  |     const form=newCreation();form.step=step;
  10 |     form.person={name:'沈砚',age:'27',gender:'男性',appearance:'衣着素净',personality:'沉稳谨慎'};
  11 |     form.customProfession='旧书修复师';form.skills='修补\n记录';form.skillsSource='manual';
  12 |     form.openingPreference='2015年秋天，从旧书店开始。';
  13 |     localStorage.setItem('heijin.creation.v1',JSON.stringify(form));
  14 |     if(withPack)new OpeningPackStore(localStorage).save('山城人生',form);
  15 |     return form;
  16 |   },{step,withPack});
  17 |   await page.goto('/#create');await page.reload();
  18 |   await expect(page.locator('.mobile-creation')).toBeVisible();return form;
  19 | }
  20 | async function savedGames(page:Page) {
  21 |   return page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.list();}finally{repo.close();}});
  22 | }
  23 | async function packSnapshot(page:Page) {
  24 |   return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('heijin.opening-pack.v1:'))));
  25 | }
  26 | let posts=0;
  27 | test.beforeEach(async({page})=>{
  28 |   posts=0;await page.route('**/*',route=>{if(route.request().method()==='POST'){posts++;return route.abort('blockedbyclient');}return route.continue();});
  29 | });
  30 | test.afterEach(()=>expect(posts).toBe(0));
  31 |
  32 | test('复审：手机开局包删除赭红、覆盖金色、取消中性；PC 不附加这些样式',async({page})=>{
  33 |   await seed(page,1,true);const original=await packSnapshot(page);
  34 |   await page.getByRole('button',{name:'我的开局包',exact:true}).click();
  35 |   let dialog=page.getByRole('dialog');await dialog.getByRole('radio').check();
  36 |   await dialog.getByRole('button',{name:'删除',exact:true}).click();
  37 |   const remove=dialog.getByRole('button',{name:'确认删除',exact:true});
  38 |   await expect(remove).toHaveClass('opening-pack-confirm-delete');
> 39 |   await expect(remove).toHaveCSS('background-color','rgb(163, 65, 46)');
     |                        ^ Error: expect(locator).toHaveCSS(expected) failed
  40 |   await expect(remove).toHaveCSS('color','rgb(255, 241, 232)');
  41 |   await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveClass('opening-pack-confirm-cancel');
  42 |   await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveCSS('background-image','none');
  43 |   await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);
  44 |   await page.screenshot({path:'docs/mobile-batch4/screenshots/pack-delete-390.png',animations:'disabled'});
  45 |   await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await packSnapshot(page)).toEqual(original);
  46 |   await dialog.getByRole('button',{name:'关闭开局包'}).click();
  47 |   await page.getByRole('navigation',{name:'角色创建步骤'}).getByRole('button',{name:'确认与开局',exact:true}).click();
  48 |   await page.getByRole('button',{name:'保存为开局包'}).click();dialog=page.getByRole('dialog');
  49 |   await dialog.getByRole('radio',{name:'覆盖：山城人生',exact:true}).click();
  50 |   await dialog.getByRole('button',{name:'保存开局包',exact:true}).click();
  51 |   const overwrite=dialog.getByRole('button',{name:'确认覆盖',exact:true});
  52 |   await expect(overwrite).toHaveClass('opening-pack-confirm-overwrite');
  53 |   await expect(overwrite).toHaveCSS('background-image','linear-gradient(rgb(240, 219, 162), rgb(197, 164, 90))');
  54 |   await expect(overwrite).toHaveCSS('color','rgb(23, 24, 16)');
  55 |   await expect(dialog.getByRole('button',{name:'取消',exact:true})).toHaveCSS('background-image','none');
  56 |   await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);
  57 |   await page.screenshot({path:'docs/mobile-batch4/screenshots/pack-overwrite-390.png',animations:'disabled'});
  58 |   expect(await packSnapshot(page)).toEqual(original);
  59 |   await page.setViewportSize({width:901,height:900});
  60 |   await expect(overwrite).not.toHaveAttribute('class');
  61 |   await expect(dialog.getByRole('button',{name:'取消',exact:true})).not.toHaveAttribute('class');
  62 |   await expect(dialog).not.toHaveClass(/mobile-opening-pack/);
  63 |   await dialog.getByRole('button',{name:'取消',exact:true}).click();
  64 |   expect(await packSnapshot(page)).toEqual(original);expect(await savedGames(page)).toEqual([]);
  65 | });
  66 |
  67 | test('复审：第五站 CDP 真实触摸短拉与 touchCancel 零建档，超过60px松开只建一份原开局草稿',async({page})=>{
  68 |   const form=await seed(page,5);
  69 |   // Browser-generated pointer events confirm this test does not use a mouse.
  70 |   await page.evaluate(()=>{
  71 |     Reflect.set(window,'tearTouchEvidence',[]);Reflect.set(window,'creationSubmitCount',0);
  72 |     document.addEventListener('pointerdown',event=>{if((event.target as Element).closest('.creation-ticket-stub'))Reflect.get(window,'tearTouchEvidence').push({type:event.type,pointerType:event.pointerType});},true);
  73 |     document.addEventListener('pointercancel',event=>{if((event.target as Element).closest('.creation-ticket-stub'))Reflect.get(window,'tearTouchEvidence').push({type:event.type,pointerType:event.pointerType});},true);
  74 |     document.querySelector('.mobile-creation>form')!.addEventListener('submit',()=>Reflect.set(window,'creationSubmitCount',Reflect.get(window,'creationSubmitCount')+1),true);
  75 |   });
  76 |   const client=await page.context().newCDPSession(page);
  77 |   async function touch(dy:number,cancel=false) {
  78 |     const stub=page.locator('.creation-card .creation-ticket-stub');await stub.scrollIntoViewIfNeeded();
  79 |     const box=(await stub.boundingBox())!,x=box.x+40,y=box.y+16;
  80 |     await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y,radiusX:4,radiusY:4,force:1}]});
  81 |     for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+dy*i/6,radiusX:4,radiusY:4,force:1}]});
  82 |     await client.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  83 |   }
  84 |   await touch(40);expect(await savedGames(page)).toEqual([]);
  85 |   expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(0);
  86 |   await touch(85,true);expect(await savedGames(page)).toEqual([]);
  87 |   expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(0);
  88 |   await touch(75);await expect(page.locator('.game-layout')).toBeVisible();
  89 |   const list=await savedGames(page);expect(list).toHaveLength(1);expect(list[0].saveId).toBe(form.saveId);
  90 |   const loaded=await page.evaluate(async(id)=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.loadGame(id);}finally{repo.close();}},form.saveId);
  91 |   expect(loaded.state).toMatchObject({saveId:form.saveId,revision:0,turnNumber:0,openingTimePending:true,openingInitializationPending:true,openingCityId:form.city});
  92 |   expect(loaded.draft).toMatchObject({saveId:form.saveId,turnId:`opening-${form.saveId}`,turnKind:'opening',baseSaveRevision:0,userInput:form.openingPreference});
  93 |   expect(await page.evaluate(()=>Reflect.get(window,'creationSubmitCount'))).toBe(1);
  94 |   const evidence=await page.evaluate(()=>Reflect.get(window,'tearTouchEvidence') as {type:string;pointerType:string}[]);
  95 |   expect(evidence.filter(event=>event.type==='pointerdown').map(event=>event.pointerType)).toEqual(['touch','touch','touch']);
  96 |   expect(evidence.some(event=>event.type==='pointercancel'&&event.pointerType==='touch')).toBe(true);
  97 |   expect(posts).toBe(0);
  98 | });
  99 |
```
