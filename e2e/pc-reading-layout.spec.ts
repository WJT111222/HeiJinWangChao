import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import { seedNightSeal, nightSealStored } from './helpers/nightSeal';

const destination = 'docs/ui-pc-reading/screenshots';
const sizes = [
  { width: 1650, height: 927 }, { width: 1440, height: 900 },
  { width: 1280, height: 800 }, { width: 1024, height: 768 },
  { width: 1024, height: 520 }, { width: 390, height: 844 },
];

test('PC 阅读布局：同场景视口截图与尺寸记录', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(60000);
  await mkdir(destination, { recursive: true });
  const external: string[] = [];
  await page.route('https://**/*', async route => { external.push(route.request().url()); await route.abort(); });
  await seedNightSeal(page);
  await page.evaluate(async () => {
    const storagePath = '/src/services/storage/saveRepository.ts', turnPath = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(storagePath), { completeDraft } = await import(turnPath);
    const repo = await SaveRepository.open(), draft = await repo.loadDraft('save-a');
    await repo.bindTurnAction(draft, '继续沿江采访', true, true);
    const candidate = await completeDraft(repo, {
      narrative: '【旁白】江边的风吹过街巷，沈砚停下脚步，记录采访中的细节。城市的灯光渐次亮起，新的线索还在等待确认。\n\n'.repeat(18)
        + '【沈砚】明天见面时，我会带上这些记录。\n\n【许知遥】沿着这条路走，前面就是旧书店。',
      actionOptions: ['回复编辑，确认明天的会面', '沿着江边步道走一走', '给熟悉的朋友打个电话'],
      variables: { commands: [{ type: 'SetWorldClock', commandId: 'pc-layout-clock', worldClock: '2026-10-18T08:30:00+08:00', evidence: '沈砚继续沿江采访。' }], rejectedSuggestions: [], unresolved: [] },
    });
    await repo.commitTurn({ draft: candidate, nextAction: '', useVariableStage: true, useWorldStage: true });
    repo.close();
  });
  await page.goto('/#game/save-a'); await page.reload();
  const reader = page.getByTestId('story-reader');
  await expect(reader).toBeVisible();
  await page.locator('.action-options button').first().click();
  const stored = await nightSealStored(page);
  const phase = process.env.PC_LAYOUT_CAPTURE || 'after';
  const measurements = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await reader.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${destination}/${phase}-${size.width}x${size.height}.png` });
    measurements.push(await page.evaluate(({ width, height }) => {
      const box = (selector: string) => {
        const el = document.querySelector(selector)!, rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return { viewport: { width, height }, header: box('.app-header'), status: box('.player-status'),
        story: box('.reader-heading'), composer: box('.composer-action-row'), reader: box('.reader'),
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    }, size));
    if (phase === 'before') continue;
    expect(measurements.at(-1)!.overflow).toBe(false);
    await expect(page.getByLabel('你的行动', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
    if (size.width > 900) {
      await expect(page.locator('.app-header')).toBeHidden();
      expect(measurements.at(-1)!.status.y).toBe(0);
      // UI-2：≥1200px 主角信息为左栏，正文铺满中栏（两侧 40px，上限 1100px）；901–1199px 仍为 UI-1.1 顶部状态条。
      const wide = size.width >= 1200;
      if (wide) { expect(measurements.at(-1)!.status.x).toBe(0); expect(measurements.at(-1)!.status.width).toBeLessThanOrEqual(290); }
      const expected = size.width >= 1650 ? [1040, 1100] : size.width >= 1440 ? [880, 910] : wide ? [740, 760] : [700, 850];
      expect(measurements.at(-1)!.story.width).toBeGreaterThanOrEqual(expected[0]);
      expect(measurements.at(-1)!.story.width).toBeLessThanOrEqual(expected[1]);
      expect(Math.abs(measurements.at(-1)!.story.width - measurements.at(-1)!.composer.width)).toBeLessThan(2);
      expect(Math.abs(measurements.at(-1)!.story.x - measurements.at(-1)!.composer.x)).toBeLessThan(2);
      await expect(page.locator('.game-corner-brand')).toBeInViewport({ ratio: 1 });
      const brand = (await page.locator('.game-corner-brand').boundingBox())!;
      const row = (await page.locator('.composer-action-row').boundingBox())!;
      expect(brand.x + brand.width).toBeLessThan(row.x);
      await expect(page.getByRole('navigation', { name: '世界资料分类' }).getByRole('button')).toHaveCount(7);
      const system = page.getByRole('navigation', { name: '系统操作' });
      await expect(system.locator('button > span:last-child')).toHaveText(['设置', '返回首页']);
      await system.getByRole('button', { name: '返回首页', exact: true }).scrollIntoViewIfNeeded();
      await expect(system.getByRole('button', { name: '返回首页', exact: true })).toBeInViewport({ ratio: .99 });
      if (size.height === 520) await page.screenshot({ path: `${destination}/after-short-dock.png` });
      await reader.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(page.locator('.action-options')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${destination}/after-options-${size.width}x${size.height}.png` });
      const alignments = await page.locator('.reader-heading, .chapter-heading, .story-entry .prose:not(.story-bubble), .story-reading, .action-options, .workflow, .composer-action-row').evaluateAll(elements => elements.map(el => ({ className: el.className, x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })));
      for (const rect of alignments) {
        expect(Math.abs(rect.x - measurements.at(-1)!.story.x), rect.className).toBeLessThan(2);
        expect(Math.abs(rect.width - measurements.at(-1)!.story.width), rect.className).toBeLessThan(2);
      }
      for (const bubble of await page.locator('.story-bubble').all()) {
        const box = (await bubble.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(measurements.at(-1)!.story.x);
        expect(box.x + box.width).toBeLessThanOrEqual(measurements.at(-1)!.story.x + measurements.at(-1)!.story.width + 1);
      }
      await reader.evaluate(el => { el.scrollTop = 250; });
      const position = await reader.evaluate(el => el.scrollTop);
      await system.getByRole('button', { name: '设置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(system.getByRole('button', { name: '设置', exact: true })).toBeFocused();
      expect(await reader.evaluate(el => el.scrollTop)).toBe(position);
      await page.locator('.workflow-disclosure > summary').click();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
      const details = (await page.locator('.workflow-details').boundingBox())!;
      expect(Math.abs(details.x - row.x)).toBeLessThan(2);
      expect(Math.abs(details.width - row.width)).toBeLessThan(2);
      await page.screenshot({ path: `${destination}/after-workflow-${size.width}x${size.height}.png` });
      await page.locator('.workflow-disclosure > summary').click();
    } else {
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.locator('.game-corner-brand')).toBeHidden();
      const nav = page.getByRole('navigation', { name: '底部导航' });
      await expect(nav.getByRole('button')).toHaveText(['故事', '人物', '世界资料', '设置']);
      await nav.getByRole('button', { name: '世界资料', exact: true }).click();
      await expect(page.getByRole('navigation', { name: '世界资料分类' }).getByRole('button')).toHaveCount(7);
      await expect(page.getByRole('navigation', { name: '系统操作' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  }
  expect(await nightSealStored(page)).toEqual(stored);
  expect(external).toEqual([]);
  await writeFile(`docs/ui-pc-reading/${phase}-measurements.json`, JSON.stringify(measurements, null, 2) + '\n');
  if (phase === 'after') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('navigation', { name: '系统操作' }).getByRole('button', { name: '返回首页', exact: true }).click();
    await expect(page.locator('.home-page')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();
  }
});

test('PC 长状态限高、完整资料、九入口短屏可访问', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await seedNightSeal(page, true);
  await page.getByRole('button', { name: /读取存档/ }).click();
  const before = await nightSealStored(page);
  for (const size of [...sizes.filter(size => size.width > 900), { width: 901, height: 600 }, { width: 2560, height: 1080 }]) {
    await page.setViewportSize(size);
    const status = (await page.locator('.player-status').boundingBox())!;
    // ≥1200px：左栏固定宽度、内部滚动；更窄时仍为限高的顶部状态条。
    if (size.width >= 1200) {
      expect(status.x).toBe(0); expect(status.width).toBeLessThanOrEqual(290);
      // The shell height follows VisualViewport on the next frame; the column must never exceed it.
      await expect.poll(async () => (await page.locator('.player-status').boundingBox())!.height).toBeLessThanOrEqual(size.height + 1);
    }
    else expect(status.height).toBeLessThan(100);
    expect((await page.locator('.reader-heading').boundingBox())!.width).toBeLessThanOrEqual(size.width >= 1200 ? 1100 : 1180);
    await expect(page.locator('.status-identity h2')).toHaveAttribute('title', '沈砚与城市旧事档案的长期记录者'.repeat(5));
    await expect(page.locator('.status-condition')).toBeVisible();
    await expect(page.locator('.status-online')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.locator('.game-layout > .world-sidebar button').all()) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: .99 });
    }
    await page.getByRole('button', { name: '人物档案', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '人物档案', exact: true })).toContainText('沈砚与城市旧事档案的长期记录者'.repeat(5));
    await expect(page.getByRole('dialog', { name: '人物档案', exact: true })).toContainText('身体状态保持稳定，需要适时休息。'.repeat(50));
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1024, height: 520 });
  await page.screenshot({ path: `${destination}/after-long-status.png` });
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.game-corner-brand')).toBeHidden();
  await expect(page.getByRole('navigation', { name: '系统操作' })).toHaveCount(0);
  expect(await nightSealStored(page)).toEqual(before);
});
