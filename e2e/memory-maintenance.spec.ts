import { openGameTools } from './helpers/gameLayout';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameStateSchema } from '../src/domain/state';
import { array, record, string } from '../src/services/ai/protocols';

// 隔离浏览器夹具：真实 IndexedDB、真实路由/客户端，网络仅拦截 mock.invalid。
async function seed(page: Page, count = 31, automatic = false, ready = false) {
  await page.goto('/');
  await page.evaluate(async ({ count, automatic, ready }) => {
    const fixturePath = '/src/tests/fixtures/compression.ts', repoPath = '/src/services/storage/saveRepository.ts',
      turnPath = '/src/tests/fixtures/turn.ts', settingsPath = '/src/ui/settings/model.ts',
      configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { compressionState } = await import(fixturePath), { SaveRepository } = await import(repoPath),
      { completeDraft, elapsedVariables } = await import(turnPath), { defaultSettings, settingsKey } = await import(settingsPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const state = compressionState('short', count), repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const operation = indexedDB.open('heijinwangchao');
      operation.onerror = () => reject(operation.error);
      operation.onsuccess = () => {
        const db = operation.result, tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(state);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    if (ready) {
      const storage = await SaveRepository.open();
      try { await completeDraft(storage, { variables: await elapsedVariables(storage, '经过十分钟，主角完成用餐。', 600) }); }
      finally { storage.close(); }
    }
    const settings = defaultSettings(); settings.memory.automaticMaintenance = automatic;
    settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel();
    channel.baseUrl = 'https://maintenance.mock.invalid/v1'; channel.defaultModel = 'default-model';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'memory' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-maintenance-secret');
  }, { count, automatic, ready });
  await page.reload(); await openGameTools(page);
  await page.getByRole('button', { name: /读取存档/ }).click(); await openGameTools(page);
}
async function load(page: Page) {
  const state: unknown = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load('save-a'); } finally { repo.close(); }
  });
  return GameStateSchema.parse(state);
}
async function panel(page: Page) {
  await openGameTools(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  await settings.getByText('记忆维护（高级操作）', { exact: true }).click();
  return settings;
}
const text = JSON.stringify({ entries: [{ text: '保留与陈宁在社区诊所下周三见面的约定和蓝色钥匙，以及此前散步的经历。' }], unresolved: [], contradictions: [] });
function wire(content = text) {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } });
}

test('选择并恢复独立模型；手动整理、原文来源及真实memory快照/Token统计', async ({ page }) => {
  let requests = 0;
  await page.route('https://maintenance.mock.invalid/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { data: [{ id: 'memory-summary' }] } }); return; }
    requests++;
    const body = record(route.request().postDataJSON());
    expect(body.model).toBe('memory-summary');
    expect(JSON.stringify(body)).not.toMatch(/身份秘密|私有调查|mock-maintenance-secret|SAVE_STATE/);
    const messages = array(body.messages).map((entry) => string(record(entry).content));
    expect(messages.some((entry) => entry.includes('memory.short_to_medium'))).toBe(true);
    await route.fulfill({ contentType: 'application/json', body: wire() });
  });
  await seed(page);
  const before = await load(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.getByLabel('记忆维护跟随正文模型')).not.toBeChecked();
  await settings.getByLabel('记忆维护跟随正文模型').check();
  await expect(settings.getByRole('combobox', { name: '记忆维护模型', exact: true })).toBeDisabled();
  await settings.getByLabel('记忆维护跟随正文模型').uncheck();
  await settings.getByRole('button', { name: '手动填写记忆维护模型 ID', exact: true }).click();
  await settings.getByLabel('记忆维护模型 ID', { exact: true }).fill('memory-summary');
  await settings.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(settings.getByLabel('自动记忆维护（额外API费用，默认关闭）')).not.toBeChecked();
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  await page.reload(); await openGameTools(page);
  const memory = await panel(page);
  await expect(memory).toContainText('memory-summary');
  await expect(memory).toContainText('可信活跃短期 31');
  await memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(memory).toContainText('一批记忆已整理并原子保存');
  const usage = memory.getByRole('region', { name: '记忆请求 Token 用量', exact: true });
  await expect(usage).toContainText('估算输入 Token'); await expect(usage).toContainText('实际输入：40');
  await expect(usage).toContainText('实际输出：10'); await expect(usage).toContainText('实际总量：50');
  await expect(memory).toContainText('短期 21'); await expect(memory).toContainText('中期 1');

  const after = await load(page);
  expect({ ...after, memories: before.memories }).toEqual(before);
  expect(after.memories.medium[0].sourceTurnIds).toHaveLength(10);
  expect(requests).toBe(1);
  await memory.getByRole('button', { name: '关闭资料界面' }).click();
  await openGameTools(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  const reading = page.getByRole('dialog', { name: '记忆', exact: true });
  await reading.getByRole('button', { name: '中期记忆', exact: true }).click();
  await reading.getByRole('button', { name: '查看来源回合', exact: true }).click();
  await reading.getByRole('button', { name: '查看第 3 回合原文', exact: true }).click();
  await expect(reading.getByRole('region', { name: '摘要来源原文' })).toContainText('蓝色钥匙');
  await reading.getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settings.getByRole('button', { name: '提示词管理', exact: true }).click();
  await settings.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  await settings.getByRole('combobox', { name: '选择请求', exact: true }).selectOption({ label: await settings.getByRole('combobox', { name: '选择请求', exact: true }).locator('option').filter({ hasText: '记忆维护 memory.short_to_medium' }).innerText() });
  await expect(settings).toContainText('memory-summary');
  await expect(settings.locator('.inspection-statistics dd').nth(2)).toHaveText('40');
  await expect(settings.locator('.inspection-statistics dd').nth(3)).toHaveText('10');
  await expect(settings.locator('.inspection-statistics dd').nth(4)).toHaveText('50');
  await expect(settings.getByLabel('完整内部上下文', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: '主动查看完整内部上下文' }).click();
  await expect(settings.getByLabel('完整内部上下文', { exact: true })).toContainText('MEMORY_TASK');
  await expect(settings.getByLabel('完整内部上下文', { exact: true })).not.toContainText('mock-maintenance-secret');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await openGameTools(page); expect(requests).toBe(1); expect(await load(page)).toEqual(after);
});

test('跨标签真实Web Lock阻止第二次付费；取消/迟到和服务失败保留全部来源', async ({ page, context }) => {
  let requests = 0, release: (() => void) | undefined, status = 200;
  await context.route('https://maintenance.mock.invalid/**', async (route) => {
    requests++;
    if (status === 200) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status, contentType: 'application/json', body: status === 200 ? wire() : '{}' }).catch(() => undefined);
  });
  await seed(page); const before = await load(page);
  const memory = await panel(page);
  await memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: /读取存档/ }).click();
  const otherPanel = await panel(other);
  await otherPanel.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(otherPanel).toContainText('另一个标签正在整理此存档');
  expect(requests).toBe(1);
  await memory.getByRole('button', { name: '取消记忆整理' }).click();
  await expect(memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toBeEnabled();
  release?.(); expect(await load(page)).toEqual(before);
  status = 429;
  await memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toBeEnabled();
  expect(await load(page)).toEqual(before);
  await other.close(); await page.reload(); await openGameTools(page); expect(requests).toBe(2);
});

test('无跨标签互斥时手动整理明确拒绝，刷新不触发付费', async ({ page }) => {
  let requests = 0;
  await page.route('https://maintenance.mock.invalid/**', async (route) => { requests++; await route.abort(); });
  await seed(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  const memory = await panel(page);
  await memory.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(memory).toContainText('不支持安全跨标签互斥');
  expect(requests).toBe(0);
});

test('自动维护仅由新正式提交触发，不阻断下一轮；设置保存和刷新不请求', async ({ page }) => {
  test.setTimeout(60000);
  const calls: string[] = []; let release: (() => void) | undefined;
  await page.route('https://maintenance.mock.invalid/**', async (route) => {
    const model = string(record(route.request().postDataJSON()).model); calls.push(model);
    if (model === 'memory') {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ contentType: 'application/json', body: wire() }); return;
    }
    if (model === 'story') {
      const content = '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>主角仍在原地休息，并观察窗外。</正文><短期记忆>在原地观察窗外</短期记忆><变量规划>[]</变量规划>';
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` }); return;
    }
    const content = model === 'variables' ? JSON.stringify({ commands: [], rejectedSuggestions: [], unresolved: [] })
      : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] });
    await route.fulfill({ contentType: 'application/json', body: wire(content) });
  });
  await seed(page, 30, false, true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: '记忆', exact: true }).click();
  await settings.getByLabel('自动记忆维护（额外API费用，默认关闭）').check();
  await settings.getByRole('button', { name: '保存本地设置', exact: true }).click();
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  await page.reload(); await openGameTools(page); expect(calls).toHaveLength(0);
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察窗外');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => calls.filter((call) => call === 'memory').length).toBe(1);
  // 维护网络尚未完成，下一正式回合的三阶段生成仍能完成。
  await expect.poll(() => calls.filter((call) => call !== 'memory')).toEqual(['story', 'variables', 'world']);
  await page.getByLabel('你的行动', { exact: true }).fill('继续等待');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  const during = await load(page); expect(during.revision).toBe(31); expect(during.memories.short).toHaveLength(31);
  release?.();
  await expect.poll(async () => (await load(page)).memories.medium.length).toBe(1);
  const after = await load(page); expect(after.revision).toBe(31); expect(after.journal).toEqual(during.journal);
  const memory = await panel(page);
  await expect(memory).toContainText('一批记忆已整理并原子保存');
  await memory.getByRole('button', { name: '关闭资料界面' }).click();
  await page.reload(); await openGameTools(page); expect(calls.filter((call) => call === 'memory')).toHaveLength(1);
});

test('设置关闭重开仍是同一维护任务；阅读零请求，取消迟到不写回，手动重试仅一批', async ({ page }) => {
  test.setTimeout(60000);
  let requests = 0, hold = true, release: (() => void) | undefined;
  await page.route('https://maintenance.mock.invalid/**', async (route) => {
    requests++;
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: wire() }).catch(() => undefined);
  });
  await seed(page); const before = await load(page);
  let maintenance = await panel(page);
  const start = maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true });
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => requests).toBe(1);
  await maintenance.getByRole('button', { name: '关闭资料界面' }).click();
  await openGameTools(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  const reading = page.getByRole('dialog', { name: '记忆', exact: true });
  for (const name of ['即时记忆', '短期记忆', '中期记忆', '长期记忆']) await reading.getByRole('button', { name, exact: true }).click();
  await reading.getByLabel('搜索历史回合').fill('蓝色钥匙');
  await expect(reading).not.toContainText('记忆总结模型'); expect(requests).toBe(1);
  await reading.getByRole('button', { name: '关闭资料界面' }).click();
  maintenance = await panel(page);
  await expect(maintenance.getByRole('button', { name: '正在整理…', exact: true })).toBeDisabled();
  expect(requests).toBe(1);
  await maintenance.getByRole('button', { name: '取消记忆整理', exact: true }).click();
  await expect(maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toBeEnabled();
  release?.(); hold = false; expect(await load(page)).toEqual(before);
  await maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(maintenance).toContainText('一批记忆已整理并原子保存'); expect(requests).toBe(2);
  await maintenance.getByRole('button', { name: '关闭资料界面' }).click();
  maintenance = await panel(page);
  await expect(maintenance).toContainText('一批记忆已整理并原子保存');
  await expect(maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toBeDisabled();
  expect(requests).toBe(2);
});

test('维护期间切档隔离旧任务，迟到结果不修改新档或原档，仅新授权可整理新档', async ({ page }) => {
  test.setTimeout(60000);
  let requests = 0, hold = true, release: (() => void) | undefined;
  await page.route('https://maintenance.mock.invalid/**', async (route) => {
    requests++;
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: wire() }).catch(() => undefined);
  });
  await seed(page); const before = await load(page);
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    const state = await repo.load('save-a'); repo.close(); state.saveId = 'save-b'; state.title = '第二人生';
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    });
  });
  const maintenance = await panel(page);
  await maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await maintenance.getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await page.locator('.save-card').filter({ hasText: '第二人生' }).getByRole('button', { name: /读取存档/ }).click();
  const other = await panel(page);
  await expect(other).toContainText('当前人生：第二人生');
  await expect(other.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true })).toBeEnabled();
  release?.(); hold = false;
  expect(requests).toBe(1); expect(await load(page)).toEqual(before);
  await other.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(other).toContainText('一批记忆已整理并原子保存'); expect(requests).toBe(2);
  expect(await load(page)).toEqual(before);
  const second = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load('save-b'); } finally { repo.close(); }
  });
  expect(second.memories.medium).toHaveLength(1); expect(second.revision).toBe(before.revision); expect(second.journal).toEqual(before.journal);
});

test('正在原子保存时设置重开保持保存状态，不虚报可取消或重复发请求', async ({ page }) => {
  test.setTimeout(60000); let requests = 0;
  await page.route('https://maintenance.mock.invalid/**', async (route) => {
    requests++; await route.fulfill({ contentType: 'application/json', body: wire() });
  });
  await seed(page); const before = await load(page);
  // 测试专用保存屏障：阻塞真实事务之前，放行后仍调用原原子保存实现。
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const original = SaveRepository.prototype.saveMemoryCompression;
    SaveRepository.prototype.saveMemoryCompression = async function(...args: Parameters<typeof original>) {
      await new Promise<void>((resolve) => { Reflect.set(window, 'releaseMemorySave', resolve); });
      return original.apply(this, args);
    };
  });
  let maintenance = await panel(page);
  await maintenance.getByRole('button', { name: '整理记忆（可能产生费用）', exact: true }).click();
  await expect(maintenance.getByRole('button', { name: '正在原子保存…', exact: true })).toBeDisabled();
  await expect(maintenance.getByRole('button', { name: '取消记忆整理', exact: true })).toBeDisabled();
  await maintenance.getByRole('button', { name: '关闭资料界面' }).click();
  maintenance = await panel(page);
  await expect(maintenance.getByRole('button', { name: '正在原子保存…', exact: true })).toBeDisabled();
  await expect(maintenance.getByRole('button', { name: '取消记忆整理', exact: true })).toBeDisabled();
  expect(requests).toBe(1); expect(await load(page)).toEqual(before);
  await page.evaluate(() => { const release: unknown = Reflect.get(window, 'releaseMemorySave'); if (typeof release !== 'function') throw new Error('保存屏障未建立'); release(); });
  await expect(maintenance).toContainText('一批记忆已整理并原子保存');
  const after = await load(page); expect(after.memories.medium).toHaveLength(1);
  expect({ ...after, memories: before.memories }).toEqual(before); expect(requests).toBe(1);
});
