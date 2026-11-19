import { AiError } from '../../services/ai/errors';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import type { AiMessage } from '../../services/ai/protocols';
import type { Sampling } from '../package';
import { type GenerationData, type GenerationType, tavernEvents, tavernTools } from './events';
import { fetchGeneration } from './fetch';
import { type UpstreamTrace, normalizeUpstream } from './upstream';
import { tavernWire } from './wire';

export async function sendTavern(snapshot: RequestSnapshot, type: GenerationType, messages: AiMessage[], sampling: Sampling,
  stream: boolean, signal: AbortSignal, trace: UpstreamTrace,
  send: (wire: ReturnType<typeof tavernWire>, signal: AbortSignal) => Promise<Response>) {
  const data: GenerationData = { type, messages, ...sampling, stream, n: 1, enable_web_search: false, request_images: false, model: snapshot.model,
    max_tokens: snapshot.channel.parameters.maxOutputTokens, chat_completion_source: 'custom', custom_prompt_post_processing: '' };
  try { await tavernTools.apply(data); }
  catch { throw new AiError('configuration', undefined, { fieldPath: 'tavern.shouldRegister' }); }
  await tavernEvents.emit('chat_completion_settings_ready', data);
  signal.throwIfAborted();
  try {
    const result = await fetchGeneration(data, signal, async request => {
      const actual = AbortSignal.any([signal, request.signal]);
      try {
        const wire = tavernWire(snapshot, await request.json());
        actual.throwIfAborted();
        trace.calls++;
        const response = await send(wire, actual);
        return await normalizeUpstream(response, snapshot.channel.protocol, wire.stream, actual, trace);
      } catch (error) {
        trace.error = actual.aborted ? new AiError('cancelled') : error instanceof AiError ? error : new AiError('network');
        trace.status ??= trace.error.status;
        return Response.json({ error: { code: trace.error.code } }, { status: trace.error.status ?? trace.status ?? 502 });
      }
    });
    trace.wrapper = 'returned';
    if (trace.error && !(trace.complete && trace.error.code === 'empty')) throw trace.error;
    if (!result.ok) throw new AiError('rejected', result.status, { fieldPath: 'tavern.wrapper.http' });
    return result;
  } catch (error) {
    if (trace.wrapper === 'pending') trace.wrapper = 'failed';
    throw trace.error ?? (error instanceof AiError ? error : new AiError('invalid_output', undefined, { fieldPath: 'tavern.wrapper' }));
  }
}
