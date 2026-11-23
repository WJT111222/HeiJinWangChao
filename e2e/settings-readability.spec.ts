import { expect, test } from './helpers/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { openPaperSettings, seedMobileArchives, storedArchives } from './helpers/mobileArchives';
import { settingsTextContrast } from './helpers/settingsContrast';
import { writeFile } from 'node:fs/promises';

// Each scenario visits several real settings pages and captures their styles.
test.setTimeout(60_000);

async function prepare(page: Page, inGame: boolean) {
  let posts = 0;
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') { posts++; return route.abort(); }
    if (url.hostname.endsWith('.mock.invalid')) return route.fulfill({ json: { data: [{ id: 'audit-model' }] } });
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  if (inGame) await seedMobileArchives(page); else await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1500; settings.prompts.perspective = 'third';
    for (const option of Object.values(settings.memory.summaries) as { automatic: boolean }[]) option.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = { ...newChannel(), id: 'contrast-channel', name: '可读性测试渠道', baseUrl: 'https://contrast.mock.invalid/v1', defaultModel: 'audit-model' };
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'audit-model' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-contrast-not-a-real-key', true);
  });
  await page.reload(); await page.evaluate(() => document.fonts.ready);
  const before = inGame ? await storedArchives(page) : undefined;
  const root = inGame ? await openPaperSettings(page) : await (async () => {
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    return page.getByRole('dialog', { name: '设置', exact: true });
  })();
  return { root, before, posts: () => posts };
}
async function tab(root: Locator, name: string) {
  const back = root.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name, exact: true }).click();
  await expect(root.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function readable(root: Locator, testInfo: TestInfo, name: string) {
  // Measure the finished UI, not the intentional mobile paper-push fade-in.
  await root.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
  const measured = await settingsTextContrast(root);
  const path = testInfo.outputPath(`${name}-computed.json`);
  await writeFile(path, JSON.stringify(measured, null, 2));
  await testInfo.attach(`${name}-computed.json`, { path, contentType: 'application/json' });
  expect(measured.rows.length).toBeGreaterThan(0);
  expect.soft(measured.failures, `${name}: text contrast`).toEqual([]);
  expect.soft(measured.controlFailures, `${name}: required control contrast`).toEqual([]);
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
}

for (const inGame of [false, true]) {
  test(`${inGame ? '游戏内' : '首页'}设置：字段、反馈与真实禁用状态可读`, async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name === 'mobile' ? { width: 412, height: 839 } : { width: 1440, height: 900 });
    const { root, before, posts } = await prepare(page, inGame);
    await tab(root, '提示词'); await readable(root, testInfo, 'prompts'); await capture(page, testInfo, 'prompts');
    await root.getByLabel('正文最低字数', { exact: true }).focus();
    await readable(root, testInfo, 'focus');
    await root.getByLabel('正文最低字数', { exact: true }).fill('1600');
    await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
    await expect(root.getByRole('status')).toContainText('本地偏好已保存');
    await readable(root, testInfo, 'success'); await capture(page, testInfo, 'success');
    await root.getByLabel('正文最低字数', { exact: true }).fill('0');
    await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
    await expect(root.getByRole('status')).toContainText('请输入有效的正整数');
    await readable(root, testInfo, 'error'); await capture(page, testInfo, 'error');
    await root.getByLabel('正文最低字数', { exact: true }).fill('1600');
    await tab(root, '运行'); await readable(root, testInfo, 'runtime');
    await tab(root, '记忆');
    const summarize = root.getByRole('button', { name: '立即总结 · 短期 → 中期', exact: true });
    // The synthetic game has enough raw sources for manual public summarizing;
    // the cover has no selected save. CSS must not change either qualification.
    if (inGame) await expect(summarize).toBeEnabled(); else await expect(summarize).toBeDisabled();
    await expect(root.getByRole('button', { name: '立即总结 · 中期 → 长期', exact: true })).toBeDisabled();
    await readable(root, testInfo, 'memory'); await capture(page, testInfo, 'memory');
    if (inGame) { await summarize.hover(); await readable(root, testInfo, 'memory-hover'); }
    if (inGame) expect(await storedArchives(page)).toEqual(before);
    expect(posts()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${inGame ? '游戏内' : '首页'}设置：AI 辅助文字、资源列表和嵌套确认主题隔离`, async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name === 'mobile' ? { width: 412, height: 839 } : { width: 1440, height: 900 });
    const { root, before, posts } = await prepare(page, inGame);
    await tab(root, 'AI 连接');
    if (testInfo.project.name === 'mobile') await root.getByRole('button', { name: '编辑渠道：可读性测试渠道', exact: true }).click();
    await readable(root, testInfo, 'ai');
    // Only the model-list GET endpoint is mocked here; never test a paid reply.
    await root.getByRole('button', { name: '获取模型', exact: true }).click();
    await expect(root.locator('.ai-connect-txt b')).toHaveText('连接正常');
    await readable(root, testInfo, 'ai-connected');
    await page.route('https://contrast.mock.invalid/**', route => route.fulfill({ status: 503, json: { error: { message: '隔离测试连接失败' } } }));
    await root.getByRole('button', { name: '重新获取模型', exact: true }).click();
    await expect(root.locator('.ai-connect-txt b')).toHaveText('连接失败');
    await readable(root, testInfo, 'ai-connection-error');
    await root.locator('.ai-adv summary').click(); await root.locator('.ai-temp').scrollIntoViewIfNeeded();
    await readable(root, testInfo, 'ai-advanced'); await capture(page, testInfo, 'ai-advanced');
    await root.getByLabel('渠道名称', { exact: true }).fill('可读性测试渠道（修改）');
    await readable(root, testInfo, 'dirty');
    await root.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
    await expect(root.locator('.ai-save-msg')).toContainText('已保存'); await readable(root, testInfo, 'ai-saved');
    await root.getByRole('button', { name: '删除渠道', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: /删除「可读性测试渠道/ });
    await expect(confirm).toBeVisible(); await readable(confirm, testInfo, 'confirmation'); await capture(page, testInfo, 'confirmation');
    await confirm.getByRole('button', { name: '确认删除渠道', exact: true }).hover();
    await readable(confirm, testInfo, 'confirmation-hover');
    // The pre-existing desktop nested Escape issue is intentionally outside this CSS fix.
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(root).toBeVisible(); await expect(root.getByLabel('渠道名称', { exact: true })).toHaveValue('可读性测试渠道（修改）');
    await tab(root, '提示词管理'); await root.locator('.pm-list').first().waitFor();
    await readable(root, testInfo, 'manager'); await capture(page, testInfo, 'manager');
    const inactive = root.locator('.pm-row.off').first(); await expect(inactive.locator('.pm-open')).toBeEnabled();
    await expect(inactive).toHaveCSS('opacity', '1'); await inactive.locator('.pm-open').click();
    await expect(root.locator('.pm-read pre')).toBeVisible(); await readable(root, testInfo, 'module-read');
    await root.getByRole('button', { name: /高级/ }).first().click(); await readable(root, testInfo, 'manager-advanced');
    await capture(page, testInfo, 'manager-advanced');
    if (inGame) expect(await storedArchives(page)).toEqual(before);
    expect(posts()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('只读离线预览的高级设置仍可读，不改变存档或发送模型请求', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'mobile' ? { width: 412, height: 839 } : { width: 1440, height: 900 });
  const { root, before, posts } = await prepare(page, true);
  await tab(root, '提示词管理'); await root.getByRole('button', { name: /高级/ }).first().click();
  await root.getByRole('combobox', { name: /回合模式/ }).selectOption('regular');
  await root.getByRole('button', { name: '生成三阶段组装预览（不联网）', exact: true }).click();
  await expect(root.getByText('预览已组装；未发送 API 请求、未执行回合、未写入正式存档。', { exact: true })).toBeVisible({ timeout: 20_000 });
  await readable(root, testInfo, 'offline-preview'); await capture(page, testInfo, 'offline-preview');
  expect(await storedArchives(page)).toEqual(before); expect(posts()).toBe(0);
});

for (const width of [900, 901]) {
  test(`${width}px 边界：正常标签、悬停、键盘焦点和关闭开关保持可读`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { root, posts } = await prepare(page, false);
    await tab(root, '提示词');
    const toggle = root.getByRole('checkbox', { name: 'NoControl（防抢话）', exact: true });
    await toggle.uncheck(); await toggle.focus(); await page.keyboard.press('Tab');
    await readable(root, testInfo, 'boundary'); await capture(page, testInfo, `boundary-${width}`);
    const next = root.getByRole('checkbox', { name: '自然文风修复', exact: true });
    expect(await next.evaluate(e => e.matches(':focus-visible'))).toBe(true);
    expect(await next.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
    if (width > 900) { await root.getByRole('button', { name: '记忆', exact: true }).hover(); await readable(root, testInfo, 'hover'); }
    expect(await root.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(posts()).toBe(0);
  });
}

test('运行偏好未保存时 Escape 允许继续编辑或明确放弃', async ({ page }) => {
  const { root: settings, posts } = await prepare(page, false);
  await settings.getByRole('button', { name: '运行', exact: true }).click();
  const world = settings.getByRole('checkbox', { name: '动态世界', exact: true });
  const original = await world.isChecked();
  await world.setChecked(!original);
  await expect(settings.locator('[data-settings-category="运行"] .dirty')).toBeAttached();
  await page.keyboard.press('Escape');
  const confirmation = page.getByRole('dialog', { name: '本地偏好尚未保存' });
  try { await expect(confirmation).toBeVisible(); }
  catch (error) { console.error(await page.getByRole('dialog').allTextContents()); throw error; }
  await confirmation.getByRole('button', { name: '继续编辑' }).click();
  if (original) await expect(world).not.toBeChecked();
  else await expect(world).toBeChecked();
  await page.keyboard.press('Escape');
  await confirmation.getByRole('button', { name: '放弃本次修改' }).click();
  await expect(settings).not.toBeVisible();
  expect(posts()).toBe(0);
});

test('未保存运行设置时离开存档需要确认，继续编辑及放弃不写入设置', async ({ page }) => {
  const { root, before, posts } = await prepare(page, true);
  await tab(root, '运行');
  const world = root.getByRole('checkbox', { name: '动态世界', exact: true });
  const original = await world.isChecked();
  const persisted = () => page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
  const originalSettings = await persisted();
  expect(originalSettings).not.toBeNull();
  await world.setChecked(!original);
  const dialog = page.getByRole('dialog', { name: '本地偏好尚未保存' });
  const leave = () => page.evaluate(() => { window.location.hash = ''; });

  await leave();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#game\/save-a$/);
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(world).toBeChecked({ checked: !original });
  expect(await persisted()).toBe(originalSettings);
  expect(await storedArchives(page)).toEqual(before);

  await leave();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '放弃本次修改' }).click();
  await expect(page).toHaveURL(url => !url.hash);
  await expect(root).not.toBeVisible();
  expect(await persisted()).toBe(originalSettings);
  expect(await storedArchives(page)).toEqual(before);
  expect(posts()).toBe(0);
});
