import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { startStageAttempt, TurnDraftSchema, VariableResultSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError, safeAiError } from '../services/ai/errors';
import { runStageRequest } from '../services/ai/runtime';
import { requestSnapshot } from '../services/ai/snapshot';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { assertVariableCoverage, selectVariableDomains } from '../prompts/variableDomains';
import { StageGuard } from './stageGuard';
import type { OrderPreferences } from '../prompts/order';

export class VariableStage {
  constructor(
    private repository: Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft'>,
    private client = new AiClient(),
    private guard = new StageGuard(),
  ) {}
  cancel() {
    return this.guard.cancel();
  }
  dispose() {
    this.guard.dispose();
  }
  async generate(input: {
    draft: TurnDraft;
    settings: Settings;
    config: AiConfig;
    vault: CredentialVault;
    orderPreferences?: OrderPreferences;
    onDraft?: (draft: TurnDraft) => void;
    onProgress?: (phase: 'generating' | 'saving') => void;
  }): Promise<TurnDraft> {
    const expected = TurnDraftSchema.parse(input.draft);
    return this.guard.run(expected.saveId, async (attempt) => {
      const settings = SettingsSchema.parse(input.settings),
        config = AiConfigSchema.parse(input.config);
      const secrets = config.channels.map((channel) => input.vault.get(channel.id)).filter(Boolean);
      if (!settings.runtime.useVariableStage) throw new AiError('configuration');
      const [state, current] = await Promise.all([
        this.repository.load(expected.saveId),
        this.repository.loadDraft(expected.saveId),
      ]);
      attempt.check();
      if (
        !current ||
        fingerprint(current) !== fingerprint(expected) ||
        state.revision !== current.baseSaveRevision ||
        state.journal.some((entry) => entry.turnId === current.turnId) ||
        (current.turnKind === 'opening' && state.turnNumber !== 0)
      )
        throw new DataError('DRAFT_CONFLICT', '草稿或正式状态已改变');
      if (!current.story || current.stageStatus.story !== 'ready')
        throw new AiError('configuration');
      // 配置/凭证不完整时不清空已有候选。真实请求仍由 runtime 生成其不可变快照。
      requestSnapshot(config, 'variables', input.vault);
      // 每次手动启动都是显式尝试。正文/输入不变，清除旧变量及其世界依赖。
      const started = startStageAttempt(current, ['variables'], {
        useVariableStage: true,
        useWorldStage: settings.runtime.useWorldStage,
      });
      const draft = await this.repository.saveDraft(started, current.draftRevision, attempt.signal);
      attempt.check();
      input.onDraft?.(draft);
      try {
        input.onProgress?.('generating');
        const selection = selectVariableDomains(state, draft);
        const response = await runStageRequest(
          {
            stage: 'variables',
            mode: draft.turnKind,
            state,
            draft,
            userInput: draft.userInput,
            settings,
            domains: selection.domains,
            orderPreferences: input.orderPreferences,
          },
          config,
          input.vault,
          { signal: attempt.signal, stream: false },
          this.client,
        );
        attempt.check();
        const basis = response.requestBasis;
        if (
          basis.saveId !== draft.saveId ||
          basis.turnId !== draft.turnId ||
          basis.baseSaveRevision !== draft.baseSaveRevision ||
          basis.draftRevision !== draft.draftRevision ||
          basis.storyRevision !== draft.storyRevision ||
          basis.executionRevision !== draft.executionRevision ||
          basis.stageRequestRevision !== draft.stageRequestRevisions.variables
        )
          throw new AiError('invalid_output');
        const result = VariableResultSchema.parse(response.result);
        assertVariableCoverage(selection.domains, state, result.commands);
        const serialized = JSON.stringify(result);
        if (
          secrets.some((secret) =>
            [secret, encodeURIComponent(secret)].some((value) =>
              serialized.includes(JSON.stringify(value).slice(1, -1)),
            ),
          )
        )
          throw new AiError('invalid_output');
        const next = TurnDraftSchema.parse({
          ...draft,
          draftRevision: draft.draftRevision + 1,
          variables: {
            storyRevision: draft.storyRevision,
            candidateRevision: Math.max(
              (current.variables?.candidateRevision ?? 0) + 1,
              draft.executionRevision,
            ),
            requestRevision: draft.stageRequestRevisions.variables,
            validation: 'validated',
            result,
          },
          stageStatus: { ...draft.stageStatus, variables: 'ready' },
        });
        attempt.saving();
        input.onProgress?.('saving');
        const saved = await this.repository.saveDraft(next, draft.draftRevision, attempt.signal);
        attempt.check();
        return saved;
      } catch (error) {
        // 仅当前仍活跃且版本未变时保存安全失败元数据；取消/迟到不追加任何写入。
        try {
          attempt.check();
          const safe = safeAiError(error);
          const failed = TurnDraftSchema.parse({
            ...draft,
            draftRevision: draft.draftRevision + 1,
            stageStatus: { ...draft.stageStatus, variables: 'failed' },
            failures: [
              ...draft.failures,
              {
                stage: 'variables',
                attempt: draft.executionRevision,
                storyRevision: draft.storyRevision,
                errorCode: safe.code,
                retryable: true,
              },
            ],
          });
          const stored = await this.repository.saveDraft(
            failed,
            draft.draftRevision,
            attempt.signal,
          );
          attempt.check();
          input.onDraft?.(stored);
        } catch {
          /* 取消、冲突或存储故障保留仓库现状，不强制覆盖。 */
        }
        throw error;
      }
    });
  }
}
