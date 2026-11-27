import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

async function start(page: Page) {
  const created = page.waitForEvent('worker', w => w.url().startsWith('blob:null/'));
  await page.evaluate(async () => {
    const { PrototypeSession } = await import('/src/presets/spreset/session.ts' as string);
    const signal = new AbortController().signal;
    const session = new PrototypeSession(signal);
    window.addEventListener('dispose-c2', () => session.dispose(), { once: true });
  });
  return await created;
}

test('实际处理器与父游戏的存档、草稿、凭证和网络隔离', async ({ page }, info) => {
  const hits: string[] = [];
  await page.route('**/c2-storage-probe', route => { hits.push(route.request().url()); return route.fulfill({ body: 'fixture' }); });
  await page.goto('/?spreset=prototype');
  const before = await page.evaluate(async () => {
    const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }] = await Promise.all(
      ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts'].map(p => import(p)));
    const repo = await SaveRepository.open();
    try {
      const { state } = talentPromptInput('story', 'regular');
      const draft = createTurnDraft(state.saveId, state.revision, 'private-test', 'regular', '另一个存档的行动', false, false);
      const data = { state, draft };
      await repo.importBackup(data, (await repo.compareBackup(data)).confirmation);
      localStorage.setItem('c2-test-only', 'local-fixture');
      sessionStorage.setItem('c2-test-only', 'session-fixture');
      return { saveId: state.saveId, draft: await repo.loadDraft(state.saveId), state: await repo.load(state.saveId) };
    } finally { repo.close(); }
  });
  const worker = await start(page);
  const evidence = await worker.evaluate(async url => {
    async function access(fn: () => unknown) {
      try { await fn(); return 'granted'; } catch (e) { return (e as Error).name; }
    }
    return {
      origin: self.origin, document: typeof document, parent: typeof parent,
      local: typeof localStorage, session: typeof sessionStorage,
      indexedDB: await access(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => { request.result.close(); resolve(true); };
        request.onerror = () => reject(request.error);
      })),
      databases: await access(() => indexedDB.databases()),
      cache: typeof caches === 'undefined' ? 'unavailable' : await access(() => caches.keys()),
      files: typeof navigator.storage?.getDirectory !== 'function' ? 'unavailable' : await access(() => navigator.storage.getDirectory()),
      network: await access(() => fetch(url, { method: 'POST', body: 'fixture' })),
    };
  }, new URL('/c2-storage-probe', page.url()).href);
  expect(evidence).toMatchObject({ origin: 'null', document: 'undefined', parent: 'undefined', local: 'undefined', session: 'undefined',
    indexedDB: 'SecurityError', databases: 'SecurityError', network: 'TypeError' });
  for (const key of ['cache', 'files'] as const) expect(['SecurityError', 'unavailable']).toContain(evidence[key]);
  expect(hits).toEqual([]);
  const frame = page.frames().find(f => f.url().includes('/experiments/spreset/sandbox.html'))!;
  expect(await frame.evaluate(() => {
    const denied = (read: () => unknown) => { try { read(); return false; } catch (e) { return (e as Error).name === 'SecurityError'; } };
    return [denied(() => parent.document), denied(() => localStorage.getItem('c2-test-only')),
      denied(() => sessionStorage.getItem('c2-test-only')), denied(() => document.cookie)];
  })).toEqual([true, true, true, true]);
  const closed = worker.waitForEvent('close');
  await page.evaluate(() => window.dispatchEvent(new Event('dispose-c2')));
  await closed;
  expect(frame.isDetached()).toBe(true);
  const after = await page.evaluate(async saveId => {
    const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
    const repo = await SaveRepository.open();
    try { return { saveId, draft: await repo.loadDraft(saveId), state: await repo.load(saveId) }; }
    finally { repo.close(); }
  }, before.saveId);
  expect(after).toEqual(before);
  await info.attach('opaque-worker', { body: JSON.stringify({ ...evidence, networkRequests: hits.length, saveAndDraftUnchanged: true }), contentType: 'application/json' });
});

test('端口只绑定一次，拒绝跨会话、越序及未授权操作', async ({ page }) => {
  await page.goto('/?spreset=prototype');
  const cases = await page.evaluate(async () => {
    const result = [];
    for (const invalid of ['wrong-session', 'repeat', 'extra-operation']) {
      const session = crypto.randomUUID();
      const frame = document.createElement('iframe');
      frame.sandbox.add('allow-scripts');
      frame.src = '/experiments/spreset/sandbox.html#' + session;
      const loaded = new Promise<void>(resolve => frame.onload = () => resolve());
      document.body.append(frame);
      await loaded;
      const port = new MessageChannel(), foreign = new MessageChannel();
      const parent = frame.contentWindow!;
      let foreignReplies = 0;
      foreign.port1.onmessage = () => foreignReplies++;
      // A bad initial bind must leave the legitimate host able to initialize.
      parent.postMessage({ bind: 'other-session' }, '*', [foreign.port2]);
      parent.postMessage({ bind: session }, '*', [port.port2]);
      const message = (channel: MessagePort, body: unknown) => new Promise<Record<string, unknown>>(resolve => {
        channel.onmessage = e => resolve(e.data);
        channel.postMessage(body);
      });
      try {
        const prepared = await message(port.port1, { session, sequence: 1, operation: 'prepare',
          input: { messages: [{ role: 'user', content: '合成任务' }], stream: false } });
        const rejected = await message(port.port1, { session: invalid === 'wrong-session' ? 'other-session' : session,
          sequence: invalid === 'repeat' ? 1 : 2, operation: invalid === 'extra-operation' ? 'storage' : 'finish',
          input: { text: '不能签发收据' } });
        result.push({ prepared: Object.hasOwn(prepared, 'result'), rejected: rejected.error,
          gaveResult: Object.hasOwn(rejected, 'result'), foreignReplies });
      } finally { port.port1.close(); foreign.port1.close(); frame.remove(); }
    }
    return result;
  });
  expect(cases).toEqual(Array(3).fill({ prepared: true, rejected: true, gaveResult: false, foreignReplies: 0 }));
});

test('在途请求超时和页面刷新销毁原处理器', async ({ page }) => {
  await page.goto('/?spreset=prototype');
  await page.clock.install();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  await page.route('https://spreset.mock.invalid/**', async route => { posts++; await hold; await route.abort(); });
  const outgoing = page.waitForRequest(req => new URL(req.url()).hostname === 'spreset.mock.invalid');
  const created = page.waitForEvent('worker', worker => worker.url().startsWith('blob:null/'));
  const response = page.evaluate(async () => {
    const [{ AiClient }, { newChannel }, { CredentialVault }, { channelSnapshot }] = await Promise.all(
      ['/src/services/ai/client.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/services/ai/snapshot.ts'].map(p => import(p)));
    const channel = newChannel('openai');
    channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'synthetic';
    const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fixture-only');
    const snapshot = channelSnapshot(channel, vault, channel.defaultModel, 'story');
    try { await new AiClient().generate(snapshot, [{ role: 'user', content: '合成' }], { spresetPrototype: true, timeoutSeconds: 15 }); }
    catch (error) { return (error as {code?: string}).code; }
  });
  const closed = (await created).waitForEvent('close');
  try {
    await outgoing; await page.clock.fastForward(16000);
    expect(await response).toBe('timeout'); await closed;
  } finally { release(); }
  expect(posts).toBe(1);
  await expect(page.locator('iframe[title="SPreset 实验处理器"]')).toHaveCount(0);
  const newWorker = await start(page);
  const reloaded = newWorker.waitForEvent('close');
  await page.reload(); await reloaded;
  await expect(page.locator('iframe[title="SPreset 实验处理器"]')).toHaveCount(0);
});
