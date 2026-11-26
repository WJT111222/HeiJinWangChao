import type { LegacyContinuationConsent } from './legacyContinuation';
import { completeTurnDraft, settlementDraft } from '../domain/turnCommit';
import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { TurnDraftSchema, configureTurnStages } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { browserPromptOrder } from '../prompts/order';
import type { OrderPreferences } from '../prompts/order';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig, AiStage } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { AiError, isContinuationDeliveryUnknown } from '../services/ai/errors';
import { freeze, requestSnapshot } from '../services/ai/snapshot';
import type { CompanionProfile } from '../services/local/companionProfile';
import type { SaveRepository } from '../services/storage/saveRepository';
import { parseVariables, revalidateWorld } from '../services/validation/aiOutputs';
import { requireOpeningSettlement } from '../services/validation/turnCommit';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { reserveStageSession, withBrowserLock } from './stageGuard';
import { StoryStage, storyPartialAfterFailure } from './storyStage';
import { canContinueStory, storyPartialVisible } from '../domain/storyContinuation';
import { VariableStage } from './variableStage';
import { WorldStage } from './worldStage';
import { planRetry, recordedRetryable, retryStopError, waitForRetry, extendedStageRetryable, transientStageError } from './stageRetry';
import { carryFailureDiagnostic, markRetryIssued, noteRetryDecision } from '../services/ai/failureDiagnostic';
import type { RetryNotice } from './stageRetry';

export { transientStageError } from './stageRetry';

type Repository = Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft'>;
export interface TurnProgress {
  stage: AiStage;
  phase: 'generating' | 'saving' | 'retrying';
  /** 含首次请求。1 是第一次，之后为自动重试。 */
  attempt: number;
  retry?: RetryNotice;
  narrative?: string;
  readingPhase?: 'thinking' | 'body' | 'waiting';
  planning?: string;
  nativeReasoning?: string;
  compatibilityReasoning?: string;
}
export interface TurnOutcome {
  draft: TurnDraft;
  status: 'complete' | 'skipped' | 'preview';
  skipped: AiStage[];
}
export interface TurnInput {
  consent?: LegacyContinuationConsent;
  draft: TurnDraft;
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
  orderPreferences?: OrderPreferences;
  onDraft?: (draft: TurnDraft) => void;
  onProgress?: (progress: TurnProgress) => void;
  /** 每一次实际失败的请求都会通知，包括随后自动重试成功的那一次。 */
  onAttemptFailure?: (stage: AiStage, error: unknown) => void;
}
interface ActiveTurn {
  cancelled: boolean;
  controller: AbortController;
  savingFailure?: boolean;
  stage?: StoryStage | VariableStage | WorldStage;
  release: () => void;
}
// 网络错误可能是固定 CORS/TLS/地址问题，429 也可能是额度耗尽；扩展关闭时不据此盲目自动付费重试。
// 扩展开启后，生成失败都会重试，最多 3 次；分类在 stageRetry。

export class TurnCoordinator {
  private attempt?: ActiveTurn;
  constructor(
    private repository: Repository,
    private client = new AiClient(),
  ) {}

  cancel() {
    const attempt = this.attempt;
    if (!attempt) return true;
    if (attempt.savingFailure) return false;
    if (attempt.stage && !attempt.stage.cancel()) return false;
    attempt.cancelled = true;
    attempt.controller.abort();
    return true;
  }
  dispose() {
    const attempt = this.attempt;
    if (!attempt) return;
    attempt.cancelled = true;
    attempt.controller.abort();
    attempt.stage?.dispose();
    attempt.release();
  }

  async generate(input: TurnInput): Promise<TurnOutcome> {
    if (this.attempt) throw new DataError('STORY_BUSY', '此存档已有工作流');
    input.consent?.check(input.draft);
    const session = reserveStageSession(input.draft.saveId);
    const attempt: ActiveTurn = {
      cancelled: false,
      controller: new AbortController(),
      release: session.release,
    };
    this.attempt = attempt;
    const check = () => {
      session.check();
      if (attempt.cancelled || this.attempt !== attempt) throw new AiError('cancelled');
    };
    try {
      // 凭证也复制到独立内存库；后续设置修改、密钥删除不会改变正在执行的尝试。
      const settings = freeze(SettingsSchema.parse(input.settings));
      const config = freeze(AiConfigSchema.parse(input.config));
      const orderPreferences = freeze(
        structuredClone(input.orderPreferences ?? browserPromptOrder()),
      );
      const companionProfile =
        input.companionProfile && freeze(structuredClone(input.companionProfile));
      const keys = new Map<string, string>();
      const store = {
        getItem: (key: string) => keys.get(key) ?? null,
        setItem: (key: string, value: string) => {
          keys.set(key, value);
        },
        removeItem: (key: string) => {
          keys.delete(key);
        },
      };
      const vault = new CredentialVault(store, store);
      for (const channel of config.channels) vault.set(channel.id, input.vault.get(channel.id));
      let draft = TurnDraftSchema.parse(input.draft);
      return await withBrowserLock(input.draft.saveId, async (scope) => {
        const reread = async () => {
          const [state, stored] = await Promise.all([
            this.repository.load(draft.saveId),
            this.repository.loadDraft(draft.saveId),
          ]);
          check();
          if (
            !stored ||
            fingerprint(stored) !== fingerprint(draft) ||
            state.revision !== draft.baseSaveRevision ||
            state.journal.some((entry) => entry.turnId === draft.turnId) ||
            (draft.turnKind === 'opening' && state.turnNumber !== 0)
          )
            throw new DataError('DRAFT_CONFLICT', '存档或草稿已改变，请重新读取');
          draft = stored;
          return state;
        };
        const state = await reread();
        const storyReady = () => Boolean(draft.story && draft.stageStatus.story === 'ready');
        const variableReady = () =>
          draft.stageStatus.variables === 'ready' && draft.variables?.validation === 'validated';
        const worldReady = () =>
          ['ready', 'preview'].includes(draft.stageStatus.world) && Boolean(draft.world);
        // 复用之前的结果前重新执行安全验证，不只信任持久化的 validated 字样。
        if (variableReady()) parseVariables(JSON.stringify(draft.variables!.result), state, draft);
        if (worldReady()) revalidateWorld(state, draft);
        const needed: AiStage[] = [];
        if (!storyReady()) needed.push('story');
        if (settings.runtime.useVariableStage && (!variableReady() || needed.includes('story')))
          needed.push('variables');
        if (
          settings.runtime.useWorldStage &&
          (!worldReady() || needed.includes('variables') || needed.includes('story'))
        )
          needed.push('world');
        // 全部所需路由及凭证在首次付费前检查，关闭/已经合法完成的阶段不要求配置。
        if (needed.includes('story') && storyPartialVisible(draft) && !draft.storyPartial?.writing
          && (!input.consent || !canContinueStory(draft, settings.prompts.minNarrativeChars)))
          throw new AiError('configuration', undefined, { fieldPath: 'tavern.writing_unknown' });
        for (const stage of needed) requestSnapshot(config, stage, vault);
        // 在同一执行锁内CAS保存本次设置，之后所有阶段只使用此快照。
        const configured = configureTurnStages(draft, settings.runtime);
        if (!input.consent && configured.draftRevision !== draft.draftRevision) {
          draft = await this.repository.saveDraft(configured, draft.draftRevision, attempt.controller.signal, draft);
          check();
          input.onDraft?.(draft);
        }
        // 本次运行是否续写在开始时固定（玩家点「续写正文」）：自动重试也只能续写，绝不悄悄改成从头生成。
        const continueStory = canContinueStory(draft, settings.prompts.minNarrativeChars);
        const secrets = config.channels.map((channel) => vault.get(channel.id)).filter(Boolean);
        const story = new StoryStage(this.repository, this.client, session.guard(scope));
        const variables = new VariableStage(this.repository, this.client, session.guard(scope));
        const world = new WorldStage(this.repository, this.client, session.guard(scope));
        const saved = (next: TurnDraft) => {
          check();
          draft = next;
          input.onDraft?.(next);
        };
        for (const stage of needed) {
          let previousFailure: unknown;
          for (let number = 1; ; number += 1) {
            await reread();
            check();
            if (previousFailure) markRetryIssued(previousFailure);
            const onProgress = (phase: 'generating' | 'saving', narrative?: string) => {
              check();
              input.onProgress?.({ stage, phase, attempt: number, narrative });
            };
            try {
              const common = { draft, settings, config, vault, orderPreferences };
              if (stage === 'story') {
                attempt.stage = story;
                saved(
                  await story.generate({
                    ...common,
                    companionProfile,
                    continuation: continueStory, consent: input.consent,
                    onProgress: (progress) => {
                      check();
                      input.onProgress?.({ stage, attempt: number, ...progress });
                    },
                  }),
                );
                if (input.consent) {
                  const next = configureTurnStages(draft, settings.runtime);
                  if (next.draftRevision !== draft.draftRevision)
                    saved(await this.repository.saveDraft(next, draft.draftRevision, attempt.controller.signal, draft));
                }
              } else {
                const runner = stage === 'variables' ? variables : world;
                attempt.stage = runner;
                saved(await runner.generate({ ...common, onDraft: saved, onProgress }));
              }
              check();
              attempt.stage = undefined;
              break;
            } catch (error) {
              check();
              attempt.stage = undefined;
              if (stage === 'story' && input.consent && !input.consent.sent) throw error;
              const continuationStops = stage === 'story' && (Boolean(input.consent) || continueStory && error instanceof AiError && error.code !== 'cancelled'
                && !canContinueStory({
                  ...draft,
                  stageStatus: { ...draft.stageStatus, story: 'failed' },
                  storyPartial: storyPartialAfterFailure(draft, error, true, secrets),
                }, settings.prompts.minNarrativeChars));
              if (!(error instanceof AiError && error.code === 'cancelled')) {
                const plan = continuationStops ? { action: 'stop' as const, reason: 'not_retryable' as const } : planRetry(error, settings, number);
                noteRetryDecision(error, settings, number, plan, settings.runtime.failureAutoRetry ? extendedStageRetryable(error) : transientStageError(error));
                input.onAttemptFailure?.(stage, error);
              }
              if (stage === 'story' && input.consent && isContinuationDeliveryUnknown(error)) throw error;
              if (stage === 'story' && error instanceof AiError && error.code !== 'cancelled') {
                // 原 StoryStage 只保存成功正文；协调器额外记录安全失败码，刷新后仍可恢复。
                await reread();
                const failed = TurnDraftSchema.parse({
                  ...draft,
                  draftRevision: draft.draftRevision + 1,
                  storyPartial: storyPartialAfterFailure(draft, error, continueStory, secrets),
                  stageStatus: { ...draft.stageStatus, story: 'failed' },
                  failures: [
                    ...draft.failures,
                    {
                      stage,
                      attempt: number,
                      storyRevision: draft.storyRevision,
                      errorCode: error.code,
                      retryable: recordedRetryable(error, settings),
                    },
                  ],
                });
                attempt.savingFailure = true;
                try {
                  saved(
                    await this.repository.saveDraft(
                      failed,
                      draft.draftRevision,
                      attempt.controller.signal,
                      draft,
                    ),
                  );
                } finally {
                  attempt.savingFailure = false;
                }
              }
              // 续写次数已用完：停下并保留已写部分，由玩家决定是否重新生成。
              if (stage === 'story' && (input.consent || continueStory && !canContinueStory(draft, settings.prompts.minNarrativeChars))) throw error;
              const plan = planRetry(error, settings, number);
              if (plan.action === 'stop') {
                const stopped = plan.reason === 'retry_after' && error instanceof AiError ? retryStopError(error) : error;
                if (stopped !== error) carryFailureDiagnostic(error, stopped);
                throw stopped;
              }
              previousFailure = error;
              // 失败记录由原执行器 CAS 保存；如果其他标签已写入，不能接受它的新版本重试。
              await reread();
              await waitForRetry(plan.ms, attempt.controller.signal, (remainingMs) => {
                check();
                input.onProgress?.({
                  stage,
                  phase: 'retrying',
                  attempt: number + 1,
                  retry: { count: plan.retryIndex, max: plan.max, reason: plan.reason, remainingMs },
                });
              });
            }
          }
        }
        const finalState = await reread();
        const complete = completeTurnDraft(draft);
        if (complete && finalState.openingTimePending) requireOpeningSettlement(finalState, settlementDraft(draft));
        const skipped: AiStage[] = [];
        if (draft.stageStatus.variables === 'skipped') skipped.push('variables');
        if (draft.stageStatus.world === 'skipped') skipped.push('world');
        return {
          draft,
          skipped,
          status: complete ? 'complete' : draft.world?.validation === 'preview' ? 'preview' : 'skipped',
        };
      }, { required: true });
    } finally {
      attempt.release();
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }
}
