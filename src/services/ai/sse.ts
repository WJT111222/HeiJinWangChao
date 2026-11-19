import { AiError } from './errors';
import { observeToolTrace } from './storyToolTrace';
import type { StoryToolTraceRecorder } from './storyToolTrace';

export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  trace?: Pick<StoryToolTraceRecorder, 'sseRead' | 'sseCount' | 'sseBuffer' | 'sseFailure'>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '',
    event = '',
    data: string[] = [];
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new AiError('cancelled');
      if (trace) observeToolTrace(() => trace.sseBuffer(buffer.length > 0, data.length > 0));
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (error) {
        if (trace && !signal.aborted) observeToolTrace(() => trace.sseFailure('reader_read'));
        throw error;
      }
      // Cancellation can also resolve a pending read with done=true.
      if (trace && !signal.aborted) observeToolTrace(() => trace.sseRead(chunk.done ? null : chunk.value.byteLength));
      try { buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }); }
      catch (error) {
        if (trace && !signal.aborted) observeToolTrace(() => trace.sseFailure(chunk.done ? 'utf8_eof' : 'utf8_chunk'));
        throw error;
      }
      if (buffer.length > 8_000_000) throw new AiError('invalid_output');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (!line) {
          if (trace) observeToolTrace(() => trace.sseCount('blankLines'));
          if (data.length) {
            if (trace) observeToolTrace(() => {
              trace.sseCount('delimitedDataEvents');
              trace.sseBuffer(buffer.length > 0, false);
            });
            yield { event, data: data.join('\n') };
          }
          event = '';
          data = [];
        } else if (line.startsWith('event:')) event = line.slice(6).trimStart();
        else if (line.startsWith('data:')) {
          if (trace) observeToolTrace(() => trace.sseCount('dataLines'));
          data.push(line.slice(5).replace(/^ /, ''));
        } else if (trace) observeToolTrace(() => trace.sseCount(line.startsWith(':') ? 'commentLines' : 'unrecognizedLines'));
      }
      if (chunk.done) {
        if (signal.aborted) throw new AiError('cancelled');
        // 部分服务在最后一条事件后直接断开，没有补空行；按完整事件交出，是否完整由调用方的结束标记判断。
        const line = buffer.replace(/\r$/, '');
        if (line.startsWith('data:')) {
          if (trace) observeToolTrace(() => trace.sseCount('dataLines'));
          data.push(line.slice(5).replace(/^ /, ''));
        } else if (line.startsWith(':')) {
          if (trace) observeToolTrace(() => trace.sseCount('commentLines'));
        } else if (line.trim() && !line.startsWith('event:')) {
          if (trace) {
            observeToolTrace(() => trace.sseFailure('unrecognized_eof_tail'));
            observeToolTrace(() => trace.sseCount('unrecognizedLines'));
            observeToolTrace(() => trace.sseBuffer(buffer.length > 0, data.length > 0));
          }
          throw new AiError('stream_interrupted');
        }
        if (trace) observeToolTrace(() => trace.sseBuffer(false, false));
        if (data.length) {
          if (trace) observeToolTrace(() => trace.sseCount('eofDataEvents'));
          yield { event, data: data.join('\n') };
        }
        break;
      }
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('stream_interrupted');
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
