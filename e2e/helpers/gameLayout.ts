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
