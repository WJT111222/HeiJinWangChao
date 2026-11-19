import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { WorldbookLibrary } from '../services/storage/worldbookLibrary';
import { IMPORT_MAIN_THREAD_MAX_CHARS, importIntoLibrary } from '../services/worldbook/libraryImport';
import { runImportJob, type ImportJob } from '../services/worldbook/libraryJob';
import type { WorkerPort } from '../services/worldbook/triggerHost';
import { sillyTavernDictBook } from './fixtures/worldbooks';

let n = 0;
const libName = () => `wb-import-${Date.now()}-${n++}`;
/** 进程内书库 Worker 替身：消息经结构化克隆。 */
class InProcessLibraryWorker implements WorkerPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly factory: IDBFactory, private readonly silent = false) {}
  postMessage(message: unknown) {
    if (this.silent) return;
    const job = structuredClone(message) as ImportJob;
    void runImportJob(job, this.factory).then((reply) => { if (!this.terminated) this.onmessage?.({ data: structuredClone({ id: job.id, reply }) } as MessageEvent); });
  }
  terminate() { this.terminated = true; }
}

describe('导入并安装世界书文件（书库 Worker）', () => {
  it('经 Worker 导入安装：只回传摘要；书库里有这个版本', async () => {
    const factory = new IDBFactory(), name = libName(), worker = new InProcessLibraryWorker(factory);
    const out = await importIntoLibrary(JSON.stringify(sillyTavernDictBook()), { title: '码头志', libraryName: name }, { createWorker: () => worker });
    expect(out).toMatchObject({ ok: true, summary: { status: 'installed', title: '码头志' } });
    expect(worker.terminated).toBe(true);
    if (!out.ok || !('summary' in out)) throw new Error('import');
    expect(Object.keys(out.summary).sort()).toEqual(['bookId', 'contentHash', 'entryCount', 'status', 'title', 'versionId']);
    const opened = await WorldbookLibrary.open({ name, factory });
    if (!opened.ok) throw new Error('open');
    expect(await opened.library.getSummary(out.summary.bookId, out.summary.versionId)).toMatchObject({ ok: true, summary: { entryCount: out.summary.entryCount } });
    opened.library.close();
  });

  it('文件无效：返回导入提示，不写入', async () => {
    const out = await importIntoLibrary('{"entries": 5}', { libraryName: libName() }, { createWorker: () => new InProcessLibraryWorker(new IDBFactory()) });
    expect(out).toMatchObject({ ok: false, code: 'import_failed' });
    expect(out.notices.length).toBeGreaterThan(0);
  });

  it('超时与取消：终止 Worker 并立即返回', async () => {
    const silent = new InProcessLibraryWorker(new IDBFactory(), true);
    expect(await importIntoLibrary('{}', {}, { createWorker: () => silent, timeoutMs: 200 })).toEqual({ ok: false, code: 'timeout', notices: [] });
    expect(silent.terminated).toBe(true);
    const controller = new AbortController(), worker = new InProcessLibraryWorker(new IDBFactory(), true);
    setTimeout(() => controller.abort(), 20);
    expect(await importIntoLibrary('{}', {}, { createWorker: () => worker, signal: controller.signal })).toEqual({ ok: false, code: 'cancelled', notices: [] });
    expect(worker.terminated).toBe(true);
  });

  it('无法创建 Worker：小文件在主线程处理；大文件明确拒绝，不写入', async () => {
    const factory = new IDBFactory(), name = libName();
    const broken = () => { throw new Error('no worker'); };
    expect(await importIntoLibrary(JSON.stringify(sillyTavernDictBook()), { libraryName: name }, { createWorker: broken, factory })).toMatchObject({ ok: true });
    const big = JSON.stringify({ ...sillyTavernDictBook(), padding: '字'.repeat(IMPORT_MAIN_THREAD_MAX_CHARS) });
    expect(await importIntoLibrary(big, { libraryName: name }, { createWorker: broken, factory })).toEqual({ ok: false, code: 'worker_unavailable', notices: [] });
    const opened = await WorldbookLibrary.open({ name, factory });
    if (!opened.ok) throw new Error('open');
    expect((await opened.library.listBooks() as { books: unknown[] }).books).toHaveLength(1);
    opened.library.close();
  });
});
