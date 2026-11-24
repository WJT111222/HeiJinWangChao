import { fetchWithRelay, relayAttempt } from './corsRelay';
import { relayUpstreamHeader } from './relayTarget';
import { nativeFetch } from '../../presets/tavern/fetch';
import type { GenerationType } from '../../presets/tavern/events';
import { insertPlayerWorldbook, type PlayerWorldbook } from '../../prompts/playerWorldbook';
import { sendTavern } from '../../presets/tavern/backend';
import { safeMime } from '../../presets/tavern/responseFormat';
import { newTrace, type UpstreamTrace } from '../../presets/tavern/upstream';
import type { Sampling } from '../../presets/package';
import { AiError, manualRetryOnly, safeAiError } from './errors';
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
import { checkFinish, LeadingThink, rememberPresetSamplingRejection, rememberUnsupported, splitLeadingThink, unsupportedParameter } from './compat';
import { isOpenAiCompatible } from './configuration';
import { rawResponseObservation, responseContent, responseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';

export interface RequestOptions {
  storyClock?: import('../../presets/tavern/timing').StoryClock;
  presetSampling?: Sampling;
  tavernType?: GenerationType;
  /** Frozen reference records for checking the bundled script’s final tool declaration. */
  nativeDeliveryReference?: readonly AiMessage[];
  /** Internal Story-only handoff: caller must strictly validate received content. */
  validateStoryOutputLimit?: boolean;
  playerWorldbook?: PlayerWorldbook;
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
  /** Form completions are transient and are not turn or connection-test inspections. */
  recordInspection?: boolean;
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
  clock?: RequestOptions['storyClock'],
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
  const cancel = () => { clock?.userCancel(); controller.abort(); };
  if (clock) {
    clock.marks.timeoutSeconds = options.timeoutSeconds ?? 120;
    clock.first('budgetStartMs');
  }
  const timeout = setTimeout(
    () => {
      clock?.deadline();
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
export { manualRetryOnly } from './errors';
function residualTool(data: unknown, delta: boolean) {
  return array(record(data).choices).some(value => {
    const choice = record(value), message = record(delta ? choice.delta : choice.message);
    return array(message.tool_calls).length > 0 || message.function_call != null || choice.finish_reason === 'tool_calls';
  });
}
export class AiClient {
  constructor(private transport: typeof fetch = nativeFetch) {}
  private async response(
    url: string, init: RequestInit, signal: AbortSignal, relay: ReturnType<typeof relayAttempt>, snapshot?: RequestSnapshot,
    observe?: (value: ResponseDiagnostics) => void, presetSampling = false, trace?: UpstreamTrace,
  ) {
    trace?.clock.first('sentMs');
    const response = await fetchWithRelay(this.transport, url, {
      ...init,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }, relay);
    trace?.clock.first('headersMs');
    if (trace) { trace.status = response.status; trace.contentType = safeMime(response.headers); }
    const relayError = relay.used && response.headers.get('X-Heijin-Relay-Error') === '1';
    const relayUnavailable = relay.used && !relayError && response.headers.get(relayUpstreamHeader) !== '1';
    if (!response.ok || relayUnavailable) {
      const status = response.status;
      // Only inspect JSON generation errors; list discovery handles its own status codes.
      if (!signal.aborted) observe?.({ transport: 'http', httpStatus: status, complete: false });
      if (relayUnavailable) {
        void response.body?.cancel().catch(() => {});
        throw new AiError('network', status, { fieldPath: 'channel.relay_unavailable' });
      }
      if (relayError)
        throw new AiError(status >= 500 ? 'server' : 'rejected', status, { fieldPath: 'channel.relay' });
      if (snapshot && (snapshot.thinkingCapability !== 'none' || snapshot.channel.protocol === 'openai' || presetSampling) && ([400, 422].includes(status) || (status === 404 && snapshot.channel.protocol === 'openai'))
        && response.headers.get('content-type')?.includes('application/json')) {
        try {
          const error: unknown = await response.json();
          if (!signal.aborted) observe?.({ ...responseDiagnostics(error, snapshot.channel.protocol), transport: 'http', httpStatus: status, complete: true });
          const provider = record(record(error).error);
          if (snapshot.channel.protocol === 'openai' && typeof provider.code === 'string' && ['model_not_found', 'InvalidEndpointOrModel.NotFound', 'ModelNotFound'].includes(provider.code))
            throw new AiError('not_found', status, {fieldPath:'channel.model'});
          if (status === 404) throw new AiError('not_found', status);
          if (!signal.aborted && snapshot.thinkingCapability !== 'none' && unsupportedThinkingParameter(error)) blockThinkingCapability(snapshot.channel, snapshot.model);
          const sentBody = record(typeof init.body === 'string' ? JSON.parse(init.body) : undefined);
          if (!signal.aborted && presetSampling && rememberPresetSamplingRejection(snapshot.channel, url, snapshot.model, error, sentBody))
            throw new AiError('parameter_adjusted', status);
          const parameter = snapshot.channel.protocol === 'openai' ? unsupportedParameter(error, {
            maxTokens: Object.hasOwn(sentBody, 'max_tokens'),
            temperature: !presetSampling && Object.hasOwn(sentBody, 'temperature'),
          }) : undefined;
          if (!signal.aborted && parameter) {
            rememberUnsupported(snapshot.channel, snapshot.model, parameter);
            throw new AiError('parameter_adjusted', status);
          }
          if (provider.code === 'unsupported_parameter' && typeof provider.param === 'string' && Object.hasOwn(sentBody, provider.param))
            throw new AiError('rejected', status, {fieldPath:'channel.parameter'});
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
    const relay = relayAttempt(snapshot.channel.protocol);
    const compat = snapshot.stage === 'story' && options.tavernType !== undefined;
    const trace = compat ? newTrace(options.storyClock) : undefined;
    const cleanup = compat ? new AbortController() : undefined;
    let diagnostics: string[] = [];
    let inspectionId: string | undefined;
    let observedUsage: Usage | undefined;
    let outputLimited = false, unhandledTool = false;
    const finish = (reason: unknown) => {
      if (options.validateStoryOutputLimit && typeof reason === 'string' && ['length', 'max_tokens'].includes(reason.toLowerCase())) outputLimited = true;
      if (trace && reason === 'tool_calls') return true;
      return checkFinish(reason, options.validateStoryOutputLimit === true);
    };
    const observe = (value: ResponseDiagnostics) => {
      try { options.onResponseDiagnostics?.(value); } catch { /* Observation never changes request semantics. */ }
    };
    try {
      return await operation(options, async (signal) => {
        if (signal.aborted) throw new AiError('cancelled');
        const send = (wire: ReturnType<typeof wireRequest>, requestSignal: AbortSignal) => {
          diagnostics = wire.diagnostics;
          try { if (options.recordInspection !== false) inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection, wire.presetSamplingInspection); }
          catch { /* Inspection cannot affect transport. */ }
          return this.response(wire.url, wire.init, requestSignal, relay, snapshot, options.onResponseDiagnostics ? observe : undefined,
            wire.presetSamplingInspection !== undefined, trace);
        };
        const playerWorldbook = snapshot.stage === 'story' ? options.playerWorldbook : undefined;
        const response = trace && cleanup && options.tavernType
          ? await sendTavern(snapshot, options.tavernType, [...messages], options.nativeDeliveryReference !== undefined ? undefined : options.presetSampling ?? {}, options.stream === true,
            AbortSignal.any([signal, cleanup.signal]), trace, send, options.nativeDeliveryReference, playerWorldbook)
          : await send(wireRequest(snapshot, insertPlayerWorldbook(messages, playerWorldbook), options.stream === true, options.presetSampling), signal);
        const protocol = trace ? 'openai' : snapshot.channel.protocol;
        if (!signal.aborted) observe({ httpStatus: response.status, complete: false });
        let text = '', reasoning = '',
          usage: Usage | undefined;
        // 部分中转忽略 stream:true 直接返回完整 JSON；按非流式读取，再一次性交给进度回调。
        const wholeJson = options.stream === true && /application\/json/i.test(response.headers.get('content-type') ?? '');
        const streaming = trace ? safeMime(response.headers) === 'text/event-stream' : options.stream && !wholeJson;
        if (!streaming) {
          let data: unknown;
          try {
            data = await response.json();
            if (trace) trace.wrapperBodyRead = true;
          } catch {
            throw new AiError('invalid_json');
          }
          if (!signal.aborted) observe({ ...responseDiagnostics(data, protocol), httpStatus: response.status, complete: true });
          if (trace && residualTool(data, false)) throw new AiError('invalid_output', undefined, { fieldPath: 'tavern.unhandled_tool' });
          usage = usageFrom(data, protocol); observedUsage = usage;
          if (!signal.aborted) {
            if (options.onRawResponse) options.onRawResponse(rawResponseObservation(data, protocol));
            const raw = responseContent(data, protocol), native = nativeReasoning(data, protocol);
            if (raw) options.onRawTextDelta?.(raw);
            if (native) options.onNativeReasoningDelta?.(native);
          }
          if (options.validateStoryOutputLimit) {
            const d = record(data);
            finish(isOpenAiCompatible(protocol) ? record(array(d.choices)[0]).finish_reason : protocol === 'gemini' ? record(array(d.candidates)[0]).finishReason : d.stop_reason);
          }
          if (options.validateStoryOutputLimit && responseDiagnostics(data, protocol).refusal) throw new AiError('content_filter');
          text = responseText(data, protocol, options.validateStoryOutputLimit === true);
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
          for await (const event of readSse(response.body, signal, trace ? { detachCleanup: true } : undefined)) {
            if (event.event === 'error') throw new AiError('rejected');
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
            if (!signal.aborted) observe({ ...responseDiagnostics(data, protocol, true), httpStatus: response.status, complete: false });
            if (data.error || data.type === 'error')
              throw new AiError('rejected');
            if (trace && residualTool(data, true)) unhandledTool = true;
            const rawDelta = responseContent(data, protocol, true), native = nativeReasoning(data, protocol, true);
            if (!signal.aborted) {
              if (options.onRawResponse) options.onRawResponse(rawResponseObservation(data, protocol, true));
              if (rawDelta) options.onRawTextDelta?.(rawDelta);
              if (native) options.onNativeReasoningDelta?.(native);
            }
            if (options.validateStoryOutputLimit && responseDiagnostics(data, protocol, true).refusal) throw new AiError('content_filter');
            const nextUsage = usageFrom(data, protocol);
            if (nextUsage) usage = { ...usage, ...nextUsage };
            observedUsage = usage;
            let delta = '';
            let thinkReasoning = '';
            if (isOpenAiCompatible(protocol)) {
              const choice = record(array(data.choices)[0]);
              if (finish(choice.finish_reason)) terminal = true;
              const split = think!.push(string(record(choice.delta).content));
              delta = split.content; thinkReasoning = split.reasoning;
            } else if (protocol === 'gemini') {
              if (record(data.promptFeedback).blockReason) throw new AiError('content_filter');
              const candidate = record(array(data.candidates)[0]);
              if (finish(candidate.finishReason)) terminal = true;
              delta = array(record(candidate.content).parts)
                .filter((part) => record(part).thought !== true)
                .map((part) => string(record(part).text))
                .join('');
            } else {
              if (data.type === 'content_block_start' && record(data.content_block).type === 'text')
                delta = string(record(data.content_block).text);
              if (data.type === 'content_block_delta' && record(data.delta).type === 'text_delta')
                delta = string(record(data.delta).text);
              finish(record(data.delta).stop_reason);
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
          if (trace) trace.wrapperBodyRead = true;
          if (!terminal) throw new AiError('stream_interrupted', undefined, trace ? { fieldPath: 'tavern.wrapper.missing_finish' } : undefined);
          if (!signal.aborted) observe({ transport: 'sse', complete: true });
        }
        if (text.length > 8_000_000 || reasoning.length > 2_000_000) throw new AiError('invalid_output');
        if (trace) {
          if (trace.error) throw trace.error;
          if (!trace.complete || trace.calls !== 1) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.incomplete' });
          if (unhandledTool) throw new AiError('invalid_output', undefined, { fieldPath: 'tavern.unhandled_tool' });
          usage = trace.usage;
          outputLimited ||= ['length', 'max_tokens'].includes(trace.finish?.toLowerCase() ?? '');
          if (options.nativeDeliveryReference !== undefined && !trace.matchesDelivery?.(text))
            throw new AiError(outputLimited ? 'output_limit' : 'unsupported', undefined,
              outputLimited ? undefined : { fieldPath: 'tavern.native_delivery.response' });
        }
        if (!text.trim()) throw new AiError('empty');
        if (trace) {
          trace.restored = true;
          trace.clock.first('restoredMs');
        }
        try { if (inspectionId) requestInspections.finish(inspectionId, usage); }
        catch { /* 诊断观察器失败不改变响应。 */ }
        return { text, ...(outputLimited ? { outputLimited: true } : {}), ...(reasoning ? { nativeReasoning: reasoning } : {}), usage, diagnostics, protocol: snapshot.channel.protocol, model: snapshot.model };
      }, trace?.clock);
    } catch (error) {
      const failure = options.signal?.aborted || (error instanceof AiError && error.code === 'timeout') ? error : trace?.error ?? error;
      if (relay.eligible && failure instanceof AiError) manualRetryOnly.add(failure);
      if (trace && failure instanceof AiError) {
        manualRetryOnly.add(failure);
        trace.cancelled = failure.code === 'cancelled' || failure.code === 'timeout';
      }
      try { if (inspectionId) requestInspections.finish(inspectionId, trace ? trace.usage : observedUsage, safeAiError(failure).code); }
      catch { /* 保留原始失败语义。 */ }
      throw failure;
    } finally {
      trace?.clock.first('clientEndMs');
      if (trace) observe({ tavern: { timeline: { ...trace.clock.marks }, calls: trace.calls, bytes: trace.bytes, complete: trace.complete,
        upstreamStatus: trace.status, upstreamFinish: trace.finish, upstreamUsage: trace.usage, upstreamError: trace.error?.code,
        requestedStream: trace.requestedStream, contentType: trace.contentType, formatEvidence: trace.formatEvidence,
        cancelled: trace.cancelled === true, readerEof: trace.readerEof === true, readError: trace.readError === true, rawFinish: trace.rawFinish,
        wrapperFormat: trace.wrapperFormat, wrapperBodyRead: trace.wrapperBodyRead === true, restored: trace.restored === true,
        boundary: trace.boundary, normalized: trace.normalized, wrapper: trace.wrapper } });
      cleanup?.abort();
    }
  }
  async listModels(snapshot: RequestSnapshot, options: ModelListOptions = {}): Promise<string[]> {
    const relay = relayAttempt(snapshot.channel.protocol);
    let lastEndpoint: string | undefined, lastHttpStatus: number | undefined, attempts = 0, pagesRead = 0;
    try { return await operation(options, async (signal) => {
      const candidates = modelListCandidates(snapshot), protocol = snapshot.channel.protocol;
      async function read(client: AiClient, url: string, candidate = false) {
        if (signal.aborted) throw new AiError('cancelled');
        const headers = authHeaders(snapshot);
        lastEndpoint = url; lastHttpStatus = undefined;
        if (candidate) attempts++;
        let response: Response;
        try { response = await client.response(url, { headers }, signal, relay); }
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
          if (signal.aborted || relay.used || !canTryModelCandidate(error)) throw error;
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
