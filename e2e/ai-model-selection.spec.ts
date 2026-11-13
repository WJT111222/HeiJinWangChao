import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { choose, selected } from './helpers/select';
import { addChannel, backToList, openAiSettings, openChannel, saveAi, stageModel } from './helpers/aiSettings';

async function seed(page: Page) {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const configPath = '/src/services/ai/configuration.ts', keyPath = '/src/services/ai/credentials.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(keyPath);
    const config = defaultAiConfig(), a = newChannel(), b = newChannel();
    a.name = '都市渠道'; a.defaultModel = 'city-default'; a.baseUrl = 'https://city.mock.invalid/v1';
    b.name = '备用渠道'; b.defaultModel = 'backup-default'; b.baseUrl = 'https://backup.mock.invalid/v1';
    config.channels = [a, b]; config.routes.story = { channelId: a.id, modelId: 'legacy-story' };
    saveAiConfig(localStorage, config); const vault = new CredentialVault(sessionStorage, localStorage);
    vault.set(a.id, 'ui-mock-secret-a'); vault.set(b.id, 'ui-mock-secret-b'); return [a.id, b.id];
  });
  await page.reload(); const settings = await openAiSettings(page); return { ids, settings };
}
async function searchChoose(page: Page, label: string, keyword: string, model: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: `搜索${label}`, exact: true }).fill(keyword);
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: model, exact: true }).click();
}
async function optionContains(page: Page, label: string, text: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: text, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
}
const storedConfig = (page: Page) => page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) + JSON.stringify(Object.keys(localStorage)) }));

test('填好密钥后自动获取一次、四阶段分别选择、只有被点的刷新按钮转动', async ({ page }) => {
  let lists = 0, generated = 0, gate: Promise<void> | undefined, release = () => {};
  const hold = () => { gate = new Promise<void>((resolve) => { release = resolve; }); };
  await page.route('https://city.mock.invalid/**', async (route) => {
    if (route.request().method() !== 'GET') { generated++; await route.abort(); return; }
    lists++; if (gate) await gate;
    await route.fulfill({ json: { data: ['city-default', 'city-story', 'city-variables', 'city-world', 'city-memory'].map((id) => ({ id })) } });
  });
  await page.goto('/'); const settings = await openAiSettings(page);
  hold();
  await addChannel(settings, { preset: 'OpenAI 兼容', name: '都市渠道', url: 'https://city.mock.invalid/v1' });
  await settings.getByLabel('API 密钥', { exact: true }).pressSequentially('ui-mock-secret', { delay: 5 });
  // 输入过程中不请求；停下后自动获取一次，自动获取不让任何阶段的刷新按钮转动。
  expect(lists).toBe(0);
  await expect(settings.locator('.ai-connect')).toContainText('正在连接');
  expect(lists).toBe(1);
  await expect(settings.locator('.ai-refresh.is-spinning')).toHaveCount(0);
  release(); gate = undefined;
  await expect(settings.locator('.ai-connect')).toContainText('当前接口返回 5 个模型');
  for (const [label, model] of [['正文生成', 'city-story'], ['变量管理', 'city-variables'], ['动态世界', 'city-world'], ['记忆维护', 'city-memory']]) {
    await stageModel(settings, label, '都市渠道', model, 'list');
  }
  expect(lists).toBe(1);
  await saveAi(settings); expect(lists).toBe(1);
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!));
  expect(Object.values(config.routes).map((route) => (route as { modelId: string }).modelId)).toEqual(['city-story', 'city-variables', 'city-world', 'city-memory']);
  // 点哪个阶段的刷新，只有那个按钮转。
  for (const [index, label] of ['正文生成', '变量管理', '动态世界', '记忆维护'].entries()) {
    hold();
    await settings.getByRole('button', { name: `刷新${label}模型`, exact: true }).click();
    await expect.poll(() => lists).toBe(index + 2);
    await expect(settings.locator('.ai-refresh.is-spinning')).toHaveCount(1);
    await expect(settings.getByRole('button', { name: `刷新${label}模型`, exact: true })).toHaveClass(/is-spinning/);
    release(); gate = undefined;
    await expect(settings.locator('.ai-refresh.is-spinning')).toHaveCount(0);
  }
  expect(lists).toBe(5); expect(generated).toBe(0);
  await page.reload(); await openAiSettings(page);
  await selected(page, '正文生成模型', 'city-story'); await selected(page, '变量管理模型', 'city-variables');
  await selected(page, '动态世界模型', 'city-world'); await selected(page, '记忆维护模型', 'city-memory');
});

test('旧配置恢复、换渠道清除旧模型、跟随显示真实继承，刷新失败保留配置和已有列表', async ({ page }) => {
  let fail = false, city = 0, backup = 0;
  await page.route('https://city.mock.invalid/**', async (route) => { city++; await route.fulfill({ json: { data: [{ id: 'city-default' }, { id: 'legacy-story' }] } }); });
  await page.route('https://backup.mock.invalid/**', async (route) => {
    backup++; await route.fulfill(fail ? { status: 404, json: { error: 'ui-mock-secret-b hidden-server-detail' } } : { json: { data: [{ id: 'backup-default' }, { id: 'backup-custom' }] } });
  });
  const { ids, settings } = await seed(page);
  await backToList(settings);
  await selected(page, '正文生成模型', 'legacy-story');
  await expect(settings.getByText('同正文 · 都市渠道 / legacy-story', { exact: true })).toHaveCount(3);
  await choose(page, '正文生成渠道', ids[1]);
  // 换渠道后旧模型不再沿用，显示新渠道的默认模型。
  await selected(page, '正文生成模型', 'backup-default');
  await expect(settings.getByText('同正文 · 备用渠道 / backup-default', { exact: true })).toHaveCount(3);
  await expect.poll(() => backup).toBe(1);
  await searchChoose(page, '正文生成模型', 'custom', 'backup-custom');
  await expect(settings.getByText('同正文 · 备用渠道 / backup-custom', { exact: true })).toHaveCount(3);
  await saveAi(settings);
  const before = await storedConfig(page);
  fail = true; await settings.getByRole('button', { name: '刷新正文生成模型', exact: true }).click();
  await expect(settings.locator('.ai-route-foot').getByRole('status')).toContainText('本次获取失败');
  await selected(page, '正文生成模型', 'backup-custom'); await optionContains(page, '正文生成模型', 'backup-default');
  expect(await storedConfig(page)).toEqual(before);
  await expect(settings).not.toContainText('hidden-server-detail'); expect(city).toBe(0); expect(backup).toBe(3); // 404 时会再试一个同源列表端点。
});

test('列表为空或失败时可以手填，重试不清空模型、路由和密钥', async ({ page }) => {
  let calls = 0, mode = 'empty';
  await page.route('https://city.mock.invalid/**', async (route) => {
    calls++; await route.fulfill(mode === 'fail' ? { status: 503, json: { error: 'private detail' } } : { json: { data: [] } });
  });
  const { settings } = await seed(page);
  await openChannel(settings, '都市渠道');
  expect(calls).toBe(0); // 打开设置不联网
  await settings.getByRole('button', { name: '获取模型', exact: true }).click();
  await expect(settings.locator('.ai-connect')).toContainText('服务未返回可用模型');
  expect(calls).toBe(1);
  await stageModel(settings, '正文生成', '都市渠道', 'manual-restored');
  await saveAi(settings); expect(calls).toBe(1);
  mode = 'fail'; await settings.getByRole('button', { name: '刷新正文生成模型', exact: true }).click();
  await expect(settings.locator('.ai-route-foot').getByRole('status')).toContainText('本次获取失败');
  await expect(settings.getByLabel('正文生成模型 ID', { exact: true })).toHaveValue('manual-restored');
  await selected(page, '正文生成模型', 'manual-restored');
  const saved = await storedConfig(page);
  mode = 'empty'; await settings.getByRole('button', { name: '刷新正文生成模型', exact: true }).click();
  await expect.poll(() => calls).toBe(3);
  await expect(settings.locator('.ai-route-foot').getByRole('status')).toHaveCount(0);
  expect(await storedConfig(page)).toEqual(saved);
  await expect(settings).not.toContainText('private detail');
});

test('主题浮层的搜索、键盘、Escape、Tab与窄屏内部滚动', async ({ page }, testInfo) => {
  await page.route('https://city.mock.invalid/**', (route) => route.fulfill({ json: { data: Array.from({ length: 60 }, (_, i) => ({ id: `city-model-${String(i).padStart(2, '0')}` })) } }));
  const { settings } = await seed(page);
  await openChannel(settings, '都市渠道');
  await settings.getByRole('button', { name: '获取模型', exact: true }).click();
  await expect(settings.locator('.ai-connect')).toContainText('当前接口返回 60 个模型');
  const format = settings.getByRole('combobox', { name: '接口格式', exact: true }); await format.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: '接口格式', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(format).toBeFocused(); await expect(settings).toBeVisible();
  await backToList(settings);
  const model = settings.getByRole('combobox', { name: '正文生成模型', exact: true });
  await model.click();
  const search = page.getByRole('combobox', { name: '搜索正文生成模型', exact: true }); await expect(search).toBeFocused(); await search.fill('model-37');
  await expect(page.getByRole('listbox', { name: '正文生成模型', exact: true }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await selected(page, '正文生成模型', 'city-model-37');
  await model.click(); await page.keyboard.press('Tab');
  // 电脑端 Tab 离开即关闭浮层；手机端是底部弹窗，Tab 留在弹窗内，Escape 关闭。
  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('listbox', { name: '正文生成模型', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(model).toBeFocused();
  }
  await expect(page.getByRole('listbox', { name: '正文生成模型', exact: true })).not.toBeVisible(); await expect(settings).toBeVisible();
  await model.click();
  const list = page.getByRole('listbox', { name: '正文生成模型', exact: true });
  await expect(list.getByRole('option')).toHaveCount(60);
  // 长列表在浮层内部滚动（手机端滚动容器可能是列表外层）。
  expect(await list.evaluate((element) => {
    for (let node: Element | null = element; node && !node.matches('.ai-conn'); node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return true;
    }
    return false;
  })).toBe(true);
  await page.keyboard.press('End'); await expect(list.getByRole('option', { name: 'city-model-59', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const popup = page.locator('.select-popup'), viewport = page.viewportSize()!;
  // 手机底部弹窗有入场动画，等它停稳再量；允许亚像素误差。
  await expect.poll(async () => { const rect = (await popup.boundingBox())!; return rect.y + rect.height <= viewport.height + 1; }).toBe(true);
  const box = await popup.boundingBox(); expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  const path = testInfo.outputPath(`ai-model-selection-${testInfo.project.name}.png`);
  await page.screenshot({ path }); await testInfo.attach('主题化模型选择与窄屏布局', { path, contentType: 'image/png' });
});
