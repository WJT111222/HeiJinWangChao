import { join } from 'node:path';
import { test, expect } from './helpers/test';

for (const mode of ['day', 'night'] as const) {
  test('私聊经过跨标签锁、冻结和解冻 · ' + mode, async ({ page, context }, info) => {
    test.setTimeout(90000);
    await page.goto('/');
    await page.evaluate(async (mode) => {
      const [
        { SaveRepository },
        { phoneGame },
        { settingsKey, defaultSettings },
        { createTurnDraft },
        { defaultAiConfig, newChannel, saveAiConfig },
        { CredentialVault },
      ] = await Promise.all(
        [
          '/src/services/storage/saveRepository.ts',
          '/src/tests/fixtures/phone.ts',
          '/src/ui/settings/model.ts',
          '/src/domain/drafts.ts',
          '/src/services/ai/configuration.ts',
          '/src/services/ai/credentials.ts',
        ].map((path) => import(path)),
      );
      const state = phoneGame(),
        settings = defaultSettings();
      settings.display.appearance = mode;
      settings.runtime.streamStory = false;
      for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[])
        summary.automatic = false;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const config = defaultAiConfig(),
        channel = {
          ...newChannel(),
          baseUrl: 'https://phone-fixture.invalid/v1',
          defaultModel: 'story-fixture',
        };
      config.channels.push(channel);
      config.routes.story = { channelId: channel.id, modelId: 'story-fixture' };
      config.routes.phone = { mode: 'independent', channelId: channel.id, modelId: 'phone-fixture' };
      saveAiConfig(localStorage, config);
      new CredentialVault(sessionStorage, localStorage).set(channel.id, 'private-chat-fixture');
      const repo = await SaveRepository.open();
      try {
        const entry = {
          state,
          draft: createTurnDraft(state.saveId, state.revision, 'following', 'regular', ''),
        };
        await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
      } finally {
        repo.close();
      }
    }, mode);
    const requests: { model: string; messages: { content: string }[] }[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      releaseCancelled = resolve;
    });
    await context.route('https://phone-fixture.invalid/**', async (route) => {
      const data = route.request().postDataJSON();
      requests.push(data);
      if (data.model === 'phone-fixture') {
        if (requests.length === 1) await held;
        if (data.messages.at(-1).content.includes('这条先不发')) await cancelled;
        return route.fulfill({
          json: {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify(
                    requests.length === 1
                      ? { npcId: 'partner', status: 'replied', text: '  原件明天给你。  ' }
                      : { npcId: 'partner', status: 'later' },
                  ),
                },
              },
            ],
          },
        });
      }
      return route.fulfill({ status: 401, json: { error: { message: 'fixture end of turn' } } });
    });
    const read = () =>
      page.evaluate(async () => {
        const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
        const repo = await SaveRepository.open();
        try {
          return await repo.loadGame('phone-fixture');
        } finally {
          repo.close();
        }
      });
    await page.goto('/#game/phone-fixture');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', mode);
    const second = await context.newPage();
    await second.goto('/#game/phone-fixture');
    const mainAction = second.locator('#player-input');
    await mainAction.fill('在窗边坐下');
    const actionButton = second.locator('.composer-footer button');
    await expect(actionButton).toBeEnabled();
    const phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' }),
      entry = page.locator('[data-phone-entry]:visible');
    const open = async () => {
      await entry.click();
      if (await phone.getByRole('button', { name: '点按进入' }).count())
        await phone.getByRole('button', { name: '点按进入' }).click();
      await phone.getByRole('button', { name: /^信息/ }).click();
      await phone.getByRole('button', { name: '通讯录' }).click();
      await phone.getByRole('button', { name: '打开与方宁的会话' }).click();
    };
    const screenshot = async (label: string) => {
      if (process.env.PHONE_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.PHONE_SCREENSHOTS, info.project.name + '-' + mode + '-' + label + '.jpg'),
          quality: 84,
          animations: 'disabled',
        });
    };
    await page.bringToFront();
    if (mode === 'day') await page.locator('#player-input').fill('下一次再办的事');
    await open();
    const before = await read(),
      field = phone.getByRole('textbox', { name: '私聊消息' });
    const raw = '  你看过 {{ticket}} 吗？  ';
    expect(requests).toHaveLength(0);
    await field.fill(raw);
    await field.dispatchEvent('compositionstart');
    await field.press('Enter');
    expect(requests).toHaveLength(0);
    await field.dispatchEvent('compositionend');
    await field.press('Enter');
    await expect(phone.getByText('对方正在输入…')).toBeVisible();
    await expect(actionButton).toBeDisabled();
    await expect(actionButton).toHaveAttribute('title', '手机消息还在等回复');
    await screenshot('typing');
    release();
    await expect(phone.locator('.ph-pending')).toHaveCount(2);
    expect((await read()).state).toEqual(before.state);
    const first = JSON.parse(requests[0].messages.at(-1)!.content);
    expect(first.npc.id).toBe('partner');
    expect(first.message).toBe(raw);
    await expect(actionButton).toBeEnabled();
    await field.fill('那我等你。');
    await phone.getByRole('button', { name: '发送', exact: true }).click();
    await expect(phone.getByText('对方已读，暂未回复')).toBeVisible();
    await screenshot('pending');
    await phone.getByRole('button', { name: '返回上一页' }).click();
    await phone.getByRole('button', { name: '聊天', exact: true }).click();
    await expect(phone.getByText('2 条聊天待结算，会随下一回合提交。')).toBeVisible();
    await expect(phone.locator('.ph-chat-row')).toContainText('[待结算]');
    await screenshot('list');
    const attached = await read();
    expect(attached.state).toEqual(before.state);
    expect(attached.draft.phonePending).toHaveLength(2);
    if (mode === 'day') {
      await phone.getByRole('button', { name: '结束聊天，发起回合' }).click();
    } else {
      await phone.getByRole('button', { name: '回到行动框' }).click();
      await expect(page.locator('#player-input')).toBeFocused();
      await page.locator('#player-input').fill('拿着文件出门');
      await page.locator('.composer-footer button').click();
    }
    await expect.poll(async () => (await read()).draft.stageStatus.story).toBe('failed');
    const frozen = await read();
    if (mode === 'day') await expect(page.locator('#player-input')).toHaveValue('下一次再办的事');
    expect(frozen.draft.userInput).toBe(mode === 'day' ? '用手机和方宁聊了一会儿' : '拿着文件出门');
    expect(frozen.draft.phonePending).toEqual(attached.draft.phonePending);
    expect(frozen.draft.phoneFreeze.ids).toHaveLength(3);
    expect(frozen.state).toEqual(before.state);
    expect(requests.filter((r) => r.model === 'phone-fixture')).toHaveLength(2);
    expect(requests.filter((r) => r.model === 'story-fixture')).toHaveLength(1);
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain('原件明天给你');
    await page.reload();
    await open();
    await expect(field).toBeDisabled();
    await expect(phone.getByRole('button', { name: '结束聊天', exact: true })).toBeDisabled();
    await screenshot('frozen');
    page.once('dialog', (d) => d.accept());
    await phone.getByRole('button', { name: '放弃本回合，继续聊天' }).click();
    await expect(field).toBeEnabled();
    expect((await read()).draft.phonePending).toEqual(attached.draft.phonePending);
    await field.fill('这条先不发');
    await phone.getByRole('button', { name: '发送', exact: true }).click();
    await expect(phone.getByRole('button', { name: '取消发送' })).toBeVisible();
    await phone.getByRole('button', { name: '取消发送' }).click();
    releaseCancelled();
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('这条先不发');
    await expect(phone.getByRole('alert')).toContainText('已取消');
    expect((await read()).draft.phonePending).toEqual(attached.draft.phonePending);
    expect((await read()).state).toEqual(before.state);
    await second.close();
  });
}
