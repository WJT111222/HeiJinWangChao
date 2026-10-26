import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';

async function seed(page: Page, empty = false) {
  await page.goto('/');
  await page.evaluate(async (empty) => {
    const fixture = '/src/tests/fixtures/compression.ts', game = '/src/tests/fixtures/game.ts', storage = '/src/services/storage/saveRepository.ts', settingsPath = '/src/ui/settings/model.ts', draftPath = '/src/domain/drafts.ts', configPath = '/src/services/ai/configuration.ts', credentialsPath = '/src/services/ai/credentials.ts';
    const { compressionState } = await import(fixture), { game: newGame } = await import(game), { SaveRepository } = await import(storage), { defaultSettings, settingsKey } = await import(settingsPath), { createTurnDraft, rerollStory } = await import(draftPath), { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(credentialsPath);
    const state = empty ? newGame() : compressionState('short', 70);
    if (!empty) {
      const base = state.memories.short[0];
      state.memories.medium = [{ ...base, id: 'medium-internal-id', text: '中期已知经历：与旧友的约定。', sourceTurnIds: state.journal.slice(0, 10).map((entry: { turnId: string }) => entry.turnId) }];
      state.memories.long = [{ ...base, id: 'long-internal-id', text: '长期已知经历。'.repeat(1000) + '完整末尾不能截断', sourceTurnIds: state.journal.slice(10, 20).map((entry: { turnId: string }) => entry.turnId) }];
      state.memories.short = state.memories.short.filter((_: unknown, i: number) => i !== 29);
      const secret = { ...base, id: 'hidden-id', text: '后台秘密不得出现', visibility: 'npc_private' };
      state.memories.short.push(secret); state.memories.medium.push(secret); state.memories.long.push(secret);
      state.memories.npcSummaries['npc-a'] = [secret];
    }
    const repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction(['saves', 'drafts'], 'readwrite'); tx.objectStore('saves').put(state);
        if (!empty) tx.objectStore('drafts').put(rerollStory(createTurnDraft(state.saveId, state.revision, 'uncommitted-turn', 'regular', '观察'), { turnKind: 'regular', narrative: '未提交剧情禁止记忆', summary: '未提交候选摘要', variableGuide: [] }));
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    });
    const settings = defaultSettings(); settings.memory.immediateWindowSize = 2;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://reader-memory.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'reader-model' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-reader-key');
  }, empty);
  await page.reload(); await page.getByRole('button', { name: /读取存档/ }).click(); await openGameTools(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  return page.getByRole('dialog', { name: '记忆', exact: true });
}

test('四层只读记忆默认阅读，维护归位；公开来源、长文本及档案不请求AI或改变存档', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  let api = 0; await page.route('https://**/v1/**', async (route) => { api++; await route.abort(); });
  const panel = await seed(page), before = await saved(page);
  await page.screenshot({ path: `/tmp/heijin-m7p4-${testInfo.project.name}-memory.png` });
  await expect(panel.getByRole('button', { name: '即时记忆', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toHaveCount(0);
  await expect(panel).not.toContainText('记忆总结模型'); await expect(panel).not.toContainText('阈值');
  await expect(panel.getByRole('region', { name: '即时记忆', exact: true })).toContainText('第 69 回合');
  await expect(panel.getByRole('region', { name: '即时记忆', exact: true })).toContainText('第 70 回合');
  await expect(panel.getByRole('region', { name: '即时记忆', exact: true })).not.toContainText('第 68 回合');
  await panel.getByRole('button', { name: '短期记忆', exact: true }).click();
  await expect(panel).toContainText('已保存摘要'); await expect(panel).toContainText('历史摘要，只读');
  await expect(panel.locator('article')).toHaveCount(20);
  await panel.getByRole('button', { name: '下一页记忆', exact: true }).click(); await expect(panel).toContainText('第 2 页');
  await panel.getByRole('button', { name: '中期记忆', exact: true }).click();
  await expect(panel).toContainText('中期已知经历：与旧友的约定。');
  await expect(panel).not.toContainText('medium-internal-id');
  await expect(panel).toContainText('2026/10/18');
  await panel.getByRole('button', { name: '查看来源回合', exact: true }).click();
  await panel.getByRole('button', { name: '查看第 3 回合原文', exact: true }).click();
  await expect(panel.getByRole('region', { name: '摘要来源原文' })).toContainText('蓝色钥匙');
  await expect(panel.getByRole('region', { name: '摘要来源原文' })).not.toContainText('history-3');
  await panel.getByRole('button', { name: '长期记忆', exact: true }).click();
  await expect(panel).toContainText('完整末尾不能截断'); await expect(panel).not.toContainText('long-internal-id');
  for (const name of ['即时记忆', '短期记忆', '中期记忆', '长期记忆']) {
    await panel.getByRole('button', { name, exact: true }).click();
    await expect(panel).not.toContainText('后台秘密不得出现'); await expect(panel).not.toContainText('未提交候选摘要'); await expect(panel).not.toContainText('未提交剧情禁止记忆');
  }
  await panel.getByLabel('搜索历史回合').fill('后台秘密不得出现'); await expect(panel).toContainText('未找到相关的已提交历史');
  await panel.getByLabel('搜索历史回合').fill(''); await expect(panel.locator('article')).toHaveCount(20);
  await panel.getByRole('button', { name: '查看更早回合', exact: true }).click(); await expect(panel).toContainText('第 2 页');
  expect(await saved(page)).toEqual(before);
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  expect(api).toBe(0);
});

async function saved(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}

test('没有游玩的有效存档时，设置高级维护安全不可操作且不开模型请求', async ({ page }) => {
  let api = 0; await page.route('https://**/v1/**', async (route) => { api++; await route.abort(); });
  await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  await settings.getByText('记忆维护（高级操作）', { exact: true }).click();
  await expect(settings).toContainText('请先进入有效的游戏存档');
  await expect(settings.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: '关闭资料界面' }).click(); expect(api).toBe(0);
});


test('空记忆与新存档四层均可读；已选存档不等于正在游玩，回首页后维护不可操作', async ({ page }) => {
  let requests = 0; await page.route('https://reader-memory.mock.invalid/**', async (route) => { requests++; await route.abort(); });
  const panel = await seed(page, true), before = await saved(page);
  for (const name of ['即时记忆', '短期记忆', '中期记忆', '长期记忆', '永久正文档案']) {
    await panel.getByRole('button', { name, exact: true }).click(); await expect(panel.locator('.empty')).toBeVisible();
  }
  expect(await saved(page)).toEqual(before); expect(requests).toBe(0);
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  await settings.getByText('记忆维护（高级操作）', { exact: true }).click();
  await expect(settings).toContainText('请先进入有效的游戏存档');
  await expect(settings.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});
