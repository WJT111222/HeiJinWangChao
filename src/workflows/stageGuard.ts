import { DataError } from '../domain/common';
import { AiError } from '../services/ai/errors';

// 同页会话防重入；浏览器 Web Lock 在付费请求前互斥，CAS 另外保护迟到写入。
const active = new Map<string, symbol>();
const sessions = new Map<string, symbol>();
// 只在 withBrowserLock 的回调期间有效，不能用本页正在持锁的事实授权其他调用。
export type BrowserLockScope = object;
const lockScopes = new WeakMap<BrowserLockScope, string>();

// 会话只保留跨阶段的所有权，不持有内部执行锁。手动阶段也检查同一会话表。
export function reserveStageSession(saveId: string) {
  if (active.has(saveId) || sessions.has(saveId))
    throw new DataError('STORY_BUSY', '此存档已有阶段请求，请等待或取消。');
  const id = Symbol('workflow');
  sessions.set(saveId, id);
  return {
    guard: (scope: BrowserLockScope) => new StageGuard({ saveId, id, scope }),
    check: () => {
      if (sessions.get(saveId) !== id) throw new AiError('cancelled');
    },
    release: () => {
      if (sessions.get(saveId) === id) sessions.delete(saveId);
    },
  };
}
export class StageGuard {
  constructor(private session?: { saveId: string; id: symbol; scope: BrowserLockScope }) {}
  private attempt?: { id: symbol; saveId: string; controller: AbortController; saving: boolean };
  cancel() {
    if (this.attempt?.saving) return false;
    this.dispose();
    return true;
  }
  dispose() {
    const attempt = this.attempt;
    if (!attempt) return;
    this.attempt = undefined;
    attempt.controller.abort();
    if (active.get(attempt.saveId) === attempt.id) active.delete(attempt.saveId);
  }
  async run<T>(
    saveId: string,
    work: (attempt: { signal: AbortSignal; check: () => void; saving: () => void }) => Promise<T>,
  ): Promise<T> {
    if (
      this.attempt ||
      active.has(saveId) ||
      (sessions.has(saveId) && sessions.get(saveId) !== this.session?.id)
    )
      throw new DataError('STORY_BUSY', '此存档已有阶段请求，请等待或取消。');
    if (
      this.session &&
      (this.session.saveId !== saveId || sessions.get(saveId) !== this.session.id)
    )
      throw new AiError('cancelled');
    const attempt = {
      id: Symbol('stage'),
      saveId,
      controller: new AbortController(),
      saving: false,
    };
    this.attempt = attempt;
    active.set(saveId, attempt.id);
    const check = () => {
      if (
        this.attempt !== attempt ||
        attempt.controller.signal.aborted ||
        active.get(saveId) !== attempt.id ||
        (this.session && sessions.get(saveId) !== this.session.id)
      )
        throw new AiError('cancelled');
    };
    try {
      const run = () => {
        check();
        return work({ signal: attempt.controller.signal, check,
          saving: () => { check(); attempt.saving = true; } });
      };
      if (this.session) {
        // Coordinator 已在外层持有整轮锁；只复用传入的有效作用域，避免嵌套抢同一把锁。
        if (lockScopes.get(this.session.scope) !== saveId) throw new AiError('concurrency_unavailable');
        return await run();
      }
      // 手动 Story/Variables/World 也必须在读取草稿、写入或发送前取得同一把锁。
      return await withBrowserLock(saveId, run, { required: true });
    } finally {
      if (this.attempt === attempt) this.attempt = undefined;
      if (active.get(saveId) === attempt.id) active.delete(saveId);
    }
  }
}

export async function withBrowserLock<T>(
  saveId: string,
  work: (scope: BrowserLockScope) => Promise<T>,
  options?: { required: boolean },
): Promise<T> {
  const run = async () => {
    const scope: BrowserLockScope = {};
    lockScopes.set(scope, saveId);
    try { return await work(scope); }
    finally { lockScopes.delete(scope); }
  };
  if (typeof navigator !== 'undefined' && navigator.locks) {
    let entered = false;
    try {
      return await navigator.locks.request(`heijin.turn:${saveId}`, { ifAvailable: true }, (lock) => {
        if (!lock) throw new DataError('STORY_BUSY', '其他标签正在执行此存档的工作流');
        entered = true;
        return run();
      });
    } catch (error) {
      // 浏览器禁用锁 API 时同样不降级；回调内的业务/CAS 错误保持原样。
      if (!entered && !(error instanceof DataError)) throw new AiError('concurrency_unavailable');
      throw error;
    }
  }
  // 浏览器的重绑与请求必须有真实互斥。非浏览器领域/仓库测试保留原有执行方式。
  // 其他既有仓库操作仍沿用其原有 CAS，不在本次扩展存储/撤回协议。
  if (options?.required && typeof window !== 'undefined') throw new AiError('concurrency_unavailable');
  return run();
}
