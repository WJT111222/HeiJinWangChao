import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflow } from './helpers/gameLayout';

async function seed(page: Page, turns = 7, automaticMemory = false) {
  await page.goto('/');
  await page.evaluate(async ({ turns, automaticMemory }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft, elapsedVariables, submission }, { defaultSettings, settingsKey },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      for (let i = 1; i <= turns; i++) {
        const game = await repo.loadGame('save-a');
        if (game.draft) await repo.bindTurnAction(game.draft, `第${i}回合原行动`, true, true);
        const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '日常活动', 60) });
        await repo.commitTurn(submission(draft, ''));
      }
    } finally { repo.close(); }
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const config of Object.values(settings.memory.summaries) as { automatic: boolean }[]) config.automatic = automaticMemory;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://undo.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world', 'memory']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'undo-mock-key');
  }, { turns, automaticMemory });
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return { ...await repo.loadGame('save-a'), undo: await repo.undoStatus('save-a'), raw: await repo.exportRaw('save-a') }; }
    finally { repo.close(); }
  });
}
async function mock(page: Page) {
  const calls: string[] = [], control = { failWorld: false, hold: undefined as Promise<void> | undefined };
  await page.route('https://undo.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    const state = (await read(page)).state;
    const text = stage === 'story'
      ? '<thinking>继续当前行动。</thinking><正文>【旁白】主角来到公园，沿着小路慢慢散步。</正文><短期记忆>在公园散步。</短期记忆><变量规划>[]</变量规划>'
      : stage === 'variables' ? `<thinking>记录时间与支出。</thinking><说明>更新现场。</说明><命令>\nset worldClock = "${new Date(Date.parse(state.worldClock) + 60000).toISOString()}"\nadd economy.cash = -100\n</命令>`
        : control.failWorld ? '{broken' : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    if (control.hold) await control.hold;
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) }).catch(() => undefined);
  });
  return { calls, control };
}
async function undo(page: Page, count: number) {
  await page.getByRole('button', { name: `撤回（${count}）`, exact: true }).click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '撤回上一回合' })).not.toBeVisible();
}

test('连续五次撤回、刷新恢复、回填覆盖和无Redo，全程零模型请求', async ({ page }, info) => {
  await seed(page); const server = await mock(page);
  for (let count = 5; count >= 1; count--) {
    await undo(page, count);
    await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue(`第${count + 2}回合原行动`);
    const data = await read(page); expect(data.state.turnNumber).toBe(count + 1);
    expect(data.raw.records.turnUndo).toHaveLength(count - 1); expect(data.raw.records.turnReceipts).toHaveLength(0);
    if (count === 4) {
      await page.getByLabel('你的行动', { exact: true }).fill('我先编辑一下');
      await expect.poll(async () => (await read(page)).undo.input).toBe('我先编辑一下');
      await page.reload(); await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('我先编辑一下');
    }
  }
  await expect(page.getByRole('button', { name: '撤回', exact: true })).toBeDisabled(); expect(server.calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('undo-waiting-input.png') });
});
test('撤回后编辑发送才开始三阶段，失败可恢复且只保存新分支', async ({ page }) => {
  await seed(page, 3); const server = await mock(page), original = await read(page);
  await undo(page, 2); expect(server.calls).toHaveLength(0);
  await page.getByLabel('你的行动', { exact: true }).fill('改去公园'); server.control.failWorld = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => server.calls).toEqual(['story', 'variables', 'world']);
  await expect.poll(async () => (await read(page)).draft.stageStatus.world).toBe('failed');
  expect((await read(page)).state.turnNumber).toBe(2);
  server.control.failWorld = false; await openWorkflow(page);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(3);
  const fresh = await read(page); expect(fresh.state.economy.cash).toBe(original.state.economy.cash - 100);
  expect(fresh.state.journal.at(-1).turnId).not.toBe(original.state.journal.at(-1).turnId);
  expect(server.calls).toEqual(['story', 'variables', 'world', 'world']);
  await page.reload(); expect((await read(page)).state).toEqual(fresh.state); expect(server.calls).toHaveLength(4);
  await undo(page, 2); await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('改去公园');
});
test('取消撤回不修改任何数据；部分草稿需明确确认，旧候选退出', async ({ page }) => {
  await seed(page, 3); const server = await mock(page);
  await page.evaluate(async () => {
    const r = '/src/services/storage/saveRepository.ts', d = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(r), { rerollStory } = await import(d), repo = await SaveRepository.open();
    try { const game = await repo.loadGame('save-a'), bound = await repo.bindTurnAction(game.draft, '尚未完成的下一回合', true, true);
      await repo.saveDraft(rerollStory(bound, { turnKind: 'regular', narrative: '未提交正文', summary: '草稿', variableGuide: [] }), bound.draftRevision);
    } finally { repo.close(); }
  });
  await page.reload(); const before = await read(page);
  await page.getByRole('button', { name: '撤回（2）' }).click();
  await expect(page.getByRole('dialog')).toContainText('当前未结算草稿会被丢弃');
  await page.getByRole('button', { name: '保留当前回合' }).click(); expect(await read(page)).toEqual(before);
  await undo(page, 2); expect((await read(page)).draft.story).toBeUndefined(); expect(server.calls).toHaveLength(0);
});
test('跨标签页旧确认不能多退一层；刷新后重新核对剩余恢复点', async ({ page, context }) => {
  await seed(page, 4); const server = await mock(page), second = await context.newPage();
  await second.goto('/#game/save-a'); await expect(second.getByRole('button', { name: '撤回（3）' })).toBeEnabled();
  await second.getByRole('button', { name: '撤回（3）' }).click();
  await undo(page, 3);
  await second.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(second.getByRole('dialog')).toContainText('请重新读取');
  expect((await read(page)).state.turnNumber).toBe(3);
  await second.reload(); await expect(second.getByRole('button', { name: '撤回（2）' })).toBeEnabled();
  await undo(second, 2); expect((await read(page)).state.turnNumber).toBe(2); expect(server.calls).toHaveLength(0);
  await second.close();
});
test('开局不撤回，生成期间按钮禁用；取消后可以撤回且没有额外请求', async ({ page }) => {
  await seed(page, 1); const server = await mock(page);
  await expect(page.getByRole('button', { name: '撤回', exact: true })).toBeDisabled();
  await page.getByLabel('你的行动', { exact: true }).fill('走到街口'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(2);
  let release!: () => void; server.control.hold = new Promise(resolve => { release = resolve; });
  await page.getByLabel('你的行动', { exact: true }).fill('再走一步'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => server.calls.length).toBe(4);
  await expect(page.getByRole('button', { name: '撤回（1）' })).toBeDisabled();
  await openWorkflow(page); await page.getByRole('button', { name: '取消自动执行', exact: true }).click(); release();
  await expect(page.getByRole('button', { name: '撤回（1）' })).toBeEnabled();
  await undo(page, 1); expect((await read(page)).state.turnNumber).toBe(1); expect(server.calls).toHaveLength(4);
});
test('后台总结在撤回时取消，刷新后不自动收费或复活旧总结', async ({ page }) => {
  const server = await mock(page); let release!: () => void;
  server.control.hold = new Promise(resolve => { release = resolve; });
  await seed(page, 33, true);
  await expect.poll(() => server.calls).toEqual(['memory']);
  await undo(page, 5); release();
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('第33回合原行动');
  const before = await read(page); expect(before.undo.memoryPaused).toBe(true);
  await page.reload(); await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('第33回合原行动');
  expect((await read(page)).state).toEqual(before.state); expect(server.calls).toEqual(['memory']);
});
test('快照写满时正式回合可保存，明确提示不可撤回，刷新不重复扣款', async ({ page }) => {
  await seed(page, 3); const server = await mock(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'turnUndo') throw new DOMException('mock snapshot quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByLabel('你的行动', { exact: true }).fill('存储压力下行动');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await read(page)).state.turnNumber).toBe(4);
  await expect(page.getByText('回合已正式保存；受存储容量限制，本回合不支持撤回。')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤回', exact: true })).toBeDisabled();
  const before = await read(page); expect(before.undo.available).toBe(0);
  await page.reload(); expect((await read(page)).state).toEqual(before.state); expect(server.calls).toEqual(['story', 'variables', 'world']);
});
test('另一个标签仍在生成时撤回明确拒绝，取消后重新读取才可撤回', async ({ page, context }) => {
  await seed(page, 3); const server = await mock(page), second = await context.newPage();
  await second.goto('/#game/save-a'); await expect(second.getByRole('button', { name: '撤回（2）' })).toBeEnabled();
  let release!: () => void; server.control.hold = new Promise(resolve => { release = resolve; });
  await page.getByLabel('你的行动', { exact: true }).fill('持有工作流锁');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => server.calls).toEqual(['story']);
  await second.getByRole('button', { name: '撤回（2）' }).click();
  await second.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(second.getByRole('dialog')).toContainText('正在另一处操作');
  expect((await read(page)).state.turnNumber).toBe(3);
  await openWorkflow(page); await page.getByRole('button', { name: '取消自动执行', exact: true }).click(); release();
  await second.reload(); await undo(second, 2); expect((await read(page)).state.turnNumber).toBe(2);
  expect(server.calls).toEqual(['story']); await second.close();
});
test('无 Web Locks 时双标签同时撤回仍由 IndexedDB CAS 保证仅一次成功', async ({ page, context }) => {
  await seed(page, 4); const second = await context.newPage(); await second.goto('/');
  for (const target of [page, second]) await target.evaluate(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  const before = await read(page);
  const invoke = (target: Page, operationId: string) => target.evaluate(async ({ expectedRevision, expectedDraft, operationId }) => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { await repo.undoTurn({ saveId: 'save-a', expectedRevision, expectedDraft, operationId }); return 'success'; }
    catch (error) { return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unexpected'; }
    finally { repo.close(); }
  }, { expectedRevision: before.state.revision, expectedDraft: before.draft, operationId });
  expect((await Promise.all([invoke(page, 'tab-one'), invoke(second, 'tab-two')])).sort()).toEqual(['REVISION_CONFLICT', 'success']);
  expect((await read(page)).state.turnNumber).toBe(3); expect((await read(page)).undo.available).toBe(2);
  await second.close();
});
