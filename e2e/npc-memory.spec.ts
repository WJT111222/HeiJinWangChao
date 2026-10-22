import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameStateSchema } from '../src/domain/state';
import { array, record, string } from '../src/services/ai/protocols';

// 只在隔离浏览器存储中使用，全部请求拦截到mock.invalid。
async function seed(page: Page, automatic = false) {
  await page.goto('/');
  await page.evaluate(async (automatic) => {
    const fixturePath = '/src/tests/fixtures/npcMemory.ts', repoPath = '/src/services/storage/saveRepository.ts',
      turnPath = '/src/tests/fixtures/turn.ts', settingsPath = '/src/ui/settings/model.ts',
      configPath = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { npcMemoryState } = await import(fixturePath), { SaveRepository } = await import(repoPath),
      { completeDraft } = await import(turnPath), { defaultSettings, settingsKey } = await import(settingsPath),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath), { CredentialVault } = await import(vaultPath);
    const state = npcMemoryState(automatic ? 30 : 21), repo = await SaveRepository.open(); repo.close();
    if (automatic) state.memories.short = state.journal.map((entry: { turnId: string; story: { summary: string } }, i: number) => ({ id: `short-${i}`, text: entry.story.summary, sourceTurnIds: [entry.turnId], affectedEntityRefs: [], visibility: 'player_known', createdAtGameTime: state.worldClock }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao');
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      }; request.onerror = () => reject(request.error);
    });
    if (automatic) { const storage = await SaveRepository.open(); try { await completeDraft(storage, { variables: { commands: [], rejectedSuggestions: [], unresolved: [] } }); } finally { storage.close(); } }
    const settings = defaultSettings(); settings.memory.automaticMaintenance = automatic;
    settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://npc-memory.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world', 'memory']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'npc-browser-mock-secret');
  }, automatic);
  await page.reload(); await page.getByRole('button', { name: /读取存档/ }).click();
}
async function load(page: Page) {
  const value: unknown = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load('save-a'); } finally { repo.close(); }
  }); return GameStateSchema.parse(value);
}
async function memory(page: Page) {
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /记忆/ }).click();
  return page.getByRole('dialog', { name: '记忆', exact: true });
}
function context(body: unknown) {
  const content = array(record(body).messages).map((entry) => string(record(entry).content)).join('\n');
  const match = content.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  if (!match) throw new Error('实际请求缺少上下文'); return record(JSON.parse(match[1]));
}
const wire = (text: string) => JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
function reply(body: unknown) {
  const task = record(context(body).MEMORY_TASK);
  return JSON.stringify({ summaries: array(task.groups).map((group) => ({ groupId: record(group).groupId, text: '私人总结A，保留未了约定与历史认知。' })), unresolved: [], contradictions: [] });
}

test('手动仅一人一批；普通界面不暴露身份、原文、总结和秘密条数；来源完整且刷新不重复收费', async ({ page }) => {
  let requests = 0;
  await page.route('https://npc-memory.mock.invalid/**', async (route) => {
    requests++; const body: unknown = route.request().postDataJSON();
    expect(JSON.stringify(body)).not.toMatch(/B的独占秘密|背景秘密|SAVE_STATE|npc-browser-mock-secret|A的私人经历21/);
    expect(record(context(body).MEMORY_TASK).npcId).toBe('npc-a');
    await route.fulfill({ contentType: 'application/json', body: wire(reply(body)) });
  });
  await seed(page); const before = await load(page), panel = await memory(page);
  await expect(panel).toContainText('存在可维护任务');
  await expect(panel).not.toContainText('未公开人物A'); await expect(panel).not.toContainText('A的私人经历');
  await panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true }).click();
  await expect(panel).toContainText('一批私人记忆已整理并原子保存');
  await expect(panel).not.toContainText('私人总结A'); await expect(panel).not.toContainText('npc-a-memory');
  await expect(panel).toContainText('暂无可安全维护任务');
  const after = await load(page);
  expect(after.npc).toEqual(before.npc); expect(after.journal).toEqual(before.journal); expect(after.revision).toBe(before.revision);
  expect(after.memories.npcSummaries['npc-a'][0].npcProvenance!.sourceMemoryIds).toHaveLength(10);
  expect(after.memories.npcSummaries['npc-b']).toBeUndefined();
  await panel.getByLabel('搜索历史回合').fill('私人总结A'); await expect(panel).toContainText('未找到相关的已提交历史');
  await panel.getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /NPC/ }).click();
  await expect(page.getByRole('dialog')).not.toContainText('未公开人物A'); await expect(page.getByRole('dialog')).not.toContainText('私人总结A');
  await page.getByRole('dialog').getByRole('button', { name: '关闭资料界面' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: '提示词管理', exact: true }).click();
  await settings.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const requestsList = settings.getByRole('combobox', { name: '选择请求', exact: true });
  await requestsList.selectOption({ label: await requestsList.locator('option').filter({ hasText: 'memory.npc_summarize' }).innerText() });
  await expect(settings).toContainText('私人维护仅展示模块结构与用量');
  await expect(settings.getByRole('button', { name: '主动查看完整内部上下文' })).toHaveCount(0);
  await expect(settings.locator('.inspection-statistics dd').nth(2)).toHaveText('50');
  await expect(settings.locator('.inspection-statistics dd').nth(3)).toHaveText('20');
  await expect(settings).not.toContainText('未公开人物A'); await expect(settings).not.toContainText('A的私人经历');
  await page.reload(); expect(requests).toBe(1); expect(await load(page)).toEqual(after);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('跨标签拒绝重复付费；取消/迟到/429不删除来源，明确手动重试可成功', async ({ page, context: browser }) => {
  let requests = 0, status = 200, hold = true, release: (() => void) | undefined;
  await browser.route('https://npc-memory.mock.invalid/**', async (route) => {
    requests++; if (hold) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status, contentType: 'application/json', body: status === 200 ? wire(reply(route.request().postDataJSON())) : '{}' }).catch(() => undefined);
  });
  await seed(page); const before = await load(page), panel = await memory(page);
  await panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  const other = await browser.newPage(); await other.goto('/'); await other.getByRole('button', { name: /读取存档/ }).click();
  const second = await memory(other);
  await second.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true }).click();
  await expect(second).toContainText('私人记忆整理未完成'); expect(requests).toBe(1);
  await panel.getByRole('button', { name: '取消记忆整理', exact: true }).click();
  await expect(panel).toContainText('私人记忆整理未完成'); release?.(); hold = false;
  expect(await load(page)).toEqual(before); status = 429;
  await panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true })).toBeEnabled();
  expect(await load(page)).toEqual(before); status = 200;
  await panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true }).click();
  await expect(panel).toContainText('一批私人记忆已整理并原子保存'); expect(requests).toBe(3);
  await other.close();
});

test('公开自动维护开关不授权NPC额外收费；新正式回合和下一轮三阶段不退化', async ({ page }) => {
  test.setTimeout(60000);
  const tasks: string[] = [], stages: string[] = [];
  await page.route('https://npc-memory.mock.invalid/**', async (route) => {
    const body: unknown = route.request().postDataJSON(), model = string(record(body).model); stages.push(model);
    if (model === 'memory') {
      const task = string(record(context(body).MEMORY_TASK).task); tasks.push(task);
      await route.fulfill({ contentType: 'application/json', body: wire(JSON.stringify({ entries: [{ text: '公开经历的整理' }], unresolved: [], contradictions: [] })) }); return;
    }
    if (model === 'story') {
      const text = '<正文>主角安静观察周围。</正文><短期记忆>在原地观察</短期记忆><变量规划>[]</变量规划>';
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` }); return;
    }
    const text = model === 'variables' ? JSON.stringify({ commands: [], rejectedSuggestions: [], unresolved: [] })
      : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] });
    await route.fulfill({ contentType: 'application/json', body: wire(text) });
  });
  await seed(page, true); await page.reload(); expect(tasks).toEqual([]);
  await page.getByLabel('你的行动', { exact: true }).fill('继续观察'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => stages.filter((model) => model !== 'memory')).toEqual(['story', 'variables', 'world']);
  await expect.poll(async () => (await load(page)).memories.medium.length).toBe(1);
  await page.getByLabel('你的行动', { exact: true }).fill('继续等待'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  expect(tasks).toEqual(['memory.short_to_medium']);
  const after = await load(page); expect(after.memories.npcSummaries).toEqual({}); expect(after.npc['npc-a'].memories).toHaveLength(30);
  const panel = await memory(page); await expect(panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true })).toBeEnabled();
  await expect(panel).not.toContainText('未公开人物A'); await expect(panel).not.toContainText('A的私人经历');
});

for (const blockedB of [false, true]) {
  test(`预算跳过与可维护状态一致：A超长、B${blockedB ? '也超长不请求' : '正常只整理B'}`, async ({ page }) => {
    let requests = 0;
    await page.route('https://npc-memory.mock.invalid/**', async (route) => {
      requests++; const body: unknown = route.request().postDataJSON();
      expect(record(context(body).MEMORY_TASK).npcId).toBe('npc-b');
      expect(JSON.stringify(body)).not.toContain('A的超长原始记忆');
      await route.fulfill({ contentType: 'application/json', body: wire(reply(body)) });
    });
    await seed(page);
    await page.evaluate(async (blockedB) => {
      const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
      const state = await repo.load('save-a'); repo.close();
      state.npc['npc-b'].memories = state.npc['npc-a'].memories.map((entry: { id: string }, index: number) => ({ ...entry,
        id: `budget-b-${index}`, text: `B自己的合法经历${index}`, affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }] }));
      state.npc['npc-a'].memories[0].text = 'A的超长原始记忆'.repeat(10000);
      if (blockedB) state.npc['npc-b'].memories[0].text = 'B的超长原始记忆'.repeat(10000);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => { const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
        request.onerror = () => reject(request.error);
      });
    }, blockedB);
    await page.reload(); await expect(page.getByRole('complementary', { name: '主角信息' })).toBeVisible();
    const before = await load(page), panel = await memory(page), button = panel.getByRole('button', { name: '整理NPC私人记忆（可能产生费用）', exact: true });
    if (blockedB) {
      await expect(panel).toContainText('暂无可安全维护任务'); await expect(button).toBeDisabled();
      expect(requests).toBe(0); expect(await load(page)).toEqual(before);
    } else {
      await expect(button).toBeEnabled(); await button.click();
      await expect(panel).toContainText('一批私人记忆已整理并原子保存');
      await expect(panel).toContainText('暂无可安全维护任务'); await expect(button).toBeDisabled();
      const after = await load(page); expect(after.npc).toEqual(before.npc);
      expect(after.memories.npcSummaries['npc-a']).toBeUndefined();
      expect(after.memories.npcSummaries['npc-b'][0].npcProvenance!.sourceMemoryIds).toHaveLength(10);
      await page.reload(); expect(requests).toBe(1); expect(await load(page)).toEqual(after);
    }
  });
}
