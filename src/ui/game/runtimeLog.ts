import { isStoryRule, safeStoryDiagnostic, storyDiagnosticMessage } from '../../domain/storyDiagnostics';
import type { StoryDiagnostic } from '../../domain/storyDiagnostics';
import { storyFailure } from '../../services/validation/storyDiagnostics';
import { DataError, IdSchema } from '../../domain/common';
import { variableFailure } from '../../services/validation/variableDiagnostics';
import { isVariableStep } from '../../services/ai/errors';
import type { VariableStep } from '../../services/ai/errors';
import { safeAiError } from '../../services/ai/errors';
import { isSafeVariablePath } from '../../executors/variableText/diagnostics';
import { isDomainRule } from '../../executors/variableText/aggregateDiagnostics';
import type { DomainRule } from '../../executors/variableText/aggregateDiagnostics';
import type { DiagnosticType, DiagnosticRule } from '../../executors/variableText/diagnostics';
import { memoryFailureReasons } from '../../domain/memories/diagnostics';
import type { MemoryDiagnostic } from '../../domain/memories/diagnostics';
import type { MemoryFailureObservation } from '../../services/ai/memoryObservation';
import { safeFailureDiagnostic } from '../../services/ai/failureDiagnostic';
import type { FailureDiagnostic } from '../../services/ai/failureDiagnostic';
import type { AiTask } from '../../services/ai/configuration';
import { eventEntryReasonNames, isEventEntryReason, isWorldRule } from '../../services/validation/worldDiagnostics';
import type { WorldRule } from '../../services/validation/worldDiagnostics';

export type RuntimeLogStage = AiTask | 'workflow' | 'commit';
export type RuntimeLogKind = 'started' | 'completed' | 'failed' | 'cancelled';
export type RuntimeLogReporter = (
  stage: RuntimeLogStage,
  kind: RuntimeLogKind,
  failure?: unknown,
  turnId?: string,
  options?: { retain?: boolean },
) => void;

/** Anonymous, page-local correlation tokens, never actual save/turn IDs or player text. */
export interface RuntimeLogScope { saveRef: string; turnRef: string }

export interface RuntimeLogEntry extends Partial<StoryDiagnostic> {
  id: number;
  timestamp: string;
  stage: RuntimeLogStage;
  kind: RuntimeLogKind;
  message: string;
  code?: string;
  scope?: RuntimeLogScope;
  httpStatus?: number;
  fieldPath?: string;
  commandIndex?: number;
  commandType?: string;
  relatedCommandIndices?: number[];
  valuePath?: string;
  expectedType?: DiagnosticType;
  actualType?: DiagnosticType;
  validationRule?: DiagnosticRule;
  domainRule?: DomainRule;
  /** 仅 scene_location 可携带经 IdSchema 校验的 NPC ID。 */
  relatedNpcId?: string;
  worldRule?: WorldRule;
  variableStep?: VariableStep;
  memory?: MemoryDiagnostic;
  memorySaveRef?: string;
  /** 自动重试中的失败在随后成功后仍留在日志和反馈材料里。 */
  retained?: boolean;
  /** 错误发生时摘下的脱敏诊断。原文缓存淘汰后仍然保留。 */
  diagnostic?: FailureDiagnostic;
}

export const runtimeStageNames: Record<RuntimeLogStage, string> = {
  story: '正文生成',
  variables: '变量管理',
  world: '动态世界',
  workflow: '自动工作流',
  commit: '正式结算',
  memory: '记忆总结',
};

const diagnosticTypes = new Set<DiagnosticType>([
  'string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'undefined',
]);
const diagnosticRules = new Set<DiagnosticRule>([
  'invalid_type', 'required_field', 'schema_constraint', 'value_constraint',
  'reserved_field', 'path_identity', 'domain_schema',
]);

const safeCommitCodes: Record<string, string> = {
  TURN_TIME_REQUIRED: '时间条件未满足，当前回合未正式结算。',
  MISSING_SUMMARY: '正文缺少有效摘要，当前回合未正式结算。',
  REVISION_CONFLICT: '正式存档版本发生冲突。',
  DRAFT_CONFLICT: '当前草稿已过期或被更新。',
};

// 只转换程序已经公开允许的安全字段，不接触原始响应、URL、密钥、模型正文或 NPC 私有状态。
// 不保存到 localStorage / IndexedDB；刷新页面即可清除。
export function runtimeLogEvent(
  id: number,
  stage: RuntimeLogStage,
  kind: RuntimeLogKind,
  failure?: unknown,
  scope?: RuntimeLogScope,
  options?: { retain?: boolean },
): RuntimeLogEntry {
  const label = runtimeStageNames[stage];
  const entry: RuntimeLogEntry = {
    id, timestamp: new Date().toISOString(), stage, kind,
    ...(scope ? { scope: { ...scope } } : {}),
    ...(options?.retain ? { retained: true } : {}),
    message: kind === 'started' ? `${label}已开始`
      : kind === 'completed' ? (stage === 'workflow' ? '本次自动执行已结束' : `${label}已完成`)
      : kind === 'cancelled' ? (stage === 'workflow' ? '已请求取消自动执行' : `${label}已取消`)
      : `${label}失败`,
  };
  if (kind !== 'failed') return entry;
  if (failure instanceof DataError && safeCommitCodes[failure.code]) {
    if (stage === 'story' && ['DRAFT_CONFLICT', 'REVISION_CONFLICT'].includes(failure.code)) {
      const diagnostic = { storyRule: 'draft_conflict' as const };
      return { ...entry, code: failure.code, ...diagnostic, message: storyDiagnosticMessage(diagnostic) };
    }
    return { ...entry, code: failure.code, message: safeCommitCodes[failure.code] };
  }
  const presented = stage === 'commit' ? variableFailure(failure, 'commit') : stage === 'variables' ? variableFailure(failure, 'context') : stage === 'story' ? storyFailure(failure, true) : failure;
  const safe = safeAiError(presented);
  const diagnostic = safeFailureDiagnostic(presented);
  if (safe.code === 'cancelled') return { ...entry, kind: 'cancelled', code: 'cancelled', message: `${label}已取消，未计入生成失败。` };
  const details = 'details' in safe ? safe.details : undefined;
  const status = 'status' in safe ? safe.status : undefined;
  const path = details?.fieldPath;
  const type = details?.commandType;
  const entryReason = details?.worldRule === 'event_entry' && isEventEntryReason(details.eventEntryReason)
    ? eventEntryReasonNames[details.eventEntryReason] : undefined;
  return {
    ...entry, code: safe.code, message: isStoryRule(details?.storyRule) ? safe.message : safe.message.split(' 字段：')[0] + (entryReason ? ` ${entryReason}。` : ''),
    ...(isStoryRule(details?.storyRule) ? safeStoryDiagnostic(details) : {}),
    ...(typeof status === 'number' && status >= 100 && status < 600
      ? { httpStatus: status } : {}),
    ...(path && /^[A-Za-z0-9_.]+$/.test(path) ? { fieldPath: path } : {}),
    ...(typeof details?.commandIndex === 'number' && details.commandIndex >= 0
      ? { commandIndex: details.commandIndex + 1 } : {}),
    ...(type && /^[A-Za-z0-9_]+$/.test(type) ? { commandType: type } : {}),
    ...(details?.valuePath && isSafeVariablePath(details.valuePath) ? { valuePath: details.valuePath } : {}),
    ...(details?.expectedType && diagnosticTypes.has(details.expectedType) ? { expectedType: details.expectedType } : {}),
    ...(details?.actualType && diagnosticTypes.has(details.actualType) ? { actualType: details.actualType } : {}),
    ...(details?.validationRule && diagnosticRules.has(details.validationRule) ? { validationRule: details.validationRule } : {}),
    ...(isDomainRule(details?.domainRule) ? { domainRule: details.domainRule } : {}),
    ...(details?.relatedNpcId &&
      details.domainRule === 'scene_location' &&
      IdSchema.safeParse(details.relatedNpcId).success
      ? { relatedNpcId: details.relatedNpcId } : {}),
    ...(isWorldRule(details?.worldRule) ? { worldRule: details.worldRule } : {}),
    ...(isVariableStep(details?.variableStep) ? { variableStep: details.variableStep } : {}),
    ...(details?.relatedCommandIndices?.length
      ? { relatedCommandIndices: [...new Set(details.relatedCommandIndices
        .filter((index) => Number.isSafeInteger(index) && index > 0))].slice(0, 20) }
      : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}

export function memoryRuntimeLogEvent(id: number, saveRef: string, failure: MemoryFailureObservation): RuntimeLogEntry {
  const { diagnostic } = failure;
  return { id, stage: 'memory', kind: 'failed', memorySaveRef: saveRef,
    timestamp: diagnostic.requestedAt, code: diagnostic.code, message: memoryFailureReasons[diagnostic.reason], memory: diagnostic,
    ...(failure.request ? { diagnostic: failure.request } : {}) };
}

function sameLogScope(entry: RuntimeLogEntry, other: RuntimeLogEntry) {
  return Boolean(entry.scope && other.scope && entry.scope.saveRef === other.scope.saveRef && entry.scope.turnRef === other.scope.turnRef);
}

/** 同一次已经开始的自动重试成功后标成已恢复。必须改原对象，否则反馈原文的 WeakMap 对不上。 */
export function markRecoveredFailures(entries: readonly RuntimeLogEntry[], completed: RuntimeLogEntry) {
  if (completed.kind !== 'completed' || !completed.scope) return entries;
  const completedAt = entries.indexOf(completed);
  return entries.map((entry, index) => {
    const retry = entry.diagnostic?.retry;
    if (entry.kind !== 'failed' || !retry?.issued || retry.recovered || !sameLogScope(entry, completed)) return entry;
    if (!(completed.stage === entry.stage || completed.stage === 'workflow' || completed.stage === 'story')) return entry;
    const restarted = entries.some((later, laterIndex) => laterIndex > index && (completedAt < 0 || laterIndex < completedAt)
      && later.kind === 'started' && sameLogScope(later, entry)
      && (later.stage === entry.stage || later.stage === 'workflow' || later.stage === 'story'));
    if (restarted) return entry;
    retry.recovered = true;
    return entry;
  });
}

/** Retain session records in memory, but show only this turn's still-relevant events. */
export function currentRuntimeLogs(entries: readonly RuntimeLogEntry[], scope: RuntimeLogScope) {
  const scoped = entries.filter(e => e.stage === 'memory' ? e.memorySaveRef === scope.saveRef : e.scope?.saveRef === scope.saveRef && e.scope.turnRef === scope.turnRef);
  return scoped.filter((entry, index) => {
    if (entry.kind !== 'failed' || entry.stage === 'memory' || entry.retained) return true;
    return !scoped.slice(index + 1).some(later => later.kind === 'completed' &&
      (later.stage === entry.stage || later.stage === 'workflow' || later.stage === 'story'));
  });
}
