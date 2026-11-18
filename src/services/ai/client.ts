import { observeToolTrace, StoryToolTraceRecorder } from './storyToolTrace';
import type { StoryToolTrace } from './storyToolTrace';
import { toolFailureMetadata } from './storyToolContract';
import { StoryToolAssembler } from './storyToolAssembler';
import { AiError, safeAiError } from './errors';
import { requestInspections } from './inspection';
import type { InspectionScope } from './inspection';
import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { canTryModelCandidate, modelListCandidates, parseModelPage, safeModelListEndpoint } from './modelListing';
import type { ModelListDiagnostics, ModelListFailureDiagnostics } from './modelListing';
import {
  wireRequest,
  authHeaders,
  record,
} from './protocols';
import type { AiMessage, Usage } from './protocols';
import { readAiResponseEvents } from './responseEvents';
import { rememberThinkingCapability, unsupportedThinkingParameter, blockThinkingCapability } from './thinking';
import { checkFinish, LeadingThink, rememberUnsupported, splitLeadingThink, unsupportedParameter } from './compat';
import { isOpenAiCompatible } from './configuration';
import { responseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';

export interface RequestOptions {
  /** Internal Story-only handoff: caller must strictly validate received content. */
  validateStoryOutputLimit?: boolean;
  /** Opt-in Story output carrier only; never executes tools. */
  storyToolOutput?: boolean;
  onStoryToolTrace?: (trace: StoryToolTrace) => void;
  onResponseDiagnostics?: (diagnostics: ResponseDiagnostics) => void;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  stream?: boolean;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  /** Read-only observations before compatibility extraction; not a second request. */
  onRawTextDelta?: (text: string) => void;
  onNativeReasoningDelta?: (text: string) => void;
  /** Read-only event observation; never used as accepted model text. */
  onRawResponse?: (event: RawResponseObservation) => void;
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
  outputLimited?: boolean;
  nativeReasoning?: string;
  usage?: Usage;
  diagnostics: string[];
  protocol: RequestSnapshot['channel']['protocol'];
  model: string;
}
async function operation<T>(
  options: RequestOptions,
  run: (signal: AbortSignal) => Promise<T>,
  trace?: StoryToolTraceRecorder,
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
  if (trace) observeToolTrace(() => trace.operationStarted());
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
  private async response(url: string, init: RequestInit, signal: AbortSignal, snapshot?: RequestSnapshot, observe?: (value: ResponseDiagnostics) => void, trace?: StoryToolTraceRecorder) {
    if (trace) observeToolTrace(() => trace.dispatch());
    const response = await this.transport(url, {
      ...init,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (trace && !signal.aborted) observeToolTrace(() => trace.http(response.status));
    if (!response.ok) {
      const status = response.status;
      // Do not wait for an extra error body: preserve HTTP failure/retry timing.
      // Only the JSON already consumed for compatibility below is projected.
      if (!signal.aborted) observe?.({ transport: 'http', httpStatus: status, complete: false });
      if (snapshot && (snapshot.thinkingCapability !== 'none' || snapshot.channel.protocol === 'openai') && [400, 422].includes(status)
        && response.headers.get('content-type')?.includes('application/json')) {
        try {
          const error: unknown = await response.json();
          if (!signal.aborted) observe?.({ ...responseDiagnostics(error, snapshot.channel.protocol), transport: 'http', httpStatus: status, complete: true });
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
    const carrier = options.storyToolOutput === true ? new StoryToolAssembler(snapshot.channel.protocol) : undefined;
    const wire = wireRequest(snapshot, messages, options.stream === true, Boolean(carrier));
    let trace: StoryToolTraceRecorder | undefined;
    if (carrier && options.onStoryToolTrace) observeToolTrace(() => {
      const secret = secretFor(snapshot);
      const model = [secret, encodeURIComponent(secret)].some(value => snapshot.model.includes(value))
        ? '[已隐藏]' : snapshot.model;
      trace = StoryToolTraceRecorder.start(snapshot.channel.protocol, model, wire.url, options.stream === true, options.timeoutSeconds ?? 120);
    });
    let inspectionId: string | undefined;
    let observedUsage: Usage | undefined;
    let outputLimited = false;
    const finish = (reason: unknown) => {
      if (options.validateStoryOutputLimit && typeof reason === 'string' && ['length', 'max_tokens'].includes(reason.toLowerCase())) outputLimited = true;
      return checkFinish(reason, options.validateStoryOutputLimit === true);
    };
    const observe = (value: ResponseDiagnostics) => {
      try { options.onResponseDiagnostics?.(value); } catch { /* Observation never changes request semantics. */ }
    };
    try {
      const response = await operation(options, async (signal) => {
        if (signal.aborted) throw new AiError('cancelled');
        try { inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection); }
        catch { /* 只读诊断失败不能阻断真实发送。 */ }
        const protocol = snapshot.channel.protocol;
        let text = '', reasoning = '', usage: Usage | undefined;
        let streaming = false, terminal = false, nativeSeen = false;
        let think: LeadingThink | undefined;
        const events = readAiResponseEvents(
          () => this.response(wire.url, wire.init, signal, snapshot, options.onResponseDiagnostics ? observe : undefined, trace),
          protocol, options.stream === true, signal, Boolean(carrier), trace,
        );
        for await (const event of events) {
          if (event.type === 'error') throw event.error;
          if (event.type === 'aborted') throw new AiError('cancelled');
          if (event.type === 'opened') {
            streaming = event.source.transport === 'sse';
            think = !carrier && streaming && isOpenAiCompatible(protocol) ? new LeadingThink() : undefined;
            if (!signal.aborted) observe({ httpStatus: event.source.httpStatus, complete: false });
            continue;
          }
          if (event.type === 'end') {
            if (trace) observeToolTrace(() => trace?.boundary(event.boundary, event.source.sequence));
            carrier?.boundary(event);
            if (event.boundary === 'done-marker') terminal = true;
            continue;
          }
          if (event.type === 'tool-start' || event.type === 'tool-identity-delta' || event.type === 'tool-arguments' || event.type === 'tool-end') {
            if (!carrier) throw new AiError('unsupported');
            if (trace) observeToolTrace(() => trace?.tool(event));
            carrier.event(event);
            if (trace && event.type === 'tool-end') observeToolTrace(() => trace?.acceptedToolEnd());
            continue;
          }
          if (carrier) {
            if (!signal.aborted) observe({ ...event.diagnostics, httpStatus: event.source.httpStatus, complete: false });
            if (event.usage) usage = { ...usage, ...event.usage };
            observedUsage = usage;
            if (!signal.aborted) {
              options.onRawResponse?.(event.observation);
              if (event.rawText) options.onRawTextDelta?.(event.rawText);
              if (event.nativeReasoning) options.onNativeReasoningDelta?.(event.nativeReasoning);
            }
            if (event.providerError) throw new AiError('rejected');
            if (event.filtered || event.diagnostics.refusal) throw new AiError('content_filter');
            reasoning += event.nativeReasoning;
            if (reasoning.length > 2_000_000) throw new AiError('invalid_output');
            if (event.nativeReasoning && options.stream === true && !signal.aborted) {
              options.onActivity?.('reasoning'); options.onReasoningDelta?.(event.nativeReasoning);
            }
            carrier.response(event);
            continue;
          }
          if (!streaming) {
            if (!signal.aborted) observe({ ...event.diagnostics, httpStatus: event.source.httpStatus, complete: true });
            usage = event.usage; observedUsage = usage;
            if (!signal.aborted) {
              options.onRawResponse?.(event.observation);
              if (event.rawText) options.onRawTextDelta?.(event.rawText);
              if (event.nativeReasoning) options.onNativeReasoningDelta?.(event.nativeReasoning);
            }
            // Preserve legacy error precedence, including Story's limit handoff.
            if (options.validateStoryOutputLimit) finish(event.finishReason);
            if (options.validateStoryOutputLimit && event.diagnostics.refusal) throw new AiError('content_filter');
            if (event.providerError) throw new AiError('rejected');
            if (event.filtered) throw new AiError('content_filter');
            finish(event.finishReason);
            text = event.content;
            reasoning = event.nativeReasoning;
            if (isOpenAiCompatible(protocol)) {
              const split = splitLeadingThink(text);
              text = split.content;
              if (split.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(split.reasoning);
              if (!reasoning) reasoning = split.reasoning;
            }
            // A stream request answered by complete JSON uses the original callbacks.
            if (options.stream === true && !signal.aborted) {
              if (reasoning) { options.onActivity?.('reasoning'); options.onReasoningDelta?.(reasoning); }
              if (text) { options.onActivity?.('content'); options.onDelta?.(text); }
            }
            continue;
          }
          if (!signal.aborted) observe({ ...event.diagnostics, httpStatus: event.source.httpStatus, complete: false });
          if (event.providerError) throw new AiError('rejected');
          const native = event.nativeReasoning;
          if (!signal.aborted) {
            options.onRawResponse?.(event.observation);
            if (event.rawText) options.onRawTextDelta?.(event.rawText);
            if (native) options.onNativeReasoningDelta?.(native);
          }
          if (options.validateStoryOutputLimit && event.diagnostics.refusal) throw new AiError('content_filter');
          if (event.usage) usage = { ...usage, ...event.usage };
          observedUsage = usage;
          let delta: string, thinkReasoning = '';
          if (isOpenAiCompatible(protocol)) {
            if (finish(event.finishReason)) terminal = true;
            const split = think!.push(event.content);
            delta = split.content; thinkReasoning = split.reasoning;
          } else if (protocol === 'gemini') {
            if (event.filtered) throw new AiError('content_filter');
            if (finish(event.finishReason)) terminal = true;
            delta = event.content;
          } else {
            delta = event.content;
            finish(event.finishReason);
            if (event.messageStop) terminal = true;
          }
          if (native) nativeSeen = true;
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
        if (carrier) {
          if (trace) observeToolTrace(() => trace?.validatingCarrier());
          text = carrier.complete();
          if (isOpenAiCompatible(protocol)) {
            const split = splitLeadingThink(text); text = split.content;
            if (split.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(split.reasoning);
            if (!reasoning && split.reasoning) {
              reasoning = split.reasoning;
              if (options.stream === true && !signal.aborted) options.onReasoningDelta?.(reasoning);
            }
          }
          if (options.stream === true && text && !signal.aborted) { options.onActivity?.('content'); options.onDelta?.(text); }
          if (!signal.aborted) observe({ transport: streaming ? 'sse' : 'json', complete: true });
        }
        if (streaming && !carrier) {
          if (think) {
            const rest = think.end();
            if (rest.content) { text += rest.content; if (!signal.aborted) { options.onActivity?.('content'); options.onDelta?.(rest.content); } }
            if (rest.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(rest.reasoning);
            if (rest.reasoning && !nativeSeen) { reasoning += rest.reasoning; if (!signal.aborted) options.onReasoningDelta?.(rest.reasoning); }
          }
          if (!terminal) throw new AiError('stream_interrupted');
          if (!signal.aborted) observe({ transport: 'sse', complete: true });
        }
        if (text.length > 8_000_000 || reasoning.length > 2_000_000) throw new AiError('invalid_output');
        if (!text.trim()) throw new AiError('empty');
        try { if (inspectionId) requestInspections.finish(inspectionId, usage); }
        catch { /* 诊断观察器失败不改变响应。 */ }
        return { text, ...(outputLimited ? { outputLimited: true } : {}), ...(reasoning ? { nativeReasoning: reasoning } : {}), usage, diagnostics: wire.diagnostics, protocol, model: snapshot.model };
      }, trace);
      if (trace) observeToolTrace(() => options.onStoryToolTrace?.(trace!.seal({ code: 'received' })));
      return response;
    } catch (error) {
      if (trace) observeToolTrace(() => options.onStoryToolTrace?.(trace!.seal(error instanceof AiError
        ? { code: error.code, ...toolFailureMetadata(error) }
        : { code: 'unknown' })));
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
