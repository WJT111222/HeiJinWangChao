import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test, expect } from './helpers/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { paintedContrast, screenshotDifference } from './helpers/readabilityContrast';
import { cities, seedDayReading, setAppearance, repositoryValue } from './helpers/dayReadability';
import { openWorkflow, openWorkflowStage, openWorkflowDiagnostics } from './helpers/gameLayout';

async function contrast(page: Page, target: Locator, info: TestInfo, name: string, threshold?: number, pseudo: string | null = null) {
  const row = await paintedContrast(page, target, pseudo);
  await info.attach(name, { contentType: 'application/json', body: JSON.stringify(row) });
  expect(row.ratio, `${name}: ${JSON.stringify(row)}`).toBeGreaterThanOrEqual(threshold ?? row.threshold);
  return row;
}
async function shot(page: Page, info: TestInfo, name: string) {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

for (const city of cities) test(`四城正文 ${city}：主角/NPC/旁白、当前/历史、日夜与系统`, async ({ page }, info) => {
  let posts = 0; page.on('request', req => { if (req.method() === 'POST') posts++; });
  await seedDayReading(page, city);
  const before = await repositoryValue(page), reader = page.getByTestId('story-reader');
  await expect(page.locator('.story-entry')).toHaveCount(2);
  for (const state of ['latest', 'past']) {
    const entry = page.locator(`.story-entry.${state}`).first();
    for (const [name, selector] of [['hero', '.story-dialogue-hero .story-bubble'], ['speaker', '.story-dialogue-hero .story-speaker'],
      ['npc', '.story-dialogue:not(.story-dialogue-hero) .story-bubble'], ['npc-speaker', '.story-dialogue:not(.story-dialogue-hero) .story-speaker'], ['narration', '.story-narration'], ['scene', '.c-sub']] as const)
      await contrast(page, entry.locator(selector).first(), info, `${city}-${state}-${name}`, 4.5);
  }
  const hero = page.locator('.story-entry.latest .story-dialogue-hero .story-bubble');
  for (const pseudo of ['::before', '::after']) await contrast(page, hero, info, `${city}-hero-${pseudo}`, 4.5, pseudo);
  expect(await hero.evaluate(el => parseFloat(getComputedStyle(el).borderLeftWidth))).toBe(2);
  expect(await page.locator('.story-entry.latest .story-dialogue:not(.story-dialogue-hero) .story-bubble').evaluate(el => parseFloat(getComputedStyle(el).borderLeftWidth))).toBe(1);
  await reader.evaluate(el => el.scrollTop = 0); await shot(page, info, `${city}-day-history`);
  await reader.evaluate(el => el.scrollTop = el.scrollHeight); await shot(page, info, `${city}-day-current`);
  await setAppearance(page, 'night'); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'night');
  const night = await page.locator('.story-entry.latest .story-dialogue-hero .story-bubble').evaluate(el => getComputedStyle(el).color);
  expect(night).toBe('rgb(241, 230, 200)');
  await shot(page, info, `${city}-night`);
  await page.emulateMedia({ colorScheme: 'light' }); await setAppearance(page, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
  await contrast(page, page.locator('.story-entry.latest .story-dialogue-hero .story-bubble'), info, `${city}-system-light`, 4.5);
  await shot(page, info, `${city}-system-light`);
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'night');
  expect(await page.locator('.story-entry.latest .story-dialogue-hero .story-bubble').evaluate(el => getComputedStyle(el).color)).toBe(night);
  expect(await repositoryValue(page)).toEqual(before); expect(posts).toBe(0);
});

test('哈尔滨铭牌：不透明钢青、普通/历史，冰刻形状与缩放', async ({ page }, info) => {
  await seedDayReading(page, 'harbin');
  for (const state of ['latest', 'past']) {
    const entry = page.locator(`.story-entry.${state}`).first(), plate = entry.locator('.plate');
    expect(await plate.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await plate.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px');
    for (const part of ['p-num', 'p-cn', 'p-sub']) await contrast(page, entry.locator(`.${part}`), info, `harbin-${state}-${part}`);
    await plate.scrollIntoViewIfNeeded(); await shot(page, info, `harbin-${state}-plate`);
  }
  // A legal preselected Story draft exercises the separate grayscale rule as well.
  await page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', d = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(p), { rerollStory } = await import(d), repo = await SaveRepository.open();
    try {
      let draft = await repo.loadDraft('save-a');
      draft = await repo.bindTurnAction(draft, '继续观察街道', true, true);
      await repo.saveDraft(rerollStory(draft, { turnKind: 'regular', narrative: '【旁白】晨光照在街道上。', summary: '合成草稿', variableGuide: [], actionOptions: ['观察', '询问', '等待'] }), draft.draftRevision);
    } finally { repo.close(); }
  });
  await page.reload(); const draft = page.locator('.chapter[data-state=draft]'); await expect(draft).toBeVisible();
  expect(await draft.locator('.plate').evaluate(el => getComputedStyle(el).filter)).toBe('none');
  for (const part of ['p-num', 'p-cn', 'p-sub']) await contrast(page, draft.locator(`.${part}`), info, `harbin-draft-${part}`);
  await shot(page, info, 'harbin-story-draft');
});

for (const mode of ['pending', 'running', 'failed', 'complete'] as const) test(`工作流 ${mode}：深色浮层标题/正文/按钮、焦点、诊断、预览`, async ({ page }, info) => {
  let response: ServerResponse | undefined, calls = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    for await (const chunk of req) void chunk;
    calls++; response = res;
    if (mode === 'failed') { res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":{"message":"Mock authorization failure"}}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '<thinking>实际Mock规划</thinking><正文>【旁白】晨光照在街道上。\n【沈砚】今天先看看街坊们有什么消息。\n' } }] }) + '\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing Mock port');
  try {
    await seedDayReading(page, 'harbin', 'day', mode, `http://127.0.0.1:${address.port}/v1`);
    const before = await repositoryValue(page);
    if (mode === 'running' || mode === 'failed') {
      await openWorkflow(page); await page.locator('#workflow-pop .workflow-primary button').click();
      await expect.poll(() => calls).toBe(1);
      if (mode === 'running') {
        await expect(page.getByRole('article', { name: '流式正文预览', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        const preview = page.getByRole('article', { name: '流式正文预览', exact: true });
        await preview.locator('.plate').scrollIntoViewIfNeeded();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        expect(await preview.locator('.plate').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
        expect(await preview.locator('.plate').evaluate(el => getComputedStyle(el).filter)).toBe('none');
        for (const part of ['p-num', 'p-cn', 'p-sub']) await contrast(page, preview.locator(`.${part}`), info, `harbin-preview-${part}`);
        await contrast(page, preview.getByTestId('stream-narrative'), info, 'stream-prose', 4.5);
        await shot(page, info, 'harbin-live-preview'); await page.emulateMedia({ reducedMotion: 'reduce' });
      } else {
        await expect.poll(async () => (await repositoryValue(page)).draft?.failures.length).toBeGreaterThan(0);
        const diagnostics = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
        if (await diagnostics.isVisible()) await page.keyboard.press('Escape');
      }
    }
    await openWorkflow(page);
    await contrast(page, page.locator('#workflow-pop .wf-hd h3'), info, `${mode}-workflow-heading`, 4.5);
    await contrast(page, page.locator('#workflow-pop .workflow-fee'), info, `${mode}-workflow-fee`, 4.5);
    const input = page.locator('.workflow-drawer-input');
    if (await input.isVisible()) { await contrast(page, input, info, `${mode}-input-button`, 4.5); await input.focus(); await expect(input).toBeFocused(); await contrast(page, input, info, `${mode}-input-focus`, 4.5); }
    const primary = page.locator('#workflow-pop .workflow-primary button');
    if (await primary.isVisible()) { await contrast(page, primary, info, `${mode}-primary`, 4.5); await primary.focus(); await expect(primary).toBeFocused(); await contrast(page, primary, info, `${mode}-primary-focus`, 4.5); await primary.hover(); await contrast(page, primary, info, `${mode}-primary-hover`, 4.5); await page.mouse.move(0, 0); }
    await shot(page, info, `workflow-${mode}`);
    await openWorkflowStage(page, 'variables');
    await contrast(page, page.locator('#workflow-pop .wf-dt-body .wf-empty'), info, `${mode}-workflow-body`, 4.5);
    // Disabled controls remain disabled; WCAG exempts inactive text. Capture actual styling without claiming AA.
    const action = page.locator('#workflow-pop .wf-dt-act button');
    if (await action.isVisible() && mode !== 'complete') await expect(action).toBeDisabled();
    if (await action.isVisible() && await action.isDisabled()) await info.attach('inactive-control', { body: JSON.stringify(await paintedContrast(page, action)), contentType: 'application/json' });
    if (mode === 'failed') { await contrast(page, page.locator('#workflow-pop .wf-banner-msg p').first(), info, 'workflow-error', 4.5); }
    if (mode === 'failed') {
      const failure = await repositoryValue(page); await openWorkflowDiagnostics(page);
      if ((page.viewportSize()?.width ?? 0) <= 900) {
        await page.getByRole('button', { name: '重试与变更详情', exact: true }).click();
        const diag = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
        await contrast(page, diag.locator('.modal-heading h2'), info, 'diagnostics-title', 4.5);
      }
      await shot(page, info, 'failed-diagnostics'); expect(await repositoryValue(page)).toEqual(failure);
    }
    if (mode === 'running') {
      await primary.click(); await expect.poll(() => response?.destroyed).toBe(true);
      const cancelled = await repositoryValue(page); expect(cancelled.state).toEqual(before.state);
      expect(cancelled.draft?.story).toBeUndefined(); expect(cancelled.draft?.variables).toBeUndefined(); expect(cancelled.draft?.world).toBeUndefined();
      expect(cancelled.draft?.failures).toEqual(before.draft?.failures);
    }
    else { expect((await repositoryValue(page)).state).toEqual(before.state); }
    expect(calls).toBe(mode === 'running' || mode === 'failed' ? 1 : 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('纸页隔离与外观保存：人物/世界/设置、未保存偏好、失败回退', async ({ page }, info) => {
  await seedDayReading(page, 'shanghai'); const before = await repositoryValue(page);
  const mobile = (page.viewportSize()?.width ?? 0) <= 900;
  if (mobile) { await page.getByRole('navigation', { name: '底部导航' }).getByRole('button', { name: '人物', exact: true }).click(); await page.getByRole('button', { name: '人物档案', exact: true }).click(); }
  else await page.locator('[data-archive-panel="人物档案"]').click();
  const profile = page.getByRole('dialog', { name: '人物档案', exact: true }); await expect(profile).toBeVisible();
  expect(await profile.evaluate(el => getComputedStyle(el).getPropertyValue('--text').trim().toLowerCase())).not.toBe('#ece7da');
  await shot(page, info, 'day-profile-paper'); await page.keyboard.press('Escape');
  if (mobile) { await page.getByRole('button', { name: '世界资料', exact: true }).click(); await page.getByRole('dialog', { name: '世界资料', exact: true }).getByRole('button', { name: 'NPC', exact: true }).click(); }
  else await page.locator('[data-archive-panel="NPC"]').click();
  await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toBeVisible(); await shot(page, info, 'day-world-paper'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click(); const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '运行', exact: true }).click(); await settings.getByLabel('请求超时（秒）', { exact: true }).fill('77');
  if (mobile) await settings.getByRole('button', { name: '返回设置', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click(); await settings.getByLabel('正文最低字数', { exact: true }).fill('555');
  if (mobile) await settings.getByRole('button', { name: '返回设置', exact: true }).click();
  await settings.getByRole('button', { name: '外观', exact: true }).click(); await settings.getByRole('radio', { name: /夜间/ }).check();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!).runtime.timeoutSeconds)).toBe(120);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!).prompts.minNarrativeChars)).toBe(5);
  if (mobile) await settings.getByRole('button', { name: '返回设置', exact: true }).click();
  await settings.getByRole('button', { name: '运行', exact: true }).click(); await expect(settings.getByLabel('请求超时（秒）', { exact: true })).toHaveValue('77');
  if (mobile) await settings.getByRole('button', { name: '返回设置', exact: true }).click();
  await settings.getByRole('button', { name: '提示词', exact: true }).click(); await expect(settings.getByLabel('正文最低字数', { exact: true })).toHaveValue('555');
  await settings.getByRole('button', { name: '保存本地设置', exact: true }).click();
  if (mobile) await settings.getByRole('button', { name: '返回设置', exact: true }).click();
  await settings.getByRole('button', { name: '外观', exact: true }).click(); await settings.getByRole('radio', { name: /日间/ }).check();
  await shot(page, info, 'day-appearance-settings');
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'heijin.settings.v1') throw new DOMException('Mock storage rejection'); return original.call(this, key, value); }; });
  await settings.getByRole('radio', { name: /夜间/ }).click(); await expect(settings).toContainText('外观保存失败');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day'); expect(await repositoryValue(page)).toEqual(before);
});

test('夜间四城关键样式与修复前一致，其他三城日间铭牌不变', async ({ browser }, info) => {
  const width = info.project.use.viewport!.width, height = info.project.use.viewport!.height, mobile = width <= 900;
  for (const city of cities) {
    const pictures: Buffer[] = [], fingerprints: unknown[] = [], dayPlates: unknown[] = [];
    for (const [version, baseURL] of [['before', process.env.READABILITY_BASELINE_URL ?? 'http://127.0.0.1:55324'], ['after', process.env.READABILITY_URL ?? 'http://127.0.0.1:55325']]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
      try {
        await context.addInitScript(() => { const now = new Date(); localStorage.setItem('heijin.notices.hidden-on.v1', [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')); });
        const page = await context.newPage(); await page.route('https://**/*', r => r.abort());
        await seedDayReading(page, city, 'night');
        await page.getByLabel('你的行动', { exact: true }).focus(); await page.getByLabel('你的行动', { exact: true }).blur();
        await page.getByTestId('story-reader').evaluate(el => el.scrollTop = 0); await page.mouse.move(0, 0);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
        pictures.push(await page.screenshot({ path: info.outputPath(`${city}-night-${version}.png`), animations: 'disabled' }));
        const fingerprint = () => page.evaluate(() => {
          const selectors = ['.story-entry.latest .story-dialogue-hero .story-bubble', '.story-entry.past .story-dialogue-hero .story-bubble', '.story-dialogue:not(.story-dialogue-hero) .story-bubble', '.story-speaker', '.plate', '.p-num', '.p-cn', '.p-sub'];
          return selectors.map(selector => { const s = getComputedStyle(document.querySelector(selector)!); return [selector, ...['color', 'background', 'opacity', 'filter', 'transform', '-webkit-text-stroke', 'text-shadow', 'border-left-color'].map(k => s.getPropertyValue(k))]; });
        });
        fingerprints.push(await fingerprint());
        await page.evaluate(() => document.documentElement.dataset.appearance = 'day');
        dayPlates.push((await fingerprint()).slice(4));
      } finally { await context.close(); }
    }
    expect(fingerprints[0], `${city} exact night colors/effects`).toEqual(fingerprints[1]);
    if (city !== 'harbin') expect(dayPlates[0], `${city} day plate unchanged`).toEqual(dayPlates[1]);
    const page = await browser.newPage();
    try {
      const diff = await screenshotDifference(page, pictures[0], pictures[1]);
      await info.attach(`${city}-night-pixel-difference`, { contentType: 'application/json', body: JSON.stringify(diff) });
      expect(diff.maxChannelDelta).toBeLessThanOrEqual(1); expect(diff.differentRatio).toBeLessThanOrEqual(.0001);
    } finally { await page.close(); }
  }
});

test('三项缺陷的同档修复前后量测与截图', async ({ browser }, info) => {
  const width = info.project.use.viewport!.width, height = info.project.use.viewport!.height;
  const versions: Record<string, Record<string, Awaited<ReturnType<typeof paintedContrast>>>> = {};
  for (const [version, baseURL] of [['before', 'http://127.0.0.1:55324'], ['after', `http://127.0.0.1:${process.env.READABILITY_PORT ?? 55325}`]]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, deviceScaleFactor: 1, isMobile: width <= 900, hasTouch: width <= 900, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(() => { const now = new Date(); localStorage.setItem('heijin.notices.hidden-on.v1', [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')); });
      const page = await context.newPage(); await page.route('https://**/*', r => r.abort()); await seedDayReading(page, 'harbin');
      const before = await repositoryValue(page), rows: typeof versions[string] = {};
      rows.hero = await paintedContrast(page, page.locator('.story-entry.latest .story-dialogue-hero .story-bubble'));
      for (const state of ['latest', 'past']) rows[`plate-${state}`] = await paintedContrast(page, page.locator(`.story-entry.${state} .p-sub`).first());
      await page.getByTestId('story-reader').evaluate(el => el.scrollTop = el.scrollHeight); await shot(page, info, `paired-${version}-reading`);
      await openWorkflow(page);
      rows.heading = await paintedContrast(page, page.locator('#workflow-pop .wf-hd h3'));
      if (width <= 900) rows.input = await paintedContrast(page, page.locator('.workflow-drawer-input'));
      await shot(page, info, `paired-${version}-workflow`); expect(await repositoryValue(page)).toEqual(before);
      versions[version] = rows;
    } finally { await context.close(); }
  }
  await info.attach('before-after-contrast', { body: JSON.stringify(versions), contentType: 'application/json' });
  expect(versions.before.hero.ratio).toBeLessThan(4.5); expect(versions.after.hero.ratio).toBeGreaterThanOrEqual(4.5);
  expect(versions.before['plate-latest'].ratio).toBeLessThan(4.5);
  for (const key of Object.keys(versions.after)) expect(versions.after[key].ratio, key).toBeGreaterThanOrEqual(4.5);
  if (width > 900) expect(versions.before.heading.ratio).toBeLessThan(4.5);
  else expect(versions.before.input.ratio).toBeLessThan(4.5);
});

test('旧设置缺外观字段：默认夜间，提示词/运行偏好保留且不自动回写', async ({ page }, info) => {
  await seedDayReading(page, 'chongqing');
  const legacy = await page.evaluate(() => {
    const key = 'heijin.settings.v1', settings = JSON.parse(localStorage.getItem(key)!);
    delete settings.display; settings.runtime.timeoutSeconds = 77; settings.runtime.streamVariables = true;
    settings.prompts.noControl = false; localStorage.setItem(key, JSON.stringify(settings)); return settings;
  });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-appearance', 'night');
  await page.getByRole('button', { name: '设置', exact: true }).click(); const panel = page.getByRole('dialog', { name: '设置', exact: true });
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByLabel('请求超时（秒）', { exact: true })).toHaveValue('77');
  await expect(panel.getByRole('checkbox', { name: '变量管理 · 流式传输', exact: true })).toBeChecked();
  if ((page.viewportSize()?.width ?? 0) <= 900) await panel.getByRole('button', { name: '返回设置', exact: true }).click();
  await panel.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(panel.getByLabel('NoControl（防抢话）', { exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!))).toEqual(legacy);
  await page.keyboard.press('Escape'); await setAppearance(page, 'day');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!));
  expect(saved.runtime).toEqual(legacy.runtime); expect(saved.prompts).toEqual(legacy.prompts); expect(saved.display.appearance).toBe('day');
  await shot(page, info, 'legacy-settings-day');
});
