import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function choose(page: Page, label: string, value: string) {
  const control = page.getByRole('combobox', { name: label, exact: true });
  await control.click();
  await page.getByRole('listbox', { name: label, exact: true }).locator(`[role="option"][value=${JSON.stringify(value)}]`).click();
}
export async function selected(page: Page, label: string, value: string) {
  await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveAttribute('value', value);
}
export async function optionCount(page: Page, label: string, count: number) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label, exact: true }).getByRole('option')).toHaveCount(count);
  await page.keyboard.press('Escape');
}
