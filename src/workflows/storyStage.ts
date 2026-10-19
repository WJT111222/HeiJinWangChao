import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { StorySchema } from '../domain/state';
import type { CompanionProfile } from '../services/local/companionProfile';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError, safeAiError } from '../services/ai/errors';
import { redactInspection } from '../services/ai/inspection';
import { runStageRequest } from '../services/ai/runtime';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { StoryStream } from './storyStream';

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
  onProgress?: (progress: StoryProgress) => void;
}
// 页面内互斥 + IndexedDB 乐观锁；跨标签页仍由 expectedDraftRevision 仲裁。
const active = new Map<string, symbol>();
export class StoryStage {
  private attempt?: { id: symbol; saveId: string; controller: AbortController; saving: boolean };
  constructor(
    private repository: Repository,
    private client = new AiClient(),
  ) {}

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
  async generate(input: StoryInput): Promise<TurnDraft> {
    const expected = TurnDraftSchema.parse(input.draft);
    if (this.attempt || active.has(expected.saveId))
      throw new DataError('STORY_BUSY', '本存档已有正文请求，请等待或取消。');
    const attempt = {
      id: Symbol('story'),
      saveId: expected.saveId,
      controller: new AbortController(),
      saving: false,
    };
    this.attempt = attempt;
    active.set(expected.saveId, attempt.id);
    const current = () => {
      if (
        this.attempt !== attempt ||
        attempt.controller.signal.aborted ||
        active.get(expected.saveId) !== attempt.id
      )
        throw new AiError('cancelled');
    };
    try {
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
        },
        config,
        input.vault,
        {
          stream: true,
          signal: attempt.controller.signal,
          onDelta: (delta) => {
            current();
            input.onProgress?.({
              phase: 'generating',
              narrative: redactInspection(stream.push(delta), secrets),
            });
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
      attempt.saving = true;
      input.onProgress?.({ phase: 'saving', narrative: story.narrative });
      // 网络从不放入 IDB 事务；整份草稿用现有乐观锁原子替换。
      const saved = await this.repository.saveDraft(
        next,
        draft.draftRevision,
        attempt.controller.signal,
      );
      current();
      return saved;
    } finally {
      if (this.attempt === attempt) this.attempt = undefined;
      if (active.get(expected.saveId) === attempt.id) active.delete(expected.saveId);
    }
  }
}

export function storyError(error: unknown): string {
  if (
    error instanceof DataError &&
    ['STORY_BUSY', 'DRAFT_CONFLICT', 'REVISION_CONFLICT'].includes(error.code)
  )
    return error.code === 'STORY_BUSY'
      ? '此存档已有正文请求，请等待或取消。'
      : '存档或草稿已被其他操作更新，本次结果未保存。请重新读取存档。';
  return safeAiError(error).message;
}
