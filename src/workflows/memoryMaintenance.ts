import { DataError, requireData } from '../domain/common';
import type { GameState } from '../domain/state';
import { fingerprint } from '../domain/commands';
import { npcSummaryCandidates, planNpcSummary, npcSummaryInput, parseNpcSummary } from '../domain/memories/npcMemory';
import { compressionCandidates, planCompression, compressionInput, parseCompression, memoryTask, compressionPolicy, sourceUnion } from '../domain/memories/compression';
import { selectPromptModules } from '../prompts/selection';
import { readPromptResource } from '../prompts/loader';
import { contextMessage } from '../prompts/context';
import { contextStatistics, estimateTokens } from '../prompts/statistics';
import { defaultSettings } from '../ui/settings/model';
import { AiClient } from '../services/ai/client';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { requestSnapshot, secretFor } from '../services/ai/snapshot';
import type { SaveRepository } from '../services/storage/saveRepository';
import { defaultSummaryConfig, SummaryConfigSchema } from '../domain/memories/configuration';
import type { SummaryConfig, SummaryKind } from '../domain/memories/configuration';
import { AiError } from '../services/ai/errors';
import { MemoryObservation } from '../services/ai/memoryObservation';
import type { MemoryFailureObservation } from '../services/ai/memoryObservation';

import {
  authorizedSources, hasLegacySummaryFingerprint, legacyBatchMismatchMessage, legacyBatchUnverifiableMessage,
  pendingFor, SummaryRecords, summaryErrorCode, unconfirmedSummaryMessage,
} from './memorySummaryRecords';
import type { PendingSummary } from './memorySummaryRecords';
export { summaryAttemptKey } from './memorySummaryRecords';

export type MemoryLock = <T>(saveId: string, work: () => Promise<T>) => Promise<T>;
export const browserMemoryLock: MemoryLock = async (saveId, work) => {
  if (typeof navigator === 'undefined' || !navigator.locks)
    throw new DataError('MEMORY_LOCK_UNAVAILABLE', '浏览器不支持安全跨标签互斥，未发起记忆请求');
  return navigator.locks.request(`heijin.memory:${saveId}`, { ifAvailable: true }, (lock) => {
    if (!lock) throw new DataError('MEMORY_BUSY', '另一个标签正在整理此存档，未重复请求');
    return work();
  });
};
export class MemoryMaintenance {
  private active?: { controller: AbortController; saving: boolean };
  constructor(private repository: Pick<SaveRepository, 'loadMemoryContext' | 'checkMemoryLineage' | 'saveMemoryCompression' | 'saveNpcSummary'>,
    private client = new AiClient(), private lock: MemoryLock = browserMemoryLock) {}
  cancel() {
    if (this.active?.saving) return false;
    this.active?.controller.abort(); return true;
  }
  async reconcile(saveId: string, storage: Pick<Storage, 'getItem' | 'setItem'>) {
    await this.lock(saveId, async () => {
      const { state } = await this.repository.loadMemoryContext(saveId);
      new SummaryRecords(storage, state).recover();
    });
  }
  async run(input: { saveId: string; config: AiConfig | (() => AiConfig); vault: CredentialVault; timeoutSeconds: number; task?: 'public' | 'npc'; npcId?: string;
    kind?: SummaryKind; summaryConfig?: SummaryConfig; immediate?: boolean; attempts?: Pick<Storage, 'getItem' | 'setItem'>; automatic?: boolean;
    retryId?: string; readSettings?: () => { summaryConfig: SummaryConfig; timeoutSeconds: number };
    onFailure?: (failure: MemoryFailureObservation) => void; onPhase?: (phase: 'generating' | 'saving') => void }): Promise<GameState | undefined> {
    if (this.active) throw new DataError('MEMORY_BUSY', '记忆维护已在运行');
    const attempt = { controller: new AbortController(), saving: false };
    this.active = attempt;
    const check = () => { if (attempt.controller.signal.aborted) throw new AiError('cancelled'); };
    const kind = input.kind ?? (input.task === 'npc' ? 'npc' : undefined);
    const npcId = input.npcId;
    const observation = new MemoryObservation(input.saveId, kind ?? 'short');
    let observedFailure = false;
    const reportFailure = (code: string, error: unknown) => {
      observedFailure = true;
      const result = observation.failed(code, error);
      try { input.onFailure?.(result); } catch { /* Observation cannot change summary results. */ }
      return result.diagnostic;
    };
    let frozenConfig: SummaryConfig | undefined;
    const currentSettings = () => input.readSettings?.() ?? { summaryConfig: frozenConfig, timeoutSeconds: input.timeoutSeconds };
    const candidates = (state: GameState) => kind === 'npc' && npcId ? npcSummaryCandidates(state, npcId) :
      kind === 'short' || kind === 'medium' ? compressionCandidates(state, kind) : [];
    const selectRetry = (records: SummaryRecords | undefined, state: GameState) => {
      if (!records || !kind) return;
      const blocked = pendingFor(records, kind, candidates(state));
      if (input.retryId) {
        const pending = blocked.find(item => item.retryId === input.retryId);
        const canAuthorize = pending && blocked.every(item => item === pending ||
          (!pending.legacy && item.legacy && (!item.npcId || item.npcId === npcId)));
        requireData(input.immediate && pending && canAuthorize && (!pending.npcId || pending.npcId === npcId) &&
          (!pending.identityKey || (npcId && state.npc[npcId]?.identityKey === pending.identityKey)),
        'MEMORY_RETRY_CHANGED', '待确认请求已变化，请重新核对。');
        requireData(!pending.legacy || hasLegacySummaryFingerprint(pending.resultId),
          'MEMORY_LEGACY_BATCH_UNVERIFIABLE', legacyBatchUnverifiableMessage);
        return pending;
      }
      requireData(!blocked.length, 'MEMORY_PREVIOUS', unconfirmedSummaryMessage);
    };
    try {
      frozenConfig = input.summaryConfig ? SummaryConfigSchema.parse(structuredClone(input.summaryConfig)) : undefined;
      return await this.lock(input.saveId, async () => {
        let records: SummaryRecords | undefined;
        let started: PendingSummary | undefined;
        let identityKey: string | undefined;
        try {
          check();
          const { state, lineage, paused } = await this.repository.loadMemoryContext(input.saveId);
          check();
          if (input.attempts && kind) {
            records = new SummaryRecords(input.attempts, state);
            records.recover();
          }
          if (kind === 'npc' && input.immediate) requireData(Boolean(npcId), 'NPC_MEMORY_CONFLICT', '立即总结必须明确选择人物');
          identityKey = npcId ? state.npc[npcId]?.identityKey : undefined;
          const settings = currentSettings();
          const config = SummaryConfigSchema.parse(settings.summaryConfig ?? defaultSummaryConfig(kind ?? 'short'));
          if (input.automatic && (paused || !config.automatic)) return;
          const retry = selectRetry(records, state);
          const sourceIds = retry && authorizedSources(retry, candidates(state));
          const plan = (state: GameState) => kind === 'npc'
            ? planNpcSummary(state, npcId, { config, immediate: input.immediate, sourceIds })
            : planCompression(state, { layer: kind, config, immediate: input.immediate, sourceIds });
          const batch = plan(state);
          if (!batch) {
            requireData(!retry?.legacy, 'MEMORY_LEGACY_BATCH_MISMATCH', legacyBatchMismatchMessage);
            if (kind) records?.clearPreflight(kind, npcId);
            return;
          }
          observation.task = 'npcId' in batch ? 'npc' : batch.layer;
          const task = 'npcId' in batch ? 'memory.npc_summarize' : memoryTask(batch.layer);
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(batch)));
          const id = 'memory-' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
          // Old receipts have no source list. Only an exact batch fingerprint can authorize reuse of the receipt.
          requireData(!retry?.legacy || id === retry.resultId, 'MEMORY_LEGACY_BATCH_MISMATCH', legacyBatchMismatchMessage);
          const selected = selectPromptModules({ stage: 'memory', mode: 'regular', settings: defaultSettings(), memoryTask: task });
          const resources = await Promise.all(selected.map(async (module) => ({ module, text: (await readPromptResource(module.id)).replace(/\{\{(npcId|npcSummaryThreshold)\}\}/g, (_, key: string) =>
            key === 'npcId' && 'npcId' in batch ? batch.npcId : String(config.threshold)) })));
          const modules = resources.map(({ module, text }) => ({ id: module.id, version: module.version, contentSha256: module.contentSha256,
            role: 'system' as const, order: module.defaultOrder, characters: Array.from(text).length, estimatedTokens: estimateTokens(text).estimatedTokens }));
          const contentPrompt = settings.summaryConfig?.prompt ?? defaultSummaryConfig('npcId' in batch ? 'npc' : batch.layer).prompt;
          const memoryInput = 'npcId' in batch ? npcSummaryInput(batch) : compressionInput(batch);
          if ('groups' in memoryInput) observation.expectedGroups = memoryInput.groups.length;
          const messages = [{ role: 'system' as const, content: contentPrompt }, ...resources.map(({ text }) => ({ role: 'system' as const, content: text })),
            { role: 'user' as const, content: contextMessage({ MEMORY_TASK: memoryInput }) }];
          const size = contextStatistics(messages);
          requireData(size.characters <= compressionPolicy.requestCharacters && size.estimatedTokens <= compressionPolicy.requestEstimatedTokens, 'MEMORY_BUDGET', '完整请求超出预算，未调用模型');
          // Prompt assembly can yield. Check the actual saved settings, lineage, batch and ledger again
          // while still holding the save's memory lock, immediately before a possible paid request.
          const latest = await this.repository.loadMemoryContext(input.saveId);
          check();
          const freshSettings = currentSettings();
          if (input.automatic && (latest.paused || freshSettings.summaryConfig?.automatic === false)) return;
          requireData(latest.lineage.epoch === lineage.epoch, 'MEMORY_TIMELINE_CHANGED', '准备期间时间线已变化。');
          requireData(fingerprint(freshSettings) === fingerprint(settings) && fingerprint(plan(latest.state)) === fingerprint(batch),
            'MEMORY_CHANGED', '准备期间配置或来源已变化。');
          if (input.attempts && kind) {
            records = new SummaryRecords(input.attempts, latest.state);
            records.recover();
            selectRetry(records, latest.state);
          }
          const channel = typeof input.config === 'function' ? input.config() : input.config;
          const snapshot = requestSnapshot(channel, 'memory', input.vault);
          const keys = channel.channels.map(item => input.vault.get(item.id)).filter((key): key is string => Boolean(key));
          const secrets = [secretFor(snapshot), ...keys];
          observation.route(snapshot, secrets, [input.saveId, npcId, identityKey].filter((value): value is string => Boolean(value)));
          requireData(!keys.some(key => [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)].some(value => JSON.stringify(messages).includes(value))),
            'MEMORY_PERMISSION', '输入包含凭证内容，未发送；原条目已保留');
          if (input.automatic && input.attempts) {
            const key = `heijin.summary.rate:${state.saveId}:${state.createdAt}`;
            const recent = (JSON.parse(input.attempts.getItem(key) || '[]') as number[]).filter(time => Number.isFinite(time) && time > Date.now() - 3600000);
            requireData(recent.length < 12 && recent.filter(time => time > Date.now() - 60000).length < 3,
              'MEMORY_THROTTLED', '后台总结已达到本小时或本分钟的请求限额，待下一调度窗口检查');
            input.attempts.setItem(key, JSON.stringify([...recent, Date.now()]));
          }
          if (kind && records) {
            const sentIds = batch.entries.map(entry => entry.id);
            const turnIds = kind === 'npc' ? undefined : sourceUnion(batch.entries);
            const previousIds = retry?.sourceIds && [...retry.sourceIds, ...(retry.previousIds ?? [])].filter(source => !sentIds.includes(source));
            const previousTurnIds = retry?.turnIds && [...retry.turnIds, ...(retry.previousTurnIds ?? [])].filter(turn => !turnIds?.includes(turn));
            const marker = { status: 'pending' as const, kind, npcId, identityKey, resultId: id, sourceIds: sentIds,
              code: 'MEMORY_PREVIOUS', manual: input.immediate, retryId: crypto.randomUUID(), turnIds, previousIds, previousTurnIds,
              legacyRetryId: retry?.legacy ? retry.retryId : retry?.legacyRetryId };
            records.begin(marker, retry);
            started = marker;
          }
          input.onPhase?.('generating');
          const response = await this.client.generate(snapshot, messages, {
            ...observation.begin(started?.retryId),
            timeoutSeconds: freshSettings.timeoutSeconds, signal: attempt.controller.signal,
            inspection: { kind: 'memory', responseId: observation.id, memoryTask: task, mode: 'regular', saveId: state.saveId, revision: state.revision, modules },
          });
          check();
          observation.received(response.text);
          if (secrets.some((key) => [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)].some((value) => response.text.includes(value))))
            throw new AiError('invalid_output');
          if ('npcId' in batch) {
            const results = parseNpcSummary(response.text, batch, id);
            if (secrets.some((key) => results.some((result) => result.text.includes(key)))) throw new AiError('invalid_output');
            check(); attempt.saving = true; observation.step = 'save'; input.onPhase?.('saving');
            const saved = await this.repository.saveNpcSummary(batch, results, lineage, attempt.controller.signal);
            if (started && records) records.confirm(started);
            observation.validated();
            return saved;
          }
          const result = parseCompression(response.text, batch, id);
          if (secrets.some((key) => result.text.includes(key))) throw new AiError('invalid_output');
          check(); attempt.saving = true; observation.step = 'save'; input.onPhase?.('saving');
          const saved = await this.repository.saveMemoryCompression(batch, result, lineage, attempt.controller.signal);
          if (started && records) records.confirm(started);
          observation.validated();
          return saved;
        } catch (error) {
          const code = summaryErrorCode(error);
          const diagnostic = reportFailure(code, error);
          if (started) records?.fail(started.retryId, code, diagnostic);
          else if (kind && !['MEMORY_BUSY', 'MEMORY_THROTTLED', 'MEMORY_PREVIOUS', 'cancelled', 'MEMORY_CHANGED'].includes(code))
            records?.preflight({ status: 'preflight', kind, npcId, identityKey, code, manual: input.immediate, diagnostic });
          throw error;
        }
      });
    } catch (error) {
      if (!observedFailure) reportFailure(summaryErrorCode(error), error);
      throw error;
    } finally { if (this.active === attempt) this.active = undefined; }
  }
}
