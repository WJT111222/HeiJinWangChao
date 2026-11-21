import { runImportJob, type ImportJob, type ImportJobReply } from './libraryJob';
import type { WorkerPort } from './triggerHost';

/**
 * 主线程端：把“导入并安装世界书文件”交给一次性的书库 Worker，管理界面不冻结。
 * - 取消或超时直接终止 Worker；已写入的书库事务要么完整提交、要么回滚（IndexedDB 事务），不会留下半本书。
 * - 无法创建 Worker 时，只有很小的文件（≤ IMPORT_MAIN_THREAD_MAX_CHARS）才在主线程处理；否则明确拒绝。
 */
export const IMPORT_MAIN_THREAD_MAX_CHARS = 256 * 1024;
export const IMPORT_TIMEOUT_MS = 120_000;
export type ImportOutcome = ImportJobReply | { ok: false; code: 'cancelled' | 'timeout' | 'worker_unavailable' | 'worker_error'; notices: [] };

const defaultCreateWorker = (): WorkerPort =>
  new Worker(new URL('./libraryWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort;

export async function importIntoLibrary(
  text: string,
  options: { title?: string; allowDuplicateContent?: boolean; libraryName?: string } = {},
  run: { signal?: AbortSignal; timeoutMs?: number; createWorker?: () => WorkerPort; /** 只用于测试主线程降级。 */ factory?: IDBFactory } = {},
): Promise<ImportOutcome> {
  if (run.signal?.aborted) return { ok: false, code: 'cancelled', notices: [] };
  const job: ImportJob = { id: 1, kind: 'import-install', text, ...options };
  let worker: WorkerPort;
  try { worker = (run.createWorker ?? defaultCreateWorker)(); }
  catch {
    if (text.length > IMPORT_MAIN_THREAD_MAX_CHARS) return { ok: false, code: 'worker_unavailable', notices: [] };
    return runImportJob(job, run.factory);
  }
  const timeoutMs = Math.max(200, run.timeoutMs ?? IMPORT_TIMEOUT_MS);
  return new Promise<ImportOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: ImportOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      resolve(outcome);
    };
    const onAbort = () => finish({ ok: false, code: 'cancelled', notices: [] });
    const timer = setTimeout(() => finish({ ok: false, code: 'timeout', notices: [] }), timeoutMs);
    run.signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id?: unknown; reply?: ImportJobReply } | null;
      if (data?.id === job.id && data.reply) finish(data.reply);
    };
    worker.onerror = () => finish({ ok: false, code: 'worker_error', notices: [] });
    worker.onmessageerror = () => finish({ ok: false, code: 'worker_error', notices: [] });
    try { worker.postMessage(job); } catch { finish({ ok: false, code: 'worker_error', notices: [] }); }
  });
}
