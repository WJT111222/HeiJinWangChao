import { createRoot } from 'react-dom/client';
import { exportSillyTavern } from '../../domain/worldbook/export';
import { WorldbookLibrary } from '../../services/storage/worldbookLibrary';
import { WorldbookLibraryPanel } from '../../ui/settings/WorldbookLibrary';

/**
 * e2e 用的世界书管理面板：在空白页面里单独挂载（不经过游戏首页），并提供读取书库的检查函数。
 * 只在开发服务器上由 worldbook-harness.html 加载，不参与正式构建。
 */
declare global {
  interface Window {
    __worldbookLatest?: () => Promise<{ title: string; entries: Array<{ comment: string; keys: string[]; content: string }>; exported: Array<{ comment: string; key: string[] }> }>;
  }
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<div className="settings-content"><WorldbookLibraryPanel /></div>);

window.__worldbookLatest = async () => {
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw new Error(`书库打不开：${opened.code}`);
  try {
    const shelf = await opened.library.shelf();
    if (!shelf.ok || !shelf.books[0]) throw new Error('书库为空');
    const book = shelf.books[0].book;
    const read = await opened.library.getRelease(book.bookId, book.latestVersionId);
    if (!read.ok || !read.release) throw new Error('读取版本失败');
    const release = read.release;
    const rows = Object.values(exportSillyTavern(release).value.entries as Record<string, { comment: string; key: string[] }>);
    return {
      title: book.title,
      entries: release.entries.map((entry) => ({ comment: entry.comment, keys: entry.keys, content: entry.content })),
      exported: rows.map((row) => ({ comment: row.comment, key: row.key })),
    };
  } finally { opened.library.close(); }
};
