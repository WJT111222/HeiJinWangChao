import { DataError } from '../../domain/common';
import { safeAiError } from '../../services/ai/errors';
import type { AiStage } from '../../services/ai/configuration';

export type RuntimeLogStage = AiStage | 'workflow' | 'commit';
export type RuntimeLogKind = 'started' | 'completed' | 'failed' | 'cancelled';
export type RuntimeLogReporter = (stage: RuntimeLogStage, kind: RuntimeLogKind, failure?: unknown) => void;

export interface RuntimeLogEntry {
  id: number;
  timestamp: string;
  stage: RuntimeLogStage;
  kind: RuntimeLogKind;
  message: string;
  code?: string;
  httpStatus?: number;
  fieldPath?: string;
  commandIndex?: number;
  commandType?: string;
}

export const runtimeStageNames: Record<RuntimeLogStage, string> = {
  story: '正文生成',
  variables: '变量管理',
  world: '动态世界',
  workflow: '自动工作流',
  commit: '正式结算',
};

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
): RuntimeLogEntry {
  const label = runtimeStageNames[stage];
  const entry: RuntimeLogEntry = {
    id, timestamp: new Date().toISOString(), stage, kind,
    message: kind === 'started' ? `${label}已开始`
      : kind === 'completed' ? `${label}已完成`
      : kind === 'cancelled' ? `${label}已取消`
      : `${label}失败`,
  };
  if (kind !== 'failed') return entry;
  if (failure instanceof DataError && safeCommitCodes[failure.code]) {
    return { ...entry, code: failure.code, message: safeCommitCodes[failure.code] };
  }
  const safe = safeAiError(failure);
  const details = 'details' in safe ? safe.details : undefined;
  const status = 'status' in safe ? safe.status : undefined;
  const path = details?.fieldPath;
  const type = details?.commandType;
  return {
    ...entry, code: safe.code, message: safe.message.split(' 字段：')[0],
    ...(typeof status === 'number' && status >= 100 && status < 600
      ? { httpStatus: status } : {}),
    ...(path && /^[A-Za-z0-9_.]+$/.test(path) ? { fieldPath: path } : {}),
    ...(typeof details?.commandIndex === 'number' && details.commandIndex >= 0
      ? { commandIndex: details.commandIndex + 1 } : {}),
    ...(type && /^[A-Za-z0-9_]+$/.test(type) ? { commandType: type } : {}),
  };
}
