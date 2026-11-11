import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// UI-2 临界宽度：1199 仍为 UI-1.1 顶部状态条，1200 起为三栏。长地点/天气/环境文本不得撑出或遮挡。
const longPlace = '解放碑步行街东侧临江老巷子里第三家通宵营业的旧书店门口';
const longDistrict = '渝中区解放碑商圈旧城改造片区';
const longWeather = '小雨初歇，江面起雾，夜里可能转为中雨并伴有阵风';
const longEnvironment = '路灯初亮，江边的晚风吹过街巷，摊主陆续拉下卷帘门，积水里映着霓虹，行人撑伞匆匆走过。'.repeat(3);

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async ({ longPlace, longDistrict, longWeather, longEnvironment }) => {
    const repoPath = '/src/services/storage/saveRepository.ts', worldPath = '/src/tests/fixtures/world.ts', turnPath = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(repoPath), { worldState } = await import(worldPath), { completeDraft } = await import(turnPath);
    const repo = await SaveRepository.open(), state = worldState();
    state.protagonist.name = '沈砚'; state.protagonist.profession = '记者';
    state.weatherText = longWeather; state.environmentText = longEnvironment;
    state.locations.ui2_district = { id: 'ui2_district', name: longDistrict, parentId: 'chongqing' };
    state.locations.ui2_place = { id: 'ui2_place', name: longPlace, parentId: 'ui2_district' };
    state.protagonist.locationId = 'ui2_place';
    for (const person of Object.values(state.npc) as { onScene: boolean; locationId?: string }[]) if (person.onScene) person.locationId = 'ui2_place';
    await repo.create(state);
    const narrative = '【旁白】傍晚的雨刚停，轻轨从楼群中间穿过。沈砚收起伞，看着对面山坡上一层层亮起的窗。\n\n【许知遥】这么晚还没睡？\n\n【沈砚】睡不着。明天要见编辑，我想先听听你的意见。';
    const candidate = await completeDraft(repo, { narrative, summary: '沈砚在江边与许知遥通话。',
      actionOptions: ['回复编辑，确认明天上午十点在报社旧楼的会客室见面', '沿着江边步道一直走到朝天门再折返', '给熟悉的朋友打个电话'],
      variables: { commands: [], rejectedSuggestions: [], unresolved: [] } });
    await repo.commitTurn({ draft: candidate, nextAction: '', useVariableStage: true, useWorldStage: true });
    repo.close();
  }, { longPlace, longDistrict, longWeather, longEnvironment });
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
}
type Box = { x: number; y: number; width: number; height: number };
const right = (b: Box) => b.x + b.width;
const overlaps = (a: Box, b: Box) => a.x < right(b) - 1 && b.x < right(a) - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

test('UI-2 1199至1920宽度：正文、行动区、横栏不变窄、不溢出、不遮挡', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90000);
  const external: string[] = [];
  await page.route('https://**/*', async route => { external.push(route.request().url()); await route.abort(); });
  await seed(page);
  const reader = page.getByTestId('story-reader');
  const widths: Record<number, number> = {};
  for (const width of [1199, 1200, 1201, 1280, 1440, 1650, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await reader.evaluate(el => { el.scrollTop = el.scrollHeight; });
    // 已结算正文没有结算装饰伪元素，章回标题仍正常显示。
    await expect(page.locator('.chapter-heading')).toHaveText('第 1 回合');
    expect(await page.locator('.story-entry').evaluateAll(elements => elements.map(el => getComputedStyle(el, '::after').content))).toEqual(['none']);
    // 阅读区自身不出现横向滚动。
    expect(await reader.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    const heading = (await page.locator('.reader-heading').boundingBox())!;
    const options = (await page.locator('.action-options').boundingBox())!;
    const row = (await page.locator('.composer-action-row').boundingBox())!;
    widths[width] = heading.width;
    expect(heading.width, `正文宽度 @${width}`).toBeGreaterThanOrEqual(640);
    expect(Math.abs(options.x - heading.x)).toBeLessThan(2); expect(Math.abs(options.width - heading.width)).toBeLessThan(2);
    expect(Math.abs(row.x - heading.x)).toBeLessThan(2); expect(Math.abs(row.width - heading.width)).toBeLessThan(2);
    await expect(page.locator('.action-options')).toBeInViewport({ ratio: 1 });
    for (const option of await page.locator('.action-options button').all()) {
      expect(await option.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await expect(page.getByLabel('你的行动', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });

    const status = (await page.locator('.player-status').boundingBox())!;
    const place = page.locator('.status-place');
    await expect(place).toBeVisible();
    const placeBox = (await place.boundingBox())!;
    // 横栏内容被截断而不是撑出容器。
    expect(await place.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const parts = await place.locator(':scope > *').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    for (const part of parts) { expect(part.x).toBeGreaterThanOrEqual(placeBox.x - 1); expect(right(part)).toBeLessThanOrEqual(right(placeBox) + 1); }
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (width >= 1200) expect(overlaps(parts[i], parts[j]), `横栏字段 ${i}/${j} 重叠 @${width}`).toBe(false);
    await expect(place.locator('.status-location')).toHaveAttribute('title', `重庆 › ${longDistrict} › ${longPlace}`);
    await expect(place.locator('.status-weather')).toHaveAttribute('title', longWeather);
    await expect(place.locator('.status-environment')).toHaveAttribute('title', longEnvironment);

    const sidebar = (await page.locator('.game-layout > .world-sidebar').boundingBox())!;
    if (width >= 1200) {
      // 三栏：横栏位于左栏与右栏之间，不遮挡两侧；天气和环境分开显示。
      expect(status.x).toBe(0);
      expect(placeBox.x).toBeGreaterThanOrEqual(right(status) - 1);
      expect(right(placeBox)).toBeLessThanOrEqual(sidebar.x + 1);
      expect(placeBox.y + placeBox.height).toBeLessThanOrEqual(heading.y);
      await expect(place.locator('.status-weather small')).toHaveText('天气');
      await expect(place.locator('.status-environment small')).toHaveText('环境');
      expect(overlaps(placeBox, (await page.locator('.game-corner-brand').boundingBox())!)).toBe(false);
    } else {
      // 1199：仍是 UI-1.1 顶部状态条。
      expect(status.width).toBeGreaterThan(900);
      expect(status.height).toBeLessThan(100);
      expect(placeBox.y + placeBox.height).toBeLessThanOrEqual(status.y + status.height + 1);
    }
    expect(right(heading)).toBeLessThanOrEqual(sidebar.x);
    await page.screenshot({ path: info.outputPath(`ui2-${width}x800.png`) });
    if (process.env.UI2_SHOT_DIR) await page.screenshot({ path: `${process.env.UI2_SHOT_DIR}/breakpoint-${width}x800.png` });
  }
  // 1200 不得比 1201 明显更窄（临界点无塌陷）。
  expect(Math.abs(widths[1200] - widths[1201])).toBeLessThan(4);
  expect(external).toEqual([]);
});
