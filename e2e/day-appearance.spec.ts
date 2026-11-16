import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openSettings } from './helpers/gameLayout';

// 日间外观：设置即时生效并保存；跟随系统随深浅色切换；弹出面板在日间下仍保持可读的夜间配色。
async function seed(page: Page, appearance?: 'night' | 'day' | 'system') {
  await page.goto('/');
  await page.evaluate(async (appearance) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }] = await Promise.all(paths.map((p) => import(p)));
    if (appearance) { const settings = defaultSettings(); settings.display.appearance = appearance; localStorage.setItem(settingsKey, JSON.stringify(settings)); }
    const repo = await SaveRepository.open(), state = worldState(); state.openingCityId = 'shanghai'; state.protagonist.name = '沈砚';
    await repo.create(state); const draft = await completeDraft(repo);
    await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true }); repo.close();
  }, appearance);
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
const html = (page: Page) => page.locator('html');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1') || 'null')?.display?.appearance);
/** 计算元素文字颜色的相对亮度（0 黑 ~ 1 白）。 */
const textLuminance = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const [r, g, b] = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
});
const shellBackground = (page: Page) => page.locator('.app-shell-game').evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim().toLowerCase());

test('默认夜间；在设置「外观」中切换后立即生效、刷新后保留，可切回夜间', async ({ page }) => {
  await seed(page);
  await expect(html(page)).toHaveAttribute('data-appearance', 'night');
  await openSettings(page);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.getByRole('radio', { name: /夜间/ })).toBeChecked();
  await page.getByRole('radio', { name: /日间/ }).check();
  await expect(html(page)).toHaveAttribute('data-appearance', 'day');
  expect(await stored(page)).toBe('day');
  await expect(page.getByRole('button', { name: '保存本地设置', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-appearance', 'day');
  expect(await shellBackground(page)).toBe('#f1eee7');
  expect(await textLuminance(page, '.story-narration')).toBeLessThan(0.35);
  await openSettings(page);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('radio', { name: /夜间/ }).check();
  await expect(html(page)).toHaveAttribute('data-appearance', 'night');
  expect(await stored(page)).toBe('night');
});

test('跟随系统：随设备深浅色实时切换', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await seed(page, 'system');
  await expect(html(page)).toHaveAttribute('data-appearance', 'day');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveAttribute('data-appearance', 'night');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html(page)).toHaveAttribute('data-appearance', 'day');
});

test('日间下尚未适配的弹出内容保持夜间配色，文字仍清楚', async ({ page }, info) => {
  await seed(page, 'day');
  expect(await textLuminance(page, '.story-narration')).toBeLessThan(0.35);
  if (info.project.name === 'mobile') {
    await page.locator('[data-mobile-status]').click();
    await expect(page.locator('dialog.mobile-status-sheet[open]')).toBeVisible();
    expect(await textLuminance(page, 'dialog.mobile-status-sheet .st-place h3')).toBeGreaterThan(0.7);
  } else {
    await page.getByRole('button', { name: '详情', exact: true }).click();
    await expect(page.locator('#workflow-pop')).toBeVisible();
    expect(await textLuminance(page, '#workflow-pop .workflow-title, #workflow-pop h2, #workflow-pop strong')).toBeGreaterThan(0.6);
  }
});

test('日间下天际线转为浅色剪影，夜间保持原样', async ({ page }) => {
  const skyline = () => page.locator('.atmo .skyline').first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { filter: style.filter, opacity: Number(style.opacity) };
  });
  await seed(page, 'day');
  await expect(page.locator('.atmo .skyline svg').first()).toBeAttached();
  const day = await skyline();
  expect(day.filter).toContain('invert(1)');
  expect(day.opacity).toBeLessThanOrEqual(0.5);
  await page.evaluate(() => { document.documentElement.dataset.appearance = 'night'; });
  expect((await skyline()).filter).toBe('none');
});
