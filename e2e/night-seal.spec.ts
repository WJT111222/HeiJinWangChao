import { mkdir } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import { seedNightSeal, nightSealStored } from './helpers/nightSeal';
import { openProfile, openWorldArchive } from './helpers/gameLayout';

const screenshots = '/tmp/ui2-legacy-night-seal-screenshots';
test('夜幕金印：真实已结算存档、四导航、阅读与视觉验收', async ({ page }, info) => {
  test.setTimeout(60000);
  const requests: string[] = [];
  await page.route('https://**/*', async route => { requests.push(route.request().url()); await route.abort(); });
  await mkdir(screenshots, { recursive: true });
  const mobile = info.project.name === 'mobile';
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await seedNightSeal(page);
  await expect(page.locator('.save-card')).toHaveCount(1);
  await page.screenshot({ path: `${screenshots}/after-home-${info.project.name}.png`, fullPage: true });
  const choose = page.getByRole('button', { name: '选择', exact: true });
  if (await choose.isVisible()) await choose.click();
  else await expect(page.locator('.save-card')).toHaveClass(/selected/);
  await page.locator('.lib-top .back').click();
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  const before = await nightSealStored(page);
  await expect(page.locator('.story-entry')).toHaveCount(2);
  await expect(page.locator('.workflow-disclosure > summary')).toContainText('本回合已结算');
  await expect(page.locator('.action-options button')).toHaveCount(3);
  await page.locator('.action-options button').first().click();
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('回复编辑，确认明天的会面');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.getByTestId('story-reader').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${screenshots}/after-game-${info.project.name}.png` });
  if (mobile) {
    const nav = page.getByRole('navigation', { name: '底部导航' });
    await expect(nav.getByRole('button')).toHaveText(['故事', '人物', '世界资料', '设置']);
    await nav.getByRole('button', { name: '故事', exact: true }).click();
    await expect(page.getByTestId('story-reader')).toBeFocused();
    await nav.getByRole('button', { name: '人物', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '人物档案', exact: true })).toContainText('记者');
    await page.keyboard.press('Escape');
    await expect(nav.getByRole('button', { name: '人物', exact: true })).toBeFocused();
    await openWorldArchive(page);
    await page.screenshot({ path: `${screenshots}/after-world-mobile.png` });
    const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
    for (const name of ['NPC', '势力组织', '地图', '物品栏', '世界事件', '历史时间轴', '记忆']) {
      const opener = directory.getByRole('button', { name, exact: true });
      await opener.click(); await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
    }
    await page.keyboard.press('Escape'); await expect(nav.getByRole('button', { name: '世界资料', exact: true })).toBeFocused();
    await nav.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(nav.getByRole('button', { name: '设置', exact: true })).toBeFocused();
    await page.getByLabel('你的行动', { exact: true }).focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 420 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect.poll(async () => (await page.locator('.app-shell-game').boundingBox())!.height).toBe(420);
    expect((await page.getByTestId('story-reader').boundingBox())!.height).toBeGreaterThan(60);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${screenshots}/after-keyboard-mobile.png` });
    await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')); });
    await page.getByLabel('你的行动', { exact: true }).blur();
    await expect.poll(async () => (await page.locator('.app-shell-game').boundingBox())!.height).toBe(844);
  } else {
    await expect(page.getByRole('navigation', { name: '世界资料分类' }).getByRole('button')).toHaveCount(7);
    await openProfile(page);
    await page.screenshot({ path: `${screenshots}/after-long-profile.png` });
    const body = page.getByRole('dialog', { name: '人物档案', exact: true }).locator('.modal-body');
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.keyboard.press('Escape');
  }
  expect(await nightSealStored(page)).toEqual(before);
  expect(requests).toEqual([]);
  // Prepare a real, fully validated pending candidate for the expanded workflow capture.
  await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts', turnPath = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(repoPath), { completeDraft } = await import(turnPath), repo = await SaveRepository.open();
    const draft = await repo.loadDraft('save-a'); await repo.bindTurnAction(draft, '回复编辑', true, true);
    await completeDraft(repo, { narrative: '【旁白】沈砚确认了明天的会面，把手机放回口袋。',
      variables: { commands: [{ type: 'SetWorldClock', commandId: 'visual-clock-3', worldClock: '2026-10-18T08:30:00+08:00', evidence: '沈砚确认了明天的会面。' }], rejectedSuggestions: [], unresolved: [] } });
    repo.close();
  });
  await page.reload();
  await page.locator('.workflow-disclosure > summary').click();
  await expect(page.getByRole('button', { name: '重新 Roll', exact: true })).toBeEnabled();
  await expect(page.locator('.workflow-stages > li')).toHaveCount(3);
  await page.screenshot({ path: `${screenshots}/after-workflow-${info.project.name}.png` });
});

test('长姓名、巨大金额及短横屏保持阅读与真实资料可访问', async ({ page }) => {
  test.setTimeout(60000);
  await seedNightSeal(page, true);
  await page.getByRole('button', { name: /读取存档/ }).click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 900, height: 700 }, { width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    expect((await page.getByTestId('story-reader').boundingBox())!.height).toBeGreaterThan(50);
    await expect(page.getByLabel('你的行动', { exact: true })).toBeInViewport({ ratio: 1 });
    await openProfile(page);
    await expect(page.getByRole('dialog', { name: '人物档案', exact: true })).toContainText('长期记录者');
    await page.keyboard.press('Escape');
    if (viewport.width === 320) {
      await openWorldArchive(page);
      await page.getByRole('navigation', { name: '世界资料分类' }).getByRole('button', { name: 'NPC', exact: true }).click();
      const npc = page.getByRole('dialog', { name: 'NPC', exact: true });
      await npc.getByRole('button', { name: /^查看人物：来自很远地方/ }).click();
      expect(await npc.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    }
  }
});
