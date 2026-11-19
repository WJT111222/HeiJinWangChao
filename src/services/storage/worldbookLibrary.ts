import { canonicalJson, sha256Hex } from '../../domain/worldbook/canonical';
import { WORLDBOOK_LIMITS, WorldbookReleaseSchema, type WorldbookRelease } from '../../domain/worldbook/schema';
import { request, transaction } from './idb';

/**
 * 世界书本地书库（阶段 C1）：独立的附属 IndexedDB，只保存不可变的世界书版本与书目索引。
 *
 * 边界（详见 docs/WORLDBOOK_COMPATIBILITY.md「阶段 C1：本地书库」）：
 * - 与游戏主库 `heijinwangchao` 完全分离：不打开、不读写主库，主库版本号保持 5；
 *   旧版正式客户端不知道这个数据库，完全忽略它。
 * - 安装入口有单本与书库合计的资源上限（LIBRARY_LIMITS）；确定性 JSON 只生成一次，超限时不计算哈希。
 * - 哈希校验策略：安装时必验；正式生成时由触发 Worker 在首次载入某版本时复核（见 docs/WORLDBOOK_COMPATIBILITY.md）。
 * - 所有操作都返回结果对象，**不向调用方抛出**；书库打不开、被阻塞、超时或空间不足时只返回失败原因，
 *   不会影响存档的列表、打开、推进、撤回、历史与备份（C1 也没有接入任何存档流程）。
 * - 版本一经写入不再修改；同一书 ID + 版本 ID 内容不同时拒绝，绝不覆盖。
 * - 暂不包含：存档绑定、计时持久化、回合事务、历史锚点、版本删除、新版备份导入（C2 / C3 另行审批）。
 */
export const WORLDBOOK_LIBRARY_DB = 'heijinwangchao-worldbooks';
/**
 * 附属库自己的结构版本，与主库版本无关。
 * - 第 1 版：releases、books。
 * - 第 2 版：增加 summaries（版本摘要，列表与资源判断只读它，不读整本书）；升级时从已有版本回填。
 * 只读的读取器（触发 Worker）按 LIBRARY_READABLE_VERSIONS 判断能否读取，不触发升级。
 */
export const WORLDBOOK_LIBRARY_VERSION = 2;
/** 只读访问（只用 releases 表）能识别的结构版本。将来升版时在这里登记，读取器才会接受。 */
export const LIBRARY_READABLE_VERSIONS: readonly number[] = [1, 2];
const RELEASES = 'releases';
const BOOKS = 'books';
const SUMMARIES = 'summaries';

/**
 * 安装入口的资源上限。单本限制与导入器一致（导入器已经检查过，这里独立再查一次，不信任调用方）；
 * 书库合计限制防止无限累积占满浏览器存储。
 * canonicalChars：确定性 JSON 的字符数，大约是“规范化条目 + 原始来源”，即文件大小的两倍左右。
 */
export const LIBRARY_LIMITS = {
  maxEntries: WORLDBOOK_LIMITS.maxEntries,
  maxKeysPerEntry: WORLDBOOK_LIMITS.maxKeysPerEntry,
  maxKeyChars: WORLDBOOK_LIMITS.maxKeyChars,
  maxContentChars: WORLDBOOK_LIMITS.maxContentChars,
  maxCanonicalChars: 80_000_000,
  maxVersions: 1_000,
  maxTotalCanonicalChars: 256_000_000,
} as const;
const DEFAULT_OPEN_TIMEOUT_MS = 5_000;

export type LibraryFailureCode =
  | 'unavailable' // 环境不支持 IndexedDB、打开出错或超时
  | 'blocked' // 其他页面持有旧结构版本的连接
  | 'invalid' // 版本内容不符合格式，或库内记录损坏
  | 'hash_mismatch' // contentHash 与内容重新计算的结果不符
  | 'version_conflict' // 同一书 ID + 版本 ID 已有不同内容
  | 'too_large' // 单本超过安装资源上限
  | 'library_full' // 书库版本数或总量达到上限
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
/** 版本摘要（单独一张表，不含条目正文）：列表与资源判断只读它。 */
export interface LibraryVersionSummary {
  bookId: string;
  versionId: string;
  versionLabel: string;
  contentHash: string;
  title: string;
  entryCount: number;
  /** 主关键词与副关键词的总个数、总字数：供触发前的资源判断。 */
  keyCount: number;
  keyChars: number;
  contentChars: number;
  canonicalChars: number;
  installedAt: number;
}
interface StoredRelease { release: WorldbookRelease; bookId: string; versionId: string; contentHash: string; installedAt: number }

export type InstallStatus = 'installed' | 'already_installed' | 'duplicate_content';
export type InstallResult =
  | { ok: true; status: InstallStatus; release: WorldbookRelease; book: LibraryBook }
  | LibraryFailure;

export type LibraryLimits = { -readonly [K in keyof typeof LIBRARY_LIMITS]: number };
export interface OpenLibraryOptions {
  name?: string;
  /** 只用于测试缩小上限；正式代码不传，使用 LIBRARY_LIMITS。 */
  limits?: Partial<LibraryLimits>;
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
  too_large: '世界书超过书库的单本上限，未保存。',
  library_full: '本地书库的版本数或总容量已达上限，请先清理不用的版本。',
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

function toSummary(release: WorldbookRelease, installedAt: number, canonicalChars: number): LibraryVersionSummary {
  let keyCount = 0, keyChars = 0, contentChars = 0;
  for (const entry of release.entries) {
    keyCount += entry.keys.length + entry.secondaryKeys.length;
    for (const key of entry.keys) keyChars += key.length;
    for (const key of entry.secondaryKeys) keyChars += key.length;
    contentChars += entry.content.length;
  }
  return { bookId: release.bookId, versionId: release.versionId, versionLabel: release.versionLabel, contentHash: release.contentHash,
    title: release.metadata.title, entryCount: release.entries.length, keyCount, keyChars, contentChars, canonicalChars, installedAt };
}
function readSummary(raw: unknown): LibraryVersionSummary {
  const v = raw as Partial<LibraryVersionSummary> | undefined;
  const numbers = [v?.entryCount, v?.keyCount, v?.keyChars, v?.contentChars, v?.canonicalChars, v?.installedAt];
  if (!v || typeof v.bookId !== 'string' || typeof v.versionId !== 'string' || typeof v.contentHash !== 'string' || typeof v.title !== 'string'
    || typeof v.versionLabel !== 'string' || numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0))
    throw new LibraryAbort(fail('invalid', '书库中的版本摘要已损坏。'));
  return v as LibraryVersionSummary;
}
/** 单本资源上限（不含书库合计）。返回 null 表示通过。 */
export function releaseLimitViolation(release: WorldbookRelease, limits: LibraryLimits = LIBRARY_LIMITS): string | null {
  if (release.entries.length > limits.maxEntries) return `条目数 ${release.entries.length} 超过 ${limits.maxEntries}`;
  for (const entry of release.entries) {
    if (entry.keys.length > limits.maxKeysPerEntry || entry.secondaryKeys.length > limits.maxKeysPerEntry) return `条目「${entry.entryId}」关键词过多`;
    for (const key of [...entry.keys, ...entry.secondaryKeys]) if (key.length > limits.maxKeyChars) return `条目「${entry.entryId}」有关键词过长`;
    if (entry.content.length > limits.maxContentChars) return `条目「${entry.entryId}」正文过长`;
  }
  return null;
}
/**
 * 计算内容哈希，并顺带得到确定性 JSON 的长度（只生成一次）。超过单本上限时不计算哈希。
 */
async function hashWithinLimit(release: WorldbookRelease, maxChars: number): Promise<{ ok: true; hash: string; chars: number } | LibraryFailure> {
  let text: string;
  try { text = canonicalJson({ metadata: release.metadata, entries: release.entries, source: release.source }); }
  catch { return fail('invalid', MESSAGES.invalid); }
  if (text.length > maxChars) return fail('too_large', MESSAGES.too_large);
  try { return { ok: true, hash: await sha256Hex(text), chars: text.length }; }
  catch { return fail('invalid', MESSAGES.invalid); }
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
  private constructor(private readonly database: IDBDatabase, private readonly limits: LibraryLimits) {}

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
        const db = operation.result, tx = operation.transaction!;
        if (!db.objectStoreNames.contains(RELEASES)) {
          const releases = db.createObjectStore(RELEASES, { keyPath: ['bookId', 'versionId'] });
          releases.createIndex('contentHash', 'contentHash');
          releases.createIndex('bookId', 'bookId');
        }
        if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains(SUMMARIES)) {
          const summaries = db.createObjectStore(SUMMARIES, { keyPath: ['bookId', 'versionId'] });
          summaries.createIndex('bookId', 'bookId');
          // 第 1 版升级上来：从已有版本回填摘要。记录损坏的版本跳过（读取时仍会报告损坏）。
          const cursor = tx.objectStore(RELEASES).openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return;
            try {
              const stored = readStored(at.value);
              summaries.put(toSummary(stored.release, stored.installedAt, canonicalJson({ metadata: stored.release.metadata, entries: stored.release.entries, source: stored.release.source }).length));
            } catch { /* 跳过损坏记录 */ }
            at.continue();
          };
        }
      };
      operation.onerror = () => { settle(fail('unavailable', MESSAGES.unavailable)); };
      operation.onblocked = () => { settle(fail('blocked', MESSAGES.blocked)); };
      operation.onsuccess = () => {
        const db = operation.result;
        // 超时或被阻塞后才到达的连接：立即关闭，不留下占用。
        if (!settle({ ok: true, library: new WorldbookLibrary(db, { ...LIBRARY_LIMITS, ...options.limits }) })) { db.close(); return; }
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
    if (releaseLimitViolation(release, this.limits)) return fail('too_large', MESSAGES.too_large);
    const hashed = await hashWithinLimit(release, this.limits.maxCanonicalChars);
    if (!hashed.ok) return hashed;
    if (hashed.hash !== release.contentHash) return fail('hash_mismatch', MESSAGES.hash_mismatch);
    const now = (options.now ?? Date.now)();
    try {
      return await transaction(this.database, [RELEASES, BOOKS, SUMMARIES], 'readwrite', async (tx) => {
        const releases = tx.objectStore(RELEASES), books = tx.objectStore(BOOKS), summaries = tx.objectStore(SUMMARIES);
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
        // 书库合计上限：只读摘要表，不读整本书。
        const all = (await request(summaries.getAll())).map(readSummary);
        const total = all.reduce((sum, item) => sum + item.canonicalChars, 0);
        if (all.length + 1 > this.limits.maxVersions || total + hashed.chars > this.limits.maxTotalCanonicalChars)
          throw new LibraryAbort(fail('library_full', MESSAGES.library_full));
        const record: StoredRelease = { release, bookId: release.bookId, versionId: release.versionId, contentHash: release.contentHash, installedAt: now };
        await request(releases.add(record));
        await request(summaries.add(toSummary(release, now, hashed.chars)));
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
      const hashed = await hashWithinLimit(release, this.limits.maxCanonicalChars);
      if (!hashed.ok) return fail('invalid', '书库中的版本记录已损坏。');
      if (hashed.hash !== release.contentHash) return fail('hash_mismatch', '书库中的版本内容与内容哈希不符。');
    }
    return { ok: true, release: stored.release };
  }

  /** 读取一个版本的摘要（不读条目正文）；不存在时 summary 为 null。 */
  async getSummary(bookId: string, versionId: string): Promise<{ ok: true; summary: LibraryVersionSummary | null } | LibraryFailure> {
    try {
      const summary = await transaction(this.database, [SUMMARIES], 'readonly', async (tx) => {
        const raw = await request(tx.objectStore(SUMMARIES).get([bookId, versionId]));
        return raw === undefined ? null : readSummary(raw);
      });
      return { ok: true, summary };
    } catch (error) { return failureOf(error); }
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

  /** 列出一本书的全部版本（只读摘要表，不读条目正文），按安装时间从新到旧，相同时按版本 ID。 */
  async listVersions(bookId: string): Promise<{ ok: true; versions: LibraryVersionSummary[] } | LibraryFailure> {
    try {
      const versions = await transaction(this.database, [SUMMARIES], 'readonly', async (tx) =>
        (await request(tx.objectStore(SUMMARIES).index('bookId').getAll(bookId))).map(readSummary));
      versions.sort((a, b) => b.installedAt - a.installedAt || (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0));
      return { ok: true, versions };
    } catch (error) { return failureOf(error); }
  }
}
