import { contentHash } from './canonical';
import { checkEntry } from './entryFields';
import { notice, NoticeCollector } from './notices';
import { WORLDBOOK_LIMITS, WorldbookFileSchema, type WorldbookImportResult, type WorldbookRelease } from './schema';

/**
 * 王朝世界书格式：保留文件里的书 ID、版本 ID 和内容，重算哈希核对；
 * 来源一律改为 local，兼容提示按条目重新生成，不信任文件自带的这两项。
 */
export async function importNative(root: Record<string, unknown>): Promise<WorldbookImportResult> {
  const notices = new NoticeCollector();
  if (Array.isArray(root.entries) && root.entries.length > WORLDBOOK_LIMITS.maxEntries) {
    notices.add(notice('too_many_entries', {}, { value: root.entries.length, limit: WORLDBOOK_LIMITS.maxEntries }));
    return { ok: false, notices: notices.finish() };
  }
  const parsed = WorldbookFileSchema.safeParse(root);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    notices.add(notice('native_invalid', {}, { value: `${issue?.path.join('.') || '根'}：${issue?.message ?? '未知错误'}` }));
    return { ok: false, notices: notices.finish() };
  }
  // 哈希按文件原始对象计算，不用 zod 复制出的对象。
  const file = root as unknown as WorldbookRelease;
  const ids = new Set<string>();
  for (const entry of file.entries) {
    if (ids.has(entry.entryId)) notices.add(notice('duplicate_entry_id', { entryRef: entry.entryId }, { value: entry.entryId }));
    ids.add(entry.entryId);
  }
  let actual: string;
  try {
    actual = await contentHash({ metadata: file.metadata, entries: file.entries, source: file.source });
  } catch {
    notices.add(notice('hash_failed'));
    return { ok: false, notices: notices.finish() };
  }
  if (actual !== file.contentHash) notices.add(notice('hash_mismatch'));
  if (notices.hasErrors) return { ok: false, notices: notices.finish() };

  if (file.origin !== 'local') notices.add(notice('origin_ignored', {}, { value: file.origin }));
  for (const entry of file.entries) checkEntry(entry, notices);
  if (notices.hasErrors) return { ok: false, notices: notices.finish() };
  const all = notices.finish();
  return {
    ok: true,
    notices: all,
    release: {
      formatVersion: file.formatVersion,
      bookId: file.bookId,
      versionId: file.versionId,
      versionLabel: file.versionLabel,
      contentHash: actual,
      origin: 'local',
      metadata: file.metadata,
      entries: file.entries,
      source: file.source,
      compatibility: all.filter((item) => item.level !== 'error'),
    },
  };
}
