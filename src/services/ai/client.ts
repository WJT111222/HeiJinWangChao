import { AiError, safeAiError } from './errors';
import { requestInspections } from './inspection';
import type { InspectionScope } from './inspection';
import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { canTryModelCandidate, modelListCandidates, parseModelPage, safeModelListEndpoint } from './modelListing';
import type { ModelListDiagnostics, ModelListFailureDiagnostics } from './modelListing';
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
import { checkFinish, LeadingThink, rememberUnsupported, splitLeadingThink, unsupportedParameter } from './compat';
import { isOpenAiCompatible } from './configuration';
import { responseContent } from './responseContent';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutSeconds?: number;
  stream?: boolean;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  /** Read-only observations before compatibility extraction; not a second request. */
  onRawTextDelta?: (text: string) => void;
  onNativeReasoningDelta?: (text: string) => void;
  /** Only public text actually extracted from a leading <think> block. */
  onCompatibilityReasoningDelta?: (text: string) => void;
  onActivity?: (kind: 'content' | 'reasoning') => void;
  inspection?: InspectionScope;
}
export interface ModelListOptions extends RequestOptions {
  onDiagnostics?: (diagnostics: ModelListDiagnostics) => void;
  onFailureDiagnostics?: (diagnostics: ModelListFailureDiagnostics) => void;
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
      if (snapshot && (snapshot.thinkingCapability !== 'none' || snapshot.channel.protocol === 'openai') && [400, 422].includes(status)
        && response.headers.get('content-type')?.includes('application/json')) {
        try {
          const error: unknown = await response.json();
          if (!signal.aborted && snapshot.thinkingCapability !== 'none' && unsupportedThinkingParameter(error)) blockThinkingCapability(snapshot.channel, snapshot.model);
          const sentBody = record(typeof init.body === 'string' ? JSON.parse(init.body) : undefined);
          const parameter = snapshot.channel.protocol === 'openai' ? unsupportedParameter(error, {
            maxTokens: Object.hasOwn(sentBody, 'max_tokens'), temperature: Object.hasOwn(sentBody, 'temperature') }) : undefined;
          if (!signal.aborted && parameter) {
            rememberUnsupported(snapshot.channel, snapshot.model, parameter);
            throw new AiError('parameter_adjusted', status);
          }
        } catch (error) { if (error instanceof AiError) throw error; /* 错误正文不外传，不猜测兼容能力，也不重发当前请求。 */ }
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
        try { inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection); }
        catch { /* 只读诊断失败不能阻断真实发送。 */ }
        const response = await this.response(wire.url, wire.init, signal, snapshot);
        const protocol = snapshot.channel.protocol;
        let text = '', reasoning = '',
          usage: Usage | undefined;
        // 部分中转忽略 stream:true 直接返回完整 JSON；按非流式读取，再一次性交给进度回调。
        const wholeJson = options.stream === true && /application\/json/i.test(response.headers.get('content-type') ?? '');
        if (!options.stream || wholeJson) {
          let data: unknown;
          try {
            data = await response.json();
          } catch {
            throw new AiError('invalid_json');
          }
          usage = usageFrom(data, protocol); observedUsage = usage;
          if (!signal.aborted) {
            const raw = responseContent(data, protocol), native = nativeReasoning(data, protocol);
            if (raw) options.onRawTextDelta?.(raw);
            if (native) options.onNativeReasoningDelta?.(native);
          }
          text = responseText(data, protocol);
          reasoning = nativeReasoning(data, protocol);
          if (isOpenAiCompatible(protocol)) {
            const split = splitLeadingThink(text);
            text = split.content;
            if (split.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(split.reasoning);
            if (!reasoning) reasoning = split.reasoning;
          }
          if (wholeJson && !signal.aborted) {
            if (reasoning) { options.onActivity?.('reasoning'); options.onReasoningDelta?.(reasoning); }
            if (text) { options.onActivity?.('content'); options.onDelta?.(text); }
          }
        } else {
          // Content-Type 不可靠（有的中转写成 text/plain），只要有响应体就按 SSE 解析；是否完整由结束标记判断。
          if (!response.body) throw new AiError('stream_interrupted');
          let terminal = false, nativeSeen = false;
          const think = isOpenAiCompatible(protocol) ? new LeadingThink() : undefined;
          for await (const event of readSse(response.body, signal)) {
            if (event.data === '[DONE]' && isOpenAiCompatible(protocol)) {
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
            const rawDelta = responseContent(data, protocol, true), native = nativeReasoning(data, protocol, true);
            if (!signal.aborted) {
              if (rawDelta) options.onRawTextDelta?.(rawDelta);
              if (native) options.onNativeReasoningDelta?.(native);
            }
            const nextUsage = usageFrom(data, protocol);
            if (nextUsage) usage = { ...usage, ...nextUsage };
            observedUsage = usage;
            let delta = '';
            let thinkReasoning = '';
            if (isOpenAiCompatible(protocol)) {
              const choice = record(array(data.choices)[0]);
              if (checkFinish(choice.finish_reason)) terminal = true;
              const split = think!.push(string(record(choice.delta).content));
              delta = split.content; thinkReasoning = split.reasoning;
            } else if (protocol === 'gemini') {
              if (record(data.promptFeedback).blockReason) throw new AiError('content_filter');
              const candidate = record(array(data.candidates)[0]);
              if (checkFinish(candidate.finishReason)) terminal = true;
              delta = array(record(candidate.content).parts)
                .filter((part) => record(part).thought !== true)
                .map((part) => string(record(part).text))
                .join('');
            } else {
              if (data.type === 'content_block_start' && record(data.content_block).type === 'text')
                delta = string(record(data.content_block).text);
              if (data.type === 'content_block_delta' && record(data.delta).type === 'text_delta')
                delta = string(record(data.delta).text);
              checkFinish(record(data.delta).stop_reason);
              if (data.type === 'message_stop') terminal = true;
            }
            if (native) nativeSeen = true;
            // 服务已单独给出思考时，不再把正文里的 <think> 重复算进去。
            const reasoningDelta = native || (nativeSeen ? '' : thinkReasoning);
            reasoning += reasoningDelta;
            if (reasoning.length > 2_000_000) throw new AiError('invalid_output');
            if (!signal.aborted) {
              if (thinkReasoning) options.onCompatibilityReasoningDelta?.(thinkReasoning);
              if (reasoningDelta) { options.onActivity?.('reasoning'); options.onReasoningDelta?.(reasoningDelta); }
              if (delta) options.onActivity?.('content');
            }
            text += delta;
            if (text.length > 8_000_000) throw new AiError('invalid_output');
            if (delta && !signal.aborted) options.onDelta?.(delta);
          }
          if (think) {
            const rest = think.end();
            if (rest.content) { text += rest.content; if (!signal.aborted) { options.onActivity?.('content'); options.onDelta?.(rest.content); } }
            if (rest.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(rest.reasoning);
            if (rest.reasoning && !nativeSeen) { reasoning += rest.reasoning; if (!signal.aborted) options.onReasoningDelta?.(rest.reasoning); }
          }
          if (!terminal) throw new AiError('stream_interrupted');
        }
        if (text.length > 8_000_000 || reasoning.length > 2_000_000) throw new AiError('invalid_output');
        if (!text.trim()) throw new AiError('empty');
        try { if (inspectionId) requestInspections.finish(inspectionId, usage); }
        catch { /* 诊断观察器失败不改变响应。 */ }
        return { text, ...(reasoning ? { nativeReasoning: reasoning } : {}), usage, diagnostics: wire.diagnostics, protocol, model: snapshot.model };
      });
    } catch (error) {
      try { if (inspectionId) requestInspections.finish(inspectionId, observedUsage, safeAiError(error).code); }
      catch { /* 保留原始失败语义。 */ }
      throw error;
    }
  }
  async listModels(snapshot: RequestSnapshot, options: ModelListOptions = {}): Promise<string[]> {
    let lastEndpoint: string | undefined, lastHttpStatus: number | undefined, attempts = 0, pagesRead = 0;
    try { return await operation(options, async (signal) => {
      const candidates = modelListCandidates(snapshot), protocol = snapshot.channel.protocol;
      async function read(client: AiClient, url: string, candidate = false) {
        if (signal.aborted) throw new AiError('cancelled');
        const headers = authHeaders(snapshot);
        lastEndpoint = url; lastHttpStatus = undefined;
        if (candidate) attempts++;
        let response: Response;
        try { response = await client.response(url, { headers }, signal); }
        catch (error) {
          if (error instanceof AiError && error.status === 0) throw new AiError('network');
          if (!signal.aborted && error instanceof AiError) lastHttpStatus = error.status;
          throw error;
        }
        if (signal.aborted) throw new AiError('cancelled');
        lastHttpStatus = response.status;
        let data: unknown;
        try { data = await response.json(); } catch { throw new AiError('invalid_json', response.status); }
        if (signal.aborted) throw new AiError('cancelled');
        try { const page = parseModelPage(data, protocol, secretFor(snapshot)); pagesRead++; return { ...page, httpStatus: response.status }; }
        catch (error) { if (error instanceof AiError) throw new AiError(error.code, response.status); throw error; }
      }
      let first: Awaited<ReturnType<typeof read>> | undefined, selected = '';
      let failure: unknown = new AiError('not_found');
      for (const url of candidates) {
        try { first = await read(this, url, true); selected = url; break; }
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
          options.onDiagnostics?.({ rawEntries, validEntries, filteredEntries: rawEntries - validEntries,
            duplicateEntries: validEntries - ids.size, uniqueModels: ids.size, pages: number,
            attemptedEndpoints: attempts, complete: !page.next,
            fullEndpointInput: /\/models\/*$/i.test(new URL(snapshot.channel.baseUrl).pathname)
              || (isOpenAiCompatible(protocol) && /\/chat\/completions\/*$/i.test(new URL(snapshot.channel.baseUrl).pathname)),
            endpoint: safeModelListEndpoint(selected, secretFor(snapshot)), httpStatus: first.httpStatus });
          return [...ids].sort();
        }
        seen.add(next.href); page = await read(this, next.href);
      }
      throw new AiError('model_list_pagination');
    }); } catch (error) {
      try { options.onFailureDiagnostics?.({ endpoint: lastEndpoint ? safeModelListEndpoint(lastEndpoint, secretFor(snapshot)) : undefined,
        attemptedEndpoints: attempts, httpStatus: lastHttpStatus, pagesRead, errorCode: error instanceof AiError ? error.code : 'unknown' }); }
      catch { /* 诊断观察器失败不能改变请求的原始错误或取消语义。 */ }
      throw error;
    }
  }
}
