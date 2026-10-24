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
}
interface StoryInput {
  draft: TurnDraft;
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
  orderPreferences?: OrderPreferences;
  onProgress?: (progress: StoryProgress) => void;
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
      let reasoning = '';
      try {
        input.onProgress?.({ phase: 'generating', narrative: '' });
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
            stream: true,
            signal: attempt.signal,
            onDelta: (delta) => {
              current();
              input.onProgress?.({
                phase: 'generating',
                narrative: redactInspection(stream.push(delta), secrets),
              });
              storyInspections.update(inspectionId, { planning: redactInspection(stream.planning, secrets), activity: 'content' });
            },
            onReasoningDelta: (delta) => {
              current(); reasoning += delta;
              storyInspections.update(inspectionId, { nativeReasoning: redactInspection(reasoning, secrets), activity: 'reasoning' });
            },
          },
          this.client,
        );
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
          throw new AiError('invalid_output');
        const story = StorySchema.parse(response.result);
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
          throw new AiError('invalid_output');
        const next = rerollStory(draft, story);
        current();
        attempt.saving();
        input.onProgress?.({ phase: 'saving', narrative: story.narrative });
        // 网络从不放入 IDB 事务；整份草稿用现有乐观锁原子替换。
        const saved = await this.repository.saveDraft(next, draft.draftRevision, attempt.signal);
        current();
        storyInspections.update(inspectionId, { status: 'saved' });
        return saved;
      } catch (error) {
        storyInspections.update(inspectionId, { status: 'failed' });
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
      : '存档或草稿已被其他操作更新，本次结果未保存。请重新读取存档。';
  return safeAiError(error).message;
}
