import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { browserPromptOrder } from '../prompts/order';
import type { OrderPreferences } from '../prompts/order';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig, AiStage } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { AiError } from '../services/ai/errors';
import { freeze, requestSnapshot } from '../services/ai/snapshot';
import type { CompanionProfile } from '../services/local/companionProfile';
import type { SaveRepository } from '../services/storage/saveRepository';
import { parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { reserveStageSession, withBrowserLock } from './stageGuard';
import { StoryStage } from './storyStage';
import { VariableStage } from './variableStage';
import { WorldStage } from './worldStage';

type Repository = Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft'>;
export interface TurnProgress {
  stage: AiStage;
  phase: 'generating' | 'saving' | 'retrying';
  attempt: 1 | 2;
  narrative?: string;
}
export interface TurnOutcome {
  draft: TurnDraft;
  status: 'complete' | 'skipped' | 'preview';
  skipped: AiStage[];
}
interface TurnInput {
  draft: TurnDraft;
  settings: Settings;
  config: AiConfig;
  vault: CredentialVault;
  companionProfile?: CompanionProfile;
  orderPreferences?: OrderPreferences;
  onDraft?: (draft: TurnDraft) => void;
  onProgress?: (progress: TurnProgress) => void;
}
interface ActiveTurn {
  cancelled: boolean;
  controller: AbortController;
  savingFailure?: boolean;
  stage?: StoryStage | VariableStage | WorldStage;
  release: () => void;
}
// 网络错误可能是固定 CORS/TLS/地址问题，429 也可能是额度耗尽；不据此盲目自动付费重试。
export function transientStageError(error: unknown) {
  return (
    error instanceof AiError &&
    error.code === 'server' &&
    [500, 502, 503, 504].includes(error.status ?? 0)
  );
}

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
      return await withBrowserLock(input.draft.saveId, async () => {
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
        if (worldReady()) parseWorld(JSON.stringify(draft.world!.result), state, draft);
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
        for (const stage of needed) requestSnapshot(config, stage, vault);
        const story = new StoryStage(this.repository, this.client, session.guard());
        const variables = new VariableStage(this.repository, this.client, session.guard());
        const world = new WorldStage(this.repository, this.client, session.guard());
        const saved = (next: TurnDraft) => {
          check();
          draft = next;
          input.onDraft?.(next);
        };
        for (const stage of needed) {
          for (const number of [1, 2] as const) {
            await reread();
            check();
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
                    onProgress: (progress) => onProgress(progress.phase, progress.narrative),
                  }),
                );
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
              if (stage === 'story' && error instanceof AiError && error.code !== 'cancelled') {
                // 原 StoryStage 只保存成功正文；协调器额外记录安全失败码，刷新后仍可恢复。
                await reread();
                const failed = TurnDraftSchema.parse({
                  ...draft,
                  draftRevision: draft.draftRevision + 1,
                  stageStatus: { ...draft.stageStatus, story: 'failed' },
                  failures: [
                    ...draft.failures,
                    {
                      stage,
                      attempt: number,
                      storyRevision: draft.storyRevision,
                      errorCode: error.code,
                      retryable: transientStageError(error),
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
                    ),
                  );
                } finally {
                  attempt.savingFailure = false;
                }
              }
              if (number === 2 || !transientStageError(error)) throw error;
              // 失败记录由原执行器 CAS 保存；如果其他标签已写入，不能接受它的新版本重试。
              await reread();
              input.onProgress?.({ stage, phase: 'retrying', attempt: 2 });
            }
          }
        }
        await reread();
        const skipped: AiStage[] = [];
        if (!settings.runtime.useVariableStage) skipped.push('variables');
        if (!settings.runtime.useWorldStage) skipped.push('world');
        return {
          draft,
          skipped,
          status:
            draft.world?.validation === 'preview'
              ? 'preview'
              : skipped.length
                ? 'skipped'
                : storyReady() && variableReady() && draft.stageStatus.world === 'ready'
                  ? 'complete'
                  : 'skipped',
        };
      });
    } finally {
      attempt.release();
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }
}
