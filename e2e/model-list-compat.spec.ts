import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { selected } from './helpers/select';
import { addChannel, backToList, openAiSettings, openChannel, saveAi, setUrl, stageModel } from './helpers/aiSettings';

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
  await page.reload(); const settings = await openAiSettings(page); await openChannel(settings, '列表兼容测试'); return settings;
}
async function fetchModels(settings: Awaited<ReturnType<typeof seed>>) {
  await settings.locator('.ai-connect').getByRole('button', { name: '获取模型', exact: true }).click();
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
  await page.goto('/'); const settings = await openAiSettings(page);
  await addChannel(settings, { preset: 'OpenAI 兼容', name: '列表兼容测试', url: 'https://list-browser.mock.invalid', key: 'browser-list-secret' });
  // 填好地址和密钥后自动获取（只读列表，不产生费用）；获取中不会重复请求。
  const box = settings.locator('.ai-connect'); await expect(box).toContainText('正在连接');
  await page.waitForTimeout(800); expect(calls).toBe(1); release();
  await expect(box).toContainText('当前接口返回 4 个模型'); await expect(box).toContainText('可能不是该平台全部可用模型');
  await expect(box).toContainText('原始条目 8，有效 7，过滤 1，重复 3'); await expect(box).toContainText('读取 2 页');
  expect(urls).toEqual(['https://list-browser.mock.invalid/models', 'https://list-browser.mock.invalid/v1/models', 'https://list-browser.mock.invalid/v1/models?after=beta']);
  await stageModel(settings, '正文生成', '列表兼容测试', '厂商/模型 (线路A)+', 'list'); await saveAi(settings);
  expect(calls).toBe(3); await page.reload(); const again = await openAiSettings(page); await backToList(again);
  await selected(page, '正文生成模型', '厂商/模型 (线路A)+'); await expect(again).not.toContainText('browser-list-secret');
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
    const settings = await seed(page);
    const before = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), key: JSON.stringify(sessionStorage) }));
    // 打开设置不联网；点「获取模型」才读取列表。失败只影响列表，不动配置。
    expect(calls).toBe(0); await fetchModels(settings);
    const box = settings.locator('.ai-connect');
    const labels = { authorization: '授权错误', missing: '模型列表接口不存在或路径不受支持（404）', network: 'CORS', format: '模型列表返回格式不受支持', json: '响应不是完整合法的 JSON', empty: '请求成功，服务未返回可用模型' };
    await expect(box).toContainText(labels[kind]);
    await expect(box).toContainText(kind === 'empty' ? '连接正常' : '连接失败');
    await backToList(settings); await selected(page, '正文生成模型', 'kept-route');
    await expect(settings.getByRole('button', { name: '列表里没有？手动填写正文生成模型 ID', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), key: JSON.stringify(sessionStorage) }))).toEqual(before);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels[0].defaultModel)).toBe('kept-model');
    await expect(settings).not.toContainText('browser-list-secret'); await expect(settings).not.toContainText('hidden');
    expect(calls).toBe(kind === 'authorization' || kind === 'empty' ? 1 : 2);
  });
}

test('完整models地址只用于列表兼容，显示真实脱敏端点与HTTP状态，不伪称生成配置已修复', async ({ page }) => {
  const urls: string[] = [];
  await page.route('https://list-browser.mock.invalid/**', async (route) => {
    expect(route.request().method()).toBe('GET'); urls.push(route.request().url());
    await route.fulfill({ json: { data: [{ id: 'kept-model' }] } });
  });
  const settings = await seed(page); expect(urls).toHaveLength(0);
  await setUrl(settings, 'https://list-browser.mock.invalid/v1/models///');
  const box = settings.locator('.ai-connect');
  await expect(box).toContainText('列表端点 https://list-browser.mock.invalid/v1/models，HTTP 200');
  await expect(box).toContainText('生成请求仍使用原配置');
  expect(urls).toEqual(['https://list-browser.mock.invalid/v1/models']); // 改地址后自动读取一次
  await saveAi(settings);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels[0].baseUrl)).toBe('https://list-browser.mock.invalid/v1/models///');
  await backToList(settings); await selected(page, '正文生成模型', 'kept-route');
});
