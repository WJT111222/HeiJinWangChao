import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// 原有高级工作流/资料测试显式打开折叠区，继续验证原操作；默认折叠由独立布局测试覆盖。
export async function openGameTools(page: Page, entering = false) {
  if (entering) await expect.poll(() => new URL(page.url()).hash.startsWith('#game/')).toBe(true);
  if (!new URL(page.url()).hash.startsWith('#game/')) return;
  await expect(page.locator('.game-layout')).toBeVisible();
  for (const selector of ['.hero-sidebar', '.world-sidebar', '.workflow']) {
    const details = page.locator(`${selector} > details`).first();
    const summary = details.locator(':scope > summary');
    if (await summary.isVisible() && !(await details.evaluate((element) => element.hasAttribute('open')))) await summary.click();
  }
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
