import { DataError } from '../domain/common';
import { AiError } from '../services/ai/errors';

// 正文、变量与世界共用同页锁和取消身份；跨标签页由 SaveRepository 的乐观锁仲裁。
const active = new Map<string, symbol>();
export class StageGuard {
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
    if (this.attempt || active.has(saveId))
      throw new DataError('STORY_BUSY', '此存档已有阶段请求，请等待或取消。');
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
        active.get(saveId) !== attempt.id
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
