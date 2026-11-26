import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openSettings, openStageSwitches, openWorkflowStage } from './helpers/gameLayout';

// 以下 seed/mock 与 automatic-settlement 相同：预置存档与三阶段模型替身。
async function seed(page: Page, remoteLocation = false, organization = false) {
  await page.goto('/');
  await page.evaluate(async ([remoteLocation, organization]) => {
    const storage = '/src/services/storage/saveRepository.ts', fixtures = '/src/tests/fixtures/world.ts', drafts = '/src/domain/drafts.ts',
      configuration = '/src/services/ai/configuration.ts', gameFixtures = '/src/tests/fixtures/game.ts', credentials = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storage), { worldState } = await import(fixtures), { createTurnDraft } = await import(drafts),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configuration), { CredentialVault } = await import(credentials), { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://auto-settlement.mock.invalid/v1'; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-auto-settlement-key');
    const state = worldState();
    if (remoteLocation) state.locations.remote = { id: 'remote', name: '诊所' };
    if (organization) { const { organizations } = await import(gameFixtures); state.organizations['org-shop'] = { ...organizations[3], id: 'org-shop', name: '街口商行' }; }
    const repo = await SaveRepository.open(); try { await repo.create(state); await repo.saveDraft(createTurnDraft('save-a', 0, 'auto-opening', 'opening', ''), null); } finally { repo.close(); }
  }, [remoteLocation, organization] as const);
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
}
async function stored(page: Page) { return page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }
async function mock(page: Page) {
  const calls: string[] = [], responses: { variables: string; world: string } = { variables: '', world: '' };
  const control: { bad?: boolean; hold?: Promise<void>; variables?: string; world?: string } = {};
  await page.route('https://auto-settlement.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    const turn = calls.filter(stage => stage === 'story').length;
    const variables = variableTextEnvelope(control.variables ?? `<说明>原始说明：第${turn}轮消费，保留换行。🟡</说明>\n<命令>\nset worldClock = "2026-10-18T08:${turn === 1 ? '10' : '20'}:00+08:00"\nadd economy.cash = -3000\n</命令>`);
    const world = control.world ?? (control.bad ? '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [ {"type":"SaveEvent","commandId":"missing-end","evidence":"{}","event":{"id":"review","title":"清点","status":"scheduled","startAt":"2026-10-19T08:00:00+08:00","actorRefs":[{"kind":"npc","id":"npc-a"}],"linkedTaskIds":[],"prerequisites":[],"blockers":[],"visibility":"hidden","impact":"minor","sourceTurnIds":["auto-opening"],"backgroundText":"值班清点","goalText":"完成清点"}} ], "visibleHooks": [], "unresolved": []\n}'
      : '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [], "visibleHooks": [], "unresolved": []\n}');
    const worldText = world.replace('"evidence":"{}"', `"evidence":${JSON.stringify(JSON.stringify({ version: 1, kind: 'planned', at: '2026-10-18T08:05:00+08:00', sources: ['npc:npc-a'], fact: '计划进行内部清点。', rationale: '根据日常工作安排准备清点。' }))}`);
    const text = stage === 'story' ? `<thinking>保持当前行动连续。</thinking>\n<正文>第${turn}幕：主角在街边用餐，观察来往行人。</正文>\n<短期记忆>在街边用餐。</短期记忆>\n<变量规划>[]</变量规划>` : stage === 'variables' ? variables : worldText;
    if (stage === 'variables') responses.variables = text;
    if (stage === 'world') { responses.world = text; if (control.hold) await control.hold; }
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) }).catch(() => undefined);
  });
  return { calls, control, responses };
}

/** 用替身 AudioContext 记录每个振荡器的起始频率；页面里不真正出声。 */
async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __chimes: number[]; AudioContext: unknown };
    w.__chimes = [];
    class Node { connect<T>(t: T) { return t; } disconnect() {} }
    class Param { value = 0; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } }
    class Osc extends Node { type = ''; frequency = new Param(); onended: null | (() => void) = null; start() { w.__chimes.push(this.frequency.value); } stop() { setTimeout(() => this.onended?.(), 0); } }
    class Ctx { state = 'suspended'; currentTime = 0; destination = new Node(); addEventListener() {}
      resume() { this.state = 'running'; return Promise.resolve(); }
      createGain() { return Object.assign(new Node(), { gain: new Param() }); }
      createBiquadFilter() { return Object.assign(new Node(), { type: '', frequency: new Param() }); }
      createOscillator() { return new Osc(); } }
    w.AudioContext = Ctx;
  });
}
const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __chimes: number[] }).__chimes);
async function useChime(page: Page, mode: 'always' | 'off') {
  await page.evaluate(async (mode) => {
    const path = '/src/ui/settings/model.ts', { settingsKey } = await import(path);
    const s = JSON.parse(localStorage.getItem(settingsKey)!); s.notifications = { completionChime: mode };
    const value = JSON.stringify(s); localStorage.setItem(settingsKey, value);
    // 模拟另一个标签页修改设置后的同步事件。
    window.dispatchEvent(new StorageEvent('storage', { key: settingsKey, newValue: value, storageArea: localStorage }));
  }, mode);
}
const startOpening = (page: Page) => page.getByRole('button', { name: '自动生成开局', exact: true }).click();
const DONE = [523.25, 1046.5, 783.99, 1567.98], ATTENTION = [392, 784, 329.63, 659.26];

test('正式结算成功只响一次完成提示（开始生成的点击解锁音频）', async ({ page }) => {
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); await mock(page);
  await startOpening(page);
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  await expect.poll(() => chimes(page)).toEqual(DONE);
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual(DONE);
});

test('生成失败响失败提示，不响完成提示', async ({ page }) => {
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); await mock(page);
  await page.route('https://auto-settlement.mock.invalid/**', route => route.fulfill({ status: 401, body: 'mock-only' }));
  await startOpening(page);
  await expect.poll(() => chimes(page)).toEqual(ATTENTION);
  expect((await stored(page)).state.turnNumber).toBe(0);
});

test('手动取消不响', async ({ page }) => {
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); const server = await mock(page);
  let release!: () => void; server.control.hold = new Promise<void>(r => { release = r; });
  await startOpening(page);
  await expect.poll(() => server.calls).toContain('world');
  await page.getByRole('button', { name: '取消自动执行', exact: true }).click();
  server.control.hold = undefined; release();
  await expect(page.locator('.workflow')).not.toHaveAttribute('data-state', 'busy');
  expect((await stored(page)).state.turnNumber).toBe(0);
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual([]);
});

test('生成中经跨标签同步关闭提示音，结算后不响', async ({ page }) => {
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); const server = await mock(page);
  let release!: () => void; server.control.hold = new Promise<void>(r => { release = r; });
  await startOpening(page);
  await expect.poll(() => server.calls).toContain('world');
  await useChime(page, 'off');
  server.control.hold = undefined; release();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual([]);
});

test('设置页可切换提示音并试听', async ({ page }) => {
  await fakeAudio(page); await seed(page);
  await openSettings(page);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: '生成完成提示音' });
  await expect(group).toBeVisible();
  await group.getByRole('radio', { name: /^总是/ }).check();
  await expect.poll(() => chimes(page)).toEqual(DONE);
  await page.getByRole('button', { name: '试听失败提示', exact: true }).click();
  await expect.poll(() => chimes(page)).toEqual([...DONE, ...ATTENTION]);
});

// —— 与实际回合流程的联动 ——
const workflowRegion = (page: Page) => page.getByRole('region', { name: '四阶段工作流' });
/** 关闭 CORS 中转，只走直连，便于按阶段替换回包（与 turn-coordinator 的瞬时失败用例相同）。 */
const directOnly = (page: Page) => page.evaluate(async () => { const path = '/src/services/ai/corsRelay.ts'; (await import(path)).setRelayMode('off'); });
/** 在原替身之前拦截指定阶段：返回 fail 给出的状态码，否则交还原替身。 */
async function failStage(page: Page, stage: string, fail: () => number | undefined) {
  await page.route('https://auto-settlement.mock.invalid/**', async route => {
    const status = String(route.request().postDataJSON().model) === stage ? fail() : undefined;
    if (status) await route.fulfill({ status, body: 'mock-only' }); else await route.fallback();
  });
}

test('正常回合：开局与下一条行动各结算一次，各响一次完成提示', async ({ page }) => {
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); await mock(page);
  await startOpening(page);
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  await expect.poll(() => chimes(page)).toEqual(DONE);
  await page.getByLabel('你的行动', { exact: true }).fill('继续在街边用餐');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  await expect.poll(() => chimes(page)).toEqual([...DONE, ...DONE]);
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual([...DONE, ...DONE]);
});

test('自动重试：中间的服务失败不提醒，最终成功只响一次完成提示', async ({ page }) => {
  await fakeAudio(page); await seed(page); await directOnly(page); await useChime(page, 'always'); const server = await mock(page);
  let failed = 0; await failStage(page, 'variables', () => failed++ === 0 ? 503 : undefined);
  await startOpening(page);
  await expect.poll(async () => (await stored(page)).state.turnNumber, { timeout: 20_000 }).toBe(1);
  expect(failed).toBe(2);
  expect(server.calls).toEqual(['story', 'variables', 'world']);
  await expect.poll(() => chimes(page)).toEqual(DONE);
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual(DONE);
});

test('世界预览只响需要处理的提示；补开变量后继续，结算成功再响完成提示', async ({ page, isMobile }) => {
  test.skip(isMobile, '阶段开关在电脑端工作台；手机端由前面的通用场景覆盖');
  await fakeAudio(page); await seed(page); await useChime(page, 'always'); const server = await mock(page);
  await openStageSwitches(page);
  await page.getByLabel('变量管理', { exact: true }).uncheck();
  await startOpening(page);
  await expect(workflowRegion(page).getByRole('status')).toContainText('世界仅为预览');
  expect((await stored(page)).draft.world.validation).toBe('preview');
  expect(server.calls).toEqual(['story', 'world']);
  await expect.poll(() => chimes(page)).toEqual(ATTENTION);
  expect((await stored(page)).state.turnNumber).toBe(0);
  await page.getByLabel('变量管理', { exact: true }).check();
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  await expect.poll(() => chimes(page)).toEqual([...ATTENTION, ...DONE]);
});

test('手动阶段与自动结算衔接：失败提醒一次，手动补变量不响，继续后结算成功响完成提示', async ({ page, isMobile }) => {
  test.skip(isMobile, '单阶段手动生成在电脑端工作台；手机端由前面的通用场景覆盖');
  await fakeAudio(page); await seed(page); await directOnly(page); await useChime(page, 'always'); const server = await mock(page);
  let broken = true; await failStage(page, 'variables', () => broken ? 401 : undefined);
  await startOpening(page);
  await expect.poll(() => chimes(page)).toEqual(ATTENTION);
  expect((await stored(page)).state.turnNumber).toBe(0);
  broken = false;
  await openWorkflowStage(page, 'variables');
  await page.getByRole('button', { name: /^(?:重新)?生成变量候选$/ }).click();
  await expect.poll(async () => (await stored(page)).draft.stageStatus.variables).toBe('ready');
  await page.waitForTimeout(300); expect(await chimes(page)).toEqual(ATTENTION);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  expect(server.calls.filter(stage => stage === 'world')).toHaveLength(1);
  await expect.poll(() => chimes(page)).toEqual([...ATTENTION, ...DONE]);
});
