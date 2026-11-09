import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { openWorldArchive } from './helpers/gameLayout';
async function seed(page: Page, extra = 0, scopes = false) {
  await page.goto('/');
  await page.evaluate(async ({ extra, scopes }) => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/tests/fixtures/historyV2.ts','/src/ui/settings/model.ts'];
    const [{SaveRepository},{worldState,worldResult},{completeDraft,submission},{historyDisplayCommands,historyScopeDisplayCommands},{defaultSettings,settingsKey}] = await Promise.all(paths.map(p=>import(p)));
    const repo=await SaveRepository.open();try {
      await repo.create(worldState());
      const opening=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]}});await repo.commitTurn(submission(opening,''));
      const draft=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult(scopes ? historyScopeDisplayCommands() : historyDisplayCommands(extra))});await repo.commitTurn(submission(draft,''));
    } finally {repo.close();}
    const settings=defaultSettings();for (const config of Object.values(settings.memory.summaries) as {automatic:boolean}[]) config.automatic=false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
  },{ extra, scopes });
  await page.goto('/#game/save-a');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function open(page: Page) {
  await expect(page.locator('.game-layout')).toBeVisible();
  await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:'历史时间轴',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'历史时间轴',exact:true})).toBeVisible();
}
async function close(page: Page) {
 await page.getByRole('dialog',{name:'历史时间轴',exact:true}).getByRole('button',{name:'关闭资料界面',exact:true}).click();
 const directory=page.getByRole('dialog',{name:'世界资料',exact:true});if(await directory.isVisible())await directory.getByRole('button',{name:'关闭资料界面',exact:true}).click();
}
async function saved(page:Page) { return page.evaluate(async()=> {const path='/src/services/storage/saveRepository.ts';const {SaveRepository}=await import(path);const repo=await SaveRepository.open();try{return (await repo.loadGame('save-a')).state;}finally{repo.close();}}); }

test('正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读', async ({ page }, info) => {
  let calls = 0; await page.route('**/chat/completions', route => { calls++; return route.abort(); });
  await seed(page, 0, true); const before = await saved(page); await open(page);
  const slots = page.locator('.history-axis > li');
  expect(await slots.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-time-key')))).toEqual([
    'day:2021-12-10', 'day:2021-12-11', 'day:2021-12-12', 'day:2021-12-13',
  ]);
  for (const [id, label] of [
    ['region', '地区重大事件'], ['country', '国家重大事件'], ['world', '世界重大事件'],
    ['organization', '重大组织事件'], ['hero', '主角重大事件'],
  ]) {
    const card = page.locator(`[data-history-id="scope-${id}"]`);
    await expect(card.locator('.tag')).toHaveText(label);
    await card.scrollIntoViewIfNeeded();
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.click();
    const detail = page.getByRole('article', { name: '纪事详情' });
    await expect(detail).toContainText(id === 'hero' ? '正式担任阅览室负责人' : '影响范围');
    await page.getByRole('button', { name: '返回时间轴' }).click();
  }
  const pair = slots.first(); await pair.scrollIntoViewIfNeeded();
  const world = await pair.locator('.history-world').boundingBox(), hero = await pair.locator('.history-protagonist').boundingBox();
  if (info.project.name === 'mobile') {
    expect(world!.x + world!.width).toBeLessThan(hero!.x); expect(Math.abs(world!.y - hero!.y)).toBeLessThan(2);
  } else { expect(world!.y + world!.height).toBeLessThan(hero!.y); expect(world!.x).toBe(hero!.x); }
  await page.screenshot({ path: info.outputPath('history-scope-labels.png') });
  if (info.project.name === 'mobile') {
    await slots.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('history-scope-labels-later.png') });
  }
  await page.getByRole('button', { name: '史料记录 · 1' }).click();
  await expect(page.getByRole('dialog', { name: '历史时间轴', exact: true })).toContainText('大学时期');
  expect(await saved(page)).toEqual(before); expect(calls).toBe(0);
});

test('单轴顺序、同日双视角、冬季、详情与史料；桌面横轴和手机竖轴真实截图',async({page},info)=>{
  await seed(page);const before=await saved(page);await open(page);
  const axis=page.getByRole('list',{name:'统一历史主轴'}), slots=axis.locator(':scope > li');
  expect(await slots.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-time-key')))).toEqual([
    'year:2020','season:2021:summer','day:2021-12-10','month:2021:12','season:2021:winter','year:2021','day:2022-01-01','unknown:unknown',
  ]);
  const paired=slots.nth(2);await expect(paired.locator('[data-history-id]')).toHaveCount(2);
  const world=await paired.locator('.history-world').boundingBox(),hero=await paired.locator('.history-protagonist').boundingBox();
  if(info.project.name==='mobile') {expect(world!.x+world!.width).toBeLessThan(hero!.x);expect(Math.abs(world!.y-hero!.y)).toBeLessThan(2);}
  else {expect(world!.y+world!.height).toBeLessThan(hero!.y);expect(world!.x).toBe(hero!.x);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('history-timeline.png')});
  if(info.project.name==='mobile'){await paired.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('history-paired.png')});}
  await paired.getByRole('button',{name:/正式就任馆长/}).click();
  await expect(page.getByRole('article',{name:'纪事详情'})).toContainText('后续的运营与人员安排仍继续推进');
  await page.getByRole('button',{name:'同一重大事实 · 临江阅览网络建成'}).click();
  await expect(page.getByRole('article',{name:'纪事详情'})).toContainText('影响范围');
  await page.screenshot({path:info.outputPath('history-detail.png')});
  await page.getByRole('button',{name:'返回时间轴'}).click();
  await page.getByRole('button',{name:'史料记录 · 1'}).click();await expect(page.getByRole('dialog',{name:'历史时间轴',exact:true})).toContainText('大学时期');await expect(page.getByRole('dialog',{name:'历史时间轴',exact:true})).toContainText('人物陈述');
  expect(await saved(page)).toEqual(before);
  await page.reload();await open(page);await expect(page.locator('[data-history-id="winter"]')).toBeVisible();
});
test('后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求',async({page})=>{
  let apiCalls=0;await page.route('**/chat/completions',route=>{apiCalls++;return route.abort();});
  await seed(page,32);await open(page);await expect(page.getByRole('button',{name:'下一页',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.history-axis > li')).toHaveCount(12);
  await page.getByLabel('搜索纪事',{exact:true}).fill('第31则');await expect(page.locator('[data-history-id]')).toHaveCount(1);
  await page.getByLabel('搜索纪事',{exact:true}).fill('');await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/turn.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/historyV2.ts'];
    const [{SaveRepository},{completeDraft,submission},{worldResult},{historyCommand,chronicle}]=await Promise.all(paths.map(p=>import(p)));
    const repo=await SaveRepository.open();try{
      const cmd=historyCommand('inserted',chronicle('inserted',{precision:'day',date:'2021-01-02'}));cmd.entry.title='后来发现的旧年档案';
      const draft=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult([cmd])});await repo.commitTurn(submission(draft,''));
    }finally{repo.close();}
  });
  await page.reload();await open(page);expect(await page.locator('.history-axis > li').nth(1).getAttribute('data-time-key')).toBe('day:2021-01-02');
  await close(page);await page.getByRole('button',{name:'撤回（2）',exact:true}).click();await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'撤回上一回合'})).not.toBeVisible();
  await page.reload();await open(page);await expect(page.locator('[data-history-id="inserted"]')).toHaveCount(0);
  await close(page);await page.getByRole('button',{name:'撤回（1）',exact:true}).click();await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'撤回上一回合'})).not.toBeVisible();await page.reload();await open(page);
  expect((await saved(page)).timeline).toEqual([]);expect(apiCalls).toBe(0);
});
test('长纪事完整详情、同刻大组有界分页与键盘访问',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/turn.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/historyV2.ts'];
  const [{SaveRepository},{completeDraft,submission},{worldResult},{historyCommand,chronicle}]=await Promise.all(paths.map(p=>import(p)));
  const repo=await SaveRepository.open();try{
   const commands=Array.from({length:80},(_,i)=>{const cmd=historyCommand(`group-${String(i).padStart(2,'0')}`,chronicle(`group-${String(i).padStart(2,'0')}`,{precision:'instant',at:'2021-12-01T08:00:00+08:00'}));
    cmd.entry.title=`同期纪事${String(i).padStart(2,'0')}：${'漫长道路与新事业'.repeat(8)}`;
    cmd.entry.chronicle.narrative='纪事原文。'.repeat(500)+'原文终章';return cmd;});
   const draft=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult(commands)});await repo.commitTurn(submission(draft,''));
  }finally{repo.close();}
 });
 await page.reload();await open(page);await page.getByLabel('搜索纪事',{exact:true}).fill('同期纪事');
 await expect(page.locator('.history-slot')).toHaveCount(1);await expect(page.locator('[data-history-id]')).toHaveCount(3);
 await page.getByRole('button',{name:'同组下一页',exact:true}).click();await expect(page.locator('[data-history-id="group-03"]')).toBeAttached();
 const node=page.locator('[data-history-id="group-03"]');await node.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('article',{name:'纪事详情'})).toContainText('原文终章');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'返回时间轴'}).click();await expect(page.locator('[data-history-id="group-00"]')).toBeAttached();
 expect((await saved(page)).timeline).toHaveLength(90);
});
