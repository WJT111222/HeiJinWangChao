import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { selected } from './helpers/select';
import { backToList, openAiSettings, openChannel, saveAi, stageModel } from './helpers/aiSettings';

async function seed(page: Page, protocol: string = 'openai', path = '/v1') {
  await page.goto('/');
  await page.evaluate(async ({ protocol, path }) => {
    const c = '/src/services/ai/configuration.ts', v = '/src/services/ai/credentials.ts';
    const { newChannel, defaultAiConfig, saveAiConfig } = await import(c), { CredentialVault } = await import(v);
    const channel = newChannel(protocol); channel.baseUrl = 'https://final-models.mock.invalid' + path; channel.defaultModel = 'saved-model';
    const config = defaultAiConfig(); config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'saved-route' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'browser-hardening-secret');
  }, { protocol, path });
  await page.reload(); const settings = await openAiSettings(page); await openChannel(settings, '新渠道');
  // 打开设置不联网，这里点「获取模型」读取一次；group 是渠道的连接状态（失败时“详细信息”里是完整诊断）。
  await settings.locator('.ai-connect').getByRole('button', { name: '获取模型', exact: true }).click();
  return { settings, group: settings.locator('.ai-connect'), refresh: () => settings.locator('.ai-connect').getByRole('button', { name: /获取模型$/ }).click() };
}
/** 正文生成仍是原来的模型，且下拉里还能看到之前成功获取的列表。 */
async function storyKept(page: Page, settings: ReturnType<Page['locator']>, model: string, option?: string) {
  await backToList(settings); await selected(page, '正文生成模型', model);
  if (option) {
    await page.getByRole('combobox', { name: '正文生成模型', exact: true }).click();
    await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  }
}
for (const protocol of ['openai', 'gemini', 'anthropic']) {
  test(`${protocol}完整Models仅规范列表，保留渠道与路由，提示生成仍需根路径`, async ({ page }) => {
    const urls: string[] = [];
    await page.route('https://final-models.mock.invalid/**', async (route) => {
      expect(route.request().method()).toBe('GET'); urls.push(route.request().url());
      await route.fulfill({ json: protocol === 'gemini' ? { models: [{ name: 'models/saved-model' }] } : { data: [{ id: 'saved-model' }] } });
    });
    const { settings, group } = await seed(page, protocol, protocol === 'gemini' ? '/v1beta/models///' : '/custom/v1/models///');
    const before = await page.evaluate(() => localStorage.getItem('heijin.ai.v1'));
    await expect(group).toContainText('当前接口返回 1 个模型'); await expect(group).toContainText('生成请求仍使用原配置');
    expect(urls).toHaveLength(1); const url = new URL(urls[0]); expect(url.pathname).not.toContain('models/models');
    if (protocol === 'anthropic') expect(url.searchParams.get('limit')).toBe('100');
    expect(await page.evaluate(() => localStorage.getItem('heijin.ai.v1'))).toBe(before); await storyKept(page, settings, 'saved-route');
  });
}
for (const failure of ['404', '401', 'network', 'format', 'pagination']) {
  test(`本次${failure}失败诊断与旧成功列表分开，既有选模和凭证不变`, async ({ page }) => {
    let mode = 'success', calls = 0;
    await page.route('https://final-models.mock.invalid/**', async (route) => {
      expect(route.request().method()).toBe('GET'); calls++;
      if (mode === 'network') { await route.abort('failed'); return; }
      if (mode === 'format') { await route.fulfill({ json: { private: 'browser-hardening-secret' } }); return; }
      if (mode === 'pagination') {
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        await route.fulfill(cursor ? { status: 503, json: { error: 'browser-hardening-secret' } } : { json: { data: [{ id: 'new-unaccepted' }], next_cursor: 'private-cursor' } }); return;
      }
      await route.fulfill(mode === 'success' ? { json: { data: [{ id: 'saved-model' }, { id: 'available' }] } }
        : { status: Number(mode), json: { error: 'browser-hardening-secret private-server-detail' } });
    });
    const { settings, group, refresh } = await seed(page); await expect(group).toContainText('当前接口返回 2 个模型');
    const before = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }));
    mode = failure; calls = 0; await refresh();
    await expect(group).toContainText('连接失败');
    await expect(group).toContainText('本次获取失败'); await expect(group).toContainText('最后尝试'); await expect(group).toContainText('非本次请求结果');
    if (failure === 'network') { await expect(group).toContainText('未获得 HTTP 状态'); await expect(group).toContainText('CORS'); }
    else await expect(group).toContainText(`HTTP ${failure === 'format' ? 200 : failure === 'pagination' ? 503 : failure}`);
    await expect(group).toContainText(`候选 ${failure === '401' || failure === 'pagination' ? 1 : 2}`);
    expect(calls).toBe(failure === '401' ? 1 : 2);
    await expect(settings).not.toContainText('browser-hardening-secret'); await expect(settings).not.toContainText('private-cursor');
    await storyKept(page, settings, 'saved-route', 'available');
    expect(await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }))).toEqual(before);
  });
}

test('官方结构的model字段真实选用，name-only不冒充模型', async ({ page }) => {
  let verified = true;
  await page.route('https://final-models.mock.invalid/**', (route) => route.fulfill({ json: verified
    ? { models: [{ name: '展示名并非标识', model: 'qwen3:latest', modified_at: '2026-10-24T00:00:00Z', size: 1, digest: 'sha256:known' }] }
    : { models: [{ name: '分组昵称', label: '平台档位' }] } }));
  const { settings, group, refresh } = await seed(page); await expect(group).toContainText('当前接口返回 1 个模型');
  await backToList(settings); await page.getByRole('combobox', { name: '正文生成模型', exact: true }).click();
  await expect(page.getByRole('option', { name: '展示名并非标识', exact: true })).toHaveCount(0); await page.keyboard.press('Escape');
  await stageModel(settings, '正文生成', '新渠道', 'qwen3:latest', 'list'); await saveAi(settings);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).routes.story.modelId)).toBe('qwen3:latest');
  verified = false; await openChannel(settings, '新渠道'); await refresh();
  await expect(group).toContainText('模型列表返回格式不受支持'); await storyKept(page, settings, 'qwen3:latest');
});

for (const failure of ['405', 'format', 'pagination-network']) {
  test(`最终复审${failure}：保留错误原因与最后端点状态明确分开`, async ({ page }) => {
    let failed = false, calls = 0;
    await page.route('https://final-models.mock.invalid/**', async (route) => {
      expect(route.request().method()).toBe('GET'); calls++;
      if (!failed) { await route.fulfill({ json: { data: [{ id: 'saved-model' }, { id: 'available' }] } }); return; }
      if (failure === 'pagination-network') {
        if (calls === 2) { await route.abort('failed'); return; }
        await route.fulfill({ json: { data: [{ id: 'partial' }], next_cursor: 'private-cursor' } }); return;
      }
      await route.fulfill(calls === 1 ? failure === '405' ? { status: 405, body: '' } : { json: { unsupported: true } } : { status: 404, body: '' });
    });
    const { settings, group, refresh } = await seed(page); await expect(group).toContainText('当前接口返回 2 个模型');
    const previous = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }));
    failed = true; calls = 0; await refresh(); await expect(group).toContainText('连接失败'); await expect(group).toContainText('本次获取失败');
    if (failure === 'pagination-network') {
      await expect(group).toContainText('最后端点状态：未获得 HTTP 状态'); await expect(group).not.toContainText('此前候选'); await expect(group).toContainText('已读取 1 页');
    } else {
      await expect(group).toContainText('保留的错误（可能来自此前候选）'); await expect(group).toContainText(failure === '405' ? '（405）' : '模型列表返回格式不受支持');
      await expect(group).toContainText('最后端点状态：HTTP 404'); await expect(group).not.toContainText('最后端点状态：HTTP 405');
    }
    expect(calls).toBe(2); await expect(group).toContainText('非本次请求结果'); await expect(group).not.toContainText('private-cursor');
    await storyKept(page, settings, 'saved-route', 'available');
    expect(await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1'), keys: JSON.stringify(sessionStorage) }))).toEqual(previous);
  });
}

test('编码路径令牌只在诊断中隐藏，实际Models请求不改', async ({ page }) => {
  let fail = false; const urls: string[] = [];
  await page.route('https://final-models.mock.invalid/**', async (route) => {
    expect(route.request().method()).toBe('GET'); urls.push(route.request().url());
    await route.fulfill(fail ? { status: 401, body: '' } : { json: { models: [{ name: 'models/saved-model' }] } });
  });
  const { settings, group, refresh } = await seed(page, 'gemini', '/token%252Fprivate-value'); await expect(group).toContainText('当前接口返回 1 个模型');
  await expect(group).toContainText('[敏感路径已隐藏]'); await expect(group).not.toContainText('private-value');
  fail = true; await refresh(); await expect(group).toContainText('本次获取失败');
  await expect(group).toContainText('[敏感路径已隐藏]'); await expect(settings).not.toContainText('private-value');
  expect(urls).toEqual(['https://final-models.mock.invalid/token%252Fprivate-value/models', 'https://final-models.mock.invalid/token%252Fprivate-value/models']);
});
