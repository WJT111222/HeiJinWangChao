import { EMPTY_TIMED_STATE } from '../../domain/worldbook/timedEffects';
import type { ActivatedEntry, InjectionPlan, TriggerMode, TriggerResult } from '../../domain/worldbook/trigger';
import type { BookRef } from '../../domain/worldbook/triggerRequest';
import { WorldbookLibrary, type EnabledBook, type LibraryFailureCode } from '../storage/worldbookLibrary';
import { libraryFallback } from './libraryFallback';
import type { PauseReason } from './triggerExecutor';
import { WorldbookTriggerHost, type MainThreadFallback, type TriggerOutcome } from './triggerHost';

/**
 * 正文（Story）接入世界书的唯一入口（简化版，接口说明见 docs/WORLDBOOK_STORY_INTERFACE.md）。
 *
 * - 读取全局启用的书（对所有存档生效），交给触发 Worker 扫描，返回插入计划。
 * - **从不抛出、从不阻塞正文**：除 status 'ok' 以外的任何结果，调用方都应照常生成正文、不带玩家世界书。
 * - 不读写游戏主库，不读写存档；两本内置基础世界书不经过这里，照旧由原有提示词装配。
 * - 计时效果（Sticky / Cooldown）简化版不跨回合保存：每次都以空计时状态运行；Delay 照常按 messageCount 判断。
 */
export interface StoryWorldbookInput {
  /** 可扫描的逻辑消息，最新的在前（玩家行动、已结算正文；不含隐藏状态）。 */
  messages: readonly string[];
  /** 模型上下文窗口（Token）。 */
  contextTokens: number;
  /** Story 请求装配基础提示词后实际剩余的输入预算（Token）。 */
  storyRemainingTokens: number;
  /** 默认 'normal'。重新生成 / 继续等按实际情况传入。 */
  trigger?: TriggerMode;
  /** 当前逻辑消息数，用于 Delay；见 logicalMessageCount。 */
  messageCount: number;
  /** 概率类条目的随机种子，建议“存档 ID + 回合 ID + 第几次尝试”，保证同一次尝试结果可复现。 */
  seed: string;
}
export interface StoryWorldbookRun { signal?: AbortSignal; timeoutMs?: number }

export type StoryWorldbookOutcome =
  /** 没有启用任何玩家世界书：正常情况，不需要任何提示。 */
  | { status: 'off' }
  | {
    status: 'ok';
    plan: InjectionPlan;
    activated: ActivatedEntry[];
    books: EnabledBook[];
    budget: TriggerResult['budget'];
    /** 扫描是否因工作量上限提前结束（结果不完整，但可以照常使用）。 */
    incomplete: boolean;
    via: 'worker' | 'main-thread';
  }
  /** 本次不使用玩家世界书，正文照常生成；message 可直接展示给玩家。 */
  | { status: 'skipped'; reason: StorySkipReason; message: string; book?: BookRef };

export type StorySkipReason = PauseReason | LibraryFailureCode | 'cancelled' | 'timeout' | 'invalid_request' | 'internal' | 'worker_error';

const SKIP_TEXT: Record<StorySkipReason, string> = {
  too_large: '启用的世界书或上下文超过单次扫描上限，本次未使用玩家世界书。',
  missing_version: '有一本启用的世界书在本机书库中找不到，本次未使用玩家世界书。',
  hash_mismatch: '有一本世界书的内容校验未通过，本次未使用玩家世界书，请重新导入。',
  library_unavailable: '本地书库暂不可用，本次未使用玩家世界书。',
  library_missing: '本地书库不存在，本次未使用玩家世界书。',
  library_version_unsupported: '本地书库版本过新，当前页面无法读取，请刷新页面。',
  library_record_invalid: '本地书库记录损坏，本次未使用玩家世界书。',
  worker_unavailable: '浏览器无法在后台扫描世界书，且启用的书较大，本次未使用玩家世界书。',
  fallback_too_large: '浏览器无法在后台扫描世界书，且启用的书较大，本次未使用玩家世界书。',
  unavailable: '本地书库暂不可用，本次未使用玩家世界书。',
  blocked: '本地书库正被其他页面占用，本次未使用玩家世界书。',
  invalid: '本地书库记录损坏，本次未使用玩家世界书。',
  version_conflict: '本地书库读取失败，本次未使用玩家世界书。',
  library_full: '本地书库读取失败，本次未使用玩家世界书。',
  quota: '本地书库读取失败，本次未使用玩家世界书。',
  failed: '本地书库读取失败，本次未使用玩家世界书。',
  not_found: '本地书库读取失败，本次未使用玩家世界书。',
  too_many_enabled: '本地书库读取失败，本次未使用玩家世界书。',
  cancelled: '已取消，本次未使用玩家世界书。',
  timeout: '世界书扫描超时，本次未使用玩家世界书。',
  invalid_request: '世界书请求无效，本次未使用玩家世界书。',
  internal: '世界书扫描出错，本次未使用玩家世界书。',
  worker_error: '世界书后台扫描出错，本次未使用玩家世界书。',
};
const skipped = (reason: StorySkipReason, book?: BookRef): StoryWorldbookOutcome =>
  ({ status: 'skipped', reason, message: SKIP_TEXT[reason], ...(book ? { book } : {}) });

export interface StoryWorldbookDeps {
  /** 只用于测试注入。 */
  openLibrary?: () => ReturnType<typeof WorldbookLibrary.open>;
  host?: Pick<WorldbookTriggerHost, 'run'>;
}

let sharedHost: WorldbookTriggerHost | undefined;
/** 整个页面共用一个触发宿主（一个 Worker，内部按请求排队）。降级时按需打开书库读取。 */
function defaultHost(): WorldbookTriggerHost {
  if (sharedHost) return sharedHost;
  let opened: Promise<MainThreadFallback | null> | undefined;
  const fallback = () => (opened ??= WorldbookLibrary.open().then((r) => (r.ok ? libraryFallback(r.library) : null)));
  sharedHost = new WorldbookTriggerHost({
    fallback: {
      async size(ref) { return (await fallback())?.size(ref) ?? null; },
      async load(ref) { const f = await fallback(); return f ? f.load(ref) : { ok: false, reason: 'unavailable' }; },
    },
  });
  return sharedHost;
}

function fromOutcome(outcome: TriggerOutcome, books: EnabledBook[]): StoryWorldbookOutcome {
  switch (outcome.status) {
    case 'ok': return { status: 'ok', plan: outcome.result.plan, activated: outcome.result.activated, books,
      budget: outcome.result.budget, incomplete: outcome.result.work.exhausted !== undefined, via: outcome.via };
    case 'paused': return skipped(outcome.reason, outcome.book);
    case 'cancelled': return skipped('cancelled');
    case 'timeout': return skipped('timeout');
    case 'failed': return skipped(outcome.reason);
  }
}

export async function prepareStoryWorldbook(
  input: StoryWorldbookInput, run: StoryWorldbookRun = {}, deps: StoryWorldbookDeps = {},
): Promise<StoryWorldbookOutcome> {
  try {
    if (run.signal?.aborted) return skipped('cancelled');
    const opened = await (deps.openLibrary ?? (() => WorldbookLibrary.open()))();
    // 第一次使用时这里会建立空书库（之后 enabledBooks 为空 → off）；打不开说明确实出错，要告诉玩家。
    if (!opened.ok) return skipped(opened.code);
    let books: EnabledBook[];
    try {
      const listed = await opened.library.enabledBooks();
      if (!listed.ok) return skipped(listed.code);
      books = listed.books;
    } finally { opened.library.close(); }
    if (books.length === 0) return { status: 'off' };
    const outcome = await (deps.host ?? defaultHost()).run({
      books: books.map((b) => b.ref),
      messages: [...input.messages],
      contextTokens: input.contextTokens,
      storyRemainingTokens: input.storyRemainingTokens,
      trigger: input.trigger ?? 'normal',
      messageCount: input.messageCount,
      timedState: EMPTY_TIMED_STATE,
      seed: input.seed,
      settings: undefined,
    }, run);
    return fromOutcome(outcome, books);
  } catch {
    return skipped('internal');
  }
}
