import { expect, test } from '@playwright/test';
import { announcement } from '../src/ui/notices/announcement';
const title = '黑金王朝 · 游玩须知与免责声明';
const remote = { version: 'mock-next', title: '王朝公告', theme: '远程合成公告', updates: ['<script>window.remoteExecuted=true</script>', '第二条更新'], message: '测试寄语' };
test('远程公告迟到仍更新打开的弹窗，顺序/免打扰/手动查看不变，零AI请求', async ({ page }) => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); let calls = 0, ai = 0;
  await page.route('https://**/*', async route => { ai++; await route.abort(); });
  await page.route('**/api/announcement', async route => { calls++; await hold; await route.fulfill({ json: remote }); });
  await page.goto('/');
  const disclaimer = page.getByRole('dialog', { name: title, exact: true });
  await expect(disclaimer).toContainText('真实地理，架空社会');
  await disclaimer.getByRole('button', { name: '关闭免责声明' }).click();
  const modal = page.getByRole('dialog', { name: '王朝公告', exact: true });
  await expect(modal).toContainText(announcement.theme); // No network wait before opening.
  release(); await expect(modal).toContainText(remote.theme);
  await expect(modal).toContainText(remote.updates[0]); expect(await page.evaluate(() => 'remoteExecuted' in window)).toBe(false);
  await modal.getByRole('checkbox', { name: '今日不再弹出' }).check();
  await modal.getByRole('button', { name: '关闭王朝公告' }).click();
  await page.reload(); await expect(page.locator('.home-experience')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '王朝公告', exact: true }).click();
  await expect(modal).toContainText(remote.theme); await modal.getByRole('button', { name: '关闭王朝公告' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(calls).toBe(2); expect(ai).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('接口断网立即可用内置公告，首页照常加载', async ({ page }) => {
  await page.route('**/api/announcement', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '关闭免责声明' }).click();
  const modal = page.getByRole('dialog', { name: '王朝公告', exact: true });
  await expect(modal).toContainText(announcement.theme); await modal.getByRole('button', { name: '关闭王朝公告' }).click();
  await expect(page.locator('.home-experience')).toBeVisible();
});
