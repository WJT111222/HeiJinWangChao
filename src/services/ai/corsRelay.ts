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
export type ContinuationRoute = 'direct' | 'relay';
export interface ConfirmedTransmission {
  readonly route: ContinuationRoute;
  readonly sent: boolean;
  dispatch(send: () => Promise<Response>, signal: AbortSignal): Promise<Response>;
}

function relayUrl(origin: string, target: string) {
  const relay = new URL('/api/ai-relay', origin);
  relay.searchParams.set('target', target);
  return relay.href;
}

export async function fetchWithRelay(
  send: typeof fetch,
  url: string,
  init: RequestInit,
  attempt: ReturnType<typeof relayAttempt>,
  confirmed?: { transmission: ConfirmedTransmission; signal: AbortSignal },
) {
  const target = attempt.origin && relayTarget(url, attempt.origin, init.method ?? 'GET');
  // Each model-list page starts with its own direct request.
  attempt.used = false;
  attempt.eligible = Boolean(target);
  if (confirmed) {
    const { transmission, signal } = confirmed;
    let destination = url;
    if (transmission.route === 'relay') {
      if (!attempt.origin || !target)
        throw new AiError('configuration', undefined, { fieldPath: 'channel.confirmed_relay_unavailable' });
      destination = relayUrl(attempt.origin, url);
    }
    return transmission.dispatch(() => {
      attempt.used = transmission.route === 'relay';
      return send(destination, init);
    }, signal);
  }
  try {
    return await send(url, init);
  } catch (error) {
    if (!target || !attempt.origin || init.signal?.aborted || !networkFailure(error)) throw error;
  }
  attempt.used = true;
  try {
    return await send(relayUrl(attempt.origin, url), init);
  } catch {
    throw new AiError('network', undefined, { fieldPath: 'channel.relay' });
  }
}
