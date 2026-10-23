import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameStateSchema, StorySchema } from '../src/domain/state';
import { TurnDraftSchema } from '../src/domain/drafts';
import { record, array, string } from '../src/services/ai/protocols';
import type { DomainCommand } from '../src/domain/commands';

async function configure(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const configPath = '/src/services/ai/configuration.ts',
      vaultPath = '/src/services/ai/credentials.ts',
      settingsPath = '/src/ui/settings/model.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath),
      { CredentialVault } = await import(vaultPath),
      { defaultSettings, settingsKey } = await import(settingsPath);
    const config = defaultAiConfig(),
      channel = newChannel();
    channel.baseUrl = 'https://loop.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-loop-secret');
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  });
  await page.reload();
}
async function createCharacter(page: Page) {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  for (const [label, value] of Object.entries({
    姓名: '林舟',
    年龄: '30',
    性别: '女',
    外貌: '短发',
    性格: '沉稳',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByLabel('创建一名初始同伴').check();
  await page.getByLabel('同伴姓名', { exact: true }).fill('陈宁');
  await page.getByLabel('同伴身份', { exact: true }).fill('记者');
  await page.getByLabel('与主角的关系', { exact: true }).fill('多年朋友');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '确认并创建存档' }).click();
  await expect(page.getByRole('heading', { name: '故事，尚未落笔。' })).toBeVisible();
}
function contextFrom(body: unknown) {
  const messages = array(record(body).messages).map((m) => string(record(m).content));
  const match = messages.join('\n').match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  if (!match) throw new Error('实际请求缺少 GAME_CONTEXT');
  return record(JSON.parse(match[1]));
}
async function mock(page: Page) {
  const plan = { badStoryNumber: 0, holdWorld: undefined as Promise<void> | undefined };
  const stories: { number: number; action: string; context: string }[] = [],
    calls: string[] = [];
  await page.route('https://loop.mock.invalid/**', async (route) => {
    const body: unknown = route.request().postDataJSON(),
      stage = string(record(body).model),
      ctx = contextFrom(body);
    calls.push(stage);
    let text: string;
    if (stage === 'story') {
      const state = record(ctx.SAVE_STATE),
        number = Number(state.turnNumber) + 1;
      stories.push({ number, action: string(ctx.PLAYER_ACTION), context: JSON.stringify(ctx) });
      const paid = typeof record(state.economy).cash === 'number';
      const narrative = `第${number}幕。${number === 1 ? '主角收到了公司寄出的解雇通知。' : '主角仍保留着此前收到的通知。'}经过一分钟，主角在街边休息。主角心情趋于平静。${paid ? '主角已经用现金支付30元吃饭。' : ''}`;
      const preflight = ctx.TIME_PREFLIGHT ? record(ctx.TIME_PREFLIGHT) : undefined;
      const timeGuide = preflight?.targetAt ? [{ group: 'time', subjectHint: 'time:end', observedFact: preflight.targetAt, textEvidence: '经过一分钟，主角在街边休息。' }] : [];
      text =
        plan.badStoryNumber === number
          ? '{bad-output'
          : `<正文>${narrative}</正文><短期记忆>第${number}幕的街边休息</短期记忆><变量规划>${JSON.stringify(timeGuide)}</变量规划><行动选项>留在街边\n看看四周\n询问路线</行动选项>`;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
      });
      return;
    }
    if (stage === 'variables') {
      const state = GameStateSchema.parse(ctx.SAVE_STATE),
        story = StorySchema.parse(ctx.STORY_RESULT);
      const commands: DomainCommand[] = [
        {
          type: 'SetWorldClock',
          commandId: 'minute',
          evidence: '经过一分钟，主角在街边休息。',
          worldClock: new Date(Date.parse(state.worldClock) + 60000).toISOString(),
        },
        {
          type: 'UpdateProtagonist',
          commandId: 'mood',
          expectedRevision: state.revision,
          protagonistId: state.protagonist.id,
          changes: { emotionText: '平静' },
          evidence: '主角心情趋于平静。',
        },
      ];
      if (state.turnNumber === 0)
        commands.push({
          type: 'AcquireItem',
          commandId: 'notice',
          evidence: '主角收到了公司寄出的解雇通知。',
          item: {
            id: 'notice',
            name: '解雇通知',
            category: 'document',
            quantity: 1,
            ownerRef: { kind: 'protagonist', id: state.protagonist.id },
            conditionText: '完好',
          },
        });
      if (story.narrative.includes('主角已经用现金支付30元吃饭。'))
        commands.push({
          type: 'SpendFunds',
          commandId: 'meal',
          account: 'cash',
          amount: 3000,
          purpose: '用餐',
          evidence: '主角已经用现金支付30元吃饭。',
        });
      text = JSON.stringify({ commands, rejectedSuggestions: [], unresolved: [] });
    } else {
      if (plan.holdWorld) await plan.holdWorld;
      text = JSON.stringify({
        worldCommands: [],
        taskCommands: [],
        eventCommands: [],
        futureEvents: [],
        visibleHooks: [{ text: '绝不自动发布的后台线索', revealAfter: string(ctx.worldClock) }],
        timelineCandidates: [],
        unresolved: ['内部未解决事项不可变成正文日志'],
      });
    }
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
      })
      .catch(() => undefined);
  });
  return { plan, stories, calls };
}
async function stored(page: Page) {
  const saved = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path),
      repo = await SaveRepository.open();
    try {
      const [save] = await repo.list();
      return await repo.loadGame(save.saveId);
    } finally {
      repo.close();
    }
  });
  return { state: GameStateSchema.parse(saved.state), draft: TurnDraftSchema.parse(saved.draft) };
}
const workflow = (page: Page) => page.getByRole('region', { name: '三阶段工作流' });
async function ready(page: Page, number = 1) {
  await expect(page.getByTestId('story-reader').locator('article').last()).toContainText(
    `第${number}幕`,
  );
  await expect(workflow(page)).toContainText('三阶段候选已完成，填写下一步行动');
}
async function opening(page: Page) {
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await ready(page);
}

test('真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致', async ({ page }, info) => {
  test.setTimeout(120000);
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await opening(page);
  const initial = await stored(page),
    start = Date.parse(initial.state.worldClock);
  expect(initial.state.economy.cash).toBeNull();
  await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText('未确认');
  for (let index = 1; index <= 10; index++) {
    const action = `行动${index}：在街边等待一分钟`;
    await page.getByLabel('你的行动', { exact: true }).fill(action);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await ready(page, index + 1);
    const result = await stored(page);
    expect(result.state.turnNumber).toBe(index);
    expect(result.state.revision).toBe(index);
    expect(result.state.journal).toHaveLength(index);
    expect(result.state.memories.short).toHaveLength(index);
    expect(result.state.memories.short.at(-1)).toMatchObject({
      text: `第${index}幕的街边休息`,
      sourceTurnIds: [result.state.journal[index - 1].turnId],
      createdAtGameTime: result.state.worldClock,
      visibility: 'player_known',
      affectedEntityRefs: [],
    });
    expect(result.draft.userInput).toBe(action);
    expect(result.draft.turnKind).toBe('regular');
    expect(Date.parse(result.state.worldClock)).toBe(start + index * 60000);
    expect(result.state.items.notice.ownerRef?.id).toBe(result.state.protagonist.id);
    expect(result.state.initialCompanionId).toBe(initial.state.initialCompanionId);
    expect(result.state.npc.companion).toEqual(initial.state.npc.companion);
    await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText(
      `第 ${index} 回合`,
    );
    expect(server.stories.find((s) => s.number === index + 1)?.action).toBe(action);
    expect(server.stories.find((s) => s.number === index + 1)?.context).toContain(
      `第${index}幕的街边休息`,
    );
    if (index === 5) {
      await page.reload();
      await ready(page, 6);
    }
  }
  const final = await stored(page);
  expect(server.calls).toHaveLength(33);
  expect(final.state.journal[0].story.turnKind).toBe('opening');
  expect(final.state.journal.slice(1).every((j) => j.story.turnKind === 'regular')).toBe(true);
  expect(JSON.stringify(final.state)).not.toContain('绝不自动发布的后台线索');
  expect(JSON.stringify(final.state.journal)).not.toContain('内部未解决事项');
  await expect(page.locator('main')).not.toContainText('绝不自动发布的后台线索');
  await page.reload();
  expect(await stored(page)).toEqual(final);
  await ready(page, 11);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ten-committed-turns.png'), fullPage: true });
});

test('下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合', async ({ page }) => {
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await opening(page);
  server.plan.badStoryNumber = 2;
  await page.getByLabel('你的行动', { exact: true }).fill('去街边等待');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(workflow(page).getByRole('alert')).toContainText('正文生成');
  const failed = await stored(page);
  expect(failed.state.turnNumber).toBe(1);
  expect(failed.draft.userInput).toBe('去街边等待');
  expect(failed.draft.stageStatus.story).toBe('failed');
  await page.reload();
  server.plan.badStoryNumber = 0;
  await workflow(page).getByRole('button', { name: '自动生成本回合', exact: true }).click();
  await ready(page, 2);
  expect((await stored(page)).state).toEqual(failed.state);
  expect(server.calls).toEqual([
    'story',
    'variables',
    'world',
    'story',
    'story',
    'variables',
    'world',
  ]);
});

test('提交事务中途失败 UI 不虚报成功；重试后只结算一次', async ({ page }) => {
  await configure(page);
  await mock(page);
  await createCharacter(page);
  await opening(page);
  const before = await stored(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, '__restoreTurnPut', {
      value: () => {
        IDBObjectStore.prototype.put = original;
      },
      configurable: true,
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'drafts') throw new DOMException('isolated test', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await page.getByLabel('你的行动', { exact: true }).fill('等待下一轮');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page.evaluate(() => {
    const restore = Reflect.get(window, '__restoreTurnPut');
    if (typeof restore === 'function') restore();
  });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await ready(page, 2);
  expect((await stored(page)).state.turnNumber).toBe(1);
});

test('快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿', async ({
  page,
  context,
}) => {
  await configure(page);
  await mock(page);
  await createCharacter(page);
  await opening(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await page.getByLabel('你的行动', { exact: true }).fill('在街边等待');
  await other.getByLabel('你的行动', { exact: true }).fill('在街边等待');
  await Promise.all(
    [page, other].map((p) =>
      p.getByRole('button', { name: '发送', exact: true }).evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      }),
    ),
  );
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  const result = await stored(page);
  expect(result.state.journal).toHaveLength(1);
  expect(result.draft.baseSaveRevision).toBe(1);
  expect(result.draft.userInput).toBe('在街边等待');
  await other.close();
});

test('阶段未完成或主动关闭时，即使填写行动也不能部分结算', async ({ page }) => {
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await page.getByLabel('动态世界', { exact: true }).uncheck();
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(workflow(page).getByRole('status')).toContainText('按开关跳过');
  await page.getByLabel('你的行动', { exact: true }).fill('等待');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  expect((await stored(page)).state.turnNumber).toBe(0);
  await page.getByLabel('动态世界', { exact: true }).check();
  await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  expect(server.calls).toEqual(['story', 'variables', 'world']);
});

test('正式资金与时间显示新版本，结算后刷新不重复扣款', async ({ page }) => {
  await configure(page);
  await mock(page);
  // 隔离经济界面测试数据；上面的十回合验收完全通过真实创角建立存档。
  await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts',
      fp = '/src/tests/fixtures/world.ts',
      dp = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(rp),
      { worldState } = await import(fp),
      { createTurnDraft } = await import(dp);
    const repo = await SaveRepository.open();
    await repo.create(worldState());
    await repo.saveDraft(createTurnDraft('save-a', 0, 'opening-known-money', 'opening', ''), null);
    repo.close();
  });
  await page.goto('/#game/save-a');
  await opening(page);
  await page.getByLabel('你的行动', { exact: true }).fill('继续休息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await ready(page, 2);
  const state = (await stored(page)).state;
  expect(state.economy.cash).toBe(7000);
  expect(state.worldClock).not.toBe('2026-10-18T08:00:00+08:00');
  await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText('70.00 元');
  await page.reload();
  expect((await stored(page)).state).toEqual(state);
});
