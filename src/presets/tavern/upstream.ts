import { checkFinish, splitLeadingThink } from '../../services/ai/compat';
import { isOpenAiCompatible, type Protocol } from '../../services/ai/configuration';
import { AiError, safeAiError } from '../../services/ai/errors';
import { attachFailureDiagnostic, classifyUpstreamPayload } from '../../services/ai/failureDiagnostic';
import { array, nativeReasoning, record, usageFrom, type Usage } from '../../services/ai/protocols';
import { responseContent, responseDiagnostics } from '../../services/ai/responseContent';
import { readSse } from '../../services/ai/sse';

import { identifyBody, safeMime } from './responseFormat';

import { StoryClock } from './timing';

export interface UpstreamTrace {
  clock: StoryClock;
  requestedStream?: boolean;
  contentType?: string | null;
  formatEvidence?: 'json_object' | 'sse_field' | 'sse_comment';
  readerEof?: boolean;
  readError?: boolean;
  wrapperFormat?: 'json' | 'sse' | 'unknown';
  wrapperBodyRead?: boolean;
  cancelled?: boolean;
  restored?: boolean;
  /** Request-local check for the native adapter. Never export a tool argument in diagnostics. */
  matchesDelivery?: (restored: string) => boolean;
  rawFinish?: string;
  calls: number;
  bytes: number;
  complete: boolean;
  status?: number;
  boundary?: 'json' | 'done' | 'message_stop' | 'eof';
  finish?: string;
  usage?: Usage;
  error?: AiError;
  normalized: 'pending' | 'json' | 'sse';
  wrapper: 'pending' | 'returned' | 'failed';
}
export const newTrace = (clock = new StoryClock()): UpstreamTrace => ({ clock, calls: 0, bytes: 0, complete: false, normalized: 'pending', wrapper: 'pending' });
function invalid(): never {
  const failure = new AiError('invalid_output', undefined, { fieldPath: 'tavern.upstream.tool' });
  attachFailureDiagnostic(failure, { phase: 'tool_parse' });
  throw failure;
}
function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new AiError('invalid_json', undefined, { fieldPath: 'tavern.upstream.json' }); }
}
function objectArgs(value: unknown) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function normalizedUsage(u?: Usage) {
  return u && { prompt_tokens: u.inputTokens, completion_tokens: u.outputTokens, total_tokens: u.totalTokens,
    prompt_tokens_details: { cached_tokens: u.cacheReadTokens }, completion_tokens_details: { reasoning_tokens: u.reasoningTokens } };
}
class Frames {
  private tools = new Map<number, { id: string; name: string; args: string }>();
  private blocks = new Map<number, number>();
  private snapshots = new Map<string, { name: string; args: string }>();
  private anonymousGeminiCalls = new Set<string>();
  private hasText = false;
  private preToolPaddingLength = 0;
  boundary = false;
  constructor(private protocol: Protocol, private trace: UpstreamTrace, private expectedContentTool?: string) {}
  private track(index: number, id: unknown, name: unknown, args: unknown) {
    if (!Number.isSafeInteger(index) || index < 0) invalid();
    const tool = this.tools.get(index) ?? { id: '', name: '', args: '' };
    if (typeof id === 'string' && id) {
      if (tool.id && tool.id !== id) invalid();
      tool.id = id;
    }
    if (typeof name === 'string') tool.name += name;
    if (typeof args === 'string') tool.args += args;
    if (tool.args.length > 8_000_000) invalid();
    this.tools.set(index, tool);
    return { index, type: 'function', id, function: { name, arguments: args } };
  }
  project(value: unknown, streaming: boolean) {
    const d = record(value), p = this.protocol;
    const usage = usageFrom(d, p);
    if (usage) this.trace.usage = { ...this.trace.usage, ...usage };
    if (d.error || d.type === 'error') {
      const failure = new AiError('rejected', undefined, { fieldPath: 'tavern.upstream.error' });
      attachFailureDiagnostic(failure, classifyUpstreamPayload(d, { transport: streaming ? 'sse' : 'json', httpStatus: this.trace.status, errorEvent: d.type === 'error' }));
      throw failure;
    }
    const info = responseDiagnostics(d, p, streaming);
    const choices = array(isOpenAiCompatible(p) ? d.choices : d.candidates);
    const choice = record(choices[0]);
    const reason = isOpenAiCompatible(p) ? choice.finish_reason : p === 'gemini' ? choice.finishReason
      : streaming ? record(d.delta).stop_reason : d.stop_reason;
    if (typeof reason === 'string' && reason) {
      this.trace.rawFinish = ['tool_calls', 'tool_use', 'cancelled', 'canceled', 'cancelled_no_content'].includes(reason.toLowerCase())
        ? reason : info.finishReasons?.[0] ?? 'unrecognized';
    }
    if (info.filtered || info.refusal) {
      this.trace.finish = info.finishReasons?.[0];
      const failure = new AiError('content_filter', undefined, { fieldPath: 'tavern.upstream.filter' });
      attachFailureDiagnostic(failure, { phase: 'upstream_error', upstreamClass: 'content_filter' });
      throw failure;
    }
    if (streaming && isOpenAiCompatible(p) && choice.message !== undefined)
      throw new AiError('unsupported', undefined, { fieldPath: 'tavern.upstream.sse_message' });
    if (choices.length > 1 || (choice.index !== undefined && choice.index !== 0)) throw new AiError('unsupported');
    const msg = record(streaming ? choice.delta : choice.message);
    const text = responseContent(d, p, streaming), reasoning = nativeReasoning(d, p, streaming);
    if (this.expectedContentTool && streaming && !this.tools.size && !this.hasText && text && !/[^ \t\r\n]/u.test(text))
      this.preToolPaddingLength += text.length;
    if (text.trim()) {
      this.hasText = true;
      this.trace.clock.progress('firstContentMs');
    }
    if (reasoning.trim()) this.trace.clock.progress('firstReasoningMs');
    const calls = [];
    if (isOpenAiCompatible(p)) {
      if (msg.function_call != null || (msg.tool_calls != null && !Array.isArray(msg.tool_calls))) invalid();
      for (const [i, item] of array(msg.tool_calls).entries()) {
        const tool = record(item), fn = record(tool.function);
        if (tool.type !== undefined && tool.type !== 'function') invalid();
        if (streaming && (typeof tool.index !== 'number' || !Number.isSafeInteger(tool.index))) invalid();
        if (typeof fn.arguments === 'string' && fn.arguments.length) this.trace.clock.progress('firstArgumentsMs');
        calls.push(this.track(streaming ? Number(tool.index) : i, tool.id, fn.name, fn.arguments));
      }
    } else if (p === 'gemini') {
      const anonymousThisFrame: string[] = [];
      for (const part of array(record(choice.content).parts)) {
        const call = record(part).functionCall;
        if (call === undefined) continue;
        const functionCall = record(call);
        const { id, name } = functionCall;
        if (functionCall.partialArgs !== undefined || functionCall.willContinue === true)
          throw new AiError('unsupported', undefined, { fieldPath: 'tavern.gemini.partialArgs' });
        const args = Object.hasOwn(functionCall, 'args') ? functionCall.args : {};
        if (typeof name !== 'string' || !objectArgs(args)) invalid();
        const encoded = JSON.stringify(args);
        if (typeof id === 'string') {
          const previous = this.snapshots.get(id);
          if (previous) {
            if (previous.name !== name || previous.args !== encoded) invalid();
            continue;
          }
          this.snapshots.set(id, { name, args: encoded });
        } else {
          const identity = JSON.stringify([name, encoded]);
          if (this.anonymousGeminiCalls.has(identity)) invalid();
          anonymousThisFrame.push(identity);
        }
        if (Object.hasOwn(functionCall, 'args')) this.trace.clock.progress('firstArgumentsMs');
        const index = this.tools.size;
        calls.push(this.track(index, id ?? 'gemini-call-' + index, name, encoded));
      }
      for (const identity of anonymousThisFrame) this.anonymousGeminiCalls.add(identity);
    } else {
      if (d.type === 'message_stop') { this.boundary = true; this.trace.boundary = 'message_stop'; }
      const blocks = streaming ? d.type === 'content_block_start' ? [d.content_block] : [] : array(d.content);
      for (const block of blocks) {
        const b = record(block);
        if (b.type !== 'tool_use') continue;
        const index = this.tools.size;
        this.blocks.set(Number(d.index), index);
        const args = b.input;
        if (!objectArgs(args)) invalid();
        if (!streaming || Object.keys(record(args)).length) this.trace.clock.progress('firstArgumentsMs');
        calls.push(this.track(index, b.id, b.name, streaming && !Object.keys(record(args)).length ? '' : JSON.stringify(args)));
      }
      const index = this.blocks.get(Number(d.index));
      if (d.type === 'content_block_delta' && record(d.delta).type === 'input_json_delta') {
        if (index === undefined || typeof record(d.delta).partial_json !== 'string') invalid();
        if (record(d.delta).partial_json) this.trace.clock.progress('firstArgumentsMs');
        calls.push(this.track(index, undefined, undefined, record(d.delta).partial_json));
      }
      if (d.type === 'content_block_stop' && index !== undefined) {
        if (!this.tools.get(index)?.args) calls.push(this.track(index, undefined, undefined, '{}'));
        this.blocks.delete(Number(d.index));
      }
    }
    if (reason != null && reason !== '') {
      if (reason !== 'tool_calls' && reason !== 'tool_use') {
        try { checkFinish(reason, true); }
        catch (error) {
          this.trace.finish = info.finishReasons?.[0] ?? 'unrecognized';
          if (error instanceof AiError) throw new AiError(error.code, error.status, { fieldPath: 'tavern.upstream.finish_reason' });
          throw error;
        }
      }
      if (this.trace.finish && this.trace.finish !== reason) invalid();
      this.trace.finish = String(reason);
    }
    const finish = reason == null || reason === '' ? null : ['length','max_tokens'].includes(String(reason).toLowerCase())
      ? 'length' : this.tools.size ? 'tool_calls' : 'stop';
    const payload = { ...(streaming ? {} : { role: 'assistant' }), ...(text ? { content: text } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.length ? { tool_calls: calls } : {}) };
    return { choices: [{ index: 0, [streaming ? 'delta' : 'message']: payload, finish_reason: finish }],
      ...(usage ? { usage: normalizedUsage(this.trace.usage) } : {}) };
  }
  finish(streaming: boolean) {
    const finish = this.trace.finish;
    if (!finish && !this.boundary) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.missing_finish' });
    if (streaming && this.protocol === 'anthropic' && !this.boundary) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.message_stop' });
    if (streaming && this.protocol === 'anthropic' && this.blocks.size) invalid();
    if (this.tools.size || finish === 'tool_use' || finish === 'tool_calls') {
      if (!this.tools.size || !(finish === 'tool_use' || finish === 'tool_calls' || (this.protocol === 'gemini' && finish === 'STOP'))) {
        throw new AiError(finish === 'length' || finish === 'max_tokens' ? 'output_limit' : 'invalid_output');
      }
      const ids = new Set<string>();
      for (const tool of this.tools.values()) {
        if (!tool.id || !tool.name || ids.has(tool.id)) invalid();
        const args = parse(tool.args);
        if (!objectArgs(args)) invalid();
        if (this.expectedContentTool === tool.name && this.tools.size === 1) {
          const content = record(args).content;
          // The wrapper can prefer a competing plain answer. Check what the client actually received.
          if (typeof content === 'string' && content.trim()) {
            const padding = this.preToolPaddingLength;
            this.trace.matchesDelivery = restored => restored === content || restored === splitLeadingThink(content).content ||
              // A wrapper can already have forwarded whitespace-only SSE deltas before seeing the tool.
              (padding > 0 && restored.length === padding + content.length && restored.endsWith(content) &&
                !/[^ \t\r\n]/u.test(restored.slice(0, padding)));
          }
        }
        ids.add(tool.id);
      }
    }
    // A clean reasoning-only response remains observable, but a wrapper cannot invent its missing content.
    if (!this.tools.size && !this.hasText) this.trace.error = new AiError('empty');
    this.trace.complete = true;
    this.trace.clock.first('upstreamCompleteMs');
  }
}
export async function normalizeUpstream(response: Response, protocol: Protocol, stream: boolean, signal: AbortSignal, trace: UpstreamTrace, expectedContentTool?: string) {
  trace.status = response.status;
  trace.contentType = safeMime(response.headers);
  trace.requestedStream = stream;
  const frames = new Frames(protocol, trace, expectedContentTool);
  if (!response.body) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.missing_body' });
  const stopped = new AbortController();
  const reading = AbortSignal.any([signal, stopped.signal]);
  const counted = await identifyBody(response.body, reading, trace);
  if (trace.normalized === 'json') {
    const payload = await new Response(counted).arrayBuffer();
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(payload); }
    catch { throw new AiError('invalid_json', undefined, { fieldPath: 'tavern.upstream.utf8' }); }
    const data = parse(source);
    trace.boundary = 'json';
    const json = frames.project(data, false);
    frames.finish(false);
    return Response.json(json);
  }
  const iterator = readSse(counted, reading, { utf8: 'tavern.upstream.utf8', tail: 'tavern.upstream.sse_tail', onComment: () => { trace.clock.marks.comments++; } });
  const encoder = new TextEncoder();
  const done = encoder.encode('data: [DONE]\n\n');
  let downstreamCancelled = false;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (reading.aborted) throw new AiError('cancelled');
        if (next.done) {
          trace.boundary ??= 'eof';
        } else {
          trace.clock.frame();
          if (next.value.event === 'error') {
            let payload: unknown;
            try { payload = JSON.parse(next.value.data); } catch { payload = undefined; }
            const failure = new AiError('rejected', undefined, { fieldPath: 'tavern.upstream.error' });
            attachFailureDiagnostic(failure, classifyUpstreamPayload(payload, { transport: 'sse', httpStatus: trace.status, errorEvent: true }));
            throw failure;
          }
          if (isOpenAiCompatible(protocol) && next.value.data === '[DONE]') {
            frames.boundary = true;
            trace.boundary = 'done';
          } else {
            const frame = frames.project(parse(next.value.data), true);
            controller.enqueue(encoder.encode('data: ' + JSON.stringify(frame) + '\n\n'));
            // Anthropic can leave the HTTP body open after its terminal message_stop.
            if (!frames.boundary) return;
          }
        }
        frames.finish(true);
        await iterator.return(undefined);
        if (!downstreamCancelled) {
          controller.enqueue(done);
          controller.close();
        }
      } catch (error) {
        trace.error = error instanceof AiError ? error : new AiError('stream_interrupted');
        await iterator.return(undefined);
        if (!downstreamCancelled) {
          // A wrapper may read this event, but cannot turn its upstream failure into a candidate.
          controller.enqueue(encoder.encode('event: error\ndata: ' + JSON.stringify({ error: { code: safeAiError(trace.error).code } }) + '\n\n'));
          controller.close();
        }
      }
    },
    async cancel() {
      downstreamCancelled = true;
      stopped.abort();
      await iterator.return(undefined);
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}
