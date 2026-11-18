import { isOpenAiCompatible } from './configuration';
import type { Protocol } from './configuration';
import type { AiResponseEvent, ResponsePayloadEvent } from './responseEvents';
import type { ToolResponseEvent } from './toolResponseEvents';
import { checkFinish } from './compat';
import { parseStoryToolArguments, STORY_OUTPUT_TOOL, STORY_TOOL_ARGUMENT_LIMIT, toolFailure, toolOrderingFailure } from './storyToolContract';

/** Request-local, single-carrier assembly. No execution, recovery heuristic,
 * partial acceptance, storage, callbacks or requests. */
export class StoryToolAssembler {
  private call: { slot: number; id: string; name: string; chunks: string[]; chars: number; snapshot: boolean; closed: boolean } | undefined;
  private providerFinish = false;
  private finishSequence: number | undefined;
  private finishEnvelope: readonly unknown[] | undefined;
  private messageStop = false;
  private transportEnd = false;
  private streaming = false;
  constructor(private readonly protocol: Protocol) {}
  response(event: ResponsePayloadEvent) {
    this.streaming = event.source.transport === 'sse';
    const afterFinish = this.finishSequence !== undefined && event.source.sequence > this.finishSequence;
    if (event.content.trim() || (afterFinish && event.openAiToolSse?.hasText)) throw toolFailure('mixed_text');
    if (afterFinish && event.nativeReasoning) throw toolOrderingFailure('reasoning_after_finish');
    if (event.messageStop) {
      if (this.messageStop) throw toolOrderingFailure('duplicate_message_stop');
      if (!this.call?.closed || !this.providerFinish) throw toolOrderingFailure('message_stop_before_required_boundaries');
      this.messageStop = true;
    }
    const reason = event.finishReason;
    if (reason === undefined || reason === null || reason === '') return;
    const expected = isOpenAiCompatible(this.protocol) ? 'tool_calls' : this.protocol === 'anthropic' ? 'tool_use' : 'STOP';
    if (reason !== expected) {
      // Keep real limit/filter errors; never pretend a tool stop is normal text.
      checkFinish(reason);
      throw toolFailure('finish');
    }
    if (this.providerFinish) {
      // Only an empty, later OpenAI-compatible SSE repetition is idempotent.
      // It cannot close a call or substitute for the transport boundary.
      const tail = event.openAiToolSse;
      if (!afterFinish || !this.call?.closed || !tail?.finishOnly
        || !this.finishEnvelope || !tail.envelope.every((value, i) => value === undefined || value === this.finishEnvelope?.[i])) {
        throw toolOrderingFailure('duplicate_provider_finish');
      }
      return true;
    }
    this.providerFinish = true; this.finishSequence = event.source.sequence;
    this.finishEnvelope = event.openAiToolSse?.envelope;
  }
  event(event: ToolResponseEvent) {
    if (this.messageStop) throw toolOrderingFailure('tool_event_after_message_stop');
    if (this.finishSequence !== undefined && event.source.sequence > this.finishSequence) throw toolOrderingFailure('tool_event_after_finish');
    if (event.type === 'tool-start') {
      if (this.call) throw toolFailure('multiple');
      if ((event.callId?.length ?? 0) > 512 || (event.name?.length ?? 0) > 512) throw toolFailure('identity');
      this.call = { slot: event.slot, id: event.callId ?? '', name: event.name ?? '', chunks: [], chars: 0, snapshot: false, closed: false };
      return;
    }
    const call = this.call;
    if (!call || call.slot !== event.slot || call.closed) throw toolOrderingFailure('missing_or_closed_slot');
    if (event.type === 'tool-identity-delta') {
      call.id += event.callId ?? ''; call.name += event.name ?? '';
      if (call.id.length > 512 || call.name.length > 512) throw toolFailure('identity');
    } else if (event.type === 'tool-arguments') {
      if (call.snapshot || (event.delivery === 'snapshot' && call.chunks.length)) throw toolOrderingFailure('snapshot_delta_conflict');
      call.snapshot = event.delivery === 'snapshot'; call.chars += event.text.length;
      if (call.chars > STORY_TOOL_ARGUMENT_LIMIT) throw toolFailure('arguments');
      if (event.text) {
        if (call.chunks.length >= 131072) throw toolFailure('arguments');
        call.chunks.push(event.text);
      }
    } else {
      if (call.name !== STORY_OUTPUT_TOOL) throw toolFailure('name');
      if ((this.protocol !== 'gemini' && !call.id) || (call.id && (call.id.length > 512 || call.id.trim() !== call.id || /[\p{C}\s]/u.test(call.id)))) throw toolFailure('identity');
      call.closed = true;
    }
  }
  boundary(event: Extract<AiResponseEvent, { type: 'end' }>) {
    // The boundary is observed, never created by this assembler.
    if (event.source.transport === 'json' && event.boundary === 'json-body') this.transportEnd = true;
    if (event.source.transport === 'sse' && (event.boundary === 'eof' || event.boundary === 'done-marker')) this.transportEnd = true;
  }
  complete(): string {
    if (!this.transportEnd || !this.providerFinish || !this.call?.closed || (this.protocol === 'anthropic' && this.streaming && !this.messageStop)) throw toolFailure('incomplete');
    // For Anthropic JSON the complete input is a snapshot; SSE still requires
    // actual message_stop even when it starts with a nonempty input snapshot.
    return parseStoryToolArguments(this.call.chunks.join(''));
  }
}
