import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

const presetId = 'fixture-script-errors';
const privateText = 'fixture-key-and-private-story';
const narrative = '林舟听见电车经过石桥，转身沿街走去。';
const readyScript = `
  await new Promise(resolve => setTimeout(resolve, 10));
  $(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    parent.document.body.dataset.scriptReady = 'yes';
  });
`;
type FixtureScript = { id: string; name: string; content: string; module: boolean };

async function openPreset(page: Page, scripts: FixtureScript[], resourceFailure = false) {
  const preset = { prompts: [{ identifier: 'chatHistory', marker: true }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }],
    extensions: { tavern_helper: { scripts: scripts.map(script => ({ type: 'script', enabled: true, ...script })) } } };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/peinture-manifest.json'))
      return route.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify({ id: presetId, title: '异常测试', version: 'test', lockedOff: [] }) });
    if (url.pathname.endsWith('/peinture-1118.json') && url.search.includes('raw'))
      return route.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify(JSON.stringify(preset)) });
    if (url.pathname === '/fixture-script-unavailable.js') return route.abort();
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'blob:' ? route.continue() : route.abort();
  });
  await page.addInitScript(({ id, resourceFailure }) => {
    localStorage.setItem('heijin.story-presets.v1', JSON.stringify({ enabled: true, selected: id, packages: {} }));
    if (resourceFailure) URL.createObjectURL = () => new URL('/fixture-script-unavailable.js', location.href).href;
  }, { id: presetId, resourceFailure });
  await page.goto('/');
}

async function generate(page: Page, testHook = false) {
  return page.evaluate(async ({ narrative, privateText, testHook }) => {
    const paths = ['/src/workflows/storyStage.ts', '/src/services/storage/saveRepository.ts', '/src/domain/drafts.ts',
      '/src/tests/fixtures/game.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts',
      '/src/services/ai/client.ts', '/src/presets/tavern/hostState.ts'];
    const [{ StoryStage }, { SaveRepository }, { createTurnDraft }, { game }, { defaultSettings }, { newChannel, defaultAiConfig },
      { CredentialVault }, { AiClient }, { assistantView }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    const vault = new CredentialVault(sessionStorage, localStorage), config = defaultAiConfig(), channel = newChannel('openai');
    channel.baseUrl = 'https://script-errors.mock.invalid/v1'; channel.defaultModel = 'fixture';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    vault.set(channel.id, privateText);
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false; settings.runtime.streamStory = false;
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      if (document.body.dataset.scriptReady !== 'yes') throw new Error('传输早于脚本初始化');
      const content = '<正文>' + narrative + '</正文><短期记忆>沿街走去。</短期记忆>';
      return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    };
    const stage = new StoryStage(repo, new AiClient(transport));
    try {
      const state = await repo.create(game('script-errors'));
      const draft = createTurnDraft(state.saveId, state.revision, 'fixture-turn', 'opening', '');
      await repo.saveDraft(draft, null);
      const attempt = async () => {
        const current = await repo.loadDraft(state.saveId);
        return stage.generate({ draft: current, config, vault, settings }).then(() => '已保存', (error: { details?: { fieldPath?: string }; code?: string }) => {
          if (!error.code) throw error;
          return error.details?.fieldPath ?? error.code;
        });
      };
      const first = await attempt();
      const saved = await repo.loadDraft(state.saveId);
      const diagnostics = () => structuredClone(assistantView.snapshot());
      if (!testHook) return { first, calls, story: saved.story?.narrative, rows: diagnostics() };
      document.body.dataset.failScriptHook = 'yes';
      const failed = await attempt();
      const failureRows = diagnostics();
      const unchanged = JSON.stringify(saved) === JSON.stringify(await repo.loadDraft(state.saveId));
      const callsAfterFailure = calls;
      const retry = await attempt();
      return { first, failed, failureRows, unchanged, callsAfterFailure, retry, calls,
        story: (await repo.loadDraft(state.saveId)).story?.narrative,
        stateUnchanged: JSON.stringify(await repo.load(state.saveId)) === JSON.stringify(state),
        rows: diagnostics() };
    } finally { stage.dispose(); repo.close(); }
  }, { narrative, privateText, testHook });
}

test('iframe 初始化后捕获异常与 Promise rejection，正文可继续生成', async ({ page }) => {
  await openPreset(page, [{ id: 'a-runtime', name: '运行脚本', module: true, content: readyScript + `
    appendInexistentScriptButtons([{ name: '触发错误', visible: true }, { name: '触发拒绝', visible: true }]);
    eventOn(getButtonEvent('触发错误'), () => setTimeout(() => { throw new TypeError(${JSON.stringify(privateText)}); }, 0));
    eventOn(getButtonEvent('触发拒绝'), () => { void Promise.reject(new RangeError(${JSON.stringify(privateText)})); });
    eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, async () => {
      if (parent.document.body.dataset.failScriptHook !== 'yes') return;
      delete parent.document.body.dataset.failScriptHook;
      await Promise.resolve();
      throw new ReferenceError(${JSON.stringify(privateText)});
    });
  ` }, { id: 'b-healthy', name: '正常脚本', module: false, content: '$(async () => { await Promise.resolve(); });' }]);

  const after = await page.evaluate(async () => {
    const path = '/src/presets/tavern/hostState.ts';
    const { assistantView, pressScriptButton, startAssistant } = await import(path);
    await startAssistant();
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-tavern-script="a-runtime"]')!.contentWindow!;
    const observed: unknown[] = [];
    for (const [button, event] of [['触发错误', 'error'], ['触发拒绝', 'unhandledrejection']]) {
      const seen = new Promise(resolve => frame.addEventListener(event, resolve, { once: true }));
      await pressScriptButton('a-runtime', button);
      await seen;
      observed.push(structuredClone(assistantView.snapshot()));
    }
    return observed;
  });
  const result = await generate(page, true);
  expect(result.first).toBe('已保存');
  expect(after[0]).toEqual([expect.objectContaining({ id: 'a-runtime', status: '已初始化', error: expect.stringMatching(/运行脚本.*运行时异常.*TypeError.*位置 \d+:\d+/u) }),
    expect.objectContaining({ id: 'b-healthy', status: '已初始化' })]);
  expect(after[1]).toEqual([expect.objectContaining({ id: 'a-runtime', status: '已初始化', error: expect.stringMatching(/运行时异常.*RangeError/u) }),
    expect.objectContaining({ id: 'b-healthy', status: '已初始化' })]);
  expect(JSON.stringify(after)).not.toContain(privateText);

  expect(result).toMatchObject({ first: '已保存', failed: 'tavern.chat_completion_settings_ready', unchanged: true,
    callsAfterFailure: 1, retry: '已保存', calls: 2, story: narrative, stateUnchanged: true });
  expect(result.failureRows).toEqual([expect.objectContaining({ id: 'a-runtime', status: '已初始化',
    error: expect.stringMatching(/运行时异常.*chat_completion_settings_ready.*ReferenceError/u) }),
    expect.objectContaining({ id: 'b-healthy', status: '已初始化' })]);
  expect(result.failureRows?.[1]).not.toHaveProperty('error');
  expect(JSON.stringify(result)).not.toContain(privateText);

  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const back = dialog.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name: '运行', exact: true }).click();
  await dialog.getByText('运行脚本 · 已初始化', { exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'chat_completion_settings_ready' })).toBeVisible();
});

for (const [source, content, module] of [
  ['模块求值', `throw new TypeError(${JSON.stringify(privateText)});`, true],
  ['顶层 await', `await Promise.reject(new RangeError(${JSON.stringify(privateText)}));`, true],
  ['jQuery ready', `$(async () => { await Promise.resolve(); throw new ReferenceError(${JSON.stringify(privateText)}); });`, true],
  ['初始化未处理拒绝', `$(() => new Promise(() => {})); setTimeout(() => { void Promise.reject(new RangeError(${JSON.stringify(privateText)})); }, 30);`, true],
  ['资源加载', '', false],
] as const) {
  test(source + '失败时阻断 Story', async ({ page }) => {
    await openPreset(page, [{ id: 'broken-script', name: '故障脚本', content, module }], source === '资源加载');
    const result = await generate(page);
    expect(result).toMatchObject({ first: 'tavern.initialization', calls: 0 });
    expect(result.story).toBeUndefined();
    expect(result.rows).toEqual([expect.objectContaining({ id: 'broken-script', status: '出错',
      error: expect.stringMatching(/故障脚本.*初始化失败/u) })]);
    expect(JSON.stringify(result)).not.toContain(privateText);
  });
}
