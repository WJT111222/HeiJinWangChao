import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { choose, selected } from './helpers/select';

async function open(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog');
}
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
  await page.reload(); await open(page); return ids;
}
async function searchChoose(page: Page, label: string, keyword: string, model: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: `搜索${label}`, exact: true }).fill(keyword);
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: model, exact: true }).click();
}

test('保存后自动GET、输入时不请求、四阶段独立搜索选择及共享列表刷新', async ({ page }) => {
  let lists = 0, generated = 0, release!: () => void;
  const initialResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://city.mock.invalid/**', async (route) => {
    if (route.request().method() !== 'GET') { generated++; await route.abort(); return; }
    lists++; if (lists === 1) await initialResponse; await route.fulfill({ json: { data: ['city-default', 'city-story', 'city-variables', 'city-world', 'city-memory'].map((id) => ({ id })) } });
  });
  await page.goto('/'); await open(page); await page.getByRole('button', { name: '新增渠道', exact: true }).click();
  await page.getByLabel('渠道名称', { exact: true }).fill('都市渠道');
  await page.getByLabel('API Base URL', { exact: true }).fill('https://city.mock.invalid/v1');
  await page.getByLabel('API 密钥', { exact: true }).pressSequentially('ui-mock-secret', { delay: 5 });
  expect(lists).toBe(0); await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('正在获取模型列表');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); expect(lists).toBe(1); release();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('已获取 5 个模型'); expect(lists).toBe(1);
  await searchChoose(page, '默认模型', 'default', 'city-default');
  const id = await page.getByRole('combobox', { name: '当前渠道', exact: true }).getAttribute('value'); expect(id).toBeTruthy();
  for (const [label, model] of [['正文生成', 'city-story'], ['变量管理', 'city-variables'], ['动态世界', 'city-world'], ['记忆维护', 'city-memory']]) {
    if (label !== '正文生成') await page.getByLabel(`${label}跟随正文模型`, { exact: true }).uncheck();
    await choose(page, `${label}渠道`, id!); await searchChoose(page, `${label}模型`, model.split('-')[1], model);
  }
  expect(lists).toBe(1); await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); expect(lists).toBe(1);
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!));
  expect(Object.values(config.routes).map((route) => (route as { modelId: string }).modelId)).toEqual(['city-story', 'city-variables', 'city-world', 'city-memory']);
  for (const label of ['正文生成', '变量管理', '动态世界', '记忆维护']) {
    await page.getByRole('button', { name: `刷新${label}模型`, exact: true }).click();
    await expect(page.getByRole('group', { name: `${label}模型选择`, exact: true })).toContainText('已获取 5 个模型');
  }
  expect(lists).toBe(5); expect(generated).toBe(0);
  await page.reload(); await open(page);
  await selected(page, '变量管理模型', 'city-variables'); await selected(page, '动态世界模型', 'city-world'); await selected(page, '记忆维护模型', 'city-memory');
});

test('旧配置恢复、渠道切换清除旧路由模型、默认与跟随显示真实继承，刷新失败保留配置', async ({ page }) => {
  let fail = false, city = 0, backup = 0;
  await page.route('https://city.mock.invalid/**', async (route) => { city++; await route.fulfill({ json: { data: [{ id: 'city-default' }, { id: 'legacy-story' }] } }); });
  await page.route('https://backup.mock.invalid/**', async (route) => {
    backup++; await route.fulfill(fail ? { status: 404, json: { error: 'ui-mock-secret-b hidden-server-detail' } } : { json: { data: [{ id: 'backup-default' }, { id: 'backup-custom' }] } });
  });
  const ids = await seed(page); await selected(page, '正文生成模型', 'legacy-story');
  await expect(page.getByText('继承正文：都市渠道 / legacy-story', { exact: true })).toHaveCount(3);
  await choose(page, '正文生成渠道', ids[1]); await selected(page, '正文生成模型', '');
  await expect(page.getByText('继承正文：备用渠道 / backup-default', { exact: true })).toHaveCount(3);
  await searchChoose(page, '正文生成模型', 'custom', 'backup-custom');
  await expect(page.getByText('继承正文：备用渠道 / backup-custom', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('已获取');
  const before = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }));
  fail = true; await page.getByRole('button', { name: '刷新正文生成模型', exact: true }).click();
  await expect(page.getByRole('group', { name: '正文生成模型选择', exact: true })).toContainText('手动填写');
  await selected(page, '正文生成模型', 'backup-custom'); await optionContains(page, '正文生成模型', 'backup-default');
  expect(await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }))).toEqual(before);
  await expect(page.getByRole('dialog')).not.toContainText('hidden-server-detail'); expect(city).toBe(1); expect(backup).toBe(2);
});
async function optionContains(page: Page, label: string, text: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: text, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
}

test('列表空/失败可以手填，重试不清空默认模型、路由和密钥', async ({ page }) => {
  let calls = 0, mode = 'empty';
  await page.route('https://city.mock.invalid/**', async (route) => {
    calls++; await route.fulfill(mode === 'fail' ? { status: 503, json: { error: 'private detail' } } : { json: { data: [] } });
  });
  await seed(page); await page.getByRole('button', { name: '刷新默认模型', exact: true }).click();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('服务未返回可用模型');
  await page.getByLabel('默认模型 ID', { exact: true }).fill('manual-restored');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); expect(calls).toBe(1);
  mode = 'fail'; await page.getByRole('button', { name: '刷新默认模型', exact: true }).click();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('暂时不可用');
  await expect(page.getByLabel('默认模型 ID', { exact: true })).toHaveValue('manual-restored');
  await selected(page, '正文生成模型', 'legacy-story');
  const saved = await page.evaluate(() => localStorage.getItem('heijin.ai.v1'));
  mode = 'empty'; await page.getByRole('button', { name: '刷新默认模型', exact: true }).click();
  await expect(page.getByRole('group', { name: '默认模型选择', exact: true })).toContainText('服务未返回可用模型');
  expect(await page.evaluate(() => localStorage.getItem('heijin.ai.v1'))).toBe(saved); expect(calls).toBe(3);
});

test('主题浮层的搜索、键盘、Escape、Tab与窄屏内部滚动', async ({ page }, testInfo) => {
  await page.route('https://city.mock.invalid/**', (route) => route.fulfill({ json: { data: Array.from({ length: 60 }, (_, i) => ({ id: `city-model-${String(i).padStart(2, '0')}` })) } }));
  await seed(page); const dialog = page.getByRole('dialog');
  const protocol = page.getByRole('combobox', { name: '协议', exact: true }); await protocol.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: '协议', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(protocol).toBeFocused(); await expect(dialog).toBeVisible();
  await page.getByRole('combobox', { name: '默认模型', exact: true }).click();
  const search = page.getByRole('combobox', { name: '搜索默认模型', exact: true }); await expect(search).toBeFocused(); await search.fill('model-37');
  await expect(page.getByRole('listbox', { name: '默认模型', exact: true }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await selected(page, '默认模型', 'city-model-37');
  await page.getByRole('combobox', { name: '默认模型', exact: true }).click(); await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox', { name: '默认模型', exact: true })).not.toBeVisible(); await expect(dialog).toBeVisible();
  await page.getByRole('combobox', { name: '默认模型', exact: true }).click();
  const list = page.getByRole('listbox', { name: '默认模型', exact: true });
  await expect(list.getByRole('option')).toHaveCount(61);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('End'); await expect(list.getByRole('option', { name: 'city-model-59', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const popup = page.locator('.select-popup'); const box = await popup.boundingBox(); expect(box).not.toBeNull();
  const viewport = page.viewportSize()!; expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  const path = testInfo.outputPath(`ai-model-selection-${testInfo.project.name}.png`);
  await page.screenshot({ path }); await testInfo.attach('主题化模型选择与窄屏布局', { path, contentType: 'image/png' });
});
