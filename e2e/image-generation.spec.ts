import { expect, test } from './helpers/test';
import { openSettings } from './helpers/gameLayout';
import { openStoredSave } from './helpers/home';
import type { Page } from '@playwright/test';

const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==';
async function seed(page: Page, day: boolean) {
  await page.goto('/');
  await page.evaluate(async (day) => {
    const repoModule = '/src/services/storage/saveRepository.ts',
      gameModule = '/src/tests/fixtures/game.ts',
      prefModule = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(repoModule),
      { game, npc } = await import(gameModule),
      { defaultSettings, settingsKey } = await import(prefModule);
    const repo = await SaveRepository.open(),
      state = game('save-image');
    state.title = '照相馆验收';
    state.openingTimePending = undefined;
    state.openingInitializationPending = undefined;
    state.turnNumber = 1;
    state.revision = 1;
    state.npc['npc-a'] = npc();
    state.journal = [
      {
        turnId: 'photo-turn',
        revision: 1,
        relatedActorRefs: [{ kind: 'npc', id: 'npc-a' }],
        scene: { worldClock: state.worldClock, locationId: 'chongqing' },
        story: {
          turnKind: 'opening',
          narrative: '林舟推开照相馆的玻璃门。柜台上放着一本旧相册。',
          summary: '林舟来到照相馆。',
          variableGuide: [],
        },
      },
    ];
    try {
      await repo.importBackup({ state }, (await repo.compareBackup({ state })).confirmation);
    } finally {
      repo.close();
    }
    const settings = defaultSettings();
    settings.display.appearance = day ? 'day' : 'night';
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, day);
  await page.reload();
  await openStoredSave(page, '照相馆验收');
}
test('关闭时保持纯文字；设置、结算插画、相册与备份贯通', async ({ page }, info) => {
  test.setTimeout(90000);
  const mobile = info.project.name === 'mobile';
  let posts = 0;
  await page.route('**/image-fixture/generate', async (route) => {
    posts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON().prompt).toContain('照相馆');
    await route.fulfill({ json: { data: [{ b64_json: pixel }] } });
  });
  await seed(page, mobile);
  await expect(page.locator('.game-layout')).toBeVisible();
  await expect(page.locator('.image-entry')).toHaveCount(0);
  const output = 'docs/image-generation/evidence/' + info.project.name;
  await page.screenshot({ path: output + '-off.png' });
  await openSettings(page);
  await page.getByRole('button', { name: '文生图', exact: true }).click();
  await page.getByLabel('启用文生图').check();
  await page.getByLabel('API 基础地址', { exact: true }).fill('http://127.0.0.1:5174');
  await page.getByLabel('生成路径').fill('image-fixture/generate');
  await page.getByRole('button', { name: '保存文生图设置' }).click();
  await page.getByLabel('启用文生图').scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + '-settings.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看或生成插画' }).click();
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect(page.getByRole('button', { name: '加入人生相册' })).toBeVisible();
  await page.getByRole('button', { name: '加入人生相册' }).click();
  await expect(page.getByRole('button', { name: '移出相册' })).toBeVisible();
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByRole('button', { name: '文生图', exact: true }).click();
  await page.getByRole('button', { name: '图片管理器' }).click();
  await page.getByLabel('分类', { exact: true }).selectOption('album');
  await expect(page.getByRole('link', { name: '导出图片' })).toBeVisible();
  await page.screenshot({ path: output + '-album.png' });
  const stored = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path),
      repo = await SaveRepository.open();
    try {
      const [backup] = await repo.exportBackup(['save-image']);
      return {
        count: backup.images.files.length,
        title: backup.images.pictures[0].album,
        revision: backup.state.revision,
      };
    } finally {
      repo.close();
    }
  });
  expect(stored).toMatchObject({ count: 1, revision: 1 });
  expect(posts).toBe(1);
});

test('人物档案上传、独立槽位、锚点和 NPC 入口', async ({ page }, info) => {
  test.setTimeout(60000);
  const mobile = info.project.name === 'mobile';
  await seed(page, mobile);
  await page.evaluate(async () => {
    const cp = '/src/services/images/config.ts',
      { config, saveConfig } = await import(cp);
    saveConfig({ ...config(), enabled: true });
  });
  if (mobile) await page.locator('[data-mobile-tab="hero"]').click();
  await page.getByRole('button', { name: '人物档案', exact: true }).click();
  await page.getByRole('button', { name: '主角图片' }).click();
  await page.getByText('人物形象锚点', { exact: true }).click();
  await page.getByLabel('稳定外貌').fill('圆框眼镜');
  await page.getByRole('button', { name: '保存锚点' }).click();
  await page
    .getByLabel('本地上传')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') });
  await expect(page.getByRole('link', { name: '导出图片' })).toBeVisible();
  await page.locator('.image-tools select').first().selectOption('full');
  await expect(page.getByText('暂无图片。', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'docs/image-generation/evidence/' + info.project.name + '-profile.png' });
  await page.getByRole('button', { name: 'NPC 人物资料', exact: true }).click();
  await page.getByRole('button', { name: '查看人物：同事', exact: true }).click();
  await page.getByRole('button', { name: 'NPC图片' }).click();
  await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
  await page.getByText('人物形象锚点', { exact: true }).click();
  await expect(page.getByLabel('稳定外貌')).toHaveValue('');
});
