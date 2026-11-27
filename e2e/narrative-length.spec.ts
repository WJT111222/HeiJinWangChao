import { settingsCategory } from './helpers/aiSettings';
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
  return promptTab(page);
}
async function promptTab(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const root = page.getByRole('dialog', { name: '设置', exact: true });
  const back = root.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await root.getByRole('button', { name: '正文与风格', exact: true }).click();
  return root;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/settings/model.ts', { SettingsSchema, settingsKey } = await import(path);
    const raw = localStorage.getItem(settingsKey);
    return raw === null ? null : SettingsSchema.parse(JSON.parse(raw)).prompts as { minNarrativeChars: number; maxNarrativeChars?: number };
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
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await page.reload();
  const mid = await openPromptSettings(page);
  await expect(tier(mid, '中')).toBeChecked();
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

for (const [min, max] of [[1000, 2000], [1500, 2000], [4000, 5000], [8000, 10000]]) {
  test(`旧设置 ${min} 缺少上限：自定义显示，打开和保存均不补写，刷新不变`, async ({ page }, info) => {
    const root = await openPromptSettings(page, { minNarrativeChars: min });
    const raw = () => page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
    const before = await raw();
    await expect(tier(root, '自定义')).toBeChecked();
    await expect(root.getByLabel('正文最低字数', { exact: true })).toHaveValue(String(min));
    await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue(String(max));
    expect(await raw()).toBe(before);
    expect(await stored(page)).not.toHaveProperty('maxNarrativeChars');
    await root.getByRole('group', { name: '正文篇幅' }).screenshot({ path: info.outputPath(`legacy-${min}.png`), animations: 'disabled' });
    await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
    await expect(root.getByRole('status')).toContainText('本地偏好已保存');
    expect(await raw()).toBe(before);
    await root.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    const reopened = await openPromptSettings(page);
    await expect(tier(reopened, '自定义')).toBeChecked();
    await page.reload();
    const again = await openPromptSettings(page);
    await expect(tier(again, '自定义')).toBeChecked();
    await expect(again.getByLabel('正文最低字数', { exact: true })).toHaveValue(String(min));
    await expect(again.getByLabel('正文建议上限', { exact: true })).toHaveValue(String(max));
    expect(await raw()).toBe(before);
  });
}

test('旧设置手动改最低字数时，固定当前推算上限', async ({ page }) => {
  const root = await openPromptSettings(page, { minNarrativeChars: 1500 });
  await root.getByLabel('正文最低字数', { exact: true }).fill('1800');
  await expect(tier(root, '自定义')).toBeChecked();
  await expect(root.getByLabel('正文建议上限', { exact: true })).toHaveValue('2000');
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await stored(page)).toMatchObject({ minNarrativeChars: 1800, maxNarrativeChars: 2000 });
  await page.reload();
  const again = await openPromptSettings(page);
  await expect(tier(again, '自定义')).toBeChecked();
  await expect(again.getByLabel('正文最低字数', { exact: true })).toHaveValue('1800');
});

test('旧设置主动选择低档后保存刷新，按显式预设恢复', async ({ page }) => {
  const root = await openPromptSettings(page, { minNarrativeChars: 1000 });
  await expect(tier(root, '自定义')).toBeChecked();
  await tier(root, '低').check();
  await root.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(root.getByRole('status')).toContainText('本地偏好已保存');
  expect(await stored(page)).toMatchObject({ minNarrativeChars: 1000, maxNarrativeChars: 2000 });
  await page.reload();
  const again = await openPromptSettings(page);
  await expect(tier(again, '低')).toBeChecked();
});

test('文学预设接管篇幅和人称，可打开控制台，停用后恢复原值', async ({ page }, info) => {
  const initial = await openPromptSettings(page, { minNarrativeChars: 4000, maxNarrativeChars: 5000, perspective: 'first' });
  await expect(initial.getByRole('button',{name:'第一人称'})).toBeEnabled();
  const preferences = await stored(page);
  async function mode(value: string) {
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    const back = dialog.getByRole('button', { name: '返回设置', exact: true });
    if (await back.isVisible()) await back.click();
    await dialog.getByRole('button', { name: '文学预设', exact: true }).click();
    await dialog.getByLabel('正文预设').selectOption(value);
    await Promise.all([page.waitForNavigation(), dialog.getByRole('button', { name: '保存预设并刷新' }).click()]);
  }
  await mode('peinture-1118');
  const managed = await promptTab(page);
  await expect(managed.getByText('由当前文学预设接管', { exact: false })).toBeVisible();
  for (const label of ['正文最低字数', '正文建议上限'])
    await expect(managed.getByLabel(label)).toBeDisabled();
  await expect(managed.getByRole('button',{name:'第一人称'})).toBeDisabled();
  await expect(managed.getByRole('radiogroup', { name:'剧情风格' }).getByRole('radio').first()).toBeDisabled();
  await expect(managed.getByRole('radiogroup', { name:'剧情难度' }).getByRole('radio').first()).toBeEnabled();
  await settingsCategory(page,'提示词开关');
  await expect(managed.getByLabel('自然文风修复')).toBeDisabled();
  await expect(managed.getByLabel('行动选项', { exact: true })).toBeEnabled();
  await settingsCategory(page,'正文与风格');
  await page.screenshot({ path: info.outputPath('literary-settings.png'), animations: 'disabled' });
  await managed.getByRole('button', { name: '打开文学预设控制台' }).click();
  await expect(page.getByRole('dialog', { name: '王朝预设设置', exact: true })).toBeVisible();
  expect(await stored(page)).toEqual(preferences);
  await mode('');
  const restored = await promptTab(page);
  await expect(restored.getByLabel('正文最低字数')).toBeEnabled();
  await expect(restored.getByLabel('正文最低字数')).toHaveValue('4000');
  await expect(restored.getByRole('group', { name: '叙事人称' }).getByRole('button', { name: '第一人称' })).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toEqual(preferences);
});

test('独立防截断启用后可修改并保存原生人称、文风和篇幅', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'设置', exact:true }).first().click();
  const dialog = page.getByRole('dialog', { name:'设置', exact:true });
  const back = dialog.getByRole('button', { name:'返回设置', exact:true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name:'文学预设', exact:true }).click();
  await dialog.getByLabel('防截断破甲模式').check();
  await Promise.all([page.waitForNavigation(), dialog.getByRole('button', { name:'保存预设并刷新' }).click()]);
  const native = await promptTab(page);
  await expect(native.getByRole('button', { name:'打开文学预设控制台' })).toHaveCount(0);
  await native.getByRole('group', { name: '叙事人称' }).getByRole('button', { name: '第一人称' }).click();
  await native.getByRole('radiogroup', { name:'剧情风格' }).getByRole('radio', { name:'冷硬黑色' }).check();
  await tier(native, '高').check();
  await native.getByRole('button', { name:'保存本地设置', exact:true }).click();
  await expect(native.getByRole('status')).toContainText('本地偏好已保存');
  await page.reload();
  const restored = await promptTab(page);
  await expect(restored.getByRole('group', { name: '叙事人称' }).getByRole('button', { name: '第一人称' })).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.getByRole('radiogroup', { name:'剧情风格' }).getByRole('radio', { name:'冷硬黑色' })).toBeChecked();
  await expect(tier(restored, '高')).toBeChecked();
});
