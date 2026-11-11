import { openLibrary } from './helpers/home';
import { expect, test } from './helpers/test';

test('桌面首页常见窗口一屏可见：导航、行动、剪影与存档底栏', async ({ page }, info) => {
  await page.goto('/');
  const sizes = info.project.name === 'desktop'
    ? [{ width: 1650, height: 927 }, { width: 1440, height: 800 },
      { width: 1280, height: 720 }, { width: 1024, height: 700 }]
    : [{ width: 390, height: 844 }, { width: 375, height: 667 }];
  for (const size of sizes) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#cover')).toHaveCSS('transform','none');
    await page.setViewportSize(size);
    await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        scrollHeight: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        header: rect('.topbar'),
        hero: rect('.hero'),
        skyline: rect('.skyline'),
        footnote: rect('.cover-foot'),
        libraryFooter: rect('.lib-foot'),
      };
    });
    await openLibrary(page);
    geometry.libraryFooter = await page.locator('.lib-foot').evaluate(el => { const r=el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; });
    await expect(page.getByRole('button', { name: '刷新列表' })).toBeVisible();
    expect(geometry.width, JSON.stringify({ size, geometry })).toBeLessThanOrEqual(size.width + 1);
    if (size.width > 900) {
      expect(geometry.scrollHeight, JSON.stringify({ size, geometry })).toBeLessThanOrEqual(size.height + 1);
      expect(geometry.header.top).toBeGreaterThanOrEqual(0);
      expect(geometry.skyline.height).toBeGreaterThanOrEqual(32);
      expect(geometry.footnote.bottom).toBeLessThanOrEqual(size.height + 1);
      expect(geometry.libraryFooter.bottom).toBeLessThanOrEqual(size.height + 1);
      expect(geometry.hero.bottom).toBeLessThanOrEqual(size.height + 1);
    } else {
      // 两个视图各自保持原有内容可达，存档馆底栏仍位于主体之后。
      expect(geometry.libraryFooter.top).toBeGreaterThan(geometry.hero.top);
    }
  }
});

test('存档较多时只滚动桌面右侧列表，底栏和开始按钮仍可用', async ({ page }, info) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts';
    const fixturePath = '/src/tests/fixtures/world.ts';
    const { SaveRepository } = await import(repoPath);
    const { worldState } = await import(fixturePath);
    const repo = await SaveRepository.open();
    try {
      for (let i = 1; i <= 8; i++) {
        await repo.create({ ...worldState(), saveId: `home-fit-${i}` });
      }
    } finally {
      repo.close();
    }
  });
  await page.reload();
  await expect(page.locator('.save-card')).toHaveCount(8);
  await page.setViewportSize(info.project.name === 'desktop'
    ? { width: 1280, height: 720 } : { width: 390, height: 844 });
  await openLibrary(page);
  const list = page.locator('.lib-main');
  if (info.project.name === 'desktop') {
    await expect.poll(() => list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(721);
    await expect(page.locator('.lib-foot')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeInViewport();
  } else {
    await list.locator('.save-card').last().scrollIntoViewIfNeeded();
    await expect(list.locator('.save-card').last()).toBeInViewport();
  }
});

test('极矮桌面窗口保留正常滚动，操作入口不会被裁剪', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '短窗口滚动保底只适用于桌面双栏');
  await page.setViewportSize({ width: 1200, height: 560 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
  await openLibrary(page);
  await page.locator('.lib-foot').scrollIntoViewIfNeeded();
  await expect(page.locator('.lib-foot')).toBeInViewport();
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(1201);
});
