import { DataError, requireData } from '../../../domain/common';
import type { GameState } from '../../../domain/state';
import { migrateSave } from '../migrations';
import { encodeHistory, decodeHistory, exportHistory } from './codec';
import type { HistoryPayload } from './codec';
export type CodecJob = { kind: 'encode'; state: GameState } | { kind: 'decode'; payload: HistoryPayload } | { kind: 'parse'; json: string } | { kind: 'export'; state: GameState; app: string };
const fallbackBytes = 2 * 1024 * 1024;
export function historyCodec(job: { kind: 'export'; state: GameState; app: string }): Promise<string>;
export function historyCodec(job: { kind: 'encode'; state: GameState }): Promise<HistoryPayload>;
export function historyCodec(job: { kind: 'decode'; payload: HistoryPayload } | { kind: 'parse'; json: string }): Promise<GameState>;
export async function historyCodec(job: CodecJob): Promise<GameState | HistoryPayload | string> {
  if (typeof Worker === 'undefined') {
    // Node repository tests use the exact codec. A browser without Workers only
    // handles small records; no disguised multi-second main-thread fallback.
    if (typeof window !== 'undefined') {
      requireData(job.kind !== 'encode' && job.kind !== 'export', 'HISTORY_WORKER_UNAVAILABLE', '浏览器不支持后台处理，暂不能创建历史收藏；原存档未修改');
      const size = job.kind === 'decode' ? job.payload.rawBytes : job.json.length * 3;
      requireData(size <= fallbackBytes, 'HISTORY_WORKER_UNAVAILABLE', '浏览器不支持后台处理，此大节点暂不能保存或读取；请使用新版浏览器');
    }
    return job.kind === 'export' ? exportHistory(job.state, job.app)
      : job.kind === 'encode' ? encodeHistory(job.state) : job.kind === 'decode' ? decodeHistory(job.payload) : migrateSave(JSON.parse(job.json));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new DataError('HISTORY_WORKER_UNAVAILABLE', '后台历史处理不可用，原存档未修改')); return; }
    const fail = (code = 'HISTORY_CORRUPT') => { clearTimeout(timeout); worker.terminate(); reject(new DataError(code,
      code === 'HISTORY_TOO_LARGE' ? '历史节点或导出文件超过 256 MiB 安全上限，原收藏保留。' : '历史数据处理失败，原存档未修改；请刷新列表或更换新版浏览器')); };
    const timeout = setTimeout(() => fail('HISTORY_PROCESS_TIMEOUT'), 120000);
    worker.onerror = () => fail('HISTORY_WORKER_UNAVAILABLE'); worker.onmessageerror = () => fail();
    worker.onmessage = ({ data }) => {
      if (!data.ok) { fail(typeof data.code === 'string' ? data.code : undefined); return; }
      clearTimeout(timeout); worker.terminate(); resolve(data.result);
    };
    worker.postMessage(job);
  });
}
