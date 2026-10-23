import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { handoffState, handoffResult, retireCommand, resultText } from '../src/tests/fixtures/handoff';

async function seed(page: Page) {
  await page.goto('/');
  const before = await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/handoff.ts', turnPath = '/src/tests/fixtures/turn.ts',
      configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { SaveRepository } = await import(repoPath), { handoffState } = await import(fixturePath), { completeDraft } = await import(turnPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://handoff.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-only-secret');
    const repo = await SaveRepository.open(); await repo.create(handoffState()); await completeDraft(repo); const state = await repo.load('save-a'); repo.close(); return state;
  });
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByRole('heading', { name: '林舟', exact: true })).toBeVisible(); return before;
}
async function stored(page: Page) { return page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }

test('真实浏览器：世界成果/交接/退场只是候选，主动查看、刷新、正式原子提交后才生效', async ({ page }, info) => {
  const before = await seed(page), state = handoffState(), raw = handoffResult(state); raw.worldCommands = [retireCommand(state)];
  let calls = 0;
  await page.route('https://handoff.mock.invalid/**', async (route) => { calls++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }) }); });
  await page.getByRole('button', { name: /^(?:重新)?生成世界候选$/ }).click();
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText('世界已完成 · 候选未正式结算');
  let saved = await stored(page); expect(saved.state).toEqual(before); expect(saved.state.npc['npc-a']).toBeDefined();
  await expect(page.locator('main')).not.toContainText(resultText);
  await page.getByRole('button', { name: '查看世界候选（未结算）', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '世界候选 · 未正式结算', exact: true });
  await expect(dialog).not.toContainText(resultText); await dialog.getByRole('button', { name: '主动查看完整世界候选', exact: true }).click();
  await expect(dialog.getByLabel('完整世界候选')).toContainText('RetireNpc'); await expect(dialog.getByLabel('完整世界候选')).toContainText(resultText);
  await page.keyboard.press('Escape'); await page.reload(); saved = await stored(page); expect(saved.state).toEqual(before); expect(calls).toBe(1);
  // 用真实存储提交接口隔离本轮新增生命周期的验证，不发送下一轮付费请求。
  const final = await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try {
    const draft = await repo.loadDraft('save-a'); const input = { draft, nextAction: '在街边休息', useVariableStage: true, useWorldStage: true };
    const first = await repo.commitTurn(input), replay = await repo.commitTurn(input); return { first, replay };
  } finally { repo.close(); } });
  expect(final.first.state.npc['npc-a']).toBeUndefined(); expect(final.first.state.retiredNpcs['npc-a'].identityKey).toBe('identity-npc-a');
  expect(final.first.state.tasks.work.resolution.result).toBe(resultText); expect(final.first.state.tasks.next.actorRef.id).toBe('npc-b');
  expect(final.first.state.journal).toHaveLength(1); expect(final.replay.replayed).toBe(true); expect(final.replay.state).toEqual(final.first.state);
  await page.reload(); await expect(page.locator('main')).not.toContainText(resultText);
  expect((await stored(page)).state).toEqual(final.first.state); expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('world-handoff-committed.png'), fullPage: true });
});

test('联系人标签来自真实持久数据，刷新后档案仍保留', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try {
    await repo.save('save-a', 0, 'contact-fixture', [{ type: 'RegisterContact', commandId: 'contact', npcId: 'scene', reason: '隔离UI测试的明确联络设定', evidence: '主角与现场人物交换了联络方式。' }]);
  } finally { repo.close(); } });
  await page.reload(); await page.getByRole('button', { name: /NPC/ }).click();
  const panel = page.getByRole('dialog'); await panel.getByRole('button', { name: /现场人物/ }).click();
  await expect(panel).toContainText('联系人 · 永久保留档案');
  await page.keyboard.press('Escape'); await page.reload();
  expect((await stored(page)).state.contactNpcIds).toContain('scene');
});
