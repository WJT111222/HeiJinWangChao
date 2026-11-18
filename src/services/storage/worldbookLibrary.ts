import { contentHash } from '../../domain/worldbook/canonical';
import { WorldbookReleaseSchema, type WorldbookRelease } from '../../domain/worldbook/schema';
import { request, transaction } from './idb';

/**
 * 世界书本地书库（阶段 C1）：独立的附属 IndexedDB，只保存不可变的世界书版本与书目索引。
 *
 * 边界（详见 docs/WORLDBOOK_COMPATIBILITY.md「阶段 C1：本地书库」）：
 * - 与游戏主库 `heijinwangchao` 完全分离：不打开、不读写主库，主库版本号保持 5；
 *   旧版正式客户端不知道这个数据库，完全忽略它。
 * - 所有操作都返回结果对象，**不向调用方抛出**；书库打不开、被阻塞、超时或空间不足时只返回失败原因，
 *   不会影响存档的列表、打开、推进、撤回、历史与备份（C1 也没有接入任何存档流程）。
 * - 版本一经写入不再修改；同一书 ID + 版本 ID 内容不同时拒绝，绝不覆盖。
 * - 暂不包含：存档绑定、计时持久化、回合事务、历史锚点、版本删除、新版备份导入（C2 / C3 另行审批）。
 */
export const WORLDBOOK_LIBRARY_DB = 'heijinwangchao-worldbooks';
/** 附属库自己的结构版本，与主库版本无关。C2 增加存档状态表时再升级。 */
export const WORLDBOOK_LIBRARY_VERSION = 1;
const RELEASES = 'releases';
const BOOKS = 'books';
const DEFAULT_OPEN_TIMEOUT_MS = 5_000;

export type LibraryFailureCode =
  | 'unavailable' // 环境不支持 IndexedDB、打开出错或超时
  | 'blocked' // 其他页面持有旧结构版本的连接
  | 'invalid' // 版本内容不符合格式，或库内记录损坏
  | 'hash_mismatch' // contentHash 与内容重新计算的结果不符
  | 'version_conflict' // 同一书 ID + 版本 ID 已有不同内容
  | 'quota' // 存储空间不足
  | 'failed'; // 其他读写失败（事务已回滚）
export interface LibraryFailure { ok: false; code: LibraryFailureCode; message: string }

/** 书目索引：每本书一条。 */
export interface LibraryBook {
  bookId: string;
  title: string;
  /** 最近安装的版本。 */
  latestVersionId: string;
  versionCount: number;
  installedAt: number;
  updatedAt: number;
}
/** 版本列表项（不含条目正文）。 */
export interface LibraryVersionSummary {
  bookId: string;
  versionId: string;
  versionLabel: string;
  contentHash: string;
  title: string;
  entryCount: number;
  installedAt: number;
}
interface StoredRelease { release: WorldbookRelease; bookId: string; versionId: string; contentHash: string; installedAt: number }

export type InstallStatus = 'installed' | 'already_installed' | 'duplicate_content';
export type InstallResult =
  | { ok: true; status: InstallStatus; release: WorldbookRelease; book: LibraryBook }
  | LibraryFailure;

export interface OpenLibraryOptions {
  name?: string;
  factory?: IDBFactory | undefined;
  /** 打开超过这个时间仍无结果，按“不可用”返回（之后到达的连接会被关闭）。 */
  timeoutMs?: number;
}
export interface InstallOptions {
  /**
   * 内容哈希与已安装版本相同、但书 ID / 版本 ID 不同（例如同一文件导入两次）时：
   * 默认不再存一份，返回已有版本（status = duplicate_content）；为 true 时照常保存为另一个版本。
   */
  allowDuplicateContent?: boolean;
  now?: () => number;
}

const fail = (code: LibraryFailureCode, message: string): LibraryFailure => ({ ok: false, code, message });
const MESSAGES: Record<LibraryFailureCode, string> = {
  unavailable: '本地书库暂不可用，存档不受影响。',
  blocked: '本地书库正被其他页面占用，请关闭旧标签页后重试。存档不受影响。',
  invalid: '世界书版本格式不正确，未保存。',
  hash_mismatch: '世界书内容与记录的内容哈希不符，未保存。',
  version_conflict: '书库中已有相同版本号但内容不同的版本，已拒绝，原版本保持不变。',
  quota: '浏览器存储空间不足，世界书未保存。存档不受影响。',
  failed: '书库读写失败，本次操作已回滚。存档不受影响。',
};
function failureOf(error: unknown): LibraryFailure {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return fail('quota', MESSAGES.quota);
  if (error instanceof LibraryAbort) return error.failure;
  return fail('failed', MESSAGES.failed);
}
/** 在事务内部中止并带出结构化原因。 */
class LibraryAbort extends Error {
  constructor(readonly failure: LibraryFailure) { super(failure.message); }
}

function toSummary(stored: StoredRelease): LibraryVersionSummary {
  const { release } = stored;
  return { bookId: release.bookId, versionId: release.versionId, versionLabel: release.versionLabel, contentHash: release.contentHash,
    title: release.metadata.title, entryCount: release.entries.length, installedAt: stored.installedAt };
}
function readStored(raw: unknown): StoredRelease {
  const value = raw as Partial<StoredRelease> | undefined;
  const parsed = WorldbookReleaseSchema.safeParse(value?.release);
  if (!value || !parsed.success || typeof value.installedAt !== 'number' || value.bookId !== parsed.data.bookId
    || value.versionId !== parsed.data.versionId || value.contentHash !== parsed.data.contentHash) throw new LibraryAbort(fail('invalid', '书库中的版本记录已损坏。'));
  return { release: parsed.data, bookId: value.bookId, versionId: value.versionId, contentHash: value.contentHash, installedAt: value.installedAt };
}
function readBook(raw: unknown): LibraryBook {
  const value = raw as Partial<LibraryBook> | undefined;
  if (!value || typeof value.bookId !== 'string' || typeof value.title !== 'string' || typeof value.latestVersionId !== 'string'
    || !Number.isSafeInteger(value.versionCount) || typeof value.installedAt !== 'number' || typeof value.updatedAt !== 'number')
    throw new LibraryAbort(fail('invalid', '书库中的书目记录已损坏。'));
  return value as LibraryBook;
}

export class WorldbookLibrary {
  private constructor(private readonly database: IDBDatabase) {}

  /** 打开（必要时创建）附属书库。从不抛出；失败时返回原因。 */
  static open(options: OpenLibraryOptions = {}): Promise<{ ok: true; library: WorldbookLibrary } | LibraryFailure> {
    const factory = 'factory' in options ? options.factory : globalThis.indexedDB;
    if (!factory) return Promise.resolve(fail('unavailable', MESSAGES.unavailable));
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: { ok: true; library: WorldbookLibrary } | LibraryFailure) => {
        if (settled) return false;
        settled = true; clearTimeout(timer); resolve(value); return true;
      };
      const timer = setTimeout(() => settle(fail('unavailable', MESSAGES.unavailable)), options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
      let operation: IDBOpenDBRequest;
      try { operation = factory.open(options.name ?? WORLDBOOK_LIBRARY_DB, WORLDBOOK_LIBRARY_VERSION); }
      catch { settle(fail('unavailable', MESSAGES.unavailable)); return; }
      operation.onupgradeneeded = () => {
        const db = operation.result;
        if (!db.objectStoreNames.contains(RELEASES)) {
          const releases = db.createObjectStore(RELEASES, { keyPath: ['bookId', 'versionId'] });
          releases.createIndex('contentHash', 'contentHash');
          releases.createIndex('bookId', 'bookId');
        }
        if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'bookId' });
      };
      operation.onerror = () => { settle(fail('unavailable', MESSAGES.unavailable)); };
      operation.onblocked = () => { settle(fail('blocked', MESSAGES.blocked)); };
      operation.onsuccess = () => {
        const db = operation.result;
        // 超时或被阻塞后才到达的连接：立即关闭，不留下占用。
        if (!settle({ ok: true, library: new WorldbookLibrary(db) })) { db.close(); return; }
        db.onversionchange = () => db.close();
      };
    });
  }

  close(): void { this.database.close(); }

  /**
   * 安装一个世界书版本（不可变）。先校验格式并重新计算内容哈希，再在一个事务里：
   * - 同一书 ID + 版本 ID 已存在：内容哈希相同 → already_installed（幂等）；不同 → version_conflict，不覆盖；
   * - 内容哈希已存在于其他版本、且未允许重复内容 → duplicate_content，返回已有版本，不写入；
   * - 否则写入版本，并更新书目索引（最近版本、版本数）。
   */
  async install(input: WorldbookRelease, options: InstallOptions = {}): Promise<InstallResult> {
    const parsed = WorldbookReleaseSchema.safeParse(input);
    if (!parsed.success) return fail('invalid', MESSAGES.invalid);
    const release = parsed.data;
    let actual: string;
    try { actual = await contentHash({ metadata: release.metadata, entries: release.entries, source: release.source }); }
    catch { return fail('invalid', MESSAGES.invalid); }
    if (actual !== release.contentHash) return fail('hash_mismatch', MESSAGES.hash_mismatch);
    const now = (options.now ?? Date.now)();
    try {
      return await transaction(this.database, [RELEASES, BOOKS], 'readwrite', async (tx) => {
        const releases = tx.objectStore(RELEASES), books = tx.objectStore(BOOKS);
        const existing = await request(releases.get([release.bookId, release.versionId]));
        if (existing !== undefined) {
          const stored = readStored(existing);
          if (stored.contentHash !== release.contentHash) throw new LibraryAbort(fail('version_conflict', MESSAGES.version_conflict));
          const book = readBook(await request(books.get(release.bookId)));
          return { ok: true as const, status: 'already_installed' as const, release: stored.release, book };
        }
        if (!options.allowDuplicateContent) {
          const sameContent = await request(releases.index('contentHash').getAll(release.contentHash, 1));
          if (sameContent.length) {
            const stored = readStored(sameContent[0]);
            const book = readBook(await request(books.get(stored.bookId)));
            return { ok: true as const, status: 'duplicate_content' as const, release: stored.release, book };
          }
        }
        const record: StoredRelease = { release, bookId: release.bookId, versionId: release.versionId, contentHash: release.contentHash, installedAt: now };
        await request(releases.add(record));
        const previous = await request(books.get(release.bookId));
        const book: LibraryBook = previous === undefined
          ? { bookId: release.bookId, title: release.metadata.title, latestVersionId: release.versionId, versionCount: 1, installedAt: now, updatedAt: now }
          : { ...readBook(previous), title: release.metadata.title, latestVersionId: release.versionId, versionCount: readBook(previous).versionCount + 1, updatedAt: now };
        await request(books.put(book));
        return { ok: true as const, status: 'installed' as const, release, book };
      });
    } catch (error) {
      return failureOf(error);
    }
  }

  /** 读取一个版本；不存在时 release 为 null。verifyHash 为 true 时重新计算内容哈希（大书较慢）。 */
  async getRelease(bookId: string, versionId: string, options: { verifyHash?: boolean } = {}):
    Promise<{ ok: true; release: WorldbookRelease | null } | LibraryFailure> {
    let stored: StoredRelease | undefined;
    try {
      stored = await transaction(this.database, [RELEASES], 'readonly', async (tx) => {
        const raw = await request(tx.objectStore(RELEASES).get([bookId, versionId]));
        return raw === undefined ? undefined : readStored(raw);
      });
    } catch (error) { return failureOf(error); }
    if (!stored) return { ok: true, release: null };
    if (options.verifyHash) {
      const { release } = stored;
      let actual: string;
      try { actual = await contentHash({ metadata: release.metadata, entries: release.entries, source: release.source }); }
      catch { return fail('invalid', '书库中的版本记录已损坏。'); }
      if (actual !== release.contentHash) return fail('hash_mismatch', '书库中的版本内容与内容哈希不符。');
    }
    return { ok: true, release: stored.release };
  }

  /** 列出全部书目，按最近更新时间从新到旧，相同时按书 ID。 */
  async listBooks(): Promise<{ ok: true; books: LibraryBook[] } | LibraryFailure> {
    try {
      const books = await transaction(this.database, [BOOKS], 'readonly', async (tx) =>
        (await request(tx.objectStore(BOOKS).getAll())).map(readBook));
      books.sort((a, b) => b.updatedAt - a.updatedAt || (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0));
      return { ok: true, books };
    } catch (error) { return failureOf(error); }
  }

  /** 列出一本书的全部版本（不含条目正文），按安装时间从新到旧，相同时按版本 ID。 */
  async listVersions(bookId: string): Promise<{ ok: true; versions: LibraryVersionSummary[] } | LibraryFailure> {
    try {
      const versions = await transaction(this.database, [RELEASES], 'readonly', async (tx) =>
        (await request(tx.objectStore(RELEASES).index('bookId').getAll(bookId))).map((raw) => toSummary(readStored(raw))));
      versions.sort((a, b) => b.installedAt - a.installedAt || (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0));
      return { ok: true, versions };
    } catch (error) { return failureOf(error); }
  }
}
