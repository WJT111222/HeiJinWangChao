import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// 正文阶段报错后：原行动回到输入框，玩家可原样或修改后直接重新发送，不用重新打字。
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map((path) => import(path)));
    const repo = await SaveRepository.open(), state = worldState();
    state.openingCityId = 'chongqing'; state.title = '沈砚 · 重庆'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://story-failure.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-key');
    const draft = await completeDraft(repo);
    await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true });
    repo.close();
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
// 手机端正文失败会自动弹出诊断面板；玩家关掉后回到输入栏。
async function closeDiagnostics(page: Page) {
  const sheet = page.locator('dialog.mobile-diagnostics-sheet[open]');
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await expect(sheet).toBeHidden(); }
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}

test('正文失败后原行动回到输入框，可修改后直接重新发送；清空后不再自动回填', async ({ page }) => {
  await seed(page);
  const before = await stored(page);
  let calls = 0;
  await page.route('https://story-failure.mock.invalid/**', async (route) => { calls++; await route.fulfill({ status: 401, body: 'mock' }); });
  const input = page.locator('#player-input'), send = page.getByRole('button', { name: '发送', exact: true });

  await input.fill('去码头找老周');
  await send.click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByText('正文生成失败').first()).toBeVisible();
  await closeDiagnostics(page);
  await expect(input).toHaveValue('去码头找老周');
  await expect(send).toBeEnabled();
  const failed = await stored(page);
  expect(failed.draft).toMatchObject({ userInput: '去码头找老周', stageStatus: { story: 'failed' } });
  expect(failed.state).toEqual(before.state);

  // 修改后直接重新发送：重新绑定为新草稿并再次请求正文。
  await input.fill('改去菜市场找老周');
  await send.click();
  await expect.poll(() => calls).toBe(2);
  await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('failed');
  await closeDiagnostics(page);
  await expect(input).toHaveValue('改去菜市场找老周');
  const again = await stored(page);
  expect(again.draft?.userInput).toBe('改去菜市场找老周');
  expect(again.draft?.failures).toHaveLength(1);
  expect(again.state).toEqual(before.state);

  // 玩家主动清空后，同一失败草稿不再自动回填。
  await input.fill('');
  await page.waitForTimeout(300);
  await expect(input).toHaveValue('');
  await expect(send).toBeDisabled();
  expect(calls).toBe(2);
});
