import { DataError } from '../domain/common';
import { AiError } from '../services/ai/errors';

// 正文、变量与世界共用同页锁和取消身份；跨标签页由 SaveRepository 的乐观锁仲裁。
const active = new Map<string, symbol>();
const sessions = new Map<string, symbol>();

// 会话只保留跨阶段的所有权，不持有内部执行锁。手动阶段也检查同一会话表。
export function reserveStageSession(saveId: string) {
  if (active.has(saveId) || sessions.has(saveId))
    throw new DataError('STORY_BUSY', '此存档已有阶段请求，请等待或取消。');
  const id = Symbol('workflow');
  sessions.set(saveId, id);
  return {
    guard: () => new StageGuard({ saveId, id }),
    check: () => {
      if (sessions.get(saveId) !== id) throw new AiError('cancelled');
    },
    release: () => {
      if (sessions.get(saveId) === id) sessions.delete(saveId);
    },
  };
}
export class StageGuard {
  constructor(private session?: { saveId: string; id: symbol }) {}
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
      return await work({
        signal: attempt.controller.signal,
        check,
        saving: () => {
          check();
          attempt.saving = true;
        },
      });
    } finally {
      if (this.attempt === attempt) this.attempt = undefined;
      if (active.get(saveId) === attempt.id) active.delete(saveId);
    }
  }
}
