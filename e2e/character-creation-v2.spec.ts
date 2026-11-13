import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { appearanceTemplates, personalityTemplates } from '../src/ui/creation/personTemplates';
import professions from '../src/ui/creation/professions.json' with { type: 'json' };
const professionCategories = [...new Set(professions.map(job => job.category))];
import { chooseCustomProfession, chooseProfession, mobileCreation, showPersonalSkills, showCreationReview } from './helpers/creation';
import { closeWorkflowSheet, openGameTools, openProfile } from './helpers/gameLayout';

async function begin(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟');
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByRole('radio', { name: '女性', exact: true }).check();
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole('radiogroup', { name: label, exact: true }).getByRole('radio', { name: value, exact: true }).click();
}
const template = (page: Page, label: string, value: string) =>
  page.getByRole('radiogroup', { name: label, exact: true }).getByRole('radio', { name: value, exact: true });
async function confirm(page: Page) {
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await showCreationReview(page);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('基本信息模板独立、可编辑、往返与刷新保留；键盘选择', async ({ page }, info) => {
  await begin(page);
  await expect(page.getByRole('group', { name: '性别', exact: true }).getByRole('radio')).toHaveCount(2);
  await expect(template(page, '外貌模板', '自由选择')).toHaveAttribute('aria-checked', 'true');
  await expect(template(page, '性格模板', '自由选择')).toHaveAttribute('aria-checked', 'true');
  for (const item of appearanceTemplates) {
    await choose(page, '外貌模板', item.name); await expect(page.getByLabel('外貌', { exact: true })).toHaveValue(item.description);
    await expect(page.getByLabel('性格', { exact: true })).toHaveValue('');
  }
  for (const item of personalityTemplates) {
    await choose(page, '性格模板', item.name); await expect(page.getByLabel('性格', { exact: true })).toHaveValue(item.description);
    await expect(page.getByLabel('外貌', { exact: true })).toHaveValue(appearanceTemplates.at(-1)!.description);
  }
  await template(page, '外貌模板', appearanceTemplates.at(-1)!.name).focus();
  await page.keyboard.press('Home');
  await expect(template(page, '外貌模板', '自由选择')).toHaveAttribute('aria-checked', 'true');
  await expect(template(page, '外貌模板', '自由选择')).toBeFocused();
  const appearance = appearanceTemplates[0].description + '\n手背有淡淡旧痕。';
  await page.getByLabel('外貌', { exact: true }).fill(appearance);
  await page.getByLabel('性格', { exact: true }).fill('平日谨慎，今天愿意主动冒险。');
  await page.getByRole('button', { name: /下一步/ }).click(); await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.reload(); await expect(page.getByLabel('外貌', { exact: true })).toHaveValue(appearance);
  await expect(page.getByLabel('性格', { exact: true })).toHaveValue('平日谨慎，今天愿意主动冒险。');
  await expect(page.getByRole('radio', { name: '女性', exact: true })).toBeChecked();
  await noOverflow(page);
  await page.screenshot({ path: `docs/screenshots/character-creation-v2/${info.project.name}-basics.png`, fullPage: true });
});

test('五类各六职业，点击呈现完整介绍、独立技能与长期影响', async ({ page }, info) => {
  await begin(page); await page.getByRole('button', { name: /下一步/ }).click();
  if (mobileCreation(page)) await expect(page.getByRole('button', { name: '✎ 自由选择', exact: true })).toHaveAttribute('aria-pressed', 'true');
  else await expect(page.getByRole('radio', { name: '自由选择', exact: true })).toBeChecked();
  for (const category of professionCategories) {
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect(page.getByRole('radio')).toHaveCount(mobileCreation(page) ? 6 : 7);
    for (const job of professions.filter(job => job.category === category)) {
      await chooseProfession(page, job.name);
      const profile = page.getByRole('region', { name: '职业档案', exact: true });
      await expect(profile).toContainText(job.description); await expect(profile).toContainText(job.longTermImpact);
      await expect(profile.locator('li')).toHaveText(job.skills);
      await showPersonalSkills(page);
      await expect(page.getByLabel('个人技能与专长')).toHaveValue(job.skills.join('\n'));
    }
  }
  await page.getByRole('button', { name: '企业与商业', exact: true }).click();
  await chooseProfession(page, '企业经营者');
  await noOverflow(page);
  await page.screenshot({ path: `docs/screenshots/character-creation-v2/${info.project.name}-professions.png`, fullPage: true });
  await confirm(page);
  const job = professions.find(job => job.name === '企业经营者')!;
  await expect(page.getByRole('region', { name: '职业档案', exact: true })).toContainText(job.longTermImpact);
});

test('自定义四项跨预设保存、确认、正式档案与重载；纯UI无模型调用', async ({ page }, info) => {
  const requests: string[] = [];
  await page.route('https://**/*', async route => { requests.push(route.request().url()); await route.abort(); });
  await begin(page); await page.getByRole('button', { name: /下一步/ }).click();
  const custom = { name: '古籍修复师', description: '在社区工作室修复旧书。\n日常记录纸张、装帧与修补过程。', skills: '纸张辨识\n修补\n配色\n装帧\n记录\n沟通', impact: '与图书馆和收藏者合作，保留耐心观察的习惯。\n仍愿意尝试全新的生活。' };
  await page.getByLabel('职业名称', { exact: true }).fill(custom.name);
  await page.getByLabel('职业介绍', { exact: true }).fill(custom.description);
  await page.getByLabel('内置职业技能', { exact: true }).fill(custom.skills);
  await page.getByLabel('长期影响', { exact: true }).fill(custom.impact);
  await page.getByRole('button', { name: '技术与生产', exact: true }).click();
  await chooseProfession(page, '程序员'); await page.reload();
  await chooseCustomProfession(page);
  await expect(page.getByLabel('职业名称', { exact: true })).toHaveValue(custom.name);
  await expect(page.getByLabel('职业介绍', { exact: true })).toHaveValue(custom.description);
  await expect(page.getByLabel('内置职业技能', { exact: true })).toHaveValue(custom.skills);
  await expect(page.getByLabel('长期影响', { exact: true })).toHaveValue(custom.impact);
  await noOverflow(page);
  await page.screenshot({ path: `docs/screenshots/character-creation-v2/${info.project.name}-custom.png`, fullPage: true });
  await confirm(page);
  const profile = page.getByRole('region', { name: '职业档案', exact: true });
  await expect(profile).toContainText(custom.description); await expect(profile).toContainText(custom.impact);
  await expect(profile.locator('li')).toHaveText(custom.skills.split('\n'));
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.locator('.game-layout')).toBeVisible();
  await page.reload(); await openGameTools(page);
  if (mobileCreation(page)) {
    await closeWorkflowSheet(page);
    await page.getByRole('button', { name: '此时此地与主角状态', exact: true }).click();
    await page.getByRole('button', { name: '人物档案', exact: true }).click();
  } else await openProfile(page);
  const dialog = page.getByRole('dialog', { name: '人物档案', exact: true });
  await expect(dialog).toContainText(custom.name); await expect(dialog).toContainText(custom.description);
  await expect(dialog).toContainText(custom.impact); await expect(dialog.locator('.skill-tags li')).toHaveText(custom.skills.split('\n'));
  await noOverflow(page); await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load(location.hash.slice(6)); } finally { repo.close(); }
  });
  expect(saved.protagonist).toMatchObject({ profession: custom.name, professionDescription: custom.description, professionLongTermImpact: custom.impact, skills: custom.skills.split('\n'), gender: '女性' });
  expect(saved.economy.cash).toBeNull(); expect(saved.items).toEqual({}); expect(saved.organizations).toEqual({});
  expect(requests).toEqual([]);
});
