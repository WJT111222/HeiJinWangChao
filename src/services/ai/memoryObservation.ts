import { memoryDiagnosticSchema, memoryRecordCodes, MemoryValidationError } from '../../domain/memories/diagnostics';
import type { MemoryDiagnostic } from '../../domain/memories/diagnostics';
import type { SummaryKind } from '../../domain/memories/configuration';
import { aiErrorCodes, safeAiError } from './errors';
import { attachObservedRequest, safeFailureDiagnostic } from './failureDiagnostic';
import type { FailureDiagnostic } from './failureDiagnostic';
import type { RequestOptions } from './client';
import type { RequestSnapshot } from './snapshot';
import { mergeResponseDiagnostics } from './responseContent';
import type { ResponseDiagnostics } from './responseContent';
import { responseLimitsFor, safeStreamResponseText, stageResponses } from './stageResponses';

const summaryCodes = new Set([...aiErrorCodes, ...memoryRecordCodes, 'REVISION_CONFLICT', 'DRAFT_CONFLICT']);
const sourceCodes = new Set(['MEMORY_CONFLICT', 'NPC_MEMORY_CONFLICT', 'MEMORY_PERMISSION', 'MEMORY_SOURCE',
  'MEMORY_LEGACY_BATCH_MISMATCH']);
const timelineCodes = new Set(['MEMORY_TIMELINE_CHANGED', 'REVISION_CONFLICT', 'DRAFT_CONFLICT']);
const limits = responseLimitsFor('memory');

export function summaryFailureDetail(step: MemoryDiagnostic['step'], code: string, error: unknown): Pick<MemoryDiagnostic,
  'reason' | 'fieldPath' | 'expectedGroups' | 'actualGroups'> {
  if (error instanceof MemoryValidationError) return error.diagnostic;
  if (code === 'MEMORY_BUDGET') return { reason: 'input_budget' };
  if (sourceCodes.has(code)) return { reason: 'source_permission' };
  if (timelineCodes.has(code)) return { reason: 'timeline_conflict' };
  if (step === 'request') {
    if (code === 'timeout') return { reason: 'request_timeout' };
    if (code === 'stream_interrupted') return { reason: 'stream_interrupted' };
    if (code === 'unexpected_transport') return { reason: 'unexpected_transport' };
    if (code === 'empty') return { reason: 'empty_response' };
    if (code === 'output_limit') return { reason: 'output_truncated' };
    if (code === 'invalid_json') return { reason: 'invalid_json' };
    return { reason: 'request_failed' };
  }
  if (step === 'output') return { reason: code === 'invalid_output' ? 'source_permission' : 'field_value' };
  return { reason: step === 'save' ? 'save_failed' : 'preparation_failed' };
}

const failureDetails = new WeakMap<object, MemoryDiagnostic>();
export function observedMemoryFailure(error: unknown) {
  return typeof error === 'object' && error !== null ? failureDetails.get(error) : undefined;
}

export type MemoryFailureObservation = { diagnostic: MemoryDiagnostic; responseId?: string; request?: FailureDiagnostic };

export class MemoryObservation {
  private generation = stageResponses.generation();
  private requestedAt = new Date().toISOString();
  private model?: string;
  private protocol?: MemoryDiagnostic['protocol'];
  private text = '';
  private nativeReasoning = '';
  private outputLength = 0;
  private previewTruncated = false;
  private diagnostics: ResponseDiagnostics = {};
  private secrets: readonly string[] = [];
  id?: string;
  expectedGroups?: number;
  step: MemoryDiagnostic['step'] = 'preparation';
  constructor(private saveId: string, public task: SummaryKind) {}

  route(snapshot: RequestSnapshot, secrets: readonly string[], privateIds: readonly string[]) {
    this.secrets = secrets;
    this.protocol = snapshot.channel.protocol;
    this.model = memoryDiagnosticSchema.shape.model.safeParse(safeStreamResponseText(snapshot.model, [...secrets, ...privateIds])).data;
  }

  begin(retryId?: string): Pick<RequestOptions, 'onRawTextDelta' | 'onNativeReasoningDelta' | 'onResponseDiagnostics'> {
    this.step = 'request';
    this.requestedAt = new Date().toISOString();
    try {
      this.id = stageResponses.begin({ saveId: this.saveId, stage: 'memory', memoryTask: this.task,
        model: this.model, protocol: this.protocol, requestedAt: this.requestedAt, memoryRetryId: retryId }, this.generation);
    } catch { /* The optional response cache cannot block a paid request or its ledger. */ }
    return {
      onRawTextDelta: delta => {
        this.outputLength += delta.length;
        this.previewTruncated ||= this.outputLength > limits.text;
        this.text += delta.slice(0, Math.max(0, limits.text - this.text.length));
      },
      onNativeReasoningDelta: delta => {
        this.previewTruncated ||= this.nativeReasoning.length + delta.length > limits.nativeReasoning;
        this.nativeReasoning += delta.slice(0, Math.max(0, limits.nativeReasoning - this.nativeReasoning.length));
      },
      onResponseDiagnostics: diagnostic => { this.diagnostics = mergeResponseDiagnostics(this.diagnostics, diagnostic); },
    };
  }

  received(text: string) {
    this.step = 'output';
    if (!this.outputLength) {
      this.outputLength = text.length;
      this.text = text.slice(0, limits.text);
      this.previewTruncated ||= text.length > limits.text;
    }
    this.publish('received');
  }

  validated() { this.publish('validated'); }

  failed(code: string, error: unknown): MemoryFailureObservation {
    const safe = safeAiError(error);
    const cause = this.diagnostics.memorySseFailure ?? code;
    const detail = summaryFailureDetail(this.step, cause, error);
    const diagnostic: MemoryDiagnostic = {
      expectedGroups: this.expectedGroups, ...detail,
      task: this.task, step: this.step, code: summaryCodes.has(code) ? code : 'unknown',
      model: this.model, protocol: this.protocol, requestedAt: this.requestedAt,
      build: import.meta.env.VITE_FEEDBACK_BUILD,
      httpStatus: this.diagnostics.httpStatus ?? ('status' in safe ? safe.status : undefined),
      outputLength: this.diagnostics.httpStatus !== undefined || this.outputLength ? this.outputLength : undefined,
      outputTruncated: detail.reason === 'output_truncated' ? true : undefined,
    };
    if (typeof error === 'object' && error !== null) failureDetails.set(error, diagnostic);
    const phase = this.step === 'preparation' ? 'request_build' as const : this.step === 'save' ? 'candidate_save' as const : undefined;
    attachObservedRequest(error, {
      ...(this.model ? { model: this.model } : {}),
      ...(this.protocol ? { protocol: this.protocol } : {}),
      ...(this.diagnostics.httpStatus !== undefined || this.outputLength ? { contentChars: this.outputLength } : {}),
      ...(!this.previewTruncated ? { reasoningChars: this.nativeReasoning.length } : {}),
      ...(typeof this.diagnostics.errorPresent === 'boolean' ? { errorInBody: this.diagnostics.errorPresent } : {}),
      ...(this.diagnostics.httpStatus !== undefined ? { httpStatus: this.diagnostics.httpStatus } : {}),
      ...(phase ? { phase } : {}),
    }, this.secrets);
    this.publish('failed', diagnostic);
    const request = safeFailureDiagnostic(error);
    return { diagnostic, responseId: this.id, ...(request ? { request } : {}) };
  }

  private publish(status: 'received' | 'validated' | 'failed', memoryDiagnostic?: MemoryDiagnostic) {
    if (!this.id) return;
    try {
      stageResponses.update(this.id, { status, text: this.text, nativeReasoning: this.nativeReasoning,
        diagnostics: this.diagnostics, truncated: this.previewTruncated, memoryDiagnostic }, this.secrets);
    } catch { /* Keep the request, validation and ledger outcome independent of observers. */ }
  }
}
