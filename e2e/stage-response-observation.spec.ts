import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflowStage, openStageRaw, workflowTrigger } from './helpers/gameLayout';

const key = 'mock-browser-observation-credential';
const thought = '只在主动查看时可见的公开思考。\n'.repeat(120);
async function stored(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function seed(page: Page, stage: 'variables' | 'world') {
  await page.goto('/');
  await page.evaluate(async ({ stage, key }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/ui/settings/model.ts',
      '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { worldState, worldDraft }, { defaultSettings, settingsKey }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }, { createTurnDraft }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open(); await repo.create(worldState());
    await repo.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'regular', ''), null);
    await repo.saveDraft(worldDraft(false), 0);
    if (stage === 'world') await repo.saveDraft({ ...worldDraft(true), draftRevision: 2 }, 1);
    repo.close();
    const settings = defaultSettings(); localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel('deepseek'), config = defaultAiConfig(); channel.baseUrl = 'http://127.0.0.1:19991/v1'; channel.defaultModel = 'mock-observation';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, key);
  }, { stage, key });
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
  return stored(page);
}
async function closeDiagnostics(page: Page) {
  const dialog = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
  if (await dialog.isVisible()) await page.keyboard.press('Escape');
}
async function closeWorkflow(page: Page) {
  const close = page.getByRole('button', { name: '收起三阶段详情', exact: true });
  if (await close.isVisible()) await close.click(); else await workflowTrigger(page).click();
}
for (const stage of ['variables', 'world'] as const) {
  test(`${stage}: reasoning-only failure is private until opened, copy/scroll/close/retry/reload preserve storage`, async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('https://**', route => route.abort());
    let calls = 0;
    await page.route('http://127.0.0.1:19991/**', async route => {
      calls++; expect(route.request().postDataJSON().stream).not.toBe(true);
      await route.fulfill({ json: { choices: [{ message: { content: null, reasoning_content: (calls === 1 ? thought : '第二次独立公开思考') + key }, finish_reason: 'stop' }] } });
    });
    const before = await seed(page, stage);
    await openWorkflowStage(page, stage);
    const label = stage === 'variables' ? '变量' : '世界', rawLabel = stage === 'variables' ? '变量' : '动态世界';
    await page.getByRole('button', { name: `生成${label}候选`, exact: true }).click();
    await expect.poll(async () => (await stored(page)).draft?.failures.length).toBeGreaterThan(0);
    expect(calls).toBe(1);
    expect(await page.locator('body').textContent()).not.toContain('只在主动查看');
    await expect(page.locator('textarea.story-raw-text')).toHaveCount(0);
    const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft?.[stage]).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain('公开思考');
    await closeDiagnostics(page);
    const panel = await openStageRaw(page, stage);
    await expect(panel).toContainText('供应商未返回可展示的正文；已收到公开思考。');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await panel.getByLabel(`${rawLabel}原文内容`, { exact: true }).selectOption('reasoning');
    const box = panel.getByRole('textbox', { name: `${rawLabel}公开思考原文`, exact: true });
    await expect(box).toHaveAttribute('readonly', ''); await expect(box).toContainText('只在主动查看');
    const value = await box.inputValue(); expect(value).not.toContain(key); expect(value).toContain('隐藏');
    await box.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    await page.keyboard.press('x'); await expect(box).toHaveValue(value);
    expect(await box.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await box.evaluate(el => { el.scrollTop = el.scrollHeight; }); expect(await box.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await stored(page)).toEqual(failed);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await box.evaluate(el => { const input = el as HTMLTextAreaElement; input.setSelectionRange(0, 0); input.blur(); });
    await page.screenshot({ path: info.outputPath(`${stage}-public-reasoning.png`) });
    await panel.getByLabel(`${rawLabel}原文内容`, { exact: true }).selectOption('diagnostics');
    await expect(panel.getByRole('textbox')).toContainText('"null"'); await expect(panel.getByRole('textbox')).toContainText('"stop"');
    expect(await panel.getByRole('textbox').evaluate(el => el.scrollTop)).toBe(0);
    await page.screenshot({ path: info.outputPath(`${stage}-diagnostics.png`) });
    await closeWorkflow(page); await expect(page.locator('textarea.story-raw-text')).toHaveCount(0);
    await openWorkflowStage(page, stage); await page.getByRole('button', { name: `生成${label}候选`, exact: true }).click();
    await expect.poll(() => calls).toBe(2); await expect.poll(async () => (await stored(page)).draft?.failures.length).toBe(2);
    await closeDiagnostics(page); const retried = await openStageRaw(page, stage);
    await retried.getByLabel(`${rawLabel}原文内容`, { exact: true }).selectOption('reasoning');
    await expect(retried.getByRole('textbox')).toContainText('第二次独立公开思考'); await expect(retried.getByRole('textbox')).not.toContainText('只在主动查看');
    const after = await stored(page); expect(after.state).toEqual(before.state);
    await page.reload(); const cleared = await openStageRaw(page, stage);
    await expect(cleared).toContainText('没有可恢复的模型原文'); expect(await stored(page)).toEqual(after); expect(calls).toBe(2);
  });
}
