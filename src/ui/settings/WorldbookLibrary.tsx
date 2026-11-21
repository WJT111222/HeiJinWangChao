import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookChange } from '../../domain/worldbook/release';
import type { ImportNotice, WorldbookRelease } from '../../domain/worldbook/schema';
import { MAX_ENABLED_BOOKS, WorldbookLibrary, type LibraryFailureCode, type ShelfBook } from '../../services/storage/worldbookLibrary';
import { importIntoLibrary, type ImportOutcome } from '../../services/worldbook/libraryImport';
import { STORY_WORLDBOOK_CONNECTED } from '../../services/worldbook/storyWorldbook';
import { Feedback, type FeedbackLevel } from '../Feedback';
import { WorldbookBookDetail, entryTitle } from './WorldbookBookDetail';
import './worldbook-library.css';

/**
 * 玩家世界书（简化版）：导入酒馆世界书、全局开关、删除；点开一本书可查看条目、
 * 单条启用 / 停用、选择关键词唤醒或常驻、导出、触发预览。
 * 启用状态对所有存档生效，保存在独立的世界书书库里，不改动存档；两本内置基础世界书不在这里，始终启用。
 */
const LIBRARY_TEXT: Partial<Record<LibraryFailureCode, string>> = {
  unavailable: '本地书库暂不可用，存档不受影响。请刷新页面后重试。',
  blocked: '本地书库正被其他标签页占用，请关闭旧标签页后重试。',
  invalid: '书库记录损坏。',
  too_large: '这本世界书超过单本上限，未导入。',
  library_full: '书库容量已满，请先删除不用的世界书。',
  quota: '浏览器存储空间不足，未导入。',
  not_found: '这本世界书已不在书库中，可能已在其他页面删除。',
  version_conflict: '这本书刚在其他页面被修改过，已重新读取，请再改一次。',
  too_many_enabled: `最多同时启用 ${MAX_ENABLED_BOOKS} 本，请先关闭不用的。`,
};
const EFFECT = STORY_WORLDBOOK_CONNECTED ? '从下一次生成正文开始生效' : '正文接入完成后生效';
const failureText = (code: string) => LIBRARY_TEXT[code as LibraryFailureCode] ?? '操作失败，书库没有变化。';

function importMessage(outcome: ImportOutcome): { level: FeedbackLevel; text: string } {
  if (outcome.ok) {
    const { summary } = outcome;
    if (summary.status === 'duplicate_content') return { level: 'info', text: `「${summary.title}」已经在书库里了，没有重复导入。` };
    return { level: 'ok', text: `已导入「${summary.title}」，共 ${summary.entryCount} 条。` };
  }
  switch (outcome.code) {
    case 'import_failed': return { level: 'err', text: '无法导入：文件不是可识别的世界书，详情见下方。' };
    case 'timeout': return { level: 'err', text: '导入超时，文件可能过大。' };
    case 'cancelled': return { level: 'info', text: '已取消导入。' };
    case 'worker_unavailable': return { level: 'err', text: '浏览器无法在后台导入，且文件较大，未导入。' };
    case 'worker_error': case 'internal': return { level: 'err', text: '导入出错，书库没有变化。' };
    default: return { level: 'err', text: failureText(outcome.code) };
  }
}

export function WorldbookLibraryPanel() {
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [message, setMessage] = useState<{ level: FeedbackLevel; text: string } | null>(null);
  const [notices, setNotices] = useState<ImportNotice[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [release, setRelease] = useState<WorldbookRelease | null>(null);
  const [dirty, setDirty] = useState(0);
  // 每次选择文件后换一个新的 input：再次选择同一个文件时也能触发导入。
  const [inputKey, setInputKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const importing = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; importing.current?.abort(); }; }, []);

  /** 每次操作都单独打开、用完关闭，不长期占用连接（避免阻塞书库升级）。 */
  const withLibrary = useCallback(async <T,>(work: (library: WorldbookLibrary) => Promise<T>): Promise<T | { ok: false; code: LibraryFailureCode }> => {
    const opened = await WorldbookLibrary.open();
    if (!opened.ok) return { ok: false, code: opened.code };
    try { return await work(opened.library); } finally { opened.library.close(); }
  }, []);

  const refresh = useCallback(async () => {
    const result = await withLibrary((library) => library.shelf());
    if (!mounted.current) return;
    if (result.ok) setBooks(result.books);
    else { setBooks((current) => current ?? []); setMessage({ level: 'err', text: failureText(result.code) }); }
  }, [withLibrary]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selectedItem = books?.find((b) => b.book.bookId === selected) ?? null;
  const selectedVersion = selectedItem?.book.latestVersionId ?? null;
  // 有未保存的修改时，不把详情换成别的标签页保存的新版本（否则玩家的修改会被悄悄清掉），改为提示冲突。
  const keepDraft = dirty > 0 && release?.bookId === selected;
  useEffect(() => {
    if (!selected || !selectedVersion) { setRelease(null); return; }
    if (keepDraft) return;
    let live = true;
    void withLibrary((library) => library.getRelease(selected, selectedVersion)).then((result) => {
      if (!live || !mounted.current) return;
      if (result.ok && result.release) setRelease(result.release);
      else { setRelease(null); setMessage({ level: 'err', text: result.ok ? failureText('not_found') : failureText(result.code) }); }
    });
    return () => { live = false; };
  }, [selected, selectedVersion, withLibrary, keepDraft]);
  const stale = Boolean(selectedItem && release && release.bookId === selectedItem.book.bookId && release.versionId !== selectedItem.book.latestVersionId);
  // 书被删除（本页或其他页面）后退出详情。
  useEffect(() => { if (books && selected && !books.some((b) => b.book.bookId === selected)) setSelected(null); }, [books, selected]);

  function select(bookId: string | null) {
    if (bookId === selected) return;
    if (dirty > 0) { setMessage({ level: 'warn', text: '当前这本书有未保存的修改，请先保存或放弃。' }); return; }
    setSelected(bookId);
  }

  /** baseVersionId：开始编辑时详情里显示的版本；别的标签页先保存过时返回冲突，不覆盖、不报成功。 */
  async function save(bookId: string, baseVersionId: string, change: BookChange): Promise<boolean> {
    setBusy(true);
    const result = await withLibrary((library) => library.reviseBook(bookId, change, { baseVersionId }));
    if (!mounted.current) return false;
    if (result.ok) {
      // 书目与详情同时换成刚保存的版本（同一次渲染），不会被误判为「别的标签页改过」，也不会闪一下「正在读取」。
      if (result.changed) {
        const saved = result.book;
        setBooks((current) => current?.map((item) => (item.book.bookId === saved.bookId ? { ...item, book: saved } : item)) ?? current);
        setRelease(result.release);
      }
      setMessage({ level: 'ok', text: result.changed ? `已保存修改，${EFFECT}。` : '没有需要保存的变化。' });
    } else if (result.code === 'version_conflict') {
      setMessage({ level: 'warn', text: '没有保存：这本书已在其他标签页保存过新版本。你的修改还在，没有覆盖对方；如需保留，请先记下内容，再读取最新版本。' });
    } else if ('notices' in result && result.notices?.length) {
      // 把条目引用换成玩家看得到的标题。
      const titles = new Map<string, string>();
      release?.entries.forEach((entry, index) => { const title = entryTitle(entry, index); titles.set(entry.entryId, title); if (entry.sourceKey !== null) titles.set(entry.sourceKey, title); });
      const lines = result.notices.map((n) => `${n.entryRef ? `「${titles.get(n.entryRef) ?? '新增条目'}」` : ''}${n.message}`);
      setMessage({ level: 'err', text: `没有保存：${lines.slice(0, 5).join(' ')}${lines.length > 5 ? ` 等 ${lines.length} 处` : ''}` });
    } else setMessage({ level: 'err', text: failureText(result.code) });
    await refresh();
    if (mounted.current) setBusy(false);
    return result.ok;
  }

  async function importFile(file: File) {
    setBusy(true); setMessage({ level: 'info', text: `正在导入「${file.name}」…` }); setNotices([]);
    const controller = new AbortController();
    importing.current = controller;
    try {
      const text = await file.text();
      const outcome = await importIntoLibrary(text, {}, { signal: controller.signal });
      if (!mounted.current) return;
      let result = importMessage(outcome);
      // 导入成功后直接启用，玩家不用再找开关。
      if (outcome.ok && outcome.summary.status === 'installed') {
        const enabled = await withLibrary((library) => library.setEnabled(outcome.summary.bookId, true));
        if (!enabled.ok) result = { level: 'warn', text: `${result.text}暂未启用：${failureText(enabled.code)}` };
        else result = { ...result, text: `${result.text}已启用，${EFFECT}。` };
      }
      if (!mounted.current) return;
      setMessage(result);
      setNotices(outcome.notices.filter((n) => n.level !== 'info'));
      await refresh();
      // 书目刷新之后再打开详情（否则会被「书已不存在」的检查立即关掉）。
      if (outcome.ok && dirty === 0 && mounted.current) setSelected(outcome.summary.bookId);
    } catch {
      if (mounted.current) setMessage({ level: 'err', text: '读取文件失败。' });
    } finally {
      importing.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  async function createBlank() {
    if (dirty > 0) { setMessage({ level: 'warn', text: '当前这本书有未保存的修改，请先保存或放弃。' }); return; }
    setBusy(true);
    const result = await withLibrary((library) => library.createBook('新世界书'));
    if (!mounted.current) return;
    setMessage(result.ok ? { level: 'ok', text: `已新建「${result.release.metadata.title}」：点「重命名」改书名，点「＋ 新增条目」开始写。写好后记得打开整本开关。` } : { level: 'err', text: failureText(result.code) });
    await refresh();
    if (result.ok && mounted.current) setSelected(result.release.bookId);
    if (mounted.current) setBusy(false);
  }

  async function toggle(book: ShelfBook, enabled: boolean) {
    setBusy(true);
    const result = await withLibrary((library) => library.setEnabled(book.book.bookId, enabled));
    if (!mounted.current) return;
    setMessage(result.ok ? { level: 'ok', text: `「${book.book.title}」已${enabled ? '启用' : '关闭'}，${EFFECT}。` } : { level: 'err', text: failureText(result.code) });
    await refresh();
    if (mounted.current) setBusy(false);
  }

  async function remove(book: ShelfBook) {
    setBusy(true);
    const result = await withLibrary((library) => library.deleteBook(book.book.bookId));
    if (!mounted.current) return;
    setMessage(result.ok ? { level: 'ok', text: `已删除「${book.book.title}」。` } : { level: 'err', text: failureText(result.code) });
    await refresh();
    if (mounted.current) setBusy(false);
  }

  const enabledCount = books?.filter((b) => b.enabled).length ?? 0;
  return (
    <div className="worldbook-library">
      <p className="muted">
        {'导入酒馆（SillyTavern）世界书或角色卡里的世界书，启用后正文生成时会按关键词自动带入相关设定。'}
        {'启用状态对所有存档生效；两本内置基础世界书始终启用，不在这里显示。'}
      </p>
      {!STORY_WORLDBOOK_CONNECTED && <Feedback role="note" level="warn" className="field-hint">正文接入还在进行中：现在可以导入和管理世界书，但启用的世界书暂时不会带入正文。</Feedback>}
      <div className="wb-actions">
        <button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>导入世界书</button>
        <button disabled={busy} onClick={() => void createBlank()}>新建空白书</button>
        {busy && importing.current && <button onClick={() => importing.current?.abort()}>取消导入</button>}
        <input key={inputKey} ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="选择世界书文件"
          onChange={(e) => { const file = e.target.files?.[0]; setInputKey((k) => k + 1); if (file) void importFile(file); }} />
        <span className="muted wb-count">已启用 {enabledCount} / {MAX_ENABLED_BOOKS} 本</span>
      </div>
      {message && <Feedback role={message.level === 'err' ? 'alert' : 'status'} level={message.level} className="field-hint">{message.text}</Feedback>}
      {notices.length > 0 && (
        <details className="wb-notices">
          <summary>导入提示 {notices.length} 条（不影响使用，可展开查看）</summary>
          <ul>{notices.slice(0, 50).map((n, i) => <li key={i} data-level={n.level}>{n.entryRef ? `条目 ${n.entryRef}：` : ''}{n.message}</li>)}</ul>
        </details>
      )}
      {books === null ? <p className="muted">正在读取书库…</p> : books.length === 0 ? (
        <p className="wb-empty muted">还没有导入任何世界书。</p>
      ) : (
        <div className="wb-layout" data-view={selected ? 'detail' : 'list'}>
          <ul className="wb-list" aria-label="已导入的世界书">
            {books.map((item) => (
              <li key={item.book.bookId} className="wb-item" data-enabled={item.enabled || undefined} data-selected={item.book.bookId === selected || undefined}>
                <button className="wb-info" onClick={() => select(item.book.bookId)} aria-current={item.book.bookId === selected || undefined}>
                  <strong>{item.book.title}</strong>
                  <small>{item.latest ? `${item.latest.entryCount} 条` : '摘要缺失'} · {new Date(item.book.updatedAt).toLocaleDateString('zh-CN')}</small>
                </button>
                <label className="toggle">
                  <input type="checkbox" checked={item.enabled} disabled={busy} aria-label={`启用「${item.book.title}」`}
                    onChange={(e) => void toggle(item, e.target.checked)} />
                </label>
              </li>
            ))}
          </ul>
          <div className="wb-pane">
            {!selectedItem ? <p className="wb-empty muted wb-pick">选择左侧的一本书，查看和调整它的条目。</p>
              : !release || release.bookId !== selectedItem.book.bookId || (stale && !keepDraft) ? <p className="muted">正在读取条目…</p>
                : <WorldbookBookDetail item={selectedItem} release={release} busy={busy} stale={stale}
                  onSave={(change) => save(selectedItem.book.bookId, release.versionId, change)}
                  onToggleBook={(enabled) => void toggle(selectedItem, enabled)}
                  onDelete={() => void remove(selectedItem)}
                  onBack={() => select(null)}
                  onDirtyChange={setDirty} />}
          </div>
        </div>
      )}
      <p className="field-hint">
        {'说明：酒馆里的 Sticky / Cooldown（持续、冷却回合）设置会原样保存，但当前版本暂不生效；其余关键词、常驻、概率、分组照常判断。'}
        {'世界书只保存在本机浏览器，不包含在存档备份里。'}
      </p>
    </div>
  );
}
