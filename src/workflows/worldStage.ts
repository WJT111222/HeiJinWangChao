import { DataError } from '../domain/common';
import { fingerprint } from '../domain/commands';
import { startStageAttempt, TurnDraftSchema, WorldResultSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import type { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { AiConfigSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError, safeAiError } from '../services/ai/errors';
import { runStageRequest } from '../services/ai/runtime';
import { requestSnapshot } from '../services/ai/snapshot';
import { parseVariables } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { SettingsSchema } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { assertWorldCoverage, selectWorldDomains } from '../prompts/worldDomains';
import { StageGuard } from './stageGuard';
import type { OrderPreferences } from '../prompts/order';

export class WorldStage {
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
      if (!settings.runtime.useWorldStage) throw new AiError('configuration');
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
      requestSnapshot(config, 'world', input.vault);
      // 不信任持久化的 validated 字样，执行前重新核验变量候选。
      if (current.variables?.validation === 'validated')
        parseVariables(JSON.stringify(current.variables.result), state, current);
      const started = startStageAttempt(current, ['world'], {
        useVariableStage: settings.runtime.useVariableStage,
        useWorldStage: true,
      });
      const draft = await this.repository.saveDraft(started, current.draftRevision, attempt.signal);
      attempt.check();
      input.onDraft?.(draft);
      try {
        input.onProgress?.('generating');
        const selection = selectWorldDomains(projectTurn(state, draft), draft);
        const response = await runStageRequest(
          {
            stage: 'world',
            mode: draft.turnKind,
            state,
            draft,
            userInput: '',
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
        const preview = draft.variables?.validation !== 'validated';
        if (
          basis.saveId !== draft.saveId ||
          basis.turnId !== draft.turnId ||
          basis.baseSaveRevision !== draft.baseSaveRevision ||
          basis.draftRevision !== draft.draftRevision ||
          basis.storyRevision !== draft.storyRevision ||
          basis.executionRevision !== draft.executionRevision ||
          basis.stageRequestRevision !== draft.stageRequestRevisions.world ||
          basis.basedOnVariableRevision !== draft.variables?.candidateRevision ||
          response.variablePending !== preview
        )
          throw new AiError('invalid_output');
        const result = WorldResultSchema.parse(response.result);
        assertWorldCoverage(selection.domains, projectTurn(state, draft), result.worldCommands);
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
          world: {
            storyRevision: draft.storyRevision,
            candidateRevision: Math.max(
              (current.world?.candidateRevision ?? 0) + 1,
              draft.executionRevision,
            ),
            requestRevision: draft.stageRequestRevisions.world,
            basedOnVariableRevision: draft.variables?.candidateRevision,
            validation: preview ? 'preview' : 'validated',
            result,
          },
          stageStatus: { ...draft.stageStatus, world: preview ? 'preview' : 'ready' },
        });
        attempt.saving();
        input.onProgress?.('saving');
        const saved = await this.repository.saveDraft(next, draft.draftRevision, attempt.signal);
        attempt.check();
        return saved;
      } catch (error) {
        try {
          attempt.check();
          const safe = safeAiError(error);
          const failed = TurnDraftSchema.parse({
            ...draft,
            draftRevision: draft.draftRevision + 1,
            stageStatus: { ...draft.stageStatus, world: 'failed' },
            failures: [
              ...draft.failures,
              {
                stage: 'world',
                attempt: draft.executionRevision,
                storyRevision: draft.storyRevision,
                errorCode: safe.code,
                retryable: ![
                  'configuration',
                  'credentials',
                  'authorization',
                  'unsupported',
                ].includes(safe.code),
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
          /* 取消、冲突或存储故障不覆盖当前仓库状态。 */
        }
        throw error;
      }
    });
  }
}
