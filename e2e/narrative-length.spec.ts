import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

/** 正文篇幅：低 / 中 / 高三档一键填好最低字数与建议上限；手动改数字或点「自定义」为自定义。 */
async function openPromptSettings(page: Page, seed?: Record<string, unknown>) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.goto('/');
  if (seed) {
    await page.evaluate(async (prompts) => {
      const path = '/src/ui/settings/model.ts', { defaultSettings, settingsKey } = await import(path);
      const settings = defaultSettings(); settings.prompts = { ...settings.prompts, ...prompts };
      if (!('maxNarrativeChars' in prompts)) delete settings.prompts.maxNarrativeChars;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    }, seed);
    await page.reload();
  }
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const root = page.getByRole('dialog', { name: '设置', exact: true });
  const back = root.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name: '提示词', exact: true }).click();
  return root;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { SettingsSchema, settingsKey } = await import(path);
    const raw = localStorage.getItem(settingsKey);
    return raw === null ? null : SettingsSchema.parse(JSON.parse(raw)).prompts as { minNarrativeChars: number; maxNarrativeChars: number };
  });
}
const tier = (root: ReturnType<Page['getByRole']>, name: string) => root.getByRole('radiogroup', { name: '正文篇幅档位' }).getByRole('radio', { name: new RegExp(`^${name}`) });

test('新玩家默认低档；选中档 / 高档后保存，刷新仍在；高档提示输出长度', async ({ page }, info) => {
  const root = await openPromptSettings(page);
  await expect(tier(root, '低')).toBeChecked();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue('1000');
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('2000');
  await root.getByRole('group', { name: '正文篇幅' }).screenshot({ path: `/tmp/length-${info.project.name}-low.png` });

  await tier(root, '中').check();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue('4000');
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('5000');
  await tier(root, '高').check();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue('8000');
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('10000');
  await expect(root.getByRole('group', { name: '正文篇幅' })).toContainText('建议在「AI 连接」把最大输出调到 16k 以上');
  await root.getByRole('group', { name: '正文篇幅' }).screenshot({ path: `/tmp/length-${info.project.name}-high.png` });
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await stored(page)).toMatchObject({ minNarrativeChars: 8000, maxNarrativeChars: 10000 });

  await page.reload();
  const again = await openPromptSettings(page);
  await expect(tier(again, '高')).toBeChecked();
});

test('自定义：手动改数字即为自定义；上限低于最低时不能保存', async ({ page }, info) => {
  const root = await openPromptSettings(page);
  await root.getByLabel('正文最低字数', { exact: true }).fill('3000');
  await expect(tier(root, '自定义')).toBeChecked();
  await root.getByLabel('正文建议上限', { exact: true }).fill('2500');
  await expect(root.getByRole('group', { name: '正文篇幅' }).getByRole('alert')).toContainText('建议上限不能低于最低字数');
  await root.getByRole('group', { name: '正文篇幅' }).screenshot({ path: `/tmp/length-${info.project.name}-invalid.png` });
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('正文建议上限不能低于最低字数');
  expect(await stored(page)).toBeNull();

  await root.getByLabel('正文建议上限', { exact: true }).fill('3600');
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await stored(page)).toMatchObject({ minNarrativeChars: 3000, maxNarrativeChars: 3600 });

  // 点「自定义」不改数字，只是把焦点放到最低字数上。
  await tier(root, '低').check();
  await tier(root, '自定义').check();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toBeFocused();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue('1000');
});

test('老玩家的设置没有上限：保留原最低字数，自动补上建议上限，显示为自定义', async ({ page }) => {
  const root = await openPromptSettings(page, { minNarrativeChars: 1500 });
  await expect(tier(root, '自定义')).toBeChecked();
  await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue('1500');
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('2000');
  expect(await stored(page)).toEqual(expect.not.objectContaining({ maxNarrativeChars: expect.anything() }));
  // 只改最低字数：上限固定为原来推出的 2000，不随最低字数漂移。
  await root.getByLabel('正文最低字数', { exact: true }).fill('1800');
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('2000');
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await stored(page)).toMatchObject({ minNarrativeChars: 1800, maxNarrativeChars: 2000 });
});
