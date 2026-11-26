import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { contentHash } from '../domain/worldbook/canonical';
import type { WorldbookEntry, WorldbookRelease } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { runWorldbookTrigger } from '../domain/worldbook/trigger';
import { clampTimeout, MAIN_THREAD_FALLBACK_LIMITS, TRIGGER_RESOURCE_LIMITS, type BookRef, type WorkerTriggerRequest } from '../domain/worldbook/triggerRequest';
import { WorldbookLibrary } from '../services/storage/worldbookLibrary';
import { libraryFallback } from '../services/worldbook/libraryFallback';
import { LibraryReader, type ReadResult } from '../services/worldbook/libraryReader';
import { TriggerExecutor } from '../services/worldbook/triggerExecutor';
import { WorldbookTriggerHost, type MainThreadFallback, type WorkerPort } from '../services/worldbook/triggerHost';
import { benchEntry } from './support/worldbookScanBench';

async function makeRelease(bookId: string, versionId: string, entries: WorldbookEntry[]): Promise<WorldbookRelease> {
  const base = { formatVersion: 1 as const, bookId, versionId, versionLabel: versionId, origin: 'local' as const, metadata: { title: bookId },
    entries, source: { format: 'heijin' as const, payload: null }, compatibility: [] };
  return { ...base, contentHash: await contentHash(base) };
}
const ref = (r: WorldbookRelease): BookRef => ({ bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash });
function memoryLoader(releases: WorldbookRelease[]) {
  const calls: string[] = [];
  const loader = async (r: BookRef): Promise<ReadResult> => {
    calls.push(`${r.bookId}/${r.versionId}`);
    return { ok: true, release: structuredClone(releases.find((x) => x.bookId === r.bookId && x.versionId === r.versionId) ?? null) };
  };
  return { loader, calls };
}
function request(books: WorldbookRelease[], extra: Partial<WorkerTriggerRequest> = {}): WorkerTriggerRequest {
  return { books: books.map(ref), messages: ['码头 茶楼'], contextTokens: 100_000, storyRemainingTokens: 50_000, trigger: 'normal',
    messageCount: 1, timedState: EMPTY_TIMED_STATE, seed: 'seed-1', ...extra };
}
/** 进程内 Worker 替身：消息经过结构化克隆，与真实 Worker 边界相同；可模拟不回复、启动失败。 */
class InProcessWorker implements WorkerPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  posted = 0;
  constructor(private readonly executor: TriggerExecutor, private readonly mode: 'normal' | 'silent' | 'broken' = 'normal') {}
  postMessage(message: unknown) {
    this.posted++;
    const data = structuredClone(message) as { id: number; request: unknown };
    if (this.mode === 'broken') { queueMicrotask(() => this.onerror?.(new Event('error'))); return; }
    if (this.mode === 'silent') return;
    void this.executor.execute(data.request).then((reply) => {
      if (!this.terminated) this.onmessage?.({ data: structuredClone({ id: data.id, reply }) } as MessageEvent);
    });
  }
  terminate() { this.terminated = true; }
}

const entries = (prefix: string, n: number, extra: Partial<WorldbookEntry> = {}) =>
  Array.from({ length: n }, (_, i) => benchEntry({ entryId: `${prefix}${i}`, keys: [i % 2 ? '码头' : '茶楼'], content: `${prefix}内容${i}`, group: i % 3 ? '' : `组${i % 4}`, probability: 70, ...extra }));

describe('触发 Worker：协议、资源上限、确定性', () => {
  it('经 Worker 运行的结果与直接调用引擎完全相同（含分组、概率、计时状态）', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 40, { sticky: 2 })), b = await makeRelease('b', 'v1', entries('b', 30));
    const { loader } = memoryLoader([a, b]);
    const host = new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader)) });
    for (const extra of [{}, { seed: 'seed-2' }, { messageCount: 7, timedState: { sticky: { 'a#a0': { fingerprint: 'x', start: 1, end: 9, protected: false } }, cooldown: {} } }]) {
      const req = request([a, b], extra);
      const outcome = await host.run(req);
      const direct = runWorldbookTrigger({ ...req, books: [a, b].map((r) => ({ bookId: r.bookId, versionId: r.versionId, entries: r.entries })), settings: {} });
      expect(outcome).toMatchObject({ status: 'ok', via: 'worker' });
      expect(JSON.stringify((outcome as { result: unknown }).result)).toBe(JSON.stringify(direct));
    }
  });

  it('资源上限：工作量封顶、书数 / 消息量超限暂停、重复书无效、超时限定范围', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    const host = new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader)) });
    const capped = await host.run(request([a], { settings: { maxScanWork: 1e13 } }));
    expect((capped as { result: { work: { limit: number } } }).result.work.limit).toBe(TRIGGER_RESOURCE_LIMITS.maxScanWorkCeiling);
    const many = Array.from({ length: TRIGGER_RESOURCE_LIMITS.maxBooks + 1 }, (_, i) => ({ ...ref(a), bookId: `b${i}` }));
    expect(await host.run({ ...request([a]), books: many })).toMatchObject({ status: 'paused', reason: 'too_large' });
    expect(await host.run(request([a], { messages: ['字'.repeat(TRIGGER_RESOURCE_LIMITS.maxMessageChars + 1)] }))).toMatchObject({ status: 'paused', reason: 'too_large' });
    expect(await host.run({ ...request([a]), books: [ref(a), ref(a)] })).toMatchObject({ status: 'failed', reason: 'invalid_request' });
    expect(await host.run({ ...request([a]), estimateTokens: () => 1 } as unknown as WorkerTriggerRequest)).toMatchObject({ status: 'failed', reason: 'invalid_request' });
    expect([clampTimeout(1), clampTimeout(undefined), clampTimeout(1e9)]).toEqual([200, 5_000, 30_000]);
  });

  it('超时：终止 Worker 并立即返回；下一次请求重建 Worker 并正常完成', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    const created: InProcessWorker[] = [];
    let mode: 'silent' | 'normal' = 'silent';
    const host = new WorldbookTriggerHost({ createWorker: () => { const w = new InProcessWorker(new TriggerExecutor(loader), mode); created.push(w); return w; } });
    const started = Date.now();
    expect(await host.run(request([a]), { timeoutMs: 200 })).toEqual({ status: 'timeout', timeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(created[0].terminated).toBe(true);
    mode = 'normal';
    expect(await host.run(request([a]))).toMatchObject({ status: 'ok' });
    expect(created).toHaveLength(2);
  });

  it('取消：终止 Worker；已取消的信号不会发送请求；排队的请求在前一个超时后照常完成', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    const created: InProcessWorker[] = [];
    // 按创建顺序：第 1 个不回复（被取消），第 2 个不回复（超时），第 3 个正常
    const modes: Array<'silent' | 'normal'> = ['silent', 'silent', 'normal'];
    const host = new WorldbookTriggerHost({ createWorker: () => { const w = new InProcessWorker(new TriggerExecutor(loader), modes.shift() ?? 'normal'); created.push(w); return w; } });
    const controller = new AbortController();
    const pending = host.run(request([a]), { signal: controller.signal, timeoutMs: 30_000 });
    setTimeout(() => controller.abort(), 20);
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(created[0].terminated).toBe(true);
    const aborted = new AbortController(); aborted.abort();
    expect(await host.run(request([a]), { signal: aborted.signal })).toEqual({ status: 'cancelled' });
    expect(created).toHaveLength(1);
    // 排队：第一个超时，第二个由新 Worker 完成
    const first = host.run(request([a]), { timeoutMs: 200 });
    const second = host.run(request([a]));
    expect(await first).toMatchObject({ status: 'timeout' });
    expect(await second).toMatchObject({ status: 'ok', via: 'worker' });
    expect(created).toHaveLength(3);
    expect(created[1].terminated).toBe(true);
  });

  it('Worker 启动即出错：此后视为不可用；没有降级数据源时暂停，不在主线程运行', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    let created = 0;
    const host = new WorldbookTriggerHost({ createWorker: () => { created++; return new InProcessWorker(new TriggerExecutor(loader), 'broken'); } });
    // 第一次请求就改走降级路径；没有降级数据源 → 暂停（此前是返回 worker_error）。
    expect(await host.run(request([a]))).toEqual({ status: 'paused', reason: 'worker_unavailable' });
    expect(host.degraded).toBe(true);
    expect(await host.run(request([a]))).toEqual({ status: 'paused', reason: 'worker_unavailable' });
    expect(created).toBe(1);
  });

  it('Worker 启动即出错且有降级数据源：同一次请求立即在主线程完成，结果与 Worker 一致', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    const fallback: MainThreadFallback = { async size() { return { entryCount: 5, keyChars: 10, contentChars: 10 }; }, load: loader };
    const host = new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader), 'broken'), fallback });
    const viaFallback = await host.run(request([a]));
    expect(viaFallback).toMatchObject({ status: 'ok', via: 'main-thread' });
    const reference = await new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader)) }).run(request([a]));
    // 主线程降级用更低的工作量上限（work.limit 不同），触发结果本身一致。
    const pick = (o: typeof viaFallback) => (o.status === 'ok' ? { activated: o.result.activated, plan: o.result.plan, decisions: o.result.decisions, budget: o.result.budget } : null);
    expect(pick(viaFallback)).toEqual(pick(reference));
    expect(pick(viaFallback)).not.toBeNull();
  });

  it('无法创建 Worker：小规模在主线程运行（工作量再降级）；超过降级上限则暂停', async () => {
    const small = await makeRelease('s', 'v1', entries('s', 20));
    const big = await makeRelease('g', 'v1', entries('g', MAIN_THREAD_FALLBACK_LIMITS.maxTotalEntries + 1));
    const { loader } = memoryLoader([small, big]);
    const fallback: MainThreadFallback = {
      async size(r) { const x = [small, big].find((y) => y.bookId === r.bookId); return x ? { entryCount: x.entries.length, keyChars: 10, contentChars: 10 } : null; },
      load: loader,
    };
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback });
    const ok = await host.run(request([small], { settings: { maxScanWork: 1e9 } }));
    expect(ok).toMatchObject({ status: 'ok', via: 'main-thread' });
    expect((ok as { result: { work: { limit: number } } }).result.work.limit).toBe(MAIN_THREAD_FALLBACK_LIMITS.maxScanWork);
    expect(await host.run(request([big]))).toMatchObject({ status: 'paused', reason: 'fallback_too_large' });
    expect(await host.run(request([small], { messages: ['字'.repeat(MAIN_THREAD_FALLBACK_LIMITS.maxMessageChars + 1)] }))).toMatchObject({ status: 'paused', reason: 'fallback_too_large' });
    const none = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); } });
    expect(await none.run(request([small]))).toEqual({ status: 'paused', reason: 'worker_unavailable' });
  });
});

describe('触发执行器：缓存隔离与哈希校验', () => {
  it('同一书 ID 的不同版本分别缓存；结果使用请求的那个版本', async () => {
    const v1 = await makeRelease('a', 'v1', [benchEntry({ entryId: 'x', keys: ['码头'], content: '第一版' })]);
    const v2 = await makeRelease('a', 'v2', [benchEntry({ entryId: 'x', keys: ['码头'], content: '第二版' })]);
    const { loader, calls } = memoryLoader([v1, v2]);
    const executor = new TriggerExecutor(loader);
    const r1 = await executor.execute(request([v1])), r2 = await executor.execute(request([v2])), r1b = await executor.execute(request([v1]));
    expect((r1 as { result: { activated: Array<{ content: string }> } }).result.activated[0].content).toBe('第一版');
    expect((r2 as { result: { activated: Array<{ content: string }> } }).result.activated[0].content).toBe('第二版');
    expect(JSON.stringify(r1b)).toBe(JSON.stringify(r1));
    expect(calls).toEqual(['a/v1', 'a/v2']); // 第二次 v1 命中缓存
    expect(executor.cachedKeys()).toHaveLength(2);
  });

  it('内容与哈希不符、或库中版本的哈希与请求不同：暂停，不进入缓存，不改用其他版本', async () => {
    const good = await makeRelease('a', 'v1', entries('a', 3));
    const tampered = { ...good, entries: good.entries.map((e, i) => i ? e : { ...e, content: '被改过' }) };
    const executor = new TriggerExecutor(memoryLoader([tampered]).loader);
    expect(await executor.execute(request([good]))).toMatchObject({ status: 'paused', reason: 'hash_mismatch', book: ref(good) });
    expect(executor.cachedKeys()).toEqual([]);
    const other = await makeRelease('a', 'v1', entries('b', 3));
    const executor2 = new TriggerExecutor(memoryLoader([other]).loader);
    expect(await executor2.execute(request([good]))).toMatchObject({ status: 'paused', reason: 'hash_mismatch' });
    expect(await new TriggerExecutor(memoryLoader([]).loader).execute(request([good]))).toMatchObject({ status: 'paused', reason: 'missing_version' });
  });

  it('缓存按条目总数设上限，淘汰最久未用的版本；被淘汰后再次使用会重新载入并复核', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 10)), b = await makeRelease('b', 'v1', entries('b', 10)), c = await makeRelease('c', 'v1', entries('c', 10));
    const { loader, calls } = memoryLoader([a, b, c]);
    const executor = new TriggerExecutor(loader, 20);
    await executor.execute(request([a])); await executor.execute(request([b])); await executor.execute(request([a])); await executor.execute(request([c]));
    expect(executor.cachedKeys().map((k) => k.split('\u0000')[0])).toEqual(['a', 'c']);
    await executor.execute(request([b]));
    expect(calls).toEqual(['a/v1', 'b/v1', 'c/v1', 'b/v1']);
  });

  it('请求之间没有共享的可变状态：先跑别的请求，不影响下一个请求的结果', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 30, { sticky: 3 })), b = await makeRelease('b', 'v1', entries('b', 30));
    const shared = new TriggerExecutor(memoryLoader([a, b]).loader);
    await shared.execute(request([a, b], { seed: 'other', messageCount: 9 }));
    const after = await shared.execute(request([a]));
    const fresh = await new TriggerExecutor(memoryLoader([a, b]).loader).execute(request([a]));
    expect(JSON.stringify(after)).toBe(JSON.stringify(fresh));
  });
});

describe('书库只读读取器：附属库版本兼容', () => {
  let n = 0;
  const name = (label: string) => `wb-reader-${label}-${Date.now()}-${n++}`;
  const rawOpen = (factory: IDBFactory, db: string, version: number, upgrade: (d: IDBDatabase) => void) => new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(db, version); r.onupgradeneeded = () => upgrade(r.result); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });

  it('书库不存在：返回 missing_library，且不会创建空数据库', async () => {
    const factory = new IDBFactory(), db = name('missing');
    expect(await new LibraryReader({ name: db, factory }).read('a', 'v1')).toEqual({ ok: false, reason: 'missing_library' });
    expect((await factory.databases()).map((d: IDBDatabaseInfo) => d.name)).not.toContain(db);
    // 之后主线程照常建库（当前版本）
    const opened = await WorldbookLibrary.open({ name: db, factory });
    expect(opened.ok).toBe(true);
    if (opened.ok) opened.library.close();
  });

  it('旧版与当前版本可读取，未来版本返回 unsupported_version', async () => {
    const factory = new IDBFactory(), r = await makeRelease('a', 'v1', entries('a', 3));
    const v1 = name('v1');
    const d1 = await rawOpen(factory, v1, 1, (d) => { d.createObjectStore('releases', { keyPath: ['bookId', 'versionId'] }); d.createObjectStore('books', { keyPath: 'bookId' }); });
    await new Promise<void>((resolve) => { const tx = d1.transaction('releases', 'readwrite'); tx.objectStore('releases').put({ release: r, bookId: 'a', versionId: 'v1', contentHash: r.contentHash, installedAt: 1 }); tx.oncomplete = () => resolve(); });
    d1.close();
    expect(await new LibraryReader({ name: v1, factory }).read('a', 'v1')).toEqual({ ok: true, release: r });
    const v2 = name('v2'); // 由当前代码建库（第 4 版）
    const lib = await WorldbookLibrary.open({ name: v2, factory });
    if (!lib.ok) throw new Error('open');
    await lib.library.install(r); lib.library.close();
    const reader2 = new LibraryReader({ name: v2, factory });
    expect(await reader2.read('a', 'v1')).toEqual({ ok: true, release: r });
    expect(await reader2.read('a', 'missing')).toEqual({ ok: true, release: null });
    reader2.close();
    const future = name('future');
    (await rawOpen(factory, future, 5, (d) => { d.createObjectStore('releases', { keyPath: ['bookId', 'versionId'] }); })).close();
    expect(await new LibraryReader({ name: future, factory }).read('a', 'v1')).toEqual({ ok: false, reason: 'unsupported_version' });
  });

  it('读取器持有连接时，主线程升级书库不被阻塞；读取器重新打开后按新版本判断', async () => {
    const factory = new IDBFactory(), db = name('upgrade');
    const lib = await WorldbookLibrary.open({ name: db, factory });
    if (!lib.ok) throw new Error('open');
    lib.library.close();
    const reader = new LibraryReader({ name: db, factory });
    expect(await reader.read('a', 'v1')).toEqual({ ok: true, release: null });
    const upgraded = await rawOpen(factory, db, 5, () => { /* 模拟未来版本 */ });
    upgraded.close();
    expect(await reader.read('a', 'v1')).toEqual({ ok: false, reason: 'unsupported_version' });
  });

  it('主线程降级数据源：规模判断只读摘要，哈希与请求不符视为缺失', async () => {
    const factory = new IDBFactory(), r = await makeRelease('a', 'v1', entries('a', 4));
    const lib = await WorldbookLibrary.open({ name: name('fallback'), factory });
    if (!lib.ok) throw new Error('open');
    await lib.library.install(r);
    const fallback = libraryFallback(lib.library);
    expect(await fallback.size(ref(r))).toMatchObject({ entryCount: 4 });
    expect(await fallback.size({ ...ref(r), contentHash: '0'.repeat(64) })).toBeNull();
    expect(await fallback.load(ref(r))).toEqual({ ok: true, release: r });
    lib.library.close();
  });
});

describe('收尾返修：排队任务的超时与取消', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('排在长任务后面的请求：等待时间计入它自己的超时，到点就返回 timeout，不等前一个结束', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    const host = new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader), 'silent') });
    const first = host.run(request([a]), { timeoutMs: 3_000 });
    const started = Date.now();
    const second = await host.run(request([a]), { timeoutMs: 300 });
    expect(second).toMatchObject({ status: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await first).toMatchObject({ status: 'timeout' });
  });

  it('排队中的请求被取消：立即返回 cancelled；前一个请求不受影响，之后的正常请求照常得到结果', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    let mode: 'silent' | 'normal' = 'silent';
    const host = new WorldbookTriggerHost({ createWorker: () => new InProcessWorker(new TriggerExecutor(loader), mode) });
    const first = host.run(request([a]), { timeoutMs: 600 });
    const controller = new AbortController();
    const queued = host.run(request([a]), { signal: controller.signal, timeoutMs: 5_000 });
    await sleep(30);
    const started = Date.now();
    controller.abort();
    expect(await queued).toEqual({ status: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(200);
    expect(await first).toMatchObject({ status: 'timeout' }); // 前一个照常按自己的预算结束
    mode = 'normal';
    const next = await host.run(request([a]), { timeoutMs: 2_000 });
    expect(next).toMatchObject({ status: 'ok', via: 'worker' });
  });

  it('截止时间（deadline）优先于 timeoutMs；已经过期的请求不启动 Worker', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    let created = 0;
    const host = new WorldbookTriggerHost({ createWorker: () => { created++; return new InProcessWorker(new TriggerExecutor(loader)); } });
    expect(await host.run(request([a]), { deadline: Date.now() - 1, timeoutMs: 5_000 })).toMatchObject({ status: 'timeout' });
    expect(created).toBe(0);
    expect(await host.run(request([a]), { deadline: Date.now() + 2_000 })).toMatchObject({ status: 'ok' });
  });

  it('主线程降级路径也受截止时间约束：读取卡住时到点返回 timeout，迟到的结果被丢弃', async () => {
    const a = await makeRelease('a', 'v1', entries('a', 5));
    const { loader } = memoryLoader([a]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fallback: MainThreadFallback = {
      async size() { await gate; return { entryCount: 5, keyChars: 10, contentChars: 10 }; },
      load: loader,
    };
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback });
    const started = Date.now();
    expect(await host.run(request([a]), { timeoutMs: 250 })).toMatchObject({ status: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
    release();
    // 降级的下一次请求不受前一次迟到结果影响。
    expect(await host.run(request([a]), { timeoutMs: 2_000 })).toMatchObject({ status: 'ok', via: 'main-thread' });
  });
});
