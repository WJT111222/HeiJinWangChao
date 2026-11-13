import type { Page } from '@playwright/test';

export const mobileCreation = (page: Page) => (page.viewportSize()?.width ?? 0) <= 900;

// Use the production mobile category card and expandable skill editor, not hidden desktop inputs.
export async function chooseCustomProfession(page: Page) {
  if (mobileCreation(page)) await page.getByRole('button', { name: '✎ 自由选择', exact: true }).click();
  else await page.getByRole('radio', { name: '自由选择', exact: true }).check();
}

export async function chooseProfession(page: Page, name: string) {
  // Mobile radio labels also contain the three-skill preview.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('radio', { name: new RegExp(`^${escaped}(?:\\s|$)`) }).check();
}

export async function showPersonalSkills(page: Page) {
  const details = page.locator('.creation-manual-skills');
  if (await details.count() && !await details.evaluate(element => element.hasAttribute('open')))
    await details.locator('summary').click();
}

export async function showCreationReview(page: Page) {
  for (const fold of await page.locator('.creation-review-fold').all())
    if (!await fold.evaluate(element => element.hasAttribute('open'))) await fold.locator(':scope > summary').click();
}
