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
    .filter(part => record(part).thought !== true).map(part => string(record(part).text)).join('');
  if (!streaming) return array(data.content).filter(part => record(part).type === 'text')
    .map(part => string(record(part).text)).join('');
  if (data.type === 'content_block_start' && record(data.content_block).type === 'text')
    return string(record(data.content_block).text);
  return data.type === 'content_block_delta' && record(data.delta).type === 'text_delta'
    ? string(record(data.delta).text) : '';
}
