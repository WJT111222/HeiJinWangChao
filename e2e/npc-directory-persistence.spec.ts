import { openGameTools } from './helpers/gameLayout';
import { test, expect } from './helpers/test';
import { devices } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedRoster, openNpcRoster, closeNpcRoster, selectNpc, rosterGame, mockRosterTurn } from './helpers/npcRoster';
import { fullPrivateProfile } from '../src/tests/fixtures/npcUnified';

test('真实Chromium持久用户目录关闭重启，星标/休眠七字段不丢；正常Variables补齐、结算、撤回意图保留', async ({ playwright }, info) => {
  test.setTimeout(60000);
  const directory = mkdtempSync(join(tmpdir(), 'heijin-roster-browser-'));
  const device = devices[info.project.name === 'mobile' ? 'Pixel 7' : 'Desktop Chrome'];
  const options = { ...device, executablePath: process.env.CHROMIUM_PATH, headless: true, baseURL: 'http://127.0.0.1:5174' };
  let context = await playwright.chromium.launchPersistentContext(directory, options);
  try {
    await context.addInitScript(() => {
      const d = new Date(); localStorage.setItem('heijin.notices.hidden-on.v1', [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'));
    });
    let page = await context.newPage(); await seedRoster(page); const before = await rosterGame(page);
    let requests = 0; await context.route('https://summary.mock.invalid/**', async r => { requests++; await r.abort(); });
    await openNpcRoster(page); let detail = await selectNpc(page, '林澄');
    await detail.getByRole('button', { name: '设为特殊人物：林澄', exact: true }).click(); await expect(detail).toContainText('特殊人物资料待完善');
    detail = await selectNpc(page, '许岸'); await detail.getByRole('button', { name: '取消特殊身份：许岸', exact: true }).click();
    await expect(detail.getByRole('button', { name: '设为特殊人物：许岸', exact: true })).toBeVisible(); const stored = await rosterGame(page);
    expect(requests).toBe(0); await context.close();
    // Launch a new Chromium process using the same on-disk profile, not a UI-only state copy.
    context = await playwright.chromium.launchPersistentContext(directory, options);
    page = await context.newPage(); const mock = await mockRosterTurn(page);
    await page.goto('/#game/save-a'); await openNpcRoster(page); detail = await selectNpc(page, '许岸');
    expect(await rosterGame(page)).toEqual(stored); await expect(detail).not.toContainText('香闺秘档'); expect(mock.calls).toEqual([]);
    await detail.getByRole('button', { name: '设为特殊人物：许岸', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '香闺秘档', exact: true })).toBeVisible();
    const restored = await rosterGame(page); expect(restored.state.npc.special.privateProfile).toEqual(fullPrivateProfile);
    // Session-only mock credentials are intentionally not promised to survive browser exit.
    await page.evaluate(async () => {
      const a = '/src/services/ai/configuration.ts', c = '/src/services/ai/credentials.ts';
      const { readAiConfig } = await import(a), { CredentialVault } = await import(c);
      const config = readAiConfig(localStorage); new CredentialVault(sessionStorage, localStorage).set(config.channels[0].id, 'mock-summary-secret');
    });
    await closeNpcRoster(page); await page.getByLabel('你的行动', { exact: true }).fill('重新开始工作交流'); await page.getByRole('button', { name: '发送', exact: true }).click();
    try { await expect.poll(async () => (await rosterGame(page)).state.turnNumber, { timeout: 20000 }).toBe(before.state.turnNumber + 1); }
    catch { await openGameTools(page); throw new Error(JSON.stringify({ calls: mock.calls, workflow: await page.getByRole('region', { name: '三阶段工作流', exact: true }).innerText() })); }
    expect(mock.calls).toEqual(['story', 'variables', 'world']);
    await openNpcRoster(page); detail = await selectNpc(page, '林澄'); await expect(detail).not.toContainText('特殊人物资料待完善'); await expect(detail).toContainText('从社区成长为设计师');
    await closeNpcRoster(page); await page.getByRole('button', { name: /^撤回（1）$/ }).click();
    await page.getByRole('dialog', { name: '撤回上一回合', exact: true }).getByRole('button', { name: '确认撤回', exact: true }).click();
    await expect.poll(async () => (await rosterGame(page)).state.turnNumber).toBe(before.state.turnNumber);
    const undone = await rosterGame(page); expect(undone.state.npc.person).toMatchObject({ kind: 'special', importancePreference: 'special', profilePending: true });
    expect(undone.state.npc.special.privateProfile).toEqual(fullPrivateProfile); expect(undone.state.memories).toEqual(before.state.memories);
    await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('重新开始工作交流'); expect(mock.calls).toHaveLength(3);
  } finally { await context.close(); rmSync(directory, { recursive: true, force: true }); }
});
