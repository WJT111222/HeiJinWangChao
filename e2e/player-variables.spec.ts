import { expect, test } from './helpers/test';
import { seedSummary, summaryState } from './helpers/memorySummary';
import { openSettings } from './helpers/gameLayout';
import type { Page } from '@playwright/test';

async function manager(page: Page) {
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '变量管理', exact: true }).click();
  return dialog;
}
test('编辑、差异、取消和保存；跨标签锁拒绝写入，重载后下一次正文使用双向称呼', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000); // Two tabs, a reload, and an explicitly held Story transport.
  let finishRequest!: () => void;
  const pendingRequest = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  const bodies: { model: string; messages: { content: string }[] }[] = [];
  await context.route('https://summary.mock.invalid/**', async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON());
      await pendingRequest;
    }
    await route.fulfill({ status: 401, json: { error: { message: 'Mock test' } } });
  });
  await seedSummary(page, { count: 10, npcCount: 3, automatic: false });
  await page.evaluate(async () => {
    const settingsPath = '/src/ui/settings/model.ts',
      repoPath = '/src/services/storage/saveRepository.ts',
      draftPath = '/src/domain/drafts.ts';
    const { settingsKey } = await import(settingsPath),
      { SaveRepository } = await import(repoPath),
      { createTurnDraft } = await import(draftPath);
    const settings = JSON.parse(localStorage.getItem(settingsKey)!);
    settings.runtime.useVariableStage = false;
    settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const repo = await SaveRepository.open();
    try {
      const { state, draft } = await repo.loadGame('save-a');
      if (!draft)
        await repo.saveDraft(
          createTurnDraft(state.saveId, state.revision, 'address-turn', 'regular', '', false, false),
          null,
        );
    } finally {
      repo.close();
    }
  });
  await page.reload();
  const old = await summaryState(page);
  const panel = await manager(page);
  await panel.getByLabel('变量分区').selectOption('npc');
  await panel.locator('summary').first().click();
  await panel.locator('summary').filter({ hasText: 'npc-a' }).click();
  await panel.getByRole('button', { name: /双向称呼/ }).click();
  const value = panel.getByLabel('变量值（JSON）');
  await value.fill('{');
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'JSON 格式无效' })).toBeVisible();
  const addressing = { playerToNpc: '晚晴', npcToPlayer: '老大' };
  await value.fill(JSON.stringify(addressing));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await expect(panel.getByLabel('修改差异')).toContainText('/npc/npc-a/addressing');
  await panel.getByRole('button', { name: '保存变量修改' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const screenshot = testInfo.outputPath('variable-changes.jpg');
  await page.screenshot({path:screenshot, quality:85});
  await testInfo.attach('变量修改预览', {path:screenshot,contentType:'image/jpeg'});
  await panel.getByRole('button', { name: '放弃修改', exact: true }).click();
  expect(await summaryState(page)).toEqual(old);
  await panel.getByRole('button', { name: '按路径修改' }).click();
  await panel.getByLabel('变量路径').fill('/npc/npc-a/addressing');
  await value.fill(JSON.stringify(addressing));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => {
    void navigator.locks.request('heijin.turn:save-a', async () => {
      document.documentElement.dataset.holding = 'yes';
      await new Promise<void>((resolve) =>
        window.addEventListener('release-test-lock', () => resolve(), { once: true }),
      );
    });
  });
  await expect(other.locator('html')).toHaveAttribute('data-holding', 'yes');
  const save = panel.getByRole('button', { name: '保存变量修改' });
  await save.click();
  await expect(panel.getByRole('status').filter({ hasText: '其他标签' })).toBeVisible();
  expect(await summaryState(page)).toEqual(old);
  await expect(panel.getByLabel('修改差异')).toBeVisible();
  await other.evaluate(async () => {
    window.dispatchEvent(new Event('release-test-lock'));
    await navigator.locks.request('heijin.turn:save-a', () => undefined);
  });
  await save.click();
  await expect(panel.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
  const updated = await summaryState(page);
  expect(updated.npc['npc-a'].addressing).toEqual(addressing);
  expect(updated.journal).toEqual(old.journal);
  expect(bodies).toHaveLength(0);
  await page.getByLabel('你的行动', { exact: true }).fill('直呼姓名');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].model).toBe('story');
  const message = bodies[0].messages.find((m) => m.content.startsWith('<GAME_CONTEXT>'))!;
  const sent = JSON.parse(message.content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length));
  expect(sent.SAVE_STATE.npc['npc-a'].addressing).toEqual(addressing);
  try {
    const code = await other.evaluate(async () => {
      const path = '/src/services/storage/saveRepository.ts',
        { SaveRepository } = await import(path),
        repo = await SaveRepository.open();
      try {
        const base = await repo.loadVariableSnapshot('save-a');
        await repo.savePlayerVariables(base, { ...base.state, title: '不可覆盖' });
        return 'saved';
      } catch (error) {
        return (error as { code: string }).code;
      } finally {
        repo.close();
      }
    });
    expect(code).toBe('STORY_BUSY');
    expect(await summaryState(page)).toEqual(updated);
  } finally {
    finishRequest();
    await other.close();
  }
  expect(bodies).toHaveLength(1);
});
