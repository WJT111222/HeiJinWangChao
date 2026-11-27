import { aiPage } from './aiSettings';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function choose(page: Page, label: string, value: string) {
  if (/(渠道|模型)$/.test(label)) await aiPage(page, 'routing');
  const control = page.getByRole('combobox', { name: label, exact: true });
  await control.click();
  await page.getByRole('listbox', { name: label, exact: true }).locator(`[role="option"][value=${JSON.stringify(value)}]`).click();
}
export async function selected(page: Page, label: string, value: string) {
  if (/(渠道|模型)$/.test(label)) await aiPage(page, 'routing');
  await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveAttribute('value', value);
}
export async function optionCount(page: Page, label: string, count: number) {
  if (/(渠道|模型)$/.test(label)) await aiPage(page, 'routing');
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label, exact: true }).getByRole('option')).toHaveCount(count);
  await page.keyboard.press('Escape');
}
