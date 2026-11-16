import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { openSettings, openWorkflowDiagnostics } from './helpers/gameLayout';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';

const narrative = '主角沿江观察来往车辆，经过一分钟后留在路边等候。';
const prefix = '<thinking>保持现场与人物连续。</thinking><正文>主角沿江观察来往车辆，';
const output = `<thinking>保持现场与人物连续。</thinking><正文>${narrative}</正文><短期记忆>沿江观察一分钟。</短期记忆><变量规划>[]</变量规划>`;
const frame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const json = (content: string) => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
let server: Server, baseUrl: string, active: ServerResponse | undefined;
let calls: { model: string; stream: boolean }[];

test.beforeEach(async ({ page }) => {
  calls = []; active = undefined;
  await page.route('https://**/*', route => route.abort());
  server = createServer(async (req, res) => {
    res.on('error', () => undefined);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    let data = ''; for await (const chunk of req) data += String(chunk);
    const body = JSON.parse(data); calls.push({ model: body.model, stream: body.stream });
    res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' });
    if (body.model === 'story') { active = res; res.flushHeaders(); return; }
    const content = body.model === 'world' ? JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] })
      : variableTextEnvelope(`<命令>\nset worldClock = "${new Date(Date.parse(JSON.parse(body.messages.map((m: { content: string }) => m.content).join('\n').match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]).SAVE_STATE.worldClock) + 60000).toISOString()}"\n</命令>`);
    res.end(body.stream ? frame(content) + 'data: [DONE]\n\n' : json(content));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('mock server unavailable');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

async function seed(page: Page, stream: boolean, bound = false, legacy = false, timeout = 30) {
  await page.goto('/');
  await page.evaluate(async ({ baseUrl, stream, bound, legacy, timeout }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    settings.runtime.streamStory = stream; settings.runtime.streamVariables = !stream; settings.runtime.streamWorld = stream; settings.runtime.timeoutSeconds = timeout;
    if (legacy) delete settings.runtime.streamStory;
    for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[]) summary.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = baseUrl; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-story-toggle-key');
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      const done = await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
      if (bound) await repo.bindTurnAction(done.draft, '沿江观察', true, true);
    } finally { repo.close(); }
  }, { baseUrl, stream, bound, legacy, timeout });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  return stored(page);
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
const action = (page: Page) => page.locator('.composer-workflow-action');
async function begin(page: Page, stream: boolean, manual = false) {
  if (manual) await action(page).click();
  else { await page.locator('#player-input').fill('沿江观察'); await page.getByRole('button', { name: '发送', exact: true }).click(); }
  await expect.poll(() => Boolean(active)).toBe(true);
  expect(calls).toEqual([{ model: 'story', stream }]); await expect(action(page)).toHaveAttribute('data-kind', 'cancel');
}
async function closeError(page: Page) { if (await page.locator('dialog.mobile-diagnostics-sheet[open]').isVisible()) await page.keyboard.press('Escape'); }

for (const stream of [true, false]) {
  test(`${stream ? '流式' : '非流式'}成功：独立传输、真实分片、校验保存及单次三阶段结算`, async ({ page }, info) => {
    const before = await seed(page, stream); await begin(page, stream);
    const payload = json(output), cut = payload.indexOf('观察') + 2;
    active!.write(stream ? frame(prefix) : payload.slice(0, cut));
    if (stream) await expect(page.getByTestId('stream-narrative')).toContainText('主角沿江观察来往车辆，');
    else { await expect(page.getByText('正在等待完整正文', { exact: true })).toBeVisible(); await expect(page.getByTestId('stream-narrative')).toHaveCount(0); }
    const pending = await stored(page); expect(pending.state).toEqual(before.state); expect(pending.draft?.story).toBeUndefined(); expect(calls).toHaveLength(1);
    await page.screenshot({ path: info.outputPath(stream ? 'streaming.png' : 'waiting-full-story.png') });
    active!.end(stream ? frame(output.slice(prefix.length)) + 'data: [DONE]\n\n' : payload.slice(cut));
    await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
    await expect(action(page)).toHaveAttribute('data-kind', 'idle');
    await expect(page.locator('.story-entry').last()).toContainText(narrative);
    const committed = await stored(page); expect(committed.state.journal).toHaveLength(2);
    expect(calls).toEqual([{ model: 'story', stream }, { model: 'variables', stream: !stream }, { model: 'world', stream }]);
    await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); expect(await stored(page)).toEqual(committed); expect(calls).toHaveLength(3);
  });

  test(`${stream ? '流式' : '非流式'}失败：手动正文校验拒绝，安全摘要刷新保留且不自动重试`, async ({ page }) => {
    const before = await seed(page, stream, true); await begin(page, stream, true);
    const invalid = '<thinking>连续性计划</thinking><正文>短</正文><短期记忆>等候</短期记忆><变量规划>[]</变量规划>';
    active!.end(stream ? frame(invalid) + 'data: [DONE]\n\n' : json(invalid));
    await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('failed'); await closeError(page);
    const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft?.story).toBeUndefined();
    expect(failed.draft?.failures).toHaveLength(1); expect(failed.draft?.failures[0].errorCode).toBe('invalid_output');
    await expect(action(page)).toHaveAttribute('data-kind', 'continue'); expect(calls).toHaveLength(1);
    await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); expect(await stored(page)).toEqual(failed);
    await openWorkflowDiagnostics(page); await expect(page.getByRole('region', { name: '持久失败摘要', exact: true })).toContainText('invalid_output'); expect(calls).toHaveLength(1);
  });

  test(`${stream ? '流式' : '非流式'}取消：常驻按钮可用，迟到完整响应不写库、不触发下游`, async ({ page }) => {
    const before = await seed(page, stream); await begin(page, stream);
    if (stream) active!.write(frame(prefix)); else await expect(page.getByText('正在等待完整正文', { exact: true })).toBeVisible();
    await action(page).click(); await expect(action(page)).toHaveAttribute('data-kind', 'continue');
    const cancelled = await stored(page); expect(cancelled.state).toEqual(before.state); expect(cancelled.draft?.story).toBeUndefined(); expect(cancelled.draft?.failures).toEqual([]);
    active!.end(stream ? frame(output.slice(prefix.length)) + 'data: [DONE]\n\n' : json(output));
    await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); expect(await stored(page)).toEqual(cancelled); expect(calls).toHaveLength(1);
    await expect(page.locator('#player-input')).toHaveValue('沿江观察');
  });
}

test('旧设置默认开启，三开关独立保存/放弃/刷新，零模型请求', async ({ page }, info) => {
  await seed(page, true, false, true); const raw = await page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
  await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  const story = page.getByRole('checkbox', { name: '正文生成 · 流式传输', exact: true });
  const variables = page.getByRole('checkbox', { name: '变量管理 · 流式传输', exact: true });
  const world = page.getByRole('checkbox', { name: '动态世界 · 流式传输', exact: true });
  await expect(story).toBeChecked(); await expect(variables).not.toBeChecked(); await expect(world).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('heijin.settings.v1'))).toBe(raw);
  await story.uncheck(); await expect(world).toBeChecked(); await expect(variables).not.toBeChecked();
  await page.getByRole('button', { name: '保存本地设置', exact: true }).click(); await page.reload();
  await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click(); await expect(story).not.toBeChecked(); await expect(world).toBeChecked(); await expect(variables).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('runtime-settings.png') });
  await story.check(); await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!)); expect(saved.runtime).toMatchObject({ streamStory: false, streamVariables: false, streamWorld: true }); expect(calls).toHaveLength(0);
});

test('非流式等待超时，保留行动及安全诊断，不自动换模式或重发', async ({ page }) => {
  const before = await seed(page, false, false, false, 5); await begin(page, false);
  await expect.poll(async () => (await stored(page)).draft?.stageStatus.story, { timeout: 10000 }).toBe('failed'); await closeError(page);
  const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft?.failures[0].errorCode).toBe('timeout');
  await expect(action(page)).toHaveAttribute('data-kind', 'continue'); await expect(page.locator('#player-input')).toHaveValue('沿江观察'); expect(calls).toEqual([{ model: 'story', stream: false }]);
});
