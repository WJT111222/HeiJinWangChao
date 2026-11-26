import { isOpenAiCompatible } from './configuration';
import type { Protocol } from './configuration';
import { array, record, string } from './protocols';

export interface RawResponseObservation {
  text: string;
  order: 'events' | 'same-event' | 'unknown';
}

/** Display-only public values in their response field/array order. SSE events
 * remain atomic: multiple fields in one event do not imply generation timing. */
export function rawResponseObservation(value: unknown, protocol: Protocol, streaming = false): RawResponseObservation {
  const data = record(value);
  let parts: string[];
  if (isOpenAiCompatible(protocol)) {
    const choice = record(array(data.choices)[0]), message = record(streaming ? choice.delta : choice.message);
    parts = Object.entries(message).flatMap(([key, content]) => {
      if (key === 'content') return typeof content === 'string' ? [content] : array(content)
        .filter(part => record(part).type === 'text').map(part => string(record(part).text));
      return ['reasoning_content', 'reasoning', 'reasoning_text'].includes(key) && typeof content === 'string' ? [content] : [];
    });
  } else if (protocol === 'gemini') {
    parts = array(record(record(array(data.candidates)[0]).content).parts).map(part => string(record(part).text));
  } else if (!streaming) {
    parts = array(data.content).map(part => {
      const block = record(part);
      return block.type === 'text' ? string(block.text) : block.type === 'thinking' ? string(block.thinking) : '';
    });
  } else {
    const block = record(data.type === 'content_block_start' ? data.content_block : data.delta);
    parts = data.type === 'content_block_start' || data.type === 'content_block_delta'
      ? [block.type === 'text' || block.type === 'text_delta' ? string(block.text)
        : block.type === 'thinking' || block.type === 'thinking_delta' ? string(block.thinking) : ''] : [];
  }
  return { text: parts.join(''), order: !streaming ? 'unknown' : parts.filter(Boolean).length > 1 ? 'same-event' : 'events' };
}

export function geminiPartText(part: unknown): string {
  const block = record(part);
  return block.thought === true ? '' : string(block.text);
}

export function anthropicBlockText(part: unknown): string {
  const block = record(part);
  return block.type === 'text' ? string(block.text) : '';
}

/** Read-only text observation before finish/error validation or <think> extraction.
 * Never used as accepted output, never repairs or normalizes an envelope. */
export function responseContent(value: unknown, protocol: Protocol, streaming = false): string {
  const data = record(value);
  if (isOpenAiCompatible(protocol)) {
    const choice = record(array(data.choices)[0]);
    const content = record(streaming ? choice.delta : choice.message).content;
    return typeof content === 'string' ? content : array(content)
      .filter(part => record(part).type === 'text').map(part => string(record(part).text)).join('');
  }
  if (protocol === 'gemini') return array(record(record(array(data.candidates)[0]).content).parts)
    .map(geminiPartText).join('');
  if (!streaming) return array(data.content).map(anthropicBlockText).join('');
  if (data.type === 'content_block_start' && record(data.content_block).type === 'text')
    return string(record(data.content_block).text);
  return data.type === 'content_block_delta' && record(data.delta).type === 'text_delta'
    ? string(record(data.delta).text) : '';
}

/** A whitelist of shapes and public termination signals, never an arbitrary
 * provider object, error message, URL, signature or hidden reasoning block. */
export interface ResponseDiagnostics {
  transport?: 'json' | 'sse' | 'http';
  memorySseFailure?: import('./errors').AiErrorCode | 'unexpected_transport' | 'unknown';
  httpStatus?: number;
  tavern?: { timeline?: import('../../presets/tavern/timing').StoryTiming; calls: number; bytes: number; complete: boolean; upstreamStatus?: number; boundary?: string; upstreamFinish?: string;
    requestedStream?: boolean; contentType?: string | null; formatEvidence?: string; readerEof: boolean; readError: boolean; cancelled: boolean;
    rawFinish?: string; wrapperFormat?: string; wrapperBodyRead: boolean; restored: boolean;
    upstreamUsage?: import('./protocols').Usage; upstreamError?: string; normalized: string; wrapper: string };
  contentTypes?: string[];
  reasoningTypes?: string[];
  finishReasons?: string[];
  refusal?: boolean;
  filtered?: boolean;
  errorPresent?: boolean;
  structure?: { choices?: string; candidates?: string; content?: string; error?: string };
  complete?: boolean;
}
const valueType = (value: unknown) => value === undefined ? 'absent' : value === null ? 'null'
  : Array.isArray(value) ? 'array' : typeof value;
const finishes = new Set(['stop', 'end_turn', 'stop_sequence', 'eos', 'eos_token', 'length', 'max_tokens',
  'content_filter', 'sensitive', 'safety', 'refusal', 'prohibited_content', 'blocklist', 'spii', 'recitation', 'image_safety']);
const filters = new Set(['content_filter', 'sensitive', 'safety', 'prohibited_content', 'blocklist', 'spii', 'recitation', 'image_safety']);
export function responseDiagnostics(value: unknown, protocol: Protocol, streaming = false): ResponseDiagnostics {
  const data = record(value);
  let content: unknown[] = [], reasoning: unknown[] = [], reason: unknown, refusal = false, filtered = false;
  if (isOpenAiCompatible(protocol)) {
    const choice = record(array(data.choices)[0]), message = record(streaming ? choice.delta : choice.message);
    content = [message.content]; reasoning = ['reasoning_content', 'reasoning', 'reasoning_text'].map(key => message[key]);
    reason = choice.finish_reason; refusal = Boolean(message.refusal);
  } else if (protocol === 'gemini') {
    const candidate = record(array(data.candidates)[0]);
    for (const part of array(record(candidate.content).parts)) {
      const p = record(part); (p.thought === true ? reasoning : content).push(p.text);
    }
    reason = candidate.finishReason; filtered = Boolean(record(data.promptFeedback).blockReason);
  } else {
    const blocks = streaming ? [record(data.type === 'content_block_start' ? data.content_block : data.delta)] : array(data.content);
    for (const item of blocks) {
      const block = record(item);
      if (block.type === 'thinking' || block.type === 'thinking_delta') reasoning.push(block.thinking);
      else if (block.type === 'text' || block.type === 'text_delta') content.push(block.text);
      else if (block.type === 'refusal') refusal = true;
      else if (!streaming && block.type !== 'redacted_thinking') content.push(item);
    }
    reason = streaming ? record(data.delta).stop_reason : data.stop_reason;
  }
  const finish = typeof reason === 'string' ? reason.toLowerCase() : undefined;
  const error = record(data.error);
  // Only named codes are interpreted. Arbitrary provider prose is never shown.
  const codes = [finish, error.code, error.type].filter((v): v is string => typeof v === 'string');
  return {
    transport: streaming ? 'sse' : 'json',
    contentTypes: [...new Set((content.length ? content : [undefined]).map(valueType))],
    reasoningTypes: [...new Set((reasoning.length ? reasoning : [undefined]).map(valueType))],
    ...(reason == null || reason === '' ? {} : { finishReasons: [finish && finishes.has(finish) ? String(reason) : 'unrecognized'] }),
    refusal: refusal || codes.includes('refusal'), filtered: filtered || codes.some(code => filters.has(code)),
    errorPresent: Boolean(data.error || data.type === 'error'),
    structure: Object.fromEntries(['choices', 'candidates', 'content', 'error'].filter(key => Object.hasOwn(data, key)).map(key => [key, valueType(data[key])])),
  };
}

/** Bounded aggregate; an empty SSE usage event must not erase earlier evidence. */
export function mergeResponseDiagnostics(previous: ResponseDiagnostics, next: ResponseDiagnostics): ResponseDiagnostics {
  const union = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, 24);
  return { ...previous, ...next, contentTypes: union(previous.contentTypes, next.contentTypes),
    reasoningTypes: union(previous.reasoningTypes, next.reasoningTypes), finishReasons: union(previous.finishReasons, next.finishReasons),
    refusal: previous.refusal || next.refusal, filtered: previous.filtered || next.filtered,
    errorPresent: previous.errorPresent || next.errorPresent, structure: { ...previous.structure, ...next.structure } };
}
