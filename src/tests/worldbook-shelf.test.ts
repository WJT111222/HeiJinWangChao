import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { importWorldbookValue } from '../domain/worldbook/importWorldbook';
import type { WorldbookRelease } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { MAX_ENABLED_BOOKS, WorldbookLibrary, type LibraryFailure } from '../services/storage/worldbookLibrary';
import { LibraryReader } from '../services/worldbook/libraryReader';
import { libraryFallback } from '../services/worldbook/libraryFallback';
import { prepareStoryWorldbook, previewWorldbook, type StoryWorldbookInput } from '../services/worldbook/storyWorldbook';
import { WorldbookTriggerHost, type TriggerOutcome } from '../services/worldbook/triggerHost';
import { exportNativeText, exportSillyTavern } from '../domain/worldbook/export';
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
  it('从第 2 版升级到第 4 版后可启用书籍并从 Worker 读取', async () => {
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
    expect(db.version).toBe(4);
    expect([...db.objectStoreNames].sort()).toEqual(['books', 'enabled', 'mainSettings', 'releases', 'summaries', 'turnWorldviews']);
    db.close();
    // 触发 Worker 的只读读取器接受第 4 版。
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
    const started = Date.now();
    const outcome = await prepareStoryWorldbook(input, { timeoutMs: 1234 }, { openLibrary: fakeOpen(library), host: { run } });
    // 扫描拿到的是整个调用共用的截止时间（开始时间 + 1234 毫秒），而不是重新计时的 timeoutMs。
    const [sent, options] = run.mock.calls[0] as unknown as [unknown, { deadline: number; signal?: AbortSignal; timeoutMs?: number }];
    expect(sent).toEqual({
      books: [{ bookId: a.bookId, versionId: a.versionId, contentHash: a.contentHash }], messages: ['李四走进茶楼'],
      contextTokens: 32_000, storyRemainingTokens: 8_000, trigger: 'normal', messageCount: 3, timedState: EMPTY_TIMED_STATE, seed: 's1', settings: undefined,
    });
    expect(options.timeoutMs).toBeUndefined();
    expect(options.deadline).toBeGreaterThanOrEqual(started + 1234);
    expect(options.deadline).toBeLessThanOrEqual(Date.now() + 1234);
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

describe('简化版世界书：修改条目（停用 / 常驻）', () => {
  const idOf = (r: WorldbookRelease, content: string) => r.entries.find((e) => e.content === content)!.entryId;

  it('修改后生成新版本并替换旧版本：哈希有效、启用状态保留、生成时引用新版本、导出体现修改', async () => {
    const library = await open(uniqueName('revise'));
    const r = await installed(library, '江城');
    await library.setEnabled(r.bookId, true);
    const lisi = idOf(r, '李四是茶楼老板。'), bare = idOf(r, '没有关键词的条目。');
    const result = await library.reviseBook(r.bookId, { entries: { [lisi]: { disabled: true }, [bare]: { constant: true } } }, { baseVersionId: r.versionId, now: () => 99, newId: () => 'v-edit-1' });
    expect(result.ok && result.changed).toBe(true);
    if (!result.ok) return;
    expect(result.release.versionId).toBe('v-edit-1');
    expect(result.release.contentHash).not.toBe(r.contentHash);
    expect(result.book).toMatchObject({ latestVersionId: 'v-edit-1', versionCount: 1, updatedAt: 99 });
    // 新版本可通过哈希校验；旧版本与旧摘要已删除。
    expect(await library.getRelease(r.bookId, 'v-edit-1', { verifyHash: true })).toEqual({ ok: true, release: result.release });
    expect(await library.getRelease(r.bookId, r.versionId)).toEqual({ ok: true, release: null });
    const versions = await library.listVersions(r.bookId);
    expect(versions.ok && versions.versions.map((v) => v.versionId)).toEqual(['v-edit-1']);
    // 只改了这两个字段，其余条目与来源不变。
    const after = result.release.entries;
    expect(after.find((e) => e.entryId === lisi)).toEqual({ ...r.entries.find((e) => e.entryId === lisi)!, disabled: true });
    expect(after.find((e) => e.entryId === bare)).toEqual({ ...r.entries.find((e) => e.entryId === bare)!, constant: true });
    expect(after.filter((e) => e.entryId !== lisi && e.entryId !== bare)).toEqual(r.entries.filter((e) => e.entryId !== lisi && e.entryId !== bare));
    expect(result.release.source).toEqual(r.source);
    const enabled = await library.enabledBooks();
    expect(enabled.ok && enabled.books.map((b) => b.ref)).toEqual([{ bookId: r.bookId, versionId: 'v-edit-1', contentHash: result.release.contentHash }]);
    const exported = exportSillyTavern(result.release).value.entries as Record<string, Record<string, unknown>>;
    expect(Object.values(exported).find((e) => e.content === '李四是茶楼老板。')).toMatchObject({ disable: true });
    expect(Object.values(exported).find((e) => e.content === '没有关键词的条目。')).toMatchObject({ constant: true });
    library.close();
  });

  it('没有实际变化时不写入；未知条目、不存在的书返回 not_found', async () => {
    const library = await open(uniqueName('revise-noop'));
    const r = await installed(library, '江城');
    const lisi = idOf(r, '李四是茶楼老板。');
    expect(await library.reviseBook(r.bookId, { entries: { [lisi]: { disabled: false, constant: false } } }, { baseVersionId: r.versionId })).toMatchObject({ ok: true, changed: false, release: r });
    const versions = await library.listVersions(r.bookId);
    expect(versions.ok && versions.versions.map((v) => v.versionId)).toEqual([r.versionId]);
    expect(failed(await library.reviseBook(r.bookId, { entries: { 'entry-missing': { disabled: true } } }, { baseVersionId: r.versionId })).code).toBe('not_found');
    expect(failed(await library.reviseBook('book-missing', { entries: { [lisi]: { disabled: true } } }, { baseVersionId: r.versionId })).code).toBe('not_found');
    library.close();
  });

  it('两个页面同时修改同一本书：只有一个成功，另一个返回 version_conflict，书库保持一致', async () => {
    const factory = new IDBFactory(), name = uniqueName('revise-race');
    const a = await open(name, factory), b = await open(name, factory);
    const r = await installed(a, '江城');
    const lisi = idOf(r, '李四是茶楼老板。'), bare = idOf(r, '没有关键词的条目。');
    const results = await Promise.all([a.reviseBook(r.bookId, { entries: { [lisi]: { disabled: true } } }, { baseVersionId: r.versionId }), b.reviseBook(r.bookId, { entries: { [bare]: { constant: true } } }, { baseVersionId: r.versionId })]);
    const codes = results.map((x) => (x.ok ? 'ok' : x.code)).sort();
    expect(codes).toEqual(['ok', 'version_conflict']);
    const versions = await a.listVersions(r.bookId);
    expect(versions.ok && versions.versions.length).toBe(1);
    const shelf = await a.shelf();
    const winner = results.find((x) => x.ok)!;
    expect(shelf.ok && winner.ok && shelf.books[0].book.latestVersionId).toBe(winner.ok && winner.release.versionId);
    a.close(); b.close();
  });

  it('端到端：改为常驻的条目不需要关键词也会带入；停用的条目即使命中也不带入', async () => {
    const factory = new IDBFactory(), name = uniqueName('revise-e2e');
    const library = await open(name, factory);
    const r = await installed(library, '江城');
    await library.setEnabled(r.bookId, true);
    const lisi = idOf(r, '李四是茶楼老板。'), bare = idOf(r, '没有关键词的条目。');
    expect((await library.reviseBook(r.bookId, { entries: { [lisi]: { disabled: true }, [bare]: { constant: true } } }, { baseVersionId: r.versionId })).ok).toBe(true);
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback: libraryFallback(library) });
    const outcome = await prepareStoryWorldbook(input, {}, { openLibrary: () => WorldbookLibrary.open({ name, factory }), host });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const contents = outcome.activated.map((e) => e.content);
    expect(contents).toContain('没有关键词的条目。');
    expect(contents).not.toContain('李四是茶楼老板。');
    library.close();
  });
});

describe('简化版世界书：触发预览', () => {
  it('预览返回每个条目是否触发及原因；不需要启用；失败转为带说明的 skipped', async () => {
    const library = await open(uniqueName('preview'));
    const r = await installed(library, '江城');
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback: libraryFallback(library) });
    const ref = { bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash };
    const outcome = await previewWorldbook([ref], '李四推门进来', {}, { host });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const byContent = (content: string) => outcome.result.decisions.find((d) => d.entryId === r.entries.find((e) => e.content === content)!.entryId)!;
    expect(byContent('李四是茶楼老板。')).toMatchObject({ status: 'activated', reason: 'primary_match' });
    expect(byContent('张三在渡口摆摊。')).toMatchObject({ status: 'not_activated' });
    expect(byContent('没有关键词的条目。')).toMatchObject({ status: 'not_activated', reason: 'no_keys' });
    expect(outcome.result.decisions).toHaveLength(r.entries.length);
    const run = vi.fn(async (): Promise<TriggerOutcome> => ({ status: 'timeout', timeoutMs: 5000 }));
    const skipped = await previewWorldbook([ref], '李四', {}, { host: { run } });
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'timeout' });
    expect((skipped as { message: string }).message).toContain('预览未完成');
    library.close();
  });
});

describe('简化版世界书：编辑条目、增删条目、重命名、新建空白书', () => {
  const idOf = (r: WorldbookRelease, content: string) => r.entries.find((e) => e.content === content)!.entryId;

  it('编辑标题、关键词、副关键词与逻辑、正文、顺序：关键词去空去重，其他字段不变，导出酒馆格式体现修改', async () => {
    const library = await open(uniqueName('edit'));
    const r = await installed(library, '江城');
    const lisi = idOf(r, '李四是茶楼老板。');
    const result = await library.reviseBook(r.bookId, { entries: { [lisi]: {
      comment: '茶楼老板', keys: [' 李四 ', '', '茶楼', '李四'], secondaryKeys: ['掌柜'], selectiveLogic: 2, content: '李四经营江城最大的茶楼。', order: 7,
    } } }, { baseVersionId: r.versionId });
    expect(result.ok && result.changed).toBe(true);
    if (!result.ok) return;
    const before = r.entries.find((e) => e.entryId === lisi)!;
    const after = result.release.entries.find((e) => e.entryId === lisi)!;
    expect(after).toEqual({ ...before, comment: '茶楼老板', keys: ['李四', '茶楼'], secondaryKeys: ['掌柜'], selective: true, selectiveLogic: 2, content: '李四经营江城最大的茶楼。', order: 7 });
    const row = Object.values(exportSillyTavern(result.release).value.entries as Record<string, Record<string, unknown>>).find((e) => e.comment === '茶楼老板')!;
    expect(row).toMatchObject({ key: ['李四', '茶楼'], keysecondary: ['掌柜'], selectiveLogic: 2, content: '李四经营江城最大的茶楼。', order: 7 });
    library.close();
  });

  it('新增与删除条目、重命名：一次保存；书架与生成引用同步新书名；新条目可被触发', async () => {
    const factory = new IDBFactory(), name = uniqueName('add-remove');
    const library = await open(name, factory);
    const r = await installed(library, '江城');
    await library.setEnabled(r.bookId, true);
    const zhang = idOf(r, '张三在渡口摆摊。');
    const result = await library.reviseBook(r.bookId, {
      title: '  江城夜话（修订）  ',
      remove: [zhang],
      add: [{ entryId: 'local-new-1', comment: '王五', keys: ['王五'], content: '王五是更夫。' }],
    }, { baseVersionId: r.versionId });
    expect(result.ok && result.changed).toBe(true);
    if (!result.ok) return;
    expect(result.release.metadata.title).toBe('江城夜话（修订）');
    expect(result.release.entries.map((e) => e.entryId)).toEqual([...r.entries.map((e) => e.entryId).filter((id) => id !== zhang), 'local-new-1']);
    expect(result.release.entries.at(-1)).toMatchObject({ entryId: 'local-new-1', sourceUid: null, sourceKey: null, comment: '王五', keys: ['王五'], constant: false, disabled: false, order: 100, position: 0, probability: 100 });
    const shelf = await library.shelf();
    expect(shelf.ok && shelf.books.map((b) => [b.book.title, b.latest?.entryCount])).toEqual([['江城夜话（修订）', r.entries.length]]);
    const enabled = await library.enabledBooks();
    expect(enabled.ok && enabled.books.map((b) => b.title)).toEqual(['江城夜话（修订）']);
    // 导出酒馆格式：删掉的条目不在，新条目分配了不冲突的 uid。
    const exported = Object.values(exportSillyTavern(result.release).value.entries as Record<string, Record<string, unknown>>);
    expect(exported.map((e) => e.content)).not.toContain('张三在渡口摆摊。');
    expect(exported.find((e) => e.content === '王五是更夫。')).toMatchObject({ key: ['王五'], constant: false });
    const host = new WorldbookTriggerHost({ createWorker: () => { throw new Error('no worker'); }, fallback: libraryFallback(library) });
    const outcome = await prepareStoryWorldbook({ ...input, messages: ['王五敲着梆子走过'] }, {}, { openLibrary: () => WorldbookLibrary.open({ name, factory }), host });
    expect(outcome.status === 'ok' && outcome.activated.map((e) => e.content)).toContain('王五是更夫。');
    library.close();
  });

  it('不合法的修改整体拒绝、书库不变：关键词超长、空书名、重复的新条目 ID', async () => {
    const library = await open(uniqueName('edit-invalid'));
    const r = await installed(library, '江城');
    const lisi = idOf(r, '李四是茶楼老板。');
    const tooLong = failed(await library.reviseBook(r.bookId, { entries: { [lisi]: { keys: ['长'.repeat(2001)] } }, title: '改名' }, { baseVersionId: r.versionId }));
    expect(tooLong.code).toBe('invalid');
    expect((tooLong as { notices?: Array<{ code: string }> }).notices?.map((n) => n.code)).toContain('key_too_long');
    expect(failed(await library.reviseBook(r.bookId, { title: '   ' }, { baseVersionId: r.versionId })).code).toBe('invalid');
    expect(failed(await library.reviseBook(r.bookId, { add: [{ entryId: lisi, content: 'x' }] }, { baseVersionId: r.versionId })).code).toBe('invalid');
    const shelf = await library.shelf();
    expect(shelf.ok && shelf.books.map((b) => [b.book.title, b.book.latestVersionId])).toEqual([['江城', r.versionId]]);
    library.close();
  });

  it('新建空白书：没有条目、不自动启用；可以加条目、导出王朝格式后再导入内容一致', async () => {
    const library = await open(uniqueName('blank'));
    const created = await library.createBook('  我的设定  ');
    expect(created.ok).toBe(true);
    if (!created.ok || created.status !== 'installed') return;
    const shelf = await library.shelf();
    expect(shelf.ok && shelf.books.map((b) => [b.book.title, b.latest?.entryCount, b.enabled])).toEqual([['我的设定', 0, false]]);
    const added = await library.reviseBook(created.release.bookId, { add: [{ entryId: 'local-1', comment: '城门', keys: ['城门'], content: '城门子时关闭。' }] }, { baseVersionId: created.release.versionId });
    expect(added.ok && added.changed).toBe(true);
    if (!added.ok) return;
    const reimported = await importWorldbookValue(JSON.parse(exportNativeText(added.release)));
    expect(reimported.ok && reimported.release.entries).toEqual(added.release.entries);
    expect(reimported.ok && reimported.release.contentHash).toBe(added.release.contentHash);
    library.close();
  });
});

describe('收尾返修：多标签页冲突、导出书名、连续新建', () => {
  const idOf = (r: WorldbookRelease, content: string) => r.entries.find((e) => e.content === content)!.entryId;

  it('B 基于编辑开始时的旧版本保存，A 已先保存：明确冲突，A 的数据不被覆盖', async () => {
    const factory = new IDBFactory(), name = uniqueName('tabs');
    const a = await open(name, factory), b = await open(name, factory);
    const r = await installed(a, '江城');
    const lisi = idOf(r, '李四是茶楼老板。');
    const base = r.versionId; // 两个标签页都从这个版本开始编辑
    const saved = await a.reviseBook(r.bookId, { entries: { [lisi]: { content: 'A 改过的内容' } } }, { baseVersionId: base });
    expect(saved.ok && saved.changed).toBe(true);
    // B 改的是另一条，保存过程中版本没有变化，但编辑开始时的版本已过期：也必须冲突。
    const zhang = idOf(r, '张三在渡口摆摊。');
    const stale = await b.reviseBook(r.bookId, { entries: { [zhang]: { content: 'B 改过的内容' } } }, { baseVersionId: base });
    expect(failed(stale).code).toBe('version_conflict');
    const shelf = await a.shelf();
    const latest = shelf.ok ? await a.getRelease(r.bookId, shelf.books[0].book.latestVersionId) : null;
    const entries = latest && latest.ok ? latest.release!.entries : [];
    expect(entries.find((e) => e.entryId === lisi)!.content).toBe('A 改过的内容');
    expect(entries.find((e) => e.entryId === zhang)!.content).toBe('张三在渡口摆摊。');
    // B 用最新版本重新开始编辑后可以保存。
    const fresh = shelf.ok ? shelf.books[0].book.latestVersionId : '';
    expect((await b.reviseBook(r.bookId, { entries: { [zhang]: { content: 'B 改过的内容' } } }, { baseVersionId: fresh })).ok).toBe(true);
    a.close(); b.close();
  });

  it('酒馆格式导出使用当前书名（文件自带 name 时也更新）', async () => {
    const library = await open(uniqueName('export-name'));
    const imported = await importWorldbookValue({ ...sillyTavernDictBook(), name: '旧书名' });
    if (!imported.ok) throw new Error('import');
    expect(imported.release.metadata.title).toBe('旧书名');
    await library.install(imported.release);
    const renamed = await library.reviseBook(imported.release.bookId, { title: '新书名' }, { baseVersionId: imported.release.versionId });
    if (!renamed.ok) throw new Error('rename');
    expect(exportSillyTavern(renamed.release).value.name).toBe('新书名');
    // 没改名时导出与原文件一致（无损回环不受影响）。
    expect(exportSillyTavern(imported.release).value.name).toBe('旧书名');
    library.close();
  });

  it('连续新建两本空白书：是两本不同的书，书名自动编号，都真的新建了', async () => {
    const library = await open(uniqueName('blank-twice'));
    const first = await library.createBook('新世界书');
    const second = await library.createBook('新世界书');
    expect(first.ok && first.status).toBe('installed');
    expect(second.ok && second.status).toBe('installed');
    expect(first.ok && second.ok && first.release.bookId !== second.release.bookId).toBe(true);
    const shelf = await library.shelf();
    expect(shelf.ok && shelf.books.map((b) => b.book.title).sort()).toEqual(['新世界书', '新世界书 2']);
    library.close();
  });
});

describe('收尾返修：prepareStoryWorldbook 统一截止时间与取消', () => {
  const never = <T,>() => new Promise<T>(() => {});
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('书库打开卡住：按开始时的截止时间返回 timeout；之后才打开成功的书库会被关闭', async () => {
    let resolveOpen!: (value: Awaited<ReturnType<typeof WorldbookLibrary.open>>) => void;
    const openLibrary = () => new Promise<Awaited<ReturnType<typeof WorldbookLibrary.open>>>((resolve) => { resolveOpen = resolve; });
    const started = Date.now();
    const outcome = await prepareStoryWorldbook(input, { timeoutMs: 250 }, { openLibrary, host: { run: vi.fn() } });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
    const library = await open(uniqueName('late-open'));
    const close = vi.spyOn(library, 'close');
    resolveOpen({ ok: true, library });
    await sleep(20);
    expect(close).toHaveBeenCalled();
  });

  it('启用列表读取卡住：同样计入预算并返回 timeout', async () => {
    const library = await open(uniqueName('slow-list'));
    vi.spyOn(library, 'enabledBooks').mockImplementation(() => never());
    const started = Date.now();
    const outcome = await prepareStoryWorldbook(input, { timeoutMs: 250 }, { openLibrary: () => Promise.resolve({ ok: true, library }), host: { run: vi.fn() } });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('取消发生在书库打开期间：立即返回 cancelled，不再调用扫描', async () => {
    const controller = new AbortController();
    const run = vi.fn();
    const pending = prepareStoryWorldbook(input, { signal: controller.signal, timeoutMs: 5_000 }, { openLibrary: () => never(), host: { run } });
    await sleep(30);
    const started = Date.now();
    controller.abort();
    expect(await pending).toMatchObject({ status: 'skipped', reason: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(200);
    expect(run).not.toHaveBeenCalled();
  });

  it('前面步骤用掉的时间从扫描预算里扣除：交给扫描的是同一个截止时间', async () => {
    const factory = new IDBFactory(), name = uniqueName('deadline');
    const library = await open(name, factory);
    const r = await installed(library, '江城');
    await library.setEnabled(r.bookId, true);
    library.close();
    let seen: { deadline?: number; timeoutMs?: number } = {};
    const run = vi.fn(async (_req: unknown, options: { deadline?: number; timeoutMs?: number }) => { seen = options; return { status: 'timeout', timeoutMs: 0 } as TriggerOutcome; });
    const started = Date.now();
    const slowOpen = async () => { await sleep(150); return WorldbookLibrary.open({ name, factory }); };
    await prepareStoryWorldbook(input, { timeoutMs: 1_000 }, { openLibrary: slowOpen, host: { run } });
    expect(seen.deadline).toBeGreaterThanOrEqual(started + 1_000 - 5);
    expect(seen.deadline).toBeLessThanOrEqual(started + 1_000 + 50);
  });
});
