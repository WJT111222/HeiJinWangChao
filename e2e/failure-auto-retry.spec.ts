import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { variableReply } from '../src/tests/fixtures/variableReply';

test.describe.configure({ timeout: 60_000 });

async function openRuntime(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '超时与重试', exact: true }).click();
  return dialog;
}

async function seed(page: Page) {
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map((p) => import(p)));
    const settings = defaultSettings();
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null') as { runtime?: object } | null;
    settings.runtime = { ...settings.runtime, ...saved?.runtime, useEntityStage:false };
    settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[]) summary.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig();
    channel.baseUrl = 'https://retry-ui.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-not-a-real-key');
    const repo = await SaveRepository.open();
    try {
      const state = worldState();
      state.protagonist.name = '重试验收';
      await repo.create(state);
      await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
    } finally { repo.close(); }
  });
}

async function server(page: Page) {
  const calls: string[] = [];
  await page.route('https://retry-ui.mock.invalid/**', async (route) => {
    const request = route.request().postDataJSON() as { model: string; messages: { content: string }[] };
    const stage = request.model;
    calls.push(stage);
    if (stage === 'story' && calls.filter((item) => item === 'story').length === 1) {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'unavailable' });
      return;
    }
    const content = request.messages.map((message) => message.content).join('\n');
    const match = content.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
    if (!match) throw new Error('Missing composed context');
    const ctx = JSON.parse(match[1]) as { SAVE_STATE: { worldClock: string } };
    const text = stage === 'story'
      ? '<thinking>提纲</thinking><正文>经过一分钟，主角在街边把事情看完。</正文><短期记忆>主角观察街道。</短期记忆><变量规划>[]</变量规划>'
      : stage === 'variables'
        ? variableReply({ commands: [{ type: 'SetWorldClock', commandId: 'clock', worldClock: new Date(Date.parse(ctx.SAVE_STATE.worldClock) + 60_000).toISOString(), evidence: '经过一分钟' }], rejectedSuggestions: [], unresolved: [] })
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({
      contentType: stage === 'story' ? 'text/event-stream' : 'application/json',
      body: stage === 'story'
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
    });
  });
  return calls;
}

test('桌面和手机：运行设置默认关闭，开启后直连失败会显示自动重试并只多请求失败阶段', async ({ page }, info) => {
  const dialog = await openRuntime(page);
  const toggle = dialog.getByRole('checkbox', { name: '失败自动重试', exact: true });
  const limit = dialog.getByRole('group',{name:'最大自动重试次数'});
  const three = limit.getByRole('button',{name:'3 次'});
  await expect(toggle).not.toBeChecked();
  await expect(three).toBeDisabled(); await expect(limit.getByRole('button',{name:'1 次'})).toBeDisabled();
  await expect(limit.getByRole('button')).toHaveText(['1 次', '3 次']);
  await expect(dialog).toContainText('真正走了本站中转仍失败的不会自动再试');
  await expect(dialog).toContainText('权限与保存失败不会自动重试');
  await page.screenshot({ path: info.outputPath(`settings-off-${info.project.name}.png`), fullPage: true });
  await toggle.check();
  await expect(three).toBeEnabled();
  await expect(three).toHaveAttribute('aria-pressed','true');
  await limit.getByRole('button',{name:'1 次'}).click();
  await three.click();
  await dialog.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: '本地偏好已保存' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`settings-on-${info.project.name}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '关闭资料界面', exact: true }).click();
  await expect(dialog).toBeHidden();

  await seed(page);
  const calls = await server(page);
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  await page.locator('#player-input').fill('到街边把事情看完');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const status = page.locator('.retry-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('正文');
  await expect(status).toContainText('第 1/3 次自动重试');
  await expect(status).toContainText('上次失败');
  await expect(status).toContainText(/秒后重试|即将重试/);
  await expect(status.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  if (info.project.name === 'mobile') await expect(page.locator('dialog.mobile-diagnostics-sheet[open]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`retry-${info.project.name}.png`), fullPage: true });
  await expect.poll(async () => page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return (await repo.load('save-a')).turnNumber; } finally { repo.close(); }
  }), { timeout: 20_000 }).toBe(2);
  expect(calls).toEqual(['story', 'story', 'variables', 'world']);
  expect(calls.filter((stage) => stage === 'story')).toHaveLength(2);
});
