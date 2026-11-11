import { expect, test } from './helpers/test';
import { openLibrary } from './helpers/home';

test('四城轮换、手动重置与reduced-motion：无演示功能或外部调用', async ({page}) => {
  test.setTimeout(60000);
  let requests=0;await page.route('https://**/*',r=>{requests++;return r.abort();});
  const now=new Date();await page.clock.install({time:now});await page.clock.pauseAt(new Date(now.getTime()+1000));await page.goto('/');
  await expect(page.locator('.home-experience')).toHaveAttribute('data-city','cq');
  await page.clock.fastForward(7000);await expect(page.locator('.home-experience')).toHaveAttribute('data-city','sh');
  await page.getByRole('button',{name:'哈尔滨',exact:true}).click();await expect(page.locator('.home-experience')).toHaveAttribute('data-city','hrb');
  await page.clock.runFor(16);await page.clock.fastForward(6000);await expect(page.locator('.home-experience')).toHaveAttribute('data-city','hrb');
  await page.clock.fastForward(1000);await expect(page.locator('.home-experience')).toHaveAttribute('data-city','gz');
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.fastForward(28000);
  await expect(page.locator('.home-experience')).toHaveAttribute('data-city','cq');
  expect(await page.locator('.skyline .w').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.skyline svg').first().getAttribute('aria-hidden')).toBe('true');
  await expect(page.getByText('设计稿控制')).toHaveCount(0);expect(requests).toBe(0);
});

test('真实存档与封面/存档馆、键盘、继续和创角入口保持',async({page},info)=>{
 test.setTimeout(60000);
 await page.setViewportSize(info.project.name==='mobile'?{width:390,height:844}:{width:1440,height:900});
 await page.goto('/');await page.evaluate(async()=>{
  const rp='/src/services/storage/saveRepository.ts',fp='/src/tests/fixtures/game.ts';
  const {SaveRepository}=await import(rp),{game}=await import(fp),repo=await SaveRepository.open();
  for(const [i,city] of ['重庆','上海','哈尔滨','广州','其他'].entries())await repo.create({...game(`home-${i}`),title:`人生${i} · ${city}`});repo.close();
 });await page.reload();
 await expect(page.locator('.btn-continue')).toContainText('保存于');
 await openLibrary(page);await expect(page.getByRole('button',{name:'封面',exact:true})).toBeFocused();
 await expect(page.locator('.save-card')).toHaveCount(5);
 const card=page.locator('.save-card').filter({hasText:'人生1'});await card.getByRole('button',{name:'选择',exact:true}).click();
 await expect(card.getByRole('button',{name:'选择',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('library-populated.png')});
 await page.keyboard.press('Escape');await expect(page.locator('.cover button:visible').first()).toBeFocused();
 await expect(page.locator('.btn-continue')).toContainText('人生1');
 await page.locator('.btn-continue').click();await expect(page.locator('.game-layout')).toBeVisible();
 await page.goto('/');await page.locator('.btn-start').click();await expect(page.getByLabel('姓名',{exact:true})).toBeVisible();
});

test('设计稿对应的双端真实页面截图、空态及全部真实信息入口',async({page},info)=>{
 test.setTimeout(90000);
 await page.goto('/');await expect(page.locator('.btn-continue')).toBeDisabled();
 for(const size of info.project.name==='desktop'?[{width:1440,height:900},{width:1280,height:800},{width:1024,height:768}]:[{width:390,height:844}]){
  await page.setViewportSize(size);
  await expect(page.locator('#cover')).toHaveCSS('transform','none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.btn-start')).toBeInViewport();
  if(size.width>900)expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.screenshot({path:info.outputPath(`cover-${size.width}.png`)});
  await openLibrary(page);await expect(page.getByText('还没有开始的人生。')).toBeVisible();
  await expect(page.getByRole('button',{name:/开启新的人生/})).toBeVisible();
  await page.screenshot({path:info.outputPath(`library-${size.width}.png`)});
  await page.keyboard.press('Escape');
 }
 for(const name of ['王朝公告','游玩须知与免责声明']){
  await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 }
 await page.locator('.topbar').getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();
});
