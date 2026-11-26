import { join } from 'node:path';
import { test, expect } from './helpers/test';

for (const mode of ['day', 'night'] as const) {
  test('只读会话、两端角标与回合通知 · ' + mode, async ({ page, context }, info) => {
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
      const [
        { SaveRepository },
        { phoneGame },
        { recordPhone, schedulePhone, deliverPhone },
        { settingsKey, defaultSettings },
        { createTurnDraft },
      ] = await Promise.all(
        [
          '/src/services/storage/saveRepository.ts',
          '/src/tests/fixtures/phone.ts',
          '/src/domain/phone.ts',
          '/src/ui/settings/model.ts',
          '/src/domain/drafts.ts',
        ].map((p) => import(p)),
      );
      const settings = defaultSettings();
      settings.display.appearance = mode;
      for (const s of Object.values(settings.memory.summaries) as { automatic: boolean }[])
        s.automatic = false;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const state = phoneGame();
      recordPhone(
        state,
        'partner',
        {
          messageId: 'sent',
          medium: 'text',
          sender: 'protagonist',
          status: 'read',
          text: '原件已经收到了。',
        },
        'evening',
        false,
      );
      recordPhone(
        state,
        'old',
        { messageId: 'call', medium: 'call', sender: 'npc', text: '有空来坐坐。' },
        'evening',
        false,
      );
      state.npc.partner.onScene = false;
      schedulePhone(
        state,
        { messageId: 'letter', npcId: 'partner', text: '明天我去取原件。', dueAt: state.worldClock },
        'evening',
      );
      deliverPhone(state, 'evening');
      const repo = await SaveRepository.open();
      const draft = createTurnDraft(state.saveId, state.revision, 'following', 'regular', '在江边休息');
      try {
        await repo.importBackup({ state, draft }, (await repo.compareBackup({ state, draft })).confirmation);
      } finally {
        repo.close();
      }
    }, mode);
    await page.goto('/#game/phone-fixture');
    await page.reload();
    const snapshot = () =>
      page.evaluate(async () => {
        const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
        const repo = await SaveRepository.open();
        try {
          return await repo.loadGame('phone-fixture');
        } finally {
          repo.close();
        }
      });
    const capture = async (screen: string) => {
      if (process.env.PHONE_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.PHONE_SCREENSHOTS, info.project.name + '-' + mode + '-' + screen + '.jpg'),
          quality: 84,
          animations: 'disabled',
        });
    };
    const entry = page.locator('[data-phone-entry]:visible'),
      phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
    await expect(entry.locator('.ph-badge')).toHaveText('3');
    const before = await snapshot();
    await entry.click();
    await expect(phone.getByRole('button', { name: /方宁 · 场外来信/ })).toBeVisible();
    await capture('lock');
    await phone.getByRole('button', { name: '点按进入' }).click();
    await capture('home');
    await phone.getByRole('button', { name: /^通知/ }).click();
    await expect(phone.getByRole('button', { name: /顾远 · 通话/ })).toBeVisible();
    await capture('notifications');
    const tab = await context.newPage();
    await tab.goto('/#game/phone-fixture');
    await expect(tab.locator('[data-phone-entry]:visible .ph-badge')).toHaveText('3');
    await page.bringToFront();
    await phone.getByRole('button', { name: /方宁 · 场外来信/ }).click();
    await expect(phone.getByRole('heading', { name: /方宁/ })).toBeFocused();
    await expect(phone.getByText('明天我去取原件。', { exact: true })).toBeVisible();
    await expect(phone.locator('.ph-out')).toContainText('已读');
    await expect(phone.locator('.ph-thread')).toContainText('场外来信 ·');
    await expect(phone.getByRole('textbox')).toHaveCount(0);
    await capture('thread');
    await expect(tab.locator('[data-phone-entry]:visible .ph-badge')).toHaveText('2');
    await tab.close();
    await phone.getByRole('button', { name: '返回上一页' }).click();
    await phone.getByRole('button', { name: '返回手机主屏' }).click();
    await phone.getByRole('button', { name: /^信息/ }).click();
    await expect(phone.locator('.ph-chat-row')).toHaveCount(2);
    await expect(phone.locator('.ph-invalid .ph-dot')).toHaveCount(1);
    await capture('chats');
    await phone.locator('.ph-invalid').click();
    await expect(phone.locator('.ph-thread')).toContainText('号码已失效');
    await phone.getByRole('button', { name: '回到行动框' }).click();
    await expect(page.locator('#player-input')).toBeFocused();
    await expect(entry.locator('.ph-badge')).toHaveText('1');
    expect(await snapshot()).toEqual(before);
    expect(posts).toEqual([]);
  });
}
