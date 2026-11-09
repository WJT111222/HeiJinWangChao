// Local fake-indexeddb benchmark of the REAL Repository. No network/model requests,
// browser/player database, branch writes, or differential rollback algorithm.
import { createServer } from 'vite';
import { IDBFactory } from 'fake-indexeddb';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';
// Separate processes keep peak-RSS measurements from inheriting preceding cases.
const cases = [[10, 10, 6000], [100, 50, 6000], [300, 150, 6000], [1000, 500, 6000], [1000, 1000, 20000]];
if (!process.argv[2]) {
  for (const size of cases) process.stdout.write(execFileSync(process.execPath,
    ['--expose-gc', '--max-old-space-size=4096', fileURLToPath(import.meta.url), JSON.stringify(size)], { encoding: 'utf8' }));
  process.exit(0);
}
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent' });
try {
  const { SaveRepository } = await server.ssrLoadModule('/src/services/storage/saveRepository.ts');
  const { undoCapacityState } = await server.ssrLoadModule('/src/tests/fixtures/undoCapacity.ts');
  const { completeDraft, elapsedVariables, submission } = await server.ssrLoadModule('/src/tests/fixtures/turn.ts');
  const sizes = [JSON.parse(process.argv[2])];
  for (const [turns, npcCount, narrativeChars] of sizes) {
    const factory = new IDBFactory(), name = 'synthetic-undo-benchmark', repo = await SaveRepository.open(name, factory);
    const state = undoCapacityState(turns, npcCount, narrativeChars);
    await new Promise((resolve, reject) => {
      const open = factory.open(name);
      open.onsuccess = () => { const db = open.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
      open.onerror = () => reject(open.error);
    });
    globalThis.gc?.();
    const commits = [], undos = [], heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5; i++) {
      globalThis.gc?.();
      const game = await repo.loadGame('save-a');
      if (game.draft) await repo.bindTurnAction(game.draft, `测量行动${i}`, true, true);
      const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '合成时间推进', 60) });
      const start = performance.now(); await repo.commitTurn(submission(draft, '')); commits.push(performance.now() - start);
    }
    const status = await repo.undoStatus('save-a');
    for (let i = 0; i < status.available; i++) {
      globalThis.gc?.();
      const game = await repo.loadGame('save-a'), start = performance.now();
      await repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: `measure-${i}` });
      undos.push(performance.now() - start);
    }
    const median = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
    globalThis.gc?.();
    log(JSON.stringify({ synthetic: true, backend: 'fake-indexeddb', turns, npcCount, narrativeChars,
      formalBytes: Buffer.byteLength(JSON.stringify(state)), retainedSnapshots: status.available, snapshotBytes: status.bytes,
      maxBytes: status.maxBytes, commitMs: commits, undoMs: undos, medianCommitMs: median(commits), medianUndoMs: median(undos),
      heapDeltaMiB: (process.memoryUsage().heapUsed - heapBefore) / 1048576, processPeakRssMiB: process.resourceUsage().maxRSS / 1024 }));
    repo.close();
  }
} finally { await server.close(); }
