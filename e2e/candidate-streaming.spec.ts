import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflowStage, openStageRaw, workflowTrigger, openSettings } from './helpers/gameLayout';

let server: Server, baseUrl: string, active: ServerResponse | undefined, calls: { model: string; stream: boolean }[], target: string;
const frame = (delta: object) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n';
const variableText = '<thinking>只使用当前事实。</thinking><说明>私密变量说明。</说明><命令>\nset worldClock = "2026-10-18T08:20:00+08:00"\n</命令>';
const worldText = JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: ['私密世界说明。'] });
function write(delta: object) {
  const bytes = Buffer.from(frame(delta));
  for (let n = 0; n < bytes.length; n += 97) active!.write(bytes.subarray(n, n + 97));
}
function end() { active!.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); }
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://**/*', route => route.abort()); calls = []; active = undefined; target = '';
  server = createServer(async (req, res) => {
    res.on('error', () => undefined);
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    let text = ''; for await (const chunk of req) text += String(chunk);
    const body = JSON.parse(text) as { model: string; stream: boolean }; calls.push({ model: body.model, stream: body.stream });
    if (body.model !== target) {
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(frame({ content: body.model === 'variables' ? variableText : worldText }) + 'data: [DONE]\n\n');
      return;
    }
    active = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const a = server.address();
  if (!a || typeof a === 'string') throw Error('mock server missing'); baseUrl = `http://127.0.0.1:${a.port}/v1`;
});
test.afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}
async function seed(page: Page, stage: 'variables' | 'world', old = false) {
  target = stage;
  await page.goto('/');
  await page.evaluate(async ({ baseUrl, stage, old }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts',
      '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }, { startStageAttempt }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open(); await repo.create(worldState());
    await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
    const full = await completeDraft(repo, { variables: { commands: [{ type: 'SetWorldClock', commandId: 'clock-stream', evidence: '经过十分钟', worldClock: '2026-10-18T08:20:00+08:00' }], rejectedSuggestions: [], unresolved: [] } });
    await repo.saveDraft(startStageAttempt(full, [stage]), full.draftRevision, undefined, full); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[]) summary.automatic = false;
    settings.runtime.streamVariables = true; settings.runtime.streamWorld = true;
    if (old) { delete (settings.runtime as Partial<typeof settings.runtime>).streamVariables; delete (settings.runtime as Partial<typeof settings.runtime>).streamWorld; settings.runtime.timeoutSeconds = 73; settings.prompts.perspective = 'first'; }
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel('deepseek'), config = defaultAiConfig(); channel.baseUrl = baseUrl;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'fictional-stream-browser-key', true);
  }, { baseUrl, stage, old });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  return stored(page);
}
async function closeDiagnostics(page: Page) { if (await page.locator('dialog.mobile-diagnostics-sheet[open]').isVisible()) await page.keyboard.press('Escape'); }
async function closeWorkflow(page: Page) {
  const close = page.getByRole('button', { name: '收起四阶段详情', exact: true });
  if (await close.isVisible()) await close.click(); else await workflowTrigger(page).click();
}
async function begin(page: Page, stage: 'variables' | 'world', label: string) {
  active = undefined; await openWorkflowStage(page, stage); await page.getByRole('button', { name: `生成${label}候选`, exact: true }).click();
  await expect.poll(() => Boolean(active)).toBe(true); expect(calls.at(-1)).toEqual({ model: stage, stream: true });
}

test('旧运行设置不重置：两个独立开关默认关闭，显式保存、刷新和未保存取消', async ({ page }, info) => {
  await seed(page, 'variables', true);
  const original = await page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
  await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  const variables = page.getByRole('checkbox', { name: '主角与现场 · 流式传输', exact: true }), world = page.getByRole('checkbox', { name: '场外与网络 · 流式传输', exact: true });
  await expect(variables).not.toBeChecked(); await expect(world).not.toBeChecked(); await expect(page.getByLabel('请求超时（秒）')).toHaveValue('73');
  expect(await page.evaluate(() => localStorage.getItem('heijin.settings.v1'))).toBe(original);
  await variables.check(); await expect(world).not.toBeChecked(); await page.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await page.reload(); await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(variables).toBeChecked(); await expect(world).not.toBeChecked(); await world.check();
  await page.getByRole('button', { name: '保存本地设置', exact: true }).click(); await page.screenshot({ path: info.outputPath('stream-settings.png') });
  await page.reload(); await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(variables).toBeChecked(); await expect(world).toBeChecked(); await variables.uncheck(); await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!));
  expect(saved.runtime).toMatchObject({ streamVariables: true, streamWorld: true, timeoutSeconds: 73 }); expect(saved.prompts.perspective).toBe('first'); expect(saved.version).toBe(1); expect(calls).toEqual([]);
});

for (const stage of ['variables', 'world'] as const) {
  const label = stage === 'variables' ? '变量' : '世界', rawLabel = stage === 'variables' ? '主角与现场' : '场外与网络';
  test(`${stage} 实时只读、主动公开思考、跟随与复制、完整校验后结算`, async ({ page }, info) => {
    const before = await seed(page, stage); await begin(page, stage, label);
    await page.evaluate(async () => {
      const p = '/src/services/ai/stageResponses.ts', { stageResponses } = await import(p);
      const metrics = { publishes: 0, frames: 0, active: true };
      const unsubscribe = stageResponses.subscribe(() => { metrics.publishes++; });
      const tick = () => { if (metrics.active) { metrics.frames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick);
      (window as unknown as { __streamMetrics: typeof metrics; __stopMetrics: () => void }).__streamMetrics = metrics;
      (window as unknown as { __stopMetrics: () => void }).__stopMetrics = () => { metrics.active = false; unsubscribe(); };
    });
    write({ reasoning_content: '仅主动查看的独立公开思考' });
    const prefix = stage === 'variables' ? '<thinking>变量规划</thinking><说明>私密变量说明。\n' : '{"unresolved":["私密世界说明。';
    write({ content: prefix });
    await expect.poll(() => page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0]?.text; })).toBe(prefix);
    expect(await page.locator('body').textContent()).not.toContain('私密');
    const pending = await stored(page); expect(pending.state).toEqual(before.state); expect(pending.draft?.[stage]).toBeUndefined();
    const panel = await openStageRaw(page, stage), box = panel.getByRole('textbox', { name: `${rawLabel}模型完整原文`, exact: true });
    await expect(panel).toContainText('未完成'); await expect(box).toHaveValue(prefix); await expect(box).toHaveAttribute('readonly', '');
    expect(await panel.textContent()).not.toContain('仅主动查看的独立');
    const passage = '长段落中文，供阅读与复制。\n'.repeat(1400);
    const long = stage === 'world' ? passage.replace(/\n/g, '\\n') : passage;
    for (let n = 0; n < long.length; n += 200) write({ content: long.slice(n, n + 200) });
    await expect(box).toHaveValue(prefix + long);
    expect(await box.evaluate(el => el.scrollTop > 0)).toBe(true);
    // User reading the beginning must not be dragged down by the next fragment.
    await box.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    write({ content: '继续返回。' }); await expect(box).toHaveValue(prefix + long + '继续返回。'); expect(await box.evaluate(el => el.scrollTop)).toBe(0);
    await box.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prefix + long + '继续返回。');
    await panel.getByLabel(`${rawLabel}原文内容`).selectOption('reasoning'); await expect(panel.getByRole('textbox')).toHaveValue('仅主动查看的独立公开思考');
    expect(await stored(page)).toEqual(pending); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const inputStarted = Date.now(); await page.locator('#player-input').fill('查看原文时仍可编辑行动');
    await expect(page.locator('#player-input')).toHaveValue('查看原文时仍可编辑行动');
    const inputLatencyMs = Date.now() - inputStarted;
    const metrics = await page.evaluate(() => { const w = window as unknown as { __streamMetrics: { publishes: number; frames: number }; __stopMetrics: () => void }; w.__stopMetrics(); return w.__streamMetrics; });
    expect(metrics.frames).toBeGreaterThan(0); expect(metrics.publishes).toBeLessThan(40); expect(calls).toHaveLength(1);
    await writeFile(info.outputPath('live-performance.json'), JSON.stringify({ ...metrics, inputLatencyMs, textChars: long.length, fragments: Math.ceil(long.length / 200) }, null, 2));
    await info.attach('live-performance', { body: JSON.stringify({ ...metrics, inputLatencyMs, textChars: long.length, fragments: Math.ceil(long.length / 200) }, null, 2), contentType: 'application/json' });
    await panel.getByLabel(`${rawLabel}原文内容`).selectOption('content'); await page.screenshot({ path: info.outputPath('stream-live.png') });
    if (stage === 'variables') write({ content: '</说明><命令>\nset worldClock = "2026-10-18T08:20:00+08:00"\n</命令>' });
    else write({ content: '"],"worldCommands":[],"taskCommands":[],"eventCommands":[],"visibleHooks":[]}' });
    end();
    await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('ready');
    expect((await stored(page)).state).toEqual(before.state);
    await closeWorkflow(page); await openWorkflowStage(page, stage);
    await page.getByRole('button', { name: stage === 'variables' ? '继续未完成阶段' : '完成本回合结算', exact: true }).click();
    await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
    expect(calls.map(c => c.model)).toEqual(stage === 'variables' ? ['variables', 'world'] : ['world']);
    await page.screenshot({ path: info.outputPath('stream-committed.png') });
  });
  test(`${stage} 取消后显式重试不串台，中断保留片段且不保存失败候选`, async ({ page }, info) => {
    const before = await seed(page, stage); await begin(page, stage, label);
    write({ content: '旧请求的合法公开片段' }); await openWorkflowStage(page, stage);
    await page.getByRole('button', { name: `取消${label}生成`, exact: true }).click();
    await expect(page.getByRole('button', { name: `生成${label}候选`, exact: true })).toBeEnabled();
    const stopped = await stored(page); expect(stopped.state).toEqual(before.state); expect(stopped.draft?.[stage]).toBeUndefined();
    const old = active; await begin(page, stage, label); write({ content: stage === 'variables' ? variableText : worldText }); end();
    await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('ready');
    old?.write(frame({ content: '取消后的迟到错误内容' })); old?.end();
    await openWorkflowStage(page, stage); active = undefined;
    await page.getByRole('button', { name: `重新生成${label}候选`, exact: true }).click(); await expect.poll(() => Boolean(active)).toBe(true);
    write({ content: '新请求中断前的实际片段' });
    await expect.poll(() => page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0]?.text; })).toBe('新请求中断前的实际片段');
    active!.destroy(); await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('failed');
    await closeDiagnostics(page); const panel = await openStageRaw(page, stage);
    await expect(panel.getByRole('textbox')).toHaveValue('新请求中断前的实际片段'); await expect(panel).not.toContainText('取消后的迟到错误内容');
    const after = await stored(page); expect(after.state).toEqual(before.state); expect(after.draft?.[stage]).toBeUndefined(); expect(calls).toHaveLength(3);
    await page.screenshot({ path: info.outputPath('stream-interrupted.png') }); expect(await stored(page)).toEqual(after);
  });
}
