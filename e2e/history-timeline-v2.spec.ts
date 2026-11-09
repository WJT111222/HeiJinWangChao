import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { openWorldArchive } from './helpers/gameLayout';
async function seed(page: Page, extra = 0) {
  await page.goto('/');
  await page.evaluate(async extra => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/tests/fixtures/historyV2.ts','/src/ui/settings/model.ts'];
    const [{SaveRepository},{worldState,worldResult},{completeDraft,submission},{historyDisplayCommands},{defaultSettings,settingsKey}] = await Promise.all(paths.map(p=>import(p)));
    const repo=await SaveRepository.open();try {
      await repo.create(worldState());
      const opening=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]}});await repo.commitTurn(submission(opening,''));
      const draft=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult(historyDisplayCommands(extra))});await repo.commitTurn(submission(draft,''));
    } finally {repo.close();}
    const settings=defaultSettings();for (const config of Object.values(settings.memory.summaries) as {automatic:boolean}[]) config.automatic=false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
  },extra);
  await page.goto('/#game/save-a');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function open(page: Page) {
  await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:'历史时间轴',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'历史时间轴',exact:true})).toBeVisible();
}
async function saved(page:Page) { return page.evaluate(async()=> {const path='/src/services/storage/saveRepository.ts';const {SaveRepository}=await import(path);const repo=await SaveRepository.open();try{return (await repo.loadGame('save-a')).state;}finally{repo.close();}}); }

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
  await paired.getByRole('button',{name:/正式就任馆长/}).click();
  await expect(page.getByRole('article',{name:'纪事详情'})).toContainText('后续的运营与人员安排仍继续推进');
  await page.getByRole('button',{name:'同一重大事实 · 临江阅览网络建成'}).click();
  await expect(page.getByRole('article',{name:'纪事详情'})).toContainText('影响范围');
  await page.screenshot({path:info.outputPath('history-detail.png')});
  await page.getByRole('button',{name:'返回时间轴'}).click();
  await page.getByRole('button',{name:'史料记录 · 1'}).click();await expect(page.getByRole('dialog')).toContainText('大学时期');await expect(page.getByRole('dialog')).toContainText('人物陈述');
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
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤回（2）',exact:true}).click();await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'撤回上一回合'})).not.toBeVisible();
  await page.reload();await open(page);await expect(page.locator('[data-history-id="inserted"]')).toHaveCount(0);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤回（1）',exact:true}).click();await page.getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'撤回上一回合'})).not.toBeVisible();await page.reload();await open(page);
  expect((await saved(page)).timeline).toEqual([]);expect(apiCalls).toBe(0);
});
