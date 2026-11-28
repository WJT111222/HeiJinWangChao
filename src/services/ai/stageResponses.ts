import { redactInspection } from './inspection';
import { safeAiError } from './errors';
import type { AiStage, AiTask, Protocol } from './configuration';
import { freeze } from './snapshot';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';

import type { MemoryDiagnostic } from '../../domain/memories/diagnostics';
import type { SummaryKind } from '../../domain/memories/configuration';
import type { TurnDraft } from '../../domain/drafts';

export const responseLimits = { text: 8_000_000, nativeReasoning: 2_000_000, displayText: 10_000_000, normalized: 8_000_000, diagnostics: 16_000 } as const;
// Candidate raw output is a diagnostic preview, never the parser input.
export const candidateResponseLimits = { text: 256_000, nativeReasoning: 64_000, displayText: 0, normalized: 256_000, diagnostics: 16_000 } as const;
export const responseStoreBudget = 32_000_000;
export const responseLimitsFor = (stage: AiTask) => stage === 'story' ? responseLimits : candidateResponseLimits;
export function responseSize(record: StageResponse) {
  return (record.text?.length ?? 0) + (record.nativeReasoning?.length ?? 0) + (record.displayText?.length ?? 0)
    + (record.normalized?.length ?? 0) + (record.diagnostics ? JSON.stringify(record.diagnostics).length : 0);
}
export interface StageResponse {
  id: string; saveId: string; turnId?: string; storyRevision?: number; stage: AiTask;
  memoryTask?: SummaryKind;
  memoryDiagnostic?: MemoryDiagnostic;
  /** Ledger join key used only in the local response cache. */
  memoryRetryId?: string;
  model?: string;
  requestedAt?: string;
  baseSaveRevision?: number; draftRevision?: number; executionRevision?: number; stageRequestRevision?: number;
  basedOnEntityRevision?: number;
  basedOnVariableRevision?: number;
  diagnostics?: ResponseDiagnostics;
  validationEndMs?: number;
  draftSavedMs?: number;
  storyValidated?: boolean;
  candidateSaved?: boolean;
  failureLayer?: 'request' | 'upstream' | 'wrapper' | 'story_validation' | 'draft';
  truncated?: boolean;
  status: 'pending' | 'received' | 'validated' | 'failed';
  text?: string; normalized?: string; error?: ReturnType<typeof safeAiError>;
  protocol?: Protocol;
  /** Only actual independent provider fields, never extracted project <thinking>. */
  nativeReasoning?: string;
  /** Single display transcript only; text remains the untouched model content. */
  displayText?: string;
  displayOrder?: RawResponseObservation['order'];
  /** 程序在校验时对模型输出做的处理说明（如忽略与变量阶段重复的字段），只在本页诊断展示。 */
  notes?: readonly string[];
}
// 保留字符串布局；此函数仅隐藏凭证，展示容量由 Store 单独限制。
export function safeResponseText(text: string, secrets: readonly string[]) {
  return redactInspection(text, secrets)
    .replace(/("(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[凭证已隐藏]"')
    .replace(/\b((?:authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token)\s*[=:]\s*)[^\s,;<>]+/gi, '$1[凭证已隐藏]');
}
// While a response is incomplete, do not expose a known credential one prefix at a time.
export function safeStreamResponseText(text: string, secrets: readonly string[]) {
  const safe = safeResponseText(text, secrets);
  let tail = 0;
  for (const secret of secrets.filter(Boolean)) {
    for (const value of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      for (let n = Math.min(value.length - 1, safe.length); n > tail; n--) {
        if (safe.endsWith(value.slice(0, n))) { tail = n; break; }
      }
    }
  }
  return tail ? safe.slice(0, -tail) + '[凭证片段已隐藏]' : safe;
}
// 最近最多六次请求；超过总字符预算时更早淘汰最旧记录。Story 单次上限保留，候选预览另有限制。
// 没有 Storage/IndexedDB 或普通日志写入。
export class StageResponseStore {
  private epoch = 0;
  generation = () => this.epoch;
  private records: readonly StageResponse[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.records;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(records: readonly StageResponse[]) {
    const kept = [...records];
    let size = kept.reduce((total, item) => total + responseSize(item), 0);
    while (size > responseStoreBudget && kept.length > 1) size -= responseSize(kept.pop()!);
    this.records = kept; this.listeners.forEach(listener => listener());
  }
  clear = () => { this.epoch++; this.publish([]); };
  clearSave = (saveId: string) => { this.epoch++; this.publish(this.records.filter(item => item.saveId !== saveId)); };
  begin(scope: Pick<StageResponse, 'saveId' | 'turnId' | 'stage' | 'storyRevision' | 'protocol' | 'baseSaveRevision' | 'draftRevision' | 'executionRevision' | 'stageRequestRevision' | 'basedOnEntityRevision' | 'basedOnVariableRevision' | 'memoryTask' | 'memoryRetryId' | 'model' | 'requestedAt'>, generation = this.epoch) {
    const id = crypto.randomUUID();
    if (generation !== this.epoch) return id; // A cleared/unmounted request cannot resurrect its record.
    this.publish([freeze({ ...scope, id, status: 'pending' as const }), ...this.records].slice(0, 6));
    return id;
  }
  update(id: string, patch: Partial<Pick<StageResponse, 'text' | 'nativeReasoning' | 'displayText' | 'displayOrder' | 'normalized' | 'status' | 'error' | 'diagnostics' | 'truncated' | 'notes' | 'storyValidated' | 'candidateSaved' | 'failureLayer' | 'validationEndMs' | 'draftSavedMs' | 'memoryDiagnostic'>>, secrets: readonly string[]) {
    const current = this.records.find(item => item.id === id);
    if (!current) return;
    const limits = responseLimitsFor(current.stage);
    const safe = { ...patch };
    for (const field of ['text', 'nativeReasoning', 'displayText', 'normalized'] as const) {
      if (patch[field] === undefined) continue;
      // Bound work before redaction; partial credentials at the clipped edge are also hidden.
      const value = safeStreamResponseText(patch[field].slice(0, limits[field]), secrets);
      safe[field] = value.slice(0, limits[field]);
      if (patch[field].length > limits[field] || value.length > limits[field]) safe.truncated = true;
    }
    if (patch.notes) safe.notes = Object.freeze(patch.notes.slice(0, 20).map((note) => safeResponseText(note, secrets).slice(0, 600)));
    if (patch.diagnostics) {
      const text = safeResponseText(JSON.stringify(patch.diagnostics), secrets);
      if (text.length <= responseLimits.diagnostics) safe.diagnostics = JSON.parse(text) as ResponseDiagnostics;
      else { delete safe.diagnostics; safe.truncated = true; }
    }
    const next = { ...current, ...safe, truncated: current.truncated || safe.truncated };
    if ((Object.keys(next) as (keyof StageResponse)[]).every(key => key === 'diagnostics'
      ? JSON.stringify(next[key]) === JSON.stringify(current[key]) : next[key] === current[key])) return;
    this.publish(this.records.map(item => item.id === id ? freeze(next) : item));
  }
}
export const stageResponses = new StageResponseStore();

/** Draft revisions advance on candidate/failure saves. Match the actual request
 * basis instead; after commit the journal turn identifies the last response. */
export function selectStageResponse(records: readonly StageResponse[], saveId: string, turnId: string | undefined,
  stage: AiStage, draft?: TurnDraft | null) {
  return records.find(item => {
    if (item.saveId !== saveId || item.turnId !== turnId || item.stage !== stage) return false;
    if (!draft || draft.turnId !== turnId) return true;
    if (item.baseSaveRevision !== undefined && item.baseSaveRevision !== draft.baseSaveRevision) return false;
    if (stage === 'story') return item.storyRevision === undefined || item.storyRevision === draft.storyRevision
      || (item.status === 'validated' && item.storyRevision + 1 === draft.storyRevision);
    return (item.storyRevision === undefined || item.storyRevision === draft.storyRevision)
      && (item.stageRequestRevision === undefined || item.stageRequestRevision === draft.stageRequestRevisions[stage])
      && (stage === 'entities' || item.basedOnEntityRevision === draft.entities?.candidateRevision)
      && (stage !== 'world' || item.basedOnVariableRevision === draft.variables?.candidateRevision);
  });
}
