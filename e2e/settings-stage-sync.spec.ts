import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

async function settings(page: Page, category: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: category, exact: true }).click();
  return dialog;
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
  await expect(perspective).toHaveValue('first');
  await a.getByRole('button', { name: '保存本地设置' }).click();
  await expect(a.getByRole('status').filter({ hasText: '本地偏好已保存' })).toBeVisible();
  const read = (tab: Page) => tab.evaluate(async () => {
    const path = '/src/ui/settings/model.ts';
    const { settingsKey } = await import(path);
    return JSON.parse(localStorage.getItem(settingsKey) ?? 'null');
  });
  for (const tab of [page, other]) await expect.poll(() => read(tab)).toMatchObject({
    prompts: { perspective: 'first' },
    runtime: { useWorldStage: false },
  });
  await expect(world).not.toBeChecked();
  expect(posts).toBe(0);
  await other.close();
});
