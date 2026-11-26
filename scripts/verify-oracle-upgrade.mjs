/* global window, indexedDB */
import process from 'node:process';
import console from 'node:console';
// Run the real pre-C3 release and the first C3 edition on the same origin as this checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, devices } from 'playwright';

const [release, previous] = process.argv.slice(2).map(root => resolve(root));
for (const [root, sha] of [[release, 'ae55434d24d17de651cf94b46583387d6ac67efc'], [previous, '2d89f09cdb7afb09c34fd829c17f91ad4a356803']])
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sha);

const origin = 'http://127.0.0.1:14631';
let server;
async function serve(root) {
  await server?.close();
  const { createServer } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')));
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 14631, strictPort: true, hmr: false, watch: null } });
  await server.listen();
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  for (const device of ['desktop', 'mobile']) for (const root of [release, previous]) {
    const context = await browser.newContext(device === 'mobile' ? devices['Pixel 7'] : {});
    try {
      await context.route(origin + '/probe', route => route.fulfill({ contentType: 'text/html', body: '<title>同源升级</title>' }));
      await serve(root);
      const old = await context.newPage(), current = await context.newPage();
      await old.goto(origin + '/probe');
      const before = await old.evaluate(async hasNote => {
        const [{ SaveRepository }, { game }, { createTurnDraft }] = await Promise.all(
          ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/game.ts', '/src/domain/drafts.ts'].map(path => import(path)));
        const repo = await SaveRepository.open();
        await repo.create(game('upgrade'));
        const draft = createTurnDraft('upgrade', 0, 'r', 'opening', '读取');
        await repo.saveDraft(draft, null);
        const lease = await repo.prepareWorldview(draft, false);
        if (hasNote) await repo.writeOracleNote('upgrade', await repo.readOracleNote('upgrade'), '旧版纸条', false);
        window.checkOld = async () => {
          for (const work of [() => repo.loadDraft('upgrade'), () => repo.undoStatus('upgrade'), () => repo.prepareWorldview(draft, true)]) {
            try { await work(); throw new Error('旧连接仍能写入'); }
            catch (e) { if (e.name !== 'InvalidStateError') throw e; }
          }
          try { await SaveRepository.open(); } catch (e) { return e.name; }
        };
        // The versionchange request must wait for an outstanding read/write transaction.
        const gameBeforeUpgrade = await repo.loadGame('upgrade');
        const raw = await new Promise(resolve => { const open = indexedDB.open('heijinwangchao'); open.onsuccess = () => resolve(open.result); });
        const tx = raw.transaction('saves', 'readwrite');
        let hold = true;
        const read = () => { const get = tx.objectStore('saves').get('upgrade'); get.onsuccess = () => { if (hold) read(); }; };
        read();
        raw.onversionchange = () => { window.upgrading = true; raw.close(); };
        window.releaseTransaction = () => { hold = false; };
        return { game: gameBeforeUpgrade, lease: lease.generation };
      }, root === previous);
      await serve(process.cwd());
      await current.goto(origin + '/probe');
      const upgrading = current.evaluate(async () => {
        const { SaveRepository } = await import('/src/services/storage/saveRepository.ts');
        const repo = await SaveRepository.open(); window.repo = repo;
        return repo.upgradedFrom;
      });
      await old.waitForFunction(() => window.upgrading === true);
      await old.evaluate(() => window.releaseTransaction());
      assert.equal(await upgrading, 10);
      const state = await current.evaluate(async () => {
        const repo = window.repo;
        const old = await repo.readOracleNote('upgrade');
        const saved = await repo.writeOracleNote('upgrade', old, '新页保存', true);
        const game = await repo.loadGame('upgrade'), undo = await repo.undoStatus('upgrade');
        await repo.prepareWorldview(game.draft, false);
        const raw = await repo.exportRaw('upgrade');
        return { old, saved, game, undo: undo.available, control: raw.records.saveControls[0].value };
      });
      assert.deepEqual(state.game, before.game);
      assert.equal(state.old.note?.text ?? null, root === previous ? '旧版纸条' : null);
      if (root === previous) assert.equal(state.old.note.once, false);
      assert.equal(state.saved.note.text, '新页保存');
      assert.equal(Object.hasOwn(state.control, 'oracleNote'), false);
      assert.equal(await old.evaluate(() => window.checkOld()), 'VersionError');
      await old.reload();
      const reloaded = await old.evaluate(async () => {
        const { SaveRepository, saveDatabaseVersion } = await import('/src/services/storage/saveRepository.ts');
        const repo = await SaveRepository.open();
        try { return { version: saveDatabaseVersion, paper: await repo.readOracleNote('upgrade'), game: await repo.loadGame('upgrade') }; }
        finally { repo.close(); }
      });
      assert.deepEqual(reloaded.game, before.game);
      assert.deepEqual(reloaded.paper, state.saved);
      assert.equal(reloaded.version, 12);
      console.log(JSON.stringify({ device, old: root === previous ? 'C3' : 'release', from: 10, to: reloaded.version,
        saveFormat: state.game.state.schemaVersion, revision: state.game.state.revision, undo: state.undo, paper: reloaded.paper, controlHasOracleNote: false }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); await server?.close(); }
