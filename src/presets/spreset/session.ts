import isEqual from 'lodash/isEqual';
import { array, record } from '../../services/ai/protocols';
import { AiError } from '../../services/ai/errors';
import type { AiMessage } from '../../services/ai/protocols';
import type { RequestOptions } from '../../services/ai/client';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import type { PlayerWorldbook } from '../../prompts/playerWorldbook';
import { tavernWire } from '../tavern/wire';
import { readPrototypeResponse } from './response';

// One private port per request. The host exposes no callable storage, DOM or network operations.
export class PrototypeSession {
  private readonly frame = document.createElement('iframe');
  private readonly channel = new MessageChannel();
  private readonly id = crypto.randomUUID();
  private sequence = 0;
  private closed = false;
  private rejectPending?: (error: AiError) => void;

  constructor(private signal: AbortSignal) {
    signal.throwIfAborted();
    const { frame, channel, id } = this;
    frame.hidden = true;
    frame.title = 'SPreset 实验处理器';
    frame.sandbox.add('allow-scripts');
    frame.src = '/experiments/spreset/sandbox.html#' + id;
    frame.addEventListener('load', () => {
      // Opaque targets require "*". The WindowProxy and single-use port identify this frame.
      if (!this.closed) frame.contentWindow?.postMessage({ bind: id }, '*', [channel.port2]);
    }, { once: true });
    signal.addEventListener('abort', this.dispose, { once: true });
    window.addEventListener('pagehide', this.dispose, { once: true });
    document.body.append(frame);
  }
  private run(operation: 'prepare' | 'finish', input: unknown) {
    this.signal.throwIfAborted();
    if (this.closed || this.rejectPending || this.sequence !== (operation === 'prepare' ? 0 : 1))
      throw new AiError('invalid_output');
    const sequence = ++this.sequence;
    const port = this.channel.port1;
    return new Promise<unknown>((resolve, reject) => {
      this.rejectPending = reject;
      const fail = () => {
        reject(new AiError('invalid_output', undefined, { fieldPath: 'tavern.spreset.processor' }));
        this.dispose();
      };
      port.onmessageerror = fail;
      port.onmessage = ({ data }) => {
        if (data?.session !== this.id || data.sequence !== sequence || !Object.hasOwn(data, 'result')) return fail();
        port.onmessage = port.onmessageerror = null;
        this.rejectPending = undefined;
        resolve(data.result);
      };
      try { port.postMessage({ session: this.id, sequence, operation, input }); } catch { fail(); }
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
  readonly dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener('abort', this.dispose);
    window.removeEventListener('pagehide', this.dispose);
    this.rejectPending?.(new AiError('cancelled'));
    this.rejectPending = undefined;
    this.channel.port1.onmessage = this.channel.port1.onmessageerror = null;
    this.channel.port1.close();
    this.channel.port2.close();
    this.frame.remove();
  };
}
