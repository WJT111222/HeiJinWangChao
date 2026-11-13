import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { closeWorkflowSheet, openGameTools, openStageRaw, openWorkflowStage, workflowTrigger } from './helpers/gameLayout';

let server: Server, response: ServerResponse | undefined, baseUrl: string, calls: number;
const key = 'fictional-stream-browser-key';
const native = '公开思考标记：先核对已经收到的场景。';
const planning = '项目规划标记：保持人物和场景连续。';
const tail = '<短期记忆>内部摘要标记</短期记忆><变量规划>[]</变量规划>';
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
    await repo.create(game()); await repo.saveDraft(createTurnDraft('save-a', 0, 'stream-read', 'opening', ''), null); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false; settings.runtime.timeoutSeconds = timeout;
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
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
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
for (const mode of ['project', 'native', 'both', 'none'] as const) {
  test(`流式阅读 ${mode}：实时思考→清空→仅正文，原文统一且严格验收`, async ({ page }, info) => {
    const before = await seed(page); await start(page);
    const reader = page.getByTestId('story-reader'), thoughts = reader.getByRole('region', { name: '生成中的公开思考', exact: true });
    let rawText = '';
    const text = (value: string) => { rawText += value; send(value); };
    if (mode === 'native' || mode === 'both') {
      send(native, true); await expect(reader).toContainText(native);
    }
    if (mode === 'project' || mode === 'both') {
      text('<thi'); text('nking>' + planning);
      await expect(reader).toContainText(planning);
      if (mode === 'both') await shot(page, info, 'thinking-sources');
      text('\n' + '按实际收到的内容继续阅读。\n'.repeat(45));
      await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      if (mode === 'both') await shot(page, info, 'thinking');
      text('</thinking>');
    } else if (mode === 'none') {
      await expect(reader).not.toContainText(native); await expect(reader).not.toContainText(planning);
    }
    text('<正');
    if (mode !== 'none') await expect(thoughts).toBeVisible();
    text('文>');
    await expect(thoughts).toHaveCount(0);
    const novel = reader.getByTestId('stream-narrative'); await expect(novel).toHaveText('');
    if (mode === 'both') await shot(page, info, 'body-boundary');
    text('小说开场标记。'); await expect(novel).toContainText('小说开场标记。');
    if (mode === 'both') {
      text('\n' + '小说阅读段落，雨水沿着站台缓缓落下。\n'.repeat(60));
      await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await reader.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
      await expect(page.getByRole('button', { name: '跟随最新正文 ↓', exact: true })).toBeVisible();
      text('小说末尾标记。'); await expect(novel).toContainText('小说末尾标记。');
      expect(await reader.evaluate(el => el.scrollTop)).toBe(0);
      await page.getByRole('button', { name: '跟随最新正文 ↓', exact: true }).click();
      await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await shot(page, info, 'body-reading');
    }
    text('</正文>' + tail); finish();
    await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
    const saved = await stored(page); expect(saved.state).toEqual(before.state);
    const valid = mode === 'project' || mode === 'both';
    if (valid) {
      expect(saved.draft?.story?.narrative).toContain('小说开场标记。');
      expect(JSON.stringify(saved.draft?.story)).not.toContain(planning);
      expect(JSON.stringify(saved.draft?.story)).not.toContain(native);
      await expect(reader).not.toContainText(planning); await expect(reader).not.toContainText(native);
    } else {
      expect(saved).toEqual(before);
    }
    await closeDiagnostics(page);
    const raw = await openStageRaw(page, 'story');
    await expect(page.locator('.wf-stage').getByRole('tab')).toHaveText(['概览', '模型原文', '校验结果']);
    await expect(page.getByRole('tab', { name: '叙事规划', exact: true })).toHaveCount(0);
    await expect(raw.getByLabel('正文模型完整原文', { exact: true })).toHaveText(rawText, { useInnerText: false });
    if (mode === 'native' || mode === 'both') {
      await expect(raw.getByLabel('供应商公开原生思考全文', { exact: true })).toHaveText(native);
      await expect(raw).toContainText('排列不代表真实返回先后');
    } else await expect(raw.getByLabel('供应商公开原生思考全文', { exact: true })).toHaveCount(0);
    expect(await raw.locator('pre').allTextContents()).toEqual(mode === 'native' || mode === 'both' ? [rawText, native] : [rawText]);
    if (mode === 'both') {
      await shot(page, info, 'unified-raw');
      await raw.getByLabel('供应商公开原生思考全文', { exact: true }).scrollIntoViewIfNeeded();
      await shot(page, info, 'unified-raw-native');
    }
    expect(await stored(page)).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await openGameTools(page);
    const cleared = await openStageRaw(page, 'story'); await expect(cleared).toContainText('没有可恢复的模型原文');
    await expect(cleared).not.toContainText(native); expect(await stored(page)).toEqual(saved);
  });
}
for (const mode of ['cancel', 'network', 'timeout'] as const) {
  test(`流式${mode}：公开思考可读但不保存，错误原文可查看且脱敏`, async ({ page }, info) => {
    const before = await seed(page, mode === 'timeout' ? 3 : 120); await start(page);
    send(native + ' ' + key.slice(0, 12), true);
    const preview = page.getByRole('article', { name: '流式正文预览', exact: true });
    await expect(preview).toContainText(native); await expect(preview).not.toContainText(key.slice(0, 12));
    send(key.slice(12) + '，公开片段终点', true); send('<thinking>尚未完成的项目规划');
    await expect(preview).toContainText('尚未完成的项目规划'); await expect(preview).not.toContainText(key);
    if (mode === 'cancel') {
      if ((page.viewportSize()?.width ?? 0) <= 900) await page.getByRole('button', { name: '回合操作', exact: true }).click();
      await page.getByRole('button', { name: '取消生成', exact: true }).click();
    }
    if (mode === 'network') response!.destroy();
    await expect(preview).toHaveCount(0);
    expect(await stored(page)).toEqual(before); await closeDiagnostics(page);
    const raw = await openStageRaw(page, 'story');
    await expect(raw).toContainText('尚未完成的项目规划'); await expect(raw).toContainText('公开片段终点');
    await expect(raw).not.toContainText(key);
    if (mode === 'network') await shot(page, info, 'interrupted-raw');
    expect(await stored(page)).toEqual(before);
  });
}
