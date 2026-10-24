import { modelIdSchema } from './configuration';
import type { Protocol } from './configuration';
import { AiError } from './errors';
import { record } from './protocols';
import { redactInspection } from './inspection';
import type { AiErrorCode } from './errors';
import type { RequestSnapshot } from './snapshot';

export interface ModelListDiagnostics {
  rawEntries: number;
  validEntries: number;
  filteredEntries: number;
  duplicateEntries: number;
  uniqueModels: number;
  pages: number;
  attemptedEndpoints: number;
  complete: boolean;
  fullEndpointInput: boolean;
  endpoint: string;
  httpStatus: number;
}
export interface ModelListFailureDiagnostics {
  endpoint?: string;
  attemptedEndpoints: number;
  httpStatus?: number;
  pagesRead: number;
  errorCode: AiErrorCode | 'unknown';
}
export function safeModelListEndpoint(value: string, secret: string) {
  const url = new URL(value); url.search = ''; url.hash = '';
  let hideNext = false;
  const path = url.pathname.split('/').map((part) => {
    let decoded = part, invalidEncoding = false;
    for (let layer = 0; layer < 5; layer++) {
      let next: string; try { next = decodeURIComponent(decoded); } catch { invalidEncoding = true; break; }
      if (next === decoded) break; decoded = next;
    }
    const sensitive = secretForms(secret).some((key) => decoded.includes(key) || part.includes(key));
    // 编码分隔符可能把令牌键和值装在同一段；键后跨原始斜杠的值也继续隐藏。
    const hidden = hideNext; hideNext = /^(?:api[-_]?key|access[-_]?token|token|authorization)$/i.test(decoded.split(/[/\\=;?#&]/).filter(Boolean).at(-1) ?? '');
    if (sensitive) return '[密钥已隐藏]';
    if (hidden || invalidEncoding || /[/\\=;?#&]/.test(decoded) || /^(?:Bearer|Basic)\s/i.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) return '[敏感路径已隐藏]';
    return part;
  }).join('/');
  return redactInspection(url.origin + path, [secret]);
}
export interface ModelPage {
  entries: { id: string; source: unknown }[];
  rawEntries: number;
  next?: { key: 'pageToken' | 'after_id' | 'after' | 'cursor' | 'page'; value: string };
}
const control = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const secretForms = (secret: string) => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)].filter(Boolean);

// 仅用于列表；绝不改写保存的 Base URL 或 wireRequest 的生成端点。
export function modelListCandidates(snapshot: RequestSnapshot): string[] {
  const url = new URL(snapshot.channel.baseUrl), paths: string[] = [];
  let base = url.pathname.replace(/\/+$/, '');
  const push = (path: string) => {
    const candidate = new URL(url.origin); candidate.pathname = path;
    if (snapshot.channel.protocol === 'anthropic') candidate.searchParams.set('limit', '100');
    if (candidate.origin !== url.origin) throw new AiError('configuration');
    if (!paths.includes(candidate.href)) paths.push(candidate.href);
  };
  if (snapshot.channel.protocol !== 'openai') { push(/\/models$/i.test(base) ? base : `${base}/models`); return paths; }
  const completeModels = /\/models$/i.test(base);
  const configuredModels = base;
  base = base.replace(/\/(?:chat\/completions|models)$/i, '');
  push(completeModels ? configuredModels : `${base}/models`);
  const segments = base.split('/').filter(Boolean);
  let version = -1;
  for (let index = segments.length - 1; index >= 0; index--)
    if (/^v\d+(?:beta\d*)?$/i.test(segments[index])) { version = index; break; }
  if (version >= 0) push(`/${[...segments.slice(0, version), 'models'].join('/')}`);
  else push(`${base}/v1/models`);
  push('/models'); push('/v1/models');
  return paths.slice(0, 4);
}
function nextPage(data: Record<string, unknown>, protocol: Protocol, secret: string): ModelPage['next'] {
  function cursor(key: NonNullable<ModelPage['next']>['key'], value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048 || control.test(value)
      || secretForms(secret).some((part) => value.includes(part))) throw new AiError('model_list_pagination');
    return { key, value };
  }
  if (protocol === 'gemini') {
    if (data.nextPageToken === undefined || data.nextPageToken === null || data.nextPageToken === '') return;
    return cursor('pageToken', data.nextPageToken);
  }
  if (data.has_more !== undefined && typeof data.has_more !== 'boolean') throw new AiError('model_list_pagination');
  if (protocol === 'anthropic') return data.has_more === true ? cursor('after_id', data.last_id) : undefined;
  const continuations: NonNullable<ModelPage['next']>[] = [];
  if (data.next_cursor !== undefined && data.next_cursor !== null && data.next_cursor !== '') continuations.push(cursor('cursor', data.next_cursor));
  if (data.next_page !== undefined && data.next_page !== null) {
    if (!Number.isSafeInteger(data.next_page) || typeof data.next_page !== 'number' || data.next_page < 1 || data.next_page > 1000000)
      throw new AiError('model_list_pagination');
    continuations.push({ key: 'page', value: String(data.next_page) });
  }
  if (data.has_more === true && !continuations.length && data.last_id !== undefined) continuations.push(cursor('after', data.last_id));
  // 不跟随 next/links.next 中的 URL；只在当前已成功的模型列表路径构造明确游标。
  if (continuations.length > 1 || (data.has_more === false && continuations.length)
    || (data.has_more === true && !continuations.length) || (!continuations.length && (data.next || record(data.links).next || data.nextPageToken)))
    throw new AiError('model_list_pagination');
  return continuations[0];
}
export function parseModelPage(raw: unknown, protocol: Protocol, secret: string): ModelPage {
  const data = record(raw);
  if (data.error) throw new AiError('rejected');
  const values: unknown = protocol === 'gemini' ? data.models : protocol === 'anthropic' ? data.data
    : Array.isArray(raw) ? raw : Array.isArray(data.data) ? data.data : data.models;
  if (!Array.isArray(values)) throw new AiError('model_list_format');
  const entries: ModelPage['entries'] = [];
  // 仅识别 Ollama 官方 ListModelResponse：model 是请求标识，name 不作为回退ID。
  const ollamaModel = (item: unknown) => {
    const value = record(item);
    return protocol === 'openai' && values === data.models && typeof value.model === 'string'
      && typeof value.modified_at === 'string' && Number.isFinite(Date.parse(value.modified_at))
      && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0
      && typeof value.digest === 'string' && Boolean(value.digest);
  };
  if (protocol === 'openai' && values.length && !values.some((item) => typeof item === 'string'
    || Object.hasOwn(record(item), 'id') || ollamaModel(item))) throw new AiError('model_list_format');
  for (const item of values) {
    const value = protocol === 'gemini' ? record(item).name : typeof item === 'string' && protocol === 'openai' ? item : Object.hasOwn(record(item), 'id') ? record(item).id : ollamaModel(item) ? record(item).model : undefined;
    const id = typeof value === 'string' ? value.trim().replace(protocol === 'gemini' ? /^models\// : /$^/, '') : '';
    if (modelIdSchema.safeParse(id).success && !secretForms(secret).some((part) => id.includes(part))) entries.push({ id, source: item });
  }
  return { entries, rawEntries: values.length, next: nextPage(data, protocol, secret) };
}
export function canTryModelCandidate(error: unknown) {
  return error instanceof TypeError || (error instanceof AiError && (error.status === 404 || error.status === 405
    || error.code === 'invalid_json' || error.code === 'model_list_format' || error.code === 'network'));
}
export function modelListFailureMessage(error: unknown) {
  if (error instanceof AiError && error.code === 'not_found') return '模型列表接口不存在或路径不受支持（404）；未更改模型配置。';
  if (error instanceof AiError && error.status === 405) return '模型列表请求方法或路径不受支持（405）；未更改模型配置。';
  return undefined;
}
