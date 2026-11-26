import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

async function settings(page: Page, category: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: category, exact: true }).click();
  return dialog;
}

async function category(dialog: Awaited<ReturnType<typeof settings>>, name: string) {
  const back = dialog.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name, exact: true }).click();
}

test('跨标签保存叙事视角不会重新打开另一页关闭的动态世界', async ({ page, context }) => {
  let posts = 0;
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') { posts++; return route.abort(); }
    const { hostname } = new URL(route.request().url());
    return hostname === '127.0.0.1' || hostname === 'localhost' ? route.continue() : route.abort();
  });
  const a = await settings(page, '提示词');
  const perspective = a.getByLabel('叙事人称');
  await perspective.selectOption('first');
  const other = await context.newPage();
  const b = await settings(other, '运行');
  const world = b.getByRole('checkbox', { name: '动态世界', exact: true });
  await expect(world).toBeChecked();
  await world.uncheck();
  await b.getByRole('button', { name: '保存本地设置' }).click();
  await expect(b.getByRole('status').filter({ hasText: '本地偏好已保存' })).toBeVisible();
  await category(b, '记忆');
  await b.getByLabel('即时记忆完整回合数').fill('15');
  await b.getByRole('button', { name: '保存记忆设置' }).click();
  await expect(b.getByText('记忆设置已保存', { exact: false })).toBeVisible();

  await category(a, '外观');
  await a.getByRole('radio', { name: /^日间/ }).check();
  await expect(a.getByText('外观已切换。', { exact: true })).toBeVisible();
  await category(a, '运行');
  await a.getByLabel('请求超时（秒）').fill('150');
  await category(a, '提示词');
  await expect(perspective).toHaveValue('first');

  const read = (tab: Page) => tab.evaluate(async () => {
    const path = '/src/ui/settings/model.ts';
    const { settingsKey } = await import(path);
    return JSON.parse(localStorage.getItem(settingsKey) ?? 'null');
  });
  const before = await read(page);
  expect(before).toMatchObject({
    prompts: { perspective: 'third' },
    runtime: { useWorldStage: false, timeoutSeconds: 120 },
    memory: { immediateWindowSize: 15 },
    display: { appearance: 'day' },
  });

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'heijin.settings.v1') {
        Storage.prototype.setItem = original;
        throw new DOMException('测试写盘失败', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
  });
  const save = a.getByRole('button', { name: '保存本地设置' });
  await save.click();
  await expect(a.getByText('本地保存失败', { exact: false })).toBeVisible();
  expect(await read(page)).toEqual(before);
  await expect(perspective).toHaveValue('first');
  await expect(a.locator('[data-settings-category="提示词"] .dirty')).toBeAttached();

  await save.click();
  await expect(a.getByRole('status').filter({ hasText: '本地偏好已保存' })).toBeVisible();
  await expect(a.locator('[data-settings-category="提示词"] .dirty')).toHaveCount(0);
  for (const tab of [page, other]) await expect.poll(() => read(tab)).toMatchObject({
    prompts: { perspective: 'first' },
    runtime: { useWorldStage: false, timeoutSeconds: 150 },
    memory: { immediateWindowSize: 15 },
    display: { appearance: 'day' },
  });
  await category(b, '运行');
  await expect(b.getByLabel('请求超时（秒）')).toHaveValue('150');
  await expect(world).not.toBeChecked();
  const reopened = await settings(page, '提示词');
  await expect(reopened.getByLabel('叙事人称')).toHaveValue('first');
  await expect(reopened.locator('[data-settings-category="提示词"] .dirty')).toHaveCount(0);
  expect(posts).toBe(0);
  await other.close();
});

test('两个标签分别保存正文空闲与总时限，刷新保留旧请求超时', async ({ page, context }) => {
  const a = await settings(page, '运行');
  const other = await context.newPage(), b = await settings(other, '运行');
  await a.getByLabel('正文流式无有效输出超时（秒）').fill('180');
  await b.getByLabel('正文流式总时限（秒）').fill('900');
  const save = (panel: typeof a) => panel.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await save(a); await save(b);
  const after = await settings(page, '运行');
  await expect(after.getByLabel('正文流式无有效输出超时（秒）')).toHaveValue('180');
  await expect(after.getByLabel('正文流式总时限（秒）')).toHaveValue('900');
  await expect(after.getByLabel('请求超时（秒）', { exact: true })).toHaveValue('120');
  await after.getByLabel('正文流式总时限（秒）').fill('100');
  await save(after);
  await expect(after).toContainText('正文流式总时限不能小于无有效输出时限');
  const retained = await settings(page, '运行');
  await expect(retained.getByLabel('正文流式总时限（秒）')).toHaveValue('900');
});
