import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflowDiagnostics } from './helpers/gameLayout';

test.describe.configure({ timeout: 60_000 });
const leak = 'sk-live-SECRET-KEY https://evil.example/raw 供应商长错误说明';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map((p) => import(p)));
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    settings.runtime.failureAutoRetry = false;
    for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[]) summary.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel();
    const config = defaultAiConfig();
    channel.baseUrl = 'https://diag-ui.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story-model' };
    for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-not-a-real-key');
    const repo = await SaveRepository.open();
    try {
      const state = worldState();
      state.protagonist.name = '诊断验收';
      await repo.create(state);
      await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
    } finally { repo.close(); }
  });
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
}

test('桌面和手机：HTTP 200 的上游错误对象显示中文摘要，不显示供应商原文', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await seed(page);
  await page.route('https://diag-ui.mock.invalid/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'rate_limit_exceeded', message: leak } }),
    });
  });
  await page.locator('#player-input').fill('到街边观察');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const log = mobile ? page.locator('dialog.mobile-diagnostics-sheet[open]') : page.locator('.workflow-diagnostics');
  if (!mobile) await openWorkflowDiagnostics(page);
  else await expect(page.locator('dialog.mobile-diagnostics-sheet[open]')).toBeVisible();
  await expect(log.getByTestId('runtime-log')).toContainText('rejected');
  await expect(log).toContainText('服务拒绝了请求');
  await expect(log).toContainText('临时限流');
  await expect(log).toContainText('HTTP 200');
  await expect(log).toContainText('HTTP 成功响应里带有错误对象');
  await expect(log).not.toContainText('sk-live-SECRET-KEY');
  await expect(log).not.toContainText('evil.example');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as typeof window & { diagnosticCopy?: string }).diagnosticCopy = text; } } }));
  await log.getByRole('button', { name: '复制此条', exact: true }).click();
  const copied = await page.evaluate(() => (window as typeof window & { diagnosticCopy?: string }).diagnosticCopy ?? '');
  expect(copied).toContain('rate_limit');
  expect(copied).toContain('"code": "rejected"');
  expect(copied).not.toContain('sk-live-SECRET-KEY');
  expect(copied).not.toContain('evil.example');
  await page.screenshot({ path: `test-results/error-diagnostics-${info.project.name}.png`, fullPage: true });
});
