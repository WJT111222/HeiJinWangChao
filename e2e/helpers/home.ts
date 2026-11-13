import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function openLibrary(page: Page) {
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

/** Enter through whichever production home is active; never bypass the UI route. */
export async function openStoredSave(page: Page) {
  await openLibrary(page);
  if (await page.locator('.mobile-home').isVisible()) {
    await page.locator('.mh-primary').click();
  } else await page.getByRole('button', { name: /读取存档/ }).first().click();
}
