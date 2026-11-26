import { GameTimeSchema } from '../src/domain/common';
import { VariableStateProjectionSchema } from '../src/tests/fixtures/variableState';
import { variableReply } from '../src/tests/fixtures/variableReply';
import { closeWorkflowSheet, openGameTools } from './helpers/gameLayout';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { GameStateSchema, StorySchema } from '../src/domain/state';
import { TurnDraftSchema } from '../src/domain/drafts';
import { record, array, string } from '../src/services/ai/protocols';
import type { DomainCommand } from '../src/domain/commands';
// Three release scenarios now exercise the mobile composer and status drawer as well.
test.beforeEach(({ isMobile }, info) => {
  test.skip(isMobile && !/连续正式游玩十回合|提交事务中途失败|快速双击与另一标签/.test(info.title), '其余场景使用电脑端专用工作台');
});

async function configure(page: Page, useWorldStage = true) {
  await page.goto('/');
  await page.evaluate(async (useWorldStage) => {
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
    config.routes.entities = {mode:'independent',channelId:channel.id,modelId:'entities'}; config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-loop-secret');
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5;
    settings.runtime.useWorldStage = useWorldStage;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, useWorldStage);
  await page.reload(); await openGameTools(page);
}
async function createCharacter(page: Page) {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  for (const [label, value] of Object.entries({
    姓名: '林舟',
    年龄: '30',
    外貌: '短发',
    性格: '沉稳',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('radio', { name: '女性', exact: true }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '专业与公共服务', exact: true }).click();
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByLabel('创建一名初始同伴').check();
  await page.getByLabel('同伴姓名', { exact: true }).fill('陈宁');
  await page.getByLabel('同伴身份', { exact: true }).fill('记者');
  await page.getByLabel('与主角的关系', { exact: true }).fill('多年朋友');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '确认并创建存档' }).click(); await openGameTools(page, true);
}
function contextFrom(body: unknown) {
  const messages = array(record(body).messages).map((m) => string(record(m).content));
  const match = messages.join('\n').match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  if (!match) throw new Error('实际请求缺少 GAME_CONTEXT');
  return record(JSON.parse(match[1]));
}
const variableRequestState = VariableStateProjectionSchema.extend({ worldClock: GameTimeSchema.nullable() });

async function mock(page: Page) {
  const plan = { badStoryNumber: 0, holdWorld: undefined as Promise<void> | undefined };
  const stories: { number: number; action: string; context: string }[] = [],
    calls: string[] = [];
  await page.context().route('https://loop.mock.invalid/**', async (route) => {
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
      const pending = Boolean(ctx.OPENING_TIME && record(ctx.OPENING_TIME).status === 'pending');
      const anchor = pending ? '2015年7月8日14:00，重庆街头。' : '';
      const narrative = `${anchor}第${number}幕。${number === 1 ? '主角收到了公司寄出的解雇通知。' : '主角仍保留着此前收到的通知。'}经过一分钟，主角在街边休息。主角心情趋于平静。${paid ? '主角已经用现金支付30元吃饭。' : ''}`;
      const preflight = ctx.TIME_PREFLIGHT ? record(ctx.TIME_PREFLIGHT) : undefined;
      const timeGuide = pending ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-07-08T14:00:00+08:00', endAt: '2015-07-08T14:01:00+08:00' }), textEvidence: anchor }] : preflight?.targetAt ? [{ group: 'time', subjectHint: 'time:end', observedFact: preflight.targetAt, textEvidence: '经过一分钟，主角在街边休息。' }] : [];
      text =
        plan.badStoryNumber === number
          ? '{bad-output'
          : `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${narrative}</正文><短期记忆>第${number}幕的街边休息</短期记忆><变量规划>${JSON.stringify(timeGuide)}</变量规划><行动选项>留在街边\n看看四周\n询问路线</行动选项>`;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
      });
      return;
    }
    if (stage === 'entities') {
      text = variableReply({commands:[]});
    } else if (stage === 'variables') {
      const state = variableRequestState.parse(ctx.SAVE_STATE),
        story = StorySchema.parse(ctx.STORY_RESULT);
      const opening = record(ctx.OPENING_TIME);
      let endAt: string;
      if (opening.status === 'candidate') {
        endAt = GameTimeSchema.parse(opening.endAt);
      } else if (opening.status === 'pending' && state.worldClock === null) {
        // This synthetic Story explicitly set the opening at 14:00 and ended at 14:01.
        endAt = '2015-07-08T14:01:00+08:00';
      } else {
        endAt = new Date(Date.parse(GameTimeSchema.parse(state.worldClock)) + 60000).toISOString();
      }
      const commands: DomainCommand[] = [
        {
          type: 'SetWorldClock',
          commandId: 'minute',
          evidence: '经过一分钟，主角在街边休息。',
          worldClock: endAt,
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
      text = variableReply({ commands, rejectedSuggestions: [], unresolved: [] });
    } else {
      if (plan.holdWorld) await plan.holdWorld;
      text = JSON.stringify({
        worldCommands: [],
        taskCommands: [],
        eventCommands: [],
        visibleHooks: [{ text: '绝不自动发布的后台线索', revealAfter: string(ctx.worldClock) }],
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
const workflow = (page: Page) => page.getByRole('region', { name: '四阶段工作流' });
async function ready(page: Page, number = 1) {
  await expect(page.getByTestId('story-reader').locator('article').last()).toContainText(
    `第${number}幕`,
  );
  if ((page.viewportSize()?.width ?? 1000) <= 900) {
    await closeWorkflowSheet(page);
    await expect(page.getByRole('status').filter({ hasText: '本回合已结算' })).toBeVisible();
  } else await expect(workflow(page)).toContainText('本回合已结算',{timeout:20_000});
}
async function opening(page: Page) {
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await ready(page);
}

test('真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致', async ({ page, isMobile }, info) => {
  test.setTimeout(120000);
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await ready(page);
  const initial = await stored(page),
    start = Date.parse('2015-07-08T14:00:00+08:00');
  expect(initial.state.openingTimePending).toBeUndefined(); // 开局自动正式结算，待下一条行动。
  expect(initial.state.turnNumber).toBe(1);
  expect(initial.state.economy.cash).toBeNull();
  if (isMobile) {
    await page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '人物', exact: true }).click();
    const status = page.getByRole('dialog', { name: '此时此地' });
    await expect(status.getByRole('region', { name: '主角信息' })).toContainText('未确认');
    await page.keyboard.press('Escape');
  } else await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText('未确认');
  for (let index = 1; index <= 9; index++) {
    const action = `行动${index}：在街边等待一分钟`;
    await page.getByLabel('你的行动', { exact: true }).fill(action);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await ready(page, index + 1);
    const result = await stored(page);
    expect(result.state.turnNumber).toBe(index + 1);
    expect(result.state.revision).toBe(index + 1);
    expect(result.state.journal).toHaveLength(index + 1);
    expect(result.state.memories.short).toHaveLength(index + 1);
    expect(result.state.memories.short.at(-1)).toMatchObject({
      text: `第${index + 1}幕的街边休息`,
      sourceTurnIds: [result.state.journal[index].turnId],
      createdAtGameTime: result.state.worldClock,
      visibility: 'player_known',
      affectedEntityRefs: [],
    });
    expect(result.draft.userInput).toBe('');
    expect(result.draft.turnKind).toBe('regular');
    expect(Date.parse(result.state.worldClock)).toBe(start + (index + 1) * 60000);
    expect(result.state.items.notice.ownerRef?.id).toBe(result.state.protagonist.id);
    expect(result.state.initialCompanionId).toBe(initial.state.initialCompanionId);
    expect(result.state.npc.companion).toEqual(initial.state.npc.companion);
    await expect(page.getByTestId('story-reader').locator('.chapter-heading').last()).toHaveText(
      `第 ${index + 1} 回合`,
    );
    expect(server.stories.find((s) => s.number === index + 1)?.action).toBe(action);
    expect(server.stories.find((s) => s.number === index + 1)?.context).toContain(
      `第${index}幕的街边休息`,
    );
    if (index === 5) {
      await page.reload(); await openGameTools(page);
      await ready(page, 6);
    }
  }
  const final = await stored(page);
  expect(server.calls).toHaveLength(40);
  expect(final.state.journal[0].story.turnKind).toBe('opening');
  expect(final.state.journal.slice(1).every((j) => j.story.turnKind === 'regular')).toBe(true);
  expect(JSON.stringify(final.state)).not.toContain('绝不自动发布的后台线索');
  expect(JSON.stringify(final.state.journal)).not.toContain('内部未解决事项');
  await expect(page.locator('main')).not.toContainText('绝不自动发布的后台线索');
  await page.reload(); await openGameTools(page);
  expect(await stored(page)).toEqual(final);
  await ready(page, 10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ten-committed-turns.png'), fullPage: true });
});

test('下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合', async ({ page }) => {
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await ready(page);
  server.plan.badStoryNumber = 2;
  await page.getByLabel('你的行动', { exact: true }).fill('去街边等待');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(workflow(page).getByRole('alert')).toContainText('正文生成');
  const failed = await stored(page);
  expect(failed.state.turnNumber).toBe(1);
  expect(failed.draft.userInput).toBe('去街边等待');
  expect(failed.draft.stageStatus.story).toBe('failed');
  await page.reload(); await openGameTools(page);
  server.plan.badStoryNumber = 0;
  await workflow(page).getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await ready(page, 2);
  expect((await stored(page)).state.turnNumber).toBe(2);
  expect((await stored(page)).state.journal[0]).toEqual(failed.state.journal[0]);
  expect(server.calls).toEqual([
    'story',
    'entities',
    'variables',
    'world',
    'story',
    'story',
    'entities',
    'variables',
    'world',
  ]);
});

test('提交事务中途失败 UI 不虚报成功；重试后只结算一次', async ({ page, isMobile }) => {
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await ready(page);
  const before = await stored(page);
  await page.evaluate(baseRevision => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, '__restoreTurnPut', {
      value: () => {
        IDBObjectStore.prototype.put = original;
      },
      configurable: true,
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'drafts' && value?.baseSaveRevision === baseRevision + 1)
        throw new DOMException('isolated test', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  }, before.state.revision);
  await page.getByLabel('你的行动', { exact: true }).fill('等待下一轮');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => server.calls.length).toBe(6);
  if (isMobile) {
    const diagnostic = page.getByRole('dialog', { name: '重试与变更详情' });
    await expect(diagnostic).toBeVisible();
    await diagnostic.getByRole('tab', { name: '运行日志' }).click();
    await expect(diagnostic).toContainText('正式结算');
    await page.keyboard.press('Escape');
    await expect(diagnostic).not.toBeVisible();
  } else await expect(page.getByRole('alert').filter({ hasText: '正式结算' })).toBeVisible();
  const failed = await stored(page);
  expect(failed.state).toEqual(before.state);
  expect(failed.draft.userInput).toBe('等待下一轮');
  expect(failed.draft.stageStatus).toMatchObject({ story: 'ready', variables: 'ready', world: 'ready' });
  await page.evaluate(() => {
    const restore = Reflect.get(window, '__restoreTurnPut');
    if (typeof restore === 'function') restore();
  });
  const retry = isMobile
    ? page.locator('.composer-workflow-action').and(page.getByRole('button', { name: '完成本回合结算', exact: true }))
    : workflow(page).getByRole('button', { name: '完成本回合结算', exact: true });
  await retry.click();
  await ready(page, 2);
  const saved = await stored(page);
  expect(saved.state.turnNumber).toBe(2);
  expect(saved.state.revision).toBe(before.state.revision + 1);
  expect(saved.draft.baseSaveRevision).toBe(saved.state.revision);
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world', 'story', 'entities', 'variables', 'world']);
});

test('快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿', async ({
  page,
  context,
}) => {
  await configure(page);
  const server = await mock(page);
  await createCharacter(page);
  await ready(page);
  const other = await context.newPage();
  await other.goto(page.url());
  // A new Playwright tab has independent sessionStorage. Both competing clients
  // need the same test-only credentials and the context-wide Mock above.
  await other.evaluate(async () => {
    const configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { readAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const vault = new CredentialVault(sessionStorage, localStorage);
    for (const channel of readAiConfig(localStorage).channels) vault.set(channel.id, 'mock-loop-secret');
  });
  await other.reload();
  await openGameTools(other);
  await closeWorkflowSheet(other);
  await page.getByLabel('你的行动', { exact: true }).fill('在街边等待');
  await other.getByLabel('你的行动', { exact: true }).fill('在街边等待');
  await Promise.all(
    [page, other].map(async (tab) => {
      const send = tab.getByRole('button', { name: '发送', exact: true });
      await expect(send).toBeEnabled();
    }),
  );
  await Promise.all(
    [page, other].map((tab) => tab.getByRole('button', { name: '发送', exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    })),
  );
  try {
    await expect.poll(async () => (await stored(page)).state.turnNumber, { timeout: 15_000 }).toBe(2);
  } catch (error) {
    const alerts = await Promise.all([page, other].map(tab => tab.getByRole('alert').allTextContents()));
    console.error('提交诊断', { calls: server.calls, alerts, draft: (await stored(page)).draft.stageStatus });
    throw error;
  }
  const result = await stored(page);
  expect(result.state.journal).toHaveLength(2);
  expect(result.draft.baseSaveRevision).toBe(2);
  expect(result.draft.userInput).toBe('');
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world', 'story', 'entities', 'variables', 'world']);
  await other.close();
});

test('阶段未完成或主动关闭时，即使填写行动也不能部分结算', async ({ page }) => {
  await configure(page, false);
  const server = await mock(page);
  await createCharacter(page);
  await expect(page.getByLabel('场外与网络', { exact: true })).not.toBeChecked();
  await expect(workflow(page).getByRole('status')).toContainText('阶段已关闭');
  await page.getByLabel('你的行动', { exact: true }).fill('等待');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  expect((await stored(page)).state.turnNumber).toBe(0);
  await page.getByLabel('场外与网络', { exact: true }).check();
  await workflow(page).getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world']);
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
  await page.goto('/#game/save-a'); await openGameTools(page);
  await opening(page);
  await page.getByLabel('你的行动', { exact: true }).fill('继续休息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await ready(page, 2);
  const state = (await stored(page)).state;
  expect(state.economy.cash).toBe(4000);
  expect(state.worldClock).not.toBe('2026-10-18T08:00:00+08:00');
  await expect(page.getByRole('complementary', { name: '主角信息' })).toContainText('40.00 元');
  await page.reload(); await openGameTools(page);
  expect((await stored(page)).state).toEqual(state);
});
