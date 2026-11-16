import { test, expect } from './helpers/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { setup, transport, plan, send, data, calls, closeError } from './helpers/actionRecovery';
import { openWorkflow, openWorkflowStage } from './helpers/gameLayout';
import { settingsTextContrast } from './helpers/settingsContrast';
import { writeFile } from 'node:fs/promises';

test.setTimeout(60_000);
async function seedWorkflow(page: Page, ready: boolean) {
  await setup(page);
  await page.evaluate(async ready => {
    const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!);
    settings.display.appearance = 'day'; localStorage.setItem('heijin.settings.v1', JSON.stringify(settings));
    if (!ready) return;
    const p = '/src/services/storage/saveRepository.ts', t = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(p), { completeDraft } = await import(t), repo = await SaveRepository.open();
    try {
      const state = await repo.load('save-a'), draft = await repo.loadDraft('save-a');
      await repo.bindTurnAction(draft, '观察站台', true, true);
      await completeDraft(repo, { variables: { commands: [{ type: 'SetWorldClock', commandId: 'contrast-clock', evidence: '经过一分钟', worldClock: new Date(Date.parse(state.worldClock) + 60000).toISOString() }], rejectedSuggestions: [], unresolved: [] } });
    } finally { repo.close(); }
  }, ready);
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); await transport(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
}
async function measure(root: Locator, text: string) {
  const result = await settingsTextContrast(root);
  const row = result.rows.find(row => row.text.includes(text));
  expect(row, `missing measured text: ${text}`).toBeDefined();
  return row!;
}
async function evidence(page: Page, info: TestInfo, name: string, values: unknown) {
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(values, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

// Each project checks the corresponding regression; no project skips or new AI requests.
test('日间工作流关键文字至少4.5:1，夜间恢复且原回调保持有效', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mobile = info.project.name === 'mobile';
  await seedWorkflow(page, mobile);
  if (mobile) {
    await openWorkflow(page);
    const button = page.locator('.workflow-primary .primary');
    await expect(button).toBeEnabled();
    const before = await data(page), normal = await measure(button.locator('..'), '完成本回合结算');
    await evidence(page, info, 'mobile-day-primary', normal);
    expect.soft(normal.ratio).toBeGreaterThanOrEqual(4.5);
    await button.hover();
    const hover = await measure(button.locator('..'), '完成本回合结算');
    expect.soft(hover.ratio).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0); await button.focus();
    const focus = await measure(button.locator('..'), '完成本回合结算');
    expect.soft(focus.ratio).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => { document.documentElement.dataset.appearance = 'night'; });
    const night = await measure(button.locator('..'), '完成本回合结算');
    await evidence(page, info, 'mobile-night-primary', night);
    expect(night.ratio).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => { document.documentElement.dataset.appearance = 'day'; });
    expect(await data(page)).toEqual(before); expect(await calls(page)).toHaveLength(0);
    await button.click();
    await expect.poll(async () => (await data(page)).state.turnNumber).toBe(2);
    expect((await data(page)).state.journal).toHaveLength(2); expect(await calls(page)).toHaveLength(0);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await writeFile(info.outputPath('mobile-primary-states.json'), JSON.stringify({ normal, hover, focus, night }, null, 2));
  } else {
    await plan(page, 'invalid'); await send(page, '观察站台');
    await expect.poll(async () => (await data(page)).draft?.stageStatus.story).toBe('failed');
    await closeError(page); await openWorkflowStage(page, 'story');
    const before = await data(page), posted = await calls(page);
    const body = await measure(page.locator('.wf-banner-msg').first(), '正文生成');
    const pill = await measure(page.locator('.wf-pill[data-s=fail]').first().locator('..'), '失败');
    await evidence(page, info, 'desktop-day-failure', { body, pill });
    expect.soft(body.ratio).toBeGreaterThanOrEqual(4.5); expect.soft(pill.ratio).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => { document.documentElement.dataset.appearance = 'night'; });
    const nightBody = await measure(page.locator('.wf-banner-msg').first(), '正文生成');
    const nightPill = await measure(page.locator('.wf-pill[data-s=fail]').first().locator('..'), '失败');
    await evidence(page, info, 'desktop-night-failure', { body: nightBody, pill: nightPill });
    expect(nightBody.ratio).toBeGreaterThanOrEqual(4.5); expect(nightPill.ratio).toBeGreaterThanOrEqual(4.5);
    expect(await data(page)).toEqual(before); expect(await calls(page)).toEqual(posted); expect(posted).toHaveLength(1);
    expect(before.draft?.failures[0].errorCode).toBe('invalid_output');
  }
});
