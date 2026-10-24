import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Stage = 'story' | 'variables' | 'world';
function holdRequest() {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}
async function seed(page: Page, mode: 'opening' | 'regular' = 'opening') {
  await page.goto('/');
  const before = await page.evaluate(async (mode) => {
    const repositoryPath = '/src/services/storage/saveRepository.ts',
      fixturePath = '/src/tests/fixtures/world.ts',
      draftPath = '/src/domain/drafts.ts',
      configPath = '/src/services/ai/configuration.ts',
      credentialPath = '/src/services/ai/credentials.ts',
      settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(repositoryPath),
      { worldState } = await import(fixturePath),
      { createTurnDraft } = await import(draftPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath),
      { CredentialVault } = await import(credentialPath),
      { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(),
      config = defaultAiConfig();
    channel.baseUrl = 'https://turn.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-auto-key');
    const repo = await SaveRepository.open();
    const state = await repo.create({ ...worldState(), title: '自动协调测试（隔离）' });
    await repo.saveDraft(createTurnDraft('save-a', 0, 'turn-a', mode, ''), null);
    repo.close();
    return JSON.stringify(state);
  }, mode);
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toBeVisible();
  return before;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts',
      { SaveRepository } = await import(path),
      repo = await SaveRepository.open();
    try {
      return {
        formal: JSON.stringify(await repo.load('save-a')),
        draft: await repo.loadDraft('save-a'),
      };
    } finally {
      repo.close();
    }
  });
}
const narrative = '经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。';
function payload(stage: Stage, bad = false) {
  const text = bad
    ? '{bad-json'
    : stage === 'story'
      ? `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${narrative}</正文><短期记忆>用餐</短期记忆><变量规划>[]</变量规划>`
      : JSON.stringify(
          stage === 'variables'
            ? {
                commands: [
                  {
                    type: 'SetWorldClock',
                    commandId: 'clock',
                    worldClock: '2026-10-18T08:10:00+08:00',
                    evidence: '经过十分钟，主角完成用餐。',
                  },
                  {
                    type: 'SpendFunds',
                    commandId: 'meal',
                    account: 'cash',
                    amount: 3000,
                    purpose: '用餐',
                    evidence: '主角已经用现金支付30元吃饭。',
                  },
                ],
                rejectedSuggestions: [],
                unresolved: [],
              }
            : {
                worldCommands: [],
                taskCommands: [],
                eventCommands: [],
                futureEvents: [],
                visibleHooks: [{ text: '未发布的后台线索' }],
                timelineCandidates: [],
                unresolved: [],
              },
        );
  return stage === 'story'
    ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    : JSON.stringify({
        choices: [{ message: { content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
}
async function mock(
  page: Page,
  options: { bad?: Stage; slow?: Stage; serverOnce?: Stage; hold?: Promise<void> } = {},
) {
  const calls: Stage[] = [];
  await page.route('https://turn.mock.invalid/**', async (route) => {
    const stage: Stage = route.request().postDataJSON().model;
    calls.push(stage);
    if (stage === options.slow)
      await (options.hold ?? new Promise((resolve) => setTimeout(resolve, 800)));
    await route
      .fulfill({
        status:
          options.serverOnce === stage && calls.filter((s) => s === stage).length === 1 ? 503 : 200,
        contentType: stage === 'story' ? 'text/event-stream' : 'application/json',
        body: payload(stage, stage === options.bad),
      })
      .catch(() => undefined);
  });
  return { calls, options };
}
const workflow = (page: Page) => page.getByRole('region', { name: '三阶段工作流' });
async function complete(page: Page) {
  await expect(workflow(page)).toContainText('三阶段候选已完成，填写下一步行动');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
}
for (const mode of ['opening', 'regular'] as const) {
  test(`${mode} 一次点击依次完成三阶段；真实快照、候选与移动布局`, async ({ page }, info) => {
    const waiting = holdRequest();
    const before = await seed(page, mode),
      { calls } = await mock(page, { slow: 'variables', hold: waiting.hold });
    await workflow(page)
      .getByRole('button', {
        name: mode === 'opening' ? '自动生成开局' : '自动生成本回合',
        exact: true,
      })
      .click();
    await expect(workflow(page).getByRole('status')).toContainText('变量管理');
    await expect(page.getByTestId('story-reader')).toContainText(narrative);
    waiting.release();
    await complete(page);
    const after = await stored(page);
    expect(calls).toEqual(['story', 'variables', 'world']);
    expect(after.formal).toBe(before);
    expect(after.draft.stageStatus).toEqual({ story: 'ready', variables: 'ready', world: 'ready' });
    await expect(page.locator('main')).not.toContainText('未发布的后台线索');
    const snapshot = await page.evaluate(async () => {
      const path = '/src/services/ai/inspection.ts',
        { requestInspections } = await import(path);
      return requestInspections.getSnapshot();
    });
    for (const stage of ['story', 'variables', 'world'])
      expect(
        snapshot
          .find((s: { stage: string }) => s.stage === stage)
          .scope.modules.some((m: { id: string }) => m.id === `stages.${mode}.${stage}`),
      ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('mock-auto-key');
    await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
    await complete(page);
    expect(calls).toHaveLength(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`auto-${mode}.png`), fullPage: true });
  });
}
for (const failed of ['variables', 'world'] as const) {
  test(`${failed} 失败保留上游；刷新后恢复只请求失败及后续阶段`, async ({ page }) => {
    const before = await seed(page),
      plan = await mock(page, { bad: failed });
    await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
    await expect(workflow(page).getByRole('alert')).toContainText(
      failed === 'variables' ? '变量管理' : '动态世界',
    );
    expect(plan.calls).toEqual(
      failed === 'variables' ? ['story', 'variables'] : ['story', 'variables', 'world'],
    );
    const partial = await stored(page);
    expect(partial.draft.story.narrative).toBe(narrative);
    await page.reload();
    plan.options.bad = undefined;
    await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
    await complete(page);
    expect(plan.calls).toEqual(
      failed === 'variables'
        ? ['story', 'variables', 'variables', 'world']
        : ['story', 'variables', 'world', 'world'],
    );
    expect((await stored(page)).formal).toBe(before);
  });
}
test('瞬时服务失败重试一次后完成，费用与次数可见', async ({ page }) => {
  await seed(page);
  const plan = await mock(page, { serverOnce: 'variables' });
  await expect(workflow(page)).toContainText('可能产生额外 API 费用');
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await complete(page);
  expect(plan.calls).toEqual(['story', 'variables', 'variables', 'world']);
  expect((await stored(page)).draft.failures[0]).toMatchObject({
    stage: 'variables',
    errorCode: 'server',
  });
});
test('取消世界后保留上游；快速双击不重复，旧回包不能推进新会话', async ({ page }) => {
  const waiting = holdRequest();
  const before = await seed(page),
    plan = await mock(page, { slow: 'world', hold: waiting.hold });
  await workflow(page)
    .getByRole('button', { name: '自动生成开局', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => plan.calls.length).toBe(3);
  await workflow(page).getByRole('button', { name: '取消自动执行', exact: true }).click();
  await expect(workflow(page).getByRole('alert')).toContainText('取消');
  plan.options.slow = undefined;
  await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
  await complete(page);
  waiting.release();
  expect(plan.calls).toEqual(['story', 'variables', 'world', 'world']);
  expect((await stored(page)).formal).toBe(before);
});
test('关闭两个阶段只生成正文，再开启后补算不 Roll', async ({ page }) => {
  const before = await seed(page),
    plan = await mock(page);
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await page.getByLabel('动态世界', { exact: true }).uncheck();
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(workflow(page).getByRole('status')).toContainText('已按开关跳过');
  expect(plan.calls).toEqual(['story']);
  await page.getByLabel('变量管理', { exact: true }).check();
  await page.getByLabel('动态世界', { exact: true }).check();
  await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
  await complete(page);
  expect(plan.calls).toEqual(['story', 'variables', 'world']);
  expect((await stored(page)).formal).toBe(before);
});
test('运行中切换开关不会改变本次冻结配置', async ({ page }) => {
  await seed(page);
  const waiting = holdRequest();
  const plan = await mock(page, { slow: 'story', hold: waiting.hold });
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect.poll(() => plan.calls.length).toBe(1);
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await page.getByLabel('动态世界', { exact: true }).uncheck();
  waiting.release();
  await complete(page);
  expect(plan.calls).toEqual(['story', 'variables', 'world']);
});
test('离开页面取消当前请求，不自动启动下游；再次打开可恢复', async ({ page }) => {
  const waiting = holdRequest();
  const before = await seed(page),
    plan = await mock(page, { slow: 'variables', hold: waiting.hold });
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect.poll(() => plan.calls.length).toBe(2);
  await page.getByRole('button', { name: '切换存档', exact: true }).click();
  plan.options.slow = undefined;
  await page.goto('/#game/save-a');
  await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
  await complete(page);
  waiting.release();
  expect(plan.calls).toEqual(['story', 'variables', 'variables', 'world']);
  expect((await stored(page)).formal).toBe(before);
});
test('其他标签持有会话时拒绝第二个自动工作流', async ({ page, context }) => {
  await seed(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = await mock(page, { slow: 'story', hold });
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect.poll(() => first.calls.length).toBe(1);
  const other = await context.newPage();
  await other.goto('/#game/save-a');
  const second = await mock(other);
  await workflow(other).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(workflow(other).getByRole('alert')).toContainText('此存档已有阶段请求');
  expect(second.calls).toHaveLength(0);
  await workflow(page).getByRole('button', { name: '取消自动执行', exact: true }).click();
  release();
  await other.close();
});

test('正文失败不启动下游，安全失败状态刷新后仍保留并可恢复', async ({ page }) => {
  const before = await seed(page),
    plan = await mock(page, { bad: 'story' });
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(workflow(page).getByRole('alert')).toContainText('正文生成');
  const failed = await stored(page);
  expect(failed.draft.stageStatus.story).toBe('failed');
  expect(failed.draft.story).toBeUndefined();
  expect(plan.calls).toEqual(['story']);
  await page.reload();
  await expect(workflow(page)).toContainText('本次未完成');
  plan.options.bad = undefined;
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await complete(page);
  expect(plan.calls).toEqual(['story', 'story', 'variables', 'world']);
  expect((await stored(page)).formal).toBe(before);
});

test('只开启世界时明确预览；补开变量会失效旧世界并顺序重算', async ({ page }) => {
  const before = await seed(page),
    plan = await mock(page);
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await workflow(page).getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(workflow(page).getByRole('status')).toContainText('世界仅为预览');
  expect(plan.calls).toEqual(['story', 'world']);
  expect((await stored(page)).draft.world.validation).toBe('preview');
  await page.getByLabel('变量管理', { exact: true }).check();
  await workflow(page).getByRole('button', { name: '继续自动执行', exact: true }).click();
  await complete(page);
  expect(plan.calls).toEqual(['story', 'world', 'variables', 'world']);
  expect((await stored(page)).formal).toBe(before);
});
