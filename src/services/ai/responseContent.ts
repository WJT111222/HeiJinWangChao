import { isOpenAiCompatible } from './configuration';
import type { Protocol } from './configuration';
import { array, record, string } from './protocols';

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
