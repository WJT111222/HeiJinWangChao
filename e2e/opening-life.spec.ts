import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openingLives, openingValues, openingStart, openingEnd } from '../src/tests/fixtures/openingLives';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { worldResult } from '../src/tests/fixtures/world';

async function prepare(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const sp = '/src/ui/settings/model.ts', cp = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts';
    const { defaultSettings, settingsKey } = await import(sp), { defaultAiConfig, newChannel, saveAiConfig } = await import(cp), { CredentialVault } = await import(vp);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://opening-life.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'opening-life-mock-only');
  });
  await page.reload();
}
async function create(page: Page) {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟'); await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByLabel('性别', { exact: true }).fill('男'); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /^教师/ }).check(); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByLabel('人物背景（可选）').fill(openingLives[0].background);
  await page.getByRole('button', { name: '跳过背景，继续' }).click(); await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame(location.hash.slice(6)); } finally { repo.close(); }
  });
}
const settled = (page: Page) => expect(page.getByRole('region', { name: '三阶段工作流' }).getByRole('status')).toContainText('本回合已结算');
async function mock(page: Page) {
  const calls: string[] = [], control = { badWorld: false };
  await page.route('https://opening-life.mock.invalid/**', async route => {
    const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
    const messages = body.messages.map((m: { content: string }) => m.content).join('\n');
    const context = JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]), opening = Boolean(context.OPENING_TIME);
    const guide = opening ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: openingStart, endAt: openingEnd }) }] : [];
    const text = stage === 'story' ? `<thinking>保留背景，用日常细节展开。</thinking><正文>${opening ? openingLives[0].narrative : '【旁白】林舟走进早餐店，买了一份早餐。'}</正文><短期记忆>建立日常生活，了解新的机会。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`
      : stage === 'variables' ? variableTextEnvelope(`<命令>\n${opening ? `set opening.initialState = ${JSON.stringify(openingValues(openingLives[0]))}` : 'set worldClock = "2015-07-08T08:15:00+08:00"\nadd economy.cash = -1200'}\n</命令>`)
      : control.badWorld ? '{"worldCommands":"bad"}' : JSON.stringify(worldResult());
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
  });
  return { calls, control };
}

test('创角自动三阶段初始化生活基础，刷新不重复，下一回合正常消费', async ({ page }) => {
  await prepare(page); const server = await mock(page); await create(page); await settled(page);
  const first = await stored(page);
  expect(first.state).toMatchObject({ turnNumber: 1, revision: 1, worldClock: openingEnd, economy: { cash: 30000, onlineBalance: 3200000, debts: {} } });
  expect(first.state.economy.incomes['income-teacher']).toMatchObject({ status: 'expected', amount: 580000, scheduleText: '每月15日发薪' });
  expect(first.state.economy.incomes['income-teacher'].receivedAt).toBeUndefined(); expect(first.state.openingInitializationPending).toBeUndefined();
  expect(first.state.weatherText).toBe(openingValues(openingLives[0]).weatherText);
  expect(first.state.journal[0].story.narrative).toBe(openingLives[0].narrative); expect(server.calls).toEqual(['story', 'variables', 'world']);
  await page.reload(); await settled(page); expect(await stored(page)).toEqual(first); expect(server.calls).toHaveLength(3);
  await page.getByLabel('你的行动', { exact: true }).fill('去买早餐'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2); await settled(page);
  const second = await stored(page); expect(second.state.economy.cash).toBe(28800); expect(second.state.worldClock).toBe('2015-07-08T08:15:00+08:00');
  expect(second.state.economy.incomes).toEqual(first.state.economy.incomes); expect(server.calls).toHaveLength(6);
});

test('World失败不提前初始化，刷新后明确恢复只请求World', async ({ page }) => {
  await prepare(page); const server = await mock(page); server.control.badWorld = true; await create(page);
  const workflow = page.getByRole('region', { name: '三阶段工作流' });
  await expect(workflow.getByRole('status')).toHaveText('需要处理');
  const before = await stored(page); expect(before.state.economy.cash).toBeNull(); expect(before.state.openingInitializationPending).toBe(true);
  expect(before.draft.variables.validation).toBe('validated'); expect(server.calls).toEqual(['story', 'variables', 'world']);
  await page.reload(); await expect(workflow.getByRole('status')).toHaveText('需要处理'); expect(await stored(page)).toEqual(before); expect(server.calls).toHaveLength(3);
  server.control.badWorld = false; await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  expect((await stored(page)).state.economy.cash).toBe(30000); expect(server.calls).toEqual(['story', 'variables', 'world', 'world']);
});
