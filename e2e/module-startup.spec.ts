import { test, expect } from './helpers/test';
import { writeFile } from 'node:fs/promises';
import { seed, raw } from './helpers/turnChanges';

// Actual Vite dev server + React entry/lazy game modules; no model calls.
test('首页、五步创角与开局包、懒加载游戏正文和回合变化正常启动', async ({ page }, info) => {
  const errors: string[] = [], moduleErrors: string[] = []; let posts = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /does not provide an export|Failed to resolve import|Failed to fetch dynamically imported module|SyntaxError/i.test(message.text())) moduleErrors.push(message.text());
  });
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.route('https://**/*', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('home.png') });
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '我的开局包', exact: true })).toContainText('暂无可用开局包');
  await page.getByRole('button', { name: '关闭开局包', exact: true }).click();
  await page.screenshot({ path: info.outputPath('creation.png') });
  await page.evaluate(async () => {
    const paths = ['/src/ui/creation/model.ts', '/src/ui/creation/openingPacks.ts'];
    const [{ newCreation }, { OpeningPackStore }] = await Promise.all(paths.map(path => import(path)));
    const form = newCreation();
    Object.assign(form, { person: { name: '许岚', age: '29', gender: '女性', appearance: '衣着素净', personality: '谨慎' },
      customProfession: '修复师', skills: '修补\n记录', skillsSource: 'manual', background: '合成背景', openingPreference: '2008年秋天' });
    new OpeningPackStore(localStorage).save('跨平台开局包', form);
  });
  await page.getByRole('button', { name: '我的开局包', exact: true }).click();
  await page.getByRole('radio', { name: /跨平台开局包/ }).check();
  await page.getByRole('button', { name: '套用开局包', exact: true }).click();
  await page.getByRole('button', { name: '确认替换并套用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.creation.v1')!).step)).toBe(5);
  const nav = page.getByRole('navigation', { name: '角色创建步骤' });
  for (const [i, name] of ['基本信息', '职业与能力', '城市与背景', '初始同伴', '确认与开局'].entries()) {
    await nav.getByRole('button', { name: new RegExp(name) }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.creation.v1')!).step)).toBe(i + 1);
  }
  await expect(page.getByRole('button', { name: '保存为开局包', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('opening-pack-review.png') });
  // Use a fresh synthetic committed save with a reliable comparison checkpoint.
  await seed(page);
  const before = await raw(page);
  await expect(page.getByTestId('story-reader').locator('.story-reading').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('game.png') });
  const changes = page.locator('.chg-btn'); await expect(changes).toBeEnabled(); await changes.click();
  await expect(page.getByRole('region', { name: '本回合变化', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本回合变化', exact: true }).locator('.chg-grp')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('turn-changes.png') });
  expect(await raw(page)).toEqual(before);
  expect(posts).toBe(0); expect(errors).toEqual([]); expect(moduleErrors).toEqual([]);
  await writeFile(info.outputPath('startup-result.json'), JSON.stringify({ viewport: page.viewportSize(), posts, errors, moduleErrors }, null, 2));
});
