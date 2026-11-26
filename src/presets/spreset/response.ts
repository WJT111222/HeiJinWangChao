import { checkFinish, providerToolFinish } from '../../services/ai/compat';
import { isOpenAiCompatible, type Protocol } from '../../services/ai/configuration';
import { AiError } from '../../services/ai/errors';
import { array, record, nativeReasoning } from '../../services/ai/protocols';
import type { RequestOptions } from '../../services/ai/client';
import { rawResponseObservation, responseContent } from '../../services/ai/responseContent';
import { readSse } from '../../services/ai/sse';
import { identifyBody } from '../tavern/responseFormat';
import { newTrace, UpstreamFrames } from '../tavern/upstream';

function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new AiError('invalid_json'); }
}

// Only completed calls enter the processor. Trace, credentials and the transport stay in the host.
export async function readPrototypeResponse(response: Response, protocol: Protocol, signal: AbortSignal,
  observer: Pick<RequestOptions, 'onRawTextDelta' | 'onNativeReasoningDelta' | 'onRawResponse'> = {}) {
  if (!response.body) throw new AiError('stream_interrupted');
  const trace = newTrace();
  trace.status = response.status;
  const frames = new UpstreamFrames(protocol, trace, 'submit_scene');
  const body = await identifyBody(response.body, signal, trace);
  const streaming = trace.normalized === 'sse';
  let text = '', reasoning = '';
  function accept(value: unknown) {
    const payload = record(value);
    const choice = record(array(isOpenAiCompatible(protocol) ? payload.choices : payload.candidates)[0]);
    const message = record(isOpenAiCompatible(protocol) ? (streaming ? choice.delta : choice.message) : choice.content);
    const role = protocol === 'anthropic' ? (streaming ? record(payload.message).role : payload.role) : message.role;
    if (role !== undefined && role !== (protocol === 'gemini' ? 'model' : 'assistant')) throw new AiError('invalid_output');
    if (trace.finish && (Object.keys(message).length || payload.type === 'content_block_start' || payload.type === 'content_block_delta'))
      throw new AiError('invalid_output');
    frames.project(value, streaming);
    const delta = responseContent(value, protocol, streaming), thought = nativeReasoning(value, protocol, streaming);
    text += delta;
    reasoning += thought;
    if (delta) observer.onRawTextDelta?.(delta);
    if (thought) observer.onNativeReasoningDelta?.(thought);
    if (observer.onRawResponse) observer.onRawResponse(rawResponseObservation(value, protocol, streaming));
    if (text.length > 8_000_000 || reasoning.length > 2_000_000) throw new AiError('invalid_output');
  }
  if (streaming) {
    for await (const event of readSse(body, signal, { utf8: 'tavern.upstream.utf8', tail: 'tavern.upstream.sse_tail' })) {
      if (event.event === 'error') throw new AiError('rejected');
      if (isOpenAiCompatible(protocol) && event.data === '[DONE]') break;
      accept(json(event.data));
      if (frames.boundary) break;
    }
  } else {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let data = '';
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (trace.bytes > 8_000_000) throw new AiError('invalid_output');
        data += decoder.decode(part.value, { stream: true });
      }
      accept(json(data + decoder.decode()));
    } catch (error) {
      if (error instanceof TypeError) throw new AiError('invalid_json');
      throw error;
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  signal.throwIfAborted();
  if (!trace.finish) throw new AiError('stream_interrupted');
  if (!providerToolFinish(protocol, trace.finish)) checkFinish(trace.finish);
  frames.finish(streaming);
  if (trace.error) throw trace.error;
  // #252 validates the original protocol, the unique terminal call and its content schema.
  const call = frames.singleCompletedCall();
  return { text, reasoning, call, usage: trace.usage, finish: trace.finish, transport: streaming ? 'sse' as const : 'json' as const };
}
