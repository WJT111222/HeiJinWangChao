import { expect } from '@playwright/test';
import { openLibrary } from './home';
import type { Page } from '@playwright/test';

// 原有高级工作流/资料测试显式打开折叠区，继续验证原操作；默认折叠由独立布局测试覆盖。
export async function openGameTools(page: Page, entering = false) {
  if (entering) await expect.poll(() => new URL(page.url()).hash.startsWith('#game/')).toBe(true);
  if (!new URL(page.url()).hash.startsWith('#game/')) return;
  await expect(page.locator('.game-layout')).toBeVisible();
  await closeWorldArchive(page);
  await openWorkflow(page);
}

// 操作高级控件前显式展开；不调用生成/恢复，也不修改业务状态。
export async function openWorkflow(page: Page) {
  const disclosure = page.locator('.workflow-disclosure');
  await expect(disclosure).toBeAttached();
  if (!(await disclosure.evaluate(element => element.hasAttribute('open'))))
    await disclosure.locator(':scope > summary').click();
}

export async function openWorkflowDiagnostics(page: Page) {
  await openWorkflow(page);
  const details = page.locator('.workflow-diagnostics');
  if (!(await details.evaluate(element => element.hasAttribute('open'))))
    await details.locator(':scope > summary').click();
}

// Responsive navigation opens the existing directory/profile dialogs, without touching save state.
export async function openWorldArchive(page: Page) {
  const opener = page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '世界资料', exact: true });
  if (await opener.isVisible() && !await page.getByRole('dialog', { name: '世界资料', exact: true }).isVisible()) await opener.click();
}
export async function openProfile(page: Page) {
  const compact = page.getByRole('button', { name: '展开人物状态', exact: true });
  if (await compact.isVisible()) await compact.click();
  else await page.getByRole('button', { name: '人物档案', exact: true }).click();
}
export async function goHome(page: Page) {
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await page.keyboard.press('Escape');
  const desktopHome = page.getByRole('navigation', { name: '系统操作' }).getByRole('button', { name: '返回首页', exact: true });
  if (await desktopHome.isVisible()) { await desktopHome.click(); await openLibrary(page); return; }
  const menu = page.getByRole('button', { name: '打开游戏菜单', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click(); await openLibrary(page);
}

async function closeWorldArchive(page: Page) {
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await directory.getByRole('button', { name: '关闭资料界面', exact: true }).click();
}
export async function openSettings(page: Page) {
  await closeWorldArchive(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
}
