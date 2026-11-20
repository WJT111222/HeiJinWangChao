import { createHash } from 'node:crypto';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { memoryMockCors, seedSummary, summaryState, requestTask, summaryWire } from './helpers/memorySummary';
import { openSettings } from './helpers/gameLayout';
import { fingerprint } from '../src/domain/commands';
import { defaultSummaryConfig } from '../src/domain/memories/configuration';
import { planCompression } from '../src/domain/memories/compression';
import { planNpcSummary } from '../src/domain/memories/npcMemory';

async function prepare(page: Page, kind: 'short' | 'npc') {
  await seedSummary(page, { count: 90, npcCount: 60, automatic: false });
  await page.evaluate(async kind => {
    const r = '/src/services/storage/saveRepository.ts', t = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(r), { completeDraft, elapsedVariables, submission } = await import(t);
    const repo = await SaveRepository.open();
    try { const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '多走一分钟', 60) }); await repo.commitTurn(submission(draft, '')); }
    finally { repo.close(); }
    const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!);
    settings.memory.summaries[kind].automatic = true; localStorage.setItem('heijin.settings.v1', JSON.stringify(settings));
  }, kind);
  await page.reload();
}
async function ledger(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) =>
    key.startsWith('heijin.summary.attempt:') || key.startsWith('heijin.summary.records:') || key.startsWith('heijin.summary.rate:'))));
}
async function undo(page: Page) {
  await page.getByRole('button', { name: '撤回（1）', exact: true }).click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '撤回上一回合', exact: true })).toHaveCount(0);
}
for (const [kind, title] of [['short', '短期 → 中期'], ['npc', 'NPC 短期 → 中期']] as const) {
  test(`${title} 在飞行中撤回后明确待确认；发送不重试，手动成功后自动恢复`, async ({ page }) => {
    test.setTimeout(60000);
    const calls: string[] = []; let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route('https://summary.mock.invalid/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: memoryMockCors });
      const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
      if (stage === 'memory') {
        const wire = summaryWire(requestTask(body)); if (calls.filter(value => value === 'memory').length === 1) await hold;
        await route.fulfill({ headers: memoryMockCors, json: wire }).catch(() => undefined); return;
      }
      const state = await summaryState(page);
      const text = stage === 'story' ? '<thinking>继续行动。</thinking><正文>【旁白】主角来到公园散步。</正文><短期记忆>在公园散步。</短期记忆><变量规划>[]</变量规划>'
        : stage === 'variables' ? `<thinking>时间推进。</thinking><说明>更新现场。</说明><命令>\nset worldClock = "${new Date(Date.parse(state.worldClock) + 60000).toISOString()}"\n</命令>`
          : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
      await route.fulfill({ headers: memoryMockCors, contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
    });
    await prepare(page, kind); await expect.poll(() => calls).toEqual(['memory']);
    await undo(page); release();
    const pending = page.getByRole('dialog', { name: `${title}总结待确认`, exact: true });
    await expect(pending).toContainText('发送行动不会自动重试'); await expect(pending).toContainText('可能已计费');
    const restored = await summaryState(page); expect(restored.turnNumber).toBe(90);
    const before = await ledger(page);
    await page.reload(); await expect(pending).toBeVisible(); expect(calls).toEqual(['memory']);
    expect(await ledger(page)).toEqual(before); expect(await summaryState(page)).toEqual(restored);
    await pending.getByRole('button', { name: '关闭资料界面' }).click();
    await page.getByLabel('你的行动', { exact: true }).fill('重新选择去公园'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await summaryState(page)).turnNumber, { timeout: 15000 }).toBe(91);
    expect(calls).toEqual(['memory', 'story', 'variables', 'world']); expect(await ledger(page)).toEqual(before);
    await page.reload(); await expect(pending).toBeVisible();
    if (kind === 'npc') {
      // A cancellation handled before unmount retains its actual NPC target.
      expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('heijin.summary.records:save-a:'))
        .flatMap(([, value]) => JSON.parse(value)).find((entry: { kind: string }) => entry.kind === 'npc').npcId)).toBe('npc-a');
      await expect(pending.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled();
    }
    await pending.getByRole('button', { name: '关闭资料界面' }).click(); await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '记忆', exact: true }).click();
    await expect(settings).toContainText('发送行动不会自动重试');
    if (kind === 'npc') await settings.getByLabel('总结目标 NPC').selectOption('npc-a');
    await settings.getByRole('button', { name: '重新生成此批（可能计费）', exact: true }).click();
    await expect.poll(() => calls.filter(value => value === 'memory').length).toBe(2);
    await expect.poll(async () => { const state = await summaryState(page); return kind === 'npc' ? state.memories.npcSummaries['npc-a']?.length : state.memories.medium.length; }).toBe(1);
    const afterManual = await ledger(page), rateKey = Object.keys(before).find(key => key.startsWith('heijin.summary.rate:'))!;
    expect(afterManual[rateKey]).toBe(before[rateKey]);
    await page.reload(); // Successful explicit handling releases only this kind; no failed automatic retry.
    await expect.poll(() => calls.filter(value => value === 'memory').length).toBe(3);
    await expect.poll(async () => { const state = await summaryState(page); return kind === 'npc' ? state.memories.npcSummaries['npc-a']?.length : state.memories.medium.length; }).toBe(2);
    expect(JSON.parse((await ledger(page))[rateKey])).toHaveLength(2);
  });
}

test('真实 HTTP 失败经撤回仍保留，暂停本类不会启用其他自动类型', async ({ page }) => {
  let calls = 0; await page.route('https://summary.mock.invalid/**', async route => { calls++; await route.fulfill({ status: 503, json: {} }); });
  await prepare(page, 'short'); const failed = page.getByRole('dialog', { name: '短期 → 中期总结待确认', exact: true });
  await expect(failed).toBeVisible(); expect(calls).toBe(1); const before = await ledger(page);
  await failed.getByRole('button', { name: '关闭资料界面' }).click(); await undo(page);
  const pending = page.getByRole('dialog', { name: '短期 → 中期总结待确认', exact: true }); await expect(pending).toBeVisible();
  await pending.getByRole('button', { name: '暂停自动总结', exact: true }).click(); await page.reload();
  expect(calls).toBe(1); expect(await ledger(page)).toEqual(before);
  const values = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('heijin.settings.v1')!).memory.summaries).map(value => (value as { automatic: boolean }).automatic));
  expect(values).toEqual([false, false, false]);
});

async function openLegacySummarySettings(page: Page, kind: 'short' | 'npc', title: string, created: string, resultId?: string) {
  const attemptKey = `heijin.summary.attempt:save-a:${created}:${kind}`;
  await page.evaluate(({ kind, attemptKey, resultId }) => {
    const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!);
    settings.memory.summaries[kind].automatic = true;
    localStorage.setItem('heijin.settings.v1', JSON.stringify(settings));
    localStorage.setItem('heijin.summary.failures:save-a', JSON.stringify([{ kind, code: 'server' }]));
    if (resultId) localStorage.setItem(attemptKey, resultId);
  }, { kind, attemptKey, resultId });
  await page.reload();
  const pending = page.getByRole('dialog', { name: `${title}总结待确认`, exact: true });
  await expect(pending).toBeVisible();
  await expect(pending.getByRole('button', { name: /重新生成|核对原批并重试/ })).toHaveCount(0);
  await pending.getByRole('button', { name: '前往记忆设置' }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  return { attemptKey, dialog: settings, card: settings.getByRole('region', { name: title, exact: true }) };
}

for (const [kind, title] of [['short', '短期 → 中期'], ['npc', 'NPC 短期 → 中期']] as const) {
  test(`${title} 旧账本缺少指纹时保留保护且不提供重试入口`, async ({ page }) => {
    let calls = 0;
    await page.route('https://summary.mock.invalid/**', async route => {
      calls++;
      await route.abort();
    });
    await seedSummary(page, { count: 45, npcCount: 25, automatic: false, secondNpc: true });
    const state = await summaryState(page);
    const { attemptKey, card } = await openLegacySummarySettings(page, kind, title, state.createdAt);
    if (kind === 'npc') await card.getByLabel('总结目标 NPC').selectOption('npc-a');
    await expect(card).toContainText('无法安全恢复原批');
    await expect(card).toContainText('待确认记录仍保留');
    await expect(card.getByRole('button', { name: /重新生成|核对原批并重试|立即总结/ })).toHaveCount(0);
    expect(calls).toBe(0);
    expect(await summaryState(page)).toEqual(state);
    expect(await page.evaluate(key => [localStorage.getItem(key), JSON.parse(localStorage.getItem('heijin.summary.failures:save-a')!)], attemptKey))
      .toEqual([null, [{ kind, code: 'server' }]]);
  });

  test(`${title} 旧账本指纹只授权原批，修改批次数拒绝且恢复后仅发送一次`, async ({ page }) => {
    test.setTimeout(60000);
    const requests: Record<string, unknown>[] = [];
    await page.route('https://summary.mock.invalid/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: memoryMockCors });
      const task = requestTask(route.request().postDataJSON());
      requests.push(task);
      await route.fulfill({ headers: memoryMockCors, json: summaryWire(task) });
    });
    await seedSummary(page, { count: 45, npcCount: 25, automatic: false, secondNpc: true });
    const state = await summaryState(page);
    const config = defaultSummaryConfig(kind);
    const batch = kind === 'npc' ? planNpcSummary(state, 'npc-a', { config })! : planCompression(state, { layer: kind, config })!;
    const resultId = 'memory-' + createHash('sha256').update(fingerprint(batch)).digest('hex');
    const { attemptKey, dialog, card } = await openLegacySummarySettings(page, kind, title, state.createdAt, resultId);
    const retry = card.getByRole('button', { name: '核对原批并重试（可能计费）', exact: true });
    const rejected = '当前批次与旧记录不一致，未发送请求';
    if (kind === 'npc') {
      await expect(retry).toBeDisabled();
      await card.getByLabel('总结目标 NPC').selectOption('npc-b');
      await retry.click();
      await expect(card).toContainText(rejected);
      expect(requests).toHaveLength(0);
      await card.getByLabel('总结目标 NPC').selectOption('npc-a');
    }
    const batchSize = card.getByLabel(`每次总结条数 · ${title}`, { exact: true });
    const save = dialog.getByRole('button', { name: '保存记忆设置', exact: true });
    await batchSize.fill(String(config.batchSize - 1));
    await save.click();
    await retry.click();
    await expect(card).toContainText(rejected);
    expect(requests).toHaveLength(0);
    expect(await page.evaluate(key => localStorage.getItem(key), attemptKey)).toBe(resultId);
    expect(await summaryState(page)).toEqual(state);

    await batchSize.fill(String(config.batchSize));
    await save.click();
    await retry.click();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), attemptKey)).toBe('');
    await expect(retry).toHaveCount(0);
    expect(requests).toHaveLength(1);
    const task = requests[0];
    const sent = (task.entries as { id: string }[] | undefined) ??
      (task.groups as { entries: { id: string }[] }[]).flatMap(group => group.entries);
    expect(sent.map(entry => entry.id).sort()).toEqual(batch.entries.map(entry => entry.id).sort());
    const after = await summaryState(page);
    if (kind === 'npc') {
      expect(task.npcId).toBe('npc-a');
      expect(after.memories.npcSummaries['npc-a'][0].id).toBe(resultId + '-0');
      expect(after.memories.npcSummaries['npc-b']).toBeUndefined();
    } else {
      expect(after.memories.medium.map((entry: { id: string }) => entry.id)).toEqual([resultId]);
    }
    expect(await page.evaluate(key => localStorage.getItem(key), attemptKey)).toBe('');
    expect(after.journal).toEqual(state.journal);
  });
}
