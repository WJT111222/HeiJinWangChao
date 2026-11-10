import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSummary } from './memorySummary';
import { openWorldArchive } from './gameLayout';

export async function openNpcRoster(page: Page) {
  await expect(page.locator('.game-layout')).toBeVisible();
  await openWorldArchive(page);
  await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /NPC/ }).click();
  const dialog = page.getByRole('dialog', { name: 'NPC', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
export async function closeNpcRoster(page: Page) {
  await page.getByRole('dialog', { name: 'NPC', exact: true }).getByRole('button', { name: '关闭资料界面', exact: true }).click();
  const directory = page.getByRole('dialog', { name: '世界资料', exact: true });
  if (await directory.isVisible()) await directory.getByRole('button', { name: '关闭资料界面', exact: true }).click();
}
export async function selectNpc(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'NPC', exact: true });
  const back = dialog.getByRole('button', { name: '← 返回人物名录', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name: `查看人物：${name}`, exact: true }).click();
  return dialog.getByRole('region', { name: '人物详情', exact: true });
}
export async function rosterGame(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
export async function seedRoster(page: Page, ready = false) {
  await seedSummary(page, { count: 10, automatic: false });
  await page.evaluate(async ready => {
    const paths = ['/src/tests/fixtures/npcRoster.ts', '/src/services/storage/saveRepository.ts', '/src/domain/drafts.ts', '/src/tests/fixtures/turn.ts'];
    const [{ npcRosterState }, { SaveRepository }, { createTurnDraft }, { completeDraft }] = await Promise.all(paths.map(path => import(path)));
    const state = npcRosterState();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('heijinwangchao'); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result, tx = db.transaction(['saves', 'drafts'], 'readwrite');
        tx.objectStore('saves').put(state); tx.objectStore('drafts').put(createTurnDraft(state.saveId, state.revision, 'roster-next', 'regular', ready ? '原玩家输入' : ''));
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    if (ready) {
      const repo = await SaveRepository.open();
      try { await completeDraft(repo, { narrative: '【旁白】尚未结算的正文须保留。', summary: '保留候选',
        variables: { commands: [], rejectedSuggestions: [], unresolved: [] }, world: { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] } }); }
      finally { repo.close(); }
    }
  }, ready);
  await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
}

export async function mockRosterTurn(page: Page, hold = false) {
  const calls: string[] = []; let release: (() => void) | undefined;
  await page.route('https://summary.mock.invalid/**', async route => {
    const body = route.request().postDataJSON(), stage = String(body.model); calls.push(stage);
    const context = JSON.parse(body.messages.find((m: { content: string }) => m.content.startsWith('<GAME_CONTEXT>')).content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length));
    if (stage === 'story') {
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      const content = '<thinking>承接既有关系。</thinking><正文>【旁白】大家继续交谈，确认工作与各自安排。</正文><短期记忆>继续交流。</短期记忆><变量规划>[]</变量规划>';
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` }); return;
    }
    const profile = context.SAVE_STATE.npc.person?.profilePending ? '\nset npc[person].specialProfile = '+JSON.stringify({detailedBackground:'从社区成长为设计师，保持独立判断。',activeGoals:['完成合作'],habits:['记录草图'],offscreenTaskIds:[],relationshipNetwork:[]}) : '';
    const content = stage === 'variables' ? `<thinking>记录实际时间。</thinking><说明></说明><命令>\nset worldClock = "${new Date(Date.parse(context.SAVE_STATE.worldClock) + 60_000).toISOString()}"${profile}\n</命令>`
      : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
  });
  return { calls, release: () => release?.() };
}
