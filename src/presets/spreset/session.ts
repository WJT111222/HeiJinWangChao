import isEqual from 'lodash/isEqual';
import { array, record } from '../../services/ai/protocols';
import { AiError } from '../../services/ai/errors';
import type { AiMessage } from '../../services/ai/protocols';
import type { RequestOptions } from '../../services/ai/client';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import type { PlayerWorldbook } from '../../prompts/playerWorldbook';
import { tavernWire } from '../tavern/wire';
import { readPrototypeResponse } from './response';

// The worker receives an auditable message contract. The host owns secrets, fetch and storage.
export class PrototypeSession {
  private readonly worker: Worker;
  constructor(private signal: AbortSignal) {
    signal.throwIfAborted();
    this.worker = new Worker('/experiments/spreset/worker.mjs', { type: 'module', name: 'spreset-c2' });
  }
  private run(operation: 'prepare' | 'finish', input: unknown) {
    this.signal.throwIfAborted();
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
        this.signal.removeEventListener('abort', cancel);
      };
      const cancel = () => { cleanup(); reject(new AiError('cancelled')); };
      const fail = () => { cleanup(); reject(new AiError('invalid_output', undefined, { fieldPath: 'tavern.spreset.processor' })); };
      this.worker.onerror = this.worker.onmessageerror = fail;
      this.worker.onmessage = ({ data }) => {
        if (!data || !Object.hasOwn(data, 'result')) return fail();
        cleanup(); resolve(data.result);
      };
      this.signal.addEventListener('abort', cancel, { once: true });
      try { this.worker.postMessage({ operation, input }); } catch { fail(); }
    });
  }
  async wire(snapshot: RequestSnapshot, messages: readonly AiMessage[], stream: boolean, worldbook?: PlayerWorldbook) {
    const input = { messages, stream, n: 1, chat_completion_source: 'custom', custom_prompt_post_processing: '' };
    const prepared = await this.run('prepare', input);
    const { tools, tool_choice, ...unchanged } = record(prepared);
    const declarations = array(tools);
    // C2 grants one declaration only. An altered history, budget or provider setting is a failure.
    if (!isEqual(input, unchanged) || tool_choice !== 'auto' || declarations.length !== 1
      || record(record(declarations[0]).function).name !== 'submit_scene') throw new AiError('unsupported');
    return tavernWire(snapshot, prepared, undefined, worldbook, 'channel');
  }
  async read(response: Response, snapshot: RequestSnapshot, observer: RequestOptions) {
    const upstream = await readPrototypeResponse(response, snapshot.channel.protocol, this.signal, observer);
    const finished = await this.run('finish', { text: upstream.text, call: upstream.call });
    if (!finished || typeof finished !== 'object' || !('output' in finished) || typeof finished.output !== 'string')
      throw new AiError('invalid_output');
    const receipt = record(finished).receipt;
    if (upstream.call ? !isEqual(receipt, { id: upstream.call.id, bytes: new TextEncoder().encode(finished.output).length }) : receipt !== null)
      throw new AiError('invalid_output');
    const args = upstream.call?.args as { content?: string } | undefined;
    if (args?.content) {
      observer.onRawTextDelta?.(args.content);
      observer.onRawResponse?.({ text: args.content, order: 'events' });
    }
    return { ...upstream, text: finished.output };
  }
  dispose() { this.worker.terminate(); }
}
