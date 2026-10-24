import { modelIdSchema } from './configuration';
import type { Protocol } from './configuration';
import { AiError } from './errors';
import { record } from './protocols';
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
  if (snapshot.channel.protocol !== 'openai') { push(`${base}/models`); return paths; }
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
  for (const item of values) {
    const value = protocol === 'gemini' ? record(item).name : typeof item === 'string' && protocol === 'openai' ? item : record(item).id;
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
  return undefined;
}
