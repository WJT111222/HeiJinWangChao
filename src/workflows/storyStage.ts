import { oracleId } from '../presets/meowssiah/definition';
import type { LegacyContinuationConsent } from './legacyContinuation';
import { usesSpreset } from '../presets/spreset/definition';
import { withWorldbookLibrary, type StoryWorldview } from '../services/worldbook/mainWorldview';
import { nativeDeliveryId } from '../presets/settings';
import { StoryClock } from '../presets/tavern/timing';
import { awaitAssistant, assistantStarting, captureAssistantPreferences } from '../presets/tavern/hostState';
import { stageResponses, safeStreamResponseText, safeResponseText } from '../services/ai/stageResponses';
import { storyFailure, storySchemaError } from '../services/validation/storyDiagnostics';
import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import type { LegacyNotificationSelection } from '../domain/events/legacyNotification';
import { authorizeLegacyNotificationRecovery, validateRecoveredStory } from '../domain/legacyNotificationRecovery';
import { StorySchema } from '../domain/state';
import type { CompanionProfile } from '../services/local/companionProfile';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { requestSnapshot } from '../services/ai/snapshot';
import { AiConfigSchema } from '../services/ai/configuration';
import { storyInspections } from '../services/ai/storyInspection';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError, isContinuationDeliveryUnknown, safeAiError } from '../services/ai/errors';
import { redactInspection } from '../services/ai/inspection';
import { recordedRetryable } from './stageRetry';
import { runStageRequest, storyFailureText } from '../services/ai/runtime';
import { canContinueStory, ContinuationPreview, nextStoryPartial, trimIncompleteTag } from '../domain/storyContinuation';
import { preparationSeconds, withStoryPreparation } from '../services/ai/storyPreparation';
import { SettingsSchema, storyStreamLimits } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { StoryStream } from './storyStream';
import { StageGuard } from './stageGuard';
import type { OrderPreferences } from '../prompts/order';

type Repository = Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft' | 'prepareWorldview'>
  & Partial<Pick<SaveRepository,'saveRecoveredStory' | 'recentStoryActions' | 'readOracleNote'>>;
export interface StoryProgress {
  phase: 'generating' | 'saving' | 'retrying';
  narrative: string;
  readingPhase?: 'thinking' | 'body' | 'waiting';
  planning?: string;
  nativeReasoning?: string;
  compatibilityReasoning?: string;
}
interface StoryInput {
  expectedInstance?: string | null;
  draft: TurnDraft;
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
  orderPreferences?: OrderPreferences;
  onProgress?: (progress: StoryProgress) => void;
  /** Persist a failed attempt and its source before notifying the active runner. */
  onFailureSaved?: (draft: TurnDraft) => void;
  /** 从草稿里保存的截断原文接着写（玩家点「续写正文」）。 */
  continuation?: boolean;
  consent?: LegacyContinuationConsent;
  /** Explicit replacement starts from current settings, including recovery of an unbound draft. */
  freshWorldview?: boolean;
  automaticRetry?: boolean;
  /** Shared only by the attempts of one explicit replacement while its stage lock is held. */
  replacementRetry?: { pending?: StoryWorldview };
  legacyNotificationSelection?: LegacyNotificationSelection;
}

/** 正文失败后应写入草稿的截断原文（已隐藏凭证；含凭证时不保存）。 */
export function storyPartialAfterFailure(draft: TurnDraft, error: AiError, continuation: boolean, secrets: readonly string[]): TurnDraft['storyPartial'] {
  const raw = storyFailureText.get(error);
  const leaked = raw !== undefined && secrets.some((secret) => secret && raw.text.includes(secret));
  const received = raw === undefined ? undefined : leaked ? { text: '', produced: raw.produced } : { ...raw, text: safeResponseText(raw.text, secrets) };
  const storyRule = typeof error.details?.storyRule === 'string' ? error.details.storyRule : undefined;
  return nextStoryPartial(draft, { code: error.code, storyRule }, received, continuation);
}
export class StoryStage {
  private presetAtFirstAttempt?: string;
  constructor(
    private repository: Repository,
    private client = new AiClient(),
    private guard = new StageGuard(),
  ) {}

  cancel() {
    return this.guard.cancel();
  }
  dispose() {
    this.guard.dispose();
  }
  async generate(input: StoryInput): Promise<TurnDraft> {
    const started = performance.now();
    const expected = TurnDraftSchema.parse(input.draft);
    const allowNativeDelivery = !input.continuation && !input.legacyNotificationSelection;
    let presetSelection = captureAssistantPreferences(allowNativeDelivery);
    const clock = presetSelection ? new StoryClock(started) : undefined;
    const waitingForScripts = assistantStarting();
    if (clock) {
      clock.marks.waitedForInitialization = Boolean(waitingForScripts);
      if (!waitingForScripts) clock.first('assistantReadyMs');
    }
    const selection = input.legacyNotificationSelection && structuredClone(input.legacyNotificationSelection);
    const continuation = Boolean(input.continuation);
    const { consent } = input;
    consent?.claim(expected);
    const confirmedWriting = consent?.writing;
    const captureInputs = () => {
      const config = AiConfigSchema.parse(input.config);
      return {
        config,
        settings: SettingsSchema.parse(input.settings),
        companionProfile: input.companionProfile && structuredClone(input.companionProfile),
        orderPreferences: input.orderPreferences && structuredClone(input.orderPreferences),
        frozenStoryChannel: presetSelection ? requestSnapshot(config, 'story', input.vault) : undefined,
        secrets: config.channels.map(channel => input.vault.get(channel.id)).filter(Boolean),
      };
    };
    // 浏览器取得 Web Lock 本身也是异步的。预设、渠道与凭证在调用入口一起选定。
    const frozen = captureInputs();
    return this.guard.run(expected.saveId, async (attempt) => {
      const current = attempt.check;
      if (presetSelection && waitingForScripts) {
        const runtime = frozen!.settings.runtime;
        const preparation = preparationSeconds(runtime.timeoutSeconds);
        const limits = runtime.streamStory ? storyStreamLimits(runtime) : { idle: runtime.timeoutSeconds, total: preparation };
        await withStoryPreparation(attempt.signal, clock!, limits, preparation, signal => awaitAssistant(signal));
        clock?.first('assistantReadyMs');
        current();
        presetSelection = captureAssistantPreferences(allowNativeDelivery);
      }
      const presetIdentity = fingerprint(presetSelection ?? null);
      if (input.automaticRetry && this.presetAtFirstAttempt !== presetIdentity)
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.retry_changed' });
      this.presetAtFirstAttempt = presetIdentity;
      const { config, settings, companionProfile, orderPreferences, frozenStoryChannel, secrets } = frozen;
      const streaming = settings.runtime.streamStory;
      const [state, draft] = await Promise.all([
        this.repository.load(expected.saveId),
        this.repository.loadDraft(expected.saveId),
      ]);
      current();
      if (
        !draft ||
        fingerprint(draft) !== fingerprint(expected) ||
        state.revision !== draft.baseSaveRevision ||
        state.journal.some((entry) => entry.turnId === draft.turnId) ||
        (draft.turnKind === 'opening' && state.turnNumber !== 0)
      )
        throw new DataError('DRAFT_CONFLICT', '草稿或正式版本已变化，请重新读取存档。');
      const recovery = selection ? authorizeLegacyNotificationRecovery(state,draft,selection) : undefined;
      if (recovery && (!this.repository.saveRecoveredStory || continuation
        || !settings.runtime.useVariableStage || !settings.runtime.useWorldStage)) throw new AiError('configuration');
      if (continuation && draft.storyPartial && !draft.storyPartial.writing && !confirmedWriting)
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.writing_unknown' });
      const continuationDraft = continuation && draft.storyPartial && !draft.storyPartial.writing && confirmedWriting
        ? { ...draft, storyPartial: { ...draft.storyPartial, writing: confirmedWriting } } : draft;
      if (continuation && !canContinueStory(continuationDraft, settings.prompts.minNarrativeChars))
        throw new DataError('DRAFT_CONFLICT', '这段正文已不能续写，请重新生成。');
      const retry = !input.freshWorldview && draft.stageStatus.story === 'failed';
      const partial = continuation ? trimIncompleteTag(draft.storyPartial!.text) : '';
      let stream = new StoryStream();
      // 续写：先把已写部分放进显示流；续写开头缓冲到能确定拼接方式，去掉重复后再显示。
      let narrative = continuation ? stream.push(partial) : '';
      let preview = continuation ? new ContinuationPreview(partial) : undefined;
      let showingProvisional = false;
      const pushDelta = (delta: string) => {
        const shown = preview ? preview.push(delta) : delta;
        return shown ? stream.push(shown) : narrative;
      };
      const resume = continuation || retry;
      const lease = await this.repository.prepareWorldview(draft, resume, input.expectedInstance, input.replacementRetry?.pending);
      const inspectionId = storyInspections.begin({ saveId: draft.saveId, turnId: draft.turnId,
        baseSaveRevision: draft.baseSaveRevision, basedOnStoryRevision: draft.storyRevision });
      let reasoning = '', inspectionReasoning = '', compatibilityReasoning = '';
      const progress = () => input.onProgress?.({ phase: 'generating', narrative: streaming ? safeStreamResponseText(narrative, secrets) : '',
        readingPhase: !streaming ? 'waiting' : stream.bodyStarted ? 'body' : 'thinking',
        ...(!streaming || stream.bodyStarted ? {} : { planning: safeStreamResponseText(stream.planning, secrets), nativeReasoning: safeStreamResponseText(reasoning, secrets),
          compatibilityReasoning: safeStreamResponseText(compatibilityReasoning, secrets) }) });
      let published = false;
      let saving = false;
      let responseInspectionId: string | undefined;
      try {
        current();
        progress();
        const noteState = typeof presetSelection === 'object' && presetSelection?.definition.id === oracleId
          ? await this.repository.readOracleNote?.(draft.saveId) : undefined;
        if (noteState && noteState.instance !== lease.instance)
          throw new DataError('DRAFT_CONFLICT', '场外小纸条所属的存档已经变化。');
        const note = noteState?.note;
        const historyActions = presetSelection && presetSelection !== nativeDeliveryId && state.journal.length
          ? await this.repository.recentStoryActions?.(state, settings.memory.immediateWindowSize) : undefined;
        current();
        const response = await runStageRequest(
          {
            stage: 'story', worldview:lease.worldview, ...(note && { oracleNote: note.text }),
            mode: draft.turnKind,
            state,
            draft,
            userInput: draft.userInput,
            settings,
            companionProfile,
            historyActions,
            orderPreferences,
            ...(recovery ? {legacyNotificationRecovery:recovery} : {}),
          },
          config,
          input.vault,
          {
            stream: streaming, storyClock: clock,
            presetSelection, frozenStoryChannel,
            signal: attempt.signal,
            ...(continuation ? { continuation: { partial, consent } } : {}),
            onLiteraryPreview: (delta) => {
              current();
              showingProvisional = true;
              narrative = pushDelta(delta);
              progress();
            },
            onDelta: (delta) => {
              current();
              // The sandbox delivered its complete, validated output. Replace the temporary
              // reading stream, including continuation overlap state, before displaying it.
              if (showingProvisional) {
                stream = new StoryStream();
                narrative = continuation ? stream.push(partial) : '';
                preview = continuation ? new ContinuationPreview(partial) : undefined;
                showingProvisional = false;
              }
              narrative = pushDelta(delta);
              progress();
              storyInspections.update(inspectionId, { planning: redactInspection(stream.planning, secrets), activity: 'content' });
            },
            onReasoningDelta: (delta) => {
              current(); inspectionReasoning += delta;
              storyInspections.update(inspectionId, { nativeReasoning: redactInspection(inspectionReasoning, secrets), activity: 'reasoning' });
            },
            onNativeReasoningDelta: (delta) => {
              current(); reasoning += delta;
              progress();
            },
            onCompatibilityReasoningDelta: (delta) => {
              current(); compatibilityReasoning += delta;
              progress();
            },
          },
          this.client,
        );
        responseInspectionId = response.responseInspectionId;
        current();
        const basis = response.requestBasis;
        if (
          basis.saveId !== draft.saveId ||
          basis.turnId !== draft.turnId ||
          basis.baseSaveRevision !== draft.baseSaveRevision ||
          basis.draftRevision !== draft.draftRevision ||
          basis.storyRevision !== draft.storyRevision ||
          basis.executionRevision !== draft.executionRevision
        )
          throw new AiError('invalid_output', undefined, { storyRule: 'request_basis' });
        const checkedStory = StorySchema.safeParse(response.result);
        if (!checkedStory.success) throw storySchemaError(checkedStory.error);
        const story = checkedStory.data;
        storyInspections.update(inspectionId, redactInspection({ planning: response.storyInspection?.planning ?? '',
          nativeReasoning: response.storyInspection?.nativeReasoning ?? '' }, secrets));
        // 凭证从来不属于游戏内容；即使服务异常回显，也不能写入草稿。
        const serialized = JSON.stringify(story);
        if (
          secrets.some((secret) =>
            [secret, encodeURIComponent(secret)].some((value) =>
              serialized.includes(JSON.stringify(value).slice(1, -1)),
            ),
          )
        )
          throw new AiError('invalid_output', undefined, { storyRule: 'credential_output' });
        if (recovery) validateRecoveredStory(state,draft.story!,story,recovery);
        current();
        if (responseInspectionId) {
          try { stageResponses.update(responseInspectionId, { storyValidated: true, validationEndMs: clock?.elapsed() }, secrets); } catch { /* Display only. */ }
        }
        saving = true;
        attempt.saving();
        input.onProgress?.({ phase: 'saving', readingPhase: streaming ? 'body' : 'waiting', narrative: streaming ? story.narrative : '' });
        // 网络从不放入 IDB 事务；整份草稿用现有乐观锁原子替换。
        const saved = selection
          ? await this.repository.saveRecoveredStory!(draft,story,selection,attempt.signal,lease,response.storyWriting,note?.id)
          : await this.repository.saveDraft(rerollStory(draft,story,response.storyWriting), draft.draftRevision, attempt.signal, draft, lease, note?.id);
        published = true;
        if (responseInspectionId) {
          try { stageResponses.update(responseInspectionId, { candidateSaved: true, draftSavedMs: clock?.elapsed() }, secrets); } catch { /* Already persisted. */ }
        }
        current();
        storyInspections.update(inspectionId, { status: 'saved' });
        return saved;
      } catch (error) {
        storyInspections.update(inspectionId, { status: 'failed' });
        if (responseInspectionId) stageResponses.update(responseInspectionId, { status: 'failed', failureLayer: saving ? 'draft' : 'story_validation',
          ...(!saving && clock ? { validationEndMs: clock.elapsed() } : {}), normalized: undefined, error: safeAiError(storyFailure(error)) }, secrets);
        if (!saving && draft.story && draft.stageStatus.story === 'ready' && input.replacementRetry &&
            error instanceof AiError && recordedRetryable(error, input.settings)) {
          input.replacementRetry.pending = lease;
        }
        // An unsuccessful explicit rewrite of an uncredited V10 fragment must leave its only copy intact.
        const keepLegacyPartial = !continuation && draft.storyPartial && !draft.storyPartial.writing;
        // 已有可用正文时重新生成失败，保留原正文，不把草稿标为失败。
        if (!saving && (!consent || consent.sent) && !recovery && !keepLegacyPartial && !(draft.story && draft.stageStatus.story === 'ready')
          && input.onFailureSaved && error instanceof AiError && error.code !== 'cancelled'
          && !isContinuationDeliveryUnknown(error)
          && !(draft.story && (usesSpreset(presetSelection) || error.details?.storyRule === 'narrative_empty'
            || error.details?.fieldPath?.startsWith('tavern.upstream.')))) {
          current();
          const previousAttempt = draft.failures.filter(f => f.stage === 'story' && f.storyRevision === draft.storyRevision)
            .reduce((last, failure) => Math.max(last, failure.attempt), 0);
          const failed = TurnDraftSchema.parse({
            ...draft, draftRevision: draft.draftRevision + 1,
            storyPartial: storyPartialAfterFailure(draft, error, continuation, secrets) ??
              (input.automaticRetry && draft.storyPartial?.storyRevision === draft.storyRevision ? draft.storyPartial : undefined),
            stageStatus: { ...draft.stageStatus, story: 'failed' },
            failures: [...draft.failures, { stage: 'story', attempt: previousAttempt + 1,
              storyRevision: draft.storyRevision, errorCode: error.code, retryable: recordedRetryable(error, input.settings) }],
          });
          // Still inside the original stage lock. Cancellation and the full request basis
          // must remain valid; a failed CAS must never overwrite a newer timeline.
          attempt.saving();
          input.onProgress?.({ phase: 'saving', readingPhase: !streaming ? 'waiting' : stream.bodyStarted ? 'body' : 'thinking', narrative: streaming ? safeStreamResponseText(narrative, secrets) : '' });
          const saved = await this.repository.saveDraft(failed, draft.draftRevision, attempt.signal, draft, lease);
          published = true;
          current();
          input.onFailureSaved(saved);
        }
        throw error;
      } finally {
        if (published && input.replacementRetry) delete input.replacementRetry.pending;
        if (!resume && !published && input.replacementRetry?.pending !== lease) {
          await withWorldbookLibrary(lib => lib.forgetGeneration(lease.saveId, lease.owner, lease.generation)).catch(() => {});
        }
      }
    });
  }
}

export function storyError(error: unknown): string {
  if (
    error instanceof DataError &&
    ['STORY_BUSY', 'DRAFT_CONFLICT', 'REVISION_CONFLICT'].includes(error.code)
  )
    return error.code === 'STORY_BUSY'
      ? '此存档已有阶段请求，请等待或取消。'
      : '存档或草稿版本已变化，本次结果未保存。请重新读取存档。';
  if (error instanceof DataError && error.code === 'LEGACY_RECOVERY_STAGES')
    return '结算旧通知需要启用变量管理和动态世界。';
  if (error instanceof DataError && error.code === 'LEGACY_RECOVERY_RECEIPT')
    return '新正文没有合法保留所选通知的收悉及其他事件裁定。原草稿已保留。';
  return safeAiError(error).message;
}
