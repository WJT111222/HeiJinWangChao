import { openGameTools } from './helpers/gameLayout';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { array, record, string } from '../src/services/ai/protocols';
import { GameStateSchema, StorySchema } from '../src/domain/state';
import type { DomainCommand } from '../src/domain/commands';
import { TurnDraftSchema } from '../src/domain/drafts';
import { timeStory } from '../src/tests/fixtures/time';

async function seed(page: Page, visitor = false, disabled = false, action = '睡到明天早上8点') {
  await page.goto('/');
  await page.evaluate(async ({ visitor, disabled, action }) => {
    const fixturePath = '/src/tests/fixtures/time.ts', repoPath = '/src/services/storage/saveRepository.ts',
      draftPath = '/src/domain/drafts.ts', configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { timeState } = await import(fixturePath), { SaveRepository } = await import(repoPath), { createTurnDraft } = await import(draftPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath), { defaultSettings, settingsKey } = await import(settingsPath);
    const state = timeState(visitor), repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('heijinwangchao'); req.onsuccess = () => { const db = req.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; req.onerror = () => reject(req.error);
    });
    const storage = await SaveRepository.open(); await storage.saveDraft(createTurnDraft(state.saveId, state.revision, 'sleep-turn', 'regular', action, !disabled, !disabled), null); storage.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    settings.runtime.useVariableStage = !disabled; settings.runtime.useWorldStage = !disabled; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://time.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'time-e2e-mock-secret');
  }, { visitor, disabled, action });
  await page.reload(); await openGameTools(page); await page.getByRole('button', { name: /读取存档/ }).click(); await openGameTools(page);
}
async function load(page: Page) {
  const value: unknown = await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
  const loaded = record(value); return { state: GameStateSchema.parse(loaded.state), draft: TurnDraftSchema.parse(loaded.draft) };
}
function context(body: unknown) {
  const text = array(record(body).messages).map((message) => string(record(message).content)).join('\n'), match = text.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  if (!match) throw new Error('missing context'); return record(JSON.parse(match[1]));
}
const pastRequest = '切换到陈宁的视角，描写他昨天晚上独自经历的事情。';
async function mock(page: Page, interrupt = false, kind: 'default' | 'drink' | 'chat' | 'past' | 'zero' = 'default') {
  const calls: string[] = [], preflights: unknown[] = [];
  const control = { failVariables: false, hold: undefined as Promise<void> | undefined };
  await page.route('https://time.mock.invalid/**', async (route) => {
    const body: unknown = route.request().postDataJSON(), model = string(record(body).model), ctx = context(body); calls.push(model);
    let text: string;
    if (model === 'story') {
      preflights.push(ctx.TIME_PREFLIGHT);
      const bounded = Boolean(record(ctx.TIME_PREFLIGHT).targetAt);
      const past = kind === 'past' && ctx.PLAYER_ACTION === pastRequest;
      const narrative = past ? '昨天晚上，陈宁独自回顾了此前已知的约定。' : kind === 'chat' ? '陈宁笑着说：“你好。”你也问候了他。' : '你喝了一口可乐。';
      const story = bounded ? timeStory(interrupt) : { turnKind: 'regular', narrative, summary: past ? '回顾已知往事' : '短暂的当前行动',
        variableGuide: past ? [{ group: 'time', subjectHint: 'time:retrospective', observedFact: JSON.stringify({ npcId: 'npc-a', perspectiveRequest: '切换到陈宁的视角', pastRequest: '描写他昨天晚上独自经历的事情', temporalScope: 'past_only', currentPlotAdvances: false }), textEvidence: narrative }] : [] };
      text = `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
      if (control.hold) await control.hold;
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }).catch(() => undefined); return;
    }
    if (model === 'variables') {
      if (control.failVariables) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{bad' } }] }) }); return; }
      const story = StorySchema.parse(ctx.STORY_RESULT), guide = story.variableGuide.find((entry) => entry.subjectHint?.startsWith('time:') && entry.subjectHint !== 'time:retrospective'), commands: DomainCommand[] = [];
      if (guide) {
        commands.push({ type: 'SetWorldClock', commandId: 'sleep-clock', worldClock: guide.observedFact, evidence: guide.textEvidence! });
        if (guide.subjectHint === 'time:interrupt:visitor') { const state = GameStateSchema.parse(ctx.SAVE_STATE); commands.push({ type: 'SaveEvent', commandId: 'visitor-contact', evidence: guide.textEvidence!, event: { ...state.events.visitor, status: 'active', sourceTurnIds: [...state.events.visitor.sourceTurnIds, string(record(ctx.TURN_CONTEXT).turnId)] } }); }
      }
      if (!guide && !story.variableGuide.some((entry) => entry.subjectHint === 'time:retrospective') && kind !== 'zero') {
        const state = GameStateSchema.parse(ctx.SAVE_STATE);
        // Mock的实际估时输出；产品代码不会自行补这个数值。
        commands.push({ type: 'SetWorldClock', commandId: 'estimated-elapsed', evidence: story.narrative,
          worldClock: new Date(Date.parse(state.worldClock) + (kind === 'chat' ? 15 : 120) * 1000).toISOString() });
      }
      text = JSON.stringify({ commands, rejectedSuggestions: [], unresolved: [] });
    } else text = JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }) });
  }); return { calls, preflights, control };
}
for (const interrupt of [false, true]) test(`长睡眠interrupt=${interrupt}：真实三阶段、候选时间、正式结算及刷新`, async ({ page }) => {
  const api = await mock(page, interrupt); await seed(page, interrupt); const before = (await load(page)).state;
  await page.getByRole('button', { name: '自动生成本回合', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '三阶段候选已完成' }).first()).toBeVisible();
  const ready = await load(page); expect(ready.state).toEqual(before);
  expect(ready.draft.story!.variableGuide[0].observedFact).toBe(interrupt ? '2027-01-01T03:00:00+08:00' : '2027-01-01T08:00:00+08:00');
  expect(api.calls).toEqual(['story', 'variables', 'world']); expect(record(api.preflights[0]).calendar).toMatchObject({ targetWeekday: '星期五' });
  await page.getByLabel('你的行动', { exact: true }).fill('看看周围'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await load(page)).state.worldClock).toBe(ready.draft.story!.variableGuide[0].observedFact);
  const committed = (await load(page)).state; expect(committed.journal).toHaveLength(2);
  if (interrupt) expect(committed.events.visitor.status).toBe('active');
  await page.reload(); await openGameTools(page); expect((await load(page)).state).toEqual(committed);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('变量失败与刷新恢复保留正文，Roll清除旧候选但不推进正式时间', async ({ page }) => {
  const api = await mock(page, true); api.control.failVariables = true; await seed(page, true); const before = (await load(page)).state;
  await page.getByRole('button', { name: '自动生成本回合', exact: true }).click();
  await expect(page.getByText(/已保存的合法上游候选仍保留/)).toBeVisible();
  expect((await load(page)).state).toEqual(before); await page.reload(); await openGameTools(page); api.control.failVariables = false;
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '三阶段候选已完成' }).first()).toBeVisible(); expect(api.calls.filter((call) => call === 'story')).toHaveLength(1);
  const ready = (await load(page)).draft; await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect.poll(async () => (await load(page)).draft.storyRevision).toBe(ready.storyRevision + 1);
  const rolled = await load(page); expect(rolled.draft.variables).toBeUndefined(); expect(rolled.draft.world).toBeUndefined(); expect(rolled.state).toEqual(before);
});
test('取消和迟到不推进时间；关闭阶段只保留正文草稿', async ({ page }) => {
  const api = await mock(page); await seed(page, false, true); const before = (await load(page)).state;
  let release!: () => void; api.control.hold = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole('button', { name: '自动生成本回合', exact: true }).click(); await expect.poll(() => api.calls.length).toBe(1);
  await page.getByRole('button', { name: '取消自动执行', exact: true }).click(); release(); api.control.hold = undefined;
  await expect(page.getByRole('button', { name: /自动生成本回合|继续未完成阶段/, exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /自动生成本回合|继续未完成阶段/, exact: true }).click();
  await expect(page.getByText(/已按开关跳过关闭阶段/)).toBeVisible(); const saved = await load(page);
  expect(saved.state).toEqual(before); expect(saved.draft.variables).toBeUndefined(); expect(saved.draft.world).toBeUndefined();
  expect(api.calls).toEqual(['story', 'story']); await page.getByLabel('你的行动', { exact: true }).fill('继续观察'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
});

for (const kind of ['drink', 'chat', 'past'] as const) test(`最新时间规则${kind}：无时间词估时或玩家明确的只读过去视角，真实正式提交`, async ({ page }) => {
  const api = await mock(page, false, kind);
  await seed(page, false, false, kind === 'past' ? pastRequest : kind === 'chat' ? '和陈宁简单聊两句' : '喝一口可乐');
  const before = (await load(page)).state;
  await page.getByRole('button', { name: '自动生成本回合', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '三阶段候选已完成' }).first()).toBeVisible();
  expect(api.calls).toEqual(['story', 'variables', 'world']); expect((await load(page)).state).toEqual(before);
  const ready = (await load(page)).draft;
  expect(ready.story!.narrative).not.toMatch(/\d{1,2}:\d{2}|分钟|小时/);
  await page.getByLabel('你的行动', { exact: true }).fill('看看周围'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await load(page)).state.turnNumber).toBe(before.turnNumber + 1);
  const saved = (await load(page)).state;
  expect(Date.parse(saved.worldClock) - Date.parse(before.worldClock)).toBe(kind === 'past' ? 0 : kind === 'chat' ? 15000 : 120000);
  if (kind === 'past') { expect(saved.npc).toEqual(before.npc); expect(saved.events).toEqual(before.events); expect(saved.tasks).toEqual(before.tasks); }
  await page.reload(); await openGameTools(page); expect((await load(page)).state).toEqual(saved);
});
for (const action of ['喝一口可乐', '切换到陈宁的视角，描述他现在正在做的事情']) test(`漏掉耗时不能正式提交：${action}`, async ({ page }) => {
  await mock(page, false, 'zero'); await seed(page, false, false, action); const before = (await load(page)).state;
  await page.getByRole('button', { name: '自动生成本回合', exact: true }).click();
  // 等真实候选事务结束后再验证UI与零耗时拒绝；不把三阶段保存耗时限定为UI断言的5秒。
  await expect.poll(async () => (await load(page)).draft.stageStatus.world, { timeout: 15000 }).toBe('ready');
  await expect(page.getByRole('status').filter({ hasText: '三阶段候选已完成' }).first()).toBeVisible();
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('本回合尚未推进时间，未正式结算。请补算变量；正文无需写出时间。')).toBeVisible();
  expect((await load(page)).state).toEqual(before);
});
