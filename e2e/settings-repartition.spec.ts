import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './helpers/test';
import { seedMobileArchives, openPaperSettings } from './helpers/mobileArchives';
import { settingsGroups } from '../src/ui/settings/settingsPages';

for (const appearance of ['day', 'night'] as const) {
  test('设置十七页逐页验收 · ' + appearance, async ({ page, isMobile }, info) => {
    test.setTimeout(180_000);
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await seedMobileArchives(page);
    await page.evaluate(async theme => {
      const images = '/src/services/images/config.ts';
      const {defaults,configKey} = await import(images);
      localStorage.setItem(configKey,JSON.stringify({...defaults,enabled:true}));
      const paths = ['/src/ui/settings/model.ts','/src/services/ai/configuration.ts'];
      const [{ settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }] = await Promise.all(paths.map(p => import(p)));
      const prefs = JSON.parse(localStorage.getItem(settingsKey)!);
      prefs.display.appearance = theme;
      localStorage.setItem(settingsKey, JSON.stringify(prefs));
      const config = defaultAiConfig(), channel = newChannel();
      channel.name = '验收渠道'; channel.defaultModel = 'review-model';
      channel.baseUrl = 'https://integration.mock.invalid/v1/compatible/endpoint/for/testing/long-address';
      config.channels.push(channel); config.routes.story.channelId = channel.id; saveAiConfig(localStorage, config);
    }, appearance);
    await page.reload();
    const root = await openPaperSettings(page);
    const folder = process.env.SETTINGS_SCREENSHOTS ?? info.outputPath('pages');
    const dest = join(folder, info.project.name + '-' + appearance);
    await mkdir(dest, { recursive: true });
    const measurements = [];
    for (const [, pages] of settingsGroups) for (const [id, , name] of pages) {
      const home = root.getByRole('button', { name: '返回设置', exact: true });
      if (await home.isVisible()) await home.click();
      await root.locator('nav [data-page="' + id + '"]').click();
      await expect(root.getByRole('heading', { name, exact: true }).first()).toBeVisible();
      const loading = root.getByText(/^(正在打开|读取配置…|读取存档…)/);
      await expect(loading).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await root.locator('.settings-content').evaluate(async pane => {
        await Promise.all(pane.getAnimations().map(animation => animation.finished));
      });
      const dims = await root.evaluate(el => {
        const pane = el.querySelector<HTMLElement>('.settings-content')!;
        return { width: pane.clientWidth, scroll: pane.scrollWidth, viewport: innerWidth,
          right: Math.round(pane.getBoundingClientRect().right) };
      });
      measurements.push({ page: id, ...dims });
      expect.soft(dims.scroll, name).toBeLessThanOrEqual(dims.width + 1);
      expect.soft(dims.right, name).toBeLessThanOrEqual(dims.viewport + 1);
      await page.screenshot({ path: join(dest, id + '.jpg'), type:'jpeg', quality:76, animations:'disabled' });
      if (id === 'variables' && !isMobile) await root.getByRole('button', { name: '‹ 返回设置分类' }).click();
    }
    await writeFile(join(dest, 'geometry.json'), JSON.stringify(measurements, null, 2));
    expect(measurements).toHaveLength(17);
  });
}
