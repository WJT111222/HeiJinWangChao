import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export const cities = ['chongqing', 'shanghai', 'harbin', 'guangzhou'] as const;
export type Appearance = 'day' | 'night' | 'system';
export type WorkflowMode = 'pending' | 'running' | 'failed' | 'complete';
export async function seedDayReading(page: Page, city: string, appearance: Appearance = 'day', mode: WorkflowMode = 'complete', mockBase = 'http://127.0.0.1:19997/v1') {
  await page.goto('/');
  await page.evaluate(async ({ city, appearance, mode, mockBase }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/domain/drafts.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft, elapsedVariables }, { defaultSettings, settingsKey }, { createTurnDraft }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const settings = defaultSettings(); settings.display.appearance = appearance;
    settings.prompts.minNarrativeChars = 5;
    for (const config of Object.values(settings.memory.summaries) as { automatic: boolean }[]) config.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const state = worldState(); state.openingCityId = city; state.protagonist.name = '沈砚'; state.weatherText = '晴朗';
    const repo = await SaveRepository.open(); await repo.create(state);
    const narrative = '【旁白】晨光照在街道上，远处传来城市苏醒的声音。\n【沈砚】今天先看看街坊们有什么消息。\n【现场人物】前面就是车站，我们可以过去问问。\n【旁白】两人沿着路边慢慢前行，留意沿途的变化。';
    const actionOptions = ['去车站询问消息', '和街坊聊聊', '查看身边的物品'];
    const opening = await completeDraft(repo, { narrative, actionOptions });
    await repo.commitTurn({ draft: opening, nextAction: mode === 'complete' ? '' : '继续观察街道', useVariableStage: true, useWorldStage: true });
    if (mode === 'complete') {
      const variables = await elapsedVariables(repo, '两人沿着路边慢慢前行', 300);
      const second = await completeDraft(repo, { narrative, actionOptions, variables, world: { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] } });
      await repo.commitTurn({ draft: second, nextAction: '', useVariableStage: true, useWorldStage: true });
    } else {
      // No preselected prose: the real callback starts a single Mock Story request.
      const current = await repo.load('save-a'), existing = await repo.loadDraft('save-a');
      if (!existing) await repo.saveDraft(createTurnDraft('save-a', current.revision, 'readability-next', 'regular', ''), null);
    }
    repo.close();
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = mockBase;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock-readability' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-readability-only');
  }, { city, appearance, mode, mockBase });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
export async function setAppearance(page: Page, appearance: Appearance) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '外观', exact: true }).click();
  await settings.getByRole('radio', { name: new RegExp({ day: '日间', night: '夜间', system: '跟随系统' }[appearance]) }).check();
  await page.keyboard.press('Escape');
}
export async function repositoryValue(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}
