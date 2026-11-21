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
          createTurnDraft(
            state.saveId,
            state.revision,
            'address-turn',
            'regular',
            '',
            false,
            false,
          ),
          null,
        );
    } finally {
      repo.close();
    }
  });
  await page.reload();
  const old = await summaryState(page);
  const panel = await manager(page);
  await panel
    .getByRole('navigation', { name: '变量分区' })
    .getByRole('button', { name: '人物', exact: true })
    .click();
  await panel.getByRole('button', { name: /npc-a object/ }).click();
  await panel.getByRole('button', { name: /双向称呼/ }).click();
  await panel.getByRole('button', { name: '编辑 双向称呼 JSON' }).click();
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
  await page.screenshot({ path: screenshot, quality: 85 });
  await testInfo.attach('变量修改预览', { path: screenshot, contentType: 'image/jpeg' });
  await panel.getByRole('button', { name: '放弃修改', exact: true }).click();
  expect(await summaryState(page)).toEqual(old);
  await panel.getByRole('button', { name: '路径修订' }).click();
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
  const sent = JSON.parse(
    message.content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length),
  );
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

test('分区工作台可在结构树、路径登记表与 JSON 之间审阅同一份草稿', async ({ page }, info) => {
  await seedSummary(page, { count: 3, npcCount: 2, automatic: false });
  await page.reload();
  const before = await summaryState(page);
  const posts: string[] = [];
  await page.route('https://summary.mock.invalid/**', (route) => {
    if (route.request().method() === 'POST') posts.push('model');
    return route.abort();
  });
  const panel = await manager(page);
  const domains = panel.getByRole('navigation', { name: '变量分区' });
  await expect(domains.getByRole('button')).toHaveCount(9);
  await expect(panel.getByRole('navigation', { name: '设置分类' })).toHaveCount(0);
  const nav = await domains.boundingBox();
  const content = await panel.locator('.vm-content').boundingBox();
  expect(nav).toBeTruthy();
  expect(content).toBeTruthy();
  if (info.project.name === 'desktop') {
    expect(content!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width);
    expect(content!.width).toBeGreaterThan(nav!.width * 2);
  } else {
    expect(content!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
  }
  const shot = async (name: string) => {
    const path = info.outputPath(name + '.jpg');
    await page.screenshot({ path, quality: 85 });
    await info.attach(name, { path, contentType: 'image/jpeg' });
  };
  await shot('workbench');
  await panel.getByRole('button', { name: '编辑 年龄', exact: true }).click();
  await panel.getByLabel('变量值', { exact: true }).fill(String(before.protagonist.age + 1));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await panel.getByRole('button', { name: '变量登记表' }).click();
  await panel.getByLabel('检索全档路径').fill('/npc/npc-a/onScene');
  const selectedMode = panel.getByRole('button', { name: '变量登记表', pressed: true });
  if (info.project.name === 'desktop') await selectedMode.hover();
  await expect(selectedMode).toHaveCSS('background-color', 'rgb(70, 57, 37)');
  await expect(selectedMode).toHaveCSS('color', 'rgb(255, 239, 209)');
  await shot('registry');
  await panel.getByRole('button', { name: '修订 /npc/npc-a/onScene' }).click();
  await expect(panel.getByLabel('变量路径')).toHaveValue('/npc/npc-a/onScene');
  await panel.getByLabel('变量值（JSON）').fill(String(!before.npc['npc-a'].onScene));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await expect(panel.getByLabel('修改差异')).toContainText('/protagonist/age');
  await expect(panel.getByLabel('修改差异')).toContainText('/npc/npc-a/onScene');
  await domains.getByRole('button', { name: '世界', exact: true }).click();
  await panel.getByRole('button', { name: '分区 JSON' }).click();
  const raw = panel.getByLabel('原始分区 JSON');
  const world = JSON.parse(await raw.inputValue());
  expect(world.locations).toEqual(before.locations);
  expect(world).not.toHaveProperty('npc');
  await raw.fill(JSON.stringify({ ...world, weatherText: '细雨' }));
  await domains.getByRole('button', { name: '经济', exact: true }).click();
  await expect(raw).toHaveValue(JSON.stringify({ ...world, weatherText: '细雨' }));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await expect(panel.getByLabel('修改差异')).toContainText('/weatherText');
  await panel.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(panel.getByLabel('修改差异')).toHaveCount(0);
  expect(await summaryState(page)).toEqual(before);
  expect(posts).toEqual([]);
});

test('变量管理器手动保存天气与环境，刷新后保留且没有模型请求', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://summary.mock.invalid/**', route => {
    calls.push(route.request().method());
    return route.abort();
  });
  await seedSummary(page, { count: 3, npcCount: 2, automatic: false });
  await page.reload();
  const before = await summaryState(page);
  const panel = await manager(page);
  await panel.getByRole('navigation', { name: '变量分区' }).getByRole('button', { name: '世界', exact: true }).click();
  await panel.getByRole('button', { name: '分区 JSON' }).click();
  const raw = panel.getByLabel('原始分区 JSON');
  const scene = { weatherText: '阵雨', environmentText: '街口有临时便道，巴士已恢复通行。' };
  await raw.fill(JSON.stringify({ ...JSON.parse(await raw.inputValue()), ...scene }));
  await panel.getByRole('button', { name: '加入待保存修改' }).click();
  await panel.getByRole('button', { name: '保存变量修改' }).click();
  await expect(panel.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await page.reload();
  expect(await summaryState(page)).toMatchObject({ ...scene, journal: before.journal, turnNumber: before.turnNumber });
  expect(calls).toEqual([]);
});
