import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return { ...await repo.loadGame('save-a'), undo: await repo.undoStatus('save-a') }; } finally { repo.close(); }
  });
}
test('NPC新字段与休眠档案真实持久化、刷新及原子撤回；零模型请求', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://**/*', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/npcV2.ts', '/src/domain/npc/profiles.ts', '/src/tests/fixtures/turn.ts', '/src/tests/fixtures/world.ts'];
    const [{ SaveRepository }, { npcV2State }, { hibernateNpcProfile }, { completeDraft, elapsedVariables, submission }, { worldResult }] = await Promise.all(paths.map(path => import(path)));
    const state = npcV2State(), sleeping = hibernateNpcProfile(state, 'special', state.npc.special.identityKey), repo = await SaveRepository.open();
    try {
      await repo.create(sleeping);
      for (let turn = 0; turn < 2; turn++) await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '合成日常', 60), world: worldResult() }), ''));
    } finally { repo.close(); }
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  const before = await stored(page);
  expect(before.state.schemaVersion).toBe(8); expect(before.undo.available).toBe(1);
  expect(before.state.npc.person.usualLocations[0]).toMatchObject({ locationId: 'home', knownToProtagonist: false });
  expect(before.state.npc.special.kind).toBe('ordinary'); expect(before.state.dormantNpcProfiles.special.profile).toHaveProperty('privateProfile');
  await page.getByRole('button', { name: '撤回（1）', exact: true }).click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  const restored = await stored(page);
  expect(restored.state.npc).toEqual(before.state.npc); expect(restored.state.dormantNpcProfiles).toEqual(before.state.dormantNpcProfiles);
  expect(restored.undo.available).toBe(0);
  await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  expect(await stored(page)).toEqual(restored);
  expect(calls).toEqual([]);
});

test('V6联系人/初始同伴无损升级，旧RetireNpc拒绝且刷新不删档案', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://**/*', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  const original = await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/world.ts';
    const { SaveRepository } = await import(repoPath), { worldState } = await import(fixturePath);
    const state = worldState(); state.initialCompanionId = 'npc-a'; state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = ['scene'];
    const repo = await SaveRepository.open(); await repo.create(state); repo.close();
    const raw = { ...state, schemaVersion: 6 };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onsuccess = () => {
        const db = request.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      }; request.onerror = () => reject(request.error);
    }); return state;
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  const migrated = (await stored(page)).state;
  expect(migrated).toEqual(original); expect(migrated.schemaVersion).toBe(8);
  expect(migrated.npc['npc-a'].phoneContact).toBeUndefined(); expect(migrated.npc['npc-a'].usualLocations).toBeUndefined();
  const failed = await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try {
      const state = await repo.load('save-a');
      try {
        await repo.save('save-a', state.revision, 'retire', [{ type: 'RetireNpc', commandId: 'retire', npcId: 'scene', expectedIdentityKey: state.npc.scene.identityKey, reason: '旧清理', evidence: '旧候选', retainMemoryIds: [] }]);
        return false;
      } catch { return true; }
    } finally { repo.close(); }
  });
  expect(failed).toBe(true); await page.reload(); await expect(page.locator('.game-layout')).toBeVisible();
  expect((await stored(page)).state).toEqual(migrated); expect(calls).toEqual([]);
});

test('完整关闭浏览器再打开，持久人物与休眠专属档案仍一致', async ({ baseURL }, info) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'heijin-npc-v2-'));
  const calls: string[] = [];
  const launch = async () => {
    const context = await chromium.launchPersistentContext(directory, {
      executablePath: process.env.CHROMIUM_PATH, viewport: info.project.use.viewport,
    });
    await context.route('https://**/*', route => { calls.push(route.request().url()); return route.abort(); });
    await context.addInitScript(() => {
      const now = new Date();
      localStorage.setItem('heijin.notices.hidden-on.v1', [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-'));
    });
    return context;
  };
  let context: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    context = await launch(); let page = context.pages()[0]; await page.goto(baseURL!);
    await page.evaluate(async () => {
      const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/npcV2.ts', '/src/domain/npc/profiles.ts', '/src/domain/drafts.ts'];
      const [{ SaveRepository }, { npcV2State }, { hibernateNpcProfile }, { createTurnDraft }] = await Promise.all(paths.map(path => import(path)));
      const state = npcV2State(), repo = await SaveRepository.open();
      try {
        await repo.create(hibernateNpcProfile(state,'special',state.npc.special.identityKey));
        await repo.saveDraft(createTurnDraft(state.saveId,0,'persistent-opening','opening',''),null);
      } finally { repo.close(); }
    });
    await page.goto(baseURL+'#game/save-a'); await expect(page.locator('.game-layout')).toBeVisible();
    const original = await stored(page);
    await context.close(); context = undefined; // closes the Chromium process and its IndexedDB connections
    context = await launch(); page = context.pages()[0];
    await page.goto(baseURL+'#game/save-a'); await expect(page.locator('.game-layout')).toBeVisible();
    expect(await stored(page)).toEqual(original); expect(calls).toEqual([]);
  } finally { await context?.close(); await rm(directory, { recursive:true, force:true }); }
});
