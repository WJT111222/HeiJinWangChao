import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { array, record, string } from '../src/services/ai/protocols';
import { GameStateSchema } from '../src/domain/state';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixturePath = '/src/tests/fixtures/history.ts', repoPath = '/src/services/storage/saveRepository.ts',
      draftPath = '/src/domain/drafts.ts', settingsPath = '/src/ui/settings/model.ts',
      configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { historyState } = await import(fixturePath), { SaveRepository } = await import(repoPath),
      { createTurnDraft } = await import(draftPath), { defaultSettings, settingsKey } = await import(settingsPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const state = historyState();
    state.memories.immediateWindowSize = 20;
    const secret = { id: 'private', text: '保密调查口令', sourceTurnIds: [], affectedEntityRefs: [], createdAtGameTime: state.worldClock, visibility: 'npc_private' };
    state.memories.short = [secret];
    state.npc['npc-a'].memories = [{ ...secret, knowledgeSource: '未公开调查' }];
    const repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const operation = indexedDB.open('heijinwangchao');
      operation.onerror = () => reject(operation.error);
      operation.onsuccess = () => {
        const db = operation.result, tx = db.transaction(['saves', 'drafts'], 'readwrite');
        tx.objectStore('saves').put(state);
        tx.objectStore('drafts').put(createTurnDraft(state.saveId, state.revision, 'memory-71', 'regular', '询问同事陈宁下周的约定', false, false));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const settings = defaultSettings();
    settings.memory.immediateWindowSize = 1;
    settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    settings.runtime.useVariableStage = false; settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig();
    channel.baseUrl = 'https://memory.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'memory-story' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-memory-only');
  });
  await page.reload();
  await page.getByRole('button', { name: /读取存档/ }).click();
}
async function load(page: Page) {
  const state: unknown = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load('save-a'); } finally { repo.close(); }
  });
  return GameStateSchema.parse(state);
}
async function memoryPanel(page: Page) {
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  return page.getByRole('dialog', { name: '记忆', exact: true });
}
async function windowSize(page: Page, size: number) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '记忆', exact: true }).click();
  await dialog.getByLabel('即时记忆完整回合数').fill(String(size));
  await dialog.getByRole('button', { name: '保存本地设置' }).click();
  await expect(dialog).toContainText('本地偏好已保存');
  await dialog.getByRole('button', { name: '关闭资料界面' }).click();
}

test('旧M4七十回合档案：搜索约定、读取来源原文、分页和窗口显示，不泄露或改写', async ({ page }) => {
  let requests = 0;
  await page.route('https://memory.mock.invalid/**', async (route) => { requests++; await route.abort(); });
  await seed(page);
  const before = await load(page);
  const panel = await memoryPanel(page);
  await expect(panel).toContainText('即时窗口：最近 1 回合');
  await expect(panel).toContainText('短期 70');
  await expect(panel).toContainText('历史回合时间未记录');
  await expect(panel).not.toContainText('保密调查口令');
  await panel.getByLabel('搜索历史回合').fill('蓝色钥匙');
  const result = panel.locator('details').filter({ hasText: '第 3 回合' });
  await expect(result).toHaveCount(1);
  await result.locator('summary').click();
  await expect(result).toContainText('同事陈宁在社区诊所约定下周三再次见面');
  await panel.getByRole('button', { name: '查看第 3 回合原文', exact: true }).click();
  await expect(panel.getByRole('region', { name: '摘要来源原文' })).toContainText('history-3');
  await expect(panel.getByRole('region', { name: '摘要来源原文' })).toContainText('蓝色钥匙');
  await panel.getByLabel('搜索历史回合').fill('保密调查口令');
  await expect(panel).toContainText('未找到相关的已提交历史');
  await panel.getByLabel('搜索历史回合').fill('');
  await panel.getByRole('button', { name: '查看更早回合' }).click();
  await expect(panel).toContainText('第 2 页');
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  await windowSize(page, 20);
  await expect(await memoryPanel(page)).toContainText('即时窗口：最近 20 回合');
  await page.reload();
  await expect(await memoryPanel(page)).toContainText('即时窗口：最近 20 回合');
  expect(await load(page)).toEqual(before);
  expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('真实正文请求使用设置N=1/10/20，并独立召回第3回合；查看记忆不中断生成', async ({ page }) => {
  test.setTimeout(60000);
  const contexts: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  await page.route('https://memory.mock.invalid/**', async (route) => {
    const body: unknown = route.request().postDataJSON();
    const messages = array(record(body).messages).map((message) => string(record(message).content));
    expect(messages.some((message) => message.replace(/\s/g, '').includes('目标约100～200汉字'))).toBe(true);
    const text = messages.join('\n').match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1];
    contexts.push(record(JSON.parse(text)));
    await new Promise<void>((resolve) => { release = resolve; });
    const output = '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>主角阅读先前留下的约定，等待对方回复。</正文><短期记忆>查看约定</短期记忆><变量规划>[]</变量规划>';
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n` });
  });
  await seed(page);
  const before = await load(page);
  for (const size of [1, 10, 20]) {
    if (size !== 1) await windowSize(page, size);
    const count = contexts.length;
    await page.getByRole('button', { name: size === 1 ? '生成本回合正文' : '重新 Roll', exact: true }).click();
    await expect.poll(() => contexts.length).toBe(count + 1);
    const memory = record(contexts.at(-1)!.MEMORY_CONTEXT);
    expect(memory.immediateWindowSize).toBe(size);
    expect(array(memory.recentTurns).map((entry) => record(entry).turnId)).toEqual(before.journal.slice(-size).map((entry) => entry.turnId));
    expect(array(memory.recalledTurns).map((entry) => record(entry).turnId)).toEqual(['history-3']);
    expect(JSON.stringify(contexts.at(-1))).not.toContain('保密调查口令');
    const panel = await memoryPanel(page);
    await expect(panel).toContainText(`即时窗口：最近 ${size} 回合`);
    await panel.getByLabel('搜索历史回合').fill('社区诊所');
    await expect(panel.locator('details')).toHaveCount(1);
    await panel.getByRole('button', { name: '关闭资料界面' }).click();
    release?.();
    await expect(page.getByTestId('story-reader')).toContainText('主角阅读先前留下的约定');
    await expect(page.getByRole('button', { name: '重新 Roll', exact: true })).toBeEnabled();
    if (size === 1) await page.getByText('重试与变更详情', { exact: true }).click();
    await expect(page.getByTestId('summary-length')).toBeVisible();
    await expect(page.getByTestId('summary-length')).toContainText('4 汉字');
    await expect(page.getByTestId('summary-length')).toContainText('可继续');
    expect(await load(page)).toEqual(before);
  }
  expect(contexts).toHaveLength(3);
  await page.reload();
  expect(await load(page)).toEqual(before);
});
