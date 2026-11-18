import { AiError } from './errors';
import type { Protocol } from './configuration';
import { isOpenAiCompatible } from './configuration';
import { array, record, string, nativeReasoning, usageFrom } from './protocols';
import type { Usage } from './protocols';
import { rawResponseObservation, responseContent, responseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';
import { readSse } from './sse';
import { ToolEventProjector, observedToolArguments } from './toolResponseEvents';
import type { ToolResponseEvent } from './toolResponseEvents';
import { observeToolTrace } from './storyToolTrace';
import type { StoryToolTraceRecorder } from './storyToolTrace';

/** Request-local provenance. A sequence identifies a wire frame, not the order of
 * content/reasoning fields inside it. No URL, credential, signature or save data. */
export interface ResponseSource {
  readonly protocol: Protocol;
  readonly requestedStream: boolean;
  readonly transport: 'http' | 'json' | 'sse';
  readonly sequence: number;
  readonly httpStatus?: number;
  readonly eventName?: string;
}
/** A complete JSON body or one atomic SSE payload. These are internal, transient
 * public model values, not a logging API, UI projection or accepted candidate.
 * Keep finishReason verbatim (including unknown values); policy belongs to the
 * existing consumer. In particular transport EOF is never a fabricated stop. */
export interface ResponsePayloadEvent {
  readonly type: 'response';
  readonly source: ResponseSource;
  readonly delivery: 'complete' | 'delta';
  readonly content: string;
  readonly rawText: string;
  readonly nativeReasoning: string;
  readonly observation: RawResponseObservation;
  readonly diagnostics: ResponseDiagnostics;
  readonly usage?: Usage;
  readonly finishReason: unknown;
  readonly finishField: 'choices.0.finish_reason' | 'candidates.0.finishReason' | 'stop_reason' | 'delta.stop_reason';
  readonly messageStop: boolean;
  readonly providerError: boolean;
  readonly filtered: boolean;
  /** Transient wire-shape facts for the Story tool carrier, never exported. */
  readonly openAiToolSse?: {
    readonly envelope: readonly unknown[];
    readonly finishOnly: boolean;
    readonly hasText: boolean;
  };
}
export type AiResponseEvent =
  | ToolResponseEvent
  | { readonly type: 'opened'; readonly source: ResponseSource }
  | ResponsePayloadEvent
  | { readonly type: 'end'; readonly source: ResponseSource; readonly boundary: 'json-body' | 'eof' | 'done-marker' }
  | { readonly type: 'aborted'; readonly source: ResponseSource }
  | { readonly type: 'error'; readonly source: ResponseSource; readonly error: AiError };

const completionFields = ['id', 'object', 'created', 'model', 'system_fingerprint', 'service_tier'] as const;
const emptyDeltaFields = new Set(['content', 'reasoning', 'reasoning_content', 'reasoning_text', 'refusal']);
function openAiToolSseShape(data: Record<string, unknown>, choice: Record<string, unknown>, source: ResponseSource, rawText: string) {
  const envelope = completionFields.map(key => data[key] ?? undefined);
  const delta = choice.delta;
  const finishOnly = (source.eventName === '' || source.eventName === 'message')
    && choice.finish_reason === 'tool_calls'
    && array(data.choices).length === 1 && (choice.index === undefined || choice.index === 0)
    && Object.keys(choice).every(key => key === 'index' || key === 'finish_reason'
      || key === 'delta' || (key === 'logprobs' && choice.logprobs === null))
    && Object.keys(data).every(key => key === 'choices' || (key === 'usage' && data.usage === null)
      || completionFields.some(field => key === field && (data[key] === null
        || (field === 'created' ? Number.isSafeInteger(data[key]) : typeof data[key] === 'string'))))
    && (delta === undefined || (delta !== null && typeof delta === 'object' && !Array.isArray(delta)
      && Object.entries(delta).every(([key, part]) => emptyDeltaFields.has(key) && (part === null || part === ''))));
  return { envelope, finishOnly, hasText: Boolean(rawText) };
}

function payload(value: unknown, source: ResponseSource, toolResponses: boolean): ResponsePayloadEvent {
  const data = record(value), streaming = source.transport === 'sse';
  const compatible = isOpenAiCompatible(source.protocol), google = source.protocol === 'gemini';
  const choice = record(array(data.choices)[0]), candidate = record(array(data.candidates)[0]);
  const rawText = responseContent(value, source.protocol, streaming);
  // Preserve existing extraction, including the deliberate distinction between
  // multipart raw observation and string-only OpenAI-compatible SSE deltas.
  const content = !streaming ? rawText : compatible ? string(record(choice.delta).content)
    : google ? rawText : data.type === 'content_block_start' && record(data.content_block).type === 'text'
      ? string(record(data.content_block).text)
      : data.type === 'content_block_delta' && record(data.delta).type === 'text_delta' ? string(record(data.delta).text) : '';
  return {
    type: 'response', source, delivery: streaming ? 'delta' : 'complete', content, rawText,
    nativeReasoning: nativeReasoning(value, source.protocol, streaming),
    observation: rawResponseObservation(value, source.protocol, streaming),
    diagnostics: responseDiagnostics(value, source.protocol, streaming), usage: usageFrom(value, source.protocol),
    finishReason: compatible ? choice.finish_reason : google ? candidate.finishReason : streaming ? record(data.delta).stop_reason : data.stop_reason,
    finishField: compatible ? 'choices.0.finish_reason' : google ? 'candidates.0.finishReason' : streaming ? 'delta.stop_reason' : 'stop_reason',
    messageStop: streaming && !compatible && !google && data.type === 'message_stop',
    providerError: Boolean(data.error || (streaming && (data.type === 'error' || source.eventName === 'error'))),
    filtered: google && Boolean(record(data.promptFeedback).blockReason),
    ...(toolResponses && compatible && streaming && { openAiToolSse: openAiToolSseShape(data, choice, source, rawText) }),
  };
}

/** One response, one reader, no retry, synthesized terminator or tool execution.
 * receive is the existing HTTP operation (including its existing safe error
 * handling); readSse remains the sole UTF-8/SSE framer. Cancellation classification
 * as user cancellation versus timeout remains with operation() in AiClient. */
export async function* readAiResponseEvents(
  receive: () => Promise<Response>,
  protocol: Protocol,
  requestedStream: boolean,
  signal: AbortSignal,
  toolResponses = false,
  trace?: StoryToolTraceRecorder,
): AsyncGenerator<AiResponseEvent> {
  let source: ResponseSource = { protocol, requestedStream, transport: 'http', sequence: 0 };
  const tools = toolResponses ? new ToolEventProjector() : undefined;
  const observed = (data: unknown) => {
    const result = payload(data, source, toolResponses);
    if (trace) observeToolTrace(() => {
      const wire = record(data);
      const choice = record(array(wire.choices)[0]);
      const calls = isOpenAiCompatible(protocol) ? array(record(choice[source.transport === 'sse' ? 'delta' : 'message']).tool_calls) : [];
      trace.payload(result, wire.type ?? source.eventName, calls.length ? {
        toolCalls: calls.length,
        argumentsPresent: calls.some(call => Object.hasOwn(record(record(call).function), 'arguments')),
        toolIdentityPresent: calls.some(call => Object.hasOwn(record(call), 'id') || Object.hasOwn(record(record(call).function), 'name')),
      } : undefined);
    });
    if (toolResponses && (result.finishReason === 'tool_calls' || result.finishReason === 'tool_use'))
      result.diagnostics.finishReasons = [String(result.finishReason)];
    const args = toolResponses ? observedToolArguments(data, source).join('') : '';
    return !args ? result : { ...result, rawText: result.rawText + args, observation: {
      text: result.observation.text + args,
      order: source.transport === 'json' ? 'unknown' as const : 'same-event' as const,
    } };
  };
  try {
    if (signal.aborted) { yield { type: 'aborted', source }; return; }
    const response = await receive();
    if (signal.aborted) { yield { type: 'aborted', source }; return; }
    source = { ...source, httpStatus: response.status, transport: !requestedStream || /application\/json/i.test(response.headers.get('content-type') ?? '') ? 'json' : 'sse' };
    if (trace) observeToolTrace(() => trace.opened(source.transport));
    yield { type: 'opened', source };
    if (source.transport === 'json') {
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new AiError('invalid_json'); }
      if (signal.aborted) { yield { type: 'aborted', source }; return; }
      source = { ...source, sequence: 1 };
      if (trace) observeToolTrace(() => trace.wireFrame(source));
      yield observed(data);
      if (tools) for (const event of tools.project(data, source)) yield event;
      yield { type: 'end', source, boundary: 'json-body' };
      return;
    }
    if (!response.body) throw new AiError('stream_interrupted');
    for await (const event of readSse(response.body, signal, trace && (() => trace.bodyChunk()))) {
      if (signal.aborted) { yield { type: 'aborted', source }; return; }
      source = { ...source, sequence: source.sequence + 1, eventName: event.event };
      if (trace) observeToolTrace(() => trace.wireFrame(source));
      if (event.data === '[DONE]' && isOpenAiCompatible(protocol)) {
        if (toolResponses && event.event === 'error') throw new AiError('rejected');
        yield { type: 'end', source, boundary: 'done-marker' };
        return;
      }
      let data: unknown;
      try { data = JSON.parse(event.data); }
      catch { throw new AiError('invalid_json'); }
      yield observed(data);
      if (tools) for (const event of tools.project(data, source)) yield event;
    }
    yield { type: 'end', source, boundary: 'eof' };
  } catch (error) {
    if (signal.aborted) yield { type: 'aborted', source };
    else yield { type: 'error', source: { ...source, ...(error instanceof AiError && error.status !== undefined ? { httpStatus: error.status } : {}) },
      error: error instanceof AiError ? error : new AiError('network') };
  }
}
