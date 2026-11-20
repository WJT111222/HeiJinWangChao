import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { importWorldbookValue } from '../domain/worldbook/importWorldbook';
import type { WorldbookRelease } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { MAX_ENABLED_BOOKS, WorldbookLibrary, type LibraryFailure } from '../services/storage/worldbookLibrary';
import { LibraryReader } from '../services/worldbook/libraryReader';
import { libraryFallback } from '../services/worldbook/libraryFallback';
import { prepareStoryWorldbook, type StoryWorldbookInput } from '../services/worldbook/storyWorldbook';
import { WorldbookTriggerHost, type TriggerOutcome } from '../services/worldbook/triggerHost';
import { sillyTavernDictBook } from './fixtures/worldbooks';

let counter = 0;
const uniqueName = (label: string) => `wb-shelf-${label}-${Date.now()}-${counter++}`;
async function release(title: string): Promise<WorldbookRelease> {
  const result = await importWorldbookValue(sillyTavernDictBook(), { title });
  if (!result.ok) throw new Error('fixture import failed');
  return result.release;
}
async function open(name: string, factory: IDBFactory = new IDBFactory()) {
  const opened = await WorldbookLibrary.open({ name, factory });
  if (!opened.ok) throw new Error(`open failed: ${opened.code}`);
  return opened.library;
}
async function installed(library: WorldbookLibrary, title: string) {
  const r = await release(title);
  const result = await library.install(r);
  if (!result.ok) throw new Error(`install failed: ${result.code}`);
  return r;
}
const failed = (value: unknown): LibraryFailure => {
  expect((value as { ok: boolean }).ok).toBe(false);
  return value as LibraryFailure;
};
const input: StoryWorldbookInput = { messages: ['李四走进茶楼'], contextTokens: 32_000, storyRemainingTokens: 8_000, messageCount: 3, seed: 's1' };

describe('简化版世界书：全局启用与删除', () => {
  it('结构第 3 版：新增 enabled 表；从第 2 版升级保留已有数据', async () => {
    const factory = new IDBFactory(), name = uniqueName('upgrade');
    // 手工建一个第 2 版的库（三张表），模拟此前的测试数据。
    await new Promise<void>((resolve, reject) => {
      const r = factory.open(name, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        const releases = db.createObjectStore('releases', { keyPath: ['bookId', 'versionId'] });
        releases.createIndex('contentHash', 'contentHash'); releases.createIndex('bookId', 'bookId');
        db.createObjectStore('books', { keyPath: 'bookId' });
        db.createObjectStore('summaries', { keyPath: ['bookId', 'versionId'] }).createIndex('bookId', 'bookId');
      };
      r.onsuccess = () => { r.result.close(); resolve(); };
      r.onerror = () => reject(r.error);
    });
    const library = await open(name, factory);
    const r = await installed(library, '升级后');
    expect(await library.setEnabled(r.bookId, true)).toEqual({ ok: true, enabled: true });
    library.close();
    const db = await new Promise<IDBDatabase>((resolve) => { const o = factory.open(name); o.onsuccess = () => resolve(o.result); });
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort()).toEqual(['books', 'enabled', 'releases', 'summaries']);
    db.close();
    // 触发 Worker 的只读读取器接受第 3 版。
    const reader = new LibraryReader({ name, factory });
    expect(await reader.read(r.bookId, r.versionId)).toEqual({ ok: true, release: r });
    reader.close();
  });

  it('打开 / 关闭是幂等的；不存在的书不能启用；关闭不存在的书不报错', async () => {
    const library = await open(uniqueName('toggle'));
    const r = await installed(library, '码头志');
    expect(failed(await library.setEnabled('book-missing', true)).code).toBe('not_found');
    expect(await library.setEnabled(r.bookId, true)).toEqual({ ok: true, enabled: true });
    expect(await library.setEnabled(r.bookId, true)).toEqual({ ok: true, enabled: true });
    expect((await library.enabledBooks())).toEqual({ ok: true, books: [{ ref: { bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash }, title: '码头志' }] });
    expect(await library.setEnabled(r.bookId, false)).toEqual({ ok: true, enabled: false });
    expect(await library.setEnabled(r.bookId, false)).toEqual({ ok: true, enabled: false });
    expect(await library.setEnabled('book-missing', false)).toEqual({ ok: true, enabled: false });
    expect(await library.enabledBooks()).toEqual({ ok: true, books: [] });
    library.close();
  });

  it(`同时启用最多 ${MAX_ENABLED_BOOKS} 本；超出时拒绝且已启用的不变`, async () => {
    const library = await open(uniqueName('cap'));
    const ids: string[] = [];
    for (let i = 0; i <= MAX_ENABLED_BOOKS; i++) ids.push((await installed(library, `书${i}`)).bookId);
    for (let i = 0; i < MAX_ENABLED_BOOKS; i++) expect((await library.setEnabled(ids[i], true, { now: () => i })).ok).toBe(true);
    expect(failed(await library.setEnabled(ids[MAX_ENABLED_BOOKS], true)).code).toBe('too_many_enabled');
    const enabled = await library.enabledBooks();
    expect(enabled.ok && enabled.books.map((b) => b.ref.bookId)).toEqual(ids.slice(0, MAX_ENABLED_BOOKS));
    // 关掉一本后就能再开。
    expect((await library.setEnabled(ids[0], false)).ok).toBe(true);
    expect((await library.setEnabled(ids[MAX_ENABLED_BOOKS], true)).ok).toBe(true);
    library.close();
  });

  it('书架：每本书带最近版本摘要与启用状态，按最近更新排序', async () => {
    const library = await open(uniqueName('shelf'));
    const a = await release('甲'), b = await release('乙');
    await library.install(a, { now: () => 10 });
    await library.install(b, { now: () => 20 });
    await library.setEnabled(a.bookId, true);
    const shelf = await library.shelf();
    expect(shelf.ok).toBe(true);
    if (!shelf.ok) return;
    expect(shelf.books.map((s) => [s.book.title, s.enabled, s.latest?.entryCount])).toEqual([['乙', false, b.entries.length], ['甲', true, a.entries.length]]);
    library.close();
  });

  it('删除一本书：版本、摘要、书目、启用状态在同一事务里全部删除，其他书不受影响', async () => {
    const library = await open(uniqueName('delete'));
    const a = await installed(library, '甲'), b = await installed(library, '乙');
    await library.setEnabled(a.bookId, true);
    await library.setEnabled(b.bookId, true);
    expect(await library.deleteBook(a.bookId)).toEqual({ ok: true });
    expect(await library.getRelease(a.bookId, a.versionId)).toEqual({ ok: true, release: null });
    expect(await library.getSummary(a.bookId, a.versionId)).toEqual({ ok: true, summary: null });
    expect(await library.listVersions(a.bookId)).toEqual({ ok: true, versions: [] });
    const enabled = await library.enabledBooks();
    expect(enabled.ok && enabled.books.map((x) => x.ref.bookId)).toEqual([b.bookId]);
    const shelf = await library.shelf();
    expect(shelf.ok && shelf.books.map((x) => x.book.bookId)).toEqual([b.bookId]);
    expect(failed(await library.deleteBook(a.bookId)).code).toBe('not_found');
    expect(failed(await library.setEnabled(a.bookId, true)).code).toBe('not_found');
    // 删除后同一文件可以重新导入（不再被判为重复内容）。
    expect(await library.install(a)).toMatchObject({ ok: true, status: 'installed' });
    library.close();
  });

  it('删除中途失败：整个事务回滚，书仍完整可用', async () => {
    const library = await open(uniqueName('delete-fail'));
    const a = await installed(library, '甲');
    await library.setEnabled(a.bookId, true);
    const spy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (this: IDBObjectStore) { throw new DOMException('boom', 'UnknownError'); });
    expect(failed(await library.deleteBook(a.bookId)).code).toBe('failed');
    spy.mockRestore();
    expect(await library.getRelease(a.bookId, a.versionId)).toEqual({ ok: true, release: a });
    const enabled = await library.enabledBooks();
    expect(enabled.ok && enabled.books.length).toBe(1);
    library.close();
  });
});

describe('简化版世界书：正文入口 prepareStoryWorldbook', () => {
  const fakeOpen = (library: WorldbookLibrary) => () => Promise.resolve({ ok: true as const, library });

  it('没有启用任何书：off，不调用触发宿主', async () => {
    const library = await open(uniqueName('off'));
    await installed(library, '甲');
    const run = vi.fn();
    expect(await prepareStoryWorldbook(input, {}, { openLibrary: fakeOpen(library), host: { run } })).toEqual({ status: 'off' });
    expect(run).not.toHaveBeenCalled();
  });

  it('请求只带书的引用、空计时状态、默认 normal 触发', async () => {
    const library = await open(uniqueName('request'));
    const a = await installed(library, '甲');
    await library.setEnabled(a.bookId, true);
    const run = vi.fn(async (): Promise<TriggerOutcome> => ({ status: 'paused', reason: 'missing_version', book: { bookId: a.bookId, versionId: a.versionId, contentHash: a.contentHash } }));
    const outcome = await prepareStoryWorldbook(input, { timeoutMs: 1234 }, { openLibrary: fakeOpen(library), host: { run } });
    expect(run).toHaveBeenCalledWith({
      books: [{ bookId: a.bookId, versionId: a.versionId, contentHash: a.contentHash }], messages: ['李四走进茶楼'],
      contextTokens: 32_000, storyRemainingTokens: 8_000, trigger: 'normal', messageCount: 3, timedState: EMPTY_TIMED_STATE, seed: 's1', settings: undefined,
    }, { timeoutMs: 1234 });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'missing_version', book: { bookId: a.bookId } });
    expect((outcome as { message: string }).message).toContain('本次未使用玩家世界书');
  });

  it('任何失败都变成 skipped 并带可展示的说明，从不抛出', async () => {
    const factory = new IDBFactory(), name = uniqueName('fail');
    const library = await open(name, factory);
    const a = await installed(library, '甲');
    await library.setEnabled(a.bookId, true);
    library.close();
    // 入口每次调用都会关闭自己打开的书库，所以每次都重新打开。
    const reopen = () => WorldbookLibrary.open({ name, factory });
    const cases: Array<[TriggerOutcome | Error, string]> = [
      [{ status: 'timeout', timeoutMs: 5000 }, 'timeout'],
      [{ status: 'cancelled' }, 'cancelled'],
      [{ status: 'failed', reason: 'worker_error' }, 'worker_error'],
      [{ status: 'paused', reason: 'fallback_too_large' }, 'fallback_too_large'],
      [new Error('boom'), 'internal'],
    ];
    for (const [result, reason] of cases) {
      const run = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
      const outcome = await prepareStoryWorldbook(input, {}, { openLibrary: reopen, host: { run } });
      expect(outcome).toMatchObject({ status: 'skipped', reason });
      expect((outcome as { message: string }).message.length).toBeGreaterThan(0);
    }
    expect(await prepareStoryWorldbook(input, {}, { openLibrary: () => Promise.resolve({ ok: false, code: 'unavailable', message: '' }) }))
      .toMatchObject({ status: 'skipped', reason: 'unavailable' });
    const aborted = new AbortController(); aborted.abort();
    const openLibrary = vi.fn();
    expect(await prepareStoryWorldbook(input, { signal: aborted.signal }, { openLibrary })).toMatchObject({ status: 'skipped', reason: 'cancelled' });
    expect(openLibrary).not.toHaveBeenCalled();
  });

  it('端到端（主线程降级路径）：导入 → 启用 → 命中关键词的条目进入插入计划', async () => {
    const factory = new IDBFactory(), name = uniqueName('e2e');
    const library = await open(name, factory);
    const a = await installed(library, '江城');
    await library.setEnabled(a.bookId, true);
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback: libraryFallback(library) });
    const outcome = await prepareStoryWorldbook(input, {}, { openLibrary: () => WorldbookLibrary.open({ name, factory }), host });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.via).toBe('main-thread');
    expect(outcome.books.map((b) => b.title)).toEqual(['江城']);
    expect(outcome.activated.map((e) => e.content)).toContain('李四是茶楼老板。');
    expect(JSON.stringify(outcome.plan)).toContain('李四是茶楼老板。');
    // 关闭后同样的输入不再带世界书。
    await library.setEnabled(a.bookId, false);
    expect(await prepareStoryWorldbook(input, {}, { openLibrary: () => WorldbookLibrary.open({ name, factory }), host })).toEqual({ status: 'off' });
    library.close();
  });
});
