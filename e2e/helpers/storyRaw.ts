import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

export async function expectStoryRaw(panel: Locator, expected: string) {
  const box = panel.getByRole('textbox', { name: '正文模型完整原文', exact: true });
  await expect(panel.locator('textarea')).toHaveCount(1);
  await expect(box).toHaveValue(expected);
  await expect(box).toHaveAttribute('readonly', '');
  await expect(panel.locator('.story-native-response')).toHaveCount(0);

  // Count hidden copies too. The sole pre belongs to the collapsible diagnostic.
  const diagnostic = panel.getByText('本次正文响应诊断', { exact: true }).locator('..').locator('pre');
  await expect(panel.locator('pre')).toHaveCount(1);
  await expect(diagnostic).toHaveCount(1);
  const report = (await diagnostic.textContent()) ?? '';
  expect(JSON.parse(report)).toMatchObject({
    attempt: expect.any(String),
    status: expect.any(String),
    storyValidated: expect.any(Boolean),
    candidateSaved: expect.any(Boolean),
  });
  expect(report).not.toContain(JSON.stringify(expected).slice(1, -1));
  return box;
}
