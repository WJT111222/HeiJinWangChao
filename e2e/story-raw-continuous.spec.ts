import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { closeWorkflowSheet, openGameTools, openStageRaw, openWorkflowStage, workflowTrigger } from './helpers/gameLayout';

const key = 'fictional-unified-browser-key';
const thoughts = '公开思考甲。\n', later = '公开思考乙。\n';
const planning = '<think>兼容文本保持原貌。</think>\n<thinking>项目规划保持原貌。</thinking>\n';
const body = '【旁白】小说开始，只有实际正文。';
const tail = '</正文><短期记忆>内部记忆标记</短期记忆><变量规划>[]</变量规划>';
let server: Server, response: ServerResponse | undefined, baseUrl: string, calls: number, jsonMode: boolean;
const frame = (delta: Record<string, string>) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n';
function send(delta: Record<string, string>) {
  const bytes = Buffer.from(frame(delta));
  for (let i = 0; i < bytes.length; i += 3) response!.write(bytes.subarray(i, i + 3));
}
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://**', route => route.abort());
  calls = 0; response = undefined; jsonMode = false;
  server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    for await (const chunk of req) void chunk;
    calls++; response = res;
    if (jsonMode) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: {
        content: planning + '<正文>' + body + tail, reasoning_content: thoughts,
      }, finish_reason: 'stop' }] }));
    } else { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); expect(calls).toBe(1);
});
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async ({ baseUrl, key }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/game.ts', '/src/domain/drafts.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { game }, { createTurnDraft }, { defaultSettings, settingsKey }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open(); await repo.create(game());
    await repo.saveDraft(createTurnDraft('save-a', 0, 'unified-browser', 'opening', ''), null); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel('deepseek'), config = defaultAiConfig(); channel.baseUrl = baseUrl; channel.defaultModel = 'mock-unified';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, key);
  }, { baseUrl, key });
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page); return stored(page);
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function closeTools(page: Page) {
  const tools = page.getByRole('button', { name: '回合操作', exact: true });
  if (await tools.isVisible() && await tools.getAttribute('aria-expanded') === 'true') await tools.click();
}
async function closeWorkflow(page: Page) {
  if ((page.viewportSize()?.width ?? 0) <= 900) await closeWorkflowSheet(page);
  else await workflowTrigger(page).click();
}
async function begin(page: Page) {
  await openWorkflowStage(page, 'story');
  if ((page.viewportSize()?.width ?? 0) <= 900) { await closeWorkflowSheet(page); await page.getByRole('button', { name: '回合操作', exact: true }).click(); }
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect.poll(() => Boolean(response)).toBe(true);
  // An immediate JSON response can finish before the menu-close step. Wait for
  // the saved draft instead of querying a trigger while React removes it.
  if (jsonMode) await expect.poll(async () => Boolean((await stored(page)).draft?.story)).toBe(true);
  await closeTools(page);
  if ((page.viewportSize()?.width ?? 0) > 900) await closeWorkflow(page);
}
async function finish(page: Page) {
  response!.end('data: [DONE]\n\n');
  await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
}
async function raw(page: Page, expected: string, info: TestInfo, name: string, scroll = false) {
  await closeTools(page);
  const diagnostic = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
  if (await diagnostic.isVisible()) await page.keyboard.press('Escape');
  const panel = await openStageRaw(page, 'story'), box = panel.getByRole('textbox', { name: '正文模型完整原文', exact: true });
  await expect(box).toHaveCount(1); await expect(box).toHaveValue(expected); await expect(box).toHaveAttribute('readonly', '');
  expect(await box.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);
  await expect(panel.locator('pre, .story-native-response')).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: /供应商公开/ })).toHaveCount(0);
  await expect(panel.getByLabel('供应商公开原生思考全文', { exact: true })).toHaveCount(0);
  await box.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await page.keyboard.press('x'); await expect(box).toHaveValue(expected);
  await box.evaluate(el => { const input = el as HTMLTextAreaElement; input.setSelectionRange(0, 0); input.blur(); });
  if (scroll) {
    expect(await box.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await box.hover(); await page.mouse.wheel(0, 2000); await expect.poll(() => box.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await box.evaluate(el => { el.scrollTop = el.scrollHeight; });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach(`${info.project.name}-${name}`, { body: await page.screenshot(), contentType: 'image/png' });
  return { box, panel };
}

test('连续原文：流式交错和迟到思考真实排序，正文阅读不变，长文本可滚动复制', async ({ page }, info) => {
  const before = await seed(page); await begin(page); const reader = page.getByTestId('story-reader');
  send({ reasoning_content: thoughts }); await expect(reader).toContainText(thoughts.trim());
  send({ content: planning }); await expect(reader).toContainText('项目规划保持原貌');
  await raw(page, thoughts + planning, info, 'pending-raw'); await closeWorkflow(page);
  send({ reasoning_content: later }); send({ content: '<正' }); await expect(reader).toContainText('公开思考乙');
  send({ content: '文>' }); await expect(reader.getByTestId('stream-narrative')).toHaveText('');
  await expect(reader.getByRole('region', { name: '生成中的公开思考', exact: true })).toHaveCount(0);
  const longBody = body + '\n' + '正文长段落，标签和中文按实际返回保留。\n'.repeat(150);
  send({ content: longBody }); await expect(reader.getByTestId('stream-narrative')).toHaveText(longBody);
  send({ reasoning_content: '迟到实际思考。' }); await expect(reader).not.toContainText('迟到实际思考');
  send({ content: tail }); await finish(page);
  const saved = await stored(page); expect(saved.state).toEqual(before.state); expect(saved.draft?.story?.narrative).toBe(longBody.trim());
  const expected = thoughts + planning + later + '<正文>' + longBody + '迟到实际思考。' + tail;
  await raw(page, expected, info, 'continuous-stream', true); expect(await stored(page)).toEqual(saved);
  await page.reload(); await openGameTools(page); const cleared = await openStageRaw(page, 'story');
  await expect(cleared).toContainText('没有可恢复的模型原文'); await expect(cleared.getByRole('textbox')).toHaveCount(0);
  expect(await stored(page)).toEqual(saved);
});

test('连续原文：非流式同框完整复制，明确不知字段间真实时序', async ({ page }, info) => {
  jsonMode = true; const before = await seed(page); await begin(page);
  await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
  const saved = await stored(page); expect(saved.state).toEqual(before.state); expect(saved.draft?.story?.narrative).toBe(body);
  const { panel } = await raw(page, planning + '<正文>' + body + tail + thoughts, info, 'continuous-json');
  await expect(panel).toContainText('字段间真实返回先后不可知'); expect(await stored(page)).toEqual(saved);
});

test('连续原文：同一SSE事件多字段不伪造生成先后，所有实际值只显示一次', async ({ page }, info) => {
  const before = await seed(page); await begin(page);
  send({ content: planning + '<正文>' + body + tail, reasoning_content: thoughts }); await finish(page);
  const saved = await stored(page); expect(saved.state).toEqual(before.state);
  const { panel } = await raw(page, planning + '<正文>' + body + tail + thoughts, info, 'continuous-same-event');
  await expect(panel).toContainText('同一事件'); await expect(panel).toContainText('不代表生成先后'); expect(await stored(page)).toEqual(saved);
});

test('连续原文：中断响应单框完整可复制且脱敏，正式状态草稿不变', async ({ page }, info) => {
  const before = await seed(page); await begin(page);
  send({ reasoning_content: thoughts + key.slice(0, 12) });
  const reader = page.getByTestId('story-reader'); await expect(reader).toContainText(thoughts.trim()); await expect(reader).not.toContainText(key.slice(0, 12));
  send({ reasoning_content: key.slice(12) + '\n' }); send({ content: '<thinking>尚未完成的项目规划' });
  await expect(reader).toContainText('尚未完成的项目规划'); response!.destroy();
  await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
  const expected = await page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0].displayText; });
  expect(expected).toContain(thoughts); expect(expected).toContain('<thinking>尚未完成的项目规划'); expect(expected).not.toContain(key);
  await raw(page, expected, info, 'continuous-interrupted'); expect(await stored(page)).toEqual(before);
});
