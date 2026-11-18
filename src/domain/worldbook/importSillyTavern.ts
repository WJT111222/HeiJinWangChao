import { assignEntryIds, readSillyTavernEntry, unknownFieldsOf } from './entryFields';
import { notice, NoticeCollector } from './notices';
import { finishImport, optionalDescription, pickTitle, type ImportOptions } from './release';
import { WORLDBOOK_LIMITS, isPlainObject, type WorldbookEntry, type WorldbookImportResult } from './schema';

/**
 * 酒馆世界书文件 → 王朝版本。entries 可以是以 uid 为键的对象，也可以是数组。
 * 原文件整体保存在 source.payload，导出时据此无损还原。
 */
export function importSillyTavern(root: Record<string, unknown>, options: ImportOptions = {}): Promise<WorldbookImportResult> {
  const notices = new NoticeCollector();
  const container = root.entries;
  const isArray = Array.isArray(container);
  if (!isArray && !isPlainObject(container)) {
    notices.add(notice('entries_invalid', { field: 'entries' }));
    return Promise.resolve({ ok: false, notices: notices.finish() });
  }
  const items = isArray
    ? (container as unknown[]).map((raw, index) => ({ sourceKey: String(index), raw }))
    : Object.keys(container).map((key) => ({ sourceKey: key, raw: (container as Record<string, unknown>)[key] }));
  if (items.length > WORLDBOOK_LIMITS.maxEntries) {
    notices.add(notice('too_many_entries', {}, { value: items.length, limit: WORLDBOOK_LIMITS.maxEntries }));
    return Promise.resolve({ ok: false, notices: notices.finish() });
  }

  // 对象形式缺 uid 时以键作为身份（参照版本里键与 uid 本应一致）。
  const ids = assignEntryIds(items.map(({ sourceKey, raw }) => ({
    sourceKey, uid: isPlainObject(raw) && raw.uid !== undefined && raw.uid !== null ? raw.uid : isArray ? undefined : sourceKey,
  })), notices);
  const entries: WorldbookEntry[] = [];
  const unknown = new Set<string>();
  items.forEach(({ sourceKey, raw }, index) => {
    const entry = readSillyTavernEntry(raw, { entryId: ids[index], sourceKey, notices });
    if (entry) entries.push(entry);
    if (isPlainObject(raw)) for (const key of unknownFieldsOf(raw)) unknown.add(key);
  });
  if (unknown.size) notices.add(notice('unknown_fields_preserved', {}, { value: [...unknown].slice(0, 30).join('、') }));

  return finishImport({
    entries,
    metadata: { title: pickTitle(options, root.name), ...optionalDescription(root.description) },
    format: 'sillytavern',
    payload: root,
    notices,
    options,
  });
}
