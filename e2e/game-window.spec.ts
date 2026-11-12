import { expect, test } from './helpers/test';
import { workflowTrigger, workflowSummary, openWorkflow, openWorkflowDiagnostics, openWorldArchive, openProfile, goHome } from './helpers/gameLayout';
import type { Page } from '@playwright/test';

async function seed(page: Page, mode: 'long' | 'complete' | 'history' | 'empty' = 'long') {
  await page.goto('/');
  const before = await page.evaluate(async (mode) => {
    const storagePath = '/src/services/storage/saveRepository.ts', worldPath = '/src/tests/fixtures/world.ts',
      historyPath = '/src/tests/fixtures/history.ts', draftPath = '/src/domain/drafts.ts', turnPath = '/src/tests/fixtures/turn.ts',
      configPath = '/src/services/ai/configuration.ts', credentialsPath = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storagePath), { worldState } = await import(worldPath), { historyState } = await import(historyPath),
      { createTurnDraft, rerollStory } = await import(draftPath), { completeDraft } = await import(turnPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(credentialsPath),
      { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://layout.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock-story' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-layout-key');
    const source = mode === 'history' ? historyState() : worldState();
    source.protagonist.healthText = '身体状态保持稳定，需要适时休息。'.repeat(50);
    const repo = await SaveRepository.open();
    // 隔离测试上下文中写入真实旧 M4 历史夹具；生产代码没有该入口。
    if (mode === 'history') await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(source); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    });
    const state = mode === 'history' ? await repo.load(source.saveId) : await repo.create(source);
    if (mode === 'complete') await completeDraft(repo);
    else {
      const initial = createTurnDraft(state.saveId, state.revision, 'layout-turn', state.turnNumber ? 'regular' : 'opening', '观察周围');
      await repo.saveDraft(initial, null);
      if (mode !== 'empty') await repo.saveDraft(rerollStory(initial, { turnKind: initial.turnKind, narrative: '【旁白】城市的灯光依次亮起。你望向街道，行人从身边经过。\n\n'.repeat(160), summary: '主角观察街道。', variableGuide: [] }), 0);
    }
    const result = { state, draft: await repo.loadDraft(state.saveId) }; repo.close(); return result;
  }, mode);
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  return before;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return { state: await repo.load('save-a'), draft: await repo.loadDraft('save-a') }; } finally { repo.close(); }
  });
}
async function fit(page: Page, height?: number) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const input = await page.getByLabel('你的行动', { exact: true }).boundingBox(), status = await page.locator((page.viewportSize()?.width ?? 0) > 900 ? '.bar' : '.player-status').boundingBox(), footer = await page.getByRole('button', { name: '发送', exact: true }).boundingBox();
  expect(input).not.toBeNull(); expect(footer).not.toBeNull(); expect(status).not.toBeNull();
  const limit = height ?? (await page.evaluate(() => innerHeight));
  expect(input!.y).toBeGreaterThanOrEqual(status!.y + status!.height); expect(input!.y + input!.height).toBeLessThanOrEqual(limit + 1);
  const geometry = await page.locator('.app-shell-game, .app-header, .game-layout, .story-column, .composer, .composer-tools, #player-input, .composer-footer').evaluateAll((elements) => elements.map((el) => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { element: el.className || el.id, y: rect.y, height: rect.height, min: css.minHeight, max: css.maxHeight, flex: css.flex };
  }));
  expect(footer!.y + footer!.height, JSON.stringify(geometry)).toBeLessThanOrEqual(limit + 1);
  expect(await page.getByLabel('你的行动', { exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
  })).toBe(true);
}
test('全窗口：长正文不撑高页面，标准/较小窗口和缩放尺寸均可输入', async ({ page }, info) => {
  const before = await seed(page);
  const sizes = info.project.name === 'desktop' ? [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 900, height: 700 }, { width: 820, height: 540 }] : [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 667, height: 375 }];
  for (const size of sizes) {
    await page.setViewportSize(size); await fit(page);
    expect((await page.getByTestId('story-reader').boundingBox())!.height).toBeGreaterThan(50);
    await page.getByLabel('你的行动', { exact: true }).fill('保留待发送行动');
  }
  expect(await stored(page)).toEqual(before); await page.screenshot({ path: info.outputPath('small-window.png') });
});

test('顶部状态不挤压正文；完整人物资料独立滚动并恢复焦点和阅读位置', async ({ page }, info) => {
  const before = await seed(page);
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1100 : 392, height: 480 });
  const reader = page.getByTestId('story-reader');
  await reader.evaluate(el => { el.scrollTop = 300; });
  expect((await page.locator((page.viewportSize()?.width ?? 0) > 900 ? '.bar' : '.player-status').boundingBox())!.height).toBeLessThan(130);
  await openProfile(page);
  const modal = page.getByRole('dialog', { name: '人物档案', exact: true });
  const area = modal.locator(info.project.name === 'desktop' ? '.pf' : '.modal-body');
  expect(await area.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await area.evaluate(el => { el.scrollTop = 120; });
  expect(await area.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(300);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/人物档案|⌄/);
  await fit(page); expect(await stored(page)).toEqual(before);
});

test('滚轮在资料弹窗内滚动，不带动正文；七项世界入口可返回', async ({ page }, info) => {
  await seed(page);
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1100 : 392, height: 480 });
  const reader = page.getByTestId('story-reader');
  await reader.evaluate(el => { el.scrollTop = 260; });
  await openProfile(page);
  const scroller = page.getByRole('dialog', { name: '人物档案', exact: true }).locator(info.project.name === 'desktop' ? '.pf' : '.modal-body');
  const rect = (await scroller.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 40); await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(260);
  await page.keyboard.press('Escape');
  await openWorldArchive(page);
  await expect(page.getByRole('navigation', { name: '世界资料分类' }).getByRole('button')).toHaveCount(7);
  if (info.project.name === 'mobile') {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '世界资料', exact: true })).toBeFocused();
  }
  expect(await page.evaluate(() => scrollY)).toBe(0); await fit(page);
});

test('默认紧凑工作流，键盘展开/折叠不改输入、草稿或正式状态', async ({ page }, info) => {
  const before = await seed(page), disclosure = page.locator('.workflow-disclosure'), summary = workflowSummary(page);
  await expect(disclosure).not.toHaveAttribute('open'); await expect(summary).toContainText('等待继续');
  await expect(page.getByRole('button', { name: '生成变量候选', exact: true })).toBeHidden();
  await page.getByLabel('你的行动', { exact: true }).fill('我准备阅读资料');
  await workflowTrigger(page).focus(); await page.keyboard.press('Enter'); await expect(disclosure).toHaveAttribute('open');
  await expect(page.getByRole('button', { name: '生成变量候选', exact: true })).toBeVisible();
  await workflowTrigger(page).focus(); await page.keyboard.press('Enter'); await expect(disclosure).not.toHaveAttribute('open');
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('我准备阅读资料');
  expect(await stored(page)).toEqual(before); await fit(page); await page.screenshot({ path: info.outputPath('reading.png') });
});

test('已完成草稿与V1.0展示刷新一致，不改变旧存档及npm/Schema含义', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.version, .home-experience .ver')).toHaveText('V1.0');
  const before = await seed(page, 'complete');
  await expect(page.locator('.version, .home-experience .ver')).toHaveText('V1.0'); await expect(page.locator('.app-header')).not.toContainText('M5-P3');
  await expect(workflowSummary(page)).toContainText('候选已完成');
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); expect(await stored(page)).toEqual(before);
  await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open');
});

test('生成中折叠不打断；取消和错误不被隐藏，失败重试成功保留正式状态', async ({ page }) => {
  const before = await seed(page, 'empty'); let mode: 'hold' | 'error' | 'success' = 'hold', release!: () => void, calls = 0;
  const runtimeLog = page.getByTestId('runtime-log');
  await expect(runtimeLog).toHaveCount(0);
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://layout.mock.invalid/**', async (route) => {
    const selected = mode; calls++; if (selected === 'hold') await hold;
    const text = '<thinking>本轮创作提纲：按现有地点保持人物连续。</thinking><正文>【旁白】你仍在街边，行人经过身旁。</正文><短期记忆>主角继续观察街道。</短期记忆><变量规划>[]</变量规划>';
    await route.fulfill(selected === 'error' ? { status: 401, body: 'private-provider-error' } : { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }).catch(() => undefined);
  });
  await openWorkflow(page); await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  const summary = workflowSummary(page); await expect(summary).toContainText('正文生成中 · 1/3');
  await workflowTrigger(page).click(); await workflowTrigger(page).click(); await expect.poll(() => calls).toBe(1);
  await openWorkflow(page); await page.getByRole('button', { name: '取消生成', exact: true }).click(); await expect(summary).toContainText('已取消');
  release(); expect((await stored(page)).draft.story).toBeUndefined();
  await expect(runtimeLog).toHaveCount(0);
  mode = 'error'; await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await workflowTrigger(page).click();
  await expect(summary).toContainText('正文生成失败 · 查看详情'); await expect(page.getByRole('alert').first()).toBeHidden();
  await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open'); expect((await stored(page)).state).toEqual(before.state);
  await openWorkflow(page); await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(runtimeLog).toContainText('错误 1 条');
  await expect(runtimeLog).toHaveAttribute('open', '');
  await expect(runtimeLog.locator('li')).toHaveCount(1);
  await expect(runtimeLog.locator('li')).not.toContainText('开始');
  await expect(runtimeLog.getByRole('button', { name: '复制安全日志' })).toHaveCount(0);
  await page.evaluate(() => {
    const target = window as Window & { __copiedRuntimeEntries?: string[] };
    target.__copiedRuntimeEntries = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { target.__copiedRuntimeEntries!.push(value); } },
    });
  });
  await openWorkflowDiagnostics(page); await runtimeLog.locator('li').first().getByRole('button', { name: '复制此条' }).click();
  await expect(runtimeLog).toContainText('已复制此条错误日志');
  const firstCopied = await page.evaluate(() =>
    (window as Window & { __copiedRuntimeEntries?: string[] }).__copiedRuntimeEntries ?? []);
  expect(firstCopied).toHaveLength(1);
  expect(JSON.parse(firstCopied[0])).toMatchObject({ stage: 'story', kind: 'failed', code: 'authorization' });
  expect(firstCopied[0]).not.toContain('private-provider-error');
  expect(firstCopied[0]).not.toContain('started');
  // 第二次失败应生成第二个独立复制入口，不复制首条或非错误事件。
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect(summary).toContainText('正文生成失败 · 查看详情');
  await expect(runtimeLog).toContainText('错误 2 条');
  await expect(runtimeLog).toHaveAttribute('open', '');
  await expect(runtimeLog.locator('li')).toHaveCount(2);
  await expect(runtimeLog.getByRole('button', { name: '复制此条' })).toHaveCount(2);
  await runtimeLog.locator('li').first().getByRole('button', { name: '复制此条' }).click();
  const copied = await page.evaluate(() =>
    (window as Window & { __copiedRuntimeEntries?: string[] }).__copiedRuntimeEntries ?? []);
  expect(copied).toHaveLength(2);
  expect(JSON.parse(copied[1])).toMatchObject({ stage: 'story', kind: 'failed', code: 'authorization' });
  expect(JSON.parse(copied[1]).id).not.toBe(JSON.parse(copied[0]).id);
  await expect(runtimeLog).toContainText('authorization');
  await expect(runtimeLog).toContainText('HTTP 状态：401');
  await expect(runtimeLog).not.toContainText('private-provider-error');
  await runtimeLog.locator('summary').click();
  await expect(runtimeLog).not.toHaveAttribute('open');
  mode = 'success'; await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect(page.getByTestId('story-reader')).toContainText('你仍在街边');
  await expect(summary).toContainText('等待继续'); expect((await stored(page)).state).toEqual(before.state); expect(calls).toBe(4);
  // Existing diagnostic evidence stays available without forcing the panel open again.
  await expect(runtimeLog).not.toHaveAttribute('open');
  await runtimeLog.locator('summary').click();
  await runtimeLog.getByRole('button', { name: '清空日志' }).click();
  await expect(runtimeLog).toHaveCount(0);
});

test('缩短视口及模拟软键盘VisualViewport不遮住输入和发送', async ({ page }) => {
  await seed(page); await page.setViewportSize({ width: 392, height: 640 });
  await page.getByLabel('你的行动', { exact: true }).focus();
  await expect(page.locator('.status-condition')).toBeVisible();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'height', { configurable: true, value: 320 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await page.locator('.app-shell-game').boundingBox())!.height).toBe(320);
  await fit(page, 320); await page.getByLabel('你的行动', { exact: true }).fill('键盘打开时编辑');
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 24 });
    Object.defineProperty(viewport, 'height', { configurable: true, value: 296 }); viewport.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (await page.locator('.app-shell-game').boundingBox())!.y).toBe(24); await fit(page, 320);
  await page.evaluate(() => { const viewport = window.visualViewport!; Reflect.deleteProperty(viewport, 'height'); Reflect.deleteProperty(viewport, 'offsetTop'); viewport.dispatchEvent(new Event('resize')); });
  await page.setViewportSize({ width: 392, height: 360 }); await fit(page);
});

test('设置、历史检索及创角长页仍可滚动，关闭资料保留阅读位置', async ({ page }) => {
  await seed(page, 'history'); await page.setViewportSize({ width: 392, height: 640 });
  const reader = page.getByTestId('story-reader'); await reader.evaluate((el) => { el.scrollTop = 220; });
  await page.getByRole('button', { name: '设置', exact: true }).click(); const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '提示词', exact: true }).click(); await settings.getByRole('button', { name: '保存本地设置', exact: true }).click();
  expect(await settings.locator('.modal-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape'); expect(await reader.evaluate((el) => el.scrollTop)).toBe(220);
  await openWorldArchive(page); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  const memory = page.getByRole('dialog', { name: '记忆', exact: true });
  await memory.getByLabel('搜索历史回合').fill('蓝色钥匙');
  await memory.getByRole('button', { name: '查看第 3 回合原文', exact: true }).click(); await expect(memory).toContainText('约定下周三');
  await page.keyboard.press('Escape'); expect(await reader.evaluate((el) => el.scrollTop)).toBe(220);
  await goHome(page); await page.locator('.lib-top .back').click(); await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('布局测试'); await page.getByLabel('年龄', { exact: true }).fill('28'); await page.getByRole('radio', { name: '女性', exact: true }).check();
  await page.getByRole('button', { name: /下一步/ }).click(); await expect(page.getByRole('radio', { name: '自由选择', exact: true })).toBeChecked(); await expect(page.getByLabel('内置职业技能', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
});

test('工作流默认一行且无外置工具与冗余说明，展开保留入口和输入空间', async ({ page }, info) => {
  const before = await seed(page), workflow = page.getByRole('region', { name: '三阶段工作流', exact: true });
  const disclosure = page.locator('.workflow-disclosure'), summary = workflowSummary(page);
  await expect(disclosure).not.toHaveAttribute('open'); await expect(summary).toContainText('详情');
  expect((await workflow.boundingBox())!.height).toBeLessThanOrEqual(44);
  await expect(workflow.locator('button:visible')).toHaveCount(info.project.name === 'desktop' ? 1 : 0);
  await expect(page.locator('.composer-tools > .stage-responses, .composer-tools > .runtime-log')).toHaveCount(0);
  for (const text of ['三阶段校验完成后自动原子结算', '自动执行会保留已完成阶段', '高级手动操作：', '手动启动新尝试；', '保留正文及合法变量；', '仅保存后续尝试偏好'])
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  const collapsedHeight = (await page.getByTestId('story-reader').boundingBox())!.height;
  await page.getByTestId('story-reader').evaluate(el => { el.scrollTop = 0; });
  await fit(page); await page.screenshot({ path: `docs/screenshots/compact-workflow/after-${info.project.name}-collapsed.png` });
  await workflowTrigger(page).click();
  await expect(page.getByRole('button', { name: '继续未完成阶段', exact: true })).toBeVisible();
  await expect(page.locator('.workflow-stages > li')).toHaveCount(3);
  await expect(page.getByText('重试与变更详情', { exact: true })).toBeVisible();
  await fit(page); await page.screenshot({ path: `docs/screenshots/compact-workflow/after-${info.project.name}-expanded.png` });
  await workflowTrigger(page).click(); await fit(page);
  expect((await page.getByTestId('story-reader').boundingBox())!.height).toBe(collapsedHeight);
  expect(await stored(page)).toEqual(before);
});
