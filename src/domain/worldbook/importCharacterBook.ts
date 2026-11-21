import { assignEntryIds, readSillyTavernEntry } from './entryFields';
import { notice, NoticeCollector } from './notices';
import { finishImport, optionalDescription, pickTitle, type ImportOptions } from './release';
import { WORLDBOOK_LIMITS, isPlainObject, type WorldbookEntry, type WorldbookImportResult } from './schema';

/**
 * 角色卡 V2 的 character_book → 王朝版本。
 * 字段换算与参照版本导入角色卡世界书时的规则一致（见 docs/WORLDBOOK_COMPATIBILITY.md「角色卡 V2」），
 * 先换算成酒馆条目形状，再走同一套字段校验。只保存 character_book 本身；角色卡其余内容不导入。
 */
const SPEC_ENTRY_FIELDS = new Set(['keys', 'content', 'extensions', 'enabled', 'insertion_order', 'case_sensitive',
  'name', 'priority', 'id', 'comment', 'selective', 'secondary_keys', 'constant', 'position']);
const SPEC_UNUSED_ENTRY_FIELDS = ['case_sensitive', 'name', 'priority'];
const BOOK_UNUSED_FIELDS = ['scan_depth', 'token_budget', 'recursive_scanning'];

/** 角色卡条目 → 酒馆形状条目。`??` 与 `||` 的区别是有意保留的：与参照版本的取值方式一致。 */
export function characterEntryToSillyTavern(entry: Record<string, unknown>, index: number): Record<string, unknown> {
  const ext = isPlainObject(entry.extensions) ? entry.extensions : {};
  return {
    uid: entry.id ?? index,
    key: entry.keys,
    keysecondary: entry.secondary_keys || [],
    comment: entry.comment || '',
    content: entry.content,
    constant: entry.constant || false,
    selective: entry.selective || false,
    order: entry.insertion_order,
    position: ext.position ?? (entry.position === 'before_char' ? 0 : 1),
    excludeRecursion: ext.exclude_recursion ?? false,
    preventRecursion: ext.prevent_recursion ?? false,
    delayUntilRecursion: ext.delay_until_recursion ?? false,
    disable: !entry.enabled,
    addMemo: !!entry.comment,
    displayIndex: ext.display_index ?? index,
    probability: ext.probability ?? 100,
    useProbability: ext.useProbability ?? true,
    depth: ext.depth ?? 4,
    selectiveLogic: ext.selectiveLogic ?? 0,
    outletName: ext.outlet_name ?? '',
    group: ext.group ?? '',
    groupOverride: ext.group_override ?? false,
    groupWeight: ext.group_weight ?? 100,
    scanDepth: ext.scan_depth ?? null,
    caseSensitive: ext.case_sensitive ?? null,
    matchWholeWords: ext.match_whole_words ?? null,
    useGroupScoring: ext.use_group_scoring ?? null,
    automationId: ext.automation_id ?? '',
    role: ext.role ?? 0,
    vectorized: ext.vectorized ?? false,
    sticky: ext.sticky ?? null,
    cooldown: ext.cooldown ?? null,
    delay: ext.delay ?? null,
    matchPersonaDescription: ext.match_persona_description ?? false,
    matchCharacterDescription: ext.match_character_description ?? false,
    matchCharacterPersonality: ext.match_character_personality ?? false,
    matchCharacterDepthPrompt: ext.match_character_depth_prompt ?? false,
    matchScenario: ext.match_scenario ?? false,
    matchCreatorNotes: ext.match_creator_notes ?? false,
    extensions: entry.extensions ?? {},
    triggers: ext.triggers || [],
    ignoreBudget: ext.ignore_budget ?? false,
  };
}

export function importCharacterBook(root: Record<string, unknown>, options: ImportOptions = {}): Promise<WorldbookImportResult> {
  const notices = new NoticeCollector();
  const card = isPlainObject(root.data) && root.data.character_book !== undefined ? root.data : undefined;
  const book = card ? card.character_book : root;
  if (!isPlainObject(book) || !Array.isArray(book.entries)) {
    notices.add(notice('entries_invalid', { field: 'character_book.entries' }));
    return Promise.resolve({ ok: false, notices: notices.finish() });
  }
  if (card) notices.add(notice('card_content_skipped'));
  const rawEntries = book.entries as unknown[];
  if (rawEntries.length > WORLDBOOK_LIMITS.maxEntries) {
    notices.add(notice('too_many_entries', {}, { value: rawEntries.length, limit: WORLDBOOK_LIMITS.maxEntries }));
    return Promise.resolve({ ok: false, notices: notices.finish() });
  }
  const bookUnused = BOOK_UNUSED_FIELDS.filter((key) => book[key] !== undefined);
  if (bookUnused.length) notices.add(notice('book_setting_unused', {}, { value: bookUnused.join('、') }));

  const ids = assignEntryIds(rawEntries.map((raw, index) => ({
    sourceKey: String(index), uid: isPlainObject(raw) ? raw.id ?? index : index,
  })), notices);
  const entries: WorldbookEntry[] = [];
  const unknown = new Set<string>(), unused = new Set<string>();
  rawEntries.forEach((raw, index) => {
    const sourceKey = String(index);
    if (!isPlainObject(raw)) { notices.add(notice('entry_not_object', { entryRef: sourceKey })); return; }
    if (!Array.isArray(raw.keys)) notices.add(notice('missing_required', { entryRef: sourceKey, field: 'keys' }, { value: '没有关键词' }));
    if (raw.content === undefined) notices.add(notice('missing_required', { entryRef: sourceKey, field: 'content' }, { value: '空正文' }));
    if (raw.enabled === undefined) notices.add(notice('missing_required', { entryRef: sourceKey, field: 'enabled' }, { value: '停用' }));
    if (raw.insertion_order === undefined) notices.add(notice('missing_required', { entryRef: sourceKey, field: 'insertion_order' }, { value: '100' }));
    for (const key of Object.keys(raw)) {
      if (!SPEC_ENTRY_FIELDS.has(key)) unknown.add(key);
      else if (SPEC_UNUSED_ENTRY_FIELDS.includes(key)) unused.add(key);
    }
    const entry = readSillyTavernEntry(characterEntryToSillyTavern(raw, index), { entryId: ids[index], sourceKey, notices });
    if (entry) entries.push(entry);
  });
  if (unused.size) notices.add(notice('entry_field_unused', {}, { value: [...unused].join('、') }));
  if (unknown.size) notices.add(notice('unknown_fields_preserved', {}, { value: [...unknown].slice(0, 30).join('、') }));

  return finishImport({
    entries,
    metadata: { title: pickTitle(options, book.name, card?.name), ...optionalDescription(book.description) },
    format: 'character-card-v2',
    payload: book,
    notices,
    options,
  });
}
