import { expect, test } from './helpers/test';
import { enterArchiveGame, openArchive } from './helpers/mobileArchives';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';

test.afterEach(async ({ page }, info) => {
  await page.unrouteAll({ behavior: 'wait' });
  await rm(info.outputPath('production-app'), {recursive: true, force: true});
});

for (const build of ['development', 'production'] as const) {
  test('家庭名册 ' + build + '：换行、重名档案、键盘返回与刷新', async ({ page, isMobile }, info) => {
    await page.goto('/');
    const appearance = build === 'production' ? 'day' : 'night';
    await page.evaluate(async (appearance) => {
      const modules = ['/src/tests/fixtures/harem.ts', '/src/services/storage/saveRepository.ts', '/src/ui/settings/model.ts'];
      const [{ householdFixture }, { SaveRepository }, { defaultSettings, settingsKey }] = await Promise.all(modules.map((p) => import(p)));
      const settings = defaultSettings();
      settings.display.appearance = appearance;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const repository = await SaveRepository.open(),
        snapshot = { state: householdFixture(24) };
      try {
        await repository.importBackup(snapshot, (await repository.compareBackup(snapshot)).confirmation);
      } finally {
        repository.close();
      }
    }, appearance);
    if (build === 'production') {
      // E2E shards start from npm ci and can run concurrently. Build exact current sources in this test's directory.
      const dist = info.outputPath('production-app');
      await promisify(execFile)(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--outDir',dist]);
      await page.route('http://127.0.0.1:5174/', (route) =>
        route.fulfill({ path: resolve(dist,'index.html'), contentType: 'text/html' }),
      );
      await page.route('**/assets/*', (route) =>
        route.fulfill({ path: resolve(dist, '.' + new URL(route.request().url()).pathname) }),
      );
    }
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    await enterArchiveGame(page);
    if (build === 'production')
      expect(await page.locator('script[type="module"]').first().getAttribute('src')).toMatch(/^\/assets\//);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    const panel = await openArchive(page, '后宫');
    const widths = isMobile ? [320, 360, 390, 420] : [1280, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: isMobile ? 812 : 960 });
      const cards = panel.locator('.household-card');
      await expect(cards).toHaveCount(24);
      await expect(cards.first()).toContainText('正宫 · 100 分');
      await expect(panel.getByText('尚未确认', { exact: true }).first()).toBeVisible();
      const geometry = await cards.evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.right)];
        }),
      );
      expect(geometry.every(([left, , right]) => left >= 0 && right <= width)).toBe(true);
      expect(new Set(geometry.map(([, y]) => y)).size).toBeGreaterThan(1);
      if (!isMobile) expect(geometry[0][1]).toBe(geometry[1][1]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await panel.screenshot({ path: info.outputPath('household-' + build + '.png') });
    const opener = panel.locator('button[data-person-id="family-5"]');
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    await panel.screenshot({ path: info.outputPath('cards-' + build + '.png') });
    const top = await opener.evaluate((el) => el.getBoundingClientRect().top);
    await opener.press('Enter');
    const profile = page.getByRole('dialog', { name: 'NPC 人物档案', exact: true });
    await expect(profile.getByRole('region', { name: '人物详情' })).toContainText('合成人物履历 5');
    await expect(profile.getByRole('heading', { name: '林宁', exact: true })).toBeVisible();
    await profile
      .getByRole('button', { name: isMobile ? '← 返回后宫' : '关闭人物档案并返回后宫', exact: true })
      .click();
    await expect(opener).toBeFocused();
    expect(Math.abs((await opener.evaluate((el) => el.getBoundingClientRect().top)) - top)).toBeLessThan(5);
    await page.reload();
    await openArchive(page, '后宫');
    await expect(page.locator('.household-card')).toHaveCount(24);
    expect(posts).toEqual([]);
  });
}

test('旧 V10 空家庭只展示占位，不生成候选或写入家庭字段', async ({ page }) => {
  const { seedMobileArchives, storedArchives } = await import('./helpers/mobileArchives');
  await seedMobileArchives(page);
  const before = await storedArchives(page),
    panel = await openArchive(page, '后宫');
  await expect(panel.getByText('暂无正式后宫成员')).toBeVisible();
  await expect(panel.getByText('暂无正宫')).toBeVisible();
  await expect(panel.locator('.household-card')).toHaveCount(0);
  expect(await storedArchives(page)).toEqual(before);
  expect(before.state).not.toHaveProperty('harem');
});
