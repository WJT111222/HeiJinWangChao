import { projectTurn } from '../domain/turnProjection';
import { stageResponses } from '../services/ai/stageResponses';
import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { startStageAttempt, TurnDraftSchema, VariableResultSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { variableFailure } from '../services/validation/variableDiagnostics';
import type { VariableStep } from '../services/ai/errors';
import { AiError, safeAiError } from '../services/ai/errors';
import { runStageRequest } from '../services/ai/runtime';
import { requestSnapshot } from '../services/ai/snapshot';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { selectVariableDomains } from '../prompts/variableDomains';
import { StageGuard } from './stageGuard';
import type { OrderPreferences } from '../prompts/order';
// 保持执行器既有锁/CAS错误契约；日志层再转换为安全分类。
function stageFailure(error: unknown, step: VariableStep) {
  return error instanceof DataError && ['STORY_BUSY', 'DRAFT_CONFLICT', 'REVISION_CONFLICT', 'ENTITY_CONFLICT', 'COMMAND_CONFLICT', 'DUPLICATE_COMMAND'].includes(error.code) ? error : variableFailure(error, step);
}

export class VariableStage {
  constructor(
    private repository: Pick<SaveRepository, 'load' | 'loadDraft' | 'saveDraft' | 'prepareWorldview'>,
    private client = new AiClient(),
    private guard = new StageGuard(),
    private stage: 'entities' | 'variables' = 'variables',
  ) {}
  cancel() {
    return this.guard.cancel();
  }
  dispose() {
    this.guard.dispose();
  }
  async generate(input: {
    expectedInstance?: string | null;
    draft: TurnDraft;
    settings: Settings;
    config: AiConfig;
    vault: CredentialVault;
    orderPreferences?: OrderPreferences;
    onDraft?: (draft: TurnDraft) => void;
    onProgress?: (phase: 'generating' | 'saving') => void;
  }): Promise<TurnDraft> {
    const stage = this.stage;
    let step: VariableStep = 'context';
    try {
    const expected = TurnDraftSchema.parse(input.draft);
    return await this.guard.run(expected.saveId, async (attempt) => {
      const settings = SettingsSchema.parse(input.settings),
        config = AiConfigSchema.parse(input.config);
      const secrets = config.channels.map((channel) => input.vault.get(channel.id)).filter(Boolean);
      if (!(stage === 'entities' ? settings.runtime.useEntityStage : settings.runtime.useVariableStage)) throw new AiError('configuration');
      step = 'load';
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
      step = 'context';
      requestSnapshot(config, stage, input.vault);
      // 每次手动启动都是显式尝试。正文/输入不变，清除旧变量及其世界依赖。
      const lease = await this.repository.prepareWorldview(current, true, input.expectedInstance);
      attempt.check();
      const started = startStageAttempt(current, [stage], {
        useEntityStage: settings.runtime.useEntityStage, useVariableStage: settings.runtime.useVariableStage,
        useWorldStage: settings.runtime.useWorldStage,
      });
      if (stage === 'variables' && started.useEntityStage && !started.entities)
        throw new AiError('candidate_conflict');
      step = 'draft_start';
      const draft = await this.repository.saveDraft(started, current.draftRevision, attempt.signal, current, lease);
      attempt.check();
      input.onDraft?.(draft);
      let responseInspectionId: string | undefined;
      try {
        input.onProgress?.('generating');
        const selection = selectVariableDomains(state, draft, stage);
        step = 'request';
        const response = await runStageRequest(
          {
            stage,
            worldview: lease.worldview, mode: draft.turnKind,
            state,
            draft,
            userInput: draft.userInput,
            settings,
            domains: selection.domains,
            orderPreferences: input.orderPreferences,
          },
          config,
          input.vault,
          { signal: attempt.signal, stream: stage === 'entities' ? settings.runtime.streamEntities : settings.runtime.streamVariables },
          this.client,
        );
        responseInspectionId = response.responseInspectionId;
        attempt.check();
        const basis = response.requestBasis;
        if (
          basis.saveId !== draft.saveId ||
          basis.turnId !== draft.turnId ||
          basis.baseSaveRevision !== draft.baseSaveRevision ||
          basis.draftRevision !== draft.draftRevision ||
          (stage === 'variables' && basis.basedOnEntityRevision !== draft.entities?.candidateRevision) ||
          basis.storyRevision !== draft.storyRevision ||
          basis.executionRevision !== draft.executionRevision ||
          basis.stageRequestRevision !== draft.stageRequestRevisions[stage]
        )
          throw new AiError('candidate_conflict');
        step = 'simulation';
        const { contactedNpcIds, ...payload } = response.result && 'contactedNpcIds' in response.result
          ? response.result : { ...response.result, contactedNpcIds: undefined };
        const result = VariableResultSchema.parse(payload);
        const serialized = JSON.stringify({result, contactedNpcIds});
        if (
          secrets.some((secret) =>
            [secret, encodeURIComponent(secret)].some((value) =>
              serialized.includes(JSON.stringify(value).slice(1, -1)),
            ),
          )
        )
          throw new AiError('invalid_output', undefined, { worldRule: 'secret_in_output' });
        const next = TurnDraftSchema.parse({
          ...draft,
          draftRevision: draft.draftRevision + 1,
          [stage]: {
            ...(stage === 'entities' ? { contactedNpcIds } : { basedOnEntityRevision: draft.entities?.candidateRevision }),
            storyRevision: draft.storyRevision,
            candidateRevision: Math.max(
              (current[stage]?.candidateRevision ?? 0) + 1,
              draft.executionRevision,
            ),
            requestRevision: draft.stageRequestRevisions[stage],
            validation: stage === 'entities' ? 'structural' : 'validated',
            result,
          },
          stageStatus: { ...draft.stageStatus, [stage]: 'ready' },
        });
        if (stage === 'entities' && !next.useVariableStage) projectTurn(state, next);
        attempt.saving();
        input.onProgress?.('saving');
        step = 'candidate_save';
        const saved = await this.repository.saveDraft(next, draft.draftRevision, attempt.signal, draft, lease);
        attempt.check();
        return saved;
      } catch (error) {
        const failure = stageFailure(error, step);
        if (responseInspectionId) stageResponses.update(responseInspectionId, { status: 'failed', error: safeAiError(failure) }, secrets);
        // 仅当前仍活跃且版本未变时保存安全失败元数据；取消/迟到不追加任何写入。
        try {
          attempt.check();
          const safe = safeAiError(failure);
          const failed = TurnDraftSchema.parse({
            ...draft,
            draftRevision: draft.draftRevision + 1,
            stageStatus: { ...draft.stageStatus, [stage]: 'failed' },
            failures: [
              ...draft.failures,
              {
                stage,
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
            draft,
            lease,
          );
          attempt.check();
          input.onDraft?.(stored);
        } catch {
          /* 取消、冲突或存储故障保留仓库现状，不强制覆盖。 */
        }
        throw failure;
      }
    });
    } catch (error) { throw stageFailure(error, step); }
  }
}
