import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';

async function gameSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
    const repo = await SaveRepository.open();
    try {
      return await repo.loadGame('phone-fixture');
    } finally {
      repo.close();
    }
  });
}

for (const appearance of ['night', 'day'] as const) {
  test('只读手机与档案、提醒、草稿隔离 · ' + appearance, async ({ page, context }, info) => {
    const posts: string[] = [];
    await context.route('**/*', (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto('/');
    await page.evaluate(async (mode) => {
      const paths = [
        '/src/services/storage/saveRepository.ts',
        '/src/tests/fixtures/phone.ts',
        '/src/ui/settings/model.ts',
        '/src/domain/drafts.ts',
      ];
      const [{ SaveRepository }, { phoneGame }, { settingsKey, defaultSettings }, { createTurnDraft }] =
        await Promise.all(paths.map((p) => import(p)));
      const settings = defaultSettings();
      settings.display.appearance = mode;
      for (const s of Object.values(settings.memory.summaries) as { automatic: boolean }[])
        s.automatic = false;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const state = phoneGame(),
        draft = createTurnDraft(state.saveId, state.revision, 'next-turn', 'regular', '在江边休息');
      const repo = await SaveRepository.open();
      try {
        await repo.importBackup({ state, draft }, (await repo.compareBackup({ state, draft })).confirmation);
      } finally {
        repo.close();
      }
    }, appearance);
    await page.goto('/#game/phone-fixture');
    await page.reload();
    const entry = page.locator('[data-phone-entry]:visible'),
      phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
    const capture = async (screen: string) => {
      const directory = process.env.PHONE_SCREENSHOTS;
      if (directory)
        await page.screenshot({
          path: join(directory, info.project.name + '-' + appearance + '-' + screen + '.jpg'),
          quality: 84,
          animations: 'disabled',
        });
    };
    await expect(entry).toBeVisible();
    const initial = await gameSnapshot(page);
    expect(initial.draft?.userInput).toBe('在江边休息');
    await expect(entry).toContainText('1');
    await entry.click();
    const mobile = info.project.name === 'mobile';
    await expect(phone).toBeVisible();
    expect(await phone.evaluate((el) => el.matches(':modal'))).toBe(mobile);
    if (mobile) {
      await expect(phone.getByRole('button', { name: '返回游戏' })).toBeVisible();
      expect((await phone.boundingBox())!.width).toBe(page.viewportSize()!.width);
    } else {
      expect((await phone.boundingBox())!.width).toBeLessThan(400);
      await expect(page.getByTestId('story-reader')).toBeVisible();
    }
    await expect(phone.getByRole('heading', { name: '21:40' })).toBeVisible();
    await expect(phone.getByRole('button', { name: /3 天后到期/ })).toBeVisible();
    await capture('lock');
    await phone.getByRole('button', { name: '点按进入' }).click();
    await expect(phone.getByRole('button', { name: '小黑书' })).toBeEnabled();
    await expect(phone.getByRole('button', { name: '日程' })).toBeDisabled();
    await capture('home');
    await phone.getByRole('button', { name: /^通知/ }).click();
    await expect(phone.getByRole('heading', { name: '本回合' })).toBeVisible();
    await capture('notifications');
    const other = appearance === 'day' ? await context.newPage() : undefined;
    if (other) {
      await other.goto('/#game/phone-fixture');
      await expect(other.locator('[data-phone-entry]:visible .ph-badge')).toHaveText('1');
    }
    await phone.getByRole('button', { name: /3 天后到期/ }).click();
    if (other) {
      await expect(other.locator('[data-phone-entry]:visible .ph-badge')).toHaveCount(0);
      await other.close();
      await page.bringToFront();
    }
    await expect(phone.locator('[data-highlighted]')).toContainText('城市银行');
    await expect(phone.getByRole('heading', { level: 4 })).toHaveText([
      '存款',
      '贷款',
      '房产',
      '车辆',
      '其他资产',
      '待收收入',
    ]);
    await expect(phone.getByText('¥86,420.35')).toBeVisible();
    await capture('assets');
    await phone.getByRole('button', { name: /查看房贷/ }).click();
    await expect(phone.locator('[data-highlighted]')).toBeFocused();
    await phone.getByRole('button', { name: '回到行动框' }).click();
    await expect(page.locator('#player-input')).toBeFocused();
    await expect(entry.locator('.ph-badge')).toHaveCount(0);
    await entry.click();
    await expect(phone.getByRole('heading', { name: '手机主屏' })).toBeAttached();
    if (mobile) await phone.getByRole('button', { name: '返回游戏' }).click();
    else await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await entry.click();
    await phone.getByRole('button', { name: '信息' }).click();
    await expect(phone.getByText('暂无聊天')).toBeVisible();
    await phone.getByRole('button', { name: '通讯录' }).click();
    await expect(phone.getByRole('heading', { level: 4 })).toHaveText(['家人', '后宫', '我的势力', '其他']);
    await expect(phone.getByText('号码已失效')).toBeVisible();
    await capture('contacts');
    await phone.getByRole('button', { name: '查看顾远的档案' }).click();
    await expect(phone).toHaveCount(0);
    await expect(page.locator('.npc-detail-heading').getByRole('heading', { name: '顾远' })).toBeVisible();
    expect(await gameSnapshot(page)).toEqual(initial);
    expect(posts).toEqual([]);
  });
}
