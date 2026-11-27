import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { openSettings } from './helpers/gameLayout';

async function seedChat(page: Page, mode: 'day' | 'night', withTopics=false) {
  await page.goto('/');
  await page.evaluate(async ({mode,withTopics}) => {
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
    if (withTopics) {
      const { event } = await import('/src/tests/fixtures/game.ts' as string);
      const main = { ...event('waterfront'), eventKind:'main', title:'内部会议标题', backgroundText:'会议闭门资料', sourceTurnIds:['evening'] };
      state.events[main.id] = main;
      state.events['known-only'] = { ...main, id:'known-only', title:'主角获知的秘密', visibility:'known' };
      state.phone.topics = [{id:'market',turnId:'evening',at:state.worldClock,expiresAt:'2027-01-01T00:00:00Z',title:'江畔市集',summary:'沿岸集市开张',related:true,eventId:main.id,eventVersion:'evening'}];
    }
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
  }, {mode,withTopics});
}

function readChat(page: Page) {
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

async function openConversation(page: Page) {
  const phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
  await page.locator('[data-phone-entry]:visible').click();
  const unlock = phone.getByRole('button', { name: '点按进入' });
  if (await unlock.count()) await unlock.click();
  await phone.getByRole('button', { name: /^信息/ }).click();
  await phone.getByRole('button', { name: '通讯录' }).click();
  await phone.getByRole('button', { name: '打开与方宁的会话' }).click();
  return phone;
}

for (const mode of ['day', 'night'] as const) {
  test('私聊经过跨标签锁、冻结和解冻 · ' + mode, async ({ page, context }, info) => {
    test.setTimeout(90000);
    await seedChat(page, mode);
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
    const read = () => readChat(page);
    await page.goto('/#game/phone-fixture');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', mode);
    const second = await context.newPage();
    await second.goto('/#game/phone-fixture');
    const mainAction = second.locator('#player-input');
    await mainAction.fill('在窗边坐下');
    const actionButton = second.locator('.composer-footer button');
    await expect(actionButton).toBeEnabled();
    const phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
    const open = () => openConversation(page);
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
  test('变量管理保存后刷新保留' + (mode === 'day' ? '待输入' : '已冻结') + '的私聊', async ({ page, context }) => {
    await seedChat(page, mode);
    await context.route('https://phone-fixture.invalid/**', route => {
      if (route.request().postDataJSON().model !== 'phone-fixture')
        return route.fulfill({ status: 401, json: { error: { message: 'fixture stops Story' } } });
      return route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ npcId: 'partner', status: 'replied', text: '好，明天会面。' }),
      } }] } });
    });
    await page.goto('/#game/phone-fixture');
    await page.reload();
    const phone = await openConversation(page);
    await phone.getByRole('textbox', { name: '私聊消息' }).fill('明天请在南门见面。');
    await phone.getByRole('button', { name: '发送', exact: true }).click();
    await expect(phone.locator('.ph-pending')).toHaveCount(2);
    if (mode === 'night') {
      await phone.getByRole('button', { name: '结束聊天', exact: true }).click();
      await expect.poll(async () => (await readChat(page)).draft.stageStatus.story).toBe('failed');
    }
    const before = await readChat(page);
    expect(before.draft.phonePending).toHaveLength(1);
    if (mode === 'night') expect(before.draft.phoneFreeze.ids).toHaveLength(2);
    else expect(before.draft.phoneFreeze).toBeUndefined();
    await page.reload();
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '变量管理', exact: true }).click();
    await settings.getByRole('button', { name: '编辑 年龄', exact: true }).click();
    await settings.getByLabel('变量值', { exact: true }).fill(String(before.state.protagonist.age + 1));
    await settings.getByRole('button', { name: '加入待保存修改' }).click();
    await settings.getByRole('button', { name: '保存变量修改' }).click();
    await expect.poll(async () => (await readChat(page)).state.protagonist.age).toBe(before.state.protagonist.age + 1);
    await page.reload();
    const after = await readChat(page);
    expect(after.draft.phonePending).toEqual(before.draft.phonePending);
    expect(after.draft.phoneFreeze).toEqual(before.draft.phoneFreeze);
    expect(after.state.phone).toEqual(before.state.phone);
    await openConversation(page);
    await expect(phone.locator('.ph-pending')).toHaveCount(2);
    await expect(phone.getByText('好，明天会面。', { exact: true })).toBeVisible();
    const field = phone.getByRole('textbox', { name: '私聊消息' });
    if (mode === 'night') await expect(field).toBeDisabled();
    else await expect(field).toBeEnabled();
  });
}

for (const mode of ['day', 'night'] as const) {
  test('群聊与小黑书按需浏览 · ' + mode, async ({ page, context }, info) => {
    await seedChat(page, mode, true);
    const calls: string[] = [];
    const capture = async (label: string) => {
      if (process.env.PHONE_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.PHONE_SCREENSHOTS,
            info.project.name + '-' + mode + '-' + label + '.jpg',
          ),
          quality: 84,
          animations: 'disabled',
        });
    };
    await context.route('https://phone-fixture.invalid/**', async (route) => {
      const wire = route.request().postDataJSON(),
        payload = JSON.parse(wire.messages.at(-1).content);
      expect(wire.model).toBe('phone-fixture');
      let result;
      if (payload.topics) {
        calls.push('book');
        expect(JSON.stringify(wire.messages)).not.toMatch(/内部会议标题|会议闭门资料|主角获知的秘密/);
        if (mode === 'night' && calls.filter((k) => k === 'book').length === 1)
          return route.fulfill({
            json: { choices: [{ finish_reason: 'stop', message: { content: 'broken fixture' } }] },
          });
        const comment = {
          author: '沿岸人',
          text: '真正的评论',
          at: payload.worldClock,
          region: '重庆',
          likes: 1,
          byAuthor: false,
        };
        result = payload.topics.map((t: { index: number }) => ({
          index: t.index,
          post: {
            title: '江畔集市开张',
            subtitle: '新摊位',
            author: '小舟',
            at: payload.worldClock,
            location: '江畔',
            body: '市民在沿岸散步。',
            tags: ['城市'],
            likes: 3,
            saves: 2,
            comments: [
              { ...comment, replies: [comment, { ...comment, text: '第二条楼中楼', byAuthor: true }] },
            ],
          },
        }));
      } else if (payload.npc) {
        calls.push(payload.npc.id);
        result =
          payload.group.action.type === 'message'
            ? { npcId: payload.npc.id, status: 'replied', text: '明天江边见。' }
            : { npcId: payload.npc.id, status: 'joined' };
      } else {
        calls.push('schedule');
        result = [
          { npcId: 'partner', status: 'reply' },
          { npcId: 'colleague', status: mode === 'day' ? 'unread' : 'later' },
        ];
      }
      await route.fulfill({
        json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] },
      });
    });
    await page.goto('/#game/phone-fixture');
    await page.reload();
    const phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
    await page.locator('[data-phone-entry]:visible').click();
    await phone.getByRole('button', { name: '点按进入' }).click();
    await phone.getByRole('button', { name: /^信息/ }).click();
    await phone.getByRole('button', { name: '新建群聊' }).click();
    await phone.getByLabel('群名称').fill('江边工作群');
    await phone.getByRole('checkbox', { name: '方宁' }).check();
    await phone.getByRole('checkbox', { name: '许舟' }).check();
    await expect(phone.getByRole('checkbox', { name: /顾远/ })).toBeDisabled();
    await capture('邀请成员');
    await phone.getByRole('button', { name: '建群（待结算）' }).click();
    const edit = phone.getByRole('textbox', { name: '群聊消息' });
    await edit.fill('明天几点？');
    await edit.press('Enter');
    await expect(phone.getByText('明天江边见。', { exact: true })).toBeVisible();
    await capture('群会话');
    expect(calls).toEqual(['partner', 'colleague', 'schedule', 'partner']);
    await phone.locator('.ph-appbar button').first().click();
    const groupPreview = phone.getByRole('button', { name: /江边工作群/ });
    await expect(groupPreview).toContainText('待结算');
    await expect(groupPreview.locator('.ph-preview')).toContainText('方宁：明天江边见。');
    await phone.locator('.ph-appbar button').first().click();
    await phone.getByRole('button', { name: '小黑书', exact: true }).click();
    if (mode === 'night') {
      await expect(phone.getByRole('status')).toContainText('展开失败');
      expect(calls.filter((k) => k === 'book')).toHaveLength(1);
      await phone.getByRole('button', { name: '重试', exact: true }).click();
    }
    const card = phone.getByRole('button', { name: /江畔集市开张/ });
    await card.click();
    await expect(phone.getByText('真正的评论', { exact: true }).first()).toBeVisible();
    await phone.getByRole('button', { name: /展开 1 条回复/ }).click();
    await expect(phone.getByText('第二条楼中楼', { exact: true })).toBeVisible();
    await phone.getByRole('button', { name: '赞 3', exact: true }).click();
    await expect(phone.getByRole('button', { name: '赞 4', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await phone.getByRole('button', { name: '刷新小黑书' }).click();
    await phone.locator('.ph-appbar button').first().click();
    await phone.getByRole('button', { name: '热榜', exact: true }).click();
    await expect(phone.locator('ol li')).toHaveCount(1);
    await expect(phone.locator('ol')).toContainText('江畔市集');
    await expect(phone.locator('ol')).toContainText('沿岸集市开张');
    await expect(phone.locator('ol')).not.toContainText('主角获知的秘密');
    await capture('公开热榜');
    await phone.locator('ol button').click();
    await expect(phone.getByRole('button', { name: '赞 4', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await capture('缓存帖子');
    expect(calls.filter((k) => k === 'book')).toHaveLength(mode === 'night' ? 2 : 1);
    const live = await readChat(page);
    expect(live.state.phone.groups).toBeUndefined();
    expect(live.draft.phonePending).toHaveLength(2);
    expect(live.state.worldClock).toBe('2026-10-18T21:40:00+08:00');
  });
}

test('小黑书切换推荐、热榜及返回时接续同一在途请求', async ({ page, context }) => {
  await seedChat(page, 'day', true);
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await context.route('https://phone-fixture.invalid/**', async (route) => {
    const payload = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
    calls++;
    await gate;
    const post = {
      author: '沿江人',
      title: '已生成的集市帖子',
      subtitle: '市集',
      body: '沿江见闻',
      at: payload.worldClock,
      location: '江边',
      tags: [],
      likes: 0,
      saves: 0,
      comments: [],
    };
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify([{ index: 0, post }]),
            },
          },
        ],
      },
    });
  });
  await page.goto('/#game/phone-fixture');
  await page.reload();
  const phone = page.getByRole('dialog', { name: '林舟的手机 · 游戏内' });
  const button = (name: string) => phone.getByRole('button', { name, exact: true });
  const back = phone.locator('.ph-appbar button').first();
  await page.locator('[data-phone-entry]:visible').click();
  await button('点按进入').click();
  await button('小黑书').click();
  try {
    await expect.poll(() => calls).toBe(1);
    await button('热榜').click();
    await phone.locator('ol button').click();
    await expect(phone.getByRole('status')).toContainText('正在把');
    await back.click();
    await button('推荐').click();
    await back.click();
    await button('小黑书').click();
    await expect(phone.getByRole('status')).toContainText('正在把');
  } finally {
    finish();
  }
  await expect(phone.getByText('已生成的集市帖子', { exact: true })).toBeVisible();
  await expect(button('重试')).toHaveCount(0);
  await button('热榜').click();
  await phone.locator('ol button').click();
  await expect(phone.getByText('沿江见闻', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});
