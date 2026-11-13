import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const phase = process.env.CREATION_LAYOUT_PHASE ?? 'after';
const root = resolve(process.env.CREATION_LAYOUT_EVIDENCE ?? 'test-results/creation-fullscreen', phase);
const steps = ['基本信息','职业与能力','城市与背景','初始同伴','确认与开局'];
async function shot(page: Page, name: string) {
  mkdirSync(root,{recursive:true}); await page.evaluate(()=>document.fonts.ready); await page.mouse.move(0,0);
  await page.screenshot({path:resolve(root,`${name}.png`),animations:'disabled'});
}
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async()=>{
    const path='/src/ui/creation/model.ts',{newCreation}=await import(path),f=newCreation();
    f.saveId='layout-fixture';f.person={name:'林序',age:'29',gender:'女性',appearance:'深色外套，袖口有修补痕迹。',personality:'谨慎而不失好奇。'};
    f.customProfession='旧籍修复师';f.professionDescription='修复旧籍，保存社区资料。';f.skills='纸张修复\n记录';f.skillsSource='manual';
    f.background='在旧街区长大。\n'.repeat(35);f.openingPreference='从平常的一天开始。';
    localStorage.setItem('heijin.creation.v1',JSON.stringify(f));
  });
  await page.goto('/#create');await page.reload();
  await expect(page.locator('.creation-page')).toBeVisible();
}
async function metrics(page:Page) {
  return page.evaluate(()=>{
    const box=(selector:string)=>{const b=document.querySelector(selector)!.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
    return {viewport:{width:innerWidth,height:innerHeight},header:box('.app-header'),main:box('.creation-page'),footer:box('.wizard-footer'),card:box('.creation-card'),dossier:box('.creation-dossier'),scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
  });
}
let posts=0;
test.beforeEach(async({page})=>{posts=0;await page.clock.setFixedTime(new Date('2026-11-13T04:00:00Z'));await page.route('**/*',r=>{if(r.request().method()==='POST'){posts++;return r.abort();}if(r.request().url().startsWith('https://')||r.request().url().endsWith('/api/announcement'))return r.abort();return r.continue();});});
test.afterEach(()=>expect(posts).toBe(0));
for(const [width,height] of [[901,800],[1100,800],[1440,900],[1600,900],[1920,1080],[901,500],[1100,420],[1440,500]]) {
 test(`视口边界与五步 ${width}x${height}`,async({page},info)=>{
  await page.setViewportSize({width,height});await seed(page);
  const all=[];
  for(let i=0;i<steps.length;i++){
    await page.getByRole('navigation',{name:'角色创建步骤'}).getByRole('button',{name:new RegExp(`${steps[i]}$`)}).click();
    const m=await metrics(page);all.push({step:i+1,...m});
    if(i===0||(width===1440&&height===900&&(i===1||i===4)))await shot(page,`${width}x${height}-step${i+1}`);
    expect.soft(Math.abs(m.main.left),`step ${i+1} left`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(m.main.right-width),`step ${i+1} right`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(m.main.top-m.header.bottom),`step ${i+1} header join`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(m.main.bottom-height),`step ${i+1} bottom`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(m.footer.bottom-height),`step ${i+1} footer`).toBeLessThanOrEqual(2);
    expect.soft(m.scrollWidth).toBeLessThanOrEqual(width);
  }
  mkdirSync(root,{recursive:true});writeFileSync(resolve(root,`${width}x${height}.json`),JSON.stringify(all,null,2)+'\n');
  await info.attach('measured-bounds',{body:JSON.stringify(all),contentType:'application/json'});
 });
}

test('短屏：独立滚动、五步按钮与表单交互可达',async({page})=>{
 await page.setViewportSize({width:1100,height:420});await seed(page);
 const card=page.locator('.creation-card'),dossier=page.locator('.creation-dossier');
 await page.getByLabel('姓名',{exact:true}).fill('布局验收');
 await page.getByRole('button',{name:/下一步/}).click();
 await expect(page.getByRole('heading',{name:'职业与能力',exact:true})).toBeVisible();
 await page.getByRole('radio',{name:'自由选择',exact:true}).check();
 await page.getByLabel('职业名称',{exact:true}).fill('文献修复师');
 await page.getByRole('button',{name:/下一步/}).click();
 await expect(page.getByRole('heading',{name:'城市与背景',exact:true})).toBeVisible();
 const bounds=await metrics(page);
 await card.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 expect(await card.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await dossier.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 expect(await dossier.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 expect((await metrics(page)).footer).toEqual(bounds.footer);
 expect(await page.evaluate(()=>scrollY)).toBe(0);
 await page.getByRole('button',{name:/下一步/}).click();
 await expect(page.getByRole('heading',{name:'初始同伴',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/下一步/}).click();
 await page.getByLabel('开局偏好（可选）').fill('短屏仍可输入，不发送请求。');
 await expect(page.getByRole('button',{name:'确认并创建存档',exact:true})).toBeInViewport();
 await expect(page.getByRole('button',{name:'上一步',exact:true})).toBeInViewport();
 await page.reload();await expect(page.getByLabel('开局偏好（可选）')).toHaveValue('短屏仍可输入，不发送请求。');
});

test.describe('未改手机',()=>{
 test.use({isMobile:true,hasTouch:true,deviceScaleFactor:1});
 for(const width of [390,900])test(`人生车票与断点 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await seed(page);
  await expect(page.locator('.mobile-creation')).toBeVisible();await expect(page.locator('.desktop-creation')).toHaveCount(0);
  await shot(page,`mobile-${width}-step1`);
  await page.getByRole('button',{name:'确认与开局',exact:true}).click();
  await expect(page.locator('.creation-ticket-stub')).toBeVisible();await shot(page,`mobile-${width}-step5`);
  await expect(page.locator('.wizard-footer button.primary')).toBeInViewport();
  await page.setViewportSize({width:901,height:844});await expect(page.locator('.desktop-creation')).toBeVisible();
  await page.setViewportSize({width,height:844});await expect(page.locator('.mobile-creation')).toBeVisible();
  await expect(page.locator('.wizard-footer button.primary')).toBeInViewport();
 });
});

test('首页及游戏界面隔离',async({page},info:TestInfo)=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/');await expect(page.locator('.home-page')).toBeVisible();await shot(page,'home-1440');
 const id=await page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',f='/src/tests/fixtures/world.ts',{SaveRepository}=await import(path),{worldState}=await import(f),repo=await SaveRepository.open();try{return (await repo.create(worldState())).saveId;}finally{repo.close();}});
 await page.goto(`/#game/${id}`);await expect(page.locator('.game-layout')).toBeVisible();await shot(page,'game-1440');
 await info.attach('route-isolation',{body:'Home and game rendered without desktop-creation selectors.',contentType:'text/plain'});
});
