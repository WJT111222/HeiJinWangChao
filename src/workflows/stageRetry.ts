import { AiError, manualRetryOnly } from '../services/ai/errors';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { freeze } from '../services/ai/snapshot';
import type { CompanionProfile } from '../services/local/companionProfile';
import { browserPromptOrder } from '../prompts/order';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';

/** 自动重试次数不含首次请求。开启后最多 3 次。 */
export const AUTO_RETRY_CHOICES = [1, 3] as const;
export type AutoRetryChoice = (typeof AUTO_RETRY_CHOICES)[number];
export const RETRY_BACKOFF_START_MS = 3_000;
export const RETRY_BACKOFF_CAP_MS = 30_000;
/** 超过此时长的 Retry-After 不再空等，停下来交给玩家。 */
export const RETRY_AFTER_MAX_MS = 120_000;
/** 测试可把 scale 设为 0，跳过真实等待。生产环境保持 1。 */
export const retryDelays = { scale: 1 };
function scaled(ms: number) {
  return Math.round(ms * retryDelays.scale);
}

/** 不是生成失败，重试也没有意义：取消、密钥、配置、明确额度不足、存档冲突、保存失败。 */
const NOT_GENERATION = new Set([
  'cancelled', 'configuration', 'credentials', 'authorization', 'not_found', 'unsupported',
  'parameter_adjusted', 'resource', 'placeholder', 'storage', 'variable_runtime',
  'data_integrity', 'amount_balance', 'time_data', 'candidate_conflict', 'permission',
  'event_entry', 'time_preflight', 'money_unit', 'concurrency_unavailable',
  'model_list_format', 'model_list_pagination',
]);

export interface RetryNotice {
  /** 即将开始的自动重试序号，从 1 起，不含首次请求。 */
  count: number;
  max: number;
  reason: string;
  remainingMs: number;
}

export function transientStageError(error: unknown) {
  return (
    error instanceof AiError &&
    error.code === 'server' && !manualRetryOnly.has(error) &&
    [500, 502, 503, 504].includes(error.status ?? 0)
  );
}

/** 开启扩展后：生成失败都会重试，不限于 500/502/503/504。
 * 凭证回显和请求/草稿版本冲突不是可再生成的失败。 */
export function extendedStageRetryable(error: unknown) {
  if (!(error instanceof AiError) || manualRetryOnly.has(error) || error.details?.quota === true) return false;
  const storyRule = error.details?.storyRule;
  if (storyRule === 'credential_output' || storyRule === 'request_basis' || storyRule === 'draft_conflict') return false;
  const worldRule = error.details?.worldRule;
  if (worldRule === 'secret_in_output' || worldRule === 'request_basis') return false;
  return !NOT_GENERATION.has(error.code);
}

/** 本次运行的设置、渠道、密钥和提示词顺序。重试不得再读之后改过的本地配置。 */
export function captureRunInputs(input: {
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
}) {
  const settings = freeze(SettingsSchema.parse(input.settings));
  const config = freeze(AiConfigSchema.parse(input.config));
  const memory = new Map<string, string>();
  const store = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
  const vault = new CredentialVault(store, store);
  for (const channel of config.channels) vault.set(channel.id, input.vault.get(channel.id));
  return {
    settings,
    config,
    vault,
    companionProfile: input.companionProfile && freeze(structuredClone(input.companionProfile)),
    orderPreferences: freeze(structuredClone(browserPromptOrder())),
  };
}

/** 写入失败记录的“这类错误可自动重试”，与本次预算是否还够无关。 */
export function recordedRetryable(error: unknown, settings: Settings) {
  const parsed = SettingsSchema.safeParse(settings);
  if (!parsed.success) return false;
  return parsed.data.runtime.failureAutoRetry ? extendedStageRetryable(error) : transientStageError(error);
}

export function backoffMs(retryIndex: number) {
  const step = Math.max(0, retryIndex - 1);
  return Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_START_MS * 2 ** step);
}

export type RetryPlan =
  | { action: 'wait'; ms: number; retryIndex: number; max: number; reason: string }
  | { action: 'stop'; reason: 'budget' | 'not_retryable' | 'retry_after' };

export function planRetry(error: unknown, settings: Settings, failedAttempt: number): RetryPlan {
  const extended = settings.runtime.failureAutoRetry;
  const max = extended ? Math.min(3, settings.runtime.maxAutoRetries) : 1;
  const retryable = extended ? extendedStageRetryable(error) : transientStageError(error);
  if (!retryable) return { action: 'stop', reason: 'not_retryable' };
  if (failedAttempt > max) return { action: 'stop', reason: 'budget' };
  const reason = error instanceof AiError ? error.message : '生成失败';
  if (!extended) return { action: 'wait', ms: 0, retryIndex: failedAttempt, max, reason };
  const header = error instanceof AiError ? error.details?.retryAfterMs : undefined;
  if (typeof header === 'number') {
    if (header > RETRY_AFTER_MAX_MS) return { action: 'stop', reason: 'retry_after' };
    return { action: 'wait', ms: scaled(Math.max(0, header)), retryIndex: failedAttempt, max, reason };
  }
  return { action: 'wait', ms: scaled(backoffMs(failedAttempt)), retryIndex: failedAttempt, max, reason };
}

export function retryStopError(error: AiError) {
  return new AiError(error.code, error.status, {
    ...error.details,
    fieldPath: error.details?.fieldPath ?? 'channel.retry_after',
  });
}

export async function waitForRetry(ms: number, signal: AbortSignal, onTick: (remainingMs: number) => void) {
  if (signal.aborted) throw new AiError('cancelled');
  if (ms <= 0) {
    onTick(0);
    return;
  }
  const end = Date.now() + ms;
  while (true) {
    if (signal.aborted) throw new AiError('cancelled');
    const remaining = Math.max(0, end - Date.now());
    onTick(remaining);
    if (remaining <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, Math.min(remaining, 1_000));
      const abort = () => {
        clearTimeout(timer);
        reject(new AiError('cancelled'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
}

/** 手动阶段与协调器共用的单层重试。run 本身不得再自动重试。 */
export async function executeWithAutoRetry<T>(options: {
  settings: Settings;
  signal: AbortSignal;
  run: () => Promise<T>;
  onFailure: (error: unknown) => void;
  onRetry: (notice: RetryNotice) => void;
}): Promise<T> {
  const settings = SettingsSchema.parse(options.settings);
  for (let attempt = 1; ; attempt += 1) {
    if (options.signal.aborted) throw new AiError('cancelled');
    try {
      return await options.run();
    } catch (error) {
      if (options.signal.aborted || (error instanceof AiError && error.code === 'cancelled')) {
        throw error instanceof AiError ? error : new AiError('cancelled');
      }
      const plan = planRetry(error, settings, attempt);
      const reported = plan.action === 'stop' && plan.reason === 'retry_after' && error instanceof AiError
        ? retryStopError(error) : error;
      options.onFailure(reported);
      if (plan.action === 'stop') throw reported;
      await waitForRetry(plan.ms, options.signal, (remainingMs) => {
        options.onRetry({ count: plan.retryIndex, max: plan.max, reason: plan.reason, remainingMs });
      });
    }
  }
}
