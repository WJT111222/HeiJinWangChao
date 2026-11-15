import { test, expect } from './helpers/test';
import { addChannel, aiTab, backToList } from './helpers/aiSettings';

// iOS 26 Safari 的悬浮工具栏约 80px 会盖住贴底抽屉的底部；键盘收起后视口偏移还可能把抽屉往下推。
// 选项很少时，选择抽屉也必须保持足够高度，让选项落在屏幕上半部分，而不是紧贴底边。
const SAFARI_TOOLBAR_ALLOWANCE = 120;

test('手机选择抽屉：选项远离屏幕底边；没有渠道时提示先添加渠道', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '贴底选择抽屉只在手机端出现');
  await page.goto('/');
  await page.locator('[data-settings-open]').first().click();
  const settings = await aiTab(page);
  const viewport = page.viewportSize()!;

  const trigger = settings.getByRole('combobox', { name: '正文生成渠道', exact: true });
  await expect(settings.getByText('还没有渠道：先在下方「我的渠道」点「＋ 添加渠道」', { exact: false })).toBeVisible();
  await trigger.click();
  const picker = page.getByRole('dialog', { name: '正文生成渠道', exact: true });
  await expect(picker).toBeVisible();
  // 等入场动画结束：抽屉仍贴在屏幕底边。
  await expect.poll(async () => { const box = (await picker.boundingBox())!; return Math.round(box.y + box.height); }).toBe(viewport.height);
  const sheet = (await picker.boundingBox())!;
  expect(sheet.height).toBeGreaterThanOrEqual(viewport.height * 0.5);
  const option = (await picker.getByRole('option').first().boundingBox())!;
  expect(option.y + option.height).toBeLessThanOrEqual(viewport.height - SAFARI_TOOLBAR_ALLOWANCE);
  const hint = picker.locator('.select-hint');
  await expect(hint).toContainText('还没有渠道');
  expect((await hint.boundingBox())!.y + (await hint.boundingBox())!.height).toBeLessThanOrEqual(viewport.height - SAFARI_TOOLBAR_ALLOWANCE);
  await expect(hint).not.toHaveAttribute('role', 'option');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // 有渠道之后不再提示，渠道出现在选项里。
  await addChannel(settings, { name: '测试渠道', url: 'https://relay.example.com/v1', key: 'sk-test' });
  await backToList(settings);
  await expect(settings.getByText('还没有渠道：先在下方', { exact: false })).toHaveCount(0);
  await trigger.click();
  await expect(picker.getByRole('option', { name: '测试渠道' })).toBeVisible();
  await expect(picker.locator('.select-hint')).toHaveCount(0);
  await page.keyboard.press('Escape');
});
