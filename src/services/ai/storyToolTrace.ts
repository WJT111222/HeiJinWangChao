import type { Protocol } from './configuration';
import type { AiErrorCode } from './errors';
import type { ResponsePayloadEvent, ResponseSource } from './responseEvents';
import type { ToolOrderingSite, ToolFailureRule } from './storyToolContract';
import { STORY_OUTPUT_TOOL } from './storyToolContract';
import type { ToolResponseEvent } from './toolResponseEvents';

const finishReasons = new Set([
  'tool_calls', 'tool_use', 'stop', 'end_turn', 'stop_sequence', 'eos', 'eos_token', 'length', 'max_tokens',
  'content_filter', 'sensitive', 'safety', 'refusal', 'prohibited_content', 'blocklist', 'spii', 'recitation',
  'image_safety', 'malformed_function_call', 'unexpected_tool_call', 'other', 'pause_turn', 'model_context_window_exceeded',
]);
const providerEventNames = new Set([
  'message_start', 'message_delta', 'message_stop', 'content_block_start', 'content_block_delta', 'content_block_stop',
  'ping', 'error',
]);
const officialHosts: Record<Protocol, string> = {
  openai: 'api.openai.com', deepseek: 'api.deepseek.com', gemini: 'generativelanguage.googleapis.com', anthropic: 'api.anthropic.com',
};
const edgeSize = 32;

type Boundary = 'done-marker' | 'eof' | 'json-body';
type TraceEvent = {
  kind: 'sse-frame' | 'json-value' | 'provider-finish' | 'tolerated-provider-finish' | 'message-stop' | Boundary | ToolResponseEvent['type'];
  frame: number;
  ms: number;
  providerType?: string;
  reasoningPresent?: boolean;
  contentPresent?: boolean;
  toolCalls?: number;
  argumentsPresent?: boolean;
  toolIdentityPresent?: boolean;
  reason?: string;
  field?: ResponsePayloadEvent['finishField'];
  slot?: number;
  idPresent?: boolean;
  namePresent?: boolean;
  expectedName?: boolean;
  delivery?: 'delta' | 'snapshot';
  nonEmpty?: boolean;
  derivedFrom?: 'choice-finish' | 'content-block-stop' | 'complete-value';
};
type Milestones = {
  operationStartedMs: number | null;
  dispatchMs: number | null;
  httpMs: number | null;
  firstBodyChunkMs: number | null;
  firstSseFrameMs: number | null;
  firstToolEventMs: number | null;
  firstArgumentsMs: number | null;
  firstNonEmptyArgumentsMs: number | null;
  lastArgumentsMs: number | null;
  firstProviderFinishMs: number | null;
  lastFrameMs: number | null;
  lastToolEventMs: number | null;
  boundaryMs: number | null;
};
type Step = 'before-dispatch' | 'waiting-http' | 'waiting-body' | 'waiting-sse-frame'
  | 'reading-json' | 'waiting-tool' | 'receiving-tool' | 'waiting-boundary' | 'closing-response' | 'validating-carrier';
type Outcome = {
  code: AiErrorCode | 'received' | 'unknown';
  toolRule?: ToolFailureRule;
  orderingSite?: ToolOrderingSite;
};

export type StoryToolTrace = ReturnType<StoryToolTraceRecorder['seal']>;

/** A diagnostic fault never replaces a transport outcome or a validation error. */
export function observeToolTrace(observe: (() => void) | undefined) {
  try { observe?.(); } catch { /* Best-effort, no extra response consumption. */ }
}

export class StoryToolTraceRecorder {
  private readonly origin = performance.now();
  private readonly startedAt = new Date().toISOString();
  private closed = false;
  private frame = 0;
  private finishedTool = false;
  private validating = false;
  private lastWire: TraceEvent | undefined;
  private firstFinish: Pick<TraceEvent, 'frame' | 'reason' | 'field'> | null = null;
  private boundaryKind: Boundary | null = null;
  private httpStatus: number | null = null;
  private observedTransport: ResponseSource['transport'] | null = null;
  private readonly head: TraceEvent[] = [];
  private readonly tail: TraceEvent[] = [];
  private readonly counts: Partial<Record<TraceEvent['kind'], number>> = {};
  private droppedEvents = 0;
  private readonly ms: Milestones = {
    operationStartedMs: null, dispatchMs: null, httpMs: null, firstBodyChunkMs: null, firstSseFrameMs: null, firstToolEventMs: null,
    firstArgumentsMs: null, firstNonEmptyArgumentsMs: null, lastArgumentsMs: null, firstProviderFinishMs: null,
    lastFrameMs: null, lastToolEventMs: null, boundaryMs: null,
  };

  constructor(
    private readonly protocol: Protocol,
    private readonly model: string,
    private readonly endpointKind: 'official' | 'relay' | 'local',
    private readonly requestedStream: boolean,
    private readonly timeoutSeconds: number,
  ) {}

  static start(protocol: Protocol, model: string, url: string, stream: boolean, timeoutSeconds: number) {
    const target = new URL(url);
    const endpointKind = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ? 'local'
      : target.origin === `https://${officialHosts[protocol]}` ? 'official' : 'relay';
    // Configured IDs may contain arbitrary prose. Export only an identifier-shaped value.
    const safeModel = /^[a-z0-9][a-z0-9._:/@-]{0,199}$/i.test(model) && !model.includes('://') ? model : '[已隐藏]';
    return new StoryToolTraceRecorder(protocol, safeModel, endpointKind, stream, timeoutSeconds);
  }

  private elapsed() { return Math.round(performance.now() - this.origin); }

  private add(event: TraceEvent) {
    this.counts[event.kind] = (this.counts[event.kind] ?? 0) + 1;
    if (this.head.length < edgeSize) this.head.push(event);
    else if (this.tail.length < edgeSize) this.tail.push(event);
    else this.tail[(this.droppedEvents++ % edgeSize)] = event;
  }

  operationStarted() { if (!this.closed) this.ms.operationStartedMs = this.elapsed(); }

  dispatch() { if (!this.closed) this.ms.dispatchMs = this.elapsed(); }

  http(status: number) {
    if (this.closed) return;
    this.ms.httpMs = this.elapsed();
    this.httpStatus = status;
    this.observedTransport = 'http';
  }

  opened(transport: ResponseSource['transport']) {
    if (!this.closed) this.observedTransport = transport;
  }

  bodyChunk() {
    if (!this.closed) this.ms.firstBodyChunkMs ??= this.elapsed();
  }

  wireFrame(source: ResponseSource) {
    if (this.closed) return;
    this.frame = source.sequence;
    const ms = this.elapsed();
    this.ms.lastFrameMs = ms;
    if (source.transport === 'sse') this.ms.firstSseFrameMs ??= ms;
    this.lastWire = { kind: source.transport === 'sse' ? 'sse-frame' : 'json-value', frame: this.frame, ms };
    this.add(this.lastWire);
  }

  payload(event: ResponsePayloadEvent, providerType: unknown, toolShape?: Pick<TraceEvent, 'toolCalls' | 'argumentsPresent' | 'toolIdentityPresent'>) {
    if (this.closed) return;
    if (this.lastWire) {
      if (typeof providerType === 'string' && providerEventNames.has(providerType)) this.lastWire.providerType = providerType;
      if (event.nativeReasoning) this.lastWire.reasoningPresent = true;
      if (event.rawText) this.lastWire.contentPresent = true;
      if (toolShape) Object.assign(this.lastWire, toolShape);
    }
    const raw = event.finishReason;
    const ms = this.elapsed();
    if (raw !== undefined && raw !== null && raw !== '') {
      this.ms.firstProviderFinishMs ??= ms;
      const reason = typeof raw === 'string' && raw.length <= 40 && finishReasons.has(raw.toLowerCase()) ? raw : 'unrecognized';
      const finish = { frame: event.source.sequence, reason, field: event.finishField };
      this.firstFinish ??= finish;
      this.add({ kind: 'provider-finish', ms, ...finish });
    }
    if (event.messageStop) this.add({ kind: 'message-stop', frame: event.source.sequence, ms });
  }

  tool(event: ToolResponseEvent) {
    if (this.closed) return;
    const ms = this.elapsed();
    this.ms.firstToolEventMs ??= ms;
    this.ms.lastToolEventMs = ms;
    const metadata: TraceEvent = { kind: event.type, frame: event.source.sequence, ms, slot: event.slot };
    if (event.type === 'tool-start' || event.type === 'tool-identity-delta') {
      metadata.idPresent = Boolean(event.callId);
      metadata.namePresent = Boolean(event.name);
      if (event.name !== undefined) metadata.expectedName = event.name === STORY_OUTPUT_TOOL;
    } else if (event.type === 'tool-arguments') {
      this.ms.firstArgumentsMs ??= ms;
      this.ms.lastArgumentsMs = ms;
      if (event.text) this.ms.firstNonEmptyArgumentsMs ??= ms;
      metadata.delivery = event.delivery;
      metadata.nonEmpty = Boolean(event.text);
    } else {
      metadata.derivedFrom = event.boundary;
    }
    this.add(metadata);
  }

  validatingCarrier() { if (!this.closed) this.validating = true; }

  acceptedToolEnd() { if (!this.closed) this.finishedTool = true; }

  toleratedProviderFinish(frame: number) {
    if (!this.closed) this.add({ kind: 'tolerated-provider-finish', frame, ms: this.elapsed() });
  }

  boundary(boundary: Boundary, frame: number) {
    if (this.closed) return;
    const ms = this.elapsed();
    this.ms.boundaryMs = ms;
    this.boundaryKind = boundary;
    this.add({ kind: boundary, frame, ms });
  }

  private step(): Step {
    if (this.ms.dispatchMs === null) return 'before-dispatch';
    if (this.ms.httpMs === null) return 'waiting-http';
    if (this.validating) return 'validating-carrier';
    if (this.boundaryKind !== null) return 'closing-response';
    if (this.observedTransport === 'json') return 'reading-json';
    if (this.ms.firstBodyChunkMs === null) return 'waiting-body';
    if (this.ms.firstSseFrameMs === null) return 'waiting-sse-frame';
    if (this.finishedTool && this.ms.firstProviderFinishMs !== null) return 'waiting-boundary';
    return this.ms.firstToolEventMs === null ? 'waiting-tool' : 'receiving-tool';
  }

  seal(outcome: Outcome) {
    this.closed = true;
    const tailStart = this.droppedEvents % edgeSize;
    return {
      version: 1 as const, startedAt: this.startedAt, protocol: this.protocol, model: this.model, endpointKind: this.endpointKind,
      requestedStream: this.requestedStream, observedTransport: this.observedTransport, timeoutSeconds: this.timeoutSeconds,
      httpStatus: this.httpStatus,
      ...this.ms,
      totalMs: this.elapsed(), boundary: this.boundaryKind, firstProviderFinish: this.firstFinish,
      outcome: { ...outcome, frame: this.frame, step: outcome.code === 'received' ? null : this.step() },
      counts: { ...this.counts }, omittedEvents: this.droppedEvents,
      events: [...this.head, ...this.tail.slice(tailStart), ...this.tail.slice(0, tailStart)],
    };
  }
}
