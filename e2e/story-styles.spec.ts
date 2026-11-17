import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

/** 剧情风格：七种互斥；电脑端按钮 + 下方说明，手机端竖排列表、说明在选中项内展开。 */
async function openPromptSettings(page: Page) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const root = page.getByRole('dialog', { name: '设置', exact: true });
  const back = root.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name: '提示词', exact: true }).click();
  return root;
}
async function storedStyle(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { SettingsSchema, settingsKey } = await import(path);
    const raw = localStorage.getItem(settingsKey);
    return raw === null ? null : SettingsSchema.parse(JSON.parse(raw)).prompts.style as string;
  });
}
const names = ['一般', '江湖义气', '冷硬黑色', '权谋暗流', '纪实白描', '快意爽文', '荒诞喜剧'];

test('七种风格默认一般；选择冷硬黑色后说明随之切换，保存刷新仍在', async ({ page }, info) => {
  const root = await openPromptSettings(page);
  const group = root.getByRole('radiogroup', { name: '剧情风格' });
  await expect(group.getByRole('radio')).toHaveCount(7);
  for (const name of names) await expect(group.getByRole('radio', { name, exact: true })).toBeAttached();
  await expect(group.getByRole('radio', { name: '一般', exact: true })).toBeChecked();
  const field = root.getByRole('group', { name: '剧情风格' });
  await expect(field).toContainText('清楚可信的当代都市叙事');

  await group.getByRole('radio', { name: '冷硬黑色', exact: true }).check();
  await expect(field).toContainText('潮湿阴冷的城市，雨总也下不完');
  await expect(field).not.toContainText('清楚可信的当代都市叙事');
  if (info.project.name === 'mobile') {
    // 手机端：说明展开在选中项里，单独的说明框不显示。
    await expect(field.locator('.style-item[data-checked] .style-item-desc')).toBeVisible();
    await expect(field.locator('.style-explain')).toBeHidden();
  } else {
    await expect(field.locator('.style-explain')).toBeVisible();
    await expect(field.locator('.style-item-desc')).toBeHidden();
  }
  await field.screenshot({ path: `/tmp/styles-${info.project.name}.png` });
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await storedStyle(page)).toBe('noir');

  await page.reload();
  const again = await openPromptSettings(page);
  await expect(again.getByRole('radiogroup', { name: '剧情风格' }).getByRole('radio', { name: '冷硬黑色', exact: true })).toBeChecked();
  await expect(again.getByRole('group', { name: '剧情风格' })).toContainText('潮湿阴冷的城市');
});

test('键盘可在风格之间切换', async ({ page }) => {
  const root = await openPromptSettings(page);
  const group = root.getByRole('radiogroup', { name: '剧情风格' });
  await group.getByRole('radio', { name: '一般', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '江湖义气', exact: true })).toBeChecked();
  await expect(root.getByRole('group', { name: '剧情风格' })).toContainText('讲情义、面子与背叛的街头江湖');
});
