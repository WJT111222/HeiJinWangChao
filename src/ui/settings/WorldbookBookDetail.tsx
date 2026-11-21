import { useEffect, useMemo, useRef, useState } from 'react';
import { exportNativeText, exportSillyTavern } from '../../domain/worldbook/export';
import { blankEntry } from '../../domain/worldbook/entryFields';
import { applyEntryEdit, type BookChange, type EntryEdit } from '../../domain/worldbook/release';
import { ENTRY_POSITIONS, SELECTIVE_LOGIC, type WorldbookEntry, type WorldbookRelease } from '../../domain/worldbook/schema';
import { DECISION_TEXT, type EntryDecision } from '../../domain/worldbook/trigger';
import type { ShelfBook } from '../../services/storage/worldbookLibrary';
import { previewWorldbook, type WorldbookPreviewOutcome } from '../../services/worldbook/storyWorldbook';
import { Feedback } from '../Feedback';

/**
 * 一本世界书的详情：条目列表（单条启用 / 关键词唤醒或常驻）、编辑条目、新增 / 删除条目、重命名、导出、触发预览。
 * 修改先暂存，点「保存修改」才写入书库（保存为新版本）；预览按已保存的内容运行。
 */
type Filter = 'all' | 'constant' | 'keyword' | 'disabled';
const FILTERS: Array<[Filter, string]> = [['all', '全部'], ['keyword', '关键词唤醒'], ['constant', '常驻'], ['disabled', '已停用']];
const PAGE = 50;

const LOGIC_TEXT: Record<number, string> = {
  [SELECTIVE_LOGIC.andAny]: '且含任一', [SELECTIVE_LOGIC.andAll]: '且含全部', [SELECTIVE_LOGIC.notAny]: '且不含任一', [SELECTIVE_LOGIC.notAll]: '且不同时含全部',
};
const POSITION_TEXT: Record<number, string> = {
  [ENTRY_POSITIONS.before]: '设定之前', [ENTRY_POSITIONS.after]: '设定之后', [ENTRY_POSITIONS.authorNoteTop]: '作者注释上方',
  [ENTRY_POSITIONS.authorNoteBottom]: '作者注释下方', [ENTRY_POSITIONS.atDepth]: '按深度插入', [ENTRY_POSITIONS.exampleTop]: '示例对话上方',
  [ENTRY_POSITIONS.exampleBottom]: '示例对话下方', [ENTRY_POSITIONS.outlet]: 'Outlet（暂不支持）',
};

export const entryTitle = (entry: WorldbookEntry, index: number) => entry.comment.trim() || entry.keys[0]?.trim() || `条目 ${index + 1}`;

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName.replace(/[\\/:*?"<>|]/g, '_');
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface BookDetailProps {
  item: ShelfBook;
  release: WorldbookRelease;
  busy: boolean;
  /** 保存暂存的修改；返回是否成功（失败时由外层显示原因）。 */
  onSave: (change: BookChange) => Promise<boolean>;
  onToggleBook: (enabled: boolean) => void;
  onDelete: () => void;
  onBack: () => void;
  /** 暂存修改数量变化时通知外层（切换书前提醒）。 */
  onDirtyChange: (count: number) => void;
}

/** 暂存的修改：书名、改条目、新增条目（界面上排在最前，保存时追加到末尾）、删除条目。 */
interface Draft { title?: string; entries: Record<string, EntryEdit>; added: Array<{ entryId: string } & EntryEdit>; removed: string[] }
const EMPTY_DRAFT: Draft = { entries: {}, added: [], removed: [] };
interface Row { entry: WorldbookEntry; original: WorldbookEntry | null; index: number; removed: boolean }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newEntryId = () => `local-${crypto.randomUUID()}`;

export function WorldbookBookDetail({ item, release, busy, onSave, onToggleBook, onDelete, onBack, onDirtyChange }: BookDetailProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // 换书（或保存后版本变了）时清空暂存。
  useEffect(() => { setDraft(EMPTY_DRAFT); setShown(PAGE); setOpen(null); setRenaming(false); setConfirmDelete(false); setExportNote(null); }, [release.bookId, release.versionId]);
  const dirty = (draft.title !== undefined ? 1 : 0) + Object.keys(draft.entries).length + draft.added.length + draft.removed.length;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(0), [onDirtyChange]);

  const allRows = useMemo<Row[]>(() => [
    ...draft.added.map((added, i) => ({ entry: applyEntryEdit(blankEntry(added.entryId), added), original: null, index: release.entries.length + i, removed: false })),
    ...release.entries.map((entry, index) => ({ entry: applyEntryEdit(entry, draft.entries[entry.entryId]), original: entry, index, removed: draft.removed.includes(entry.entryId) })),
  ], [release.entries, draft]);

  function editRow(row: Row, change: EntryEdit) {
    setDraft((current) => {
      if (!row.original) {
        return { ...current, added: current.added.map((a) => (a.entryId === row.entry.entryId ? { ...a, ...change } : a)) };
      }
      const original = row.original;
      const merged: EntryEdit = { ...current.entries[original.entryId], ...change };
      // 改回原值的字段不再算修改。
      for (const key of Object.keys(merged) as Array<keyof EntryEdit>) {
        if (same(applyEntryEdit(original, { [key]: merged[key] } as EntryEdit), original)) delete merged[key];
      }
      const entries = { ...current.entries };
      if (Object.keys(merged).length) entries[original.entryId] = merged; else delete entries[original.entryId];
      return { ...current, entries };
    });
  }
  function toggleRemove(row: Row) {
    setDraft((current) => {
      if (!row.original) return { ...current, added: current.added.filter((a) => a.entryId !== row.entry.entryId) };
      const id = row.original.entryId;
      return { ...current, removed: current.removed.includes(id) ? current.removed.filter((x) => x !== id) : [...current.removed, id] };
    });
  }
  function addEntry() {
    const entryId = newEntryId();
    setDraft((current) => ({ ...current, added: [{ entryId, comment: '', keys: [], content: '' }, ...current.added] }));
    setFilter('all'); setQuery(''); setOpen(entryId);
  }
  function save() {
    const change: BookChange = {};
    if (draft.title !== undefined) change.title = draft.title;
    if (Object.keys(draft.entries).length) change.entries = draft.entries;
    // 界面上新条目排在最前（最新的在上），保存时按创建先后追加。
    if (draft.added.length) change.add = [...draft.added].reverse();
    if (draft.removed.length) change.remove = draft.removed;
    void onSave(change);
  }

  const counts = useMemo(() => {
    let enabled = 0, constant = 0, total = 0;
    for (const row of allRows) {
      if (row.removed) continue;
      total++;
      if (!row.entry.disabled) { enabled++; if (row.entry.constant) constant++; }
    }
    return { enabled, constant, total };
  }, [allRows]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter(({ entry, index, original }) => {
      if (!original && open === entry.entryId) return true; // 正在编辑的新条目始终显示
      if (filter === 'disabled' && !entry.disabled) return false;
      if (filter === 'constant' && (entry.disabled || !entry.constant)) return false;
      if (filter === 'keyword' && (entry.disabled || entry.constant)) return false;
      if (!needle) return true;
      return [entryTitle(entry, index), entry.content, ...entry.keys, ...entry.secondaryKeys].some((text) => text.toLowerCase().includes(needle));
    });
  }, [allRows, filter, query, open]);

  function exportAs(kind: 'sillytavern' | 'heijin') {
    const title = release.metadata.title;
    if (kind === 'heijin') { download(`${title}.heijin.json`, exportNativeText(release)); setExportNote('已导出王朝格式（可无损再导入）。'); return; }
    const { value, notices } = exportSillyTavern(release);
    download(`${title}.json`, JSON.stringify(value, null, 2));
    setExportNote(notices.length ? `已导出酒馆格式。${notices.map((n) => n.message).join(' ')}` : '已导出酒馆格式。');
  }

  const shownTitle = draft.title ?? release.metadata.title;
  const local = release.versionLabel === '本地修改' ? ' · 已在本地修改' : release.versionLabel === '本地新建' ? ' · 本地新建' : '';
  return (
    <section className="wb-detail" aria-label={`世界书「${release.metadata.title}」`}>
      <div className="wb-detail-head">
        <button className="wb-back" onClick={onBack}>← 返回列表</button>
        <div className="wb-detail-title">
          {renaming ? (
            <span className="wb-rename">
              <input value={shownTitle} maxLength={200} aria-label="书名" autoFocus
                onChange={(e) => { const value = e.target.value; setDraft((c) => ({ ...c, title: value === release.metadata.title ? undefined : value })); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false); }} />
              <button onClick={() => setRenaming(false)}>完成</button>
            </span>
          ) : (
            <h3>{shownTitle}{draft.title !== undefined && <em className="wb-edited">已修改</em>}
              <button className="wb-link" disabled={busy} onClick={() => setRenaming(true)}>重命名</button></h3>
          )}
          <small>启用 {counts.enabled} / 共 {counts.total} 条 · 常驻 {counts.constant} 条{local}</small>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={item.enabled} disabled={busy} aria-label={`启用整本「${release.metadata.title}」`} onChange={(e) => onToggleBook(e.target.checked)} />
          <span className="wb-state">{item.enabled ? '整本已启用' : '整本未启用'}</span>
        </label>
      </div>
      {release.metadata.description && <p className="wb-desc muted">{release.metadata.description}</p>}
      <div className="wb-detail-actions">
        <button disabled={busy || dirty > 0} onClick={() => exportAs('sillytavern')} title={dirty ? '请先保存或放弃修改' : undefined}>导出酒馆格式</button>
        <button disabled={busy || dirty > 0} onClick={() => exportAs('heijin')} title={dirty ? '请先保存或放弃修改' : undefined}>导出王朝格式</button>
        {confirmDelete ? (
          <span className="wb-confirm">
            <button className="danger" disabled={busy} onClick={onDelete}>确认删除整本</button>
            <button disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button>
          </span>
        ) : <button disabled={busy} onClick={() => setConfirmDelete(true)}>删除整本</button>}
      </div>
      {exportNote && <Feedback role="status" level="info" className="field-hint">{exportNote}</Feedback>}

      {dirty > 0 && (
        <div className="wb-savebar" role="status">
          <span>有 {dirty} 项修改未保存</span>
          <button className="primary" disabled={busy} onClick={save}>保存修改</button>
          <button disabled={busy} onClick={() => { setDraft(EMPTY_DRAFT); setOpen(null); }}>放弃</button>
        </div>
      )}

      <div className="wb-filter">
        <button className="wb-add" disabled={busy} onClick={addEntry}>＋ 新增条目</button>
        <input type="search" placeholder="搜索标题、关键词或内容" value={query} aria-label="搜索条目" onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
        <div className="wb-chips" role="group" aria-label="筛选条目">
          {FILTERS.map(([value, label]) => (
            <button key={value} className="wb-chip" aria-pressed={filter === value} onClick={() => { setFilter(value); setShown(PAGE); }}>{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? <p className="muted wb-empty">{allRows.length === 0 ? '这本书还没有条目，点「＋ 新增条目」开始写。' : '没有符合条件的条目。'}</p> : (
        <ul className="wb-entries" aria-label="条目">
          {rows.slice(0, shown).map((row) => {
            const { entry, index, original, removed } = row;
            const isNew = !original, changed = !isNew && Boolean(draft.entries[entry.entryId]), title = entryTitle(entry, index);
            const expanded = open === entry.entryId;
            return (
              <li key={entry.entryId} className="wb-entry" data-disabled={entry.disabled || removed || undefined} data-changed={changed || isNew || undefined} data-removed={removed || undefined}>
                <div className="wb-entry-head">
                  <button className="wb-entry-title" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.entryId)}>
                    <strong>{title}</strong>{isNew ? <em>新增</em> : removed ? <em>将删除</em> : changed && <em>已修改</em>}
                  </button>
                  <div className="wb-mode" role="radiogroup" aria-label={`「${title}」的唤醒方式`}>
                    <button role="radio" aria-checked={!entry.constant} disabled={busy || removed} onClick={() => editRow(row, { constant: false })}>关键词唤醒</button>
                    <button role="radio" aria-checked={entry.constant} disabled={busy || removed} onClick={() => editRow(row, { constant: true })}>常驻</button>
                  </div>
                  <label className="toggle">
                    <input type="checkbox" checked={!entry.disabled} disabled={busy || removed} aria-label={`启用条目「${title}」`} onChange={(e) => editRow(row, { disabled: !e.target.checked })} />
                  </label>
                </div>
                {!expanded && (
                  <div className="wb-keys">
                    {entry.constant ? <span className="wb-key wb-key-const">常驻：每次都带入</span>
                      : entry.keys.length ? entry.keys.slice(0, 8).map((key, i) => <span key={i} className="wb-key">{key}</span>)
                        : <span className="wb-key wb-key-warn">没有关键词：选「关键词唤醒」时不会被唤醒</span>}
                    {!entry.constant && entry.keys.length > 8 && <span className="wb-key">+{entry.keys.length - 8}</span>}
                    {!entry.constant && entry.selective && entry.secondaryKeys.length > 0 && (
                      <span className="wb-key wb-key-sub">{LOGIC_TEXT[entry.selectiveLogic] ?? '副关键词'}：{entry.secondaryKeys.slice(0, 4).join('、')}{entry.secondaryKeys.length > 4 ? '…' : ''}</span>
                    )}
                  </div>
                )}
                {expanded ? (
                  <EntryEditor entry={entry} disabled={busy || removed} removed={removed} isNew={isNew}
                    onChange={(change) => editRow(row, change)} onRemove={() => toggleRemove(row)} />
                ) : <p className="wb-entry-preview">{entry.content || '（正文为空）'}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > shown && <button className="wb-more" onClick={() => setShown((n) => n + PAGE)}>显示更多（还有 {rows.length - shown} 条）</button>}

      <TriggerPreview item={item} release={release} dirty={dirty > 0} />
    </section>
  );
}

/** 关键词输入：逗号（中英文）、顿号或换行分隔；输入框里保留玩家原样的文字，只把解析结果交出去。 */
const splitKeys = (text: string) => text.split(/[,，、\n]/);
function KeysField({ label, entryId, keys, disabled, onChange, placeholder }: {
  label: string; entryId: string; keys: string[]; disabled: boolean; onChange: (keys: string[]) => void; placeholder: string;
}) {
  const [text, setText] = useState(() => keys.join('，'));
  // 只在换条目时从数据同步，避免输入逗号时被立即整理掉。
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => { setText(latest.current.join('，')); }, [entryId]);
  return (
    <label className="wb-field">
      <span>{label}</span>
      <input value={text} disabled={disabled} placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); onChange(splitKeys(e.target.value)); }} />
    </label>
  );
}

function EntryEditor({ entry, disabled, removed, isNew, onChange, onRemove }: {
  entry: WorldbookEntry; disabled: boolean; removed: boolean; isNew: boolean; onChange: (change: EntryEdit) => void; onRemove: () => void;
}) {
  const regexKeys = entry.keys.filter((key) => /^\/.+\/[a-z]*$/.test(key));
  return (
    <div className="wb-entry-body wb-editor">
      <label className="wb-field">
        <span>标题</span>
        <input value={entry.comment} disabled={disabled} maxLength={500} placeholder="例如：李四（茶楼老板）" onChange={(e) => onChange({ comment: e.target.value })} />
      </label>
      <KeysField label="关键词" entryId={entry.entryId} keys={entry.keys} disabled={disabled} placeholder="用逗号分隔，例如：李四，茶楼老板"
        onChange={(keys) => onChange({ keys })} />
      {!entry.constant && entry.keys.length === 0 && <p className="field-hint wb-warn">没有关键词时，这条只有设为「常驻」才会带入。</p>}
      {regexKeys.length > 0 && <p className="field-hint">形如 /…/ 的关键词按正则表达式匹配。</p>}
      <div className="wb-field-row">
        <KeysField label="副关键词（可选）" entryId={entry.entryId} keys={entry.secondaryKeys} disabled={disabled} placeholder="同时满足的条件"
          onChange={(secondaryKeys) => onChange({ secondaryKeys })} />
        <label className="wb-field wb-field-narrow">
          <span>副关键词规则</span>
          <select value={entry.selectiveLogic} disabled={disabled || entry.secondaryKeys.length === 0} onChange={(e) => onChange({ selectiveLogic: Number(e.target.value) })}>
            {[SELECTIVE_LOGIC.andAny, SELECTIVE_LOGIC.andAll, SELECTIVE_LOGIC.notAny, SELECTIVE_LOGIC.notAll].map((value) => (
              <option key={value} value={value}>{LOGIC_TEXT[value]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="wb-field">
        <span>内容</span>
        <textarea rows={6} value={entry.content} disabled={disabled} placeholder="触发后带入正文的设定文字" onChange={(e) => onChange({ content: e.target.value })} />
      </label>
      {entry.content.trim() === '' && <p className="field-hint wb-warn">内容为空，触发了也不会带入任何文字。</p>}
      <div className="wb-field-row">
        <label className="wb-field wb-field-narrow">
          <span>顺序（越大越靠后）</span>
          <input type="number" value={Number.isFinite(entry.order) ? entry.order : 100} disabled={disabled} step={1}
            onChange={(e) => { const value = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(value)) onChange({ order: value }); }} />
        </label>
        <dl>
          <div><dt>位置</dt><dd>{POSITION_TEXT[entry.position] ?? `未知（${entry.position}）`}{entry.position === ENTRY_POSITIONS.atDepth ? `，深度 ${entry.depth}` : ''}</dd></div>
          {entry.useProbability && entry.probability < 100 && <div><dt>概率</dt><dd>{entry.probability}%</dd></div>}
          {entry.group && <div><dt>分组</dt><dd>{entry.group}</dd></div>}
          {(entry.sticky || entry.cooldown) ? <div><dt>持续 / 冷却</dt><dd>已保存，暂不生效</dd></div> : null}
        </dl>
      </div>
      <div className="wb-editor-actions">
        <button className={removed ? '' : 'danger'} disabled={disabled && !removed} onClick={onRemove}>
          {isNew ? '不要这条' : removed ? '撤销删除' : '删除这条'}
        </button>
      </div>
    </div>
  );
}

function TriggerPreview({ item, release, dirty }: { item: ShelfBook; release: WorldbookRelease; dirty: boolean }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<WorldbookPreviewOutcome | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setOutcome(null); }, [release.versionId]);

  async function run() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    const result = await previewWorldbook([{ bookId: release.bookId, versionId: release.versionId, contentHash: release.contentHash }], text, { signal: current.signal });
    if (controller.current !== current) return;
    controller.current = null;
    setOutcome(result); setRunning(false);
  }

  const titleOf = useMemo(() => {
    const map = new Map(release.entries.map((entry, index) => [entry.entryId, entryTitle(entry, index)]));
    return (d: EntryDecision) => map.get(d.entryId) ?? d.entryId;
  }, [release.entries]);
  const activated = outcome?.status === 'ok' ? outcome.result.decisions.filter((d) => d.status === 'activated') : [];
  const missed = outcome?.status === 'ok' ? outcome.result.decisions.filter((d) => d.status !== 'activated' && d.reason !== 'disabled') : [];

  return (
    <div className="wb-preview">
      <h4>触发预览</h4>
      <p className="field-hint">
        {'输入一段剧情或玩家行动，看这本书会带入哪些条目。'}
        {dirty ? '预览按已保存的内容运行，未保存的修改不计入。' : ''}
        {item.enabled ? '' : '（这本书目前未启用，预览不受影响。）'}
      </p>
      <textarea rows={3} value={text} placeholder="例如：李四推门走进茶楼" aria-label="预览文本" onChange={(e) => setText(e.target.value)} />
      <div className="wb-actions">
        <button className="primary" disabled={running || !text.trim()} onClick={() => void run()}>{running ? '正在预览…' : '预览'}</button>
        {running && <button onClick={() => { controller.current?.abort(); }}>取消</button>}
      </div>
      {outcome?.status === 'skipped' && <Feedback role="alert" level="warn" className="field-hint">{outcome.message}</Feedback>}
      {outcome?.status === 'ok' && (
        <div className="wb-preview-result" role="status">
          <p>
            会带入 <strong>{activated.length}</strong> 条，约 {outcome.result.budget.used} Token
            {outcome.result.budget.overflowed ? '（超出预算，部分条目被舍弃）' : ''}
            {outcome.result.work.exhausted ? '（书太大，扫描提前结束，结果不完整）' : ''}。
          </p>
          {activated.length > 0 && (
            <ul className="wb-preview-list">
              {activated.map((d) => <li key={d.key}><strong>{titleOf(d)}</strong><span>{DECISION_TEXT[d.reason]}{d.detail ? `：${d.detail}` : ''}</span></li>)}
            </ul>
          )}
          {missed.length > 0 && (
            <details>
              <summary>没有带入的条目 {missed.length} 条（看原因）</summary>
              <ul className="wb-preview-list">
                {missed.slice(0, 200).map((d) => <li key={d.key} data-missed><strong>{titleOf(d)}</strong><span>{DECISION_TEXT[d.reason]}{d.detail ? `：${d.detail}` : ''}</span></li>)}
              </ul>
            </details>
          )}
          <p className="field-hint">概率条目按固定种子抽签，实际生成时结果可能不同；延迟条件视为已满足。</p>
        </div>
      )}
    </div>
  );
}
