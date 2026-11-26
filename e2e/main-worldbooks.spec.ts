import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { openSettings } from './helpers/gameLayout';

const titles = ['黑金王朝·世界观 V2.0','现代现实基本逻辑与地下社会生态 V2.0'];
async function settings(page: Page) {
  await openSettings(page);
  await page.getByRole('button', {name:/^世界书/}).click();
  await expect(page.getByRole('heading', {name:'内置主世界书'})).toBeVisible();
}

for (const appearance of ['day','night'] as const) {
  test(appearance + ' 官方双开关、独立副本、用途与跨页刷新', async ({ context, page }, info) => {
    test.setTimeout(75_000);
    await page.goto('/');
    await page.evaluate(async value => {
      const path = '/src/ui/settings/model.ts', {defaultSettings, settingsKey} = await import(path);
      const cfg = defaultSettings(); cfg.display.appearance = value; localStorage.setItem(settingsKey, JSON.stringify(cfg));
    }, appearance);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    await settings(page);
    const second = await context.newPage();
    await second.goto('/'); await settings(second);
    const flag = (p: Page, i: number) => p.getByRole('checkbox', {name:'启用「' + titles[i] + '」',exact:true});
    await expect(flag(page,0)).toBeChecked(); await expect(flag(page,1)).toBeChecked();
    await Promise.all([flag(page,0).click(),flag(second,1).click()]);
    for (const p of [page,second]) for (const i of [0,1]) await expect(flag(p,i)).not.toBeChecked();
    const official = page.getByRole('region',{name:'内置主世界书'});
    const first = official.locator('article').first();
    await first.locator('summary').click();
    await expect(first.locator('pre')).toContainText('中国城市与地域差异');
    await first.locator('summary').click();
    await first.getByRole('button',{name:'复制为自定义世界书'}).click();
    const detail = page.locator('.wb-detail');
    await expect(detail.getByLabel('书籍用途')).toHaveValue('main');
    await expect(detail.getByRole('checkbox',{name:/启用整本/})).not.toBeChecked();
    await expect(flag(page,0)).not.toBeChecked();
    for (const [name, locator] of [['official',official],['player',detail]] as const) {
      await locator.locator(name === 'official' ? 'h3' : '.wb-purpose').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const screenshot = info.outputPath(name + '.png');
      await page.screenshot({path:screenshot});
      await info.attach(name, {path:screenshot,contentType:'image/png'});
    }
    await detail.getByLabel('书籍用途').selectOption('ordinary');
    await detail.getByRole('button',{name:'保存修改'}).click();
    await expect(detail.locator('.wb-savebar')).toHaveCount(0);
    await second.getByRole('button',{name:'恢复官方默认开关'}).click();
    await expect(flag(page,0)).toBeChecked(); await expect(flag(page,1)).toBeChecked();
    await expect(detail.getByLabel('书籍用途')).toHaveValue('ordinary');
    await expect(detail.getByRole('checkbox',{name:/启用整本/})).not.toBeChecked();
    await page.reload(); await settings(page);
    await page.locator('.wb-info').filter({hasText:'副本'}).click();
    await expect(page.getByLabel('书籍用途')).toHaveValue('ordinary');
  });
}

test('完整文学预设和真实 Worker 将主书常驻与关键词各发送一次', async ({page}, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('heijin.story-presets.v1',JSON.stringify({enabled:true,selected:'peinture-1118',packages:{}})));
  const bodies: {messages:{role:string;content:string}[];tools?:unknown[]}[] = [];
  await page.route('https://worldbook.mock.invalid/**', route => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const content = '<正文>林舟在月港停下脚步。</正文><短期记忆>来到月港。</短期记忆><变量规划>[]</变量规划>';
    return route.fulfill({json:{choices:[{message:{tool_calls:[{id:'fixture',type:'function',function:{name:'actual_content',arguments:JSON.stringify({content})}}]},finish_reason:'tool_calls'}]}});
  });
  await page.goto('/');
  const story = await page.evaluate(async () => {
    const paths = ['/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts',
      '/src/tests/fixtures/game.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts',
      '/src/services/storage/worldbookLibrary.ts','/src/domain/worldbook/mainWorldbook.ts'];
    const [{StoryStage},{SaveRepository},{createTurnDraft},{game},{defaultSettings},{newChannel,defaultAiConfig},{CredentialVault},
      {WorldbookLibrary},{officialIds}] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(), opened = await WorldbookLibrary.open();
    if (!opened.ok) throw Error('书库打开失败');
    const lib = opened.library;
    try {
      await Promise.all(officialIds.map((id:string) => lib.setOfficial(id,false)));
      const blank = await lib.createBook('月港');
      const id = blank.release.bookId;
      await lib.reviseBook(id,{purpose:'main',add:[{entryId:'tidal',constant:true,content:'月港潮历 {{user}}'},
        {entryId:'wharf',keys:['码头'],content:'码头有七盏航灯。'}]},{baseVersionId:blank.release.versionId});
      await lib.setEnabled(id,true);
      const state = await repo.create(game('main-book-wave'));
      const draft = createTurnDraft(state.saveId,state.revision,'wave-main','opening','去码头看看');
      await repo.saveDraft(draft,null);
      const config = defaultAiConfig(), channel = newChannel('openai');
      channel.baseUrl = 'https://worldbook.mock.invalid/v1'; channel.defaultModel = 'fixture';
      config.channels = [channel]; config.routes.story = {channelId:channel.id,modelId:'fixture'};
      const vault = new CredentialVault(sessionStorage,localStorage); vault.set(channel.id,'synthetic-key');
      const settings = defaultSettings(); settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 5; settings.runtime.streamStory = false;
      const accepted = await new StoryStage(repo).generate({draft,settings,config,vault});
      return accepted.story.narrative;
    } finally { repo.close(); lib.close(); }
  });
  expect(story).toBe('林舟在月港停下脚步。');
  expect(bodies).toHaveLength(1);
  const body = bodies[0], wire = JSON.stringify(body);
  expect(body.tools).toBeDefined();
  expect(wire).not.toMatch(/中国城市与地域差异|现实身份、制度与社会边界/);
  for (const text of ['月港潮历 {{user}}','码头有七盏航灯。']) {
    expect(wire.split(text)).toHaveLength(2);
    expect(body.messages.find(m => m.content.includes(text))?.role).toBe('user');
  }
  await info.attach('literary-wire.json',{body:JSON.stringify(body),contentType:'application/json'});
});
