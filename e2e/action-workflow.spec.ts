import { variableReply } from '../src/tests/fixtures/variableReply';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameStateSchema } from '../src/domain/state';
import { TurnDraftSchema } from '../src/domain/drafts';
import { record, array, string } from '../src/services/ai/protocols';

type Stage = 'story' | 'variables' | 'world';
async function prepare(page: Page, configured = true, stages = { variables: true, world: true }) {
  await page.goto('/');
  await page.evaluate(async ({ configured, stages }) => {
    const cp = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts', sp = '/src/ui/settings/model.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(cp), { CredentialVault } = await import(vp),
      { defaultSettings, settingsKey } = await import(sp);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    settings.runtime.useVariableStage = stages.variables; settings.runtime.useWorldStage = stages.world;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    if (configured) {
      const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://action.mock.invalid/v1';
      config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
      config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
      config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
      saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-action-key');
    }
  }, { configured, stages });
  await page.reload();
}
async function creation(page: Page) {
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  for (const [label, value] of Object.entries({ 姓名: '林舟', 年龄: '30', 性别: '女', 外貌: '短发', 性格: '沉稳' }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
}
async function confirm(page: Page) {
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('.game-layout')).toBeVisible();
}
async function stored(page: Page) {
  const data = await page.evaluate(async () => {
    const rp = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(rp), repo = await SaveRepository.open();
    try { const id = location.hash.slice(6); return await repo.loadGame(id); } finally { repo.close(); }
  });
  return { state: GameStateSchema.parse(data.state), draft: TurnDraftSchema.parse(data.draft) };
}
function gate() {
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; }); return { pending, release };
}
async function mock(page: Page) {
  const calls: { stage: Stage; context: Record<string, unknown>; messages: string }[] = [];
  const plan: { failure?: Stage; status?: number; hold?: Stage; gate?: Promise<void>; network?: boolean; badSummary?: boolean } = {};
  await page.route('https://action.mock.invalid/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { data: [{ id: 'story' }, { id: 'variables' }, { id: 'world' }] } }); return; }
    const body = record(route.request().postDataJSON()), stage = string(body.model);
    if (stage !== 'story' && stage !== 'variables' && stage !== 'world') throw new Error('unexpected model route');
    const messages = array(body.messages).map((item) => string(record(item).content)).join('\n');
    const match = messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/); if (!match) throw new Error('missing actual context');
    const ctx = record(JSON.parse(match[1])); calls.push({ stage, context: ctx, messages });
    if (plan.hold === stage) await plan.gate;
    if (plan.failure === stage && plan.network) { await route.abort('failed'); return; }
    const state = record(ctx.SAVE_STATE), number = Number(state.turnNumber) + 1;
    const pending = Boolean(ctx.OPENING_TIME && record(ctx.OPENING_TIME).status === 'pending');
    const anchor = pending ? '2015年7月8日14:00，重庆街头。' : '';
    const openingGuide = pending ? [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-07-08T14:00:00+08:00', endAt: '2015-07-08T14:01:00+08:00' }), textEvidence: anchor }] : [];
    const text = plan.failure === stage && !plan.status ? '{invalid-json' : stage === 'story'
      ? `<thinking>本轮创作提纲：保持连续，按当前行动呈现事实。</thinking><正文>${anchor}第${number}幕。主角在街边观察周围，街道上人来人往。</正文><短期记忆>${plan.badSummary ? '' : `主角第${number}次在街边观察环境。`}</短期记忆><变量规划>${JSON.stringify(openingGuide)}</变量规划>`
      : (stage === 'variables' ? variableReply : JSON.stringify)(stage === 'variables' ? { commands: [{ type: 'SetWorldClock', commandId: 'clock', worldClock: ctx.OPENING_TIME ? string(record(ctx.OPENING_TIME).endAt) : new Date(Date.parse(string(state.worldClock)) + 60000).toISOString(), evidence: '主角在街边观察周围，街道上人来人往。' }], rejectedSuggestions: [], unresolved: [] }
        : { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [{ text: '尚未公开的内部线索' }], timelineCandidates: [], unresolved: [] });
    await route.fulfill({ status: plan.failure === stage ? plan.status ?? 200 : 200,
      contentType: stage === 'story' ? 'text/event-stream' : 'application/json',
      body: stage === 'story' ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
    }).catch(() => undefined);
  });
  return { calls, plan };
}
const workflow = (page: Page) => page.getByRole('region', { name: '三阶段工作流', exact: true });
async function ready(page: Page) {
  await expect(workflow(page).getByRole('status')).toContainText('三阶段候选已完成');
}

test('一次创角确认自动执行开局三阶段，StrictMode和重复点击不重复请求', async ({ page }) => {
  await prepare(page); const server = await mock(page); await creation(page);
  await confirm(page); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
  const result = await stored(page); expect(result.state.turnNumber).toBe(0); expect(result.state.revision).toBe(0);
  expect(result.state.journal).toEqual([]); expect(result.draft.stageStatus).toEqual({ story: 'ready', variables: 'ready', world: 'ready' });
  expect(server.calls[0].context.CREATION_PROFILE).toBeTruthy();
  await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: '生成变量候选', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '继续推演', exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('尚未公开的内部线索');
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(result); expect(server.calls).toHaveLength(3);
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await page.getByRole('button', { name: /读取存档/ }).click(); await ready(page); expect(server.calls).toHaveLength(3);
});

test('缺少AI配置零请求，设置后不自动补发，只在明确开始时运行', async ({ page }) => {
  await prepare(page, false); const server = await mock(page); await creation(page);
  await expect(page.locator('.notice')).toContainText('API 费用'); await confirm(page);
  await expect(workflow(page).getByRole('alert')).toContainText('配置'); expect(server.calls).toHaveLength(0);
  const before = await stored(page); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '打开 AI 设置', exact: true }).click();
  await page.getByRole('button', { name: '新增渠道', exact: true }).click();
  await page.getByLabel('API Base URL', { exact: true }).fill('https://action.mock.invalid/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill('mock-action-key');
  await page.getByRole('button', { name: '手动填写默认模型 ID', exact: true }).click();
  await page.getByLabel('默认模型 ID', { exact: true }).fill('story');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  // 从真实设置选择同一渠道的两个独立路由；不通过生成请求探测模型。
  const channel = await page.getByRole('combobox', { name: '当前渠道', exact: true }).getAttribute('value'); expect(channel).toBeTruthy();
  for (const [label, model] of [['正文生成', 'story'], ['变量管理', 'variables'], ['动态世界', 'world']]) {
    if (label !== '正文生成') await page.getByLabel(`${label}跟随正文模型`, { exact: true }).uncheck();
    await page.getByRole('combobox', { name: `${label}渠道`, exact: true }).click();
    await page.getByRole('listbox', { name: `${label}渠道`, exact: true }).getByRole('option').last().click();
    await page.getByRole('combobox', { name: `${label}模型`, exact: true }).click();
    await page.getByRole('listbox', { name: `${label}模型`, exact: true }).getByRole('option', { name: model, exact: true }).click();
  }
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await page.getByRole('button', { name: '关闭资料界面', exact: true }).click(); expect(server.calls).toHaveLength(0);
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await ready(page);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world']);
});

test('发送行动只结算一次并自动串联下一轮，刷新及再次读档不补发', async ({ page }) => {
  await prepare(page); const server = await mock(page); await creation(page); await confirm(page); await ready(page);
  const before = await stored(page); await page.getByLabel('你的行动', { exact: true }).fill('在街边继续观察');
  await page.getByRole('button', { name: '发送', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByTestId('story-reader')).toContainText('第2幕'); await ready(page);
  const after = await stored(page); expect(after.state.revision).toBe(1); expect(after.state.journal).toHaveLength(1);
  expect(after.state.memories.short).toHaveLength(1); expect(after.draft.userInput).toBe('在街边继续观察');
  expect(after.state.economy).toEqual(before.state.economy); expect(after.state.npc).toEqual(before.state.npc);
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'variables', 'world', 'story', 'variables', 'world']);
  expect(server.calls[0].context.CREATION_PROFILE).toBeTruthy(); expect(server.calls[3].context.CREATION_PROFILE).toBeUndefined();
  expect(server.calls[3].context.PLAYER_ACTION).toBe('在街边继续观察');
  await page.reload(); await ready(page); expect(await stored(page)).toEqual(after); expect(server.calls).toHaveLength(6);
});

for (const stage of ['variables', 'world'] as const) {
  test(`${stage}失败保留上游，仅明确恢复缺少阶段，折叠无额外请求`, async ({ page }) => {
    await prepare(page); const server = await mock(page); server.plan.failure = stage;
    await creation(page); await confirm(page); await expect(workflow(page).getByRole('alert')).toBeVisible();
    const failed = await stored(page); expect(failed.state.revision).toBe(0); expect(failed.draft.story).toBeTruthy();
    expect(server.calls.map((call) => call.stage)).toEqual(stage === 'variables' ? ['story', 'variables'] : ['story', 'variables', 'world']);
    await page.getByLabel('你的行动', { exact: true }).fill('下一步行动'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    const summary = page.locator('.workflow-disclosure > summary'); await summary.click(); await summary.click();
    expect(server.calls).toHaveLength(stage === 'variables' ? 2 : 3);
    await page.reload(); await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeEnabled();
    expect(await stored(page)).toEqual(failed); server.plan.failure = undefined;
    await page.getByRole('button', { name: '继续未完成阶段', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await ready(page); const after = await stored(page); expect(after.state).toEqual(failed.state); expect(after.draft.story).toEqual(failed.draft.story);
    expect(server.calls.map((call) => call.stage)).toEqual(stage === 'variables' ? ['story', 'variables', 'variables', 'world'] : ['story', 'variables', 'world', 'world']);
  });
}

for (const status of [401, 403, 429]) {
  test(`自动开局HTTP ${status}停止、不无限重试，刷新不重新授权`, async ({ page }) => {
    await prepare(page); const server = await mock(page); server.plan.failure = 'story'; server.plan.status = status;
    await creation(page); await confirm(page); await expect(workflow(page).getByRole('alert')).toBeVisible();
    expect(server.calls.map((call) => call.stage)).toEqual(['story']); const failed = await stored(page);
    expect(failed.draft.story).toBeUndefined(); expect(failed.state.revision).toBe(0);
    await page.reload(); await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeEnabled();
    expect(server.calls).toHaveLength(1); expect(await stored(page)).toEqual(failed);
  });
}

test('取消中的迟到响应不启动下游，刷新保留待生成草稿且明确恢复', async ({ page }) => {
  await prepare(page); const server = await mock(page), held = gate(); server.plan.hold = 'story'; server.plan.gate = held.pending;
  await creation(page); await confirm(page); await expect.poll(() => server.calls.length).toBe(1);
  const summary = page.locator('.workflow-disclosure > summary'); await summary.click(); await summary.click();
  expect(server.calls).toHaveLength(1); await page.getByRole('button', { name: '取消自动执行', exact: true }).click();
  await expect(workflow(page).getByRole('status')).toContainText('取消'); held.release();
  const cancelled = await stored(page); expect(cancelled.draft.story).toBeUndefined(); expect(cancelled.state.revision).toBe(0);
  await page.reload(); await expect(page.getByRole('button', { name: '自动生成开局', exact: true })).toBeEnabled();
  expect(server.calls).toHaveLength(1); server.plan.hold = undefined;
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await ready(page); expect(server.calls).toHaveLength(4);
});

test('快速离开并重读同一存档或新标签不能延续开局收费授权', async ({ page, context }) => {
  await prepare(page); const server = await mock(page), held = gate(); server.plan.hold = 'variables'; server.plan.gate = held.pending;
  await creation(page); await confirm(page); await expect.poll(() => server.calls.length).toBe(2);
  const url = page.url(); await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await page.getByRole('button', { name: /读取存档/ }).click();
  await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeVisible();
  const other = await context.newPage(); let otherRequests = 0;
  await other.route('https://action.mock.invalid/**', async (route) => { otherRequests++; await route.abort(); });
  await other.goto(url); await expect(other.locator('.game-layout')).toBeVisible();
  held.release(); await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeEnabled();
  expect(server.calls).toHaveLength(2); expect(otherRequests).toBe(0); const after = await stored(page); expect(after.draft.world).toBeUndefined(); expect(after.state.revision).toBe(0);
  await other.close();
});

test('关闭变量时世界只能预览，不因自动开局而强行启用或允许发送', async ({ page }) => {
  await prepare(page, true, { variables: false, world: true }); const server = await mock(page); await creation(page); await confirm(page);
  await expect(workflow(page).getByRole('status')).toContainText('预览');
  expect(server.calls.map((call) => call.stage)).toEqual(['story', 'world']); const result = await stored(page);
  expect(result.draft.world?.validation).toBe('preview'); expect(result.draft.variables).toBeUndefined(); expect(result.state.revision).toBe(0);
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
});

test('正文摘要不合法时不保存、不运行下游、不结算', async ({ page }) => {
  await prepare(page); const server = await mock(page); server.plan.badSummary = true; await creation(page); await confirm(page);
  await expect(workflow(page).getByRole('alert')).toBeVisible(); expect(server.calls.map((call) => call.stage)).toEqual(['story']);
  const result = await stored(page); expect(result.draft.story).toBeUndefined(); expect(result.state.journal).toEqual([]);
  await page.getByLabel('你的行动', { exact: true }).fill('继续'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
});

test('开局组件加载前刷新销毁授权，未生成草稿保留且仅主动开始才请求', async ({ page }) => {
  await prepare(page); const server = await mock(page), held = gate(); let loading = false;
  const modulePath = '**/src/ui/game/GameScreen.tsx*';
  await page.route(modulePath, async (route) => { loading = true; await held.pending; await route.continue().catch(() => undefined); });
  await creation(page); await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect.poll(() => loading).toBe(true); expect(server.calls).toHaveLength(0);
  await page.unroute(modulePath); await page.reload(); held.release();
  await expect(page.getByRole('button', { name: '自动生成开局', exact: true })).toBeEnabled();
  const before = await stored(page); expect(before.draft.draftRevision).toBe(0); expect(before.draft.story).toBeUndefined(); expect(server.calls).toHaveLength(0);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await ready(page); expect(server.calls).toHaveLength(3);
});

for (const failure of ['network', 'timeout'] as const) {
  test(`开局${failure}不隐式重试，刷新不重发，草稿和正式状态安全`, async ({ page }) => {
    await prepare(page);
    if (failure === 'timeout') {
      await page.evaluate(() => {
        const key = 'heijin.settings.v1', settings = JSON.parse(localStorage.getItem(key)!);
        settings.runtime.timeoutSeconds = 1; localStorage.setItem(key, JSON.stringify(settings));
      });
      await page.reload();
    }
    const server = await mock(page), held = gate();
    if (failure === 'network') { server.plan.failure = 'story'; server.plan.network = true; }
    else { server.plan.hold = 'story'; server.plan.gate = held.pending; }
    await creation(page); await confirm(page);
    await expect(workflow(page).getByRole('alert')).toContainText(failure === 'network' ? '网络请求失败' : '超时');
    held.release(); expect(server.calls.map((call) => call.stage)).toEqual(['story']);
    const failed = await stored(page); expect(failed.state.revision).toBe(0); expect(failed.draft.story).toBeUndefined();
    await page.reload(); await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeEnabled();
    expect(server.calls).toHaveLength(1); expect(await stored(page)).toEqual(failed);
  });
}

for (const disabled of ['world', 'variables'] as const) {
  test(`关闭阶段时${disabled}：不显示无效继续，引导启用后只补必要候选并正常发送`, async ({ page }) => {
    test.setTimeout(60000);
    await prepare(page, true, { variables: disabled !== 'variables', world: disabled !== 'world' });
    const server = await mock(page); await creation(page); await confirm(page);
    await expect(workflow(page).getByRole('status')).toContainText(disabled === 'world' ? '跳过' : '预览');
    const before = await stored(page), initial = disabled === 'world' ? ['story', 'variables'] : ['story', 'world'];
    expect(server.calls.map((call) => call.stage)).toEqual(initial);
    await expect(workflow(page).getByRole('button', { name: '继续未完成阶段', exact: true })).toHaveCount(0);
    const guidance = workflow(page).getByRole('note', { name: '阶段设置提示', exact: true });
    await expect(guidance).toContainText(disabled === 'world' ? '动态世界阶段已关闭' : '变量阶段未启用，当前世界结果仅为预览');
    await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open');
    await page.getByLabel('你的行动', { exact: true }).fill('继续观察街道');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await page.reload();
    await expect(guidance).toBeVisible();
    await page.getByLabel('你的行动', { exact: true }).fill('继续观察街道');
    await expect(workflow(page).getByRole('button', { name: '继续未完成阶段', exact: true })).toHaveCount(0);
    expect(await stored(page)).toEqual(before); expect(server.calls.map((call) => call.stage)).toEqual(initial);
    await guidance.getByRole('button', { name: '展开高级设置', exact: true }).click();
    await expect(page.locator('.workflow-disclosure')).toHaveAttribute('open');
    const toggle = page.getByLabel(disabled === 'world' ? '动态世界' : '变量管理', { exact: true });
    await expect(toggle).toBeFocused(); await expect(toggle).not.toBeChecked();
    expect(await stored(page)).toEqual(before); expect(server.calls.map((call) => call.stage)).toEqual(initial);
    await toggle.check();
    const resume = workflow(page).getByRole('button', { name: '继续未完成阶段', exact: true });
    await expect(resume).toBeEnabled(); expect(server.calls.map((call) => call.stage)).toEqual(initial);
    expect(await stored(page)).toEqual(before);
    await page.locator('.workflow-disclosure > summary').click();
    await resume.click(); await ready(page);
    const complete = await stored(page);
    expect(complete.state).toEqual(before.state); expect(complete.draft.story).toEqual(before.draft.story);
    if (disabled === 'world') expect(complete.draft.variables).toEqual(before.draft.variables);
    const completedCalls = disabled === 'world' ? ['story', 'variables', 'world'] : ['story', 'world', 'variables', 'world'];
    expect(server.calls.map((call) => call.stage)).toEqual(completedCalls);
    await expect(resume).toHaveCount(0); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByTestId('story-reader')).toContainText('第2幕'); await ready(page);
    const committed = await stored(page); expect(committed.state.revision).toBe(1); expect(committed.state.journal).toHaveLength(1);
    expect(committed.draft.userInput).toBe('继续观察街道');
    expect(server.calls.map((call) => call.stage)).toEqual([...completedCalls, 'story', 'variables', 'world']);
  });
}
