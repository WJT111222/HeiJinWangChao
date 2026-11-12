import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function openLibrary(page: Page) {
  const home = page.locator('.home-experience');
  await expect(home).toBeVisible();
  if (await home.count()) {
    const library = home.locator('.library');
    if (await library.getAttribute('hidden') !== null) await home.locator('.btn-library').click();
    await expect(library).toHaveCSS('transform','none');
  }
}
