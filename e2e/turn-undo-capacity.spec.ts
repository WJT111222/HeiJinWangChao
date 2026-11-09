import { expect, test } from './helpers/test';

// Separate from UI/Mock-model cases: real Chromium IndexedDB transaction timing,
// not a claim about low-end phones or the physical size of one object store.
for (const [turns, npcCount] of [[300, 150], [1000, 500]]) {
  test(`真实 IndexedDB ${turns} 回合容量与恢复测量`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.goto('/');
    const result = await page.evaluate(async ({ turns, npcCount }) => {
      const r = '/src/services/storage/saveRepository.ts', f = '/src/tests/fixtures/undoCapacity.ts', t = '/src/tests/fixtures/turn.ts';
      const { SaveRepository } = await import(r), { undoCapacityState } = await import(f),
        { completeDraft, elapsedVariables, submission } = await import(t);
      const state = undoCapacityState(turns, npcCount), name = `undo-capacity-test-${turns}`;
      const repo = await SaveRepository.open(name);
      try {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => { const db = open.result, tx = db.transaction('saves', 'readwrite');
            tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); }; }; open.onerror = () => reject(open.error);
        });
        const commitMs: number[] = [], undoMs: number[] = [];
        for (let i = 0; i < 5; i++) {
          const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '离线测量时间推进', 60) });
          const start = performance.now(); await repo.commitTurn(submission(draft, '')); commitMs.push(performance.now() - start);
        }
        const status = await repo.undoStatus('save-a'), estimate = await navigator.storage.estimate();
        for (let i = 0; i < status.available; i++) {
          const game = await repo.loadGame('save-a'), start = performance.now();
          await repo.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: `benchmark-${i}` });
          undoMs.push(performance.now() - start);
        }
        return { turns, npcCount, snapshotBytes: status.bytes, retained: status.available, maxBytes: status.maxBytes,
          commitMs, undoMs, originStorageEstimate: estimate, restoredTurns: (await repo.load('save-a')).turnNumber };
      } finally { repo.close(); }
    }, { turns, npcCount });
    expect(result.retained).toBe(turns === 300 ? 5 : 2);
    expect(result.snapshotBytes).toBeLessThanOrEqual(result.maxBytes);
    expect(result.restoredTurns).toBe(turns + 5 - result.retained);
    await info.attach(`indexeddb-${turns}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });
}
