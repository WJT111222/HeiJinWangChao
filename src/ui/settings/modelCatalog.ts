import { AiClient } from '../../services/ai/client';
import type { Channel } from '../../services/ai/configuration';
import type { CredentialVault } from '../../services/ai/credentials';
import { channelSnapshot, secretFor } from '../../services/ai/snapshot';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import { safeAiError } from '../../services/ai/errors';

export interface ModelList { status: 'loading' | 'ready' | 'empty' | 'error'; models: readonly string[]; message: string }
interface Entry { snapshot: RequestSnapshot; controller: AbortController; pending?: Promise<void> }
// 设置页面共享：四条路由复用同渠道结果。凭证只保存在原快照 WeakMap，不进入可观察状态或存储。
export class ModelCatalog {
  private entries = new Map<string, Entry>();
  private state: Readonly<Record<string, ModelList>> = {};
  private listeners = new Set<() => void>();
  constructor(private client = new AiClient()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(id: string, value: ModelList) {
    this.state = { ...this.state, [id]: value }; this.listeners.forEach((listener) => listener());
  }
  load(channel: Channel, vault: CredentialVault, timeoutSeconds: number, force = false): Promise<void> {
    let snapshot: RequestSnapshot;
    try { snapshot = channelSnapshot(channel, vault); }
    catch (error) { this.remove(channel.id); this.publish(channel.id, { status: 'error', models: [], message: safeAiError(error).message }); return Promise.resolve(); }
    const previous = this.entries.get(channel.id);
    const same = previous && previous.snapshot.channel.protocol === channel.protocol && previous.snapshot.channel.baseUrl === channel.baseUrl
      && secretFor(previous.snapshot) === secretFor(snapshot);
    if (same && (previous.pending || !force)) return previous.pending ?? Promise.resolve();
    previous?.controller.abort();
    const entry: Entry = { snapshot, controller: new AbortController() };
    this.entries.set(channel.id, entry);
    const models = same ? this.state[channel.id]?.models ?? [] : [];
    this.publish(channel.id, { status: 'loading', models, message: '正在获取模型列表…' });
    entry.pending = this.client.listModels(snapshot, { signal: entry.controller.signal, timeoutSeconds }).then((result) => {
      if (this.entries.get(channel.id) !== entry || entry.controller.signal.aborted) return;
      this.publish(channel.id, { models: result, status: result.length ? 'ready' : 'empty',
        message: result.length ? `已获取 ${result.length} 个模型；也可手动填写。` : '服务未返回可用模型，可手动填写模型 ID。' });
    }).catch((error: unknown) => {
      if (this.entries.get(channel.id) !== entry || entry.controller.signal.aborted) return;
      this.publish(channel.id, { status: 'error', models, message: `${safeAiError(error).message} 可刷新重试或手动填写模型 ID。` });
    }).finally(() => { if (this.entries.get(channel.id) === entry) entry.pending = undefined; });
    return entry.pending;
  }
  remove(id: string) {
    this.entries.get(id)?.controller.abort(); this.entries.delete(id);
    const next = { ...this.state }; delete next[id]; this.state = next; this.listeners.forEach((listener) => listener());
  }
  dispose() { this.entries.forEach((entry) => entry.controller.abort()); this.entries.clear(); }
}
