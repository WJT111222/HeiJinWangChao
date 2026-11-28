import { readFile } from 'node:fs/promises';
import { test, expect } from './helpers/test';
import { openLibrary } from './helpers/home';

for (const version of [6, 7, 8, 9]) test(`V${version}旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖当前存档，五仓库不变`, async ({ page }, info) => {
  let posts = 0;
  await page.route('**/*', async route => {
    if (route.request().method() === 'POST') { posts++; await route.abort(); }
    else await route.continue();
  });
  await page.goto('/');
  const original = await page.evaluate(async version => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/game.ts'];
    const [{ SaveRepository }, { game }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(); await repo.create(game('current')); repo.close();
    const legacy = { ...game('legacy'), title: `V${version}旧存档`, schemaVersion: version, contactReviewNpcIds: [], retiredNpcs: {}, originalMarker: '旧原文\n第二行' };
    const draft = { saveId: 'legacy', turnId: 'old-turn', originalMarker: '旧草稿原文' };
    const receipt = { saveId: 'legacy', turnId: 'old-turn', originalMarker: '旧回执原文' };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['saves', 'drafts', 'turnReceipts'], 'readwrite');
        tx.objectStore('saves').put(legacy); tx.objectStore('drafts').put(draft); tx.objectStore('turnReceipts').put(receipt);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    return { legacy, draft, receipt };
  }, version);
  const snapshot = () => page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const request = indexedDB.open('heijinwangchao'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, names = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls'];
      const tx = db.transaction(names, 'readonly'), result: Record<string, unknown[]> = {};
      for (const name of names) { const get = tx.objectStore(name).getAll(); get.onsuccess = () => { result[name] = get.result; }; }
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const before = await snapshot(); await page.reload(); await openLibrary(page);
  const desktop = (page.viewportSize()?.width ?? 0) > 900;
  const card = page.locator(desktop ? '.save-card' : '.mh-ticket').filter({ hasText: `V${version}旧存档` });
  await expect(card).toContainText('无法读取'); await expect(card).toContainText('当前版本无法读取这条记录');
  if (!desktop) {
    await card.scrollIntoViewIfNeeded();
    await expect(page.locator('.mh-ticket-wrap[aria-current="true"]')).toContainText(`V${version}旧存档`);
  }
  const actions = desktop ? card : page.locator('.mh-acts');
  await expect(actions.getByRole('button', { name: /读取存档|继续游戏|选择/ })).toHaveCount(0);
  const pending = page.waitForEvent('download'); await actions.getByRole('button', { name: '导出原始数据', exact: true }).click();
  const download = await pending, path = await download.path(); if (!path) throw Error('missing download');
  const raw = JSON.parse(await readFile(path, 'utf8'));
  expect(raw.records.saves[0].value).toEqual(original.legacy);
  expect(raw.records.drafts[0].value).toEqual(original.draft);
  expect(raw.records.turnReceipts[0].value).toEqual(original.receipt);
  const refused = await page.evaluate(async version => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/services/storage/backup.ts'];
    const [{ SaveRepository }, { parseBackup }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      const [entry] = await repo.exportBackup(['current']), confirmation = (await repo.compareBackup(entry)).confirmation;
      const old = { ...entry, state: { ...entry.state, schemaVersion: version } };
      const parsed = await parseBackup(JSON.stringify({ format: 'heijin-backup', version: 1, app: 'synthetic', exportedAt: '', saves: [old] }));
      let compareRejected = false, importRejected = false, loadCode = '', loadMessage = '';
      try { await repo.load('legacy'); } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) loadCode = String(error.code);
        loadMessage = error instanceof Error ? error.message : String(error);
      }
      try { await repo.compareBackup(old); } catch { compareRejected = true; }
      try { await repo.importBackup(old, confirmation, { overwrite: true }); } catch { importRejected = true; }
      return { parsed: parsed.entries[0], compareRejected, importRejected, loadCode, loadMessage, version: (await repo.load('current')).schemaVersion };
    } finally { repo.close(); }
  }, version);
  expect(refused).toMatchObject({ parsed: { ok: false, code: 'UNSUPPORTED_VERSION' }, compareRejected: true, importRejected: true, loadCode: 'UNSUPPORTED_VERSION', version: 11 });
  expect(refused.loadMessage).toContain('仅支持 V10、V11 存档');
  expect(await snapshot()).toEqual(before); expect(posts).toBe(0);
  await card.scrollIntoViewIfNeeded();
  await info.attach(`${info.project.name}-v${version}-raw-kept`, { body: await page.screenshot(), contentType: 'image/png' });
});
