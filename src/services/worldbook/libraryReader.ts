import { WorldbookReleaseSchema, type WorldbookRelease } from '../../domain/worldbook/schema';
import { LIBRARY_READABLE_VERSIONS, WORLDBOOK_LIBRARY_DB } from '../storage/worldbookLibrary';

/**
 * 本地书库的只读读取器（供触发 Worker 使用）。
 *
 * - **不升级、不创建**：不指定版本号打开；如果书库还不存在（会触发 upgradeneeded），立即中止，
 *   不会留下一个空的第 1 版数据库。建库与升级只由主线程的 WorldbookLibrary 负责。
 * - **版本兼容**：只接受 LIBRARY_READABLE_VERSIONS 里登记的结构版本，且必须有 releases 表；
 *   书库升到读取器不认识的版本时返回 unsupported_version（触发暂停），而不是猜测结构。
 * - **不阻塞升级**：收到 versionchange 时立即关闭连接，下次读取时重新打开并重新检查版本。
 */
export type ReaderFailure = 'unavailable' | 'missing_library' | 'unsupported_version' | 'invalid';
export type ReadResult = { ok: true; release: WorldbookRelease | null } | { ok: false; reason: ReaderFailure };

export interface LibraryReaderOptions { name?: string; factory?: IDBFactory | undefined }

export class LibraryReader {
  private database: IDBDatabase | undefined;
  constructor(private readonly options: LibraryReaderOptions = {}) {}

  private open(): Promise<{ ok: true; db: IDBDatabase } | { ok: false; reason: ReaderFailure }> {
    if (this.database) return Promise.resolve({ ok: true, db: this.database });
    const factory = 'factory' in this.options ? this.options.factory : globalThis.indexedDB;
    if (!factory) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return new Promise((resolve) => {
      let missing = false;
      let operation: IDBOpenDBRequest;
      try { operation = factory.open(this.options.name ?? WORLDBOOK_LIBRARY_DB); }
      catch { resolve({ ok: false, reason: 'unavailable' }); return; }
      operation.onupgradeneeded = () => {
        // 书库不存在：中止，不创建空数据库。
        missing = true;
        try { operation.transaction?.abort(); } catch { /* 已中止 */ }
      };
      operation.onerror = () => resolve({ ok: false, reason: missing ? 'missing_library' : 'unavailable' });
      operation.onblocked = () => resolve({ ok: false, reason: 'unavailable' });
      operation.onsuccess = () => {
        const db = operation.result;
        if (!LIBRARY_READABLE_VERSIONS.includes(db.version) || !db.objectStoreNames.contains('releases')) {
          db.close();
          resolve({ ok: false, reason: 'unsupported_version' });
          return;
        }
        db.onversionchange = () => { db.close(); if (this.database === db) this.database = undefined; };
        this.database = db;
        resolve({ ok: true, db });
      };
    });
  }

  /** 读取一个版本并按格式校验；不存在时 release 为 null。不复核哈希（由调用方按策略复核）。 */
  async read(bookId: string, versionId: string): Promise<ReadResult> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const request = opened.db.transaction('releases', 'readonly').objectStore('releases').get([bookId, versionId]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (raw === undefined) return { ok: true, release: null };
      const parsed = WorldbookReleaseSchema.safeParse((raw as { release?: unknown }).release);
      if (!parsed.success || parsed.data.bookId !== bookId || parsed.data.versionId !== versionId) return { ok: false, reason: 'invalid' };
      return { ok: true, release: parsed.data };
    } catch {
      // 连接在读取中被关闭（例如书库正在升级）：丢弃连接，下次重新打开。
      this.database = undefined;
      return { ok: false, reason: 'unavailable' };
    }
  }

  close(): void { this.database?.close(); this.database = undefined; }
}
