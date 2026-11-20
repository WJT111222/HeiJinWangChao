import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportNotice } from '../../domain/worldbook/schema';
import { MAX_ENABLED_BOOKS, WorldbookLibrary, type LibraryFailureCode, type ShelfBook } from '../../services/storage/worldbookLibrary';
import { importIntoLibrary, type ImportOutcome } from '../../services/worldbook/libraryImport';
import { STORY_WORLDBOOK_CONNECTED } from '../../services/worldbook/storyWorldbook';
import { Feedback, type FeedbackLevel } from '../Feedback';
import './worldbook-library.css';

/**
 * 玩家世界书（简化版）：导入酒馆世界书、全局开关、删除。
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
  const [confirming, setConfirming] = useState<string | null>(null);
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
    } catch {
      if (mounted.current) setMessage({ level: 'err', text: '读取文件失败。' });
    } finally {
      importing.current = null;
      if (mounted.current) setBusy(false);
    }
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
    setConfirming(null); setBusy(true);
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
        <ul className="wb-list" aria-label="已导入的世界书">
          {books.map((item) => (
            <li key={item.book.bookId} className="wb-item" data-enabled={item.enabled || undefined}>
              <div className="wb-info">
                <strong>{item.book.title}</strong>
                <small>{item.latest ? `${item.latest.entryCount} 条` : '摘要缺失'} · 导入于 {new Date(item.book.updatedAt).toLocaleDateString('zh-CN')}</small>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={item.enabled} disabled={busy} aria-label={`启用「${item.book.title}」`}
                  onChange={(e) => void toggle(item, e.target.checked)} />
                <span className="wb-state">{item.enabled ? '已启用' : '未启用'}</span>
              </label>
              {confirming === item.book.bookId ? (
                <span className="wb-confirm">
                  <button className="danger" disabled={busy} onClick={() => void remove(item)}>确认删除</button>
                  <button disabled={busy} onClick={() => setConfirming(null)}>取消</button>
                </span>
              ) : <button disabled={busy} onClick={() => setConfirming(item.book.bookId)} aria-label={`删除「${item.book.title}」`}>删除</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint">
        {'说明：酒馆里的 Sticky / Cooldown（持续、冷却回合）设置会原样保存，但当前版本暂不生效；其余关键词、常驻、概率、分组照常判断。'}
        {'世界书只保存在本机浏览器，不包含在存档备份里。'}
      </p>
    </div>
  );
}
