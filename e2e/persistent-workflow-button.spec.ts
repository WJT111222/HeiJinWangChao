import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// 输入栏常驻多功能按钮：运行中=取消生成；某环节停下=继续当前环节；整回合完成后留在原位不可点。
type Mode = 'settled' | 'storyFailed' | 'variablesPending';
async function seed(page: Page, mode: Mode) {
  await page.goto('/');
  await page.evaluate(async (mode) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/domain/drafts.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { TurnDraftSchema }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map((p) => import(p)));
    const repo = await SaveRepository.open(), state = worldState(); state.openingCityId = 'chongqing'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.runtime.useEntityStage = false; settings.prompts.minNarrativeChars = 5; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://persistent-button.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-key');
    const draft = await completeDraft(repo);
    const done = await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true });
    if (mode !== 'settled') {
      const bound = await repo.bindTurnAction(done.draft, '去码头找老周', true, true);
      const next = mode === 'storyFailed'
        ? { ...bound, stageStatus: { ...bound.stageStatus, story: 'failed' }, failures: [{ stage: 'story', attempt: 1, storyRevision: 0, errorCode: 'authorization', retryable: false }] }
        : { ...bound, story: { ...draft.story, turnKind: 'regular' }, storyRevision: 1, stageStatus: { ...bound.stageStatus, story: 'ready' } };
      await repo.saveDraft(TurnDraftSchema.parse({ ...next, draftRevision: bound.draftRevision + 1 }), bound.draftRevision);
    }
    repo.close();
  }, mode);
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}
async function closeDiagnostics(page: Page) {
  const sheet = page.locator('dialog.mobile-diagnostics-sheet[open]');
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await expect(sheet).toBeHidden(); }
}
const action = (page: Page) => page.locator('.composer-workflow-action');
const named = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('整回合已完成：按钮常驻原位但不可点，手机端不再折叠进「回合操作」', async ({ page }) => {
  await seed(page, 'settled');
  await expect(named(page, '本回合已完成')).toBeVisible();
  await expect(named(page, '本回合已完成')).toBeDisabled();
  await expect(page.getByRole('button', { name: '回合操作', exact: true })).toHaveCount(0);
  await expect(page.locator('.composer-workflow-action[data-kind=idle]')).toHaveCount(1);
});

test('某环节停下后按钮变为继续当前环节；运行中变为取消生成，取消后回到继续', async ({ page }) => {
  await seed(page, 'variablesPending');
  let calls = 0;
  await page.route('https://persistent-button.mock.invalid/**', () => { calls++; });
  const before = await stored(page);
  await expect(named(page, '继续生成主角与现场')).toBeEnabled();
  await named(page, '继续生成主角与现场').click();
  await expect.poll(() => calls).toBe(1);
  await expect(named(page, '取消生成')).toBeEnabled();
  await expect(action(page)).toHaveAttribute('data-kind', 'cancel');
  await named(page, '取消生成').click();
  await expect(named(page, '继续生成主角与现场')).toBeEnabled();
  const after = await stored(page);
  expect(after.state).toEqual(before.state);
  expect(after.draft?.story).toEqual(before.draft?.story);
  expect(after.draft?.stageStatus.story).toBe('ready');
  expect(calls).toBe(1);
});

test('正文失败后按钮用已绑定的行动重试正文；再失败时回填文字仍在，成功后未改动的回填文字才清空', async ({ page }) => {
  await seed(page, 'storyFailed');
  await closeDiagnostics(page);
  let calls = 0;
  await page.route('https://persistent-button.mock.invalid/**', async (route) => { calls++; await route.fulfill({ status: 401, body: 'mock' }); });
  const input = page.locator('#player-input');
  await expect(input).toHaveValue('去码头找老周');
  await expect(named(page, '生成本回合正文')).toBeEnabled();
  await named(page, '生成本回合正文').click();
  await expect.poll(() => calls).toBe(1);
  await expect(named(page, '生成本回合正文')).toBeEnabled();
  await closeDiagnostics(page);
  // 再次失败：文字不丢，仍可重试。
  await expect(input).toHaveValue('去码头找老周');
  const after = await stored(page);
  expect(after.draft?.userInput).toBe('去码头找老周');
  expect(after.draft?.stageStatus.story).toBe('failed');
  expect(after.draft?.story).toBeUndefined();
});

const storyOk = '<thinking>提纲</thinking><正文>【旁白】你沿着江边走到码头，老周正在收网。</正文><短期记忆>码头找老周</短期记忆><变量规划>[]</变量规划><行动选项>上前搭话\n在旁观察\n转身离开</行动选项>';
async function storySucceeds(page: Page) {
  let calls = 0;
  await page.route('https://persistent-button.mock.invalid/**', async (route) => {
    calls++;
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: storyOk } }] })}\n\ndata: [DONE]\n\n` });
  });
  return () => calls;
}
for (const edited of [false, true]) test(`正文重试成功后：${edited ? '玩家改过的文字保留' : '未改动的回填文字自动清空'}`, async ({ page }) => {
  await seed(page, 'storyFailed');
  await closeDiagnostics(page);
  const calls = await storySucceeds(page);
  const input = page.locator('#player-input');
  await expect(input).toHaveValue('去码头找老周');
  if (edited) await input.fill('改成去菜市场');
  await named(page, '生成本回合正文').click();
  await expect.poll(() => calls()).toBe(1);
  await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('ready');
  const after = await stored(page);
  expect(after.draft?.userInput).toBe('去码头找老周');
  await expect(input).toHaveValue(edited ? '改成去菜市场' : '');
  await expect(named(page, '继续生成主角与现场')).toBeEnabled();
});
