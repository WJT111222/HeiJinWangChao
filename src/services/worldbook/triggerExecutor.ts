import { canonicalJson, sha256Hex } from '../../domain/worldbook/canonical';
import type { WorldbookRelease } from '../../domain/worldbook/schema';
import { runWorldbookTrigger, type TriggerResult } from '../../domain/worldbook/trigger';
import { checkTriggerRequest, engineSettings, TRIGGER_RESOURCE_LIMITS, type BookRef } from '../../domain/worldbook/triggerRequest';
import type { ReadResult } from './libraryReader';

/**
 * 触发执行器：Worker 内部运行的全部逻辑（也可在进程内直接测试）。
 *
 * - 每个请求独立：计时状态、种子、设置都随请求传入；执行器不保存任何跨请求的可变状态，
 *   只缓存不可变的版本内容。
 * - **缓存隔离**：缓存键是（书 ID、版本 ID、内容哈希）三者；版本内容按哈希复核过才进入缓存。
 *   同一书 ID 的不同版本、或同一版本 ID 但哈希不同的请求，互不复用。缓存按条目总数设上限，
 *   超出时淘汰最久未用的版本。Worker 被终止即整个缓存消失。
 * - **哈希校验策略**：每个版本在本执行器生命周期内首次载入时重新计算内容哈希，与请求中的
 *   哈希和库中记录都必须一致；不一致则本次暂停，绝不改用其他版本。
 */
export type TriggerReply =
  | { status: 'ok'; result: TriggerResult }
  | { status: 'paused'; reason: PauseReason; book?: BookRef; detail?: string }
  | { status: 'failed'; reason: 'invalid_request' | 'internal'; detail?: string };
export type PauseReason =
  | 'too_large' // 请求超过资源上限
  | 'missing_version' // 书库里没有这个版本
  | 'hash_mismatch' // 内容哈希与请求或记录不符
  | 'library_unavailable' // 书库打不开
  | 'library_missing' // 书库还不存在
  | 'library_version_unsupported' // 书库结构版本是读取器不认识的
  | 'library_record_invalid' // 库内记录损坏
  | 'worker_unavailable' // 无法创建 Worker，且规模超过主线程降级上限
  | 'fallback_too_large'; // 同上（由主线程端判定）

export type ReleaseLoader = (ref: BookRef) => Promise<ReadResult>;

export const EXECUTOR_CACHE_MAX_ENTRIES = 200_000;

async function verifiedHash(release: WorldbookRelease): Promise<string | null> {
  try { return await sha256Hex(canonicalJson({ metadata: release.metadata, entries: release.entries, source: release.source })); }
  catch { return null; }
}
const cacheKey = (ref: BookRef) => `${ref.bookId}\u0000${ref.versionId}\u0000${ref.contentHash}`;

export class TriggerExecutor {
  private readonly cache = new Map<string, WorldbookRelease>();
  private cachedEntries = 0;
  constructor(private readonly load: ReleaseLoader, private readonly cacheMaxEntries = EXECUTOR_CACHE_MAX_ENTRIES) {}

  /** 当前缓存的版本（只用于测试与诊断）。 */
  cachedKeys(): string[] { return [...this.cache.keys()]; }

  private remember(key: string, release: WorldbookRelease) {
    this.cache.set(key, release);
    this.cachedEntries += release.entries.length;
    for (const [oldKey, old] of this.cache) {
      if (this.cachedEntries <= this.cacheMaxEntries || oldKey === key) break;
      this.cache.delete(oldKey);
      this.cachedEntries -= old.entries.length;
    }
  }

  private async resolve(ref: BookRef): Promise<{ ok: true; release: WorldbookRelease } | Extract<TriggerReply, { status: 'paused' }>> {
    const key = cacheKey(ref);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached); // 最近使用
      return { ok: true, release: cached };
    }
    const read = await this.load(ref);
    if (!read.ok) {
      const reason: PauseReason = read.reason === 'missing_library' ? 'library_missing' : read.reason === 'unsupported_version' ? 'library_version_unsupported'
        : read.reason === 'invalid' ? 'library_record_invalid' : 'library_unavailable';
      return { status: 'paused', reason, book: ref };
    }
    if (!read.release) return { status: 'paused', reason: 'missing_version', book: ref };
    const release = read.release;
    if (release.contentHash !== ref.contentHash) return { status: 'paused', reason: 'hash_mismatch', book: ref, detail: '书库中的版本与请求的内容哈希不同' };
    if (await verifiedHash(release) !== ref.contentHash) return { status: 'paused', reason: 'hash_mismatch', book: ref, detail: '版本内容与内容哈希不符' };
    this.remember(key, release);
    return { ok: true, release };
  }

  async execute(raw: unknown): Promise<TriggerReply> {
    const check = checkTriggerRequest(raw);
    if (!check.ok) return check.reason === 'too_large'
      ? { status: 'paused', reason: 'too_large', detail: check.detail }
      : { status: 'failed', reason: 'invalid_request', detail: check.detail };
    const releases: WorldbookRelease[] = [];
    let entries = 0;
    for (const ref of check.request.books) {
      const resolved = await this.resolve(ref);
      if (!('ok' in resolved)) return resolved;
      entries += resolved.release.entries.length;
      if (entries > TRIGGER_RESOURCE_LIMITS.maxTotalEntries) return { status: 'paused', reason: 'too_large', detail: 'entries' };
      releases.push(resolved.release);
    }
    const request = check.request;
    try {
      const result = runWorldbookTrigger({
        books: releases.map((release, i) => ({ bookId: release.bookId, versionId: release.versionId,
          entries: request.books[i].keywordsOnly ? release.entries.filter(entry => !entry.constant) : release.entries })),
        messages: request.messages, contextTokens: request.contextTokens, storyRemainingTokens: request.storyRemainingTokens,
        trigger: request.trigger, messageCount: request.messageCount, timedState: request.timedState, seed: request.seed,
        settings: engineSettings(check),
      });
      return { status: 'ok', result };
    } catch {
      return { status: 'failed', reason: 'internal' };
    }
  }
}
