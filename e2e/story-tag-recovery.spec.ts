import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { deepSeekUntagged, recoveryPlanning, recoveryTransition, recoveryNarrative, recoverySummary, recoveryGuide, recoveryActions, recoveryTail } from '../src/tests/fixtures/storyRecovery';
import { closeWorkflowSheet, openGameTools, openStageRaw, openWorkflowStage, workflowTrigger } from './helpers/gameLayout';

let server: Server, response: ServerResponse | undefined, baseUrl: string, calls: number;
const key = 'fictional-stream-browser-key';
const native = '供应商实际公开思考：核对既有场景。';
const frame = (delta: Record<string, string>) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n';
function send(text: string, thought = false) {
  if (!response) throw new Error('missing mock stream');
  // Byte writes include Chinese UTF-8 boundaries; tags are independently split by each test.
  const bytes = Buffer.from(frame({ [thought ? 'reasoning_content' : 'content']: text }));
  for (let i = 0; i < bytes.length; i += 3) response.write(bytes.subarray(i, i + 3));
}
function finish() { response!.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); }
test.beforeEach(async ({ page }) => {
  calls = 0; response = undefined;
  await page.route('https://**', route => route.abort());
  server = createServer(async (request, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (request.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    for await (const chunk of request) { void chunk; /* Never log credentials or prompt contents. */ }
    calls++; response = res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  expect(calls).toBe(1);
});
async function seed(page: Page, timeout = 120) {
  await page.goto('/');
  await page.evaluate(async ({ baseUrl, key, timeout }) => {
    const p = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/game.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { game }, { createTurnDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(p.map(path => import(path)));
    const repo = await SaveRepository.open();
    await repo.create(game()); await repo.saveDraft(createTurnDraft('save-a', 0, 'tag-recovery', 'regular', '核对眼前的笔记', false, false), null); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = true; settings.runtime.timeoutSeconds = timeout;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel('deepseek'), config = defaultAiConfig(); channel.baseUrl = baseUrl; channel.defaultModel = 'mock-stream';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, key);
  }, { baseUrl, key, timeout });
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
  return stored(page);
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function start(page: Page) {
  await openWorkflowStage(page, 'story');
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    await closeWorkflowSheet(page);
    await page.getByRole('button', { name: '回合操作', exact: true }).click();
  }
  await page.getByRole('button', { name: '生成本回合正文', exact: true }).click();
  await expect.poll(() => Boolean(response)).toBe(true);
  await closeTools(page);
  if ((page.viewportSize()?.width ?? 0) > 900) await workflowTrigger(page).click();
}
async function closeTools(page: Page) {
  const tools = page.getByRole('button', { name: '回合操作', exact: true });
  if (await tools.isVisible() && await tools.getAttribute('aria-expanded') === 'true') await tools.click();
}
async function closeDiagnostics(page: Page) {
  await closeTools(page);
  const dialog = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
  if (await dialog.isVisible()) await page.keyboard.press('Escape');
}
async function shot(page: Page, info: TestInfo, name: string) {
  await info.attach(`${info.project.name}-${name}`, { body: await page.screenshot(), contentType: 'image/png' });
}

async function raw(page: Page, expected: string, info: TestInfo, name: string) {
  await closeDiagnostics(page); const panel = await openStageRaw(page, 'story');
  const box = panel.getByRole('textbox', { name: '正文模型完整原文', exact: true });
  await expect(panel.locator('textarea')).toHaveCount(1); await expect(panel.locator('pre')).toHaveCount(0);
  await expect(box).toHaveAttribute('readonly', ''); await expect(box).toHaveValue(expected);
  await expect(panel.getByLabel('供应商公开原生思考全文')).toHaveCount(0);
  await box.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await box.evaluate(el => { const input = el as HTMLTextAreaElement; input.setSelectionRange(0, 0); input.scrollTop = 0; input.blur(); });
  await shot(page, info, name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

test('DeepSeek真实掉标签结构：Step0–15+明确转入句+旁白+全部尾块，一次请求安全恢复', async ({ page }, info) => {
  const before = await seed(page); await start(page); const reader = page.getByTestId('story-reader');
  send(native, true); await expect(reader).toContainText(native);
  const prefix = recoveryPlanning + '\n\n' + recoveryTransition + '\n\n';
  send(prefix); await expect(reader).not.toContainText('规划独有标记');
  send(recoveryNarrative.slice(0, 30)); await expect(reader.getByTestId('stream-narrative')).toHaveCount(0);
  await expect(reader).not.toContainText('站台边的雨声'); // No boundary guessing during streaming.
  send(deepSeekUntagged.slice(prefix.length + 30)); finish();
  await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
  const saved = await stored(page); expect(saved.state).toEqual(before.state);
  expect(saved.draft?.story).toEqual({ turnKind: 'regular', narrative: recoveryNarrative, summary: recoverySummary,
    variableGuide: recoveryGuide, actionOptions: recoveryActions });
  expect(saved.draft?.storyRevision).toBe(1); expect(saved.draft?.draftRevision).toBe(1);
  await expect(reader).toContainText('站台边的雨声'); await expect(reader).not.toContainText('规划独有标记');
  await expect(reader).not.toContainText(recoveryTransition); await expect(reader).not.toContainText(native);
  await shot(page, info, 'recovered-novel');
  await raw(page, native + deepSeekUntagged, info, 'untouched-recovery-raw');
  expect(await stored(page)).toEqual(saved);
  await page.reload(); await openGameTools(page); const cleared = await openStageRaw(page, 'story');
  await expect(cleared).toContainText('没有可恢复的模型原文'); expect(await stored(page)).toEqual(saved);
});

test('可选thinking：无项目规划时标签正文仍实时显示，空白边界和完整原文不变', async ({ page }, info) => {
  const before = await seed(page); await start(page); const reader = page.getByTestId('story-reader');
  send('<正'); await expect(reader.getByRole('region', { name: '项目 thinking 内容', exact: true })).toHaveCount(0);
  send('文>'); await expect(reader.getByTestId('stream-narrative')).toHaveText('');
  send(recoveryNarrative.slice(0, 35)); await expect(reader.getByTestId('stream-narrative')).toHaveText(recoveryNarrative.slice(0, 35));
  await shot(page, info, 'optional-thinking-stream');
  send(recoveryNarrative.slice(35) + '</正文>' + recoveryTail); finish();
  await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
  const saved = await stored(page); expect(saved.state).toEqual(before.state);
  expect(saved.draft?.story).toEqual({ turnKind: 'regular', narrative: recoveryNarrative, summary: recoverySummary,
    variableGuide: recoveryGuide, actionOptions: recoveryActions });
  await raw(page, '<正文>' + recoveryNarrative + '</正文>' + recoveryTail, info, 'optional-thinking-raw');
  expect(await stored(page)).toEqual(saved);
});

for (const mode of ['ambiguous', 'time', 'event'] as const) {
  test(`恢复拒绝 ${mode}：不猜测边界，后续校验仍有效，无任何部分保存`, async ({ page }, info) => {
    const before = await seed(page); await start(page);
    let output = deepSeekUntagged;
    if (mode === 'ambiguous') output = output.replace('### Step 12｜', '### Step 13｜');
    else {
      const guide = mode === 'time' ? [{ group: 'time', subjectHint: 'time:end', observedFact: '2026-10-18T07:00:00+08:00' }]
        : [{ group: 'event', observedFact: '不存在的事件', eventNarration: { eventId: 'absent-event', mode: 'enter', at: '2026-10-18T08:00:00+08:00' } }];
      output = output.replace(/<变量规划>[\s\S]*?<\/变量规划>/, '<变量规划>' + JSON.stringify(guide) + '</变量规划>');
    }
    send(output); finish(); await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
    const error = await page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0].error; });
    if (mode === 'time') expect(error).toMatchObject({ code: 'time_data', details: { storyRule: 'time_invalid_or_reversed' } });
    else if (mode === 'event') expect(error).toMatchObject({ code: 'event_entry', details: { storyRule: 'narration_reference' } });
    else expect(error).toMatchObject({ code: 'invalid_output' });
    await raw(page, output, info, `rejected-${mode}-raw`); expect(await stored(page)).toEqual(before);
  });
}
