import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importWorldbookValue } from '../domain/worldbook/importWorldbook';
import { contentHash } from '../domain/worldbook/canonical';
import type { WorldbookRelease } from '../domain/worldbook/schema';
import { SaveRepository, saveDatabaseVersion } from '../services/storage/saveRepository';
import { LIBRARY_LIMITS, WORLDBOOK_LIBRARY_VERSION, WorldbookLibrary, type LibraryFailure, type LibraryLimits } from '../services/storage/worldbookLibrary';
import { sillyTavernDictBook } from './fixtures/worldbooks';
import { worldState } from './fixtures/world';

let counter = 0;
const uniqueName = (label: string) => `wb-library-${label}-${Date.now()}-${counter++}`;
async function release(title = '码头志', extra: Record<string, unknown> = {}): Promise<WorldbookRelease> {
  const result = await importWorldbookValue({ ...sillyTavernDictBook(), ...extra }, { title });
  if (!result.ok) throw new Error('fixture import failed');
  return result.release;
}
async function open(name: string, factory: IDBFactory = new IDBFactory(), limits?: Partial<LibraryLimits>) {
  const opened = await WorldbookLibrary.open({ name, factory, limits });
  if (!opened.ok) throw new Error(`open failed: ${opened.code}`);
  return opened.library;
}
const failed = (value: unknown): LibraryFailure => {
  expect((value as { ok: boolean }).ok).toBe(false);
  return value as LibraryFailure;
};
async function rawStore(factory: IDBFactory, name: string, store: string, edit: (os: IDBObjectStore) => IDBRequest) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); edit(tx.objectStore(store));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('阶段 C1：本地书库（独立附属数据库）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('建库：独立数据库与四张表（第 3 版新增全局启用表）；不创建、不打开游戏主库', async () => {
    const factory = new IDBFactory(), name = uniqueName('schema');
    const library = await open(name, factory);
    library.close();
    const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); });
    expect(db.version).toBe(WORLDBOOK_LIBRARY_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['books', 'enabled', 'releases', 'summaries']);
    const tx = db.transaction('releases', 'readonly');
    expect([...tx.objectStore('releases').indexNames].sort()).toEqual(['bookId', 'contentHash']);
    db.close();
    const names: Array<string | undefined> = (await factory.databases()).map((d: IDBDatabaseInfo) => d.name);
    expect(names).toContain(name);
    expect(names.some((n: string | undefined) => n === 'heijinwangchao')).toBe(false);
  });

  it('安装、读取、列出：书目索引与版本列表一致', async () => {
    const library = await open(uniqueName('install'));
    const r = await release();
    const installed = await library.install(r, { now: () => 1000 });
    expect(installed).toMatchObject({ ok: true, status: 'installed', book: { bookId: r.bookId, title: '码头志', latestVersionId: r.versionId, versionCount: 1, installedAt: 1000 } });
    const got = await library.getRelease(r.bookId, r.versionId, { verifyHash: true });
    expect(got).toEqual({ ok: true, release: r });
    expect(await library.getRelease(r.bookId, 'missing')).toEqual({ ok: true, release: null });
    const books = await library.listBooks();
    expect(books).toMatchObject({ ok: true, books: [{ bookId: r.bookId, versionCount: 1 }] });
    const versions = await library.listVersions(r.bookId);
    const keyCount = r.entries.reduce((n, e) => n + e.keys.length + e.secondaryKeys.length, 0);
    expect(versions).toMatchObject({ ok: true, versions: [{ bookId: r.bookId, versionId: r.versionId, versionLabel: r.versionLabel, contentHash: r.contentHash,
      title: '码头志', entryCount: r.entries.length, keyCount, installedAt: 1000 }] });
    expect((versions as { versions: Array<{ canonicalChars: number }> }).versions[0].canonicalChars).toBeGreaterThan(0);
    library.close();
  });

  it('重复安装同一版本：幂等，不产生第二份记录', async () => {
    const library = await open(uniqueName('idempotent'));
    const r = await release();
    await library.install(r, { now: () => 1 });
    const again = await library.install(structuredClone(r), { now: () => 2 });
    expect(again).toMatchObject({ ok: true, status: 'already_installed', book: { versionCount: 1, updatedAt: 1 } });
    expect((await library.listVersions(r.bookId) as { versions: unknown[] }).versions).toHaveLength(1);
    library.close();
  });

  it('同一书 ID + 版本 ID、内容不同：拒绝并保持原版本', async () => {
    const library = await open(uniqueName('conflict'));
    const r = await release();
    await library.install(r);
    const metadata = { ...r.metadata, title: '改过的标题' };
    const other: WorldbookRelease = { ...r, metadata, contentHash: await contentHash({ metadata, entries: r.entries, source: r.source }) };
    expect(failed(await library.install(other)).code).toBe('version_conflict');
    expect(await library.getRelease(r.bookId, r.versionId)).toEqual({ ok: true, release: r });
    library.close();
  });

  it('内容哈希不符、格式不合法：拒绝，不写入', async () => {
    const library = await open(uniqueName('reject'));
    const r = await release();
    expect(failed(await library.install({ ...r, contentHash: '0'.repeat(64) })).code).toBe('hash_mismatch');
    expect(failed(await library.install({ ...r, entries: [...r.entries, { nonsense: true }] } as unknown as WorldbookRelease)).code).toBe('invalid');
    expect(failed(await library.install({ ...r, origin: 'workshop', extra: 1 } as unknown as WorldbookRelease)).code).toBe('invalid');
    expect(await library.listBooks()).toEqual({ ok: true, books: [] });
    library.close();
  });

  it('同一文件导入两次（新 ID、相同内容）：默认返回已有版本；允许时另存一份', async () => {
    const library = await open(uniqueName('duplicate'));
    const first = await release(), second = await release();
    expect(second.bookId).not.toBe(first.bookId);
    expect(second.contentHash).toBe(first.contentHash);
    await library.install(first);
    const dup = await library.install(second);
    expect(dup).toMatchObject({ ok: true, status: 'duplicate_content', release: { bookId: first.bookId, versionId: first.versionId } });
    expect((await library.listBooks() as { books: unknown[] }).books).toHaveLength(1);
    const kept = await library.install(second, { allowDuplicateContent: true });
    expect(kept).toMatchObject({ ok: true, status: 'installed', release: { bookId: second.bookId } });
    expect((await library.listBooks() as { books: unknown[] }).books).toHaveLength(2);
    library.close();
  });

  it('同一本书的新版本：版本数增加，最近版本更新，列表按安装时间从新到旧', async () => {
    const library = await open(uniqueName('versions'));
    const v1 = await release();
    const metadata = { ...v1.metadata, title: '码头志（修订）' };
    const v2: WorldbookRelease = { ...v1, versionId: `${v1.versionId}-2`, versionLabel: '2', metadata,
      contentHash: await contentHash({ metadata, entries: v1.entries, source: v1.source }) };
    await library.install(v1, { now: () => 10 });
    const second = await library.install(v2, { now: () => 20 });
    expect(second).toMatchObject({ ok: true, status: 'installed', book: { versionCount: 2, latestVersionId: v2.versionId, title: '码头志（修订）', installedAt: 10, updatedAt: 20 } });
    const versions = await library.listVersions(v1.bookId) as { versions: Array<{ versionId: string }> };
    expect(versions.versions.map((v) => v.versionId)).toEqual([v2.versionId, v1.versionId]);
    library.close();
  });

  it('两个连接同时安装同一版本：一个写入，另一个得到“已安装”', async () => {
    const factory = new IDBFactory(), name = uniqueName('concurrent');
    const [a, b] = [await open(name, factory), await open(name, factory)];
    const r = await release();
    const results = await Promise.all([a.install(r), b.install(structuredClone(r))]);
    expect(results.map((x) => (x as { status: string }).status).sort()).toEqual(['already_installed', 'installed']);
    expect((await a.listVersions(r.bookId) as { versions: unknown[] }).versions).toHaveLength(1);
    a.close(); b.close();
  });

  it('书库故障只返回原因、不抛出：没有 IndexedDB、打开抛错、打开超时', async () => {
    expect(failed(await WorldbookLibrary.open({ factory: undefined })).code).toBe('unavailable');
    const throwing = { open() { throw new Error('boom'); } } as unknown as IDBFactory;
    expect(failed(await WorldbookLibrary.open({ factory: throwing })).code).toBe('unavailable');
    const silent = { open() { return {} as IDBOpenDBRequest; } } as unknown as IDBFactory;
    expect(failed(await WorldbookLibrary.open({ factory: silent, timeoutMs: 30 })).code).toBe('unavailable');
  });

  it('存储空间不足：返回 quota，事务回滚，书目与版本都没有写入', async () => {
    const library = await open(uniqueName('quota'));
    const r = await release();
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => { throw new DOMException('mock quota', 'QuotaExceededError'); });
    expect(failed(await library.install(r)).code).toBe('quota');
    vi.restoreAllMocks();
    expect(await library.listBooks()).toEqual({ ok: true, books: [] });
    expect(await library.getRelease(r.bookId, r.versionId)).toEqual({ ok: true, release: null });
    expect(await library.install(r)).toMatchObject({ ok: true, status: 'installed' });
    library.close();
  });

  it('库内记录损坏：读取返回 invalid，不抛出；列表只读摘要，摘要损坏时返回 invalid；verifyHash 能发现内容被改', async () => {
    const factory = new IDBFactory(), name = uniqueName('corrupt');
    const library = await open(name, factory);
    const r = await release(), r2 = await release('茶楼志', { name: '茶楼' });
    await library.install(r); await library.install(r2, { allowDuplicateContent: true });
    library.close();
    await rawStore(factory, name, 'releases', (os) => os.put({ bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash, installedAt: 1, release: { broken: true } }));
    await rawStore(factory, name, 'releases', (os) => os.put({ bookId: r2.bookId, versionId: r2.versionId, contentHash: r2.contentHash, installedAt: 1,
      release: { ...r2, entries: r2.entries.map((e, i) => i === 0 ? { ...e, content: '被改过' } : e) } }));
    const reopened = await open(name, factory);
    expect(failed(await reopened.getRelease(r.bookId, r.versionId)).code).toBe('invalid');
    // 列表只读摘要表：版本正文损坏不影响列表；摘要本身损坏才报告
    expect(await reopened.listVersions(r.bookId)).toMatchObject({ ok: true, versions: [{ versionId: r.versionId }] });
    reopened.close();
    await rawStore(factory, name, 'summaries', (os) => os.put({ bookId: r.bookId, versionId: r.versionId, broken: true }));
    const again = await open(name, factory);
    expect(failed(await again.listVersions(r.bookId)).code).toBe('invalid');
    again.close();
    const third = await open(name, factory);
    expect(await third.getRelease(r2.bookId, r2.versionId)).toMatchObject({ ok: true });
    expect(failed(await third.getRelease(r2.bookId, r2.versionId, { verifyHash: true })).code).toBe('hash_mismatch');
    third.close();
  });

  it('游戏主库不受影响：书库打不开时存档照常读写；书库写入后主库版本与表结构不变', async () => {
    const factory = new IDBFactory(), mainName = uniqueName('main'), libName = uniqueName('lib');
    const repo = await SaveRepository.open(mainName, factory);
    await repo.create(worldState());
    const before = await repo.list();
    // 书库故障：完全不影响存档
    const broken = { open() { throw new Error('boom'); } } as unknown as IDBFactory;
    expect((await WorldbookLibrary.open({ name: libName, factory: broken })).ok).toBe(false);
    expect(await repo.list()).toEqual(before);
    // 书库正常写入后，主库结构不变
    const library = await open(libName, factory);
    expect((await library.install(await release())).ok).toBe(true);
    library.close(); repo.close();
    const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(mainName); r.onsuccess = () => resolve(r.result); });
    expect(db.version).toBe(saveDatabaseVersion);
    expect([...db.objectStoreNames]).not.toContain('releases');
    expect([...db.objectStoreNames]).not.toContain('books');
    db.close();
    const again = await SaveRepository.open(mainName, factory);
    expect(await again.list()).toEqual(before);
    again.close();
  });

  it('安装资源上限：条目数、关键词数与长度、正文长度、确定性 JSON 大小，超限时拒绝且不写入', async () => {
    const library = await open(uniqueName('limits'), new IDBFactory(), { maxEntries: 1, maxKeysPerEntry: 2, maxKeyChars: 5, maxContentChars: 10, maxCanonicalChars: 1_000_000 });
    const r = await release();
    const one = (patch: Partial<WorldbookRelease['entries'][number]>) => ({ ...r, entries: [{ ...r.entries[0], ...patch }] });
    const withHash = async (x: WorldbookRelease) => ({ ...x, contentHash: await contentHash({ metadata: x.metadata, entries: x.entries, source: x.source }) });
    expect(failed(await library.install(await withHash({ ...r, entries: [r.entries[0], { ...r.entries[0], entryId: 'second' }] }))).code).toBe('too_large');
    expect(failed(await library.install(await withHash(one({ keys: ['a', 'b', 'c'] })))).code).toBe('too_large');
    expect(failed(await library.install(await withHash(one({ secondaryKeys: ['a', 'b', 'c'] })))).code).toBe('too_large');
    expect(failed(await library.install(await withHash(one({ keys: ['abcdef'] })))).code).toBe('too_large');
    expect(failed(await library.install(await withHash(one({ keys: ['a'], content: '十'.repeat(11) })))).code).toBe('too_large');
    const small = await open(uniqueName('canonical'), new IDBFactory(), { maxCanonicalChars: 100 });
    expect(failed(await small.install(r)).code).toBe('too_large');
    expect(await library.listBooks()).toEqual({ ok: true, books: [] });
    library.close(); small.close();
  });

  it('书库合计上限：版本数或总容量达到上限时拒绝，已有版本不变', async () => {
    const byCount = await open(uniqueName('full-count'), new IDBFactory(), { maxVersions: 1 });
    const a = await release('甲'), b = await release('乙', { name: '乙' });
    expect((await byCount.install(a)).ok).toBe(true);
    expect(failed(await byCount.install(b)).code).toBe('library_full');
    expect(await byCount.install(a)).toMatchObject({ ok: true, status: 'already_installed' });
    byCount.close();
    const bySize = await open(uniqueName('full-size'), new IDBFactory(), { maxTotalCanonicalChars: 1 });
    expect(failed(await bySize.install(a)).code).toBe('library_full');
    expect(await bySize.listBooks()).toEqual({ ok: true, books: [] });
    bySize.close();
    expect(LIBRARY_LIMITS.maxCanonicalChars).toBeGreaterThan(2 * 32 * 1024 * 1024);
  });

  it('从第 1 版附属库升级：保留已有版本并回填摘要；损坏的旧记录跳过、不阻塞升级', async () => {
    const factory = new IDBFactory(), name = uniqueName('upgrade');
    const r = await release();
    const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const releases = db.createObjectStore('releases', { keyPath: ['bookId', 'versionId'] });
        releases.createIndex('contentHash', 'contentHash'); releases.createIndex('bookId', 'bookId');
        db.createObjectStore('books', { keyPath: 'bookId' });
      };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    v1.close();
    await rawStore(factory, name, 'releases', (os) => os.put({ release: r, bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash, installedAt: 5 }));
    await rawStore(factory, name, 'releases', (os) => os.put({ release: { broken: true }, bookId: 'bad', versionId: 'bad', contentHash: 'x', installedAt: 5 }));
    await rawStore(factory, name, 'books', (os) => os.put({ bookId: r.bookId, title: '码头志', latestVersionId: r.versionId, versionCount: 1, installedAt: 5, updatedAt: 5 }));
    const library = await open(name, factory);
    expect(await library.listVersions(r.bookId)).toMatchObject({ ok: true, versions: [{ versionId: r.versionId, entryCount: r.entries.length, installedAt: 5 }] });
    expect(await library.getRelease(r.bookId, r.versionId, { verifyHash: true })).toEqual({ ok: true, release: r });
    expect(await library.listVersions('bad')).toEqual({ ok: true, versions: [] });
    library.close();
  });
});

