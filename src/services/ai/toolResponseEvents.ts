import { array, record } from './protocols';
import { isOpenAiCompatible } from './configuration';
import type { ResponseSource } from './responseEvents';
import { toolFailure, toolOrderingFailure } from './storyToolContract';

export type ToolResponseEvent =
  | { readonly type: 'tool-start'; readonly source: ResponseSource; readonly slot: number; readonly callId?: string; readonly name?: string }
  | { readonly type: 'tool-identity-delta'; readonly source: ResponseSource; readonly slot: number; readonly callId?: string; readonly name?: string }
  | { readonly type: 'tool-arguments'; readonly source: ResponseSource; readonly slot: number; readonly text: string; readonly delivery: 'delta' | 'snapshot' }
  | { readonly type: 'tool-end'; readonly source: ResponseSource; readonly slot: number; readonly boundary: 'choice-finish' | 'content-block-stop' | 'complete-value' };
const index = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw toolFailure('identity');
  return value;
};
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw toolFailure('identity');
  return value;
}
function json(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw toolFailure('arguments');
  try { return JSON.stringify(value); } catch { throw toolFailure('arguments'); }
}
/** Native fields only. Does not guess IDs, decode escaped fragments, repair JSON,
 * choose a longest call or emit a tool end at transport EOF. */
export class ToolEventProjector {
  private open = new Set<number>();
  private closed = new Set<number>();
  project(value: unknown, source: ResponseSource): ToolResponseEvent[] {
    const data = record(value), events: ToolResponseEvent[] = [], stream = source.transport === 'sse';
    const start = (slot: number, callId?: string, name?: string) => {
      if (this.open.has(slot) || this.closed.has(slot)) throw toolOrderingFailure('projector_reopened_slot');
      this.open.add(slot); events.push({ type: 'tool-start', source, slot, callId, name });
    };
    const args = (slot: number, text: string, delivery: 'delta' | 'snapshot') => {
      if (!this.open.has(slot)) throw toolOrderingFailure('projector_arguments_without_open_slot');
      events.push({ type: 'tool-arguments', source, slot, text, delivery });
    };
    const end = (slot: number, boundary: 'choice-finish' | 'content-block-stop' | 'complete-value') => {
      if (!this.open.delete(slot)) throw toolOrderingFailure('projector_end_without_open_slot');
      this.closed.add(slot); events.push({ type: 'tool-end', source, slot, boundary });
    };
    if (isOpenAiCompatible(source.protocol)) {
      const choices = array(data.choices);
      if (choices.length > 1) throw toolFailure('multiple');
      for (const c of choices) {
        const choice = record(c);
        if (choice.index !== undefined && choice.index !== 0) throw toolFailure('identity');
        const message = record(stream ? choice.delta : choice.message);
        if (message.function_call !== undefined) throw toolFailure('unsupported_shape');
        if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw toolFailure('unsupported_shape');
        const slots = new Set<number>();
        for (const [position, raw] of array(message.tool_calls).entries()) {
          const call = record(raw), fn = record(call.function), slot = stream ? index(call.index) : position;
          if (stream && slot !== 0) throw toolFailure('identity');
          if (slots.has(slot)) throw toolFailure('multiple');
          slots.add(slot);
          if (call.type !== undefined && call.type !== 'function') throw toolFailure('unsupported_shape');
          if (!stream && call.type !== 'function') throw toolFailure('unsupported_shape');
          const callId = optionalString(call.id), name = optionalString(fn.name);
          if (!this.open.has(slot)) start(slot, callId, name);
          else if (callId !== undefined || name !== undefined) events.push({ type: 'tool-identity-delta', source, slot, callId, name });
          if (fn.arguments !== undefined) {
            if (typeof fn.arguments !== 'string') throw toolFailure('arguments');
            args(slot, fn.arguments, stream ? 'delta' : 'snapshot');
          }
          if (!stream) end(slot, 'complete-value');
        }
        if (stream && choice.finish_reason === 'tool_calls') for (const slot of [...this.open]) end(slot, 'choice-finish');
      }
    } else if (source.protocol === 'anthropic') {
      if (!stream) {
        for (const [slot, raw] of array(data.content).entries()) {
          const block = record(raw);
          if (block.type === 'tool_use') { start(slot, optionalString(block.id), optionalString(block.name)); args(slot, json(block.input), 'snapshot'); end(slot, 'complete-value'); }
          else if (block.type !== 'text' && block.type !== 'thinking' && block.type !== 'redacted_thinking') throw toolFailure('unsupported_shape');
        }
      } else if (data.type === 'content_block_start') {
        const block = record(data.content_block);
        if (block.type === 'tool_use') {
          const slot = index(data.index); start(slot, optionalString(block.id), optionalString(block.name));
          // Native streaming starts with an empty input placeholder. Nonempty
          // initial values are snapshots and cannot later be appended as deltas.
          const input = json(block.input);
          if (input !== '{}') args(slot, input, 'snapshot');
        } else if (block.type !== 'text' && block.type !== 'thinking' && block.type !== 'redacted_thinking') throw toolFailure('unsupported_shape');
      } else if (data.type === 'content_block_delta' && record(data.delta).type === 'input_json_delta') {
        const delta = record(data.delta);
        if (typeof delta.partial_json !== 'string') throw toolFailure('arguments');
        args(index(data.index), delta.partial_json, 'delta');
      } else if (data.type === 'content_block_stop') {
        const slot = index(data.index);
        if (this.closed.has(slot)) throw toolOrderingFailure('duplicate_content_block_stop');
        if (this.open.has(slot)) end(slot, 'content-block-stop');
      }
    } else {
      const candidates = array(data.candidates);
      if (candidates.length > 1) throw toolFailure('multiple');
      for (const raw of candidates) {
        const candidate = record(raw);
        if (candidate.index !== undefined && candidate.index !== 0) throw toolFailure('identity');
        for (const [slot, rawPart] of array(record(candidate.content).parts).entries()) {
          const part = record(rawPart);
          if (part.functionResponse !== undefined) throw toolFailure('unsupported_shape');
          if (part.functionCall !== undefined) {
            if (part.text !== undefined) throw toolFailure('unsupported_shape');
            const call = record(part.functionCall);
            if (Object.keys(call).some(key => !['name', 'args', 'id'].includes(key))) throw toolFailure('unsupported_shape');
            // Gemini's native complete functionCall does not require an ID;
            // candidate/part position is its actual protocol identity, not a fake ID.
            start(slot, optionalString(call.id), optionalString(call.name));
            args(slot, json(call.args), 'snapshot'); end(slot, 'complete-value');
          }
        }
      }
    }
    return events;
  }
}

/** Safe public argument observation, never formal accepted text. Structured
 * object inputs use JSON serialization, not a claim to original wire bytes. */
export function observedToolArguments(value: unknown, source: ResponseSource): string[] {
  const data = record(value), stream = source.transport === 'sse';
  const safeJson = (input: unknown) => {
    try { return input && typeof input === 'object' ? JSON.stringify(input) : ''; } catch { return ''; }
  };
  if (isOpenAiCompatible(source.protocol)) {
    const message = record(record(array(data.choices)[0])[stream ? 'delta' : 'message']);
    return array(message.tool_calls).map(call => record(record(call).function).arguments).filter((x): x is string => typeof x === 'string');
  }
  if (source.protocol === 'gemini') return array(record(record(array(data.candidates)[0]).content).parts)
    .filter(p => record(p).functionCall !== undefined).map(p => safeJson(record(record(p).functionCall).args));
  if (!stream) return array(data.content).filter(p => record(p).type === 'tool_use').map(p => safeJson(record(p).input));
  if (data.type === 'content_block_delta' && record(data.delta).type === 'input_json_delta') {
    const text = record(data.delta).partial_json; return typeof text === 'string' ? [text] : [];
  }
  if (data.type === 'content_block_start' && record(data.content_block).type === 'tool_use') {
    const input = safeJson(record(data.content_block).input); return input && input !== '{}' ? [input] : [];
  }
  return [];
}
