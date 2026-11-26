import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { expectStoryRaw } from './helpers/storyRaw';
import { closeWorkflowSheet, openGameTools, openStageRaw, openWorkflowStage, workflowTrigger, openTurnTools } from './helpers/gameLayout';

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
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? 'content-type,authorization');
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
type LiteraryProtocol = 'deepseek' | 'openai' | 'gemini' | 'anthropic';
async function seed(page: Page, timeout = 120, oracle?: LiteraryProtocol) {
  await page.goto('/');
  await page.evaluate(async ({ baseUrl, key, timeout, oracle }) => {
    const p = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/game.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { game }, { createTurnDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(p.map(path => import(path)));
    const repo = await SaveRepository.open();
    await repo.create(game()); await repo.saveDraft(createTurnDraft('save-a', 0, 'stream-read', 'opening', ''), null); repo.close();
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false; settings.runtime.timeoutSeconds = timeout;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    if (oracle) {
      const { savePresetSettings } = await import('/src/presets/settings.ts' as string);
      savePresetSettings({ enabled: true, selected: 'meowssiah', packages: {} });
    }
    const channel = newChannel(oracle ?? 'deepseek'), config = defaultAiConfig(); channel.baseUrl = baseUrl; channel.defaultModel = 'mock-stream';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, key);
  }, { baseUrl, key, timeout, oracle });
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
    await openTurnTools(page);
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
    expect(saved.draft?.story?.narrative).toContain('小说开场标记。');
    expect(JSON.stringify(saved.draft?.story)).not.toContain(planning);
    expect(JSON.stringify(saved.draft?.story)).not.toContain(native);
    await expect(reader).not.toContainText(planning); await expect(reader).not.toContainText(native);
    await closeDiagnostics(page);
    const raw = await openStageRaw(page, 'story');
    await expect(page.locator('.wf-stage').getByRole('tab')).toHaveText(['概览', '模型原文', '校验结果']);
    await expect(page.getByRole('tab', { name: '叙事规划', exact: true })).toHaveCount(0);
    const rawBox = await expectStoryRaw(raw, (mode === 'native' || mode === 'both' ? native : '') + rawText);
    await expect(raw.getByLabel('供应商公开原生思考全文', { exact: true })).toHaveCount(0);
    if (mode === 'both') {
      await shot(page, info, 'unified-raw');
      await rawBox.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await shot(page, info, 'unified-raw-end');
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
      if ((page.viewportSize()?.width ?? 0) <= 900) await openTurnTools(page);
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

for (const mode of ['all', 'only', 'mirror'] as const) {
  test(`兼容公开思考 ${mode}：真实分块来源、原生优先去重和正文清空`, async ({ page }, info) => {
    const before = await seed(page); await start(page);
    const reader = page.getByTestId('story-reader'), compatibility = '兼容公开文本标记：核对已经收到的站台场景。';
    const nativeText = mode === 'mirror' ? compatibility : native;
    const compatibleRegion = reader.getByRole('region', { name: '兼容文本思考', exact: true });
    let rawText = '';
    const text = (value: string) => { rawText += value; send(value); };
    if (mode !== 'only') send(nativeText, true);
    text('<th'); text('ink>' + compatibility.slice(0, 10));
    if (mode === 'mirror') {
      await expect(reader.getByRole('region', { name: '供应商公开思考', exact: true })).toContainText(nativeText);
      await expect(compatibleRegion).toHaveCount(0);
    } else await expect(compatibleRegion).toContainText(compatibility.slice(0, 10));
    text(compatibility.slice(10));
    if (mode === 'mirror') await expect(compatibleRegion).toHaveCount(0);
    else {
      await expect(compatibleRegion).toContainText(compatibility);
      await expect(compatibleRegion).toContainText('响应文本开头的 <think>');
      await expect(reader).not.toContainText('正在等待模型内容');
    }
    await shot(page, info, `compat-${mode}-sources`);
    if (mode === 'all') {
      text('\n' + '兼容思考按实际片段增长。\n'.repeat(50));
      await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    }
    text('</th'); text('ink>');
    if (mode !== 'only') {
      text('<thi'); text('nking>' + planning); await expect(reader).toContainText(planning); text('</thinking>');
    }
    text('<正');
    await expect(reader.getByRole('region', { name: '生成中的公开思考', exact: true })).toBeVisible();
    text('文>');
    await expect(reader.getByRole('region', { name: '生成中的公开思考', exact: true })).toHaveCount(0);
    await expect(reader.getByTestId('stream-narrative')).toHaveText('');
    await shot(page, info, `compat-${mode}-body-boundary`);
    text('兼容切换后的小说正文。'); await expect(reader.getByTestId('stream-narrative')).toHaveText('兼容切换后的小说正文。');
    await expect(reader).not.toContainText(compatibility); await expect(reader).not.toContainText(planning); await expect(reader).not.toContainText(native);
    text('</正文>' + tail); finish();
    await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
    const saved = await stored(page); expect(saved.state).toEqual(before.state);
    expect(saved.draft?.story?.narrative).toBe('兼容切换后的小说正文。');
    expect(JSON.stringify(saved.draft?.story)).not.toContain(compatibility);
    expect(JSON.stringify(saved.draft?.story)).not.toContain(nativeText);
    expect(JSON.stringify(saved.draft?.story)).not.toContain(planning);
    await closeDiagnostics(page);
    const raw = await openStageRaw(page, 'story');
    await expectStoryRaw(raw, (mode === 'only' ? '' : nativeText) + rawText);
    await expect(raw.getByRole('region', { name: '兼容文本思考', exact: true })).toHaveCount(0);
    await expect(raw).not.toContainText(key);
    await shot(page, info, `compat-${mode}-raw`);
    expect(await stored(page)).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await openGameTools(page);
    await expect(await openStageRaw(page, 'story')).toContainText('没有可恢复的模型原文');
    expect(await stored(page)).toEqual(saved);
  });
}

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const scenario of ['结束前正文可读', '未完成工具仅脱敏观察', '工具完成后接管正式正文', '工具观察期间取消'] as const) test(`猫神流式 ${protocol} ${scenario}`, async ({ page }, info) => {
    const before = await seed(page, 120, protocol);
    await start(page);
    const event = (value: unknown) => response!.write('data: ' + JSON.stringify(value) + '\n\n');
    const first = '<正文>窗前的灯已经亮起。';
    const rest = '林舟心想：该回去了。</正文>' + tail;
    const complete = scenario === '工具完成后接管正式正文';
    const fragment = complete ? first : first + key;
    const args = JSON.stringify({ game_content: fragment }).slice(0, -2);
    const text = (s: string) => {
      if (protocol === 'gemini') event({ candidates: [{ content: { parts: [{ text: s }] } }] });
      else if (protocol === 'anthropic') event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: s } });
      else send(s);
    };
    if (protocol === 'anthropic') event({ type: 'message_start', message: { role: 'assistant', content: [] } });
    if (scenario !== '结束前正文可读') {
      const name = 'soliumbra_reply', id = 'stream-tool';
      if (protocol === 'anthropic') {
        event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name, id, input: {} } });
        event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } });
      } else if (protocol === 'gemini') {
        event({ candidates: [{ content: { parts: [{ functionCall: { id, name, args: { game_content: complete ? first + rest : fragment } } }] } }] });
      } else event({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] } }] });
      const observation = () => page.evaluate(async () => (await import('/src/services/ai/stageResponses.ts' as string)).stageResponses.getSnapshot()[0]);
      await expect.poll(async () => (await observation())?.displayText).toContain('窗前的灯已经亮起。');
      const mid = await observation();
      expect(mid.displayText).toContain('未完成的工具正文片段');
      expect(mid.displayText).not.toContain(key);
      expect(mid.text ?? '').toBe('');
      expect((await stored(page)).draft?.story).toBeUndefined();
      if (complete) {
        const suffix = JSON.stringify({ game_content: first + rest }).slice(args.length);
        if (protocol === 'anthropic') {
          event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: suffix } });
          event({ type: 'content_block_stop', index: 0 });
          event({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
          event({ type: 'message_stop' });
        } else if (protocol === 'gemini') {
          // Gemini sent the complete argument snapshot, but has not attested to a stop until now.
          event({ candidates: [{ finishReason: 'STOP' }] });
        } else {
          event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: suffix } }] } }] });
          event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        }
        response!.end();
        await expect.poll(async () => (await stored(page)).draft?.story?.narrative).toBe('窗前的灯已经亮起。林舟心想：该回去了。');
        expect((await observation()).displayText).not.toContain('未完成的工具正文片段');
        expect((await stored(page)).state).toEqual(before.state);
        return;
      }
      if (scenario === '工具观察期间取消') {
        if ((page.viewportSize()?.width ?? 0) <= 900) await openTurnTools(page);
        await page.getByRole('button', { name: '取消生成', exact: true }).click();
        await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toHaveCount(0);
        expect(await stored(page)).toEqual(before);
        return;
      }
      // EOF without a successful tool terminator.
      response!.end();
      await expect.poll(async () => (await observation()).status).toBe('failed');
      await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('failed');
      const failed = await stored(page);
      expect(failed.draft?.storyPartial).toBeUndefined();
      expect(failed.draft?.story).toBeUndefined();
      expect(failed.state).toEqual(before.state);
    } else {
      if (protocol === 'anthropic') event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      text(first);
      const reader = page.getByTestId('stream-narrative');
      await expect(reader).toHaveText('窗前的灯已经亮起。');
      if (protocol === 'openai') await shot(page, info, '猫神结束前的阅读界面');
      expect((await stored(page)).draft?.story).toBeUndefined();
      text(rest);
      if (protocol === 'anthropic') {
        event({ type: 'content_block_stop', index: 0 });
        event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
        event({ type: 'message_stop' });
      } else if (protocol === 'gemini') event({ candidates: [{ finishReason: 'STOP' }] });
      else event({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      response!.end();
      await expect.poll(async () => (await stored(page)).draft?.story?.narrative).toBe('窗前的灯已经亮起。林舟心想：该回去了。');
      expect((await stored(page)).state).toEqual(before.state);
    }
  });
}
