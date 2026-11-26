import type { PlayerWorldbook } from '../../prompts/playerWorldbook';
import { AiError } from '../../services/ai/errors';
import { attachFailureDiagnostic } from '../../services/ai/failureDiagnostic';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import type { AiMessage } from '../../services/ai/protocols';
import type { Sampling } from '../package';
import { nativeOutputTool } from '../nativeDelivery';
import { type GenerationData, type GenerationType, tavernEvents, tavernTools } from './events';
import { fetchGeneration } from './fetch';
import { type UpstreamTrace, normalizeUpstream } from './upstream';
import { safeMime } from './responseFormat';
import { tavernWire } from './wire';

export async function sendTavern(snapshot: RequestSnapshot, type: GenerationType, messages: AiMessage[], sampling: Sampling | undefined,
  stream: boolean, signal: AbortSignal, trace: UpstreamTrace,
  send: (wire: ReturnType<typeof tavernWire>, signal: AbortSignal) => Promise<Response>, nativeReference?: readonly AiMessage[], playerWorldbook?: PlayerWorldbook) {
  const data: GenerationData = { type, messages, ...sampling, stream, n: 1, enable_web_search: false, request_images: false, model: snapshot.model,
    max_tokens: snapshot.channel.parameters.maxOutputTokens, chat_completion_source: 'custom', custom_prompt_post_processing: '' };
  try { await tavernTools.apply(data); }
  catch {
    const failure = new AiError('configuration', undefined, { fieldPath: 'tavern.shouldRegister' });
    attachFailureDiagnostic(failure, { phase: 'preset_init' });
    throw failure;
  }
  await tavernEvents.emit('chat_completion_settings_ready', data);
  trace.clock.first('settingsReadyMs');
  signal.throwIfAborted();
  try {
    const result = await fetchGeneration(data, signal, async request => {
      const actual = AbortSignal.any([signal, request.signal]);
      try {
        const wire = tavernWire(snapshot, await request.json(), nativeReference, playerWorldbook);
        actual.throwIfAborted();
        trace.requestedStream = wire.stream;
        const response = await send(wire, actual);
        return await normalizeUpstream(response, snapshot.channel.protocol, wire.stream, actual, trace,
          nativeReference === undefined ? undefined : nativeOutputTool);
      } catch (error) {
        trace.error = actual.aborted ? new AiError('cancelled') : error instanceof AiError ? error : new AiError('network');
        trace.status ??= trace.error.status;
        return Response.json({ error: { code: trace.error.code } }, { status: trace.error.status ?? trace.status ?? 502 });
      }
    });
    trace.wrapper = 'returned';
    trace.clock.first('wrapperReturnedMs');
    const mime = safeMime(result.headers);
    trace.wrapperFormat = mime === 'text/event-stream' ? 'sse' : mime === 'application/json' ? 'json' : 'unknown';
    if (trace.error && !(trace.complete && trace.error.code === 'empty')) throw trace.error;
    if (!result.ok) {
      const failure = new AiError('rejected', result.status, { fieldPath: 'tavern.wrapper.http' });
      const status = result.status;
      attachFailureDiagnostic(failure, { phase: 'wrapper_restore', ...(status >= 100 && status <= 599 ? { httpStatus: status, httpError: true } : {}) });
      throw failure;
    }
    return result;
  } catch (error) {
    if (trace.wrapper === 'pending') trace.wrapper = 'failed';
    throw trace.error ?? (error instanceof AiError ? error : new AiError('invalid_output', undefined, { fieldPath: 'tavern.wrapper' }));
  }
}
