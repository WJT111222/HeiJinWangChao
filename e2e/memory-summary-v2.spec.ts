import { expect, test } from './helpers/test';
import { seedSummary, summaryPage, summaryState, summaryWire, requestTask } from './helpers/memorySummary';
import { mkdir } from 'node:fs/promises';

test('独立默认开关、参数和完整提示词保存、恢复、未保存提醒、刷新与手机输入', async ({ page }, info) => {
  let requests = 0; await page.route('https://summary.mock.invalid/**', async route => { requests++; await route.fulfill({ json: summaryWire(requestTask(route.request().postDataJSON())) }); });
  await seedSummary(page, { count: 0 }); let settings = await summaryPage(page);
  await expect(settings.getByLabel('即时记忆完整回合数')).toHaveValue('10');
  await settings.getByLabel('即时记忆完整回合数').fill('14');
  for (const name of ['短期 → 中期', '中期 → 长期', 'NPC 短期 → 中期']) {
    await expect(settings.getByLabel(`启用 ${name}`, { exact: true })).toHaveCount(0); await expect(settings.getByLabel(`自动总结 ${name}`, { exact: true })).toBeChecked();
  }
  await settings.getByLabel('完整内容提示词 · 短期 → 中期').fill('独立短期内容：至少123个事件，语言与篇幅由我决定。');
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  const unsaved = page.getByRole('dialog', { name: '记忆设置尚未保存', exact: true }); await expect(unsaved).toBeVisible(); await unsaved.getByRole('button', { name: '继续编辑' }).click();
  for (const [name, threshold, batch] of [['短期 → 中期', 32, 11], ['中期 → 长期', 52, 12], ['NPC 短期 → 中期', 25, 18]] as const) {
    await settings.getByLabel(`触发阈值 · ${name}`).fill(String(threshold)); await settings.getByLabel(`每次总结条数 · ${name}`).fill(String(batch));
  }
  await settings.getByLabel('完整内容提示词 · 中期 → 长期').fill('独立长期提示词标记。'); await settings.getByLabel('完整内容提示词 · NPC 短期 → 中期').fill('独立人物第三人称提示词标记。');
  await settings.getByRole('button', { name: '保存记忆设置', exact: true }).click(); await expect(settings).toContainText('记忆设置已保存');
  await settings.getByRole('button', { name: '关闭资料界面' }).click(); await page.reload(); settings = await summaryPage(page);
  await expect(settings.getByLabel('即时记忆完整回合数')).toHaveValue('14');
  await expect(settings.getByLabel('每次总结条数 · NPC 短期 → 中期')).toHaveValue('18');
  await expect(settings.getByLabel('完整内容提示词 · 短期 → 中期')).toHaveValue(/独立短期内容/);
  await expect(settings.getByLabel('完整内容提示词 · 中期 → 长期')).toHaveValue('独立长期提示词标记。');
  await settings.getByRole('button', { name: '恢复默认提示词 · NPC 短期 → 中期' }).click(); await expect(settings.getByLabel('完整内容提示词 · NPC 短期 → 中期')).toHaveValue(/心理/);
  await settings.getByRole('button', { name: '保存记忆设置', exact: true }).click();
  await settings.getByLabel('完整内容提示词 · 中期 → 长期').focus();
  await page.evaluate(() => { const viewport = window.visualViewport!; Object.defineProperty(viewport, 'height', { configurable: true, value: 360 }); viewport.dispatchEvent(new Event('resize')); });
  await settings.getByLabel('完整内容提示词 · 中期 → 长期').scrollIntoViewIfNeeded(); await expect(settings.getByLabel('完整内容提示词 · 中期 → 长期')).toBeVisible();
  await page.evaluate(() => { const viewport = window.visualViewport!; Object.defineProperty(viewport, 'height', { configurable: true, value: innerHeight }); viewport.dispatchEvent(new Event('resize')); });
  await settings.getByRole('heading', { name: '记忆总结', exact: true }).scrollIntoViewIfNeeded();
  await mkdir('docs/memory-summary-v2/screenshots', { recursive: true }); await page.screenshot({ path: `docs/memory-summary-v2/screenshots/settings-${info.project.name}.png` });
  expect(requests).toBe(0);
});

test('立即NPC总结明确选择目标，18条可按15条处理；原文与正式revision不变', async ({ page }) => {
  const tasks: Record<string, unknown>[] = [];
  await page.route('https://summary.mock.invalid/**', async route => { const task = requestTask(route.request().postDataJSON()); tasks.push(task); await route.fulfill({ json: summaryWire(task) }); });
  await seedSummary(page, { count: 31, npcCount: 18, automatic: false, secondNpc: true }); const before = await summaryState(page), settings = await summaryPage(page);
  const button = settings.getByRole('button', { name: '立即总结 · NPC 短期 → 中期', exact: true }); await expect(button).toBeDisabled();
  await settings.getByLabel('总结目标 NPC').selectOption('npc-a'); await button.click();
  await expect.poll(async () => (await summaryState(page)).memories.npcSummaries['npc-a']?.length).toBe(1);
  const after = await summaryState(page); expect(after.npc).toEqual(before.npc); expect(after.revision).toBe(before.revision); expect(after.journal).toEqual(before.journal);
  expect(after.memories.npcSummaries['npc-a'][0].npcProvenance.sourceMemoryIds).toHaveLength(15); expect(after.memories.npcSummaries['npc-b']).toBeUndefined();
  expect(tasks).toHaveLength(1); expect(tasks[0].npcId).toBe('npc-a');
});

test('NPC先失败也不阻断公共两类，失败重试仅一次；暂停只保存本类关闭', async ({ page }, info) => {
  const tasks: string[] = []; let failNpc = true;
  await page.route('https://summary.mock.invalid/**', async route => { const task = requestTask(route.request().postDataJSON()); tasks.push(String(task.task));
    if (task.task === 'memory.npc_summarize' && failNpc) { await route.fulfill({ status: 401, json: { error: { message: 'must not expose mock-summary-secret or private raw' } } }); return; }
    await route.fulfill({ json: summaryWire(task) }); });
  // Start below threshold, then authorize default automatic configurations by saved settings.
  await seedSummary(page, { count: 90, npcCount: 20, automatic: false, allKinds: true });
  await page.evaluate(() => { localStorage.setItem('heijin.summary.schedule:save-a', JSON.stringify({ cursor: 2 })); const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!); for (const value of Object.values(settings.memory.summaries) as { automatic: boolean }[]) value.automatic = true; localStorage.setItem('heijin.settings.v1', JSON.stringify(settings)); });
  await page.reload(); const failure = page.getByRole('dialog', { name: 'NPC 短期 → 中期总结失败', exact: true }); await expect(failure).toBeVisible();
  await expect.poll(() => tasks.length).toBe(3); expect(tasks[0]).toBe('memory.npc_summarize');
  expect((await summaryState(page)).memories.long).toHaveLength(1); await expect(failure).not.toContainText('mock-summary-secret');
  await mkdir('docs/memory-summary-v2/screenshots', { recursive: true }); await page.screenshot({ path: `docs/memory-summary-v2/screenshots/failure-${info.project.name}.png` });
  failNpc = false; await failure.getByRole('button', { name: '重新生成', exact: true }).click(); await expect(failure).toHaveCount(0); expect(tasks).toHaveLength(4);
  await expect.poll(async () => (await summaryState(page)).memories.npcSummaries['npc-a']?.[0]?.npcProvenance.sourceMemoryIds.length).toBe(15);
  // Create another NPC batch, fail it, then explicitly pause only the NPC function.
  failNpc = true;
  await page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); const state = await repo.load('save-a'); repo.close();
    for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index)!; if (key.startsWith('heijin.summary.rate:')) localStorage.setItem(key, JSON.stringify([Date.now() - 61000, Date.now() - 61000, Date.now() - 61000])); }
    for (let index = 0; index < 15; index++) state.npc['npc-a'].memories.push({ ...state.npc['npc-a'].memories.at(-1), id: `later-${index}`, createdAtGameTime: state.worldClock });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('heijinwangchao'); r.onsuccess = () => { const db = r.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; });
  });
  await page.reload(); await expect(failure).toBeVisible(); await failure.getByRole('button', { name: '暂停自动总结', exact: true }).click(); await expect(failure).toHaveCount(0);
  await page.reload(); const settings = await summaryPage(page); await expect(settings.getByLabel('自动总结 NPC 短期 → 中期', { exact: true })).not.toBeChecked();
  await expect(settings.getByLabel('自动总结 短期 → 中期', { exact: true })).toBeChecked(); await expect(settings.getByLabel('自动总结 中期 → 长期', { exact: true })).toBeChecked();
});

for (const [kind, name, count] of [['short', '短期 → 中期', 31], ['medium', '中期 → 长期', 51]] as const) test(`${name}失败暂停独立持久化，不关闭另外两类`, async ({ page }) => {
  let calls = 0; await page.route('https://summary.mock.invalid/**', async route => { calls++; await route.fulfill({ status: 429, json: {} }); });
  await seedSummary(page, { count, publicLayer: kind }); const original = await summaryState(page);
  const failed = page.getByRole('dialog', { name: `${name}总结失败`, exact: true }); await expect(failed).toBeVisible();
  await failed.getByRole('button', { name: '暂停自动总结', exact: true }).click(); await page.reload();
  const settings = await summaryPage(page); await expect(settings.getByLabel(`自动总结 ${name}`, { exact: true })).not.toBeChecked();
  for (const other of ['短期 → 中期', '中期 → 长期', 'NPC 短期 → 中期']) if (other !== name) await expect(settings.getByLabel(`自动总结 ${other}`, { exact: true })).toBeChecked();
  expect(await summaryState(page)).toEqual(original); expect(calls).toBe(1);
});

test('三类同时失败只顺序显示一个弹窗，各自暂停且刷新不重试', async ({ page }) => {
  let requests = 0;
  await page.route('https://summary.mock.invalid/**', async route => { requests++; await route.fulfill({ status: 503, json: {} }); });
  await seedSummary(page, { allKinds: true, npcCount: 20 });
  await expect.poll(() => requests).toBe(3);
  for (const name of ['短期 → 中期', '中期 → 长期', 'NPC 短期 → 中期']) {
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const failure = page.getByRole('dialog', { name: `${name}总结失败`, exact: true });
    await expect(failure).toBeVisible(); await failure.getByRole('button', { name: '暂停自动总结', exact: true }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0); await page.reload();
  const settings = await summaryPage(page);
  for (const name of ['短期 → 中期', '中期 → 长期', 'NPC 短期 → 中期']) await expect(settings.getByLabel(`自动总结 ${name}`, { exact: true })).not.toBeChecked();
  expect(requests).toBe(3);
});

test('旧默认关闭安全延续、逐项开启与刷新持久化，设置页不再显示冗余说明', async ({ page }) => {
  let calls = 0; await page.route('https://summary.mock.invalid/**', async route => { calls++; await route.abort(); });
  await seedSummary(page, { count: 0 });
  let settings = await summaryPage(page);
  await expect(settings).not.toContainText('旧版自动维护');
  await expect(settings).not.toContainText('记忆总结模型：');
  await expect(settings).not.toContainText('自动及立即总结均可能产生第三方 API 费用');
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('heijin.settings.v1')!);
    value.memory = { immediateWindowSize: 7, automaticMaintenance: false };
    localStorage.setItem('heijin.settings.v1', JSON.stringify(value));
  });
  await page.reload(); settings = await summaryPage(page);
  await expect(settings).not.toContainText('旧版自动维护');
  for (const name of ['短期 → 中期', '中期 → 长期', 'NPC 短期 → 中期'])
    await expect(settings.getByLabel(`自动总结 ${name}`, { exact: true })).not.toBeChecked();
  await settings.getByLabel('自动总结 NPC 短期 → 中期', { exact: true }).check();
  await settings.getByRole('button', { name: '保存记忆设置', exact: true }).click();
  await expect(settings).toContainText('记忆设置已保存');
  await page.reload(); settings = await summaryPage(page);
  await expect(settings).not.toContainText('旧版自动维护');
  await expect(settings.getByLabel('自动总结 NPC 短期 → 中期', { exact: true })).toBeChecked();
  for (const name of ['短期 → 中期', '中期 → 长期'])
    await expect(settings.getByLabel(`自动总结 ${name}`, { exact: true })).not.toBeChecked();
  expect(calls).toBe(0);
});

test('自动总结关闭时仍可手动总结，刷新后自动保持关闭且没有额外自动调用', async ({ page }) => {
  let requests = 0;
  await page.route('https://summary.mock.invalid/**', async route => {
    requests++;
    const task = requestTask(route.request().postDataJSON());
    await route.fulfill({ json: summaryWire(task) });
  });
  await seedSummary(page, { count: 31, automatic: false });
  const settings = await summaryPage(page);
  await expect(settings.getByLabel('自动总结 短期 → 中期', { exact: true })).not.toBeChecked();
  const button = settings.getByRole('button', { name: '立即总结 · 短期 → 中期', exact: true });
  await expect(button).toBeEnabled();
  expect(requests).toBe(0);
  await button.click();
  await expect.poll(async () => (await summaryState(page)).memories.medium.length).toBe(1);
  expect(requests).toBe(1);
  await page.reload();
  const again = await summaryPage(page);
  await expect(again.getByLabel('自动总结 短期 → 中期', { exact: true })).not.toBeChecked();
  expect(requests).toBe(1);
});

test('旧版 enabled=false 即使 automatic=true 也只关闭自动，不禁用手动操作', async ({ page }) => {
  let requests = 0;
  await page.route('https://summary.mock.invalid/**', async route => {
    requests++;
    await route.fulfill({ json: summaryWire(requestTask(route.request().postDataJSON())) });
  });
  await seedSummary(page, { count: 31, automatic: false });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!);
    settings.memory.summaries.short.enabled = false;
    settings.memory.summaries.short.automatic = true;
    localStorage.setItem('heijin.settings.v1', JSON.stringify(settings));
  });
  await page.reload();
  const settings = await summaryPage(page);
  await expect(settings.getByLabel('启用 短期 → 中期', { exact: true })).toHaveCount(0);
  await expect(settings.getByLabel('自动总结 短期 → 中期', { exact: true })).not.toBeChecked();
  expect(requests).toBe(0);
  await settings.getByRole('button', { name: '立即总结 · 短期 → 中期', exact: true }).click();
  await expect.poll(async () => (await summaryState(page)).memories.medium.length).toBe(1);
  expect(requests).toBe(1);
});
