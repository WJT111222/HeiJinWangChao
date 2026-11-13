import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// No App boot: the first tab must really keep the deployed V3 connection before
// the updated repository opens. Both documents use the same browser origin/DB.
async function bare(page: Page, suffix: string) {
  await page.route(`**/__backup-upgrade-${suffix}`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html lang="zh"><title>存档版本边界测试</title><body>存档版本边界测试</body></html>',
  }));
  await page.goto(`/__backup-upgrade-${suffix}`);
}
async function legacy(page: Page, name: string, block = false) {
  return page.evaluate(async ({ name, block }) => {
    const fixturePath = '/src/tests/fixtures/legacySaveRepositoryV3.ts';
    const gamePath = '/src/tests/fixtures/game.ts', draftPath = '/src/domain/drafts.ts';
    const { LegacySaveRepositoryV3 } = await import(fixturePath), { game } = await import(gamePath);
    const { createTurnDraft } = await import(draftPath);
    const repo = await LegacySaveRepositoryV3.open(name);
    Reflect.set(window, 'legacyBackupRepository', repo);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const op = indexedDB.open(name, 3); op.onsuccess = () => resolve(op.result); op.onerror = () => reject(op.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['saves', 'drafts'], 'readwrite');
      tx.objectStore('saves').put(game('save-a'));
      tx.objectStore('drafts').put(createTurnDraft('save-a', 0, 'turn-a', 'regular', '原待发送行动'));
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    if (block) Reflect.set(window, 'backupUpgradeBlocker', db);
    else db.close();
    return repo.load('save-a');
  }, { name, block });
}
async function importAndRead(page: Page, name: string) {
  return page.evaluate(async name => {
    const path = '/src/services/storage/saveRepository.ts', draftPath = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(path), { createTurnDraft } = await import(draftPath);
    const repo = await SaveRepository.open(name);
    try {
      const before = await repo.loadGame('save-a');
      const entry = { state: { ...before.state, title: '新导入的正式进度' },
        draft: createTurnDraft('save-a', before.state.revision, 'turn-imported', 'regular', '导入的原开局草稿内容') };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation, { overwrite: true });
      const loaded = await repo.loadGame('save-a'), raw = await repo.exportRaw('save-a');
      return { before, entry, loaded, raw };
    } finally { repo.close(); }
  }, name);
}
let posts = 0;
test.beforeEach(async ({ context }) => {
  posts = 0;
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') { posts++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
});
test.afterEach(() => expect(posts).toBe(0));

test('真实双标签：V3 连接关闭，旧删除与重开拒绝；同 ID 同 revision 导入及草稿保留，新版刷新后正常操作', async ({ page, context }) => {
  const name = 'browser-old-page-delete';
  await bare(page, 'legacy'); const stale = await legacy(page, name);
  const updated = await context.newPage(); await bare(updated, 'updated');
  const imported = await importAndRead(updated, name);
  expect(imported.before.state).toEqual(stale);
  expect(imported.loaded.state).toEqual(imported.entry.state);
  expect(imported.loaded.state.revision).toBe(stale.revision);
  expect(imported.loaded.draft).toEqual({ ...imported.entry.draft, draftRevision: 1 });
  expect(imported.loaded.instance).toMatch(/^instance-/);
  const errors = await page.evaluate(async ({ name, revision }) => {
    const path = '/src/tests/fixtures/legacySaveRepositoryV3.ts';
    const { LegacySaveRepositoryV3 } = await import(path);
    let deletion = '', reopen = '';
    try { await Reflect.get(window, 'legacyBackupRepository').delete('save-a', revision); }
    catch (error) { deletion = (error as DOMException).name; }
    try { const repo = await LegacySaveRepositoryV3.open(name); repo.close(); }
    catch (error) { reopen = (error as DOMException).name; }
    return { deletion, reopen };
  }, { name, revision: stale.revision });
  expect(errors).toEqual({ deletion: 'InvalidStateError', reopen: 'VersionError' });
  const after = await updated.evaluate(async name => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open(name);
    try {
      const raw = await repo.exportRaw('save-a'), loaded = await repo.loadGame('save-a');
      await repo.delete('save-a', loaded.state.revision, loaded.instance);
      return { raw, loaded, remaining: await repo.list() };
    } finally { repo.close(); }
  }, name);
  expect(after.raw).toEqual(imported.raw); expect(after.loaded).toEqual(imported.loaded); expect(after.remaining).toEqual([]);
  console.log(JSON.stringify({ case: 'v3-closed', ...errors, importedSaveIntact: true, importedDraftIntact: true, refreshedDelete: true, posts }));
});

test('真实双标签：不释放的旧连接阻止升级与导入，原记录不变，关闭后重试成功', async ({ page, context }) => {
  const name = 'browser-blocked-upgrade';
  await bare(page, 'blocked'); const stale = await legacy(page, name, true);
  const updated = await context.newPage(); await bare(updated, 'retry');
  const blocked = await updated.evaluate(async name => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    try { const repo = await SaveRepository.open(name); repo.close(); return { code: 'unexpected-success' }; }
    catch (error) { return { code: (error as { code: string }).code }; }
  }, name);
  expect(blocked.code).toBe('STORAGE_BLOCKED');
  const unchanged = await page.evaluate(async () => {
    const db = Reflect.get(window, 'backupUpgradeBlocker') as IDBDatabase;
    const records = await new Promise<{ state: unknown; draft: unknown }>((resolve, reject) => {
      const tx = db.transaction(['saves', 'drafts'], 'readonly');
      const state = tx.objectStore('saves').get('save-a'), draft = tx.objectStore('drafts').get('save-a');
      tx.oncomplete = () => resolve({ state: state.result, draft: draft.result }); tx.onabort = () => reject(tx.error);
    });
    const version = db.version; db.close(); return { ...records, version };
  });
  expect(unchanged.version).toBe(3); expect(unchanged.state).toEqual(stale);
  expect(unchanged.draft).toMatchObject({ turnId: 'turn-a', userInput: '原待发送行动', draftRevision: 0 });
  const imported = await importAndRead(updated, name);
  expect(imported.before.state).toEqual(stale); expect(imported.before.draft).toEqual(unchanged.draft);
  expect(imported.loaded.state).toEqual(imported.entry.state); expect(imported.loaded.instance).toMatch(/^instance-/);
  console.log(JSON.stringify({ case: 'v3-blocked', blocked: blocked.code, originalRecordsIntact: true, retryImportSucceeded: true, posts }));
});
