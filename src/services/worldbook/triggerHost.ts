import type { TriggerResult } from '../../domain/worldbook/trigger';
import {
  checkTriggerRequest, clampTimeout, MAIN_THREAD_FALLBACK_LIMITS, type BookRef, type WorkerTriggerRequest,
} from '../../domain/worldbook/triggerRequest';
import { TriggerExecutor, type PauseReason, type ReleaseLoader, type TriggerReply } from './triggerExecutor';
import type { TriggerJob } from './triggerWorker';

/**
 * 主线程端：把触发请求交给专用 Worker 运行，主线程不做扫描。
 *
 * - **真实取消与超时**：取消或超时直接终止 Worker（连同其缓存），结果立即返回；下次请求重建 Worker。
 * - **一次一个请求**：请求按顺序排队，避免终止 Worker 时误伤其他请求。
 * - **资源上限**：请求先经 checkTriggerRequest 校验并封顶工作量；超时限定在允许范围内。
 * - **无法创建 Worker**：只有经过 CPU 降速实测的小规模请求（MAIN_THREAD_FALLBACK_LIMITS，先读便宜的版本摘要判断）
 *   才在主线程运行，且工作量上限再降到降级值；否则返回 paused，世界书本次不触发，原游戏存档不受影响。
 */
export interface WorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export type TriggerOutcome =
  | { status: 'ok'; result: TriggerResult; via: 'worker' | 'main-thread' }
  | { status: 'paused'; reason: PauseReason; book?: BookRef; detail?: string }
  | { status: 'cancelled' }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'failed'; reason: 'invalid_request' | 'internal' | 'worker_error'; detail?: string };

export interface VersionSize { entryCount: number; keyChars: number; contentChars: number }
export interface MainThreadFallback {
  /** 读取版本摘要（不读条目正文）；不存在时为 null。 */
  size(ref: BookRef): Promise<VersionSize | null>;
  /** 读取版本内容（只在通过规模检查后调用）。 */
  load: ReleaseLoader;
}
export interface TriggerHostOptions {
  /** 只用于测试注入；正式代码使用 triggerWorker.ts。 */
  createWorker?: () => WorkerPort;
  fallback?: MainThreadFallback;
}
export interface RunOptions { signal?: AbortSignal; timeoutMs?: number }

const defaultCreateWorker = (): WorkerPort =>
  new Worker(new URL('./triggerWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort;

function fromReply(reply: TriggerReply, via: 'worker' | 'main-thread'): TriggerOutcome {
  return reply.status === 'ok' ? { status: 'ok', result: reply.result, via } : reply;
}

export class WorldbookTriggerHost {
  private worker: WorkerPort | undefined;
  /** 已证实无法使用 Worker（构造抛错，或启动后未成功回复就报错）。 */
  private workerUnavailable = false;
  private everReplied = false;
  private seq = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private fallbackExecutor: TriggerExecutor | undefined;

  constructor(private readonly options: TriggerHostOptions = {}) {}

  /** 是否正在使用主线程降级（Worker 不可用）。 */
  get degraded(): boolean { return this.workerUnavailable; }

  run(request: WorkerTriggerRequest, options: RunOptions = {}): Promise<TriggerOutcome> {
    const job = this.tail.then(() => this.runNow(request, options));
    this.tail = job.catch(() => undefined);
    return job;
  }

  dispose(): void { this.kill(); }

  private kill() {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
  }

  private ensureWorker(): WorkerPort | undefined {
    if (this.workerUnavailable) return undefined;
    if (this.worker) return this.worker;
    try {
      this.worker = (this.options.createWorker ?? defaultCreateWorker)();
      return this.worker;
    } catch {
      this.workerUnavailable = true;
      return undefined;
    }
  }

  private async runNow(request: WorkerTriggerRequest, options: RunOptions): Promise<TriggerOutcome> {
    const check = checkTriggerRequest(request);
    if (!check.ok) return check.reason === 'too_large'
      ? { status: 'paused', reason: 'too_large', detail: check.detail }
      : { status: 'failed', reason: 'invalid_request', detail: check.detail };
    if (options.signal?.aborted) return { status: 'cancelled' };
    const worker = this.ensureWorker();
    if (!worker) return this.runOnMainThread(check.request, options.signal);
    const timeoutMs = clampTimeout(options.timeoutMs);
    return new Promise<TriggerOutcome>((resolve) => {
      const id = ++this.seq;
      let done = false;
      const finish = (outcome: TriggerOutcome, kill: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (kill) this.kill();
        resolve(outcome);
      };
      const onAbort = () => finish({ status: 'cancelled' }, true);
      const timer = setTimeout(() => finish({ status: 'timeout', timeoutMs }, true), timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent) => {
        const data = event.data as { id?: unknown; reply?: TriggerReply } | null;
        if (!data || data.id !== id || !data.reply) return;
        this.everReplied = true;
        finish(fromReply(data.reply, 'worker'), false);
      };
      const broken = () => {
        if (this.everReplied) { finish({ status: 'failed', reason: 'worker_error' }, true); return; }
        // 启动后从未成功回复就出错（模块加载失败、被安全策略禁止等）：以后不再尝试 Worker，
        // 这一次也直接改走主线程降级（受同样的规模限制；没有降级数据源时暂停），不让第一次请求白白失败。
        this.workerUnavailable = true;
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        this.kill();
        resolve(this.runOnMainThread(check.request, options.signal));
      };
      worker.onerror = broken;
      worker.onmessageerror = () => finish({ status: 'failed', reason: 'worker_error' }, true);
      try { worker.postMessage({ id, kind: 'trigger', request: check.request } satisfies TriggerJob); }
      catch { broken(); }
    });
  }

  /** Worker 不可用时：只运行经过验证的小规模请求，否则暂停。 */
  private async runOnMainThread(request: WorkerTriggerRequest, signal?: AbortSignal): Promise<TriggerOutcome> {
    const fallback = this.options.fallback;
    if (!fallback) return { status: 'paused', reason: 'worker_unavailable' };
    const limits = MAIN_THREAD_FALLBACK_LIMITS;
    let messageChars = 0;
    for (const message of request.messages) messageChars += message.length;
    if (messageChars > limits.maxMessageChars) return { status: 'paused', reason: 'fallback_too_large', detail: 'messages' };
    let entries = 0, keyChars = 0, contentChars = 0;
    for (const ref of request.books) {
      const size = await fallback.size(ref);
      if (!size) return { status: 'paused', reason: 'missing_version', book: ref };
      entries += size.entryCount; keyChars += size.keyChars; contentChars += size.contentChars;
    }
    if (entries > limits.maxTotalEntries || keyChars > limits.maxKeyChars || contentChars > limits.maxContentChars)
      return { status: 'paused', reason: 'fallback_too_large', detail: `entries=${entries} keyChars=${keyChars} contentChars=${contentChars}` };
    if (signal?.aborted) return { status: 'cancelled' };
    this.fallbackExecutor ??= new TriggerExecutor(fallback.load, limits.maxTotalEntries * 4);
    const capped: WorkerTriggerRequest = { ...request, settings: { ...request.settings,
      maxScanWork: Math.min(request.settings?.maxScanWork ?? limits.maxScanWork, limits.maxScanWork) } };
    return fromReply(await this.fallbackExecutor.execute(capped), 'main-thread');
  }
}
