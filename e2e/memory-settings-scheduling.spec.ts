import { expect, test } from './helpers/test';
import { settingsCategory } from './helpers/aiSettings';
import type { Page, Route } from '@playwright/test';

const endpoint = 'https://memory-settings.mock.invalid/**';
const summary = JSON.stringify({ summary: '已记录的散步与约定。', importantEvents: ['与陈宁约定见面并保管蓝色钥匙。'] });
async function reply(route: Route, status = 200) {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
  await route.fulfill({ status, headers, contentType: 'application/json', body: status === 200
    ? JSON.stringify({ choices: [{ message: { content: summary }, finish_reason: 'stop' }] }) : '{}' });
}
async function seed(page: Page, automatic = true, unconfirmed = false, second = false) {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(async ({ automatic, unconfirmed, second }) => {
    const f = '/src/tests/fixtures/compression.ts', r = '/src/services/storage/saveRepository.ts', s = '/src/ui/settings/model.ts',
      c = '/src/services/ai/configuration.ts', v = '/src/services/ai/credentials.ts', m = '/src/workflows/memoryMaintenance.ts';
    const { compressionState } = await import(f), { SaveRepository } = await import(r), { defaultSettings, settingsKey } = await import(s),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(c), { CredentialVault } = await import(v), { summaryAttemptKey } = await import(m);
    const state = compressionState('short', 100);
    state.memories.short.forEach((entry: { text: string }) => { entry.text = `存档A：${entry.text}`; });
    const stateB = structuredClone(state); stateB.saveId = 'save-b'; stateB.title = '隔离存档B';
    stateB.memories.short.forEach((entry: { text: string }) => { entry.text = entry.text.replace('存档A', '存档B'); });
    const repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(state); if (second) tx.objectStore('saves').put(stateB);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const settings = defaultSettings(); settings.memory.summaries.short.automatic = automatic;
    settings.memory.summaries.medium.automatic = false; settings.memory.summaries.npc.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    if (unconfirmed) localStorage.setItem(summaryAttemptKey(state, 'short'), 'unconfirmed-mock-attempt');
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://memory-settings.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'unused-story' };
    config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'memory' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-memory-settings-secret');
  }, { automatic, unconfirmed, second });
  // 从首页刷新正式读取种子偏好，不能只改变 localStorage 而留下旧的 React 设置。
  await page.reload();
  await page.goto('/#game/save-a');
  await expect(page.locator('.game-layout')).toBeVisible();
}
async function state(page: Page, saveId = 'save-a') {
  return page.evaluate(async id => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load(id); } finally { repo.close(); }
  }, saveId);
}
async function count(page: Page, saveId = 'save-a') { return (await state(page, saveId)).memories.medium.length; }
async function stored(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!)); }
async function settings(page: Page, category: string) {
  const menu = page.getByRole('button', { name: '打开游戏菜单', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await settingsCategory(page, category);
  return page.getByRole('dialog', { name: '设置', exact: true });
}
async function observe(page: Page) {
  // 有界观察窗：执行 React Effect / 浏览器异步任务，未到 60 秒定时维护。
  await page.clock.runFor(500);
}
async function traffic(page: Page, status = 200) {
  const calls: string[] = [];
  await page.route(endpoint, async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' } }); return;
    }
    const body = route.request().postDataJSON(); expect(body.model).toBe('memory');
    calls.push(JSON.stringify(body)); await reply(route, status);
  });
  return calls;
}

test('自动首批仅一次；保存风格、原样设置、篇幅、人称和写作开关保持请求及总结 1→1', async ({ page }, info) => {
  const calls = await traffic(page); await seed(page);
  await expect.poll(() => count(page)).toBe(1); await observe(page); expect(calls).toHaveLength(1);
  const before = await state(page), original = await stored(page);
  const root = await settings(page, '正文与风格');
  await root.getByRole('radiogroup', { name: '剧情风格' }).getByRole('radio', { name: '冷硬黑色', exact: true }).check();
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存'); await observe(page);
  expect(await stored(page)).toEqual({ ...original, prompts: { ...original.prompts, style: 'noir' } });
  // 保留原来的安全断言：绝不能把此处改为预期 2。
  expect(calls).toHaveLength(1); expect(await count(page)).toBe(1); expect(await state(page)).toEqual(before);
  await page.screenshot({ path: info.outputPath('style-request-1-to-1.png'), animations: 'disabled' });
  await info.attach('request-count', { body: JSON.stringify({ before: 1, after: calls.length, summaries: await count(page) }), contentType: 'application/json' });
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click(); await observe(page);
  expect(calls).toHaveLength(1); expect(await state(page)).toEqual(before);
  await root.getByLabel('正文最低字数', { exact: true }).fill('1500');
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click(); await observe(page);
  expect((await stored(page)).prompts.minNarrativeChars).toBe(1500); expect(calls).toHaveLength(1);
  await root.getByRole('group', { name: '叙事人称' }).getByRole('button', { name: '第一人称' }).click();
  await settingsCategory(page, '提示词开关');
  await root.getByLabel('防抢话 NoControl', { exact: true }).uncheck();
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click(); await observe(page);
  expect((await stored(page)).prompts.perspective).toBe('first'); expect(calls).toHaveLength(1); expect(await state(page)).toEqual(before);
});

test('自动配置有效变化、60秒定时、手动总结仍有效；关闭后无新自动请求', async ({ page }, info) => {
  test.setTimeout(60000);
  const calls = await traffic(page); await seed(page, false); await observe(page); expect(calls).toHaveLength(0);
  const root = await settings(page, '记忆');
  await root.getByLabel('自动总结 短期 → 中期', { exact: true }).check();
  await root.getByRole('button', { name: '保存记忆设置', exact: true }).click();
  await expect.poll(() => count(page)).toBe(1); expect(calls).toHaveLength(1);
  await root.getByLabel('触发阈值 · 短期 → 中期', { exact: true }).fill('31');
  await root.getByRole('button', { name: '保存记忆设置', exact: true }).click();
  await expect.poll(() => count(page)).toBe(2); expect(calls).toHaveLength(2);
  await page.clock.fastForward(60000);
  await expect.poll(() => count(page)).toBe(3); expect(calls).toHaveLength(3);
  await root.getByLabel('自动总结 短期 → 中期', { exact: true }).uncheck();
  await root.getByRole('button', { name: '保存记忆设置', exact: true }).click(); await observe(page);
  await page.clock.fastForward(60000); await observe(page); expect(calls).toHaveLength(3);
  await root.getByRole('button', { name: '立即总结 · 短期 → 中期', exact: true }).click();
  await expect.poll(() => count(page)).toBe(4); expect(calls).toHaveLength(4);
  await page.screenshot({ path: info.outputPath('legal-maintenance.png'), animations: 'disabled' });
});

for (const mode of ['failed', 'unconfirmed'] as const) test(`${mode}：配置及写作更新、定时检查不能自动重试付费请求`, async ({ page }) => {
  const calls = await traffic(page, 401); await seed(page, true, mode === 'unconfirmed');
  const failure = page.getByRole('dialog', { name: /^短期 → 中期总结(失败|待确认)$/ });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText(mode === 'unconfirmed' ? '未确认保存的请求' : '授权错误');
  await failure.getByRole('button', { name: '关闭资料界面', exact: true }).click();
  await observe(page); const expected = mode === 'failed' ? 1 : 0;
  expect(calls).toHaveLength(expected); const before = await state(page);
  const root = await settings(page, '正文与风格');
  await root.getByRole('radiogroup', { name: '剧情风格' }).getByRole('radio', { name: '冷硬黑色', exact: true }).check();
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click(); await observe(page);
  await settingsCategory(page, '记忆');
  await root.getByLabel('触发阈值 · 短期 → 中期', { exact: true }).fill('31');
  await root.getByRole('button', { name: '保存记忆设置', exact: true }).click();
  await page.clock.fastForward(60000); await observe(page);
  expect(calls).toHaveLength(expected); expect(await state(page)).toEqual(before);
});

test('切换存档取消旧请求；迟到结果不保存；卸载后清除旧队列和定时器', async ({ page }) => {
  const calls: string[] = []; let oldRoute: Route | undefined;
  await page.route(endpoint, async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' } }); return;
    }
    const body = JSON.stringify(route.request().postDataJSON()); expect(route.request().postDataJSON().model).toBe('memory');
    const id = body.includes('存档A') ? 'save-a' : 'save-b'; calls.push(id);
    if (id === 'save-a') { oldRoute = route; return; }
    await reply(route);
  });
  await seed(page, true, false, true); await expect.poll(() => calls.length).toBe(1);
  await page.goto('/#game/save-b'); await expect.poll(() => count(page, 'save-b')).toBe(1);
  expect(calls).toEqual(['save-a', 'save-b']);
  if (oldRoute) await reply(oldRoute).catch(() => { /* 请求已取消时，浏览器可以拒绝迟到响应。 */ });
  await observe(page); expect(await count(page, 'save-a')).toBe(0);
  await page.clock.fastForward(60000); await expect.poll(() => count(page, 'save-b')).toBe(2);
  expect(calls).toEqual(['save-a', 'save-b', 'save-b']); expect(await count(page, 'save-a')).toBe(0);
  await page.goto('/'); await expect(page.locator('.game-layout')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '黑金王朝', exact: true })).toBeVisible();
  await page.clock.fastForward(120000); await observe(page);
  expect(calls).toEqual(['save-a', 'save-b', 'save-b']);
});
