import { expect, test } from './helpers/test';
import type { BrowserContext, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openStageSwitches } from './helpers/gameLayout';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
    } finally { repo.close(); }
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const config of Object.values(settings.memory.summaries) as { automatic: boolean }[]) config.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://pr158-boundary.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-pr158-not-a-credential', true);
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function tryPeerBinding(peer: Page, withoutLocks: boolean) {
  return peer.evaluate(async withoutLocks => {
    if (withoutLocks) Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try {
      const before = await repo.loadGame('save-a');
      let code = 'bound';
      try { await repo.bindTurnAction(before.draft, '第二页面不应替换运行中的行动', true, true); }
      catch (error) { code = String((error as { code?: string }).code ?? 'unknown'); }
      const after = await repo.loadGame('save-a');
      return { code, locksAvailable: Boolean(navigator.locks),
        stateUnchanged: JSON.stringify(before.state) === JSON.stringify(after.state),
        draftUnchanged: JSON.stringify(before.draft) === JSON.stringify(after.draft) };
    } finally { repo.close(); }
  }, withoutLocks);
}

async function closeDiagnostics(page: Page) {
  if (await page.locator('dialog.mobile-diagnostics-sheet[open]').isVisible()) await page.keyboard.press('Escape');
}
async function boundState(page: Page, failed: boolean) {
  await page.evaluate(async failed => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { TurnDraftSchema }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      const d = await repo.bindTurnAction(await repo.loadDraft('save-a'), '原来的行动', true, true);
      if (failed) await repo.saveDraft(TurnDraftSchema.parse({ ...d, draftRevision: d.draftRevision + 1,
        stageStatus: { ...d.stageStatus, story: 'failed' }, failures: [{ stage: 'story', attempt: 1,
          storyRevision: 0, errorCode: 'authorization', retryable: false }] }), d.draftRevision, undefined, d);
    } finally { repo.close(); }
  }, failed);
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function mockApi(context: BrowserContext) {
  const calls: string[] = []; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await context.route('https://pr158-boundary.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    if (calls.length === 1) { await held; await route.fulfill({ status: 401, body: 'isolated mock failure' }).catch(() => undefined); return; }
    const text = stage === 'story'
      ? '<thinking>沿用玩家重新发送的行动。</thinking><正文>主角沿街查看周围环境，继续自己的行程。</正文><短期记忆>沿街查看环境。</短期记忆><变量规划>[]</变量规划>'
      : stage === 'variables' ? variableTextEnvelope('<命令>\nset worldClock = "2026-10-18T08:20:00+08:00"\n</命令>')
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) }).catch(() => undefined);
  });
  return { calls, release };
}
async function nextTurn(page: Page, calls: string[], before: Awaited<ReturnType<typeof stored>>) {
  await closeDiagnostics(page);
  const input = page.locator('#player-input');
  await input.fill('停止后重新发送的行动'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  const committed = await stored(page);
  expect(committed.state.revision).toBe(before.state.revision + 1);
  expect(committed.state.journal).toHaveLength(before.state.journal.length + 1);
  expect(committed.draft).toMatchObject({ userInput: '', failures: [], baseSaveRevision: committed.state.revision });
  expect(calls).toEqual(['story', 'story', 'variables', 'world']);
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  expect(await stored(page)).toEqual(committed); expect(calls).toEqual(['story', 'story', 'variables', 'world']);
}

test('Web Locks：正常请求保护、真正失败后重发、下一回合及刷新', async ({ page, context }, info) => {
  await seed(page); const before = await stored(page), server = await mockApi(context), peer = await context.newPage();
  try {
    await page.locator('#player-input').fill('隔离的原行动'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => server.calls.length).toBe(1);
    expect(await page.evaluate(async () => (await navigator.locks.query()).held?.map(lock => lock.name))).toContain('heijin.turn:save-a');
    await peer.goto('/#game/save-a'); await expect(peer.getByTestId('story-reader')).toBeVisible();
    const result = await tryPeerBinding(peer, false);
    expect(result).toMatchObject({ code: 'STORY_BUSY', stateUnchanged: true, draftUnchanged: true });
    expect(server.calls).toEqual(['story']);
    // 请求已在执行时，两页同时失去 Web Locks API；仍必须在重绑前保守拒绝。
    await page.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
    const unavailable = await tryPeerBinding(peer, true);
    expect(unavailable).toMatchObject({ code: 'concurrency_unavailable', stateUnchanged: true, draftUnchanged: true });
    expect(server.calls).toEqual(['story']);
    await writeFile(info.outputPath('inflight-no-lock-result.json'), JSON.stringify({ unavailable, calls: server.calls }, null, 2));
    await page.evaluate(() => Reflect.deleteProperty(navigator, 'locks'));
    server.release(); await expect.poll(async () => (await stored(page)).draft?.stageStatus.story).toBe('failed');
    await closeDiagnostics(page); await expect(page.locator('#player-input')).toHaveValue('隔离的原行动');
    expect((await stored(page)).state).toEqual(before.state);
    await nextTurn(page, server.calls, before);
    await page.screenshot({ path: info.outputPath('rebound-next-turn.png') });
  } finally { server.release(); await peer.close(); }
});

for (const failed of [false, true]) {
  test(`两页均无 Web Locks：${failed ? 'failed' : 'pending'} 草稿不重绑、不请求，输入与正式状态保留`, async ({ page, context }, info) => {
    await seed(page); await boundState(page, failed);
    const before = await stored(page), calls: string[] = [];
    await context.route('https://pr158-boundary.mock.invalid/**', async route => { calls.push('unexpected'); await route.fulfill({ status: 401 }); });
    await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
    const peer = await context.newPage();
    try {
      await page.reload(); await peer.goto('/#game/save-a');
      for (const tab of [page, peer]) {
        await expect(tab.getByTestId('story-reader')).toBeVisible();
        const input = tab.locator('#player-input'); await input.fill('不应丢失的玩家编辑');
        await tab.getByRole('button', { name: '发送', exact: true }).click();
        await expect(tab.getByText(/当前浏览器无法使用 Web Locks/).filter({ visible: true }).first()).toBeVisible();
        await expect(input).toHaveValue('不应丢失的玩家编辑');
        await closeDiagnostics(tab);
        await expect(input).toBeInViewport({ ratio: 1 });
        await expect(tab.locator('#action-concurrency-error')).toBeVisible();
        const result = await tryPeerBinding(tab, true);
        expect(result).toMatchObject({ code: 'concurrency_unavailable', locksAvailable: false, stateUnchanged: true, draftUnchanged: true });
        // 手动 Story 与 Coordinator 也不能绕过绑定入口发出请求。
        const codes = await tab.evaluate(async () => {
          const paths = ['/src/services/storage/saveRepository.ts', '/src/workflows/storyStage.ts', '/src/workflows/turnCoordinator.ts',
            '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
          const [{ SaveRepository }, { StoryStage }, { TurnCoordinator }, { readAiConfig }, { CredentialVault }, { settingsKey }] = await Promise.all(paths.map(path => import(path)));
          const repo = await SaveRepository.open();
          try {
            const results = [];
            for (const runner of [new StoryStage(repo), new TurnCoordinator(repo)]) {
              try { await runner.generate({ draft: await repo.loadDraft('save-a'), config: readAiConfig(localStorage),
                settings: JSON.parse(localStorage.getItem(settingsKey)!), vault: new CredentialVault(sessionStorage, localStorage) }); results.push('sent'); }
              catch (error) { results.push((error as { code: string }).code); }
            }
            return results;
          } finally { repo.close(); }
        });
        expect(codes).toEqual(['concurrency_unavailable', 'concurrency_unavailable']);
        expect(await stored(tab)).toEqual(before);
      }
      expect(calls).toEqual([]);
      await page.screenshot({ path: info.outputPath('no-lock-input-preserved.png') });
      await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
      expect(await stored(page)).toEqual(before); expect(calls).toEqual([]);
      await writeFile(info.outputPath('no-lock-result.json'), JSON.stringify({ failed, calls, stateAndDraftUnchanged: true }, null, 2));
    } finally { await peer.close(); }
  });
}

test('failed 草稿正在手动重试：有锁或缺锁的他页均不可重绑，取消后刷新可恢复', async ({ page, context }, info) => {
  await seed(page); await boundState(page, true);
  const before = await stored(page), server = await mockApi(context), peer = await context.newPage();
  try {
    await page.evaluate(async () => {
      const paths = ['/src/services/storage/saveRepository.ts', '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts',
        '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
      const [{ SaveRepository }, { StoryStage }, { readAiConfig }, { CredentialVault }, { settingsKey }] = await Promise.all(paths.map(path => import(path)));
      const repo = await SaveRepository.open(), runner = new StoryStage(repo);
      (window as unknown as { __pr158Cancel: () => void }).__pr158Cancel = () => { runner.cancel(); };
      void runner.generate({ draft: await repo.loadDraft('save-a'), config: readAiConfig(localStorage),
        settings: JSON.parse(localStorage.getItem(settingsKey)!), vault: new CredentialVault(sessionStorage, localStorage) })
        .catch(() => undefined).finally(() => repo.close());
    });
    await expect.poll(() => server.calls.length).toBe(1);
    expect((await stored(page)).draft?.stageStatus.story).toBe('failed');
    await peer.goto('/#game/save-a'); await expect(peer.getByTestId('story-reader')).toBeVisible();
    expect(await tryPeerBinding(peer, false)).toMatchObject({ code: 'STORY_BUSY', stateUnchanged: true, draftUnchanged: true });
    expect(await tryPeerBinding(peer, true)).toMatchObject({ code: 'concurrency_unavailable', stateUnchanged: true, draftUnchanged: true });
    expect(server.calls).toEqual(['story']); expect(await stored(page)).toEqual(before);
    await page.evaluate(() => (window as unknown as { __pr158Cancel: () => void }).__pr158Cancel());
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.length)).toBe(0);
    server.release();
    await peer.reload(); await expect(peer.getByTestId('story-reader')).toBeVisible();
    expect(server.calls).toEqual(['story']); expect(await stored(peer)).toEqual(before);
    await nextTurn(peer, server.calls, before);
    await peer.screenshot({ path: info.outputPath('cancelled-retry-recovered.png') });
  } finally {
    await page.evaluate(() => (window as unknown as { __pr158Cancel?: () => void }).__pr158Cancel?.()).catch(() => undefined);
    server.release(); await peer.close();
  }
});

test('普通请求显式取消后刷新：不自动请求，可回填修改并进入下一回合', async ({ page, context }) => {
  await seed(page); const before = await stored(page), server = await mockApi(context);
  try {
    await page.locator('#player-input').fill('待取消的行动'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => server.calls.length).toBe(1);
    await openStageSwitches(page);
    await page.getByRole('button', { name: '取消自动执行', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.length)).toBe(0);
    server.release(); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
    expect(server.calls).toEqual(['story']); expect((await stored(page)).state).toEqual(before.state);
    await expect(page.locator('#player-input')).toHaveValue('待取消的行动');
    await nextTurn(page, server.calls, before);
  } finally { server.release(); }
});
