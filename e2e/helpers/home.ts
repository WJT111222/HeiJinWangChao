import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function openLibrary(page: Page) {
  await expect(page.locator('.mobile-home, .home-experience').first()).toBeVisible();
  if (await page.locator('.mobile-home').isVisible()) {
    await expect(page.locator('.mh-rail')).toBeVisible(); return;
  }
  const home = page.locator('.home-experience');
  await expect(home).toBeVisible();
  if (await home.count()) {
    const library = home.locator('.library');
    if (await library.getAttribute('hidden') !== null) await home.locator('.btn-library').click();
    await expect(library).toHaveCSS('transform','none');
  }
}

/**
 * Enter through whichever production home is active; never bypass the UI route.
 * 电脑端点存档卡的「读取存档」；手机端（车票首页）先切到对应车票，再按主按钮。
 * title 用于有多个存档时指定其中一个（匹配存档卡 / 车票上的文字）。
 */
export async function openStoredSave(page: Page, title?: string) {
  await openLibrary(page);
  if (await page.locator('.mobile-home').isVisible()) {
    if (title) {
      const tickets = page.locator('.mh-ticket-wrap');
      const index = await tickets.evaluateAll((items, text) => items.findIndex((item) => item.textContent?.includes(text)), title);
      expect(index, `找不到车票：${title}`).toBeGreaterThanOrEqual(0);
      await page.getByRole('button', { name: new RegExp(`^第 ${index + 1} 张`) }).click();
      await expect(tickets.nth(index)).toHaveAttribute('aria-current', 'true');
    }
    await page.locator('.mh-primary').click();
  } else {
    const cards = title ? page.locator('.save-card').filter({ hasText: title }) : page.locator('.save-card');
    await cards.getByRole('button', { name: /读取存档/ }).first().click();
  }
}
