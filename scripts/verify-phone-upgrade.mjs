// Run against two installed checkouts on the same browser origin to exercise the real V8 writer.
import assert from 'node:assert/strict';
import process from 'node:process';
import { resolve, join } from 'node:path';
import console from 'node:console';
import { URL, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const [baseArg, candidateArg] = process.argv.slice(2);
if (!baseArg || !candidateArg)
  throw new Error('Usage: node scripts/verify-phone-upgrade.mjs PR248_MERGE_CHECKOUT PHONE_CHECKOUT');
const base = resolve(baseArg),
  candidate = resolve(candidateArg);
const sha = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
assert.equal(
  sha(base),
  '3be381f64808b16d46ed54c6cf1fb0065555c0ed',
  'Use the accepted #248 merge as the V8 writer',
);
assert.notEqual(base, candidate, 'Use separate V8 and V9 checkouts');

const { chromium } = await import(pathToFileURL(join(candidate, 'node_modules/playwright/index.mjs')));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const origin = 'http://127.0.0.1:14588',
  dbName = 'phone-native-upgrade';
let server,
  posts = 0;
try {
  for (const device of ['desktop', 'mobile']) {
    const context = await browser.newContext(
      device === 'mobile' ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {},
    );
    await context.route('**/*', (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        posts++;
        return route.abort();
      }
      if (new URL(req.url()).origin !== origin) return route.abort();
      if (req.url() === origin + '/verify')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>IndexedDB upgrade</title>',
        });
      return route.continue();
    });
    let previous;
    for (const root of [base, candidate]) {
      const { createServer } = await import(
        pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js'))
      );
      server = await createServer({
        root,
        logLevel: 'error',
        server: { host: '127.0.0.1', port: 14588, strictPort: true, hmr: false },
      });
      await server.listen();
      const page = await context.newPage();
      await page.goto(origin + '/verify');
      if (root === base) {
        await page.evaluate(async (dbName) => {
          const [
            { SaveRepository },
            { worldState },
            { completeDraft, submission, elapsedVariables },
            { prepareTheater },
            { defaultSettings },
            { defaultAiConfig, newChannel },
            { CredentialVault },
          ] = await Promise.all(
            [
              '/src/services/storage/saveRepository.ts',
              '/src/tests/fixtures/world.ts',
              '/src/tests/fixtures/turn.ts',
              '/src/workflows/theater.ts',
              '/src/ui/settings/model.ts',
              '/src/services/ai/configuration.ts',
              '/src/services/ai/credentials.ts',
            ].map((p) => import(p)),
          );
          const repo = await SaveRepository.open(dbName);
          try {
            const old = worldState();
            await repo.create(old);
            const { targetFor } = await import('/src/services/images/model.ts');
            const bytes = Uint8Array.from(
              globalThis.atob(
                'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==',
              ),
              (c) => c.charCodeAt(0),
            );
            await repo.images.save(
              { saveId: old.saveId, createdAt: old.createdAt },
              targetFor(old, 'npc', 'npc-a'),
              'avatar',
              bytes,
            );
            const config = defaultAiConfig(),
              channel = newChannel();
            channel.defaultModel = 'fixture';
            channel.baseUrl = globalThis.location.origin + '/fixture';
            config.channels = [channel];
            config.routes.story = { channelId: channel.id, modelId: '' };
            const vault = new CredentialVault(globalThis.sessionStorage, globalThis.localStorage);
            vault.set(channel.id, 'fixture-local');
            const project = await prepareTheater(
              { title: 'V8 剧场', theme: '迁移', target: 1500, stream: false, perspective: 'third' },
              defaultSettings(),
              config,
              vault,
            );
            const theater = await repo.theaters.create(
              'save-a',
              project,
              await repo.theaters.getOwner('save-a'),
            );
            await repo.theaters.saveText(theater, '保留已经写完的小剧场正文。', 'complete');
            for (let turn = 0; turn < 2; turn++) {
              const candidate = await completeDraft(repo, {
                variables: await elapsedVariables(repo, '经过一分钟', 60),
              });
              await repo.commitTurn(submission(candidate));
              if (turn === 0) await repo.history.create('save-a', '第一回合手动收藏');
            }
            await completeDraft(repo, { variables: await elapsedVariables(repo, '停留一分钟', 60) });
          } finally {
            repo.close();
          }
        }, dbName);
      }
      const data = await page.evaluate(async (dbName) => {
        const { SaveRepository } = await import('/src/services/storage/saveRepository.ts');
        const { serializeBackup } = await import('/src/services/storage/backup.ts');
        const repo = await SaveRepository.open(dbName);
        try {
          const game = await repo.loadGame('save-a'),
            history = await repo.history.list('save-a');
          const manual = history.nodes.find((n) => n.kind === 'manual'),
            preview = await repo.history.preview('save-a', { kind: 'manual', id: manual.id });
          const [entry] = await repo.exportBackup(['save-a']);
          const backup = JSON.parse(await serializeBackup([entry], 'comparison'));
          const [schema] = (await globalThis.indexedDB.databases()).filter((d) => d.name === dbName);
          return {
            version: schema.version,
            game,
            nodes: history.nodes,
            manualState: preview.state,
            undo: await repo.undoStatus('save-a'),
            theaters: entry.theaters,
            images: backup.saves[0].images,
            backup,
          };
        } finally {
          repo.close();
        }
      }, dbName);
      if (!previous) {
        assert.equal(data.version, 8);
        previous = data;
      } else {
        const { version: newVersion, backup: newPackage, ...after } = data,
          { version: oldVersion, backup: oldPackage, ...before } = previous;
        assert.deepEqual([oldVersion, newVersion], [8, 9]);
        for (const state of [before.game.state, before.manualState]) {
          assert.equal(state.schemaVersion, 10);
          state.schemaVersion = 11;
          state.phone = { threads: {}, scheduled: [], topics: [] };
          for (const person of Object.values(state.npc)) person.appearedInStory = true;
        }
        assert.deepEqual(after, before);
        assert.equal(oldPackage.version, 3);
        assert.equal(newPackage.version, 4);
        assert.equal(after.images.pictures.length, 1);
        for (const file of [oldPackage, newPackage]) {
          const restored = await page.evaluate(
            async ({ file, dbName }) => {
              const { SaveRepository } = await import('/src/services/storage/saveRepository.ts');
              const { parseBackup } = await import('/src/services/storage/backup.ts');
              const repo = await SaveRepository.open(dbName + '-restore-' + file.version);
              try {
                const [entry] = (await parseBackup(JSON.stringify(file))).entries;
                if (!entry.ok) throw Error('backup rejected ' + JSON.stringify(entry));
                await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
                const [saved] = await repo.exportBackup([entry.state.saveId]);
                return { state: saved.state, images: saved.images, theaters: saved.theaters };
              } finally {
                repo.close();
              }
            },
            { file, dbName },
          );
          assert.deepEqual(restored.state, JSON.parse(JSON.stringify(after.game.state)));
          assert.deepEqual(restored.theaters, after.theaters);
          assert.deepEqual(restored.images, after.images);
        }
        assert.equal(after.game.state.journal.length, 2);
        assert.equal(after.manualState.turnNumber, 1);
        assert.equal(after.theaters[0].body, '保留已经写完的小剧场正文。');

        for (const field of ['entities', 'variables', 'world']) assert.ok(after.game.draft[field]);
        const committed = await page.evaluate(async (dbName) => {
          const { SaveRepository } = await import('/src/services/storage/saveRepository.ts');
          const { submission } = await import('/src/tests/fixtures/turn.ts');
          const repo = await SaveRepository.open(dbName);
          try {
            const draft = await repo.loadDraft('save-a'),
              input = submission(draft);
            const first = await repo.commitTurn(input),
              replay = await repo.commitTurn(input);
            const journal = (await repo.load('save-a')).journal.length;
            const undo = async (id) => {
              const { state, draft } = await repo.loadGame('save-a');
              return (
                await repo.undoTurn({
                  saveId: 'save-a',
                  expectedRevision: state.revision,
                  expectedDraft: draft,
                  operationId: id,
                })
              ).state;
            };
            const undoNew = await undo('undo-new'),
              undoOld = await undo('undo-old');
            const history = await repo.history.list('save-a'),
              manual = history.nodes.find((n) => n.kind === 'manual');
            const preview = await repo.history.preview('save-a', { kind: 'manual', id: manual.id });
            const restored = await repo.history.restore(preview.confirmation, '回到江边', true, true);
            return {
              turn: first.state.turnNumber,
              replayed: replay.replayed,
              journal,
              undo: [undoNew.turnNumber, undoOld.turnNumber],
              versions: [undoOld.schemaVersion, restored.state.schemaVersion],
              restored: restored.state.turnNumber,
            };
          } finally {
            repo.close();
          }
        }, dbName);
        assert.deepEqual(committed, {
          turn: 3,
          replayed: true,
          journal: 3,
          undo: [2, 1],
          versions: [11, 11],
          restored: 1,
        });
        console.log(
          JSON.stringify({
            device,
            base: sha(base),
            candidate: sha(candidate),
            from: 8,
            to: 9,
            backup: [3, 4],
            images: 1,
            storedTurns: 2,
            historyNodes: after.nodes.length,
            theaters: after.theaters.length,
            pendingStages: 3,
            committed,
            posts,
          }),
        );
      }
      await page.close();
      await server.close();
      server = undefined;
    }
    await context.close();
  }
  assert.equal(posts, 0);
} finally {
  await browser.close();
  if (server) await server.close();
}
