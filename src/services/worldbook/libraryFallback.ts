import type { WorldbookLibrary } from '../storage/worldbookLibrary';
import type { MainThreadFallback } from './triggerHost';

/** 把本地书库接成主线程降级的数据源：规模判断只读摘要，通过后才读取版本内容。 */
export function libraryFallback(library: WorldbookLibrary): MainThreadFallback {
  return {
    async size(ref) {
      const got = await library.getSummary(ref.bookId, ref.versionId);
      if (!got.ok || !got.summary || got.summary.contentHash !== ref.contentHash) return null;
      return { entryCount: got.summary.entryCount, keyChars: got.summary.keyChars, contentChars: got.summary.contentChars };
    },
    async load(ref) {
      const got = await library.getRelease(ref.bookId, ref.versionId);
      if (got.ok) return { ok: true, release: got.release };
      return { ok: false, reason: got.code === 'invalid' || got.code === 'hash_mismatch' ? 'invalid' : 'unavailable' };
    },
  };
}
