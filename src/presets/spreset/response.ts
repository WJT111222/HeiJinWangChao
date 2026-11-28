import { readLiteraryResponse } from './readLiteraryResponse';
import type { Protocol } from '../../services/ai/configuration';
import type { RequestOptions } from '../../services/ai/client';

export function readPrototypeResponse(response: Response, protocol: Protocol, signal: AbortSignal,
  observer: Pick<RequestOptions, 'onRawTextDelta' | 'onNativeReasoningDelta' | 'onRawResponse'> = {}) {
  return readLiteraryResponse(response, protocol, signal, 'submit_scene', 'content', observer);
}
