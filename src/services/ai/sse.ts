import { AiError } from './errors';
// After a real OpenAI finish, continue consuming optional usage and any errors already in flight.
export const FINISH_TAIL_MS = 250;
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  options?: { utf8?: string; tail?: string; onComment?: () => void;
    tailDeadline?: () => number | undefined; onTail?: () => void; onBytes?: (length: number) => void;
    onEof?: () => void; onReadError?: () => void },
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '',
    event = '',
    data: string[] = [];
  let skipLineFeed = false;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new AiError('cancelled');
      const deadline = options?.tailDeadline?.();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let chunk: ReadableStreamReadResult<Uint8Array> | undefined;
      try {
        if (deadline === undefined) chunk = await reader.read();
        else {
          const remaining = deadline - performance.now();
          if (remaining > 0) chunk = await Promise.race([reader.read(), new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), remaining);
          })]);
        }
      } catch (error) { if (!signal.aborted) options?.onReadError?.(); throw error; }
      finally { clearTimeout(timer); }
      if (signal.aborted) throw new AiError('cancelled');
      if (!chunk) {
        try { decoder.decode(); } catch { throw new AiError('stream_interrupted'); }
        // A partial data/error frame cannot be silently discarded at the deadline.
        if (event || data.length || (buffer.trim() && !buffer.startsWith(':'))) throw new AiError('stream_interrupted');
        options?.onTail?.();
        break;
      }
      if (chunk.done) options?.onEof?.();
      else if (chunk.value.byteLength) options?.onBytes?.(chunk.value.byteLength);
      try { buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }); }
      catch { throw new AiError('stream_interrupted', undefined, options?.utf8 ? { fieldPath: options.utf8 } : undefined); }
      if (buffer.length > 8_000_000) throw new AiError('invalid_output');
      while (buffer.length) {
        if (skipLineFeed && buffer.startsWith('\n')) buffer = buffer.slice(1);
        skipLineFeed = false;
        const end = buffer.search(/[\r\n]/);
        if (end < 0) break;
        const line = buffer.slice(0, end);
        skipLineFeed = buffer[end] === '\r';
        buffer = buffer.slice(end + 1);
        if (!line) {
          // Some providers report failures with an event name and no data field.
          if (data.length || event === 'error') yield { event, data: data.join('\n') };
          event = '';
          data = [];
        } else if (line.startsWith(':')) options?.onComment?.();
        else if (line.startsWith('event:')) event = line.slice(6).trimStart();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (chunk.done) {
        if (signal.aborted) throw new AiError('cancelled');
        // 部分服务在最后一条事件后直接断开，没有补空行；按完整事件交出，是否完整由调用方的结束标记判断。
        const line = buffer.replace(/\r$/, '');
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).trimStart();
        else if (line.trim() && !line.startsWith(':')) throw new AiError('stream_interrupted', undefined, options?.tail ? { fieldPath: options.tail } : undefined);
        if (data.length || event === 'error') yield { event, data: data.join('\n') };
        break;
      }
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('stream_interrupted');
  } finally {
    signal.removeEventListener('abort', cancel);
    // A wrapper's cancel promise can wait for a sibling stream indefinitely.
    // Once iteration has ended, cleanup cannot supply more protocol evidence.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
