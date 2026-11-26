import { StoryClock } from '../../presets/tavern/timing';
import { AiError, manualRetryOnly } from './errors';
import { attachFailureDiagnostic } from './failureDiagnostic';

/** Hand the same time origin and cancellation signal from script startup to the upstream request. */
export const preparationSeconds = (timeout: number) => Math.max(10, timeout);
export async function withStoryPreparation<T>(parent: AbortSignal | undefined, clock: StoryClock,
  limits: { idle: number; total: number }, prepareLimit: number, work: (signal: AbortSignal, prepared: () => void) => Promise<T>) {
  if (parent?.aborted) throw new AiError('cancelled');
  clock.first('preparationStartMs');
  const elapsed = clock.elapsed() - clock.marks.preparationStartMs!;
  const local = new AbortController();
  const signal = parent ? AbortSignal.any([parent, local.signal]) : local.signal;
  const failure = new AiError('timeout', undefined, { fieldPath: 'story.preparation' });
  const remaining = Math.min(prepareLimit, limits.total) * 1000 - elapsed;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const expired = new Promise<never>((_, reject) => {
    cancel = () => reject(new AiError('cancelled'));
    parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      clock.deadline();
      clock.marks.timeoutKind = limits.total < prepareLimit ? 'total' : 'preparation';
      manualRetryOnly.add(failure);
      attachFailureDiagnostic(failure, { phase: 'request_build', timeoutKind: clock.marks.timeoutKind,
        idleTimeoutSeconds: limits.idle, totalTimeoutSeconds: limits.total });
      reject(failure);
      local.abort();
    }, Math.max(0, remaining));
  });
  const prepared = () => { clearTimeout(timer); parent?.removeEventListener('abort', cancel); };
  try { return await Promise.race([expired, work(signal, prepared)]); }
  finally { prepared(); }
}
