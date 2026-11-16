import { stageResponses, safeStreamResponseText } from '../services/ai/stageResponses';
import { storyFailure, storySchemaError } from '../services/validation/storyDiagnostics';
import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { StorySchema } from '../domain/state';
import type { CompanionProfile } from '../services/local/companionProfile';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import { storyInspections } from '../services/ai/storyInspection';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError, safeAiError } from '../services/ai/errors';
import { redactInspection } from '../services/ai/inspection';
import { runStageRequest } from '../services/ai/runtime';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { StoryStream } from './storyStream';
import { StageGuard } from './stageGuard';
import type { OrderPreferences } from '../prompts/order';

type Repository = Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft'>;
export interface StoryProgress {
  phase: 'generating' | 'saving';
  narrative: string;
  readingPhase?: 'thinking' | 'body' | 'waiting';
  planning?: string;
  nativeReasoning?: string;
  compatibilityReasoning?: string;
}
interface StoryInput {
  draft: TurnDraft;
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
  orderPreferences?: OrderPreferences;
  onProgress?: (progress: StoryProgress) => void;
  /** Manual UI owns this failure save; Coordinator records its own attempts. */
  onFailureSaved?: (draft: TurnDraft) => void;
}
export class StoryStage {
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
    const expected = TurnDraftSchema.parse(input.draft);
    return this.guard.run(expected.saveId, async (attempt) => {
      const current = attempt.check;
      // 在第一个 await 之前快照本次设置；运行开关始终取绑定草稿，不被界面切换重写。
      const settings = SettingsSchema.parse(input.settings);
      const streaming = settings.runtime.streamStory;
      const config = AiConfigSchema.parse(input.config);
      const companionProfile = input.companionProfile && structuredClone(input.companionProfile);
      const secrets = config.channels.map((channel) => input.vault.get(channel.id)).filter(Boolean);
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
      const stream = new StoryStream();
      const inspectionId = storyInspections.begin({ saveId: draft.saveId, turnId: draft.turnId,
        baseSaveRevision: draft.baseSaveRevision, basedOnStoryRevision: draft.storyRevision });
      let reasoning = '', inspectionReasoning = '', compatibilityReasoning = '', narrative = '';
      const progress = () => input.onProgress?.({ phase: 'generating', narrative: streaming ? safeStreamResponseText(narrative, secrets) : '',
        readingPhase: !streaming ? 'waiting' : stream.bodyStarted ? 'body' : 'thinking',
        ...(!streaming || stream.bodyStarted ? {} : { planning: safeStreamResponseText(stream.planning, secrets), nativeReasoning: safeStreamResponseText(reasoning, secrets),
          compatibilityReasoning: safeStreamResponseText(compatibilityReasoning, secrets) }) });
      let responseInspectionId: string | undefined;
      try {
        progress();
        const response = await runStageRequest(
          {
            stage: 'story',
            mode: draft.turnKind,
            state,
            draft,
            userInput: draft.userInput,
            settings,
            companionProfile,
            orderPreferences: input.orderPreferences,
          },
          config,
          input.vault,
          {
            stream: streaming,
            signal: attempt.signal,
            onDelta: (delta) => {
              current();
              narrative = stream.push(delta);
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
        const next = rerollStory(draft, story);
        current();
        attempt.saving();
        input.onProgress?.({ phase: 'saving', readingPhase: streaming ? 'body' : 'waiting', narrative: streaming ? story.narrative : '' });
        // 网络从不放入 IDB 事务；整份草稿用现有乐观锁原子替换。
        const saved = await this.repository.saveDraft(next, draft.draftRevision, attempt.signal, draft);
        current();
        storyInspections.update(inspectionId, { status: 'saved' });
        return saved;
      } catch (error) {
        storyInspections.update(inspectionId, { status: 'failed' });
        if (responseInspectionId) stageResponses.update(responseInspectionId, { status: 'failed', normalized: undefined, error: safeAiError(storyFailure(error)) }, secrets);
        if (input.onFailureSaved && error instanceof AiError && error.code !== 'cancelled') {
          current();
          const previousAttempt = draft.failures.filter(f => f.stage === 'story' && f.storyRevision === draft.storyRevision)
            .reduce((last, failure) => Math.max(last, failure.attempt), 0);
          const failed = TurnDraftSchema.parse({
            ...draft, draftRevision: draft.draftRevision + 1,
            stageStatus: { ...draft.stageStatus, story: 'failed' },
            failures: [...draft.failures, { stage: 'story', attempt: previousAttempt + 1,
              storyRevision: draft.storyRevision, errorCode: error.code, retryable: false }],
          });
          // Still inside the original stage lock. Cancellation and the full request basis
          // must remain valid; a failed CAS must never overwrite a newer timeline.
          attempt.saving();
          input.onProgress?.({ phase: 'saving', readingPhase: !streaming ? 'waiting' : stream.bodyStarted ? 'body' : 'thinking', narrative: streaming ? safeStreamResponseText(narrative, secrets) : '' });
          const saved = await this.repository.saveDraft(failed, draft.draftRevision, attempt.signal, draft);
          current();
          input.onFailureSaved(saved);
        }
        throw error;
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
  return safeAiError(error).message;
}
