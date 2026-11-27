/* global crypto, AbortController, localStorage, sessionStorage, Response */
// Usage: node scripts/verify-chat-note-upgrade.mjs ACCEPTED_CHAT_OR_C3_CHECKOUT [COMBINED_CHECKOUT]
// Install the lockfile dependencies in both checkouts before running.
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const [oldPath, combinedPath = process.cwd()] = process.argv.slice(2);
if (!oldPath)
  throw Error('Supply the #259 or #258 accepted checkout');
const oldRoot = resolve(oldPath);
const head = root => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceVersion = {'8fcef954204b66218604e2f5e0f3bfd558fa2fb2':11, '6a7f8b8ba03eb95ba829e7b798e6692fa6f7e6df':12}[head(oldRoot)];
assert.ok(sourceVersion, 'Use a reviewed #259 or #258 checkout');
for (const required of [head(oldRoot), '49d67abf0be8047cf723fdfaf55418762d857cdc']) {
  execFileSync('git', ['merge-base', '--is-ancestor', required, 'HEAD'], { cwd: combinedPath });
}
const { chromium, devices } = await import(pathToFileURL(join(oldRoot, 'node_modules/playwright/index.mjs')));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const origin = 'http://127.0.0.1:14932';
let server;
async function serve(root) {
  await server?.close();
  const { createServer } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')));
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 14932, strictPort: true, hmr: false, watch: null } });
  await server.listen();
}
try {
  for (const device of ['desktop', 'mobile']) {
    await serve(oldRoot);
    const context = await browser.newContext(device === 'mobile' ? devices['Pixel 7'] : {});
    const external = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin && route.request().method() === 'GET')
        return route.continue();
      external.push([route.request().method(), route.request().url()]);
      return route.abort();
    });
    await context.route(origin + '/probe', route => route.fulfill({ contentType: 'text/html', body: '<title>组合升级检查</title>' }));
    const old = await context.newPage();
    await old.goto(origin + '/probe');
    const sample = await old.evaluate(async () => {
      const [{ SaveRepository, saveDatabaseVersion }, { worldState }, { completeDraft, submission }, codec] = await Promise.all([
        '/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/services/storage/backup.ts'
      ].map(path => import(path)));
      const repo = await SaveRepository.open();
      try {
        const state = worldState();
        state.npc['npc-a'].phoneContact = { status: 'known' };
        await repo.create(state);
        await repo.commitTurn(submission(await completeDraft(repo), ''));
        const live = await repo.loadGame(state.saveId);
        const chat = { id: crypto.randomUUID(), at: live.state.worldClock, baseTurnId: live.state.journal.at(-1).turnId,
          text: '  约在渡口交接。\n请带原件。  ', reply: { npcId: 'npc-a', status: 'replied', text: '我会准时到。' } };
        const waiting = await repo.appendPhoneExchange(live.state, live.draft, live.instance ?? null, chat, new AbortController().signal);
        const originalNote=saveDatabaseVersion===12 ? await repo.writeOracleNote(state.saveId,await repo.readOracleNote(state.saveId),'  V12 原纸条。　',true) : null;
        const unboundBackup = await codec.serializeBackup(await repo.exportBackup([state.saveId]), 'waiting-v11');
        const bound = await repo.bindTurnAction(waiting, '在窗边稍候一分钟', true, true, true, live.instance ?? null);
        return { originalNote, store: saveDatabaseVersion, stateVersion: live.state.schemaVersion, state: live.state, chat, waiting: waiting.phonePending,
          frozenBackup: await codec.serializeBackup(await repo.exportBackup([state.saveId]), 'frozen-v11'),
          frozen: bound.phoneFreeze, action: bound.userInput, unboundBackup, backupVersion: codec.backupVersion };
      }
      finally {
        repo.close();
      }
    });
    assert.deepEqual([sample.store, sample.stateVersion, sample.backupVersion], [sourceVersion, 11, 6]);
    assert.deepEqual(sample.waiting, [sample.chat]);
    assert.deepEqual(sample.frozen.ids, [sample.chat.id, sample.chat.id + ':reply']);
    assert.equal(JSON.parse(sample.unboundBackup).version, 6);
    assert.equal(JSON.parse(sample.frozenBackup).version, 6);
    await serve(resolve(combinedPath));
    const current = await context.newPage();
    await current.goto(origin + '/probe');
    const result = await current.evaluate(async (sample) => {
      const [{ SaveRepository, saveDatabaseVersion }, { elapsedVariables, submission }, codec, domain, settings] = await Promise.all([
        '/src/services/storage/saveRepository.ts', '/src/tests/fixtures/turn.ts', '/src/services/storage/backup.ts',
        '/src/domain/drafts.ts', '/src/ui/settings/model.ts'
      ].map(path => import(path)));
      const id = sample.state.saveId, repo = await SaveRepository.open();
      const copy = await SaveRepository.open('restored-v6');
      const waitingCopy = await SaveRepository.open('restored-waiting-v6');
      const oldFrozenCopy = await SaveRepository.open('restored-old-frozen-v6');
      try {
        const live = await repo.loadGame(id);
        const { game } = await import('/src/tests/fixtures/game.ts');
        const upgradedNote = await repo.readOracleNote(id);
        const foreignState = game('other-save');
        await repo.create(foreignState);
        const foreign = await repo.writeOracleNote(foreignState.saveId, await repo.readOracleNote(foreignState.saveId), '另一档纸条', false);
        let history = await repo.readOracleNote(id);
        for (const text of ['一', '二', '三', '四', '五', '六', '  三  '])
          history = await repo.writeOracleNote(id, history, text, false);
        const oldNote = '  纸条历史不随撤回丢失。　';
        const first = await repo.writeOracleNote(id, history, oldNote, false);
        const note = await repo.writeOracleNote(id, first, '　照原稿写。\n保留末行。  ', true);
        const file = await codec.serializeBackup(await repo.exportBackup([id]), 'frozen-v12');
        const importInto = async (target, text) => {
          const part = (await codec.parseBackup(text)).entries[0];
          if (!part.ok)
            throw Error(part.error);
          await target.importBackup(part, (await target.compareBackup(part)).confirmation);
          return target.loadGame(id);
        };
        const restored = await importInto(copy, file), restoredWaiting = await importInto(waitingCopy, sample.unboundBackup);
        const restoredV11 = await importInto(oldFrozenCopy, sample.frozenBackup);
        const lease = await repo.prepareWorldview(live.draft, false);
        const writing = { source: 'preset', id: 'meowssiah', version: 'previous', configuration: '0'.repeat(64) };
        const candidate = domain.rerollStory(live.draft, { turnKind: 'regular', narrative: '主角收好纸条。', summary: '收好纸条。', variableGuide: [] }, writing);
        let staleError;
        try {
          await repo.saveDraft(candidate, live.draft.draftRevision + 1, undefined, live.draft, lease, note.note.id);
        }
        catch (e) {
          staleError = e.code;
        }
        const afterFailure = { note: await repo.readOracleNote(id), draft: await repo.loadDraft(id) };
        const selected = await repo.saveDraft(candidate, live.draft.draftRevision, undefined, live.draft, lease, note.note.id);
        const afterCandidate = await repo.readOracleNote(id);
        const [{ TurnCoordinator }, { AiClient }, routes, { CredentialVault }, { variableReply }, { worldResult }] = await Promise.all([
          '/src/workflows/turnCoordinator.ts', '/src/services/ai/client.ts', '/src/services/ai/configuration.ts',
          '/src/services/ai/credentials.ts', '/src/tests/fixtures/variableReply.ts', '/src/tests/fixtures/world.ts'
        ].map(path => import(path)));
        const preferences = settings.defaultSettings();
        Object.assign(preferences.runtime, { useEntityStage: true, useVariableStage: true, useWorldStage: true,
          streamStory: false, streamEntities: false, streamVariables: false, streamWorld: false });
        const config = routes.defaultAiConfig(), channel = routes.newChannel();
        config.channels.push(channel);
        config.routes.story = { channelId: channel.id, modelId: 'story' };
        const answers = { entities: '<接触者>[]</接触者>' + variableReply({ commands: [] }),
          variables: variableReply(await elapsedVariables(repo, sample.action, 60)), world: JSON.stringify(worldResult()) };
        for (const stage of Object.keys(answers))
          config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
        const vault = new CredentialVault(sessionStorage, localStorage);
        vault.set(channel.id, 'synthetic-fixture');
        const calls = [];
        const runner = new TurnCoordinator(repo, new AiClient(async (_url, init) => {
          const model = JSON.parse(init.body).model;
          if (!Object.hasOwn(answers, model))
            throw Error('Unexpected synthetic request: ' + model);
          calls.push(model);
          return Response.json({ choices: [{ finish_reason: 'stop', message: { content: answers[model] } }] });
        }));
        let ready;
        try {
          ready = (await runner.generate({ draft: selected, settings: preferences, config, vault, expectedInstance: live.instance ?? null })).draft;
        }
        finally {
          runner.dispose();
        }
        const foreignAfter = await repo.readOracleNote(foreignState.saveId);
        const input = submission(ready, '');
        const done = await repo.commitTurn(input), replay = await repo.commitTurn(input);
        const undo = await repo.undoTurn({ saveId: id, expectedRevision: done.state.revision, expectedDraft: done.draft, operationId: 'combined-undo' });
        return { upgradedNote, versions: [saveDatabaseVersion, live.state.schemaVersion, JSON.parse(file).version],
          live, restored, restoredWaiting, restoredV11, staleError, afterFailure, selected, ready, calls, foreign, foreignAfter, current: note.note.text, noteBefore: note, history: note.history, afterCandidate,
          fileHasNote: file.includes('纸条历史不随撤回丢失') || file.includes('照原稿写'), copyNote: await copy.readOracleNote(id),
          settled: done.state.phone.threads['npc-a'].messages, wasReplay: replay.replayed,
          replayedMessages: replay.state.phone.threads['npc-a'].messages,
          undoPhone: undo.state.phone, undoWaiting: undo.draft.phonePending, undoNote: await repo.readOracleNote(id) };
      }
      finally {
        repo.close();
        copy.close();
        waitingCopy.close();
        oldFrozenCopy.close();
      }
    }, sample);
    assert.deepEqual(result.versions, [13, 11, 6]);
    if (sample.originalNote) assert.deepEqual(result.upgradedNote,sample.originalNote);
    assert.deepEqual(result.live.state, sample.state);
    for (const read of [result.live, result.restored, result.restoredV11]) {
      assert.deepEqual(read.draft.phonePending, [sample.chat]);
      assert.deepEqual(read.draft.phoneFreeze, sample.frozen);
      assert.equal(read.draft.userInput, sample.action);
    }
    assert.deepEqual(result.restoredWaiting.draft.phonePending, [sample.chat]);
    assert.equal(result.restoredWaiting.draft.phoneFreeze, undefined);
    assert.equal(result.staleError, 'DRAFT_CONFLICT');
    assert.deepEqual(result.afterFailure.draft, result.live.draft);
    assert.deepEqual(result.afterFailure.note, result.noteBefore);
    assert.deepEqual(result.foreign, result.foreignAfter);
    assert.deepEqual(result.calls, ['entities', 'variables', 'world']);
    assert.equal(result.selected.storyRevision, result.ready.storyRevision);
    assert.deepEqual(result.selected.story, result.ready.story);
    assert.deepEqual(result.ready.phoneFreeze, sample.frozen);
    assert.equal(result.current, '　照原稿写。\n保留末行。  ');
    assert.deepEqual(result.history, ['照原稿写。\n保留末行。', '纸条历史不随撤回丢失。', '三', '六', '五', '四']);
    assert.equal(result.afterCandidate.note, null);
    assert.deepEqual(result.afterCandidate.history, result.history);
    assert.equal(result.fileHasNote, false);
    assert.equal(result.copyNote.note, null);
    assert.deepEqual(result.copyNote.history, []);
    assert.deepEqual(result.settled.map(m => m.id), sample.frozen.ids);
    assert.deepEqual(result.settled.map(m => m.text), [sample.chat.text, sample.chat.reply.text]);
    assert.equal(result.wasReplay, true);
    assert.deepEqual(result.replayedMessages, result.settled);
    assert.deepEqual(result.undoPhone, sample.state.phone);
    assert.deepEqual(result.undoWaiting, [sample.chat]);
    assert.equal(result.undoNote.note, null);
    assert.deepEqual(result.undoNote.history, result.history);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ device, stageCalls: result.calls, historyEntries: result.history.length, replay: result.wasReplay, staleWriteRolledBack: true, externalRequests: external.length, step: 'combined upgrade', versions: result.versions, pending: 1, frozenIds: 2, backupRestored: true, undoRestored: true }));
    await context.close();
  }
}
finally {
  await server?.close();
  await browser.close();
}
