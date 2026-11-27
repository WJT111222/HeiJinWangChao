import { test, expect } from './helpers/test';
import type { Page, Locator } from '@playwright/test';
import { seedMobileArchives, storedArchives, openArchive } from './helpers/mobileArchives';
import { openAiSettings, saveAi, settingsCategory } from './helpers/aiSettings';
import fixture from './fixtures/peinture-game.json' with { type: 'json' };

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const screenshot = (page: Page, name: string) => page.screenshot({
  path: test.info().outputPath(name + '.jpg'), type: 'jpeg', quality: 82, scale: 'css', animations: 'disabled',
});
function textContrast(color: string, background: string) {
  const luminance = (rgb: string) => (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).reduce((sum, value, i) => {
    const c = Number(value) / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  }, 0);
  const a = luminance(color), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

// Sample Chromium's painted background, including translucent fills and the map grid.
// Text is transparent only in the measurement screenshot.
async function expectReadable(target: Locator, label: string) {
  const color = await target.evaluate(el => getComputedStyle(el).color);
  const pixels = await target.screenshot({ scale: 'css', animations: 'disabled',
    style: '.history-reading, .history-reading * { -webkit-text-fill-color: transparent; text-shadow: none; }' });
  const backgrounds = await target.page().evaluate(async base64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    // Sample the interior, excluding the control border and focus outline.
    const x = Math.floor(img.width / 4), y = Math.floor(img.height / 3);
    const { data } = ctx.getImageData(x, y, Math.max(1, Math.floor(img.width / 2)), Math.max(1, Math.floor(img.height / 3)));
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) colors.add(`rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`);
    return [...colors];
  }, pixels.toString('base64'));
  const worst = backgrounds.map(bg => ({ bg, ratio: textContrast(color, bg) })).sort((a, b) => a.ratio - b.ratio)[0];
  console.log(label, color, worst.bg, worst.ratio.toFixed(2));
  expect.soft(worst.ratio, label).toBeGreaterThanOrEqual(4.5);
}

async function sealEvidence(dialog: Locator, name: string) {
  const seal = dialog.locator('.modal-heading > .dialog-seal');
  await expect(seal).toBeVisible();
  console.log(name, await seal.evaluate(el => ({ color: getComputedStyle(el).color, box: el.getBoundingClientRect().toJSON() })));
  await seal.screenshot({ path: test.info().outputPath(name + '.png'), scale: 'css' });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function setup(page: Page, theme: string) {
  let posts = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') { posts++; return route.abort(); }
    if (url.hostname === 'peinture.mock.invalid') return route.fulfill({ json: { data: [{ id: 'fixture' }, { id: 'other-model' }] } });
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await seedMobileArchives(page, 4);
  await page.evaluate(({ theme, config }) => {
    const key = 'heijin.settings.v1', settings = JSON.parse(localStorage.getItem(key)!);
    settings.display.appearance = theme;
    localStorage.setItem(key, JSON.stringify(settings));
    localStorage.setItem('heijin.ai.v1', JSON.stringify(config));
    sessionStorage.setItem('heijin.credential.v1:fixture-channel', 'synthetic');
  }, { theme, config: fixture.config });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
  return () => expect(posts).toBe(0);
}

for (const theme of ['day', 'night']) {
  test('路由实际命中及保存、风格跨列与断点 ' + theme, async ({ page, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 360, height: 640 } : { width: 901, height: 600 });
    const noPosts = await setup(page, theme);
    const settings = await openAiSettings(page);
    await settingsCategory(page,'模型分配');
    const model = settings.getByRole('combobox', { name: '正文生成模型', exact: true });
    for (const width of isMobile ? [360, 900] : [1440, 1024, 901]) {
      await page.setViewportSize({ width, height: width < 1100 ? 600 : 900 });
      await model.scrollIntoViewIfNeeded();
      const modelWidth = (await model.boundingBox())!.width;
      expect(modelWidth).toBeGreaterThan(75);
      await model.click();
      await expect(page.getByRole('listbox').getByRole('option', { name: 'other-model', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await fits(page);
      if (width === 901) {
        const bar = settings.locator('.ai-save-bar'), editor = settings.locator('.settings-content');
        const height = (await bar.boundingBox())!.height, pane = (await editor.boundingBox())!.height;
        expect(height / pane).toBeLessThan(.35);
        console.log('AI editor', theme, { modelWidth, height, pane });
        await screenshot(page, 'model-and-footer');
      }
    }
    await model.click();
    await page.getByRole('option', { name: 'other-model', exact: true }).click();
    await saveAi(settings);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).routes.story.modelId)).toBe('other-model');
    await settingsCategory(page, '正文与风格');
    for (const width of isMobile ? [900, 360] : [1199, 1200, 1440]) {
      await page.setViewportSize({ width, height: isMobile ? 640 : 900 });
      const radios = settings.getByRole('radiogroup', { name: '剧情风格' });
      await expect(radios.getByRole('radio')).toHaveCount(7);
      const field = (await radios.boundingBox())!.width, form = (await settings.locator('.settings-fields').boundingBox())!.width;
      expect(field).toBeGreaterThan(form * .95);
      await radios.scrollIntoViewIfNeeded();
      console.log('style', theme, width, field, form);
      await fits(page);
    }
    const radio = settings.getByRole('radiogroup', { name: '剧情风格' }).getByRole('radio').nth(2);
    await radio.check();
    await expect(settings.locator(isMobile ? '.style-item-desc' : '.style-explain')).toBeVisible();
    await screenshot(page, 'style');
    await button(settings, '保存本地设置').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!).prompts.style)).toBe(await radio.inputValue());
    noPosts();
  });

  test('预设编辑区与保存栏独立操作 ' + theme, async ({ page, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 360, height: 640 } : { width: 901, height: 600 });
    const noPosts = await setup(page, theme);
    await page.evaluate(() => localStorage.setItem('heijin.story-presets.v1', JSON.stringify({ enabled: true, selected: 'peinture-1118', packages: {} })));
    await page.reload();
    await button(page, '设置').first().click();
    await settingsCategory(page, '文学预设');
    await button(page.getByRole('dialog', { name: '设置', exact: true }), '王朝预设设置').click();
    const panel = page.getByRole('dialog', { name: '王朝预设设置' });
    await panel.getByRole('navigation').getByRole('button').filter({ has: page.getByText('自定义', { exact: true }) }).click();
    const field = panel.locator('textarea').last();
    await field.click();
    if (isMobile) await page.setViewportSize({ width: 360, height: 320 });
    const content = panel.locator('.peinture-content'), footer = panel.locator('.peinture-footer');
    await field.click();
    await field.fill('首行\n末行');
    await field.press('Control+End');
    await field.press('!');
    expect(await field.inputValue()).toBe('首行\n末行!');
    const c = (await content.boundingBox())!, f = (await footer.boundingBox())!;
    expect(c.height).toBeGreaterThan(70);
    expect(c.y + c.height).toBeLessThanOrEqual(f.y + 1);
    console.log('preset', theme, c, f);
    await screenshot(page, 'preset-edit');
    await button(panel, '保存调整').click();
    await expect(button(panel, '保存调整')).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('heijin.story-presets.v1'))).toContain('末行!');
    await fits(page);
    noPosts();
  });

  test('历史地图人物、同刻纪事及纸面地图配色 ' + theme, async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
    const noPosts = await setup(page, theme);
    const original = await storedArchives(page);
    if (isMobile) {
      const map = await openArchive(page, '地图');
      const input = map.getByPlaceholder('按地点名称查找');
      await input.click();
      await input.fill('重庆');
      await expect(map.getByLabel('地点搜索结果')).toBeVisible();
      await input.fill('');
      const pairs = await map.evaluate(el => {
        const field = el.querySelector('input')!, box = el.querySelector('.mobile-map-box')!, zone = el.querySelector('.map-zone')!;
        return [
          [getComputedStyle(field, '::placeholder').color, getComputedStyle(field).backgroundColor],
          [getComputedStyle(box.querySelector('small')!).color, getComputedStyle(box).backgroundColor],
          // The translucent zone card is lighter than this underlying paper.
          [getComputedStyle(zone.querySelector('small')!).color, getComputedStyle(box).backgroundColor],
        ];
      });
      for (const [fg, bg] of pairs) expect(textContrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      console.log('map contrast', theme, pairs.map(([fg, bg]) => textContrast(fg, bg)));
      await sealEvidence(map, 'archive-seal');
      await screenshot(page, 'map-archive');
      await page.keyboard.press('Escape');
    }
    await page.evaluate(async () => {
      const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
      const repo = await SaveRepository.open();
      try { await repo.history.create('save-a', '布局验收'); } finally { repo.close(); }
    });
    await page.goto('/');
    if (!isMobile) await button(page, '存档馆').click();
    await button(page, '历史存档').click();
    const dialog = page.getByRole('dialog', { name: '历史存档' });
    await sealEvidence(dialog, 'history-seal');
    await screenshot(page, 'history-home');
    await button(dialog, '手动收藏').click();
    await dialog.getByRole('button', { name: /预览第/ }).click();
    const reading = dialog.getByRole('region', { name: '只读历史世界' });
    const nav = reading.getByRole('navigation', { name: '历史阅读内容' });
    for (const [title, selector] of [['NPC', '.npc-directory-tools'], ['势力组织', '.organization-directory-tools']]) {
      await button(nav, title).click();
      const tools = reading.locator(selector);
      await tools.scrollIntoViewIfNeeded();
      const pair = await tools.evaluate(el => [getComputedStyle(el.querySelector('label')!).color, getComputedStyle(el).backgroundColor]);
      const ratio = textContrast(pair[0], pair[1]);
      console.log(title, theme, pair, ratio);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      await screenshot(page, title === 'NPC' ? 'history-npc-filter' : 'history-org-filter');
    }
    await button(nav, '地图').click();
    const river = reading.locator('.river');
    await expect(river).toHaveCSS('position', 'absolute');
    await expect(river.locator('path').first()).toHaveCSS('fill', 'none');
    await expect(river.locator('path').first()).not.toHaveCSS('stroke', 'none');
    await reading.locator('.mobile-map-box').scrollIntoViewIfNeeded();
    await screenshot(page, 'history-map');
    const place = reading.getByRole('region', { name: '地点详情' });
    const selectedZone = reading.locator('.map-zone[aria-pressed=true] strong');
    const placeName = place.locator('.pc-title h3');
    await expect(placeName).toHaveText(await selectedZone.innerText());
    await expectReadable(selectedZone, '选中地点');
    await expectReadable(placeName, '地点名称');
    await expectReadable(place.locator('.pc-title .lv'), '地点层级');
    await expectReadable(place.locator('.derived-note'), '地点说明');
    await expectReadable(place.locator('.pc-crumb button').first(), '地点路径按钮');
    await placeName.scrollIntoViewIfNeeded();
    await screenshot(page, 'place-detail');
    const person = reading.getByRole('region', { name: '此地人物', exact: true }).getByRole('button').first();
    const name = await person.innerText();
    await person.click();
    await expect(button(nav, 'NPC')).toHaveAttribute('aria-current', 'true');
    const title = reading.getByRole('heading', { name, exact: true });
    await expect(title).toBeVisible();
    await title.scrollIntoViewIfNeeded();
    const detail = reading.getByRole('region', { name: '人物详情' });
    await expectReadable(title, '人物姓名');
    await expectReadable(detail.locator('.npc-detail-heading .tag'), '人物身份标记');
    await expectReadable(detail.locator('.npc-detail-heading .avatar'), '人物姓名印记');
    await expectReadable(detail.locator('[data-npc-section=profile] h4'), '人物档案标题');
    await expectReadable(detail.locator('dd').first(), '人物资料值');
    await title.scrollIntoViewIfNeeded();
    await screenshot(page, 'history-map-person');
    await button(nav, '历史时间轴').click();
    const side = reading.locator('.history-slot:has([data-history-id="hero-opening"]) .history-side.history-world');
    const cards = side.locator('[data-history-id]');
    await expect(cards).toHaveCount(3);
    const boxes = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom - 1);
    expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[1].bottom - 1);
    await side.scrollIntoViewIfNeeded();
    await screenshot(page, 'timeline');
    await cards.nth(1).click();
    await expect(button(reading, '返回时间轴')).toBeVisible();
    await fits(page);
    expect(await storedArchives(page)).toEqual(original);
    noPosts();
  });
}

test('首页独立设置窗口在断点两侧都完整使用表单宽度', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { defaultSettings, settingsKey } = await import(path);
    const settings = defaultSettings();
    settings.display.appearance = 'day';
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
  await button(page, '设置').first().click();
  await settingsCategory(page, '正文与风格');
  const field = page.getByRole('radiogroup', { name: '剧情风格' });
  for (const width of isMobile ? [900, 360] : [1199, 1200, 1440]) {
    await page.setViewportSize({ width, height: width >= 1200 ? 900 : 720 });
    await field.scrollIntoViewIfNeeded();
    const formWidth = (await page.locator('.settings-fields').boundingBox())!.width;
    const widthUsed = (await field.boundingBox())!.width;
    expect(widthUsed).toBeGreaterThan(formWidth * .95);
    console.log('home style', width, widthUsed, formWidth);
    await fits(page);
  }
  await screenshot(page, 'home-style');
});
