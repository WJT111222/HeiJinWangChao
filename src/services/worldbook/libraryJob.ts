import { importWorldbookText } from '../../domain/worldbook/importWorldbook';
import type { ImportNotice } from '../../domain/worldbook/schema';
import { WorldbookLibrary, type InstallStatus, type LibraryFailureCode } from '../storage/worldbookLibrary';

/**
 * 导入并安装世界书文件（在 Worker 中执行）：解析、校验、计算内容哈希、写入本地书库。
 * 只回传摘要与导入提示，不回传整本书，避免把大对象复制回主线程。
 */
export interface ImportJob { id: number; kind: 'import-install'; text: string; title?: string; allowDuplicateContent?: boolean; libraryName?: string }
export interface ImportedSummary {
  status: InstallStatus;
  bookId: string;
  versionId: string;
  contentHash: string;
  title: string;
  entryCount: number;
}
export type ImportJobReply =
  | { ok: true; summary: ImportedSummary; notices: ImportNotice[] }
  | { ok: false; code: 'import_failed'; notices: ImportNotice[] }
  | { ok: false; code: LibraryFailureCode | 'internal'; notices: ImportNotice[] };

/** factory 只用于进程内测试（IDBFactory 不能跨越 Worker 边界）；Worker 中使用全局 indexedDB。 */
export async function runImportJob(job: ImportJob, factory?: IDBFactory): Promise<ImportJobReply> {
  const imported = await importWorldbookText(job.text, job.title ? { title: job.title } : {});
  if (!imported.ok) return { ok: false, code: 'import_failed', notices: imported.notices };
  const opened = await WorldbookLibrary.open({ ...(job.libraryName ? { name: job.libraryName } : {}), ...(factory ? { factory } : {}) });
  if (!opened.ok) return { ok: false, code: opened.code, notices: imported.notices };
  try {
    const installed = await opened.library.install(imported.release, { allowDuplicateContent: job.allowDuplicateContent });
    if (!installed.ok) return { ok: false, code: installed.code, notices: imported.notices };
    const r = installed.release;
    return { ok: true, notices: imported.notices,
      summary: { status: installed.status, bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash, title: r.metadata.title, entryCount: r.entries.length } };
  } finally { opened.library.close(); }
}
