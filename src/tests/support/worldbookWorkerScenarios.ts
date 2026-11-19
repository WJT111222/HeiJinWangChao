import { runWorldbookTrigger } from '../../domain/worldbook/trigger';
import { EMPTY_TIMED_STATE } from '../../domain/worldbook/timedEffects';
import { importWorldbookValue } from '../../domain/worldbook/importWorldbook';
import type { WorkerTriggerRequest } from '../../domain/worldbook/triggerRequest';
import { WorldbookLibrary } from '../../services/storage/worldbookLibrary';
import { WorldbookTriggerHost, type WorkerPort } from '../../services/worldbook/triggerHost';

/**
 * 真实 Worker 场景（浏览器内运行）：书装进真实的本地书库，由真实 Worker 读取并触发。
 * 端到端测试用默认的 Worker 加载方式（Vite）；本机运行器可传入单独打包的 Worker。
 * 返回观察结果，由调用方断言。只用虚构数据。
 */
export interface WorkerObservation { name: string; value: unknown }

async function installBook(library: WorldbookLibrary, entries: number, keysPer: number, title: string) {
  const book: Record<string, unknown> = {};
  for (let i = 0; i < entries; i++) book[i] = { uid: i, key: Array.from({ length: keysPer }, (_, k) => `词${i}_${k}`), content: `设定${i}`, order: 100 - (i % 50), probability: 80, useProbability: true };
  const imported = await importWorldbookValue({ name: title, entries: book }, { title });
  if (!imported.ok) throw new Error('import failed');
  const installed = await library.install(imported.release);
  if (!installed.ok) throw new Error(`install failed: ${installed.code}`);
  return imported.release;
}

/** 在计算期间统计主线程的定时器回调次数（主线程被占用时回调会被推迟）。 */
async function withTicks<T>(work: () => Promise<T>): Promise<{ value: T; ticks: number; ms: number }> {
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 10);
  const started = performance.now();
  try { const value = await work(); return { value, ticks, ms: Math.round(performance.now() - started) }; }
  finally { clearInterval(timer); }
}

export async function runWorkerScenarios(createWorker?: () => WorkerPort): Promise<WorkerObservation[]> {
  const out: WorkerObservation[] = [];
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw new Error(`library: ${opened.code}`);
  const library = opened.library;
  const small = await installBook(library, 200, 3, '小书');
  const large = await installBook(library, 20_000, 20, '大书');
  library.close();
  const host = new WorldbookTriggerHost(createWorker ? { createWorker } : {});
  const base = { messages: ['词3_1 词40_2 词77_0'], contextTokens: 100_000, storyRemainingTokens: 50_000, trigger: 'normal' as const,
    messageCount: 3, timedState: EMPTY_TIMED_STATE, seed: 'worker-seed' };
  const ref = (r: typeof small) => ({ bookId: r.bookId, versionId: r.versionId, contentHash: r.contentHash });

  // 1. 确定性：与直接调用引擎完全相同
  const req: WorkerTriggerRequest = { ...base, books: [ref(small)] };
  const viaWorker = await host.run(req);
  const direct = runWorldbookTrigger({ ...base, books: [{ bookId: small.bookId, versionId: small.versionId, entries: small.entries }], settings: {} });
  out.push({ name: '确定性', value: viaWorker.status === 'ok' && viaWorker.via === 'worker' && JSON.stringify(viaWorker.result) === JSON.stringify(direct) });

  // 2. 超时：大书在 200 毫秒时被终止；期间主线程照常响应
  const heavy: WorkerTriggerRequest = { ...base, books: [ref(large)], settings: { maxScanWork: 5e8 } };
  const timed = await withTicks(() => host.run(heavy, { timeoutMs: 200 }));
  out.push({ name: '超时', value: { status: timed.value.status, ms: timed.ms, ticks: timed.ticks } });

  // 3. 取消：50 毫秒后取消
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const cancelled = await withTicks(() => host.run(heavy, { signal: controller.signal, timeoutMs: 30_000 }));
  out.push({ name: '取消', value: { status: cancelled.value.status, ms: cancelled.ms, ticks: cancelled.ticks } });

  // 4. 终止后重建：同一请求结果不变
  const again = await host.run(req);
  out.push({ name: '重建后结果不变', value: again.status === 'ok' && JSON.stringify(again.result) === JSON.stringify(direct) });

  // 5. 大书跑完（不超时）：主线程响应情况与耗时
  const full = await withTicks(() => host.run(heavy, { timeoutMs: 30_000 }));
  out.push({ name: '大书在 Worker 中完成', value: { status: full.value.status, ms: full.ms, ticks: full.ticks,
    used: full.value.status === 'ok' ? full.value.result.work.used : null, limit: full.value.status === 'ok' ? full.value.result.work.limit : null } });

  // 6. 缺失的版本：暂停，不改用其他版本
  const missing = await host.run({ ...base, books: [{ ...ref(small), versionId: 'no-such-version' }] });
  out.push({ name: '缺失版本', value: missing.status === 'paused' ? missing.reason : missing.status });
  host.dispose();
  return out;
}
