import type { LiterarySession } from '../../presets/spreset/literarySession';
import { fetchWithRelay, relayAttempt, relayMode, type ConfirmedTransmission } from './corsRelay';
import { relayUpstreamHeader } from './relayTarget';
import { nativeFetch } from '../../presets/tavern/fetch';
import type { GenerationType } from '../../presets/tavern/events';
import { insertPlayerWorldbook, type PlayerWorldbook } from '../../prompts/playerWorldbook';
import { sendTavern } from '../../presets/tavern/backend';
import { readStoryJson, safeMime } from '../../presets/tavern/responseFormat';
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
import { preparationSeconds } from './storyPreparation';
import { StoryClock, type TimeoutKind } from '../../presets/tavern/timing';
import { FINISH_TAIL_MS, readSse } from './sse';
import { rememberThinkingCapability, unsupportedThinkingParameter, blockThinkingCapability } from './thinking';
import { checkFinish, normalTextFinish, LeadingThink, rememberPresetSamplingRejection, rememberUnsupported, splitLeadingThink, unsupportedParameter } from './compat';
import { isOpenAiCompatible } from './configuration';
import type { Protocol } from './configuration';
import { rawResponseObservation, responseContent, responseDiagnostics, mergeResponseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';
import { attachFailureDiagnostic, attachObservedRequest, carryFailureDiagnostic, classifyUpstreamPayload, diagnosticSecrets, failurePhase, readFailureDiagnostic } from './failureDiagnostic';

export interface RequestOptions {
  /** One-use dispatch gate for an explicitly confirmed, uncredited Story fragment. */
  confirmedTransmission?: ConfirmedTransmission;
  storyClock?: import('../../presets/tavern/timing').StoryClock;
  presetSampling?: Sampling;
  spresetPrototype?: boolean;
  tavernType?: GenerationType;
  /** Frozen reference records for checking the bundled script’s final tool declaration. */
  nativeDeliveryReference?: readonly AiMessage[];
  storyDeliveryTool?: string;
  /** Internal Story-only handoff: caller must strictly validate received content. */
  validateStoryOutputLimit?: boolean;
  playerWorldbook?: PlayerWorldbook;
  onResponseDiagnostics?: (diagnostics: ResponseDiagnostics) => void;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  streamTimeouts?: { idle: number; total: number };
  /** Only the audited built-in host can replay an original upstream transport failure. */
  retryableTavernHost?: boolean;
  stream?: boolean;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  /** Read-only observations before compatibility extraction; not a second request. */
  onRawTextDelta?: (text: string) => void;
  onNativeReasoningDelta?: (text: string) => void;
  /** Ephemeral Story reader. Only onDelta receives the final processor delivery. */
  onLiteraryPreview?: (delta: string) => void;
  /** Lazily snapshot partial arguments for the diagnostic viewer. Clear after successful verification. */
  onUnverifiedTool?: (read?: () => string) => void;
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
  clock?: StoryClock,
  limits?: RequestOptions['streamTimeouts'],
): Promise<T> {
  if (options.signal?.aborted) throw new AiError('cancelled');
  if (
    !Number.isFinite(options.timeoutSeconds ?? 120) ||
    (options.timeoutSeconds ?? 120) <= 0 ||
    (options.timeoutSeconds ?? 120) > 3600
  )
    throw new AiError('configuration');
  if (limits && (!Number.isFinite(limits.idle) || !Number.isFinite(limits.total) ||
      limits.idle <= 0 || limits.total < limits.idle || limits.total > 7200)) throw new AiError('configuration');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => { clock?.userCancel(); controller.abort(); };
  if (clock) {
    clock.marks.timeoutSeconds = options.timeoutSeconds ?? 120;
    clock.first('budgetStartMs');
  }
  const expire = (kind: TimeoutKind) => {
    if (controller.signal.aborted) return;
    clock?.deadline();
    if (clock) clock.marks.timeoutKind = kind;
    timedOut = true;
    controller.abort();
  };
  const totalMs = (limits?.total ?? options.timeoutSeconds ?? 120) * 1000;
  const elapsed = limits && clock ? clock.elapsed() - (clock.marks.preparationStartMs ?? clock.marks.budgetStartMs ?? clock.elapsed()) : 0;
  const timeout = setTimeout(() => expire('total'), Math.max(0, totalMs - elapsed));
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  if (limits && clock) {
    clock.marks.idleTimeoutSeconds = limits.idle;
    clock.marks.totalTimeoutSeconds = limits.total;
    clock.onProgress = () => {
      clearTimeout(idleTimer);
      const wait = clock.idleKind() === 'preparation' ? preparationSeconds(options.timeoutSeconds ?? 120) : limits.idle;
      idleTimer = setTimeout(() => expire(clock.idleKind()), wait * 1000);
    };
    clock.onProgress();
  }
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
    clearTimeout(idleTimer);
    if (clock) clock.onProgress = undefined;
    options.signal?.removeEventListener('abort', cancel);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
/** Non-streaming Memory never saves from this observer. Only extract public provider fields. */
async function observeMemorySse(response: Response, protocol: RequestSnapshot['channel']['protocol'], signal: AbortSignal,
  options: RequestOptions): Promise<ResponseDiagnostics | undefined> {
  let complete = false;
  try {
    const body = response.clone().body;
    if (!body) return;
    for await (const event of readSse(body, signal)) {
      if (event.event === 'error') throw rejectedUpstream(ssePayload(event.data), 'sse', response.status, true);
      if (event.data === '[DONE]' && isOpenAiCompatible(protocol)) { complete = true; break; }
      let data: Record<string, unknown>;
      try { data = record(JSON.parse(event.data)); } catch { throw new AiError('invalid_json'); }
      if (data.error || data.type === 'error') throw rejectedUpstream(data, 'sse', response.status);
      if (!signal.aborted) {
        const raw = responseContent(data, protocol, true), native = nativeReasoning(data, protocol, true);
        if (raw) options.onRawTextDelta?.(raw);
        if (native) options.onNativeReasoningDelta?.(native);
      }
      if (isOpenAiCompatible(protocol)) complete = checkFinish(record(array(data.choices)[0]).finish_reason) === true || complete;
      else if (protocol === 'gemini') complete = checkFinish(record(array(data.candidates)[0]).finishReason) === true || complete;
      else {
        checkFinish(record(data.delta).stop_reason);
        complete ||= data.type === 'message_stop';
      }
    }
    return { transport: 'sse', complete, memorySseFailure: complete ? 'unexpected_transport' : 'stream_interrupted' };
  } catch (error) {
    carryFailureDiagnostic(error, response);
    return { transport: 'sse', complete: false, memorySseFailure: error instanceof AiError ? error.code : 'unknown' };
  }
}

function rejectedUpstream(payload: unknown, transport: 'json' | 'sse', httpStatus?: number, errorEvent = false) {
  const failure = new AiError('rejected');
  attachFailureDiagnostic(failure, classifyUpstreamPayload(payload, { transport, httpStatus, errorEvent }));
  return failure;
}
function ssePayload(data: string) {
  try { return JSON.parse(data) as unknown; } catch { return undefined; }
}
export { manualRetryOnly } from './errors';
const quotaCodes = new Set([
  'insufficient_quota', 'insufficient_quota_error', 'billing_hard_limit_reached',
  'exceeded_current_quota_error', 'insufficient_balance', 'arrearage',
]);
function parseRetryAfter(header: string | null, now = Date.now()) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : undefined;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  return Number.isFinite(delta) ? Math.max(0, delta) : undefined;
}
function quotaExhausted(body: unknown) {
  const root = record(body), nested = record(root.error);
  return [root.code, root.type, nested.code, nested.type].some((code) => typeof code === 'string' && quotaCodes.has(code.toLowerCase()));
}
function residualTool(data: unknown, delta: boolean) {
  return array(record(data).choices).some(value => {
    const choice = record(value), message = record(delta ? choice.delta : choice.message);
    return array(message.tool_calls).length > 0 || message.function_call != null || choice.finish_reason === 'tool_calls';
  });
}
function theaterResidualTool(data: unknown, protocol: Protocol, delta: boolean) {
  if (isOpenAiCompatible(protocol)) return residualTool(data, delta);
  const root = record(data);
  if (protocol === 'gemini') return array(root.candidates).some(candidate =>
    array(record(record(candidate).content).parts).some(part => record(part).functionCall != null));
  if (delta) return record(root.content_block).type === 'tool_use' || record(root.delta).type === 'input_json_delta'
    || record(root.delta).stop_reason === 'tool_use';
  return root.stop_reason === 'tool_use' || array(root.content).some(block => record(block).type === 'tool_use');
}
export class AiClient {
  constructor(private transport: typeof fetch = nativeFetch) {}
  private async response(
    url: string, init: RequestInit, signal: AbortSignal, relay: ReturnType<typeof relayAttempt>, snapshot?: RequestSnapshot,
    observe?: (value: ResponseDiagnostics) => void, presetSampling = false, trace?: UpstreamTrace, confirmed?: ConfirmedTransmission, clock = trace?.clock,
  ) {
    const markSent = () => {
      if (trace) { trace.calls++; trace.clock.first('sentMs'); }
    };
    if (!confirmed) markSent();
    const transport: typeof fetch = confirmed ? (target, request) => {
      markSent();
      return this.transport(target, request);
    } : this.transport;
    const response = await fetchWithRelay(transport, url, {
      ...init,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }, relay, confirmed && { transmission: confirmed, signal });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new AiError('cancelled');
    }
    clock?.first('headersMs');
    if (trace) { trace.status = response.status; trace.contentType = safeMime(response.headers); }
    const relayError = relay.used && response.headers.get('X-Heijin-Relay-Error') === '1';
    const relayUnavailable = relay.used && !relayError && response.headers.get(relayUpstreamHeader) !== '1';
    if (!response.ok || relayUnavailable) {
      const status = response.status;
      // Only inspect JSON generation errors; list discovery handles its own status codes.
      if (!signal.aborted) observe?.({ transport: 'http', httpStatus: status, complete: false });
      if (relayUnavailable) {
        void response.body?.cancel().catch(() => {});
        const failure = new AiError('network', status, { fieldPath: 'channel.relay_unavailable' });
        attachFailureDiagnostic(failure, { phase: 'upstream_connect', ...(status >= 100 && status <= 599 ? { httpStatus: status, httpError: status < 200 || status >= 300 } : {}) });
        throw failure;
      }
      if (relayError) {
        const failure = new AiError(status >= 500 ? 'server' : 'rejected', status, { fieldPath: 'channel.relay' });
        attachFailureDiagnostic(failure, { phase: 'upstream_connect', ...(status >= 100 && status <= 599 ? { httpStatus: status, httpError: status < 200 || status >= 300 } : {}) });
        throw failure;
      }
      let parsedProvider: unknown;
      if (snapshot && (snapshot.thinkingCapability !== 'none' || snapshot.channel.protocol === 'openai' || presetSampling) && ([400, 422].includes(status) || (status === 404 && snapshot.channel.protocol === 'openai'))
        && response.headers.get('content-type')?.includes('application/json')) {
        try {
          const error: unknown = await response.json();
          parsedProvider = error;
          if (!signal.aborted) observe?.({ ...responseDiagnostics(error, snapshot.channel.protocol), transport: 'http', httpStatus: status, complete: true });
          const provider = record(record(error).error);
          const note = (failure: AiError): never => {
            attachFailureDiagnostic(failure, classifyUpstreamPayload(error, { transport: 'json', httpStatus: status }));
            throw failure;
          };
          if (snapshot.channel.protocol === 'openai' && typeof provider.code === 'string' && ['model_not_found', 'InvalidEndpointOrModel.NotFound', 'ModelNotFound'].includes(provider.code))
            note(new AiError('not_found', status, {fieldPath:'channel.model'}));
          if (status === 404) note(new AiError('not_found', status));
          if (!signal.aborted && snapshot.thinkingCapability !== 'none' && unsupportedThinkingParameter(error)) blockThinkingCapability(snapshot.channel, snapshot.model);
          const sentBody = record(typeof init.body === 'string' ? JSON.parse(init.body) : undefined);
          if (!signal.aborted && presetSampling && rememberPresetSamplingRejection(snapshot.channel, url, snapshot.model, error, sentBody))
            note(new AiError('parameter_adjusted', status));
          const parameter = snapshot.channel.protocol === 'openai' ? unsupportedParameter(error, {
            maxTokens: Object.hasOwn(sentBody, 'max_tokens'),
            temperature: !presetSampling && Object.hasOwn(sentBody, 'temperature'),
          }) : undefined;
          if (!signal.aborted && parameter) {
            rememberUnsupported(snapshot.channel, snapshot.model, parameter);
            note(new AiError('parameter_adjusted', status));
          }
          if (provider.code === 'unsupported_parameter' && typeof provider.param === 'string' && Object.hasOwn(sentBody, provider.param))
            note(new AiError('rejected', status, {fieldPath:'channel.parameter'}));
        } catch (error) { if (error instanceof AiError) throw error; /* 错误正文不外传，不猜测兼容能力，也不重发当前请求。 */ }
      }
      const retryAfterMs = status === 429 || status >= 500 ? parseRetryAfter(response.headers.get('retry-after')) : undefined;
      let quotaBody: unknown;
      const quota = parsedProvider === undefined && status === 429 && response.headers.get('content-type')?.toLowerCase().includes('json')
        ? await response.json().then((body) => { quotaBody = body; return quotaExhausted(body); }, () => false)
        : false;
      const failureDetails = {
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        ...(quota ? { quota: true as const } : {}),
      };
      const failure = new AiError(
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
        Object.keys(failureDetails).length ? failureDetails : undefined,
      );
      const body = quotaBody ?? parsedProvider;
      if (body !== undefined) attachFailureDiagnostic(failure, classifyUpstreamPayload(body, { transport: 'http', httpStatus: status }));
      else if (status >= 100 && status <= 599) attachFailureDiagnostic(failure, { httpStatus: status, httpError: true });
      throw failure;
    }
    return response;
  }
  async generate(
    snapshot: RequestSnapshot,
    messages: readonly AiMessage[],
    options: RequestOptions = {},
  ): Promise<AiResponse> {
    const theater = snapshot.stage === 'theater' || snapshot.stage === 'imagePrompt';
    const prototype = import.meta.env.DEV && options.spresetPrototype && snapshot.stage === 'story';
    let session: LiterarySession | undefined;
    // Theater keeps a single paid transport. A failed direct POST is not replayed through a relay.
    const relay = theater || snapshot.stage === 'phone' || (prototype && !options.confirmedTransmission) ? { origin: undefined, eligible: false, used: false } : relayAttempt(snapshot.channel.protocol);
    const allowOutputLimit = options.validateStoryOutputLimit === true || theater;
    const relayEnabled = relayMode() === 'auto';
    const started = performance.now();
    const compat = snapshot.stage === 'story' && options.tavernType !== undefined;
    // 原型会话自行读取上游，不向本次时钟报告进度；沿用单一总时限，避免被无输出时限误判。
    const limits = snapshot.stage === 'story' && options.stream && !prototype ? options.streamTimeouts : undefined;
    const clock = options.storyClock ?? (compat || limits ? new StoryClock() : undefined);
    const trace = compat ? newTrace(clock) : undefined;
    let terminalEvidence: UpstreamTrace['boundary'];
    let readerEof = false, readError = false;
    const observeLifecycle = (target: unknown) => {
      if (!limits || !clock) return;
      const m = clock.marks;
      attachFailureDiagnostic(target, {
        timeoutKind: m.timeoutKind, idleTimeoutSeconds: limits.idle, totalTimeoutSeconds: limits.total,
        firstByteMs: m.firstByteMs, firstContentMs: m.firstContentMs, firstReasoningMs: m.firstReasoningMs,
        firstArgumentsMs: m.firstArgumentsMs, lastProgressMs: m.lastProgressMs,
        readerEof: trace?.readerEof ?? readerEof, readError: trace?.readError ?? readError,
        terminalEvidence: trace ? (trace.complete ? trace.boundary : undefined) : terminalEvidence,
        wrapperComplete: trace ? trace.restored === true : undefined,
      });
    };
    const cleanup = compat ? new AbortController() : undefined;
    let diagnostics: string[] = [];
    let inspectionId: string | undefined;
    let observedUsage: Usage | undefined;
    let outputLimited = false, unhandledTool = false, missingTheaterFinish = false;
    let lastHttp: number | undefined;
    let seen: ResponseDiagnostics = {};
    const finish = (reason: unknown) => {
      if (allowOutputLimit && typeof reason === 'string' && ['length', 'max_tokens'].includes(reason.toLowerCase())) outputLimited = true;
      if (trace && reason === 'tool_calls') return true;
      return checkFinish(reason, allowOutputLimit);
    };
    const observe = (value: ResponseDiagnostics) => {
      seen = mergeResponseDiagnostics(seen, value);
      if (!options.onResponseDiagnostics) return;
      try { options.onResponseDiagnostics(value); } catch { /* Observation never changes request semantics. */ }
    };
    try {
      return await operation(options, async (signal) => {
        if (signal.aborted) throw new AiError('cancelled');
        const send = (wire: ReturnType<typeof wireRequest>, requestSignal: AbortSignal) => {
          diagnostics = wire.diagnostics;
          try { if (options.recordInspection !== false) inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection, wire.presetSamplingInspection); }
          catch { /* Inspection cannot affect transport. */ }
          // 酒馆路径在真正发出时由 response() 记录；确认续写的请求也要等到实际发送。
          if (!trace) clock?.first('sentMs');
          return this.response(wire.url, wire.init, requestSignal, relay, snapshot, observe,
            wire.presetSamplingInspection !== undefined, trace, options.confirmedTransmission, clock);
        };
        const playerWorldbook = snapshot.stage === 'story' ? options.playerWorldbook : undefined;
        if (import.meta.env.DEV && prototype) {
          const { PrototypeSession } = await import('../../presets/spreset/session');
          session = new PrototypeSession(signal);
        }
        const response = session ? await send(await session.wire(snapshot, messages, options.stream === true, playerWorldbook), signal)
          : trace && cleanup && options.tavernType
          ? await sendTavern(snapshot, options.tavernType, [...messages], options.nativeDeliveryReference !== undefined ? undefined : options.presetSampling ?? {}, options.stream === true,
            AbortSignal.any([signal, cleanup.signal]), trace, send, options.nativeDeliveryReference, playerWorldbook, options.storyDeliveryTool, options.retryableTavernHost)
          : await send(wireRequest(snapshot, insertPlayerWorldbook(messages, playerWorldbook), options.stream === true, options.presetSampling), signal);
        const protocol = trace ? 'openai' : snapshot.channel.protocol;
        clock?.first('headersMs');
        lastHttp = response.status;
        if (!signal.aborted) observe({ httpStatus: response.status, complete: false });
        let text = '', reasoning = '',
          usage: Usage | undefined;
        // 部分中转忽略 stream:true 直接返回完整 JSON；按非流式读取，再一次性交给进度回调。
        const wholeJson = options.stream === true && /application\/json/i.test(response.headers.get('content-type') ?? '');
        const streaming = trace ? safeMime(response.headers) === 'text/event-stream' : options.stream && !wholeJson;
        if (session) {
          const delivered = await session.read(response, snapshot, options);
          text = delivered.text;
          reasoning = delivered.reasoning;
          observedUsage = usage = delivered.usage;
          signal.throwIfAborted();
          if (reasoning) options.onReasoningDelta?.(reasoning);
          options.onDelta?.(text);
          observe({ transport: delivered.transport, complete: true, finishReasons: [delivered.finish] });
        } else if (!streaming) {
          // Inspect an unsolicited SSE copy without accepting it as a summary or
          // changing the ordinary JSON path (including mislabeled valid JSON).
          const observedSse = snapshot.stage === 'memory' && options.onResponseDiagnostics && safeMime(response.headers) === 'text/event-stream'
            ? observeMemorySse(response, protocol, signal, options) : undefined;
          let data: unknown;
          try {
            data = snapshot.stage === 'story' ? await readStoryJson(response, signal) : await response.json();
            if (trace) trace.wrapperBodyRead = true;
          } catch {
            const diagnostic = await observedSse;
            if (diagnostic && !signal.aborted) observe(diagnostic);
            const failure = new AiError('invalid_json');
            carryFailureDiagnostic(response, failure);
            throw failure;
          }
          if (!signal.aborted) observe({ ...responseDiagnostics(data, protocol), httpStatus: response.status, complete: true });
          if (theater && responseDiagnostics(data, protocol).errorPresent) throw rejectedUpstream(record(data), 'json', response.status);
          if (theater && theaterResidualTool(data, protocol, false)) throw new AiError('invalid_output');
          if (trace && residualTool(data, false)) throw new AiError('invalid_output', undefined, { fieldPath: 'tavern.unhandled_tool' });
          usage = usageFrom(data, protocol); observedUsage = usage;
          if (!signal.aborted) {
            if (options.onRawResponse) options.onRawResponse(rawResponseObservation(data, protocol));
            const raw = responseContent(data, protocol), native = nativeReasoning(data, protocol);
            if (raw) options.onRawTextDelta?.(raw);
            if (native) options.onNativeReasoningDelta?.(native);
          }
          if (allowOutputLimit) {
            const d = record(data);
            const terminal = finish(isOpenAiCompatible(protocol) ? record(array(d.choices)[0]).finish_reason : protocol === 'gemini' ? record(array(d.candidates)[0]).finishReason : d.stop_reason);
            missingTheaterFinish = theater && !terminal;
          }
          if (allowOutputLimit && responseDiagnostics(data, protocol).refusal) {
            const failure = new AiError('content_filter');
            attachFailureDiagnostic(failure, { phase: 'upstream_error', upstreamClass: 'content_filter' });
            throw failure;
          }
          text = responseText(data, protocol, allowOutputLimit);
          reasoning = nativeReasoning(data, protocol);
          if (isOpenAiCompatible(protocol)) {
            const split = splitLeadingThink(text);
            text = split.content;
            if (split.reasoning && !signal.aborted) options.onCompatibilityReasoningDelta?.(split.reasoning);
            if (!reasoning) reasoning = split.reasoning;
          }
          if ((wholeJson || theater) && !signal.aborted) {
            if (reasoning) { options.onActivity?.('reasoning'); options.onReasoningDelta?.(reasoning); }
            if (text) { options.onActivity?.('content'); options.onDelta?.(text); }
          }
        } else {
          // Content-Type 不可靠（有的中转写成 text/plain），只要有响应体就按 SSE 解析；是否完整由结束标记判断。
          if (!response.body) throw new AiError('stream_interrupted');
          let terminal = false, nativeSeen = false;
          const think = isOpenAiCompatible(protocol) ? new LeadingThink() : undefined;
          let tailDeadline: number | undefined;
          let providerEnd: unknown;
          const original = !trace && snapshot.stage === 'story';
          for await (const event of readSse(response.body, signal, original ? {
            tailDeadline: () => tailDeadline,
            onTail: () => { terminalEvidence = 'finish_reason'; },
            onBytes: () => clock?.bytes(),
            onEof: () => { readerEof = true; if (terminal) terminalEvidence = 'eof'; },
            onReadError: () => { readError = true; },
          } : undefined)) {
            if (event.event === 'error') throw rejectedUpstream(ssePayload(event.data), 'sse', response.status, true);
            if (event.data === '[DONE]' && isOpenAiCompatible(protocol)) {
              terminal = true;
              if (original) terminalEvidence = 'done';
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
              throw rejectedUpstream(data, 'sse', response.status);
            if (theater && theaterResidualTool(data, protocol, true)) throw new AiError('invalid_output');
            if (trace && residualTool(data, true)) unhandledTool = true;
            const rawDelta = responseContent(data, protocol, true), native = nativeReasoning(data, protocol, true);
            if (!signal.aborted) {
              if (options.onRawResponse) options.onRawResponse(rawResponseObservation(data, protocol, true));
              if (rawDelta) options.onRawTextDelta?.(rawDelta);
              if (native) options.onNativeReasoningDelta?.(native);
            }
            if (allowOutputLimit && responseDiagnostics(data, protocol, true).refusal) {
              const failure = new AiError('content_filter');
              attachFailureDiagnostic(failure, { phase: 'upstream_error', upstreamClass: 'content_filter' });
              throw failure;
            }
            const nextUsage = usageFrom(data, protocol);
            if (nextUsage) usage = { ...usage, ...nextUsage };
            observedUsage = usage;
            let delta = '';
            let thinkReasoning = '';
            if (isOpenAiCompatible(protocol)) {
              const choice = record(array(data.choices)[0]);
              if (original && providerEnd && (rawDelta || native || residualTool(data, true) ||
                  (choice.finish_reason && choice.finish_reason !== providerEnd))) throw new AiError('invalid_output');
              if (original && residualTool(data, true)) throw new AiError('unsupported');
              if (finish(choice.finish_reason)) {
                terminal = true;
                providerEnd = choice.finish_reason;
                if (original && normalTextFinish(providerEnd) && tailDeadline === undefined) {
                  tailDeadline = performance.now() + FINISH_TAIL_MS;
                  clock?.beginTail();
                }
              }
              const split = think!.push(string(record(choice.delta).content));
              delta = split.content; thinkReasoning = split.reasoning;
            } else if (protocol === 'gemini') {
              if (record(data.promptFeedback).blockReason) {
                const failure = new AiError('content_filter');
                attachFailureDiagnostic(failure, { phase: 'upstream_error', upstreamClass: 'content_filter' });
                throw failure;
              }
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
              if (data.type === 'message_stop') {
                terminal = true;
                if (original) terminalEvidence = 'message_stop';
                if (theater) break;
              }
            }
            if (original) {
              if (rawDelta.trim()) clock?.progress('firstContentMs');
              if (native.trim()) clock?.progress('firstReasoningMs');
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
            if (original && protocol === 'anthropic' && data.type === 'message_stop') break;
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
          if ((options.nativeDeliveryReference !== undefined || trace.matchesDelivery) && !trace.matchesDelivery?.(text))
            throw new AiError(outputLimited ? 'output_limit' : 'unsupported', undefined,
              outputLimited ? undefined : { fieldPath: 'tavern.native_delivery.response' });
        }
        if (!text.trim()) throw new AiError('empty');
        if (missingTheaterFinish) throw new AiError('stream_interrupted');
        if (trace) {
          trace.restored = true;
          trace.clock.first('restoredMs');
        }
        try { if (inspectionId) requestInspections.finish(inspectionId, usage); }
        catch { /* 诊断观察器失败不改变响应。 */ }
        const result = { text, ...(outputLimited ? { outputLimited: true } : {}), ...(reasoning ? { nativeReasoning: reasoning } : {}), usage, diagnostics, protocol: snapshot.channel.protocol, model: snapshot.model };
        observeLifecycle(result);
        // 成功返回后，校验失败仍要带上这次请求已经看见的事实，不能事后从原文猜。
        attachObservedRequest(result, {
          model: snapshot.model,
          protocol: snapshot.channel.protocol,
          stream: trace?.requestedStream ?? options.stream === true,
          relayEnabled, relayUsed: relay.used,
          httpStatus: lastHttp,
          ...(typeof options.timeoutSeconds === 'number' ? { timeoutSeconds: options.timeoutSeconds } : {}),
          elapsedMs: Math.max(0, Math.round(performance.now() - started)),
          ...(trace ? { bytes: trace.bytes, complete: trace.complete } : seen.complete !== undefined ? { complete: seen.complete } : {}),
          finishReason: trace?.finish ?? trace?.rawFinish ?? seen.finishReasons?.[0],
          ...(typeof seen.errorPresent === 'boolean' ? { errorInBody: seen.errorPresent } : {}),
        }, diagnosticSecrets(snapshot));
        return result;
      }, clock, limits);
    } catch (error) {
      let failure = options.signal?.aborted || (error instanceof AiError && error.code === 'timeout') ? error : trace?.error ?? error;
      if (options.confirmedTransmission?.sent && failure instanceof AiError &&
          (failure.code === 'network' || failure.code === 'timeout' ||
           (failure.code === 'server' && failure.details?.fieldPath === 'channel.relay'))) {
        const uncertain = new AiError(failure.code, failure.status, { fieldPath: 'channel.continuation_delivery_unknown' });
        carryFailureDiagnostic(failure, uncertain);
        failure = uncertain;
      }
      // Relay policy follows the actual transport. The script host can only replay a failed original request;
      // 原型会话只允许手动重试，避免再付一笔。
      if ((relay.used || prototype) && failure instanceof AiError) manualRetryOnly.add(failure);
      if (trace && failure instanceof AiError) {
        const upstreamTimeout = failure.code === 'timeout' && !trace.complete && trace.clock.marks.sentMs !== undefined &&
          (['awaiting_headers', 'awaiting_bytes', 'upstream_read'].includes(trace.clock.marks.deadlinePhase ?? ''));
        const upstreamClass = readFailureDiagnostic(failure)?.upstreamClass;
        const serviceFailure = failure.code === 'server' || (failure.code === 'rate_limit' && !failure.details?.quota) ||
          (failure.code === 'rejected' && ['overload', 'rate_limit', 'internal'].includes(upstreamClass ?? ''));
        const upstreamFailure = failure === trace.error && !trace.complete &&
          ((failure.code === 'network' && !trace.status) || serviceFailure ||
            (failure.code === 'stream_interrupted' && (trace.readError || (trace.readerEof &&
              ['tavern.upstream.missing_finish', 'tavern.upstream.message_stop'].includes(failure.details?.fieldPath ?? '')))));
        if (!trace.retryableHost || trace.calls !== 1 || !(upstreamTimeout || upstreamFailure))
          manualRetryOnly.add(failure);
        trace.cancelled = failure.code === 'cancelled' || failure.code === 'timeout';
      }
      observeLifecycle(failure);
      const status = failure instanceof AiError && typeof failure.status === 'number' && failure.status >= 100 ? failure.status : lastHttp;
      const field = failure instanceof AiError ? failure.details?.fieldPath : undefined;
      const headersSeen = trace?.clock.marks.headersMs !== undefined || lastHttp !== undefined;
      const phase = failurePhase(field, clock?.marks.deadlinePhase)
        ?? (failure instanceof AiError && failure.code === 'network' && !headersSeen ? 'upstream_connect' as const : undefined)
        ?? (failure instanceof AiError && failure.code === 'stream_interrupted' ? 'upstream_read' as const : undefined);
      attachObservedRequest(failure, {
        model: snapshot.model,
        protocol: snapshot.channel.protocol,
        stream: trace?.requestedStream ?? options.stream === true,
        relayEnabled, relayUsed: relay.used,
        httpStatus: status,
        ...(typeof options.timeoutSeconds === 'number' ? { timeoutSeconds: options.timeoutSeconds } : {}),
        elapsedMs: Math.max(0, Math.round(performance.now() - started)),
        ...(trace ? { bytes: trace.bytes, complete: trace.complete } : seen.complete !== undefined ? { complete: seen.complete } : {}),
        finishReason: trace?.finish ?? trace?.rawFinish ?? seen.finishReasons?.[0],
        phase,
        ...(typeof seen.errorPresent === 'boolean' ? { errorInBody: seen.errorPresent } : {}),
      }, diagnosticSecrets(snapshot));
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
      session?.dispose();
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
