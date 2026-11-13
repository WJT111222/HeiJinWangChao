import { AiError } from './errors';
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
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
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 8_000_000) throw new AiError('invalid_output');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = '';
          data = [];
        } else if (line.startsWith('event:')) event = line.slice(6).trimStart();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (chunk.done) {
        if (signal.aborted) throw new AiError('cancelled');
        // 部分服务在最后一条事件后直接断开，没有补空行；按完整事件交出，是否完整由调用方的结束标记判断。
        const line = buffer.replace(/\r$/, '');
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.trim() && !line.startsWith(':') && !line.startsWith('event:')) throw new AiError('stream_interrupted');
        if (data.length) yield { event, data: data.join('\n') };
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
