import { DataError, requireData } from '../domain/common';
import type { GameState } from '../domain/state';
import { fingerprint } from '../domain/commands';
import { planCompression, compressionInput, parseCompression, memoryTask, compressionPolicy } from '../domain/memories/compression';
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
import { AiError } from '../services/ai/errors';

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
  constructor(private repository: Pick<SaveRepository, 'load' | 'saveMemoryCompression'>,
    private client = new AiClient(), private lock: MemoryLock = browserMemoryLock) {}
  cancel() {
    if (this.active?.saving) return false;
    this.active?.controller.abort(); return true;
  }
  async run(input: { saveId: string; config: AiConfig; vault: CredentialVault; timeoutSeconds: number;
    onPhase?: (phase: 'generating' | 'saving') => void }): Promise<GameState | undefined> {
    if (this.active) throw new DataError('MEMORY_BUSY', '记忆维护已在运行');
    const attempt = { controller: new AbortController(), saving: false };
    this.active = attempt;
    const check = () => { if (attempt.controller.signal.aborted) throw new AiError('cancelled'); };
    try {
      return await this.lock(input.saveId, async () => {
        check();
        const state = await this.repository.load(input.saveId);
        const batch = planCompression(state);
        if (!batch) return undefined;
        const snapshot = requestSnapshot(input.config, 'memory', input.vault);
        const keys = input.config.channels.map((channel) => input.vault.get(channel.id)).filter((key): key is string => Boolean(key));
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(batch)));
        const id = 'memory-' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const selected = selectPromptModules({ stage: 'memory', mode: 'regular', settings: defaultSettings(), memoryTask: memoryTask(batch.layer) });
        const resources = await Promise.all(selected.map(async (module) => ({ module, text: await readPromptResource(module.id) })));
        const modules = resources.map(({ module, text }) => ({ id: module.id, version: module.version, contentSha256: module.contentSha256,
          role: 'system' as const, order: module.defaultOrder, characters: Array.from(text).length, estimatedTokens: estimateTokens(text).estimatedTokens }));
        const messages = [...resources.map(({ text }) => ({ role: 'system' as const, content: text })),
          { role: 'user' as const, content: contextMessage({ MEMORY_TASK: compressionInput(batch) }) }];
        const size = contextStatistics(messages);
        requireData(size.characters <= compressionPolicy.requestCharacters && size.estimatedTokens <= compressionPolicy.requestEstimatedTokens, 'MEMORY_BUDGET', '完整请求超出预算，未调用模型');
        requireData(!keys.some((key) => [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)].some((value) => JSON.stringify(messages).includes(value))),
          'MEMORY_PERMISSION', '输入包含凭证内容，未发送；原条目已保留');
        check(); input.onPhase?.('generating');
        const response = await this.client.generate(snapshot, messages, { timeoutSeconds: input.timeoutSeconds, signal: attempt.controller.signal,
          inspection: { kind: 'memory', memoryTask: memoryTask(batch.layer), mode: 'regular', saveId: state.saveId, revision: state.revision, modules } });
        check();
        if ([secretFor(snapshot), ...keys].some((key) => [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)].some((value) => response.text.includes(value))))
          throw new AiError('invalid_output');
        const result = parseCompression(response.text, batch, id);
        if ([secretFor(snapshot), ...keys].some((key) => result.text.includes(key)))
          throw new AiError('invalid_output');
        check(); attempt.saving = true; input.onPhase?.('saving');
        return await this.repository.saveMemoryCompression(batch, result, attempt.controller.signal);
      });
    } finally { if (this.active === attempt) this.active = undefined; }
  }
}
