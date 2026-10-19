import { AiError, safeAiError } from './errors';
import { requestInspections } from './inspection';
import type { InspectionScope } from './inspection';
import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { modelIdSchema } from './configuration';
import {
  wireRequest,
  responseText,
  usageFrom,
  authHeaders,
  endpoint,
  record,
  array,
  string,
} from './protocols';
import type { AiMessage, Usage } from './protocols';
import { readSse } from './sse';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutSeconds?: number;
  stream?: boolean;
  onDelta?: (text: string) => void;
  inspection?: InspectionScope;
}
export interface AiResponse {
  text: string;
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
  private async response(url: string, init: RequestInit, signal: AbortSignal) {
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
    try {
      return await operation(options, async (signal) => {
        if (signal.aborted) throw new AiError('cancelled');
        inspectionId = requestInspections.start(snapshot, wire.init.body, options.inspection);
        const response = await this.response(wire.url, wire.init, signal);
        const protocol = snapshot.channel.protocol;
        let text = '',
          usage: Usage | undefined;
        if (!options.stream) {
          let data: unknown;
          try {
            data = await response.json();
          } catch {
            throw new AiError('invalid_json');
          }
          text = responseText(data, protocol);
          usage = usageFrom(data, protocol);
        } else {
          if (
            !response.body ||
            !response.headers.get('content-type')?.includes('text/event-stream')
          )
            throw new AiError('stream_interrupted');
          let terminal = false;
          for await (const event of readSse(response.body, signal)) {
            if (event.data === '[DONE]' && protocol === 'openai') {
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
            let delta = '';
            if (protocol === 'openai') {
              const choice = record(array(data.choices)[0]);
              if (choice.finish_reason && choice.finish_reason !== 'stop')
                throw new AiError('stream_interrupted');
              delta = string(record(choice.delta).content);
            } else if (protocol === 'gemini') {
              const candidate = record(array(data.candidates)[0]);
              if (candidate.finishReason && candidate.finishReason !== 'STOP')
                throw new AiError('stream_interrupted');
              if (candidate.finishReason === 'STOP') terminal = true;
              delta = array(record(candidate.content).parts)
                .filter((part) => record(part).thought !== true)
                .map((part) => string(record(part).text))
                .join('');
            } else {
              if (data.type === 'content_block_delta' && record(data.delta).type === 'text_delta')
                delta = string(record(data.delta).text);
              const stop = record(data.delta).stop_reason;
              if (stop && stop !== 'end_turn' && stop !== 'stop_sequence')
                throw new AiError('stream_interrupted');
              if (data.type === 'message_stop') terminal = true;
            }
            const nextUsage = usageFrom(data, protocol);
            if (nextUsage) usage = { ...usage, ...nextUsage };
            text += delta;
            if (text.length > 8_000_000) throw new AiError('invalid_output');
            if (delta && !signal.aborted) options.onDelta?.(delta);
          }
          if (!terminal) throw new AiError('stream_interrupted');
        }
        if (!text.trim()) throw new AiError('empty');
        requestInspections.finish(inspectionId!, usage);
        return { text, usage, diagnostics: wire.diagnostics, protocol, model: snapshot.model };
      });
    } catch (error) {
      if (inspectionId) requestInspections.finish(inspectionId, undefined, safeAiError(error).code);
      throw error;
    }
  }
  async listModels(snapshot: RequestSnapshot, options: RequestOptions = {}): Promise<string[]> {
    return operation(options, async (signal) => {
      const protocol = snapshot.channel.protocol;
      const ids = new Set<string>();
      let next = '';
      for (let page = 0; page < 20; page++) {
        const path =
          protocol === 'anthropic'
            ? `models?limit=100${next ? '&after_id=' + encodeURIComponent(next) : ''}`
            : `models${next ? '?pageToken=' + encodeURIComponent(next) : ''}`;
        const response = await this.response(
          endpoint(snapshot, path),
          { headers: authHeaders(snapshot) },
          signal,
        );
        let data: Record<string, unknown>;
        try {
          data = record(await response.json());
        } catch {
          throw new AiError('invalid_json');
        }
        if (data.error) throw new AiError('rejected');
        const entries = protocol === 'gemini' ? array(data.models) : array(data.data);
        for (const item of entries) {
          const id = string(record(item)[protocol === 'gemini' ? 'name' : 'id']).replace(
            protocol === 'gemini' ? /^models\// : /$^/,
            '',
          );
          if (modelIdSchema.safeParse(id).success && !id.includes(secretFor(snapshot))) ids.add(id);
        }
        const token =
          protocol === 'gemini'
            ? string(data.nextPageToken)
            : protocol === 'anthropic' && data.has_more === true
              ? string(data.last_id)
              : '';
        if (!token) return [...ids].sort();
        if (token === next || page === 19 || token.includes(secretFor(snapshot)))
          throw new AiError('invalid_output');
        next = token;
      }
      throw new AiError('invalid_output');
    });
  }
}
