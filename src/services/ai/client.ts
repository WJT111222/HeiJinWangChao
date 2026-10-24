import { AiError, safeAiError } from './errors';
import { redactInspection, requestInspections } from './inspection';
import type { InspectionScope } from './inspection';
import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { canTryModelCandidate, modelListCandidates, parseModelPage } from './modelListing';
import type { ModelListDiagnostics } from './modelListing';
import {
  wireRequest,
  responseText,
  nativeReasoning,
  usageFrom,
  authHeaders,
  record,
  array,
  string,
} from './protocols';
import type { AiMessage, Usage } from './protocols';
import { readSse } from './sse';
import { rememberThinkingCapability, unsupportedThinkingParameter, blockThinkingCapability } from './thinking';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutSeconds?: number;
  stream?: boolean;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onActivity?: (kind: 'content' | 'reasoning') => void;
  inspection?: InspectionScope;
}
export interface ModelListOptions extends RequestOptions {
  onDiagnostics?: (diagnostics: ModelListDiagnostics) => void;
}
export interface AiResponse {
  text: string;
  nativeReasoning?: string;
  usage?: Usage;
  diagnostics: string[];
  protocol: RequestSnapshot['channel']['protocol'];
  model: string;
}
async function operation<T>(
  options: RequestOptions,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (options.signal?.aborted) throw new AiError('cancelled');
  if (
    !Number.isFinite(options.timeoutSeconds ?? 120) ||
    (options.timeoutSeconds ?? 120) <= 0 ||
    (options.timeoutSeconds ?? 120) > 3600
  )
    throw new AiError('configuration');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    (options.timeoutSeconds ?? 120) * 1000,
  );
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let rejectAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new AiError(timedOut ? 'timeout' : 'cancelled'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([run(controller.signal), abort]);
  } catch (error) {
    if (controller.signal.aborted) throw new AiError(timedOut ? 'timeout' : 'cancelled');
    if (error instanceof AiError) throw error;
    throw new AiError('network');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
export class AiClient {
  constructor(private transport: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}
  private async response(url: string, init: RequestInit, signal: AbortSignal, snapshot?: RequestSnapshot) {
    const response = await this.transport(url, {
      ...init,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      const status = response.status;
      if (snapshot && snapshot.thinkingCapability !== 'none' && [400, 422].includes(status)
        && response.headers.get('content-type')?.includes('application/json')) {
        try {
          const error: unknown = await response.json();
          if (!signal.aborted && unsupportedThinkingParameter(error)) blockThinkingCapability(snapshot.channel, snapshot.model);
        } catch { /* 错误正文不外传，不猜测兼容能力，也不重发当前请求。 */ }
      }
      throw new AiError(
        status === 401 || status === 403
          ? 'authorization'
          : status === 404
            ? 'not_found'
            : status === 429
              ? 'rate_limit'
              : status >= 500
                ? 'server'
                : 'rejected',
        status,
      );
    }
    return response;
  }
  async generate(
    snapshot: RequestSnapshot,
    messages: readonly AiMessage[],
    options: RequestOptions = {},
  ): Promise<AiResponse> {
    const wire = wireRequest(snapshot, messages, options.stream === true);
    let inspectionId: string | undefined;
    let observedUsage: Usage | undefined;
    try {
      return await operation(options, async (signal) => {
        if (signal.aborted) throw new AiError('cancelled');
        inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection);
        const response = await this.response(wire.url, wire.init, signal, snapshot);
        const protocol = snapshot.channel.protocol;
        let text = '', reasoning = '',
          usage: Usage | undefined;
        if (!options.stream) {
          let data: unknown;
          try {
            data = await response.json();
          } catch {
            throw new AiError('invalid_json');
          }
          usage = usageFrom(data, protocol); observedUsage = usage;
          text = responseText(data, protocol);
          reasoning = nativeReasoning(data, protocol);
        } else {
          if (
            !response.body ||
            !response.headers.get('content-type')?.includes('text/event-stream')
          )
            throw new AiError('stream_interrupted');
          let terminal = false;
          for await (const event of readSse(response.body, signal)) {
            if (event.data === '[DONE]' && protocol === 'openai') {
              terminal = true;
              break;
            }
            let data: Record<string, unknown>;
            try {
              data = record(JSON.parse(event.data));
            } catch {
              throw new AiError('invalid_json');
            }
            if (data.error || data.type === 'error' || event.event === 'error')
              throw new AiError('rejected');
            const nextUsage = usageFrom(data, protocol);
            if (nextUsage) usage = { ...usage, ...nextUsage };
            observedUsage = usage;
            let delta = '';
            if (protocol === 'openai') {
              const choice = record(array(data.choices)[0]);
              if (choice.finish_reason === 'length') throw new AiError('output_limit');
              if (choice.finish_reason && choice.finish_reason !== 'stop')
                throw new AiError('stream_interrupted');
              delta = string(record(choice.delta).content);
            } else if (protocol === 'gemini') {
              const candidate = record(array(data.candidates)[0]);
              if (candidate.finishReason === 'MAX_TOKENS') throw new AiError('output_limit');
              if (candidate.finishReason && candidate.finishReason !== 'STOP')
                throw new AiError('stream_interrupted');
              if (candidate.finishReason === 'STOP') terminal = true;
              delta = array(record(candidate.content).parts)
                .filter((part) => record(part).thought !== true)
                .map((part) => string(record(part).text))
                .join('');
            } else {
              if (data.type === 'content_block_start' && record(data.content_block).type === 'text')
                delta = string(record(data.content_block).text);
              if (data.type === 'content_block_delta' && record(data.delta).type === 'text_delta')
                delta = string(record(data.delta).text);
              const stop = record(data.delta).stop_reason;
              if (stop === 'max_tokens') throw new AiError('output_limit');
              if (stop && stop !== 'end_turn' && stop !== 'stop_sequence')
                throw new AiError('stream_interrupted');
              if (data.type === 'message_stop') terminal = true;
            }
            const reasoningDelta = nativeReasoning(data, protocol, true);
            reasoning += reasoningDelta;
            if (reasoning.length > 2_000_000) throw new AiError('invalid_output');
            if (!signal.aborted) {
              if (reasoningDelta) { options.onActivity?.('reasoning'); options.onReasoningDelta?.(reasoningDelta); }
              if (delta) options.onActivity?.('content');
            }
            text += delta;
            if (text.length > 8_000_000) throw new AiError('invalid_output');
            if (delta && !signal.aborted) options.onDelta?.(delta);
          }
          if (!terminal) throw new AiError('stream_interrupted');
        }
        if (text.length > 8_000_000 || reasoning.length > 2_000_000) throw new AiError('invalid_output');
        if (!text.trim()) throw new AiError('empty');
        requestInspections.finish(inspectionId!, usage);
        return { text, ...(reasoning ? { nativeReasoning: reasoning } : {}), usage, diagnostics: wire.diagnostics, protocol, model: snapshot.model };
      });
    } catch (error) {
      if (inspectionId) requestInspections.finish(inspectionId, observedUsage, safeAiError(error).code);
      throw error;
    }
  }
  async listModels(snapshot: RequestSnapshot, options: ModelListOptions = {}): Promise<string[]> {
    return operation(options, async (signal) => {
      const candidates = modelListCandidates(snapshot), protocol = snapshot.channel.protocol;
      async function read(client: AiClient, url: string) {
        if (signal.aborted) throw new AiError('cancelled');
        const response = await client.response(url, { headers: authHeaders(snapshot) }, signal);
        let data: unknown;
        try { data = await response.json(); } catch { throw new AiError('invalid_json', response.status); }
        if (signal.aborted) throw new AiError('cancelled');
        try { return { ...parseModelPage(data, protocol, secretFor(snapshot)), httpStatus: response.status }; }
        catch (error) { if (error instanceof AiError) throw new AiError(error.code, response.status); throw error; }
      }
      let first: Awaited<ReturnType<typeof read>> | undefined, selected = '', attempts = 0;
      let failure: unknown = new AiError('not_found');
      for (const url of candidates) {
        attempts++;
        try { first = await read(this, url); selected = url; break; }
        catch (error) {
          if (signal.aborted || !canTryModelCandidate(error)) throw error;
          // 不用后续404覆盖更明确的JSON/格式/网络错误；不展示原始服务响应。
          if (!(error instanceof AiError && [404, 405].includes(error.status ?? 0))
            || (failure instanceof AiError && failure.code === 'not_found')) failure = error;
        }
      }
      if (!first) throw failure;
      const ids = new Set<string>(), seen = new Set([selected]);
      let page = first, rawEntries = 0, validEntries = 0;
      const paginationKey = first.next?.key;
      for (let number = 1; number <= 20; number++) {
        rawEntries += page.rawEntries; validEntries += page.entries.length;
        for (const item of page.entries) {
          ids.add(item.id); rememberThinkingCapability(snapshot.channel, item.id, item.source);
        }
        if (page.next && page.next.key !== paginationKey) throw new AiError('model_list_pagination');
        const next = new URL(selected);
        if (page.next) next.searchParams.set(page.next.key, page.next.value);
        if (page.next && seen.has(next.href)) throw new AiError('model_list_pagination');
        if (!page.next || number === 20) {
          const safeEndpoint = new URL(selected); safeEndpoint.search = '';
          options.onDiagnostics?.({ rawEntries, validEntries, filteredEntries: rawEntries - validEntries,
            duplicateEntries: validEntries - ids.size, uniqueModels: ids.size, pages: number,
            attemptedEndpoints: attempts, complete: !page.next,
            fullEndpointInput: protocol === 'openai' && /\/(?:chat\/completions|models)\/*$/i.test(new URL(snapshot.channel.baseUrl).pathname),
            endpoint: redactInspection(safeEndpoint.href, [secretFor(snapshot)]), httpStatus: first.httpStatus });
          return [...ids].sort();
        }
        seen.add(next.href); page = await read(this, next.href);
      }
      throw new AiError('model_list_pagination');
    });
  }
}
