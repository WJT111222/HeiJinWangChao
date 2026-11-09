import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openSettings } from './gameLayout';
export async function seedSummary(page: Page, options: { count?: number; publicLayer?: 'short' | 'medium'; npcCount?: number; automatic?: boolean; allKinds?: boolean; secondNpc?: boolean; ready?: boolean } = {}) {
  await page.goto('/');
  await page.evaluate(async options => {
    const cp = '/src/tests/fixtures/compression.ts', np = '/src/tests/fixtures/npcMemory.ts', rp = '/src/services/storage/saveRepository.ts',
      sp = '/src/ui/settings/model.ts', ap = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts', tp = '/src/tests/fixtures/turn.ts';
    const { compressionState } = await import(cp), { npcMemoryState } = await import(np), { SaveRepository } = await import(rp),
      { defaultSettings, settingsKey } = await import(sp), { defaultAiConfig, newChannel, saveAiConfig } = await import(ap), { CredentialVault } = await import(vp);
    const state = compressionState(options.publicLayer ?? 'short', options.allKinds ? 90 : options.count ?? 31);
    if (options.allKinds) { state.memories.medium = state.memories.short.slice(31, 82).map((entry: { id: string }) => ({ ...entry, id: `medium-${entry.id}` })); state.memories.short = state.memories.short.slice(0, 31); }
    if (options.npcCount) state.npc['npc-a'] = npcMemoryState(options.npcCount).npc['npc-a'];
    if (options.secondNpc) {
      const npc = structuredClone(state.npc['npc-a']); npc.id = 'npc-b'; npc.name = '第二人物'; npc.identityKey = 'identity-npc-b';
      npc.memories = npc.memories.map((entry: { id: string; affectedEntityRefs: { kind: string; id: string }[] }) => ({ ...entry, id: `b-${entry.id}`, affectedEntityRefs: [{ kind: 'npc', id: 'npc-b' }] })); state.npc['npc-b'] = npc;
    }
    const repo = await SaveRepository.open(); repo.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('heijinwangchao'); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    });
    if (options.ready) { const storage = await SaveRepository.open(); const { completeDraft, elapsedVariables } = await import(tp);
      try { await completeDraft(storage, { variables: await elapsedVariables(storage, '经过十分钟，主角完成用餐。', 600) }); } finally { storage.close(); } }
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    if (options.automatic === false) for (const item of Object.values(settings.memory.summaries) as { automatic: boolean }[]) item.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://summary.mock.invalid/v1'; channel.defaultModel = 'story'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world', 'memory']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-summary-secret');
  }, options);
  await page.reload(); await page.locator('.save-card').getByRole('button', { name: /读取存档/ }).click();
  await expect(page.locator('.game-layout')).toBeVisible();
}
export async function summaryPage(page: Page) {
  await openSettings(page); const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '记忆', exact: true }).click(); return dialog;
}
export async function summaryState(page: Page, id = 'save-a') {
  return page.evaluate(async id => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.load(id); } finally { repo.close(); } }, id);
}
export function summaryWire(task: Record<string, unknown>) {
  const groups = task.groups as { groupId: string }[] | undefined;
  const output = groups ? { summaries: groups.map(group => ({ groupId: group.groupId, text: '他回顾这段经历，保留了约定的来由和自己尚存的顾虑。' })), unresolved: [], contradictions: [] }
    : { summary: '人物在这些回合经历相遇、约定与变化，结果仍有后续影响。', importantEvents: ['记录中的游戏时间：一次有来源的约定与变化。'] };
  return { choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } };
}
export function requestTask(body: { messages: { role: string; content: string }[] }) {
  const text = body.messages.find(message => message.role === 'user' && message.content.startsWith('<GAME_CONTEXT>'))!.content;
  return JSON.parse(text.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)).MEMORY_TASK as Record<string, unknown>;
}
