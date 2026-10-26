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
async function creation(page: Page, preference: string, background = '') {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟'); await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByLabel('性别', { exact: true }).fill('女'); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /^教师/ }).check(); await page.getByRole('button', { name: /下一步/ }).click();
  if (background) await page.getByLabel('人物背景（可选）').fill(background);
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
  const calls: { stage: string; context: Record<string, unknown> }[] = [], plan = { badDate: false, minimal: false, variableCase: 'empty' };
  await page.route('https://opening-ui.mock.invalid/**', async (route) => {
    const body = record(route.request().postDataJSON()), stage = string(body.model);
    const messages = array(body.messages).map((message) => string(record(message).content)).join('\n');
    const context = record(JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1])); calls.push({ stage, context });
    let text: string;
    if (stage === 'story') {
      const opening = record(context.OPENING_TIME).status === 'pending', calendar = chinaCalendar(startAt);
      const anchor = opening && !plan.minimal ? `${calendar.year}年${calendar.month}月${calendar.day}日${String(calendar.hour).padStart(2, '0')}:${String(calendar.minute).padStart(2, '0')}，${calendar.weekday}。` : '';
      const guide = opening ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: plan.badDate ? '2023-02-29T08:00:00+08:00' : startAt, endAt }), textEvidence: plan.minimal ? '本幕时间由场景安排，无需逐字引用。' : anchor }] : [];
      text = `<thinking>本轮创作提纲：时间和人物连续。</thinking><正文>${anchor}主角在街边喝了一口水。</正文><短期记忆>主角在街边喝水。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
    } else {
      const opening = Boolean(context.OPENING_TIME), hero = record(record(context.SAVE_STATE).protagonist);
      const minimalCommands = !opening || plan.variableCase === 'empty' ? [] : plan.variableCase === 'npc'
        ? [{ type: 'CreateNpc', commandId: 'scene-person', evidence: '本幕在场服务人员', npc: { id: 'new-npc', identityKey: 'identity-new-npc', kind: 'ordinary', name: '店员', aliases: [], skills: [], onScene: true, locationId: hero.locationId, affinity: 0, relationshipText: '初次见面', memories: [], knownInformation: [] } }]
        : [{ type: 'AcquireItem', commandId: 'gift', evidence: '临别得到一份证件', item: { id: 'gift', name: '证件', category: 'document', quantity: 1, conditionText: '完好', ownerRef: { kind: 'protagonist', id: hero.id } } }];
      text = JSON.stringify(stage === 'variables' ? {
        commands: plan.minimal ? minimalCommands : [{ type: 'SetWorldClock', commandId: 'clock', evidence: '主角在街边喝了一口水。',
          worldClock: opening ? string(record(context.OPENING_TIME).endAt) : new Date(Date.parse(string(record(context.SAVE_STATE).worldClock)) + 15000).toISOString() }], rejectedSuggestions: [], unresolved: [],
      } : { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] });
    }
    await route.fulfill(stage === 'story' ? { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }
      : { json: { choices: [{ message: { content: text } }] } });
  });
  return { calls, plan };
}
const workflow = (page: Page) => page.getByRole('region', { name: '三阶段工作流', exact: true });
const ready = async (page: Page) => {
  // 创角先异步持久化，再懒加载游戏；界面打开前不能假定已有存档可查询。
  await expect(page.locator('.game-layout')).toBeVisible();
  await expect.poll(async () => (await stored(page)).draft.stageStatus.world, { timeout: 15000 }).toBe('ready');
  await expect(workflow(page).getByRole('status')).toContainText('三阶段候选已完成');
};

for (const scenario of [
  { preference: '2022年12月31日晚上开始。', startAt: '2022-12-31T23:59:00+08:00', endAt: '2023-01-01T00:02:00+08:00' },
  { preference: '故事发生在2015年夏天。', startAt: '2015-07-08T14:00:00+08:00', endAt: '2015-07-08T14:02:00+08:00' },
  { preference: '', startAt: '2008-08-10T10:00:00+08:00', endAt: '2008-08-10T10:01:00+08:00' },
  { preference: '希望设定在2015年。', background: '人物背景：2001年出生，2023年毕业。', startAt: '2015-07-08T14:00:00+08:00', endAt: '2015-07-08T14:02:00+08:00' },
  { preference: '', background: '角色成长于重庆，故事发生在2008年夏天。', startAt: '2008-08-10T10:00:00+08:00', endAt: '2008-08-10T10:01:00+08:00' },
]) test(`开局时间待定→候选→首次发送正式确立：${scenario.preference || ('background' in scenario ? scenario.background : '无时间设定')}`, async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const server = await mock(page, scenario.startAt, scenario.endAt); await creation(page, scenario.preference, 'background' in scenario ? scenario.background : '');
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

test('相对年份和履历完整交给同一次Story，不以中文正则阻断创角', async ({ page }) => {
  test.setTimeout(60000); await prepare(page); const server = await mock(page, '2015-07-08T14:00:00+08:00', '2015-07-08T14:02:00+08:00');
  await creation(page, '故事发生在今年夏天。'); await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  expect(server.calls).toHaveLength(3);
  expect(record(server.calls[0].context.OPENING_TIME).playerPreference).toBe('故事发生在今年夏天。');
  expect((await stored(page)).state.openingTimePending).toBe(true);
});

test('年代优先指令完整传入Story；程序不二次判定自然语言年代', async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const server = await mock(page, '2008-08-10T10:00:00+08:00', '2008-08-10T10:01:00+08:00');
  await creation(page, '日期定为2015年。', '人物背景：2001年出生，2023年毕业。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
  expect(record(server.calls[0].context.OPENING_TIME)).toMatchObject({ playerPreference: '日期定为2015年。', playerBackground: '人物背景：2001年出生，2023年毕业。' });
  const saved = await stored(page); expect(saved.state.openingTimePending).toBe(true);
  await page.reload(); await ready(page); expect(server.calls).toHaveLength(3); expect(await stored(page)).toEqual(saved);
});

for (const kind of ['empty', 'npc', 'item']) test(`M8最小开局${kind}：无正文时间/重复时钟/逐字证据，发送后正式结算并自动下一回合`, async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const startAt = '2015-07-08T14:00:00+08:00', endAt = '2015-07-08T14:02:00+08:00';
  const server = await mock(page, startAt, endAt); server.plan.minimal = true; server.plan.variableCase = kind;
  await creation(page, '故事发生在2015年夏天。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  const first = await stored(page);
  expect(first.draft.variables!.result.commands.some((c) => c.type === 'SetWorldClock')).toBe(false);
  expect(first.state.openingTimePending).toBe(true); expect(first.state.worldClock).toBe(pendingOpeningClock);
  expect(server.calls[1].context.SAVE_STATE).toHaveProperty('worldClock', endAt);
  expect(server.calls[2].context.TIME_WINDOW).toEqual({ from: startAt, to: endAt });
  const rounds = kind === 'empty' ? 10 : 1;
  for (let index = 1; index <= rounds; index++) {
    await page.getByLabel('你的行动', { exact: true }).fill(`观察周围${index}`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(index); await ready(page);
    expect((await stored(page)).state.worldClock).toBe(endAt); // 普通回合合法空变更不固定加时。
  }
  const saved = await stored(page);
  expect(saved.state.appliedCommands.filter((c) => c.commandId.startsWith('opening-clock:'))).toHaveLength(1);
  expect(saved.state.journal).toHaveLength(rounds); expect(server.calls).toHaveLength((rounds + 1) * 3);
  if (kind === 'npc') expect(saved.state.npc['new-npc']).toHaveProperty('onScene', true);
  if (kind === 'item') expect(saved.state.items.gift.ownerRef).toEqual({ kind: 'protagonist', id: saved.state.protagonist.id });
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(saved); expect(server.calls).toHaveLength((rounds + 1) * 3);
});
