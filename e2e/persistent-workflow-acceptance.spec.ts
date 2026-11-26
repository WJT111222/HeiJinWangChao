import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { writeFile } from 'node:fs/promises';

const action = (page: Page) => page.locator('.composer-workflow-action');
const emptyWorld = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] };
async function stored(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function setup(page: Page, mode: 'variables' | 'world' | 'failed') {
  await page.goto('/');
  const clock = await page.evaluate(async mode => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts',
      '/src/domain/drafts.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft, elapsedVariables }, { startStageAttempt, TurnDraftSchema },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map(p => import(p)));
    const settings = defaultSettings(); settings.runtime.useEntityStage = mode === 'failed'; settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const config of Object.values(settings.memory.summaries) as { automatic: boolean }[]) config.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://pr162-acceptance.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-pr162-not-a-secret');
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useEntityStage:settings.runtime.useEntityStage, useVariableStage: true, useWorldStage: true });
      const bound = await repo.bindTurnAction(await repo.loadDraft('save-a'), '继续观察街道', true, true, settings.runtime.useEntityStage);
      const variables = await elapsedVariables(repo, '观察街道经过十分钟', 600);
      if (mode === 'failed') {
        await repo.saveDraft(TurnDraftSchema.parse({ ...bound, draftRevision: bound.draftRevision + 1,
          stageStatus: { ...bound.stageStatus, story: 'failed' }, failures: [{ stage: 'story', attempt: 1,
            storyRevision: 0, errorCode: 'authorization', retryable: false }] }), bound.draftRevision);
      } else {
        const ready = await completeDraft(repo, { variables,
          narrative: '主角在街边观察了十分钟，继续自己的行程。', summary: '观察街道',
          world: { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] } });
        const partial = startStageAttempt(ready, mode === 'variables' ? ['variables', 'world'] : ['world']);
        await repo.saveDraft(partial, ready.draftRevision, undefined, ready);
      }
      return variables.commands[0].worldClock;
    } finally { repo.close(); }
  }, mode);
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  return clock as string;
}
async function saveGates(page: Page) {
  await page.route('**/src/services/storage/saveRepository.ts*', async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, body: source + `
const originalCommit = SaveRepository.prototype.commitTurn;
SaveRepository.prototype.commitTurn = async function(...args) {
  if (window.__pr162HoldCommit) {
    window.__pr162CommitEntered = true;
    await new Promise(resolve => { window.__pr162ReleaseCommit = resolve; });
  }
  return originalCommit.apply(this, args);
};
const originalSaveDraft = SaveRepository.prototype.saveDraft;
SaveRepository.prototype.saveDraft = async function(...args) {
  if (window.__pr162HoldStory && args[0].story?.narrative.includes('保存边界')) {
    window.__pr162HoldStory = false;
    window.__pr162StoryEntered = true;
    await new Promise(resolve => { window.__pr162ReleaseStory = resolve; });
  }
  return originalSaveDraft.apply(this, args);
};` });
  });
}
async function gate(page: Page, name: string, value = true) {
  await page.evaluate(({ name, value }) => { Reflect.set(window, name, value); }, { name, value });
}
async function release(page: Page, name: string) {
  await page.evaluate(name => { const fn = Reflect.get(window, name); if (typeof fn === 'function') fn(); }, name);
}

for (const mode of ['variables', 'world'] as const) {
  test(`${mode} 待继续：常驻按钮执行剩余阶段，保存期不可取消，正式结算一次且刷新不请求`, async ({ page }, info) => {
    await saveGates(page); const clock = await setup(page, mode), before = await stored(page), calls: string[] = [];
    let releaseWorld!: () => void; const held = new Promise<void>(resolve => { releaseWorld = resolve; });
    await page.route('https://pr162-acceptance.mock.invalid/**', async route => {
      const stage = String(route.request().postDataJSON().model); calls.push(stage);
      const text = stage === 'variables' ? variableTextEnvelope(`<命令>\nset worldClock = ${JSON.stringify(clock)}\n</命令>`) : JSON.stringify(emptyWorld);
      if (stage === 'world') await held;
      await route.fulfill({ json: { choices: [{ message: { content: text }, finish_reason: 'stop' }] } }).catch(() => undefined);
    });
    try {
      await page.locator('#player-input').fill('保留尚未发送的下一行动');
      await expect(action(page)).toHaveAccessibleName(mode === 'variables' ? '继续生成主角与现场' : '继续生成场外与网络');
      await gate(page, '__pr162HoldCommit'); await action(page).click();
      await expect.poll(() => calls.includes('world')).toBe(true);
      expect(calls).toEqual(mode === 'variables' ? ['variables', 'world'] : ['world']);
      const pending = await stored(page); expect(pending.state).toEqual(before.state);
      expect(pending.draft.variables.validation).toBe('validated');
      await expect(action(page)).toHaveAccessibleName('取消生成');
      releaseWorld();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, '__pr162CommitEntered'))).toBe(true);
      await expect(action(page)).toHaveAccessibleName('正在保存…'); await expect(action(page)).toBeDisabled();
      await action(page).evaluate((button: HTMLButtonElement) => button.click());
      expect((await stored(page)).state).toEqual(before.state);
      await page.screenshot({ path: info.outputPath('commit-saving.png') });
      await release(page, '__pr162ReleaseCommit');
      await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber + 1);
      const committed = await stored(page);
      expect(committed.state.revision).toBe(before.state.revision + 1);
      expect(committed.state.journal).toHaveLength(before.state.journal.length + 1);
      expect(committed.draft).toMatchObject({ userInput: '', failures: [] });
      await expect(action(page)).toHaveAccessibleName('本回合已完成'); await expect(action(page)).toBeDisabled();
      await expect(page.locator('#player-input')).toHaveValue('保留尚未发送的下一行动');
      await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
      expect(await stored(page)).toEqual(committed); expect(calls).toEqual(mode === 'variables' ? ['variables', 'world'] : ['world']);
      await writeFile(info.outputPath('settlement-result.json'), JSON.stringify({ mode, calls, turnBefore: before.state.turnNumber,
        turnAfter: committed.state.turnNumber, revisionBefore: before.state.revision, revisionAfter: committed.state.revision }, null, 2));
      await page.screenshot({ path: info.outputPath('settled.png') });
    } finally { releaseWorld(); await release(page, '__pr162ReleaseCommit').catch(() => undefined); }
  });
}

test('正文真正保存期间不可取消，失败回填中玩家修改的文字保持不变', async ({ page }, info) => {
  await saveGates(page); await setup(page, 'failed'); const before = await stored(page); let calls = 0;
  await page.route('https://pr162-acceptance.mock.invalid/**', async route => {
    calls++;
    const text = '<thinking>保持行动。</thinking><正文>主角抵达保存边界，确认街道状况。</正文><短期记忆>观察街道。</短期记忆><变量规划>[]</变量规划>';
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` });
  });
  try {
    await page.locator('#player-input').fill('失败后主动修改且尚未发送的文字');
    await gate(page, '__pr162HoldStory'); await action(page).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__pr162StoryEntered'))).toBe(true);
    await expect(action(page)).toHaveAccessibleName('正在保存…'); await expect(action(page)).toBeDisabled();
    await action(page).evaluate((button: HTMLButtonElement) => button.click());
    expect(await stored(page)).toEqual(before); expect(calls).toBe(1);
    await page.screenshot({ path: info.outputPath('story-saving.png') });
    await release(page, '__pr162ReleaseStory');
    await expect.poll(async () => (await stored(page)).draft.stageStatus.story).toBe('ready');
    expect((await stored(page)).state).toEqual(before.state);
    await expect(page.locator('#player-input')).toHaveValue('失败后主动修改且尚未发送的文字');
    await expect(action(page)).toHaveAccessibleName('继续生成人物与实体'); expect(calls).toBe(1);
  } finally { await release(page, '__pr162ReleaseStory').catch(() => undefined); }
});

test('无 Web Locks：常驻按钮和发送均不产生额外模型请求，刷新与输入保持安全', async ({ page, context }, info) => {
  await setup(page, 'failed'); const before = await stored(page); let calls = 0;
  await page.route('https://pr162-acceptance.mock.invalid/**', async route => { calls++; await route.fulfill({ status: 401 }); });
  await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  const input = page.locator('#player-input'); await expect(input).toHaveValue('继续观察街道');
  await input.fill('保留缺锁时的主动编辑'); await action(page).click();
  await expect(page.getByText(/当前浏览器无法使用 Web Locks/).first()).toBeAttached();
  const diagnostic = page.locator('dialog.mobile-diagnostics-sheet[open]'); if (await diagnostic.isVisible()) await page.keyboard.press('Escape');
  await expect(input).toHaveValue('保留缺锁时的主动编辑'); expect(await stored(page)).toEqual(before); expect(calls).toBe(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#action-concurrency-error')).toBeVisible(); await expect(input).toHaveValue('保留缺锁时的主动编辑');
  expect(await stored(page)).toEqual(before); expect(calls).toBe(0);
  await page.screenshot({ path: info.outputPath('no-lock-input.png') });
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  expect(await stored(page)).toEqual(before); expect(calls).toBe(0);
});

test('正文失败后主动改字，再次 HTTP 失败仍保留编辑和正式存档', async ({ page }, info) => {
  await setup(page, 'failed'); const before = await stored(page); let calls = 0;
  await page.route('https://pr162-acceptance.mock.invalid/**', async route => { calls++; await route.fulfill({ status: 401, body: 'mock authorization failure' }); });
  const input = page.locator('#player-input');
  await expect(input).toHaveValue('继续观察街道'); await input.fill('失败后改为先核对站牌');
  await action(page).click(); await expect.poll(() => calls).toBe(1);
  await expect(page.getByText(/服务返回授权错误/).first()).toBeAttached();
  const diagnostic = page.locator('dialog.mobile-diagnostics-sheet[open]'); if (await diagnostic.isVisible()) await page.keyboard.press('Escape');
  await expect(action(page)).toHaveAccessibleName('生成本回合正文'); await expect(action(page)).toBeEnabled();
  await expect(input).toHaveValue('失败后改为先核对站牌');
  const after = await stored(page); expect(after.state).toEqual(before.state);
  expect(after.draft).toMatchObject({ userInput: '继续观察街道', stageStatus: { story: 'failed' } });
  expect(after.draft.story).toBeUndefined(); expect(calls).toBe(1);
  await page.screenshot({ path: info.outputPath('edited-failure-input.png') });
});
