import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { record, array, string } from '../src/services/ai/protocols';
import { chinaCalendar, pendingOpeningClock } from '../src/domain/openingTime';
import { GameStateSchema } from '../src/domain/state';
import { TurnDraftSchema } from '../src/domain/drafts';

async function prepare(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const sp = '/src/ui/settings/model.ts', cp = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts';
    const { defaultSettings, settingsKey } = await import(sp), { defaultAiConfig, newChannel, saveAiConfig } = await import(cp), { CredentialVault } = await import(vp);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://opening-ui.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'opening-mock-only');
  });
  await page.reload();
}
async function creation(page: Page, preference: string) {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟'); await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByLabel('性别', { exact: true }).fill('女'); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /^教师/ }).check(); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click(); await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await expect(page.getByText('开局时间待确认', { exact: true })).toBeVisible();
  await expect(page.locator('.creation-card')).not.toContainText('时间以创角开始时刻初始化');
  await page.getByLabel('开局偏好（可选）').fill(preference);
}
async function stored(page: Page) {
  const value = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame(location.hash.slice(6)); } finally { repo.close(); }
  });
  return { state: GameStateSchema.parse(value.state), draft: TurnDraftSchema.parse(value.draft) };
}
async function showClock(page: Page) {
  const details = page.locator('.hero-sidebar > details');
  if (await details.locator('summary').isVisible() && !await details.evaluate((element) => element.hasAttribute('open'))) await details.locator('summary').click();
  return page.getByRole('complementary', { name: '主角信息' });
}
async function mock(page: Page, startAt: string, endAt: string) {
  const calls: { stage: string; context: Record<string, unknown> }[] = [], plan = { badDate: false };
  await page.route('https://opening-ui.mock.invalid/**', async (route) => {
    const body = record(route.request().postDataJSON()), stage = string(body.model);
    const messages = array(body.messages).map((message) => string(record(message).content)).join('\n');
    const context = record(JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1])); calls.push({ stage, context });
    let text: string;
    if (stage === 'story') {
      const opening = record(context.OPENING_TIME).status === 'pending', calendar = chinaCalendar(startAt);
      const anchor = opening ? `${calendar.year}年${calendar.month}月${calendar.day}日${String(calendar.hour).padStart(2, '0')}:${String(calendar.minute).padStart(2, '0')}，${calendar.weekday}。` : '';
      const guide = opening ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: plan.badDate ? '2023-02-29T08:00:00+08:00' : startAt, endAt }), textEvidence: anchor }] : [];
      text = `<thinking>本轮创作提纲：时间和人物连续。</thinking><正文>${anchor}主角在街边喝了一口水。</正文><短期记忆>主角在街边喝水。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
    } else text = JSON.stringify(stage === 'variables' ? {
      commands: [{ type: 'SetWorldClock', commandId: 'clock', evidence: '主角在街边喝了一口水。',
        worldClock: context.OPENING_TIME ? string(record(context.OPENING_TIME).endAt) : new Date(Date.parse(string(record(context.SAVE_STATE).worldClock)) + 15000).toISOString() }], rejectedSuggestions: [], unresolved: [],
    } : { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] });
    await route.fulfill(stage === 'story' ? { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }
      : { json: { choices: [{ message: { content: text } }] } });
  });
  return { calls, plan };
}
const workflow = (page: Page) => page.getByRole('region', { name: '三阶段工作流', exact: true });
const ready = async (page: Page) => {
  await expect.poll(async () => (await stored(page)).draft.stageStatus.world, { timeout: 15000 }).toBe('ready');
  await expect(workflow(page).getByRole('status')).toContainText('三阶段候选已完成');
};

for (const scenario of [
  { preference: '2022年12月31日晚上开始。', startAt: '2022-12-31T23:59:00+08:00', endAt: '2023-01-01T00:02:00+08:00' },
  { preference: '故事发生在2015年夏天。', startAt: '2015-07-08T14:00:00+08:00', endAt: '2015-07-08T14:02:00+08:00' },
  { preference: '', startAt: '2008-08-10T10:00:00+08:00', endAt: '2008-08-10T10:01:00+08:00' },
]) test(`开局时间待定→候选→首次发送正式确立：${scenario.preference || '无时间设定'}`, async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const server = await mock(page, scenario.startAt, scenario.endAt); await creation(page, scenario.preference);
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  const initial = await stored(page), sidebar = await showClock(page);
  expect(initial.state.openingTimePending).toBe(true); expect(initial.state.worldClock).toBe(pendingOpeningClock);
  await expect(sidebar.locator('.game-clock')).toHaveText('开局时间待确认');
  await expect(sidebar).toContainText('候选时间：'); await expect(sidebar).toContainText('未正式结算');
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
  expect(server.calls[0].context.SAVE_STATE).toHaveProperty('worldClock', null);
  expect(server.calls[2].context.TIME_WINDOW).toEqual({ from: scenario.startAt, to: scenario.endAt });
  expect(JSON.stringify(server.calls)).not.toContain(pendingOpeningClock);
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(initial); expect(server.calls).toHaveLength(3);
  // 手机侧栏退出后输入区仍可操作；改变设置/读取都不重新授予开局收费权限。
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察街道');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.revision).toBe(1); await ready(page);
  const committed = await stored(page);
  expect(committed.state.openingTimePending).toBeUndefined(); expect(committed.state.worldClock).toBe(scenario.endAt);
  expect(committed.state.journal).toHaveLength(1); expect(committed.draft.turnKind).toBe('regular');
  await expect((await showClock(page)).locator('.game-clock')).not.toHaveText('开局时间待确认');
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world', 'story', 'variables', 'world']);
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(committed); expect(server.calls).toHaveLength(6);
});

test('非法AI日期拒绝保存、不调用下游；刷新无隐式重发，主动恢复仍待定到正式提交', async ({ page }) => {
  test.setTimeout(60000); await prepare(page); const server = await mock(page, '2015-07-08T14:00:00+08:00', '2015-07-08T14:02:00+08:00');
  server.plan.badDate = true; await creation(page, '故事发生在2015年夏天。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(workflow(page).getByRole('alert')).toBeVisible();
  const before = await stored(page); expect(before.draft.story).toBeUndefined(); expect(before.state.openingTimePending).toBe(true);
  expect(server.calls.map((call) => call.stage)).toEqual(['story']);
  await page.reload(); await expect(workflow(page).getByRole('status')).toHaveText('需要处理');
  expect((await stored(page)).draft.failures).toEqual(before.draft.failures); expect(server.calls).toHaveLength(1);
  server.plan.badDate = false; await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'story', 'variables', 'world']);
  expect((await stored(page)).state).toEqual(before.state);
});

test('含糊相对年份在创角阶段清楚报错，无存档、无AI请求；玩家改为明确年份后才创建', async ({ page }) => {
  test.setTimeout(60000); await prepare(page); const server = await mock(page, '2015-07-08T14:00:00+08:00', '2015-07-08T14:02:00+08:00');
  await creation(page, '故事发生在今年夏天。'); await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('明确年份'); expect(server.calls).toHaveLength(0);
  expect(await page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.list(); } finally { repo.close(); } })).toEqual([]);
  await page.getByLabel('开局偏好（可选）').fill('故事发生在2015年夏天。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  expect(server.calls).toHaveLength(3); expect((await stored(page)).state.openingTimePending).toBe(true);
});
