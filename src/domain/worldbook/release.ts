import { contentHash } from './canonical';
import { blankEntry, checkEntry } from './entryFields';
import { notice, NoticeCollector } from './notices';
import {
  WORLDBOOK_FORMAT_VERSION, WORLDBOOK_LIMITS, WorldbookMetadataSchema, WorldbookReleaseSchema,
  type ImportNotice, type WorldbookEntry, type WorldbookImportResult, type WorldbookMetadata, type WorldbookRelease,
} from './schema';

export interface ImportOptions {
  /** 玩家指定的书名，优先于文件内的名字。 */
  title?: string;
  /** 原文件名，用于在文件没有书名时生成书名。 */
  fileName?: string;
  /** 生成书 ID / 版本 ID；测试可注入固定值。 */
  newId?: () => string;
}

export const DEFAULT_TITLE = '未命名世界书';

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? Array.from(text).slice(0, 200).join('') : undefined;
}
function fileStem(fileName: string | undefined) {
  return fileName?.replace(/^.*[\\/]/, '').replace(/\.(json|txt)$/i, '');
}
/** 书名优先级：玩家指定 → 文件内候选（按传入顺序）→ 文件名 → 默认。 */
export function pickTitle(options: ImportOptions, ...candidates: unknown[]): string {
  for (const value of [options.title, ...candidates, fileStem(options.fileName)]) {
    const title = cleanTitle(value);
    if (title) return title;
  }
  return DEFAULT_TITLE;
}
export function optionalDescription(value: unknown): Pick<WorldbookMetadata, 'description'> {
  return typeof value === 'string' && value.trim() ? { description: value.slice(0, 20_000) } : {};
}

export interface FinishInput {
  entries: WorldbookEntry[];
  metadata: WorldbookMetadata;
  format: WorldbookRelease['source']['format'];
  payload: unknown;
  notices: NoticeCollector;
  options: ImportOptions;
  /** 王朝格式文件自带的身份；其他格式每次导入都新生成。 */
  identity?: Pick<WorldbookRelease, 'bookId' | 'versionId' | 'versionLabel'>;
}

/** 汇总为一个不可变版本：有任何 error 时不产生版本；来源一律标为 local。 */
export async function finishImport(input: FinishInput): Promise<WorldbookImportResult> {
  const { notices } = input;
  const metadata = WorldbookMetadataSchema.safeParse(input.metadata);
  if (!metadata.success) notices.add(notice('metadata_invalid', {}, { value: metadata.error.issues[0]?.message ?? '未知错误' }));
  if (notices.hasErrors || !metadata.success) return { ok: false, notices: notices.finish() };

  const newId = input.options.newId ?? (() => crypto.randomUUID());
  const source = { format: input.format, payload: input.payload };
  let hash: string;
  try {
    hash = await contentHash({ metadata: metadata.data, entries: input.entries, source });
  } catch {
    return { ok: false, notices: [...notices.finish(), notice('hash_failed')] };
  }
  const all = notices.finish();
  const candidate: WorldbookRelease = {
    formatVersion: WORLDBOOK_FORMAT_VERSION,
    bookId: input.identity?.bookId ?? newId(),
    versionId: input.identity?.versionId ?? newId(),
    versionLabel: input.identity?.versionLabel ?? '1.0',
    contentHash: hash,
    origin: 'local',
    metadata: metadata.data,
    entries: input.entries,
    source,
    compatibility: all.filter((item) => item.level !== 'error'),
  };
  const checked = WorldbookReleaseSchema.safeParse(candidate);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, notices: [...all, notice('release_invalid', {}, { value: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() })] };
  }
  // 以 candidate 为准：校验通过即可，避免 zod 复制对象后影响哈希覆盖的数据。
  return { ok: true, release: candidate, notices: all };
}

/** 玩家在王朝里对单个条目的修改。省略的字段不变。 */
export interface EntryEdit {
  disabled?: boolean;
  /** true = 常驻；false = 关键词唤醒。 */
  constant?: boolean;
  /** 条目标题（酒馆里的 comment / 备注）。 */
  comment?: string;
  content?: string;
  keys?: string[];
  secondaryKeys?: string[];
  selectiveLogic?: number;
  order?: number;
}
/** 对一本书的一次修改：书名、改条目、新增条目（追加在末尾）、删除条目。 */
export interface BookChange {
  purpose?: 'ordinary' | 'main';
  title?: string;
  entries?: Readonly<Record<string, EntryEdit>>;
  add?: ReadonlyArray<{ entryId: string } & EntryEdit>;
  remove?: readonly string[];
}
export type ReviseResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; release: WorldbookRelease }
  | { ok: false; reason: 'unknown_entry'; entryId: string }
  | { ok: false; reason: 'invalid'; notices: ImportNotice[] };

/** 关键词整理：去掉首尾空白与空项，按出现顺序去重。 */
export function cleanKeys(keys: readonly string[]): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of keys) { const key = raw.trim(); if (key && !seen.has(key)) { seen.add(key); out.push(key); } }
  return out;
}

/** 把修改应用到条目上（界面显示与保存用同一套规则）。 */
export function applyEntryEdit(entry: WorldbookEntry, edit: EntryEdit | undefined): WorldbookEntry {
  if (!edit) return entry;
  const next: WorldbookEntry = { ...entry };
  if (edit.disabled !== undefined) next.disabled = edit.disabled;
  if (edit.constant !== undefined) next.constant = edit.constant;
  if (edit.comment !== undefined) next.comment = edit.comment;
  if (edit.content !== undefined) next.content = edit.content;
  if (edit.keys !== undefined) next.keys = cleanKeys(edit.keys);
  if (edit.secondaryKeys !== undefined) {
    next.secondaryKeys = cleanKeys(edit.secondaryKeys);
    // 酒馆用 selective 表示「启用副关键词」；填了副关键词就打开。
    if (next.secondaryKeys.length > 0) next.selective = true;
  }
  if (edit.selectiveLogic !== undefined) next.selectiveLogic = edit.selectiveLogic;
  if (edit.order !== undefined) next.order = edit.order;
  return next;
}

const sameEntry = (a: WorldbookEntry, b: WorldbookEntry) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 基于一个版本生成修改后的新版本（版本不可变，修改即新版本）：
 * - 改条目只动 EntryEdit 里的字段；条目的其他字段、未知字段、书级信息与原始来源原样保留，导出酒馆格式时体现修改；
 * - 新增的条目用酒馆默认值；删除的条目从版本里去掉；书名改 metadata.title；
 * - 改过和新增的条目按导入时同样的规则检查（正文、关键词长度与数量、正则关键词安全），有错误时不生成版本；
 * - 重新计算内容哈希；书 ID 不变，版本 ID 新生成；没有实际变化时不生成新版本。
 */
export async function reviseRelease(release: WorldbookRelease, change: BookChange, options: Pick<ImportOptions, 'newId'> = {}): Promise<ReviseResult> {
  const known = new Set(release.entries.map((entry) => entry.entryId));
  const remove = new Set(change.remove ?? []);
  for (const entryId of [...Object.keys(change.entries ?? {}), ...remove]) if (!known.has(entryId)) return { ok: false, reason: 'unknown_entry', entryId };
  const notices = new NoticeCollector();
  const touched: WorldbookEntry[] = [];
  let changed = false;
  const kept: WorldbookEntry[] = [];
  for (const entry of release.entries) {
    if (remove.has(entry.entryId)) { changed = true; continue; }
    const edit = change.entries && Object.hasOwn(change.entries, entry.entryId) ? change.entries[entry.entryId] : undefined;
    const next = applyEntryEdit(entry, edit);
    if (next !== entry && !sameEntry(next, entry)) { changed = true; touched.push(next); kept.push(next); } else kept.push(entry);
  }
  const ids = new Set(kept.map((entry) => entry.entryId));
  for (const draft of change.add ?? []) {
    if (!draft.entryId || known.has(draft.entryId) || ids.has(draft.entryId)) {
      notices.add(notice('duplicate_entry_id', { entryRef: draft.entryId }, { value: draft.entryId }));
      continue;
    }
    ids.add(draft.entryId);
    const next = applyEntryEdit(blankEntry(draft.entryId), draft);
    changed = true; touched.push(next); kept.push(next);
  }
  if (kept.length > WORLDBOOK_LIMITS.maxEntries) notices.add(notice('too_many_entries', {}, { value: kept.length, limit: WORLDBOOK_LIMITS.maxEntries }));
  let metadata = release.metadata;
  if (change.title !== undefined) {
    const title = Array.from(change.title.trim()).slice(0, 200).join('');
    if (!title) notices.add(notice('metadata_invalid', {}, { value: '书名不能为空' }));
    else if (title !== release.metadata.title) { metadata = { ...release.metadata, title }; changed = true; }
  }
  if (change.purpose && change.purpose !== (metadata.purpose ?? 'ordinary')) {
    metadata = { ...metadata, purpose: change.purpose };
    changed = true;
  }
  for (const entry of touched) {
    if (!Number.isFinite(entry.order)) notices.add(notice('field_type', { entryRef: entry.entryId, field: 'order' }, { value: '数字' }));
    checkEntry(entry, notices);
  }
  const errors = notices.items.filter((item) => item.level === 'error');
  if (errors.length) return { ok: false, reason: 'invalid', notices: errors };
  if (!changed) return { ok: true, changed: false };
  const hash = await contentHash({ metadata, entries: kept, source: release.source });
  return {
    ok: true, changed: true,
    release: { ...release, versionId: (options.newId ?? (() => crypto.randomUUID()))(), versionLabel: '本地修改', contentHash: hash, metadata, entries: kept },
  };
}

/** 新建一本空白世界书（王朝格式，没有条目）。 */
export async function createBlankRelease(title: string, options: Pick<ImportOptions, 'newId'> = {}): Promise<WorldbookImportResult> {
  return finishImport({
    entries: [], metadata: { title: Array.from(title.trim()).slice(0, 200).join('') || DEFAULT_TITLE },
    format: 'heijin', payload: null, notices: new NoticeCollector(), options: { newId: options.newId },
    identity: undefined,
  }).then((result) => (result.ok ? { ...result, release: { ...result.release, versionLabel: '本地新建' } } : result));
}
