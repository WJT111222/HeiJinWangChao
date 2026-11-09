import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedSummary, summaryState, requestTask, summaryWire } from './helpers/memorySummary';
import { openSettings } from './helpers/gameLayout';

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
    key.startsWith('heijin.summary.attempt:') || key.startsWith('heijin.summary.rate:'))));
}
async function undo(page: Page) {
  await page.getByRole('button', { name: '撤回（1）', exact: true }).click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '撤回上一回合', exact: true })).toHaveCount(0);
}
for (const [kind, title] of [['short', '短期 → 中期'], ['npc', 'NPC 短期 → 中期']] as const) {
  test(`${title} 在飞行中撤回后明确待确认；发送不重试，手动成功后自动恢复`, async ({ page }) => {
    const calls: string[] = []; let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route('https://summary.mock.invalid/**', async route => {
      const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
      if (stage === 'memory') {
        const wire = summaryWire(requestTask(body)); if (calls.filter(value => value === 'memory').length === 1) await hold;
        await route.fulfill({ json: wire }).catch(() => undefined); return;
      }
      const state = await summaryState(page);
      const text = stage === 'story' ? '<thinking>继续行动。</thinking><正文>【旁白】主角来到公园散步。</正文><短期记忆>在公园散步。</短期记忆><变量规划>[]</变量规划>'
        : stage === 'variables' ? `<thinking>时间推进。</thinking><说明>更新现场。</说明><命令>\nset worldClock = "${new Date(Date.parse(state.worldClock) + 60000).toISOString()}"\n</命令>`
          : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
      await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
    });
    await prepare(page, kind); await expect.poll(() => calls).toEqual(['memory']);
    const before = await ledger(page); await undo(page); release();
    const pending = page.getByRole('dialog', { name: `${title}总结待确认`, exact: true });
    await expect(pending).toContainText('发送行动不会自动重试'); await expect(pending).toContainText('可能已计费');
    const restored = await summaryState(page); expect(restored.turnNumber).toBe(90);
    await page.reload(); await expect(pending).toBeVisible(); expect(calls).toEqual(['memory']);
    expect(await ledger(page)).toEqual(before); expect(await summaryState(page)).toEqual(restored);
    await pending.getByRole('button', { name: '关闭资料界面' }).click();
    await page.getByLabel('你的行动', { exact: true }).fill('重新选择去公园'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await summaryState(page)).turnNumber).toBe(91);
    expect(calls).toEqual(['memory', 'story', 'variables', 'world']); expect(await ledger(page)).toEqual(before);
    await page.reload(); await expect(pending).toBeVisible();
    if (kind === 'npc') {
      // A cancellation handled before unmount retains its actual NPC target.
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.summary.failures:save-a')!).find((entry: { kind: string }) => entry.kind === 'npc').npcId)).toBe('npc-a');
      await expect(pending.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled();
    }
    await pending.getByRole('button', { name: '关闭资料界面' }).click(); await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '记忆', exact: true }).click();
    await expect(settings).toContainText('发送行动不会自动重试');
    if (kind === 'npc') await settings.getByLabel('总结目标 NPC').selectOption('npc-a');
    await settings.getByRole('button', { name: `立即总结 · ${title}`, exact: true }).click();
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
  await prepare(page, 'short'); const failed = page.getByRole('dialog', { name: '短期 → 中期总结失败', exact: true });
  await expect(failed).toBeVisible(); expect(calls).toBe(1); const before = await ledger(page);
  await failed.getByRole('button', { name: '关闭资料界面' }).click(); await undo(page);
  const pending = page.getByRole('dialog', { name: '短期 → 中期总结待确认', exact: true }); await expect(pending).toBeVisible();
  await pending.getByRole('button', { name: '暂停自动总结', exact: true }).click(); await page.reload();
  expect(calls).toBe(1); expect(await ledger(page)).toEqual(before);
  const values = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('heijin.settings.v1')!).memory.summaries).map(value => (value as { automatic: boolean }).automatic));
  expect(values).toEqual([false, false, false]);
});

test('只有遗留 NPC 尝试 ID、没有目标回执时，必须明确选择人物才请求模型', async ({ page }) => {
  let calls = 0;
  await page.route('https://summary.mock.invalid/**', async route => { calls++; await route.fulfill({ json: summaryWire(requestTask(route.request().postDataJSON())) }); });
  await seedSummary(page, { count: 90, npcCount: 60, automatic: false, secondNpc: true });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('heijin.settings.v1')!); settings.memory.summaries.npc.automatic = true;
    localStorage.setItem('heijin.settings.v1', JSON.stringify(settings));
  });
  const state = await summaryState(page);
  await page.evaluate(created => localStorage.setItem(`heijin.summary.attempt:save-a:${created}:npc`, 'memory-unacknowledged-test'), state.createdAt);
  await page.reload(); const pending = page.getByRole('dialog', { name: 'NPC 短期 → 中期总结待确认', exact: true });
  await expect(pending).toContainText('发送行动不会自动重试'); expect(calls).toBe(0);
  await expect(pending.getByRole('button', { name: '重新生成', exact: true })).toHaveCount(0);
  await pending.getByRole('button', { name: '前往设置选择人物' }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.getByRole('button', { name: '记忆', exact: true }).click();
  const summarize = settings.getByRole('button', { name: '立即总结 · NPC 短期 → 中期', exact: true });
  await expect(summarize).toBeDisabled(); await settings.getByLabel('总结目标 NPC').selectOption('npc-a'); await summarize.click();
  await expect.poll(async () => (await summaryState(page)).memories.npcSummaries['npc-a']?.length).toBe(1);
  expect((await summaryState(page)).memories.npcSummaries['npc-b']).toBeUndefined(); expect(calls).toBe(1);
});
