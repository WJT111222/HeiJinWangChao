import { AiError } from '../../services/ai/errors';
import type { AiMessage } from '../../services/ai/protocols';
import type { Sampling } from '../package';

export type GenerationType = 'normal' | 'regenerate' | 'continue';
export interface FunctionTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
}
export interface GenerationData extends Sampling {
  type: GenerationType;
  messages: AiMessage[];
  model: string;
  max_tokens?: number;
  stream: boolean;
  n: 1;
  enable_web_search: false;
  request_images: false;
  chat_completion_source: 'custom';
  custom_prompt_post_processing: '';
  tools?: FunctionTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  parallel_tool_calls?: boolean;
}
type Start = [GenerationType, { signal?: AbortSignal }, boolean];
interface Events {
  [event: string]: unknown[];
  generation_started: Start;
  GENERATION_AFTER_COMMANDS: Start;
  chat_completion_prompt_ready: [{ chat: AiMessage[]; dryRun: boolean }];
  generate_after_data: [{ prompt: AiMessage[] }, boolean];
  chat_completion_settings_ready: [GenerationData];
  generation_stopped: [];
  generation_ended: [number];
}
export const tavernEventTypes = { GENERATION_STARTED: 'generation_started', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATE_AFTER_DATA: 'generate_after_data', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready', GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped', CHAT_CHANGED: 'chat_id_changed', OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after' };
const knownEvents = new Set<string>(Object.values(tavernEventTypes));
export function tavernEventName(key: keyof Events) {
  if (typeof key !== 'string') return 'script_event';
  return knownEvents.has(key) ? key : key.startsWith('["script_button",') ? 'script_button' : 'script_event';
}

type Listener<K extends keyof Events> = (...args: Events[K]) => unknown;
interface ListenerRow {
  key: keyof Events;
  fn: Listener<never>;
  once: boolean;
  onError?: (error: unknown) => void;
}

function reportListenerError(row: ListenerRow, error: unknown) {
  try { row.onError?.(error); } catch { /* The diagnostic cannot replace the dispatch result. */ }
}

export class TavernEvents {
  private rows: ListenerRow[] = [];
  on<K extends keyof Events>(key: K, fn: Listener<K>, order?: 'first' | 'last' | 'once', onError?: ListenerRow['onError']) {
    if (order === 'first' || order === 'last') this.remove(key, fn);
    const row = { key, fn: fn as Listener<never>, once: order === 'once', onError };
    if (order === 'first') this.rows.unshift(row);
    else this.rows.push(row);
    return { stop: () => { this.rows = this.rows.filter(item => item !== row); } };
  }
  remove<K extends keyof Events>(key: K, fn: Listener<K>) {
    const index = this.rows.findIndex(item => item.key === key && item.fn === fn);
    if (index >= 0) this.rows.splice(index, 1);
  }
  private *listeners<K extends keyof Events>(key: K) {
    for (const row of this.rows.filter(item => item.key === key)) {
      if (row.once) {
        if (!this.rows.includes(row)) continue;
        this.rows = this.rows.filter(item => item !== row);
      }
      yield { row, fn: row.fn as Listener<K> };
    }
  }
  async emit<K extends keyof Events>(key: K, ...args: Events[K]) {
    for (const { row, fn } of this.listeners(key)) {
      try { await fn(...args); }
      catch (error) {
        reportListenerError(row, error);
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.' + tavernEventName(key) });
      }
    }
  }
  emitAndWait<K extends keyof Events>(key: K, ...args: Events[K]) {
    for (const { row, fn } of this.listeners(key)) {
      try {
        void Promise.resolve(fn(...args)).catch(error => {
          reportListenerError(row, error);
          if (!row.onError) console.warn('酒馆同步分派的异步监听失败', tavernEventName(key));
        });
      } catch (error) {
        reportListenerError(row, error);
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.' + tavernEventName(key) });
      }
    }
  }
}
type ToolDefinition = FunctionTool['function'] & { shouldRegister?: () => boolean | Promise<boolean> };
export class TavernTools {
  private definitions = new Map<string, ToolDefinition>();
  register(definition: ToolDefinition) { this.definitions.set(definition.name, definition); }
  unregister(name: string) { this.definitions.delete(name); }
  get tools() { return [...this.definitions.values()]; }
  async apply(data: GenerationData) {
    if (data.type === 'continue') return;
    const tools: FunctionTool[] = [];
    for (const definition of [...this.definitions.values()]) {
      if (definition.shouldRegister && !await definition.shouldRegister.call(definition)) continue;
      const { name, description, parameters, strict } = definition;
      tools.push({ type: 'function', function: { name, description, parameters, strict } });
    }
    if (tools.length) { data.tools = tools; data.tool_choice ??= 'auto'; }
  }
}
export const tavernEvents = new TavernEvents();
export const tavernTools = new TavernTools();
export async function promptReady(messages: readonly AiMessage[], dryRun: boolean) {
  const event = { chat: structuredClone([...messages]), dryRun };
  await tavernEvents.emit('chat_completion_prompt_ready', event);
  const data = { prompt: event.chat };
  await tavernEvents.emit('generate_after_data', data, dryRun);
  return data.prompt;
}
export async function tavernGeneration<T>(
  type: GenerationType, signal: AbortSignal | undefined, dryRun: boolean, chatLength: number, work: () => Promise<T>,
) {
  const options = { signal };
  const check = () => { if (signal?.aborted) throw new AiError('cancelled'); };
  let accepted = false;
  let cancel: (() => void) | undefined;
  const generate = async () => {
    check();
    await tavernEvents.emit('generation_started', type, options, dryRun);
    check();
    await tavernEvents.emit('GENERATION_AFTER_COMMANDS', type, options, dryRun);
    check();
    return work();
  };
  try {
    const abort = new Promise<never>((_, reject) => {
      cancel = () => reject(new AiError('cancelled'));
      signal?.addEventListener('abort', cancel, { once: true });
    });
    const result = await Promise.race([generate(), abort]);
    accepted = true;
    return result;
  } finally {
    if (cancel) signal?.removeEventListener('abort', cancel);
    // 这两个收尾通知不参与出站，监听失败不覆盖真实的生成结果。
    if (!dryRun) {
      if (signal?.aborted) void tavernEvents.emit('generation_stopped').catch(() => console.warn('酒馆停止监听失败'));
      void tavernEvents.emit('generation_ended', chatLength + Number(accepted)).catch(() => console.warn('酒馆结束监听失败'));
    }
  }
}
