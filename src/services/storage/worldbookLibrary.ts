import { canonicalJson, sha256Hex } from '../../domain/worldbook/canonical';
import { WORLDBOOK_LIMITS, WorldbookReleaseSchema, type ImportNotice, type WorldbookRelease } from '../../domain/worldbook/schema';
import { TRIGGER_RESOURCE_LIMITS, type BookRef } from '../../domain/worldbook/triggerRequest';
import { createBlankRelease, reviseRelease, type BookChange } from '../../domain/worldbook/release';
import { request, transaction } from './idb';

/**
 * 世界书本地书库：独立的附属 IndexedDB，保存不可变的世界书版本、书目索引与全局启用状态。
 *
 * 边界（详见 docs/WORLDBOOK_COMPATIBILITY.md「阶段 C1：本地书库」）：
 * - 与游戏主库 `heijinwangchao` 完全分离：不打开、不读写主库，主库版本号保持 5；
 *   旧版正式客户端不知道这个数据库，完全忽略它。
 * - 安装入口有单本与书库合计的资源上限（LIBRARY_LIMITS）；确定性 JSON 只生成一次，超限时不计算哈希。
 * - 哈希校验策略：安装时必验；正式生成时由触发 Worker 在首次载入某版本时复核（见 docs/WORLDBOOK_COMPATIBILITY.md）。
 * - 所有操作都返回结果对象，**不向调用方抛出**；书库打不开、被阻塞、超时或空间不足时只返回失败原因，
 *   不会影响存档的列表、打开、推进、撤回、历史与备份（C1 也没有接入任何存档流程）。
 * - 版本一经写入不再修改；同一书 ID + 版本 ID 内容不同时拒绝，绝不覆盖。
 * - 简化版（2026-11-20 决定）：启用状态是全局的，对所有存档生效；不绑定存档，不随撤回 / 回溯 / 备份变化。
 *   删除一本书在同一个事务里删掉它的全部版本、摘要与启用状态。
 */
export const WORLDBOOK_LIBRARY_DB = 'heijinwangchao-worldbooks';
/**
 * 附属库自己的结构版本，与主库版本无关。
 * - 第 1 版：releases、books。
 * - 第 2 版：增加 summaries（版本摘要，列表与资源判断只读它，不读整本书）；升级时从已有版本回填。
 * - 第 3 版：增加 enabled（全局启用的书，键为书 ID）。
 * 只读的读取器（触发 Worker）按 LIBRARY_READABLE_VERSIONS 判断能否读取，不触发升级。
 */
export const WORLDBOOK_LIBRARY_VERSION = 3;
/** 只读访问（只用 releases 表）能识别的结构版本。将来升版时在这里登记，读取器才会接受。 */
export const LIBRARY_READABLE_VERSIONS: readonly number[] = [1, 2, 3];
const RELEASES = 'releases';
const BOOKS = 'books';
const SUMMARIES = 'summaries';
const ENABLED = 'enabled';
const CONFLICT_MESSAGE = '这本书已在其他标签页保存过新版本，你的修改没有保存。';
/** 同时启用的书数上限，与单次触发请求的书数上限一致。 */
export const MAX_ENABLED_BOOKS = TRIGGER_RESOURCE_LIMITS.maxBooks;

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
  | 'not_found' // 书不存在（可能已在其他页面删除）
  | 'too_many_enabled' // 同时启用的书已达上限
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
/** 书架上的一本书：书目、最近版本的摘要与是否启用。 */
export interface ShelfBook { book: LibraryBook; latest: LibraryVersionSummary | null; enabled: boolean }
/** 一本启用的书在生成时的引用（最近版本）。 */
export interface EnabledBook { ref: BookRef; title: string }
interface EnabledRecord { bookId: string; enabledAt: number }
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
  not_found: '这本世界书已不在书库中，可能已在其他页面删除。',
  too_many_enabled: `最多同时启用 ${TRIGGER_RESOURCE_LIMITS.maxBooks} 本世界书，请先关闭不用的。`,
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
        if (!db.objectStoreNames.contains(ENABLED)) db.createObjectStore(ENABLED, { keyPath: 'bookId' });
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
  /**
   * 打开或关闭一本书（全局，对所有存档生效）。书必须存在；同时启用的书数有上限。
   * 重复设置为相同状态是幂等的。
   */
  async setEnabled(bookId: string, enabled: boolean, options: { now?: () => number } = {}): Promise<{ ok: true; enabled: boolean } | LibraryFailure> {
    try {
      return await transaction(this.database, [BOOKS, ENABLED], 'readwrite', async (tx) => {
        const books = tx.objectStore(BOOKS), store = tx.objectStore(ENABLED);
        if (!enabled) { await request(store.delete(bookId)); return { ok: true as const, enabled: false }; }
        if ((await request(books.get(bookId))) === undefined) throw new LibraryAbort(fail('not_found', MESSAGES.not_found));
        if ((await request(store.get(bookId))) !== undefined) return { ok: true as const, enabled: true };
        if ((await request(store.count())) >= MAX_ENABLED_BOOKS) throw new LibraryAbort(fail('too_many_enabled', MESSAGES.too_many_enabled));
        const record: EnabledRecord = { bookId, enabledAt: (options.now ?? Date.now)() };
        await request(store.add(record));
        return { ok: true as const, enabled: true };
      });
    } catch (error) { return failureOf(error); }
  }

  /**
   * 修改一本书（改条目、增删条目、改书名），保存为新版本并替换旧版本：
   * - baseVersionId 是玩家**开始编辑时**看到的版本：最近版本已经不是它（别的标签页先保存了），直接返回 version_conflict，
   *   不把这次修改套到别人的新版本上，也不报成功；
   * - 先读最近版本、在事务外生成新版本并计算哈希，再在一个事务里再次核对最近版本仍是 baseVersionId，
   *   删除这本书的全部旧版本与摘要、写入新版本、更新书目；启用状态（按书 ID）保持不变；
   * - 简化版不绑定存档，旧版本没有引用，所以直接删除，不占空间；
   * - 没有实际变化时不写入。
   */
  async reviseBook(bookId: string, change: BookChange, options: { baseVersionId: string; now?: () => number; newId?: () => string }):
    Promise<{ ok: true; changed: boolean; release: WorldbookRelease; book: LibraryBook } | (LibraryFailure & { notices?: ImportNotice[] })> {
    let base: { book: LibraryBook; release: WorldbookRelease };
    try {
      const read = await transaction(this.database, [BOOKS, RELEASES], 'readonly', async (tx) => {
        const rawBook = await request(tx.objectStore(BOOKS).get(bookId));
        if (rawBook === undefined) return null;
        const book = readBook(rawBook);
        const raw = await request(tx.objectStore(RELEASES).get([bookId, book.latestVersionId]));
        if (raw === undefined) throw new LibraryAbort(fail('invalid', '书库中缺少这本书的最近版本。'));
        return { book, release: readStored(raw).release };
      });
      if (!read) return fail('not_found', MESSAGES.not_found);
      if (read.book.latestVersionId !== options.baseVersionId) return fail('version_conflict', CONFLICT_MESSAGE);
      base = read;
    } catch (error) { return failureOf(error); }
    let revised: Awaited<ReturnType<typeof reviseRelease>>;
    try { revised = await reviseRelease(base.release, change, { newId: options.newId }); }
    catch { return fail('invalid', MESSAGES.invalid); }
    if (!revised.ok && revised.reason === 'unknown_entry') return fail('not_found', '要修改的条目不在这本书里，可能书已在其他页面更新，请刷新。');
    if (!revised.ok) return { ...fail('invalid', revised.notices.map((n) => n.message).join(' ') || MESSAGES.invalid), notices: revised.notices };
    if (!revised.changed) return { ok: true, changed: false, release: base.release, book: base.book };
    const release = revised.release;
    const violation = releaseLimitViolation(release, this.limits);
    if (violation) return fail('too_large', violation);
    const hashed = await hashWithinLimit(release, this.limits.maxCanonicalChars);
    if (!hashed.ok) return hashed;
    const now = (options.now ?? Date.now)();
    try {
      return await transaction(this.database, [RELEASES, SUMMARIES, BOOKS], 'readwrite', async (tx) => {
        const releases = tx.objectStore(RELEASES), summaries = tx.objectStore(SUMMARIES), books = tx.objectStore(BOOKS);
        const rawBook = await request(books.get(bookId));
        if (rawBook === undefined) throw new LibraryAbort(fail('not_found', MESSAGES.not_found));
        const current = readBook(rawBook);
        if (current.latestVersionId !== options.baseVersionId)
          throw new LibraryAbort(fail('version_conflict', CONFLICT_MESSAGE));
        const old = (await request(summaries.index('bookId').getAll(bookId))).map(readSummary);
        const all = (await request(summaries.getAll())).map(readSummary);
        const total = all.reduce((sum, item) => sum + item.canonicalChars, 0) - old.reduce((sum, item) => sum + item.canonicalChars, 0);
        if (all.length - old.length + 1 > this.limits.maxVersions || total + hashed.chars > this.limits.maxTotalCanonicalChars)
          throw new LibraryAbort(fail('library_full', MESSAGES.library_full));
        for (const key of await request(releases.index('bookId').getAllKeys(bookId))) await request(releases.delete(key));
        for (const key of await request(summaries.index('bookId').getAllKeys(bookId))) await request(summaries.delete(key));
        const record: StoredRelease = { release, bookId, versionId: release.versionId, contentHash: release.contentHash, installedAt: now };
        await request(releases.add(record));
        await request(summaries.add(toSummary(release, now, hashed.chars)));
        const book: LibraryBook = { ...current, title: release.metadata.title, latestVersionId: release.versionId, versionCount: 1, updatedAt: now };
        await request(books.put(book));
        return { ok: true as const, changed: true, release, book };
      });
    } catch (error) { return failureOf(error); }
  }

  /**
   * 新建一本空白世界书（没有条目），不自动启用。
   * 书名与已有的书重复时自动编号（「新世界书 2」…）；空白书内容相同也是不同的书，不按重复内容合并。
   */
  async createBook(title: string, options: { now?: () => number; newId?: () => string } = {}): Promise<InstallResult> {
    const listed = await this.listBooks();
    if (!listed.ok) return listed;
    const taken = new Set(listed.books.map((book) => book.title));
    const base = Array.from(title.trim()).slice(0, 190).join('') || '新世界书';
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    const created = await createBlankRelease(name, { newId: options.newId });
    if (!created.ok) return fail('invalid', created.notices.map((n) => n.message).join(' ') || MESSAGES.invalid);
    return this.install(created.release, { now: options.now, allowDuplicateContent: true });
  }

  /** 删除一本书：在同一个事务里删掉它的全部版本、摘要、书目与启用状态。不存在时返回 not_found。 */
  async deleteBook(bookId: string, expected?: Pick<LibraryBook, 'latestVersionId' | 'installedAt' | 'updatedAt' | 'versionCount'>): Promise<{ ok: true } | LibraryFailure> {
    try {
      return await transaction(this.database, [RELEASES, SUMMARIES, BOOKS, ENABLED], 'readwrite', async (tx) => {
        const books = tx.objectStore(BOOKS);
        const raw = await request(books.get(bookId));
        if (raw === undefined) throw new LibraryAbort(fail('not_found', MESSAGES.not_found));
        const current = readBook(raw);
        if (expected && (current.latestVersionId !== expected.latestVersionId || current.installedAt !== expected.installedAt
          || current.updatedAt !== expected.updatedAt || current.versionCount !== expected.versionCount))
          throw new LibraryAbort(fail('version_conflict', CONFLICT_MESSAGE));
        const releases = tx.objectStore(RELEASES), summaries = tx.objectStore(SUMMARIES);
        for (const key of await request(releases.index('bookId').getAllKeys(bookId))) await request(releases.delete(key));
        for (const key of await request(summaries.index('bookId').getAllKeys(bookId))) await request(summaries.delete(key));
        await request(books.delete(bookId));
        await request(tx.objectStore(ENABLED).delete(bookId));
        return { ok: true as const };
      });
    } catch (error) { return failureOf(error); }
  }

  /** 书架：全部书目、各自最近版本的摘要与启用状态。排序同 listBooks。只读摘要，不读条目正文。 */
  async shelf(): Promise<{ ok: true; books: ShelfBook[] } | LibraryFailure> {
    try {
      const items = await transaction(this.database, [BOOKS, SUMMARIES, ENABLED], 'readonly', async (tx) => {
        const books = (await request(tx.objectStore(BOOKS).getAll())).map(readBook);
        const enabled = new Set((await request(tx.objectStore(ENABLED).getAllKeys())).map(String));
        const out: ShelfBook[] = [];
        for (const book of books) {
          const raw = await request(tx.objectStore(SUMMARIES).get([book.bookId, book.latestVersionId]));
          out.push({ book, latest: raw === undefined ? null : readSummary(raw), enabled: enabled.has(book.bookId) });
        }
        return out;
      });
      items.sort((a, b) => b.book.updatedAt - a.book.updatedAt || (a.book.bookId < b.book.bookId ? -1 : a.book.bookId > b.book.bookId ? 1 : 0));
      return { ok: true, books: items };
    } catch (error) { return failureOf(error); }
  }

  /**
   * 生成时使用：启用的书各自最近版本的引用（书 ID、版本 ID、内容哈希），按启用时间先后、相同时按书 ID。
   * 书目或摘要缺失的启用记录（不应出现）跳过，不报错。
   */
  async enabledBooks(): Promise<{ ok: true; books: EnabledBook[] } | LibraryFailure> {
    try {
      return await transaction(this.database, [BOOKS, SUMMARIES, ENABLED], 'readonly', async (tx) => {
        const records = (await request(tx.objectStore(ENABLED).getAll())) as EnabledRecord[];
        records.sort((a, b) => a.enabledAt - b.enabledAt || (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0));
        const books: EnabledBook[] = [];
        for (const record of records) {
          const rawBook = await request(tx.objectStore(BOOKS).get(record.bookId));
          if (rawBook === undefined) continue;
          const book = readBook(rawBook);
          const rawSummary = await request(tx.objectStore(SUMMARIES).get([book.bookId, book.latestVersionId]));
          if (rawSummary === undefined) continue;
          const summary = readSummary(rawSummary);
          books.push({ ref: { bookId: book.bookId, versionId: book.latestVersionId, contentHash: summary.contentHash }, title: book.title });
        }
        return { ok: true as const, books };
      });
    } catch (error) { return failureOf(error); }
  }
}
