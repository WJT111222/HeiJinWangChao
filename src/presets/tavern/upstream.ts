import isEqual from 'lodash/isEqual';
import { checkProviderFinish, providerToolFinish, splitLeadingThink } from '../../services/ai/compat';
import { isOpenAiCompatible, type Protocol } from '../../services/ai/configuration';
import { AiError, safeAiError } from '../../services/ai/errors';
import { attachFailureDiagnostic, classifyUpstreamPayload } from '../../services/ai/failureDiagnostic';
import { array, nativeReasoning, record, usageFrom, type Usage } from '../../services/ai/protocols';
import { anthropicBlockText, geminiPartText, responseContent, responseDiagnostics } from '../../services/ai/responseContent';
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
  /** Match a wrapper's restored output, or verify the body and its separate prefix for C2. */
  matchesDelivery?: (restored: string, leadingPadding?: string) => boolean;
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
export class UpstreamFrames {
  private tools = new Map<number, { id: string; name: string; args: string }>();
  // A closed index remains reserved for the rest of this message.
  private blocks = new Map<number, { type: string; toolIndex?: number } | null>();
  private snapshots = new Map<string, { name: string; args: unknown }>();
  private anonymousGeminiCalls = new Set<string>();
  private hasText = false;
  // Exact visible text observed before the first tool. null means its position or content disqualifies it.
  private leadingPadding: string | null = '';
  boundary = false;
  constructor(private protocol: Protocol, private trace: UpstreamTrace, private expectedContentTool?: string | null) {}
  private observeCompanionText(text: string, sharesToolFields = false) {
    if (!this.expectedContentTool || !text || this.leadingPadding === null) return;
    if (this.tools.size || sharesToolFields || /[^ \t\r\n]/u.test(text)) this.leadingPadding = null;
    else this.leadingPadding += text;
  }
  private track(index: number, id: unknown, name: unknown, args: unknown) {
    if (!Number.isSafeInteger(index) || index < 0) invalid();
    if ((id != null && (typeof id !== 'string' || !id.trim())) || (name != null && typeof name !== 'string')
      || (args != null && typeof args !== 'string')) invalid();
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
  private startAnthropicTool(block: Record<string, unknown>, streaming: boolean) {
    if (!objectArgs(block.input)) invalid();
    const hasInput = !streaming || Object.keys(record(block.input)).length > 0;
    if (hasInput) this.trace.clock.progress('firstArgumentsMs');
    return this.track(this.tools.size, block.id, block.name, hasInput ? JSON.stringify(block.input) : '');
  }
  private anthropicBlockEvent(event: Record<string, unknown>) {
    const { type, index } = event;
    if (type !== 'content_block_start' && type !== 'content_block_delta' && type !== 'content_block_stop') return;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || this.trace.finish) invalid();

    if (type === 'content_block_start') {
      const block = record(event.content_block);
      if (this.blocks.has(index) || typeof block.type !== 'string' || !block.type) invalid();
      const call = block.type === 'tool_use' ? this.startAnthropicTool(block, true) : undefined;
      this.blocks.set(index, { type: block.type, toolIndex: call?.index });
      return call;
    }
    const block = this.blocks.get(index);
    if (!block) invalid();
    if (type === 'content_block_stop') {
      this.blocks.set(index, null);
      if (block.toolIndex !== undefined && !this.tools.get(block.toolIndex)?.args)
        return this.track(block.toolIndex, undefined, undefined, '{}');
      return;
    }
    const delta = record(event.delta);
    switch (delta.type) {
      case 'input_json_delta':
        if (block.toolIndex === undefined || typeof delta.partial_json !== 'string') invalid();
        if (delta.partial_json) this.trace.clock.progress('firstArgumentsMs');
        return this.track(block.toolIndex, undefined, undefined, delta.partial_json);
      case 'text_delta':
      case 'citations_delta':
        if (block.type !== 'text') invalid();
        return;
      case 'thinking_delta':
      case 'signature_delta':
        if (block.type !== 'thinking') invalid();
        return;
      default:
        invalid();
    }
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
      : streaming ? (d.type === 'message_delta' ? record(d.delta).stop_reason : undefined) : d.stop_reason;
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
    if (this.trace.finish && (record(choice.delta).content || array(record(choice.delta).tool_calls).length
      || array(record(choice.content).parts).length || d.type === 'content_block_start' || d.type === 'content_block_delta')) invalid();
    if (streaming && isOpenAiCompatible(p) && choice.message !== undefined)
      throw new AiError('unsupported', undefined, { fieldPath: 'tavern.upstream.sse_message' });
    if (choices.length > 1 || (choice.index !== undefined && choice.index !== 0)) throw new AiError('unsupported');
    const msg = record(streaming ? choice.delta : choice.message);
    const role = isOpenAiCompatible(p) ? msg.role : p === 'gemini' ? record(choice.content).role
      : streaming ? record(d.message).role : d.role;
    if (role !== undefined && role !== (p === 'gemini' ? 'model' : 'assistant')) invalid();
    const text = responseContent(d, p, streaming), reasoning = nativeReasoning(d, p, streaming);
    if (text.trim()) {
      this.hasText = true;
      this.trace.clock.progress('firstContentMs');
    }
    if (reasoning.trim()) this.trace.clock.progress('firstReasoningMs');
    const calls = [];
    if (isOpenAiCompatible(p)) {
      if (msg.function_call != null || (msg.tool_calls != null && !Array.isArray(msg.tool_calls))) invalid();
      // content and tool_calls are sibling fields, including when they share a single SSE delta.
      this.observeCompanionText(text, array(msg.tool_calls).length > 0);
      const indexes = new Set<number>();
      for (const [i, item] of array(msg.tool_calls).entries()) {
        const tool = record(item), fn = record(tool.function);
        if (tool.type !== undefined && tool.type !== 'function') invalid();
        if (streaming && (typeof tool.index !== 'number' || !Number.isSafeInteger(tool.index))) invalid();
        if (typeof fn.arguments === 'string' && fn.arguments.length) this.trace.clock.progress('firstArgumentsMs');
        const index = streaming ? Number(tool.index) : i;
        if (indexes.has(index)) invalid();
        indexes.add(index);
        calls.push(this.track(index, tool.id, fn.name, fn.arguments));
      }
    } else if (p === 'gemini') {
      const frameIds = new Set<string>();
      const anonymousThisFrame: string[] = [];
      for (const part of array(record(choice.content).parts)) {
        const call = record(part).functionCall;
        this.observeCompanionText(geminiPartText(part), call !== undefined);
        if (call === undefined) continue;
        const functionCall = record(call);
        const { id, name } = functionCall;
        if (functionCall.partialArgs !== undefined || functionCall.willContinue === true)
          throw new AiError('unsupported', undefined, { fieldPath: 'tavern.gemini.partialArgs' });
        const args = Object.hasOwn(functionCall, 'args') ? functionCall.args : {};
        if (typeof name !== 'string' || !objectArgs(args)) invalid();
        const encoded = JSON.stringify(args);
        if (id !== undefined && (typeof id !== 'string' || !id.trim())) invalid();
        if (typeof id === 'string') {
          if (frameIds.has(id)) invalid();
          frameIds.add(id);
          const previous = this.snapshots.get(id);
          if (previous) {
            if (!streaming || previous.name !== name || !isEqual(previous.args, args)) invalid();
            continue;
          }
          this.snapshots.set(id, { name, args });
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
    } else if (streaming) {
      const call = this.anthropicBlockEvent(d);
      this.observeCompanionText(text);
      if (call) calls.push(call);
      if (d.type === 'message_stop') { this.boundary = true; this.trace.boundary = 'message_stop'; }
    } else {
      for (const item of array(d.content)) {
        const block = record(item);
        this.observeCompanionText(anthropicBlockText(block));
        if (block.type === 'tool_use') calls.push(this.startAnthropicTool(block, false));
      }
    }
    if (reason != null && reason !== '') {
      try { checkProviderFinish(p, reason); }
      catch (error) {
        this.trace.finish = info.finishReasons?.[0] ?? 'unrecognized';
        if (error instanceof AiError) throw new AiError(error.code, error.status, { fieldPath: 'tavern.upstream.finish_reason' });
        throw error;
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
  /** Read only after finish validated the provider's original tool-call structure. */
  singleCompletedCall() {
    if (!this.trace.complete || this.trace.error || this.tools.size > 1 || (this.hasText && this.tools.size)) invalid();
    const call = this.tools.values().next().value;
    return call && { id: call.id, name: call.name, args: parse(call.args) };
  }
  finish(streaming: boolean) {
    const finish = this.trace.finish;
    if (!finish) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.missing_finish' });
    if (streaming && this.protocol === 'anthropic') {
      if (!this.boundary) throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.message_stop' });
      for (const block of this.blocks.values()) if (block !== null) invalid();
    }
    if (this.tools.size || finish === 'tool_use' || finish === 'tool_calls') {
      if (!this.tools.size || !providerToolFinish(this.protocol, finish)) {
        throw new AiError(['length', 'max_tokens'].includes(finish.toLowerCase()) ? 'output_limit' : 'invalid_output', undefined, { fieldPath: 'tavern.upstream.tool' });
      }
      // Undefined permits generic multi-tool processing. Null means this delivery requested text only.
      if (this.expectedContentTool !== undefined && (this.tools.size !== 1 || this.hasText)) invalid();
      const ids = new Set<string>();
      for (const tool of this.tools.values()) {
        if (!tool.id.trim() || !tool.name.trim() || ids.has(tool.id)) invalid();
        const args = parse(tool.args);
        if (!objectArgs(args)) invalid();
        if (this.expectedContentTool !== undefined) {
          if (tool.name !== this.expectedContentTool || Object.keys(record(args)).length !== 1) invalid();
          const content = record(args).content;
          if (typeof content !== 'string' || !content.trim()) invalid();
          const padding = this.leadingPadding;
          this.trace.matchesDelivery = (restored, leadingPadding) => {
            if (leadingPadding !== undefined) return !!padding && leadingPadding === padding && restored === content;
            return restored === content || restored === splitLeadingThink(content).content ||
              (!!padding && restored === padding + content);
          };
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
export async function normalizeUpstream(response: Response, protocol: Protocol, stream: boolean, signal: AbortSignal, trace: UpstreamTrace, expectedContentTool?: string | null) {
  trace.status = response.status;
  trace.contentType = safeMime(response.headers);
  trace.requestedStream = stream;
  const frames = new UpstreamFrames(protocol, trace, expectedContentTool);
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
