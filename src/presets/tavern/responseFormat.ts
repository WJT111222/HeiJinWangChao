import { AiError } from '../../services/ai/errors';
import type { UpstreamTrace } from './upstream';

export function safeMime(headers: Headers) {
  const mime = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mime === undefined) return null;
  return ['application/json', 'text/event-stream', 'text/plain', 'text/html', 'application/octet-stream'].includes(mime) ? mime : 'other';
}

// Read just enough to choose the parser. Retain original chunks, including bytes
// beyond the prefix in the last read, then transfer ownership to the consumer.
export async function identifyBody(body: ReadableStream<Uint8Array>, signal: AbortSignal, trace: UpstreamTrace) {
  const reader = body.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal.removeEventListener('abort', release);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  };
  signal.addEventListener('abort', release, { once: true });
  async function read() {
    try {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) trace.readerEof = true;
      else trace.bytes += chunk.value.byteLength;
      return chunk;
    } catch {
      if (signal.aborted) throw new AiError('cancelled');
      trace.readError = true;
      throw new AiError('stream_interrupted', undefined, { fieldPath: 'tavern.upstream.read' });
    }
  }
  const prefix = new Uint8Array(4096);
  const chunks: Uint8Array[] = [];
  let size = 0, cursor = 0, indented = false;
  try {
    while (size < prefix.length) {
      const chunk = await read();
      if (chunk.done) break;
      if (!chunk.value.length) continue;
      chunks.push(chunk.value);
      const head = chunk.value.subarray(0, prefix.length - size);
      prefix.set(head, size);
      size += head.length;
      if (!cursor && prefix[0] === 0xef) {
        if (size < 3) continue;
        if (prefix[1] === 0xbb && prefix[2] === 0xbf) cursor = 3;
      }
      while (cursor < size && [9, 10, 13, 32].includes(prefix[cursor])) {
        indented = prefix[cursor] === 9 || prefix[cursor] === 32;
        cursor++;
      }
      if (cursor === size) continue;
      const token = String.fromCharCode(...prefix.subarray(cursor, Math.min(size, cursor + 6)));
      if (token.startsWith('{')) trace.formatEvidence = 'json_object';
      else if (!indented && token.startsWith(':')) trace.formatEvidence = 'sse_comment';
      else if (!indented) {
        const fields = ['data:', 'event:', 'id:', 'retry:'];
        if (fields.some(field => token.startsWith(field))) trace.formatEvidence = 'sse_field';
        else if (fields.some(field => field.startsWith(token))) continue;
      }
      if (!trace.formatEvidence) break;
      trace.normalized = trace.formatEvidence === 'json_object' ? 'json' : 'sse';
      let index = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index++]);
            if (index === chunks.length) chunks.length = 0;
            return;
          }
          try {
            const next = await read();
            if (next.done) { release(); controller.close(); }
            else controller.enqueue(next.value);
          } catch (error) { release(); controller.error(error); }
        },
        cancel: release,
      }, { highWaterMark: 0 });
    }
    throw new AiError('invalid_output', undefined, { fieldPath: 'tavern.upstream.format' });
  } catch (error) { release(); throw error; }
}
