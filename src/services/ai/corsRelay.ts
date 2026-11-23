import { isOpenAiCompatible, type Protocol } from './configuration';
import { AiError } from './errors';
import { relayTarget } from './relayTarget';

const key = 'heijin.ai.corsRelay';
export function relayMode(): 'auto' | 'off' {
  try {
    return localStorage.getItem(key) === 'off' ? 'off' : 'auto';
  } catch {
    return 'off';
  }
}
export function setRelayMode(mode: 'auto' | 'off') {
  localStorage.setItem(key, mode);
}

function networkFailure(error: unknown) {
  if (
    !(error instanceof Error) ||
    ('status' in error && error.status) ||
    ('statusCode' in error && error.statusCode)
  )
    return false;
  return (
    ['TypeError', 'NetworkError'].includes(error.name) &&
    /failed to fetch|networkerror|network error|load failed|fetch failed/i.test(error.message)
  );
}

// Capture the preference for this operation, before the first transport.
export function relayAttempt(protocol: Protocol) {
  const location = globalThis.window?.location;
  const origin =
    location &&
    /^https?:$/.test(location.protocol) &&
    isOpenAiCompatible(protocol) &&
    relayMode() === 'auto'
      ? location.origin
      : undefined;
  return { origin, eligible: false, used: false };
}
export async function fetchWithRelay(
  send: typeof fetch,
  url: string,
  init: RequestInit,
  attempt: ReturnType<typeof relayAttempt>,
) {
  const target = attempt.origin && relayTarget(url, attempt.origin, init.method ?? 'GET');
  attempt.eligible = Boolean(target);
  try {
    return await send(url, init);
  } catch (error) {
    if (!target || !attempt.origin || init.signal?.aborted || !networkFailure(error)) throw error;
  }
  attempt.used = true;
  const relay = new URL('/api/ai-relay', attempt.origin);
  relay.searchParams.set('target', url);
  try {
    return await send(relay.href, init);
  } catch {
    throw new AiError('network', undefined, { fieldPath: 'channel.relay' });
  }
}
