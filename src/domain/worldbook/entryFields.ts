import { canonicalJson } from './canonical';
import { notice, type NoticeCollector } from './notices';
import { classifyKey, regexRisk, MAX_REGEX_SOURCE_CHARS } from './regexKey';
import { ENTRY_POSITIONS, GENERATION_TRIGGERS, WORLDBOOK_LIMITS, isPlainObject, type WorldbookEntry } from './schema';

/**
 * 酒馆世界书条目字段 ↔ 王朝规范化字段的对照表与读写。
 * 字段名、取值和默认值是文件格式互通所需的事实，来源见 docs/WORLDBOOK_COMPATIBILITY.md；
 * 读写逻辑为王朝独立实现。
 */
type Kind = 'string' | 'boolean' | 'number' | 'int' | 'number?' | 'boolean?' | 'strings' | 'numberOrBoolean';
type MainKey = Exclude<keyof WorldbookEntry, 'entryId' | 'sourceUid' | 'sourceKey' | 'inert' | 'extensions'>;

/** [酒馆字段, 王朝字段, 类型, 参照版本默认值] */
export const MAIN_FIELDS: ReadonlyArray<readonly [string, MainKey, Kind, unknown]> = [
  ['key', 'keys', 'strings', []],
  ['keysecondary', 'secondaryKeys', 'strings', []],
  ['comment', 'comment', 'string', ''],
  ['content', 'content', 'string', ''],
  ['constant', 'constant', 'boolean', false],
  ['selective', 'selective', 'boolean', true],
  ['selectiveLogic', 'selectiveLogic', 'int', 0],
  ['order', 'order', 'number', 100],
  ['position', 'position', 'int', 0],
  ['disable', 'disabled', 'boolean', false],
  ['ignoreBudget', 'ignoreBudget', 'boolean', false],
  ['excludeRecursion', 'excludeRecursion', 'boolean', false],
  ['preventRecursion', 'preventRecursion', 'boolean', false],
  ['delayUntilRecursion', 'delayUntilRecursion', 'numberOrBoolean', 0],
  ['probability', 'probability', 'number', 100],
  ['useProbability', 'useProbability', 'boolean', true],
  ['depth', 'depth', 'number', 4],
  ['outletName', 'outletName', 'string', ''],
  ['group', 'group', 'string', ''],
  ['groupOverride', 'groupOverride', 'boolean', false],
  ['groupWeight', 'groupWeight', 'number', 100],
  ['scanDepth', 'scanDepth', 'number?', null],
  ['caseSensitive', 'caseSensitive', 'boolean?', null],
  ['matchWholeWords', 'matchWholeWords', 'boolean?', null],
  ['useGroupScoring', 'useGroupScoring', 'boolean?', null],
  ['role', 'role', 'int', 0],
  ['sticky', 'sticky', 'number?', null],
  ['cooldown', 'cooldown', 'number?', null],
  ['delay', 'delay', 'number?', null],
  ['triggers', 'triggers', 'strings', []],
];

/** 保留但不参与王朝触发的字段（只在原文件出现时保存）。 */
export const MATCH_SOURCE_FIELDS = ['matchPersonaDescription', 'matchCharacterDescription', 'matchCharacterPersonality',
  'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes'] as const;
export const INERT_FIELDS = ['vectorized', 'addMemo', ...MATCH_SOURCE_FIELDS, 'automationId', 'characterFilter', 'displayIndex'] as const;

const KNOWN_FIELDS = new Set<string>(['uid', 'extensions', ...MAIN_FIELDS.map(([st]) => st), ...INERT_FIELDS]);
export function unknownFieldsOf(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((key) => !KNOWN_FIELDS.has(key));
}

const kindLabel: Record<Kind, string> = {
  string: '文本', boolean: '真/假', number: '数字', int: '整数', 'number?': '数字或空',
  'boolean?': '真/假或空', strings: '文本数组', numberOrBoolean: '数字或真/假',
};
const POSITION_NAMES: Record<number, string> = {
  [ENTRY_POSITIONS.authorNoteTop]: '作者注释上方', [ENTRY_POSITIONS.authorNoteBottom]: '作者注释下方',
  [ENTRY_POSITIONS.atDepth]: '聊天记录指定深度', [ENTRY_POSITIONS.exampleTop]: '示例消息上方',
  [ENTRY_POSITIONS.exampleBottom]: '示例消息下方', [ENTRY_POSITIONS.outlet]: 'Outlet',
};

type Read = { ok: true; value: unknown } | { ok: false };

/**
 * 读一个字段。缺失或 null 时取默认值；数字字段接受数字字符串（参照版本里它们按数字参与比较），
 * 真/假字段接受 0 / 1（参照版本按真假值判断）。其余类型不符一律报错，不猜。
 */
function readField(raw: Record<string, unknown>, key: string, kind: Kind, fallback: unknown,
  where: { entryRef: string; field: string }, notices: NoticeCollector): Read {
  const value = raw[key];
  if (value === undefined || value === null) return { ok: true, value: fallback };
  const fail = (): Read => { notices.add(notice('field_type', where, { value: kindLabel[kind] })); return { ok: false }; };
  const coerced = (to: unknown): Read => {
    notices.add(notice('value_coerced', where, { value: JSON.stringify(value), limit: JSON.stringify(to) }));
    return { ok: true, value: to };
  };
  switch (kind) {
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : fail();
    case 'boolean':
    case 'boolean?':
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 0 || value === 1) return coerced(value === 1);
      return fail();
    case 'number':
    case 'number?':
    case 'int': {
      let number: number | undefined;
      if (typeof value === 'number' && Number.isFinite(value)) number = value;
      else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) number = Number(value);
      if (number === undefined || kind === 'int' && !Number.isInteger(number)) return fail();
      return typeof value === 'string' ? coerced(number) : { ok: true, value: number };
    }
    case 'numberOrBoolean':
      if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
      return fail();
    case 'strings':
      return Array.isArray(value) && value.every((item) => typeof item === 'string') ? { ok: true, value: [...value] } : fail();
  }
}

function checkKeys(keys: readonly string[], entryRef: string, field: string, notices: NoticeCollector) {
  if (keys.length > WORLDBOOK_LIMITS.maxKeysPerEntry) notices.add(notice('too_many_keys', { entryRef, field }, { limit: WORLDBOOK_LIMITS.maxKeysPerEntry }));
  for (const key of keys) {
    if (key.length > WORLDBOOK_LIMITS.maxKeyChars) { notices.add(notice('key_too_long', { entryRef, field }, { limit: WORLDBOOK_LIMITS.maxKeyChars })); continue; }
    if (key.length > 0 && key.trim() === '') notices.add(notice('blank_key', { entryRef, field }));
    const kind = classifyKey(key);
    if (kind.kind === 'invalid-regex') notices.add(notice('regex_invalid', { entryRef, field }, { value: key }));
    if (kind.kind === 'regex') {
      const risk = regexRisk(kind.source);
      if (risk === 'too-long') notices.add(notice('regex_too_long', { entryRef, field }, { limit: MAX_REGEX_SOURCE_CHARS }));
      if (risk === 'risky') notices.add(notice('regex_risky', { entryRef, field }, { value: key }));
      if (/[gy]/.test(kind.flags)) notices.add(notice('regex_stateful_flag', { entryRef, field }, { value: key }));
    }
  }
}

export interface EntryContext { entryId: string; sourceKey: string; notices: NoticeCollector }

/** 酒馆形状的条目对象 → 规范化条目。有任何字段错误时返回 null（错误已记入 notices）。 */
export function readSillyTavernEntry(raw: unknown, ctx: EntryContext): WorldbookEntry | null {
  const entryRef = ctx.sourceKey;
  if (!isPlainObject(raw)) { ctx.notices.add(notice('entry_not_object', { entryRef })); return null; }
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const [stKey, key, kind, fallback] of MAIN_FIELDS) {
    const read = readField(raw, stKey, kind, fallback, { entryRef, field: stKey }, ctx.notices);
    if (read.ok) out[key] = read.value; else ok = false;
  }
  let extensions: Record<string, unknown> = {};
  if (raw.extensions !== undefined && raw.extensions !== null) {
    if (isPlainObject(raw.extensions)) extensions = raw.extensions;
    else { ctx.notices.add(notice('field_type', { entryRef, field: 'extensions' }, { value: '对象' })); ok = false; }
  }
  const uid = raw.uid;
  if (uid !== undefined && uid !== null && typeof uid !== 'string' && !(typeof uid === 'number' && Number.isFinite(uid))) {
    ctx.notices.add(notice('field_type', { entryRef, field: 'uid' }, { value: '数字或文本' })); ok = false;
  }
  if (!ok) return null;

  const inert: Record<string, unknown> = {};
  for (const key of INERT_FIELDS) if (Object.hasOwn(raw, key)) inert[key] = raw[key];

  const entry = {
    entryId: ctx.entryId,
    sourceUid: uid === undefined || uid === null ? null : uid as number | string,
    sourceKey: ctx.sourceKey,
    ...out,
    inert,
    extensions,
  } as WorldbookEntry;
  checkEntry(entry, ctx.notices);
  return entry;
}

/** 条目级的长度限制与兼容提示。 */
export function checkEntry(entry: WorldbookEntry, notices: NoticeCollector) {
  const entryRef = entry.sourceKey ?? entry.entryId;
  if (Array.from(entry.content).length > WORLDBOOK_LIMITS.maxContentChars)
    notices.add(notice('content_too_long', { entryRef, field: 'content' }, { limit: WORLDBOOK_LIMITS.maxContentChars }));
  checkKeys(entry.keys, entryRef, 'key', notices);
  checkKeys(entry.secondaryKeys, entryRef, 'keysecondary', notices);
  if (!entry.constant && !entry.disabled && entry.keys.length === 0) notices.add(notice('never_triggers', { entryRef }));
  if (![0, 1, 2, 3].includes(entry.selectiveLogic)) notices.add(notice('unknown_logic', { entryRef, field: 'selectiveLogic' }, { value: entry.selectiveLogic }));
  if (entry.position < 0 || entry.position > 7) notices.add(notice('unknown_position', { entryRef, field: 'position' }, { value: entry.position }));
  else if (POSITION_NAMES[entry.position]) notices.add(notice('position_unmapped', { entryRef, field: 'position' }, { value: POSITION_NAMES[entry.position] }));
  for (const trigger of entry.triggers) {
    if (!(GENERATION_TRIGGERS as readonly string[]).includes(trigger) || ['impersonate', 'swipe', 'quiet'].includes(trigger))
      notices.add(notice('trigger_unmapped', { entryRef, field: 'triggers' }, { value: trigger }));
  }
  const filter = entry.inert.characterFilter;
  if (isPlainObject(filter) && (nonEmptyArray(filter.names) || nonEmptyArray(filter.tags)))
    notices.add(notice('character_filter_inert', { entryRef, field: 'characterFilter' }));
  const matched = MATCH_SOURCE_FIELDS.filter((key) => entry.inert[key] === true);
  if (matched.length) notices.add(notice('match_source_inert', { entryRef }, { value: matched.join('、') }));
  if (entry.inert.vectorized === true) notices.add(notice('vectorized_inert', { entryRef, field: 'vectorized' }));
  if (typeof entry.inert.automationId === 'string' && entry.inert.automationId !== '') notices.add(notice('automation_ignored', { entryRef, field: 'automationId' }));
  if ([entry.content, ...entry.keys, ...entry.secondaryKeys].some((text) => text.includes('{{')))
    notices.add(notice('macro_preserved', { entryRef }));
}
function nonEmptyArray(value: unknown) { return Array.isArray(value) && value.length > 0; }

/**
 * 规范化条目 → 酒馆形状的条目对象。
 * 有原始条目时以它为底：只覆盖原来就有的字段和与默认值不同的字段，未知字段原样带回；
 * 没有原始条目时写出完整字段。
 */
export function writeSillyTavernEntry(entry: WorldbookEntry, raw: Record<string, unknown> | undefined, uid: number | string): Record<string, unknown> {
  const out: Record<string, unknown> = raw ? { ...raw } : {};
  const has = (key: string) => raw !== undefined && Object.hasOwn(raw, key);
  if (!raw || has('uid')) out.uid = entry.sourceUid ?? uid;
  for (const [stKey, key, , fallback] of MAIN_FIELDS) {
    const value = entry[key];
    if (!raw || has(stKey) || canonicalJson(value) !== canonicalJson(fallback)) out[stKey] = Array.isArray(value) ? [...value] : value;
  }
  for (const key of INERT_FIELDS) if (Object.hasOwn(entry.inert, key)) out[key] = entry.inert[key];
  if (has('extensions') || Object.keys(entry.extensions).length > 0) out.extensions = entry.extensions;
  return out;
}

/** 为一组条目分配书内唯一的 entryId；重复或缺失的原 ID 记提示。 */
export function assignEntryIds(items: ReadonlyArray<{ sourceKey: string; uid: unknown }>, notices: NoticeCollector): string[] {
  const used = new Set<string>();
  const unique = (base: string) => {
    let id = base, n = 2;
    while (used.has(id)) id = `${base}~${n++}`;
    used.add(id);
    return id;
  };
  return items.map(({ sourceKey, uid }) => {
    const usable = typeof uid === 'number' && Number.isFinite(uid) || typeof uid === 'string' && uid.trim() !== '';
    if (!usable) return unique(`k${sourceKey}`);
    const base = String(uid).slice(0, 180);
    const id = unique(base);
    if (id !== base) notices.add(notice('duplicate_uid', { entryRef: sourceKey, field: 'uid' }, { value: base, limit: id }));
    return id;
  });
}
