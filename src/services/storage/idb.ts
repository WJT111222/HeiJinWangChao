import { DataError } from '../../domain/common';

export function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

export async function transaction<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const tx = database.transaction(stores, mode);
  const abort = () => { try { tx.abort(); } catch { /* 已提交或中止。 */ } };
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DataError('TRANSACTION_ABORTED', '事务已回滚'));
    tx.onerror = () => { /* onabort 统一报告，禁止提前把 request 成功当作提交成功。 */ };
  });
  // 及时安装拒绝处理；work 中仅等待同一事务的 IDB 请求，不能等待网络或定时器。
  void done.catch(() => undefined);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* 已经完成或中止。 */ }
    await done.catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
