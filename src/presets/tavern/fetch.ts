import { AiError } from '../../services/ai/errors';

export const generationPath = '/api/backends/chat-completions/generate';
const attemptHeader = 'x-heijin-tavern-attempt';
type Handler = (request: Request) => Promise<Response>;
const pending = new Map<string, Handler>();
let original: typeof fetch | undefined;
export const nativeFetch: typeof fetch = (input, init) => original ? original(input, init) : globalThis.fetch(input, init);

function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const origin = globalThis.location?.origin ?? 'http://localhost';
  const url = new URL(input instanceof Request ? input.url : String(input), origin);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.origin !== origin || url.pathname !== generationPath || method.toUpperCase() !== 'POST')
    return nativeFetch(input, init);
  const request = new Request(input instanceof Request ? input : url, init);
  const id = request.headers.get(attemptHeader) ?? '';
  const handle = pending.get(id);
  if (!handle) return Promise.reject(new AiError('configuration', undefined, { fieldPath: 'tavern.attempt' }));
  pending.delete(id); // Claim before the first await, including concurrent calls from a wrapper.
  return handle(request);
}
export function installTavernFetch() {
  if (original) return;
  original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = dispatch;
}
export async function fetchGeneration(data: unknown, signal: AbortSignal, handle: Handler) {
  const id = crypto.randomUUID();
  signal.throwIfAborted();
  const release = () => { pending.delete(id); };
  signal.addEventListener('abort', release, { once: true });
  pending.set(id, handle);
  try {
    // Resolve the actual page function at send time. Outside a browser, the same dispatcher serves injected transports.
    const send = original ? globalThis.fetch.bind(globalThis) : dispatch;
    return await send(generationPath, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', [attemptHeader]: id }, body: JSON.stringify(data) });
  } finally { release(); signal.removeEventListener('abort', release); }
}
