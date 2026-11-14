import { test, expect } from './helpers/test';
import { inlineRecoveryNarrative } from '../src/tests/fixtures/storyRecovery';

test('三阶段真实出站提醒可在正式React检查器读取，原生请求体与独立上下文完整且不写存档', async ({ page }, info) => {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  await page.route('https://**', route => route.abort());
  await page.route('**/mock-ai/**', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const tail = body.messages.at(-1).content;
    const content = tail.includes('<短期记忆>')
      ? `<正文>${inlineRecoveryNarrative}</正文><短期记忆>主角核对笔记。</短期记忆><变量规划>[]</变量规划><行动选项>继续核对\n看看周围\n留在原处</行动选项>`
      : tail.includes('<命令>') ? '<thinking>确认没有新增变化。</thinking><说明></说明><命令></命令>'
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/tests/fixtures/game.ts', '/src/services/storage/saveRepository.ts', '/src/domain/drafts.ts'];
    const [{ game }, { SaveRepository }, { createTurnDraft }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try { const state = await repo.create(game('format-tail-ui')); await repo.saveDraft(createTurnDraft(state.saveId, 0, 'format-ui-turn', 'opening', ''), null); }
    finally { repo.close(); }
  });
  await page.goto('/#game/format-tail-ui'); await expect(page.locator('.game-layout')).toBeVisible();
  const stateUnchanged = await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/services/ai/runtime.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/ui/settings/model.ts','/src/domain/drafts.ts'];
    const [{ SaveRepository }, { runStageRequest }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }, { defaultSettings }, { rerollStory }] = await Promise.all(paths.map(path => import(path)));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = `${location.origin}/mock-ai/v1`; channel.defaultModel = 'mock-format-tail';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' }; saveAiConfig(localStorage, config);
    const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fictional-wire-ui-key');
    const repo = await SaveRepository.open();
    try {
      const before = await repo.loadGame('format-tail-ui'), settings = defaultSettings();
      const input = { state: before.state, draft: before.draft, settings, mode: 'opening', userInput: '' };
      const story = await runStageRequest({ ...input, stage: 'story' }, config, vault, { stream: false });
      input.draft = rerollStory(before.draft, story.result);
      await runStageRequest({ ...input, stage: 'variables' }, config, vault, { stream: false });
      await runStageRequest({ ...input, stage: 'world' }, config, vault, { stream: false });
      return JSON.stringify(await repo.loadGame('format-tail-ui')) === JSON.stringify(before);
    } finally { repo.close(); }
  });
  expect(stateUnchanged).toBe(true); expect(requests).toHaveLength(3);
  for (const body of requests) {
    expect(body.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('【最终格式提醒】') });
    const context = body.messages.filter(message => /^<GAME_CONTEXT>\n[\s\S]*\n<\/GAME_CONTEXT>$/.test(message.content));
    expect(context).toHaveLength(1); expect(context[0].content).not.toContain('【最终格式提醒】');
    expect(JSON.stringify(body)).not.toContain('fictional-wire-ui-key');
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await page.getByRole('button', { name: '高级', exact: true }).click();
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('opening');
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  for (const [index, stage] of ['story', 'variables', 'world'].entries()) {
    await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption(stage);
    await page.getByRole('button', { name: '主动查看完整内部上下文', exact: true }).click();
    await page.getByRole('combobox', { name: '内部内容视图', exact: true }).selectOption('body');
    const raw = page.getByLabel('完整内部上下文', { exact: true });
    const shown = JSON.parse(await raw.innerText()); expect(shown).toEqual(requests[index]);
    await raw.evaluate(el => { el.scrollTop = el.scrollHeight; }); await raw.scrollIntoViewIfNeeded();
    await info.attach(`${info.project.name}-${stage}-wire-tail`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});
