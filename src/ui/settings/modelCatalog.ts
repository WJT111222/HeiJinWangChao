import { AiClient } from '../../services/ai/client';
import type { Channel } from '../../services/ai/configuration';
import type { CredentialVault } from '../../services/ai/credentials';
import { channelSnapshot, secretFor } from '../../services/ai/snapshot';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import { modelListFailureMessage } from '../../services/ai/modelListing';
import type { ModelListDiagnostics, ModelListFailureDiagnostics } from '../../services/ai/modelListing';
import { safeAiError } from '../../services/ai/errors';

export interface ModelList { status: 'loading' | 'ready' | 'empty' | 'error'; models: readonly string[]; message: string; diagnostics?: ModelListDiagnostics; failureDiagnostics?: ModelListFailureDiagnostics }
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
    const previousDiagnostics = same ? this.state[channel.id]?.diagnostics : undefined;
    this.publish(channel.id, { status: 'loading', models, diagnostics: previousDiagnostics, message: '正在获取模型列表…' });
    let diagnostics: ModelListDiagnostics | undefined, failureDiagnostics: ModelListFailureDiagnostics | undefined;
    entry.pending = this.client.listModels(snapshot, { signal: entry.controller.signal, timeoutSeconds,
      onDiagnostics: (value) => { diagnostics = value; }, onFailureDiagnostics: (value) => { failureDiagnostics = value; } }).then((result) => {
      if (this.entries.get(channel.id) !== entry || entry.controller.signal.aborted) return;
      const counts = diagnostics ? ` 原始条目 ${diagnostics.rawEntries}，有效 ${diagnostics.validEntries}，过滤 ${diagnostics.filteredEntries}，重复 ${diagnostics.duplicateEntries}；列表模型 ${diagnostics.uniqueModels} 个，读取 ${diagnostics.pages} 页，同源端点尝试 ${diagnostics.attemptedEndpoints} 个（不含默认或手填项）。` : '';
      const limit = diagnostics?.complete === false ? ' 已达20页读取上限，列表尚未完整获取，可手动补充模型。' : '';
      const endpoint = diagnostics ? ` 列表端点 ${diagnostics.endpoint}，HTTP ${diagnostics.httpStatus}。` : '';
      const corrected = diagnostics?.fullEndpointInput ? ' 列表已兼容完整接口地址；生成请求仍使用原配置，请将 Base URL 改为接口根地址。' : '';
      this.publish(channel.id, { models: result, diagnostics, status: result.length ? 'ready' : 'empty',
        message: (result.length ? `当前接口返回 ${result.length} 个模型。列表由服务端提供，可能不是该平台全部可用模型。`
          : '请求成功，服务未返回可用模型，可手动填写模型 ID。') + counts + endpoint + limit + corrected });
    }).catch((error: unknown) => {
      if (this.entries.get(channel.id) !== entry || entry.controller.signal.aborted) return;
      const status = safeAiError(error).status;
      const http = failureDiagnostics || status === undefined || status === 404 ? '' : `（HTTP ${status}）`;
      const details = failureDiagnostics ? ` 最后尝试：${failureDiagnostics.endpoint ?? '尚未发出请求'}；候选 ${failureDiagnostics.attemptedEndpoints} 个；已读取 ${failureDiagnostics.pagesRead} 页；${failureDiagnostics.httpStatus === undefined ? '未获得 HTTP 状态' : `HTTP ${failureDiagnostics.httpStatus}`}。` : '';
      const retained = models.length ? ` 保留上次模型列表 ${models.length} 个，非本次请求结果。` : '';
      this.publish(channel.id, { status: 'error', models, diagnostics: previousDiagnostics, failureDiagnostics,
        message: `本次获取失败：${modelListFailureMessage(error) ?? safeAiError(error).message}${http}${details}${retained} 可刷新重试或手动填写模型 ID。` });
    }).finally(() => { if (this.entries.get(channel.id) === entry) entry.pending = undefined; });
    return entry.pending;
  }
  remove(id: string) {
    this.entries.get(id)?.controller.abort(); this.entries.delete(id);
    const next = { ...this.state }; delete next[id]; this.state = next; this.listeners.forEach((listener) => listener());
  }
  dispose() { this.entries.forEach((entry) => entry.controller.abort()); this.entries.clear(); }
}
