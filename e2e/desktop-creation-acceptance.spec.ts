import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { appearanceTemplates } from '../src/ui/creation/personTemplates';
import { chooseCustomProfession, chooseProfession } from './helpers/creation';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
});

const evidence = 'docs/desktop-creation/acceptance/screenshots';
async function shot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  if (/-(01|02-preset|02-custom|03|04|05)$/.test(name)) {
    await page.locator('.creation-card').evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => scrollTo(0, 0));
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${evidence}/${info.project.name}-${name}.png`, animations: 'disabled' });
}
async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
}
const next = (page: Page) => page.getByRole('button', { name: /下一步/ }).click();
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const step = (page: Page, name: string) => page.getByRole('navigation', { name: '角色创建步骤' }).getByRole('button', { name: new RegExp(name) }).click();
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.list(); } finally { repo.close(); }
  });
}

for (const [width, height] of [[901, 768], [1100, 800], [1440, 900], [1100, 580]]) {
  test(`PC 正式五步、实时档案、键盘、滚动与错误 ${width}x${height}`, async ({ page }, info) => {
    // Five complete UI steps, keyboard navigation and eight real screenshots per viewport.
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST') posts++; });
    await enter(page);
    await expect(page.locator('.desktop-creation')).toBeVisible();
    await page.getByLabel('姓名', { exact: true }).fill('林序');
    await page.getByLabel('年龄', { exact: true }).fill('29');
    await page.getByRole('radio', { name: '女性', exact: true }).check();
    const group = page.getByRole('radiogroup', { name: '外貌模板' });
    const custom = group.getByRole('radio', { name: '自由选择', exact: true });
    await custom.focus(); await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: appearanceTemplates[0].name, exact: true })).toBeFocused();
    await expect(page.getByLabel('外貌', { exact: true })).toHaveValue(appearanceTemplates[0].description);
    await page.keyboard.press('End'); await expect(group.getByRole('radio').last()).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(group.getByRole('radio').nth(appearanceTemplates.length - 1)).toBeFocused();
    await page.keyboard.press('Home'); await expect(custom).toBeFocused();
    await page.getByLabel('外貌', { exact: true }).fill('深色外套，袖口有修补痕迹。');
    await page.getByLabel('性格', { exact: true }).fill('谨慎而不失好奇，遇事先观察。');
    const dossier = page.locator('.creation-dossier');
    await expect(dossier).toContainText('林序'); await expect(dossier).toContainText('29 岁');
    await expect(dossier).toContainText('深色外套');
    await noOverflow(page); await shot(page, info, `${width}x${height}-01`);
    await next(page); await expect(heading(page, '职业与能力')).toBeVisible();
    await page.getByRole('button', { name: '技术与生产', exact: true }).click();
    await chooseProfession(page, '程序员');
    await expect(dossier).toContainText('程序员'); await noOverflow(page);
    await shot(page, info, `${width}x${height}-02-preset`);
    await chooseCustomProfession(page);
    await page.getByLabel('职业名称', { exact: true }).fill('旧籍修复师');
    await page.getByLabel('职业介绍', { exact: true }).fill('修复旧籍，保存社区资料。');
    await page.getByLabel('内置职业技能').fill('纸张修复\n记录');
    await page.getByLabel('长期影响', { exact: true }).fill('与社区合作，长期保存地方记忆。');
    await expect(dossier).toContainText('旧籍修复师');
    await shot(page, info, `${width}x${height}-02-custom`);
    await next(page);
    for (const name of ['重庆', '上海', '哈尔滨', '广州']) {
      await page.getByRole('radio', { name: new RegExp(name) }).check();
      await expect(dossier.locator('.dz-city-seal')).toHaveClass(/on/);
      await expect(dossier).toContainText(name);
    }
    await page.getByLabel('人物背景（可选）').fill('在旧街区长大，后来参与社区档案整理。\n背景全文末行。');
    await noOverflow(page); await shot(page, info, `${width}x${height}-03`);
    await next(page);
    await page.getByRole('checkbox', { name: '创建一名初始同伴' }).check();
    await page.getByLabel('同伴姓名', { exact: true }).fill(' ');
    await page.getByLabel('与主角的关系', { exact: true }).fill(' ');
    await next(page);
    await expect(page.getByRole('alert')).toContainText('同伴');
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await shot(page, info, `${width}x${height}-04-error`);
    for (const [label, value] of Object.entries({ 同伴姓名: '许宁', '同伴年龄（可选）': '28', 同伴身份: '同事',
      与主角的关系: '相识多年的朋友', 同伴外貌: '短发', 同伴性格: '直率', '同伴能力（一行一项）': '排版\n沟通', 同伴个人经历: '曾在外地求学，后来回城。' }))
      await page.getByLabel(label, { exact: true }).fill(value);
    await noOverflow(page); await shot(page, info, `${width}x${height}-04`);
    await next(page);
    await page.getByLabel('开局偏好（可选）').fill('2008年秋天，从平常的一天开始。\n开局偏好末行。');
    await expect(page.locator('.creation-review')).toContainText('背景全文末行');
    await expect(page.locator('.creation-review')).toContainText('曾在外地求学');
    await expect(page.locator('.creation-review')).toContainText('修复旧籍');
    await page.getByLabel('开局偏好（可选）').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '确认并创建存档', exact: true })).toBeInViewport();
    await noOverflow(page); await shot(page, info, `${width}x${height}-05-input`);
    await shot(page, info, `${width}x${height}-05`);
    await page.getByRole('button', { name: '修改基本信息', exact: true }).click();
    await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('林序');
    await step(page, '城市与背景'); await expect(heading(page, '城市与背景')).toBeVisible();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await expect(page.getByLabel('职业名称', { exact: true })).toHaveValue('旧籍修复师');
    await step(page, '确认与开局');
    await page.getByRole('button', { name: '保存为开局包', exact: true }).click();
    await page.getByLabel('开局包名称').fill('正式验收开局包');
    await shot(page, info, `${width}x${height}-pack`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await stored(page)).toEqual([]); expect(posts).toBe(0);
    await page.reload(); await expect(heading(page, '确认与开局')).toBeVisible();
    await expect(page.getByLabel('开局偏好（可选）')).toHaveValue(/开局偏好末行/);
  });
}

for (const width of [375, 390]) test(`手机人生车票保持、断点切换及跳过 ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await enter(page);
  await expect(page.locator('.mobile-creation')).toBeVisible();
  await expect(page.locator('.creation-dossier')).toHaveCount(0);
  await page.getByLabel('姓名', { exact: true }).fill('车票旅人');
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByRole('radio', { name: '男性', exact: true }).check();
  await shot(page, info, `${width}-ticket-01`);
  await page.setViewportSize({ width: 901, height: 844 });
  await expect(page.locator('.creation-dossier')).toContainText('车票旅人');
  await page.setViewportSize({ width, height: 844 });
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('车票旅人');
  await next(page);
  await page.getByLabel('职业名称', { exact: true }).fill('修复师');
  await next(page); await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await expect(page.locator('.creation-ticket-stub').first()).toBeVisible();
  await page.getByLabel('开局偏好（可选）').fill('2015年秋天');
  await noOverflow(page); await shot(page, info, `${width}-ticket-05`);
  expect(await stored(page)).toEqual([]);
});

test('PC 保存中印章与首次建档失败恢复；已有存档不变且只创建一次', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  await enter(page);
  await page.evaluate(async () => {
    const m = '/src/ui/creation/model.ts', r = '/src/services/storage/saveRepository.ts';
    const { newCreation } = await import(m), { SaveRepository } = await import(r);
    const existing = newCreation(); existing.customProfession = '记录员'; existing.person = { name: '已有旅人', age: '32', gender: '男性', appearance: '', personality: '' };
    // Existing independent save is installed via the same formal creation helper.
    const { createProfileSave } = await import(m);
    const settingsPath = '/src/ui/settings/model.ts', { defaultSettings } = await import(settingsPath);
    const repo = await SaveRepository.open();
    try { await createProfileSave(repo, existing, defaultSettings()); } finally { repo.close(); }
  });
  const before = await stored(page);
  const beforeGame = await page.evaluate(async id => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame(id); } finally { repo.close(); }
  }, before[0].saveId);
  await page.getByLabel('姓名', { exact: true }).fill('新旅人');
  await page.getByLabel('年龄', { exact: true }).fill('28');
  await page.getByRole('radio', { name: '女性', exact: true }).check();
  await next(page);
  await page.getByLabel('职业名称', { exact: true }).fill('修复师');
  await step(page, '确认与开局');
  await page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), real = SaveRepository.prototype.create;
    const control = { calls: 0, release: () => {} };
    Reflect.set(window, '__creationControl', control);
    SaveRepository.prototype.create = async function(...args: Parameters<typeof real>) {
      control.calls++;
      if (control.calls === 1) throw new Error('正式验收：首次存储拒绝');
      await new Promise<void>(resolve => { control.release = resolve; });
      return real.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('首次存储拒绝');
  expect(await stored(page)).toEqual(before);
  await shot(page, info, '1440-save-failure');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click({ clickCount: 2 });
  await expect(page.locator('.wizard-footer button[type=submit]')).toHaveText('正在保存…');
  await expect(page.locator('.wizard-footer button[type=submit]')).toBeDisabled();
  await expect(page.locator('.dz-big-seal')).toHaveClass(/on/);
  await shot(page, info, '1440-saving');
  expect(await page.evaluate(() => Reflect.get(window, '__creationControl').calls)).toBe(2);
  await page.evaluate(() => Reflect.get(window, '__creationControl').release());
  await expect(page.locator('.game-layout')).toBeVisible();
  const after = await stored(page); expect(after).toHaveLength(2);
  expect(after.find((save: { saveId: string }) => save.saveId === before[0].saveId)).toEqual(before[0]);
  expect(await page.evaluate(async id => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame(id); } finally { repo.close(); }
  }, before[0].saveId)).toEqual(beforeGame);
  await page.reload(); expect(await stored(page)).toEqual(after);
  expect(posts).toBe(0);
});
