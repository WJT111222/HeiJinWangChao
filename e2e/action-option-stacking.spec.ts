import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// 行动建议可叠加：点第二个建议会用中文逗号接在后面，不再替换掉前一个；已包含的不重复添加。
const options = ['先去泊位看货', '打电话给调度科', '追问老周货主是谁'];
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async (actionOptions) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }] = await Promise.all(paths.map((p) => import(p)));
    const repo = await SaveRepository.open(), state = worldState(); state.openingCityId = 'shanghai'; state.protagonist.name = '沈砚';
    await repo.create(state); const draft = await completeDraft(repo, { actionOptions });
    await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true }); repo.close();
  }, options);
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
function option(page: Page, index: number, mobile: boolean) {
  return mobile ? page.locator('.rail-cards .opt').nth(index) : page.locator('.action-options button').nth(index);
}
async function pick(page: Page, index: number, mobile: boolean) {
  const button = option(page, index, mobile);
  await button.scrollIntoViewIfNeeded(); await button.click();
}

test('点多个行动建议会叠加，已包含的不重复，自己写的文字保留', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await seed(page);
  const input = page.locator('#player-input');
  await pick(page, 0, mobile);
  await expect(input).toHaveValue('先去泊位看货');
  await pick(page, 1, mobile);
  await expect(input).toHaveValue('先去泊位看货，打电话给调度科');
  await expect(option(page, 0, mobile)).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, 1, mobile)).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, 2, mobile)).toHaveAttribute('aria-pressed', 'false');
  await pick(page, 0, mobile);
  await expect(input).toHaveValue('先去泊位看货，打电话给调度科');
  await input.fill('我把烟掐了。');
  await pick(page, 2, mobile);
  await expect(input).toHaveValue('我把烟掐了。追问老周货主是谁');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
});

test('电脑端数字快捷键同样叠加', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '数字快捷键只在电脑端启用');
  await seed(page);
  const input = page.locator('#player-input');
  await page.getByTestId('story-reader').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('1'); await expect(input).toHaveValue('先去泊位看货');
  await page.getByTestId('story-reader').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('3'); await expect(input).toHaveValue('先去泊位看货，追问老周货主是谁');
});
