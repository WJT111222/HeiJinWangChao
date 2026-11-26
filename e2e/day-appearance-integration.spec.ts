import { test, expect } from './helpers/test';
import { seedDayReading, setAppearance, repositoryValue } from './helpers/dayReadability';
import { paintedContrast } from './helpers/readabilityContrast';
import { openWorkflow } from './helpers/gameLayout';
import { setup, plan, calls, data, closeError, send, button, stopped, oldOptions } from './helpers/actionRecovery';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test('整合：日间主角对白、哈尔滨铭牌与工作流文字可读', async ({ page }, info) => {
  let posts = 0; page.on('request', req => { if (req.method() === 'POST') posts++; });
  await seedDayReading(page, 'harbin', 'day', 'pending');
  const before = await repositoryValue(page);
  const targets = ['.story-dialogue-hero .story-bubble', '.plate .p-num', '.plate .p-cn', '.plate .p-sub'];
  for (const selector of targets) {
    const result = await paintedContrast(page, page.locator(selector).first());
    await info.attach(selector, { contentType: 'application/json', body: JSON.stringify(result) });
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByTestId('story-reader').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: info.outputPath('day-main.png'), animations: 'disabled' });
  await openWorkflow(page);
  for (const selector of ['#workflow-pop .wf-hd h3', '#workflow-pop .workflow-primary button', '.workflow-drawer-input']) {
    const target = page.locator(selector); if (!await target.isVisible()) continue;
    const result = await paintedContrast(page, target);
    await info.attach(selector, { contentType: 'application/json', body: JSON.stringify(result) });
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator('#workflow-pop .wf-hd h3')).toBeVisible();
  await page.screenshot({ path: info.outputPath('day-workflow.png'), animations: 'disabled' });
  expect(await repositoryValue(page)).toEqual(before); expect(posts).toBe(0);
});

test('整合：日间失败后恢复旧建议，主动继续正文与剩余阶段后原子结算', async ({ page }, info) => {
  await setup(page); await setAppearance(page, 'day');
  const original = await data(page);
  await plan(page, '401'); await send(page, oldOptions[0]);
  await expect.poll(async () => (await data(page)).draft?.stageStatus.story).toBe('failed');
  await stopped(page); await closeError(page);
  const failed = await data(page); expect(failed.state).toEqual(original.state); expect(failed.draft?.story).toBeUndefined();
  await expect(page.getByText('上一已结算回合建议 · 第1回合', { exact: false })).toBeVisible();
  await expect(page.locator('#action-recovery-guidance')).toContainText('尚无正文候选');
  const suggestion = page.getByRole('button', { name: /去书店看看/ }); await expect(suggestion).toBeEnabled(); await suggestion.click();
  await expect(page.locator('#player-input')).toHaveValue('沿江走一走，去书店看看');
  expect(await data(page)).toEqual(failed); expect(await calls(page)).toEqual([{ stage: 'story', action: oldOptions[0] }]);
  await page.screenshot({ path: info.outputPath('day-failed-suggestions.png'), animations: 'disabled' });
  // Continue uses the original binding; selecting a suggestion alone never sends or rebinds.
  await plan(page, 'ok'); await button(page).click();
  await expect.poll(async () => (await data(page)).draft?.stageStatus.story).toBe('ready');
  const story = await data(page); expect(story.state).toEqual(original.state); expect(story.draft?.stageStatus.variables).toBe('pending');
  expect((await calls(page)).map(x => x.stage)).toEqual(['story', 'story']);
  expect((await calls(page))[1].action).toBe(oldOptions[0]);
  await expect(page.locator('#action-recovery-guidance')).toContainText('继续生成人物与实体');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await button(page).click();
  await expect.poll(async () => (await data(page)).state.turnNumber,{timeout:15000}).toBe(original.state.turnNumber + 1);
  const done = await data(page);
  expect(done.state.revision).toBe(original.state.revision + 1); expect(done.state.journal).toHaveLength(original.state.journal.length + 1);
  expect((await calls(page)).map(x => x.stage)).toEqual(['story', 'story', 'entities', 'variables', 'world']);
  await expect(button(page)).toHaveAttribute('data-kind', 'idle');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
  await page.screenshot({ path: info.outputPath('day-recovery-settled.png'), animations: 'disabled' });
  await info.attach('request-and-state-check', { contentType: 'application/json', body: JSON.stringify({ stages: (await calls(page)).map(x => x.stage), formalRevision: done.state.revision, committedTurns: done.state.turnNumber - original.state.turnNumber }) });
});
