import { test, expect } from './helpers/test';
import type { Page, Locator } from '@playwright/test';
import { openWorkflowStage } from './helpers/gameLayout';
const modelPosts = new WeakMap<Page, number>();
function watchRequests(page: Page) {
  if (modelPosts.has(page)) return;
  modelPosts.set(page, 0);
  page.on('request', request => { if (request.method() === 'POST') modelPosts.set(page, (modelPosts.get(page) ?? 0) + 1); });
}
const entries = ['NPC', '势力组织', '地图', '物品栏', '世界事件', '历史时间轴', '记忆'];
async function seed(page: Page) {
  watchRequests(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/mobileArchives.ts', '/src/tests/fixtures/game.ts', '/src/domain/drafts.ts', '/src/ui/settings/model.ts', '/src/domain/state.ts'];
    const [{ SaveRepository }, { mobileArchivesState }, { npc }, { createTurnDraft }, { defaultSettings, settingsKey }, { GameStateSchema }] = await Promise.all(paths.map(p => import(p)));
    const state = mobileArchivesState(30);
    state.protagonist.healthText = '完整身体状态。'.repeat(150); state.protagonist.emotionText = '完整情绪说明。'.repeat(150);
    state.protagonist.background = '完整人物背景。'.repeat(300) + '人物背景末尾';
    for (let n = 0; n < 120; n++) { const id = `sheet-npc-${n}`; state.npc[id] = { ...npc(id), name: `测试人物${n}`, relationshipText: '既有关系说明。'.repeat(100), locationId: state.protagonist.locationId }; }
    GameStateSchema.parse(state);
    const settings = defaultSettings(); for (const s of Object.values(settings.memory.summaries) as { automatic: boolean }[]) s.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const repo = await SaveRepository.open(); repo.close();
    // Same synthetic archive fixture insertion used by existing archive E2E.
    await new Promise<void>((resolve, reject) => { const req = indexedDB.open('heijinwangchao'); req.onsuccess = () => {
      const db = req.result, tx = db.transaction(['saves', 'drafts'], 'readwrite'); tx.objectStore('saves').put(state);
      tx.objectStore('drafts').put(createTurnDraft(state.saveId, state.revision, 'sheet-test', 'regular', ''));
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; req.onerror = () => reject(req.error); });
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); await page.evaluate(() => document.fonts.ready);
}
async function stored(page: Page) { return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }
async function open(page: Page, name: '人物' | '世界资料') { await page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name, exact: true }).click(); const d = page.getByRole('dialog', { name: name === '人物' ? '此时此地' : name, exact: true }); await expect(d).toBeVisible(); return d; }
async function swipe(page: Page, target: Locator, dy: number) {
  const box = (await target.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let n = 1; n <= 8; n++) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.max(2, y + dy * n / 8) }] }); await page.waitForTimeout(15); }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach();
  } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, Math.max(2, y + dy), { steps: 8 }); await page.mouse.up(); }
}
async function bottom(page: Page, dialog: Locator) {
  const body = dialog.locator(':scope>.modal-body'); await body.evaluate(el => el.scrollTop = el.scrollHeight);
  expect(await body.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  watchRequests(page);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
test.afterEach(async ({ page }, info) => {
  const requests = modelPosts.get(page) ?? 0;
  await info.attach('measured-requests', { body: JSON.stringify({ postRequests: requests }), contentType: 'application/json' });
  expect(requests, 'Pure sheet browsing must not send any model POST').toBe(0);
});

test('手机: 人物上拉展开、原生长文滚动、收起及人物/经济二级入口', async ({ page }, info) => {
  await seed(page); const before = await stored(page); const dialog = await open(page, '人物'), toggle = dialog.getByRole('button', { name: '展开面板', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); const initial = (await dialog.boundingBox())!;
  await swipe(page, dialog.locator('.mobile-sheet-grab'), -150);
  await expect(dialog.getByRole('button', { name: '收起面板', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect((await dialog.boundingBox())!.height).toBeGreaterThan(initial.height + 50);
  await page.screenshot({ path: info.outputPath('status-expanded-top.png') });
  const body = dialog.locator(':scope>.modal-body'); await swipe(page, body, -170); await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  // Native content pulls at the top must never dismiss the info sheet.
  await body.evaluate(el => el.scrollTop = 0); await swipe(page, body, 140); await expect(dialog).toBeVisible();
  await body.evaluate(el => el.scrollTop = 100); await dialog.getByRole('button', { name: '收起面板', exact: true }).click();
  expect(await body.evaluate(el => el.scrollTop)).toBe(100); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click(); await bottom(page, dialog); await expect(dialog.getByRole('button', { name: '经济与资产', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('status-expanded.png') });
  await dialog.getByRole('button', { name: '人物档案', exact: true }).click(); const profile = page.getByRole('dialog', { name: '人物档案', exact: true });
  await expect(profile).toBeVisible(); await expect(profile).not.toHaveClass(/sheet-expandable/); await bottom(page, profile);
  await expect(profile).toContainText('人物背景末尾'); await page.keyboard.press('Escape');
  const again = await open(page, '人物'); await again.getByRole('button', { name: '经济与资产', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '经济与资产', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  expect(await stored(page)).toEqual(before); expect(await page.locator('dialog[open]').count()).toBe(0); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('手机: 世界目录可展开收起、七分类、长 NPC 与事件阅读及返回', async ({ page }, info) => {
  await seed(page); const before = await stored(page), directory = await open(page, '世界资料'), initial = (await directory.boundingBox())!;
  await swipe(page, directory.locator('.mobile-sheet-grab'), -140); await expect(directory.getByRole('button', { name: '收起面板' })).toBeVisible();
  expect((await directory.boundingBox())!.height).toBeGreaterThan(initial.height + 50); await page.screenshot({ path: info.outputPath('world-expanded.png') });
  await swipe(page, directory.locator('.mobile-sheet-grab'), 130); await expect(directory.getByRole('button', { name: '展开面板' })).toBeVisible();
  await swipe(page, directory.locator('.mobile-sheet-grab'), 130); await expect(directory).toHaveCount(0);
  for (const name of entries) {
    const menu = await open(page, '世界资料'); await menu.getByRole('button', { name, exact: true }).click(); const paper = page.getByRole('dialog', { name, exact: true }); await expect(paper).toBeVisible();
    await expect(paper).not.toHaveClass(/sheet-expandable/);
    if (name === 'NPC') { const search = paper.getByRole('textbox', { name: /搜索人物/ }); await search.fill('测试人物'); await expect(paper.getByRole('button', { name: '下一页人物', exact: true })).toBeEnabled(); await paper.getByRole('button', { name: '下一页人物', exact: true }).click(); await paper.locator('[data-npc-id]').first().click(); await expect(paper.getByRole('region', { name: '人物详情', exact: true })).toContainText('既有关系说明'); }
    await bottom(page, paper); await expect(paper).toBeVisible(); await page.screenshot({ path: info.outputPath(`archive-${name}.png`) }); await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
  expect(await stored(page)).toEqual(before);
});

test('手机: 视口工具栏、横竖屏、安全区预留、取消手势和原生关闭不残留锁', async ({ page }, info) => {
  await seed(page); const before = await stored(page); const d = await open(page, '人物'); await d.getByRole('button', { name: '展开面板' }).click();
  const grab = d.locator('.mobile-sheet-grab'), b = (await grab.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await d.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up(); await expect(d).toBeVisible(); await expect(d.getByRole('button', { name: '收起面板' })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 470 }); Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, value: 24 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  const rect = (await d.boundingBox())!; expect(rect.y).toBeGreaterThanOrEqual(24); expect(rect.y + rect.height).toBeLessThanOrEqual(495);
  // Reserved padding simulation is not a claim of actual Safari env() emulation.
  await page.addStyleTag({ content: '.mobile-status-sheet>.modal-body{padding-bottom:52px!important}' }); await bottom(page, d);
  const action = (await d.getByRole('button', { name: '经济与资产', exact: true }).boundingBox())!; expect(action.y + action.height).toBeLessThanOrEqual(494 - 34);
  await page.screenshot({ path: info.outputPath('toolbar-reserved-area.png') });
  await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); Reflect.deleteProperty(window.visualViewport!, 'offsetTop'); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await page.setViewportSize({ width: 844, height: 390 }); await bottom(page, d); const landscape = (await d.boundingBox())!; expect(landscape.y + landscape.height).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 390, height: 844 }); await d.getByRole('button', { name: '关闭资料界面', exact: true }).click();
  for (let n = 0; n < 5; n++) { const menu = await open(page, n % 2 ? '世界资料' : '人物'); await menu.getByRole('button', { name: '展开面板' }).click(); await page.keyboard.press('Escape'); await expect(page.locator('dialog[open]')).toHaveCount(0); }
  const menu = await open(page, '世界资料'), top = (await menu.boundingBox())!.y; await page.mouse.click(3, top / 2); await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '设置', exact: true }).click(); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await expect(settings).toBeVisible(); await expect(settings).not.toHaveClass(/sheet-expandable/); await page.keyboard.press('Escape');
  await openWorkflowStage(page, 'story'); await expect(page.locator('.workflow-disclosure')).toHaveAttribute('open', ''); await page.keyboard.press('Escape');
  expect(await stored(page)).toEqual(before);
  await info.attach('read-only', { body: 'Formal Repository state, draft and instance identity are identical before/after browsing.', contentType: 'text/plain' });
});

test('PC: 901/1440 主界面、人物与 NPC 在相同 main 状态下像素一致', async ({ browser }, info) => {
  const pictures: Buffer[][] = [], width = info.project.use.viewport!.width;
  for (const port of [Number(process.env.SHEET_COMPARE_PORT ?? process.env.SHEET_PORT ?? 54151), Number(process.env.SHEET_MAIN_PORT ?? 54152)]) {
    const ctx = await browser.newContext({ baseURL: `http://127.0.0.1:${port}`, viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(() => { const d = new Date(); localStorage.setItem('heijin.notices.hidden-on.v1', [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')); });
      const page = await ctx.newPage(); await page.route('https://**/*', r => r.abort()); await seed(page); const before = await stored(page), images: Buffer[] = [];
      for (const panel of ['game', '人物档案', 'NPC']) {
        if (panel !== 'game') {
          await page.locator(`[data-archive-panel="${panel}"]`).focus();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('dialog', { name: panel, exact: true })).toBeVisible();
        }
        await page.mouse.move(0, 0); await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
        // Use keyboard activation to avoid pointer-hover edge rasterization in the comparison.
        await page.screenshot({ animations: 'disabled' });
        images.push(await page.screenshot({ animations: 'disabled', path: info.outputPath(`${port}-${pictures.length}-${panel}.png`) }));
        await info.attach(`${port}-${pictures.length}-${panel}-layout`, { contentType: 'application/json', body: JSON.stringify(await page.locator('.status-actions button').first().evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), parentScroll: el.parentElement?.parentElement?.scrollTop }))) });
        if (panel !== 'game') await page.keyboard.press('Escape');
      }
      expect(await stored(page)).toEqual(before);
      expect(modelPosts.get(page)).toBe(0);
      await info.attach(`${port}-actual-page-requests`, { body: JSON.stringify({ postRequests: modelPosts.get(page) }), contentType: 'application/json' });
      pictures.push(images);
    } finally { await ctx.close(); }
  }
  for (let n = 0; n < 3; n++) expect(pictures[0][n].equals(pictures[1][n]), `${width}px picture ${n}`).toBe(true);
});

test('手机: #163 两处展开入口与 #164 持久诊断在同一草稿中共存且只读', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await seed(page);
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { TurnDraftSchema }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open();
    try {
      const draft = await repo.loadDraft('save-a');
      await repo.saveDraft(TurnDraftSchema.parse({ ...draft, draftRevision: draft.draftRevision + 1,
        stageStatus: { ...draft.stageStatus, story: 'failed' }, failures: [{ stage: 'story', attempt: 1,
          storyRevision: draft.storyRevision, errorCode: 'invalid_output', retryable: false }] }), draft.draftRevision);
    } finally { repo.close(); }
  });
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  const before = await stored(page);
  const { openWorkflowDiagnostics } = await import('./helpers/gameLayout');
  await openWorkflowDiagnostics(page);
  const diagnosis = page.getByRole('region', { name: '运行诊断', exact: true });
  await expect(diagnosis.getByRole('region', { name: '持久失败摘要', exact: true })).toContainText('invalid_output');
  await expect(diagnosis).toContainText('本页没有该次请求的详细运行日志');
  await expect(diagnosis).not.toContainText('本次页面尚无错误');
  await page.screenshot({ path: info.outputPath('integrated-persisted-diagnostics.png') });
  await page.keyboard.press('Escape');
  for (const name of ['人物', '世界资料'] as const) {
    const dialog = await open(page, name);
    await expect(dialog).toHaveClass(/sheet-expandable/);
    await dialog.getByRole('button', { name: '展开面板', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '收起面板', exact: true })).toHaveAttribute('aria-expanded', 'true');
    // Main also fits the directory at 420px. Use a genuine short viewport, not injected CSS.
    await page.setViewportSize({ width: 390, height: 300 });
    const body = dialog.locator(':scope>.modal-body');
    await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    await swipe(page, body, -130);
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await bottom(page, dialog);
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: info.outputPath(name === '人物' ? 'integrated-status-scroll.png' : 'integrated-world-scroll.png') });
    await dialog.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 640 });
  }
  await openWorkflowDiagnostics(page);
  await expect(page.getByRole('region', { name: '持久失败摘要', exact: true })).toContainText('invalid_output');
  expect(await stored(page)).toEqual(before);
  expect(modelPosts.get(page)).toBe(0);
});
