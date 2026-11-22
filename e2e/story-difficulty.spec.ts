import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { defaultSettings } from '../src/ui/settings/model';

// 剧情难度是全局设置：开局第五步显示的档位要跟随设置的最新值，确认创建时也不能把设置改回旧值。
const settingsKey = 'heijin.settings.v1';

async function reachReview(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟');
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByRole('radio', { name: '女性', exact: true }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '专业与公共服务', exact: true }).click();
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
}
const difficulty = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: '剧情难度', exact: true }).getByRole('radio', { name, exact: true });
const savedDifficulty = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').prompts?.difficulty ?? null, settingsKey);

test('创角途中别处改了难度：第五步跟随最新设置，之后在第五步再选则以第五步为准', async ({ page, context }) => {
  await reachReview(page);
  await expect(difficulty(page, '标准')).toBeChecked();

  // 另一个标签页把全局难度改成硬核（与创角页打开设置面板保存是同一份设置）。
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(([key, raw]) => {
    const settings = JSON.parse(localStorage.getItem(key) || raw);
    settings.prompts.difficulty = 'hardcore';
    localStorage.setItem(key, JSON.stringify(settings));
  }, [settingsKey, JSON.stringify(defaultSettings())] as const);
  await other.close();
  await expect(difficulty(page, '硬核')).toBeChecked();

  // 在第五步最后再选宽松：确认创建时写入宽松。
  await difficulty(page, '宽松').check();
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect.poll(() => savedDifficulty(page)).toBe('relaxed');
});

test('从未选过难度时第五步默认标准，确认创建写入设置', async ({ page }) => {
  await reachReview(page);
  await expect(difficulty(page, '标准')).toBeChecked();
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect.poll(() => savedDifficulty(page)).toBe('standard');
});
