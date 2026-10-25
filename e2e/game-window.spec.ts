import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seed(page: Page, mode: 'long' | 'complete' | 'history' = 'long') {
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
      await repo.saveDraft(rerollStory(initial, { turnKind: initial.turnKind, narrative: '【旁白】城市的灯光依次亮起。你望向街道，行人从身边经过。\n\n'.repeat(160), summary: '主角观察街道。', variableGuide: [] }), 0);
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
  const input = await page.getByLabel('你的行动', { exact: true }).boundingBox(), header = await page.locator('.app-header').boundingBox(), footer = await page.getByRole('button', { name: '发送', exact: true }).boundingBox();
  expect(input).not.toBeNull(); expect(footer).not.toBeNull(); expect(header).not.toBeNull();
  const limit = height ?? (await page.evaluate(() => innerHeight));
  expect(input!.y).toBeGreaterThanOrEqual(header!.height); expect(input!.y + input!.height).toBeLessThanOrEqual(limit + 1);
  const geometry = await page.locator('.app-shell-game, .app-header, .game-layout, .story-column, .composer, .composer-tools, #player-input, .composer-footer').evaluateAll((elements) => elements.map((el) => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { element: el.className || el.id, y: rect.y, height: rect.height, min: css.minHeight, max: css.maxHeight, flex: css.flex };
  }));
  expect(footer!.y + footer!.height, JSON.stringify(geometry)).toBeLessThanOrEqual(limit + 1);
  expect(await page.getByLabel('你的行动', { exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
  })).toBe(true);
}
async function openSidebar(page: Page, selector: string) {
  const details = page.locator(`${selector} > details`);
  if (!(await details.evaluate((el) => el.hasAttribute('open')))) await details.locator(':scope > summary').click();
}

test('全窗口：长正文不撑高页面，标准/较小窗口和缩放尺寸均可输入', async ({ page }, info) => {
  const before = await seed(page);
  const sizes = info.project.name === 'desktop' ? [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 820, height: 540 }] : [{ width: 392, height: 780 }, { width: 360, height: 640 }];
  for (const size of sizes) {
    await page.setViewportSize(size); await fit(page);
    expect((await page.getByTestId('story-reader').boundingBox())!.height).toBeGreaterThan(50);
    await page.getByLabel('你的行动', { exact: true }).fill('保留待发送行动');
  }
  expect(await stored(page)).toEqual(before); await page.screenshot({ path: info.outputPath('small-window.png') });
});

test('三栏独立滚动；移动端侧栏默认收起且可独立展开', async ({ page }, info) => {
  await seed(page);
  if (info.project.name === 'mobile') {
    await expect(page.locator('.hero-sidebar > details')).not.toHaveAttribute('open');
    await expect(page.locator('.world-sidebar > details')).not.toHaveAttribute('open');
  }
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 1100 : 392, height: 480 });
  await openSidebar(page, '.hero-sidebar'); await openSidebar(page, '.world-sidebar');
  const reader = page.getByTestId('story-reader'), left = page.locator(info.project.name === 'desktop' ? '.hero-sidebar' : '.hero-sidebar .sidebar-body'), right = page.locator(info.project.name === 'desktop' ? '.world-sidebar' : '.world-sidebar .sidebar-body');
  await reader.evaluate((el) => { el.scrollTop = 300; });
  for (const area of [left, right]) {
    expect(await area.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await area.evaluate((el) => { el.scrollTop = 120; }); expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await reader.evaluate((el) => el.scrollTop)).toBe(300);
  }
  expect(await page.evaluate(() => scrollY)).toBe(0); await fit(page);
});

test('默认紧凑工作流，键盘展开/折叠不改输入、草稿或正式状态', async ({ page }, info) => {
  const before = await seed(page), disclosure = page.locator('.workflow-disclosure'), summary = disclosure.locator(':scope > summary');
  await expect(disclosure).not.toHaveAttribute('open'); await expect(summary).toContainText('等待继续');
  await expect(page.getByRole('button', { name: '生成变量候选', exact: true })).toBeHidden();
  await page.getByLabel('你的行动', { exact: true }).fill('我准备阅读资料');
  await summary.focus(); await page.keyboard.press('Enter'); await expect(disclosure).toHaveAttribute('open');
  await expect(page.getByRole('button', { name: '生成变量候选', exact: true })).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter'); await expect(disclosure).not.toHaveAttribute('open');
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('我准备阅读资料');
  expect(await stored(page)).toEqual(before); await fit(page); await page.screenshot({ path: info.outputPath('reading.png') });
});

test('已完成草稿与V1.0展示刷新一致，不改变旧存档及npm/Schema含义', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.version')).toHaveText('V1.0');
  const before = await seed(page, 'complete');
  await expect(page.locator('.version')).toHaveText('V1.0'); await expect(page.locator('.app-header')).not.toContainText('M5-P3');
  await expect(page.locator('.workflow summary').first()).toContainText('三阶段候选已完成');
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); expect(await stored(page)).toEqual(before);
  await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open');
});

test('生成中折叠不打断；取消和错误不被隐藏，Roll成功保留正式状态', async ({ page }) => {
  const before = await seed(page); let mode: 'hold' | 'error' | 'success' = 'hold', release!: () => void, calls = 0;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://layout.mock.invalid/**', async (route) => {
    const selected = mode; calls++; if (selected === 'hold') await hold;
    const text = '<thinking>本轮创作提纲：按现有地点保持人物连续。</thinking><正文>【旁白】你仍在街边，行人经过身旁。</正文><短期记忆>主角继续观察街道。</短期记忆><变量规划>[]</变量规划>';
    await route.fulfill(selected === 'error' ? { status: 401, body: 'private-provider-error' } : { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }).catch(() => undefined);
  });
  await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  const summary = page.locator('.workflow-disclosure > summary'); await expect(summary).toContainText('正在生成正文');
  await summary.click(); await summary.click(); await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: '取消生成', exact: true }).click(); await expect(summary).toContainText('已取消');
  release(); expect((await stored(page)).draft.story).toEqual(before.draft.story);
  mode = 'error'; await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect(summary).toContainText('需要处理'); await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.locator('.workflow-disclosure')).not.toHaveAttribute('open'); expect((await stored(page)).state).toEqual(before.state);
  mode = 'success'; await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect(page.getByTestId('story-reader')).toContainText('你仍在街边');
  await expect(summary).toContainText('等待继续'); expect((await stored(page)).state).toEqual(before.state); expect(calls).toBe(3);
});

test('缩短视口及模拟软键盘VisualViewport不遮住输入和发送', async ({ page }) => {
  await seed(page); await page.setViewportSize({ width: 392, height: 640 });
  await expect(page.locator('.hero-sidebar > details')).not.toHaveAttribute('open');
  await openSidebar(page, '.hero-sidebar'); await openSidebar(page, '.world-sidebar');
  await page.getByLabel('你的行动', { exact: true }).focus();
  await expect(page.locator('.hero-sidebar > details')).not.toHaveAttribute('open');
  await expect(page.locator('.world-sidebar > details')).not.toHaveAttribute('open');
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
  await openSidebar(page, '.world-sidebar'); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  const memory = page.getByRole('dialog', { name: '记忆', exact: true });
  await memory.getByLabel('搜索历史回合').fill('蓝色钥匙');
  await memory.getByRole('button', { name: '查看第 3 回合原文', exact: true }).click(); await expect(memory).toContainText('约定下周三');
  await page.keyboard.press('Escape'); expect(await reader.evaluate((el) => el.scrollTop)).toBe(220);
  await page.getByRole('button', { name: '游戏首页', exact: true }).click(); await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('布局测试'); await page.getByLabel('年龄', { exact: true }).fill('28'); await page.getByLabel('性别', { exact: true }).fill('女');
  await page.getByRole('button', { name: /下一步/ }).click(); await expect(page.getByLabel('个人技能与专长')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
});
