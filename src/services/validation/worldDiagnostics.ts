import { z } from 'zod';
import { DataError } from '../../domain/common';
import { DomainCommandSchema } from '../../domain/commands';
import { AiError } from '../ai/errors';

export const worldRuleNames = {
  json: '世界响应不是合法JSON', schema: '世界输出字段缺失或类型不符',
  constraint: '世界命令未满足执行约束', command_structure: '命令类型或分组不符合世界协议',
  task_state: '任务状态、成果或执行时间不合法',
  actor_permission: '行动者或字段超出场外权限', event_plan: '事件规划字段不完整', event_time: '事件开始、预计或结案时间冲突',
  organization_initialization: 'World 新建组织的 relationHistory 必须为空，关系变化请使用独立关系命令',
  event_transition: '事件状态转换不合法', completion_conditions: '完成所需前置条件尚未满足',
  due_event_unhandled: '到期事件未结案或未重新安排预计时间',
  event_entry: '事件入场安排或正文处理回执不合法', event_continuation: '事件承接计划或调整依据不合法',
  domain_state: '世界投影的数据引用或状态不合法',
  request_basis: '世界响应依赖的版本已失效', domain_modules: '世界命令缺少对应领域模块',
  secret_in_output: '输出含系统凭证，已阻止保存',
} as const;
export type WorldRule = keyof typeof worldRuleNames;
export const isWorldRule = (value: unknown): value is WorldRule => typeof value === 'string' && Object.hasOwn(worldRuleNames, value);
const fields = new Set(('worldCommands taskCommands eventCommands visibleHooks unresolved timeline recordedAt occurredAt occurredTimeText sourceTurnId sourceRef sourceText relatedEntryIds summary eventId event task type commandId evidence kind at outcome status reason result resultKnowledge facts reported suspected id title startAt estimatedEndAt resolvedAt resolutionText backgroundText goalText actorRefs linkedTaskIds prerequisites blockers visibility impact sourceTurnIds predecessorEventIds protagonistKnowledge worldUpdateTurnId continuation direction reason entry channel cue followup protagonistEntry queuedAt handledTurnId notice textEvidence npcId expectedRevision changes healthText locationId onScene activeGoals memory text knowledgeKind knowledgeSource createdAtGameTime affectedEntityRefs ownerRef saveId revision npc identityKey name memories knownInformation goals resolution handoff dueAt completionCondition layer addToKnownInformation organization organizationId relationText').split(' '));
export const safeWorldPath = (path: readonly PropertyKey[]) => path.map(part => typeof part === 'number' ? part : fields.has(String(part)) ? String(part) : 'field').join('.');
interface Scope { fieldPath?: string; commandIndex?: number; commandType?: string; worldRule?: WorldRule }
export function worldValidationError(error: unknown, scope: Scope = {}, raw?: unknown): AiError {
  if (error instanceof z.ZodError) {
    const path = error.issues[0]?.path ?? [];
    const group = path[0], local = ['worldCommands', 'taskCommands', 'eventCommands'].includes(String(group)) && typeof path[1] === 'number' ? path[1] : undefined;
    const array = raw && typeof raw === 'object' && typeof group === 'string' && group in raw ? Reflect.get(raw, group) : undefined;
    const candidate: unknown = Array.isArray(array) && local !== undefined ? array[local] : undefined;
    const type = candidate && typeof candidate === 'object' && 'type' in candidate && DomainCommandSchema.options.some(option => option.shape.type.value === candidate.type) ? String(candidate.type) : scope.commandType;
    const time = path.some(part => ['startAt','estimatedEndAt','resolvedAt','dueAt','at'].includes(String(part)));
    return new AiError(time && error.issues[0]?.code !== 'invalid_type' ? 'time_data' : 'schema_fields', undefined, { worldRule: 'schema', ...scope,
      fieldPath: [scope.fieldPath, safeWorldPath(path)].filter(Boolean).join('.'),
      ...(scope.commandIndex === undefined && local !== undefined ? { commandIndex: local } : {}), ...(type ? { commandType: type } : {}) });
  }
  const original = error instanceof AiError ? error : undefined;
  const rule: WorldRule = original?.details?.worldRule ?? (error instanceof DataError
    ? /TIME|REVERSED/.test(error.code) ? 'event_time' : 'domain_state'
    : original?.code === 'invalid_json' ? 'json' : original?.code === 'permission' ? 'actor_permission' : scope.worldRule ?? 'constraint');
  const field = original?.details?.fieldPath;
  return new AiError(rule === 'event_time' ? 'time_data' : original?.code ?? 'data_integrity', original?.status, {
    ...scope, ...original?.details, worldRule: rule,
    fieldPath: field && scope.fieldPath && !field.startsWith(scope.fieldPath) ? `${scope.fieldPath}.${field}` : field ?? scope.fieldPath,
    commandIndex: scope.commandIndex ?? original?.details?.commandIndex,
    commandType: scope.commandType ?? original?.details?.commandType,
  });
}

export function requireWorld(ok: unknown, code: 'invalid_output' | 'permission' = 'invalid_output', worldRule?: WorldRule): asserts ok {
  if (!ok) throw new AiError(code, undefined, worldRule ? {worldRule} : undefined);
}
