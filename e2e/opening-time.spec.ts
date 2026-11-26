import { openWorkflow } from './helpers/gameLayout';
import { variableReply } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { record, array, string } from '../src/services/ai/protocols';
import { chinaCalendar, pendingOpeningClock } from '../src/domain/openingTime';
import { GameStateSchema } from '../src/domain/state';
import { TurnDraftSchema } from '../src/domain/drafts';
// 电脑端流程测试：只在 desktop 项目运行。三阶段、存档、校验等逻辑两端共用，手机界面由 mobile-* 专项覆盖。
test.skip(({ isMobile }) => isMobile, '电脑端流程测试，手机界面由 mobile-* 专项覆盖');

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
  await page.getByRole('radio', { name: '女性', exact: true }).check(); await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '专业与公共服务', exact: true }).click();
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
      // Variables starts from a pending clock and emits the actual window independently of Story notes.
      const clocks = (opening ? [plan.badDate ? '2023-02-29T08:00:00+08:00' : startAt, endAt]
        : plan.minimal ? [] : [new Date(Date.parse(string(record(context.SAVE_STATE).worldClock)) + 15000).toISOString()])
        .map(worldClock => ({ type: 'SetWorldClock', worldClock }));
      text = (stage === 'variables' ? variableReply : JSON.stringify)(stage === 'variables' ? {
        commands: [...clocks, ...minimalCommands], rejectedSuggestions: [], unresolved: [],
      } : { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    }
    await route.fulfill(stage === 'story' ? { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }
      : { json: { choices: [{ message: { content: text } }] } });
  });
  return { calls, plan };
}
const workflow = (page: Page) => page.getByRole('region', { name: '四阶段工作流', exact: true });
const ready = async (page: Page) => {
  // 创角先异步持久化，再懒加载游戏；界面打开前不能假定已有存档可查询。
  await expect(page.locator('.game-layout')).toBeVisible();
  await expect.poll(async () => (await stored(page)).state.turnNumber > 0, { timeout: 15000 }).toBe(true);
  await expect(workflow(page).getByRole('status')).toContainText('本回合已结算');
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
  expect(initial.state.openingTimePending).toBeUndefined(); expect(initial.state.worldClock).toBe(scenario.endAt);
  expect(initial.state.turnNumber).toBe(1); await expect(sidebar.locator('time')).not.toHaveText('开局时间待确认');
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
  expect(server.calls[0].context.SAVE_STATE).toHaveProperty('worldClock', null);
  expect(server.calls[2].context.TIME_WINDOW).toEqual({ from: scenario.startAt, to: scenario.endAt });
  expect(JSON.stringify(server.calls)).not.toContain(pendingOpeningClock);
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(initial); expect(server.calls).toHaveLength(3);
  // 手机侧栏退出后输入区仍可操作；改变设置/读取都不重新授予开局收费权限。
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察街道');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.revision).toBe(2); await ready(page);
  const committed = await stored(page);
  expect(committed.state.openingTimePending).toBeUndefined(); expect(Date.parse(committed.state.worldClock)).toBe(Date.parse(scenario.endAt) + 15000);
  expect(committed.state.journal).toHaveLength(2); expect(committed.draft.turnKind).toBe('regular');
  await expect((await showClock(page)).locator('time')).not.toHaveText('开局时间待确认');
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world', 'story', 'variables', 'world']);
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(committed); expect(server.calls).toHaveLength(6);
});

test('Variables 非法日期不能保存或启动 World；刷新零请求，主动恢复复用正文完成开局', async ({ page }) => {
  test.setTimeout(60000); await prepare(page); const server = await mock(page, '2015-07-08T14:00:00+08:00', '2015-07-08T14:02:00+08:00');
  server.plan.badDate = true; await creation(page, '故事发生在2015年夏天。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect.poll(async () => (await stored(page)).draft.stageStatus.variables).toBe('failed');
  const before = await stored(page);
  expect(before.draft.stageStatus.story).toBe('ready');
  expect(before.draft.variables).toBeUndefined(); expect(before.draft.world).toBeUndefined();
  expect(before.state).toMatchObject({ turnNumber: 0, revision: 0, openingTimePending: true, worldClock: pendingOpeningClock, journal: [] });
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables']);
  await page.reload(); await expect(workflow(page).getByRole('status')).toHaveText('三阶段 · 变量生成失败 · 查看详情');
  expect(await stored(page)).toEqual(before); expect(server.calls).toHaveLength(2);
  server.plan.badDate = false; await openWorkflow(page); await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'variables', 'world']);
  const settled = (await stored(page)).state;
  expect(settled).toMatchObject({ turnNumber: 1, revision: 1, worldClock: '2015-07-08T14:02:00+08:00' });
  expect(settled.journal[0].story).toEqual(before.draft.story);
  expect(settled.protagonist).toEqual(before.state.protagonist);
});

test('相对年份和履历完整交给同一次Story，不以中文正则阻断创角', async ({ page }) => {
  test.setTimeout(60000); await prepare(page); const server = await mock(page, '2015-07-08T14:00:00+08:00', '2015-07-08T14:02:00+08:00');
  await creation(page, '故事发生在今年夏天。'); await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  expect(server.calls).toHaveLength(3);
  expect(record(server.calls[0].context.OPENING_TIME).playerPreference).toBe('故事发生在今年夏天。');
  expect((await stored(page)).state.openingTimePending).toBeUndefined();
});

test('年代优先指令完整传入Story；程序不二次判定自然语言年代', async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const server = await mock(page, '2008-08-10T10:00:00+08:00', '2008-08-10T10:01:00+08:00');
  await creation(page, '日期定为2015年。', '人物背景：2001年出生，2023年毕业。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
  expect(record(server.calls[0].context.OPENING_TIME)).toMatchObject({ playerPreference: '日期定为2015年。', playerBackground: '人物背景：2001年出生，2023年毕业。' });
  const saved = await stored(page); expect(saved.state.openingTimePending).toBeUndefined();
  await page.reload(); await ready(page); expect(server.calls).toHaveLength(3); expect(await stored(page)).toEqual(saved);
});

for (const kind of ['empty', 'npc', 'item']) test(`M8最小开局${kind}：正文无时间锚点，Variables 设置唯一时间窗，正式结算后继续下一回合`, async ({ page }) => {
  test.setTimeout(60000); await prepare(page);
  const startAt = '2015-07-08T14:00:00+08:00', endAt = '2015-07-08T14:02:00+08:00';
  const server = await mock(page, startAt, endAt); server.plan.minimal = true; server.plan.variableCase = kind;
  await creation(page, '故事发生在2015年夏天。');
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click(); await ready(page);
  const first = await stored(page);
  const committedClocks = (entries: typeof first.state.appliedCommands) => entries.map(c => JSON.parse(c.fingerprint))
    .filter(c => c.type === 'SetWorldClock').map(c => c.worldClock);
  expect(committedClocks(first.state.appliedCommands)).toEqual([startAt, endAt]);
  expect(first.state.openingTimePending).toBeUndefined(); expect(first.state.worldClock).toBe(endAt);
  expect(server.calls[1].context.SAVE_STATE).toHaveProperty('worldClock', null);
  expect(server.calls[1].context.OPENING_TIME).toEqual({ status: 'pending' });
  expect(server.calls[2].context.TIME_WINDOW).toEqual({ from: startAt, to: endAt });
  const rounds = kind === 'empty' ? 9 : 1;
  for (let index = 1; index <= rounds; index++) {
    await page.getByLabel('你的行动', { exact: true }).fill(`观察周围${index}`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(index + 1); await ready(page);
    expect((await stored(page)).state.worldClock).toBe(endAt); // 普通回合合法空变更不固定加时。
  }
  const saved = await stored(page);
  expect(committedClocks(saved.state.appliedCommands)).toEqual([startAt, endAt]);
  expect(saved.state.journal).toHaveLength(rounds + 1); expect(server.calls).toHaveLength((rounds + 1) * 3);
  if (kind === 'npc') expect(saved.state.npc['new-npc']).toHaveProperty('onScene', true);
  if (kind === 'item') expect(saved.state.items.gift.ownerRef).toEqual({ kind: 'protagonist', id: saved.state.protagonist.id });
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(saved); expect(server.calls).toHaveLength((rounds + 1) * 3);
});
