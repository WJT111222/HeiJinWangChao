import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { selected } from './helpers/select';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://list-browser.mock.invalid/v1';
    channel.defaultModel = 'kept-model'; channel.name = '列表兼容测试'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'kept-route' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'browser-list-secret');
  });
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
}

test('同源候选与分页真实接入共享缓存；数量可核对，Unicode模型可保存', async ({ page }) => {
  let calls = 0, release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  const urls: string[] = [], ids = ['厂商/模型 (线路A)+', 'alpha', 'alpha', 42, 'beta'];
  await page.route('https://list-browser.mock.invalid/**', async (route) => {
    expect(route.request().method()).toBe('GET'); urls.push(route.request().url()); calls++;
    if (calls === 1) await pending;
    const url = new URL(route.request().url());
    if (url.pathname === '/models') { await route.fulfill({ status: 404, json: { error: 'not found' } }); return; }
    const body = url.searchParams.has('after') ? { data: ['beta', 'gamma', 'alpha'].map((id) => ({ id })), has_more: false }
      : { data: ids.map((id) => ({ id })), has_more: true, last_id: 'beta' };
    await route.fulfill({ json: body });
  });
  await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '新增渠道', exact: true }).click();
  await page.getByLabel('API Base URL', { exact: true }).fill('https://list-browser.mock.invalid');
  await page.getByLabel('API 密钥', { exact: true }).fill('browser-list-secret');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  const group = page.getByRole('group', { name: '默认模型选择', exact: true }); await expect(group).toContainText('正在获取模型列表');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click(); expect(calls).toBe(1); release();
  await expect(group).toContainText('当前接口返回 4 个模型'); await expect(group).toContainText('可能不是该平台全部可用模型');
  await expect(group).toContainText('原始条目 8，有效 7，过滤 1，重复 3'); await expect(group).toContainText('读取 2 页');
  expect(urls).toEqual(['https://list-browser.mock.invalid/models', 'https://list-browser.mock.invalid/v1/models', 'https://list-browser.mock.invalid/v1/models?after=beta']);
  await page.getByRole('combobox', { name: '默认模型', exact: true }).click(); await page.getByRole('combobox', { name: '搜索默认模型', exact: true }).fill('线路');
  await page.getByRole('option', { name: '厂商/模型 (线路A)+', exact: true }).click(); await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  expect(calls).toBe(3); await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await selected(page, '默认模型', '厂商/模型 (线路A)+'); await expect(page.getByRole('dialog')).not.toContainText('browser-list-secret');
});

for (const kind of ['authorization', 'missing', 'network', 'format', 'json', 'empty'] as const) {
  test(`列表错误分类${kind}：保留默认模型、路由、凭证与手填能力`, async ({ page }) => {
    let calls = 0;
    await page.route('https://list-browser.mock.invalid/**', async (route) => {
      calls++; expect(route.request().method()).toBe('GET');
      if (kind === 'network') { await route.abort('failed'); return; }
      if (kind === 'json') { await route.fulfill({ contentType: 'text/html', body: '<html>browser-list-secret hidden</html>' }); return; }
      await route.fulfill(kind === 'authorization' ? { status: 401, json: { error: 'browser-list-secret hidden' } }
        : kind === 'missing' ? { status: 404, json: { error: 'browser-list-secret hidden' } }
          : kind === 'format' ? { json: { result: 'browser-list-secret hidden' } } : { json: { data: [] } });
    });
    await seed(page);
    const before = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), key: JSON.stringify(sessionStorage) }));
    await page.getByRole('button', { name: '刷新默认模型', exact: true }).click();
    const group = page.getByRole('group', { name: '默认模型选择', exact: true });
    const labels = { authorization: '授权错误', missing: '模型列表接口不存在或路径不受支持（404）', network: 'CORS', format: '模型列表返回格式不受支持', json: '响应不是完整合法的 JSON', empty: '请求成功，服务未返回可用模型' };
    await expect(group).toContainText(labels[kind]);
    await expect(group.getByLabel('默认模型 ID', { exact: true })).toHaveValue('kept-model'); await selected(page, '正文生成模型', 'kept-route');
    expect(await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), key: JSON.stringify(sessionStorage) }))).toEqual(before);
    await expect(page.getByRole('dialog')).not.toContainText('browser-list-secret'); await expect(page.getByRole('dialog')).not.toContainText('hidden');
    expect(calls).toBe(kind === 'authorization' || kind === 'empty' ? 1 : 2);
  });
}

test('完整models地址只用于列表兼容，显示真实脱敏端点与HTTP状态，不伪称生成配置已修复', async ({ page }) => {
  const urls: string[] = [];
  await page.route('https://list-browser.mock.invalid/**', async (route) => {
    expect(route.request().method()).toBe('GET'); urls.push(route.request().url());
    await route.fulfill({ json: { data: [{ id: 'kept-model' }] } });
  });
  await seed(page); await page.getByLabel('API Base URL', { exact: true }).fill('https://list-browser.mock.invalid/v1/models///');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  const group = page.getByRole('group', { name: '默认模型选择', exact: true });
  await expect(group).toContainText('列表端点 https://list-browser.mock.invalid/v1/models，HTTP 200');
  await expect(group).toContainText('生成请求仍使用原配置');
  expect(urls).toEqual(['https://list-browser.mock.invalid/v1/models']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels[0].baseUrl)).toBe('https://list-browser.mock.invalid/v1/models///');
  await selected(page, '默认模型', 'kept-model'); await selected(page, '正文生成模型', 'kept-route');
});
