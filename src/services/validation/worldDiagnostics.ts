import { z } from 'zod';
import { DataError } from '../../domain/common';
import { DomainCommandSchema } from '../../domain/commands';
import { AiError } from '../ai/errors';

export const worldRuleNames = {
  json: '世界响应不是合法JSON', schema: '世界输出字段缺失或类型不符',
  constraint: '世界命令未满足执行约束', command_structure: '命令类型或分组不符合世界协议',
  task_state: '任务状态、成果或执行时间不合法',
  task_plan: '任务必须提供 dueAt 或非空 completionCondition',
  memory_time_window: 'NPC 记忆记录时间必须位于正式起始时间与本轮投影停止时间之间',
  event_sources: '事件来源须包含当前回合、保留全部旧来源，且只能引用正式历史或当前回合',
  event_immutable: '事件类型或父子字段组合不合法，或既有起点、固定结束时间、完成条件被改写',
  actor_permission: '行动者或字段超出场外权限', event_plan: '事件规划字段不完整', event_time: '事件开始、预计或结案时间冲突',
  organization_initialization: 'World 新建组织的 relationHistory 必须为空，关系变化请使用独立关系命令',
  event_transition: '事件状态转换不合法', completion_conditions: '完成所需前置条件尚未满足',
  stage_due:'固定到期阶段尚未结案',stage_result:'阶段结案成果不完整',stage_early_write:'未到期阶段不能例行改写',stage_entry:'阶段入场承接记录不合法',
  due_event_unhandled: '到期事件未结案或未重新安排预计时间',
  event_entry: '事件入场安排或正文处理回执不合法', event_continuation: '事件承接计划或调整依据不合法',
  domain_state: '世界投影的数据引用或状态不合法',
  task_event_link: '任务与事件关联冲突：同一任务不能指向多个事件',
  task_event_reference: '关联的任务或事件不存在，不能自动创建',
  location_reference: '地点或父地点引用不存在', location_cycle: '地点父级引用形成循环',
  entity_id: '实体ID或稳定身份重复，请复用已有实体', actor_reference: '参与者引用不存在',
  event_reference: '引用的事件不存在', history_reference: '历史关联不存在、自引用、重复或因果关系成环',
  history_structure: '重大纪事字段超出结构上限', history_duplicate: '同一重大事实与类别已记录',
  history_source: '纪事来源回合不存在', history_event: '世界纪事归档依据与事件终态不符',
  scene_write_conflict: 'World不能重复覆盖本轮Variables已经写入的NPC字段',
  request_basis: '世界响应依赖的版本已失效', domain_modules: '世界命令缺少对应领域模块',
  secret_in_output: '输出含系统凭证，已阻止保存',
} as const;
export type WorldRule = keyof typeof worldRuleNames;
export const isWorldRule = (value: unknown): value is WorldRule => typeof value === 'string' && Object.hasOwn(worldRuleNames, value);
const fields = new Set(('eventKind parentEventId fixedEndAt chronicle category scope scopeText basis milestoneId time endTime precision date year month season from to narrative process results impacts nature supportingTurnIds relations entryId locationText state entities locations tasks events retiredEvents organizations parentId location actorRef linkedEventId fromTaskId worldCommands taskCommands eventCommands visibleHooks unresolved timeline recordedAt occurredAt occurredTimeText sourceTurnId sourceRef sourceText relatedEntryIds summary eventId event task type commandId evidence kind at outcome status reason result resultKnowledge facts reported suspected id title startAt estimatedEndAt resolvedAt resolutionText backgroundText goalText actorRefs linkedTaskIds prerequisites blockers visibility impact sourceTurnIds predecessorEventIds protagonistKnowledge worldUpdateTurnId continuation direction reason entry channel cue followup protagonistEntry queuedAt handledTurnId notice textEvidence npcId expectedRevision changes healthText locationId onScene activeGoals memory text knowledgeKind knowledgeSource createdAtGameTime affectedEntityRefs ownerRef saveId revision npc identityKey name memories knownInformation goals resolution handoff dueAt completionCondition layer addToKnownInformation organization organizationId relationText').split(' '));
export const safeWorldPath = (path: readonly PropertyKey[]) => path.map(part => typeof part === 'number' ? part : fields.has(String(part)) ? String(part) : 'field').join('.');
interface Scope { fieldPath?: string; commandIndex?: number; commandType?: string; worldRule?: WorldRule }
export function worldValidationError(error: unknown, scope: Scope = {}, raw?: unknown): AiError {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0], path = issue?.path ?? [];
    const integrityRule = issue?.code === 'custom' && isWorldRule(issue.params?.integrityRule) ? issue.params.integrityRule as WorldRule : undefined;
    const group = path[0], local = ['worldCommands', 'taskCommands', 'eventCommands'].includes(String(group)) && typeof path[1] === 'number' ? path[1] : undefined;
    const array = raw && typeof raw === 'object' && typeof group === 'string' && group in raw ? Reflect.get(raw, group) : undefined;
    const candidate: unknown = Array.isArray(array) && local !== undefined ? array[local] : undefined;
    const type = candidate && typeof candidate === 'object' && 'type' in candidate && DomainCommandSchema.options.some(option => option.shape.type.value === candidate.type) ? String(candidate.type) : scope.commandType;
    const time = path.some(part => ['startAt','estimatedEndAt','resolvedAt','dueAt','at','occurredAt'].includes(String(part)));
    const groups = ['worldCommands', 'taskCommands', 'eventCommands'];
    const offset = groups.slice(0, groups.indexOf(String(group))).reduce((n, key) => n + (raw && typeof raw === 'object' && Array.isArray(Reflect.get(raw, key)) ? Reflect.get(raw, key).length : 0), 0);
    return new AiError(integrityRule === 'event_time' || (time && issue?.code !== 'invalid_type') ? 'time_data' : integrityRule ? 'data_integrity' : 'schema_fields', undefined, { worldRule: integrityRule ?? 'schema', ...scope,
      fieldPath: [scope.fieldPath, safeWorldPath(path)].filter(Boolean).join('.'),
      ...(scope.commandIndex === undefined && local !== undefined ? { commandIndex: offset + local } : {}), ...(type ? { commandType: type } : {}) });
  }
  const original = error instanceof AiError ? error : undefined;
  const rule: WorldRule = original?.details?.worldRule ?? (error instanceof DataError
    ? error.code==='TASK_PLAN'?'task_plan':error.code==='EVENT_CONTEXT'?'event_immutable':error.code==='STAGE_DUE'?'stage_due':error.code==='STAGE_RESULT'?'stage_result':error.code==='STAGE_EARLY_WRITE'?'stage_early_write':error.code==='STAGE_ENTRY'?'stage_entry':/TIME|REVERSED/.test(error.code) ? 'event_time'
      : ['DUPLICATE_ID','DUPLICATE_NPC','NPC_IDENTITY','AMBIGUOUS_NPC'].includes(error.code) ? 'entity_id'
      : ['TASK_ACTOR','TERMINAL_TASK','DUPLICATE_HANDOFF','HANDOFF_IMMUTABLE'].includes(error.code) ? 'task_state'
      : ['TERMINAL_EVENT','EVENT_STATUS','EVENT_NOT_TERMINAL'].includes(error.code) ? 'event_transition' : 'domain_state'
    : original?.code === 'invalid_json' ? 'json' : original?.code === 'permission' ? 'actor_permission' : scope.worldRule ?? 'constraint');
  const field = original?.details?.fieldPath ?? (error instanceof DataError
    ? error.code === 'TASK_PLAN' && scope.commandType === 'SaveTask' ? 'task'
      : error.code === 'EVENT_CONTEXT' && scope.commandType === 'SaveEvent' ? 'event' : undefined : undefined);
  return new AiError((rule === 'event_time' || rule === 'memory_time_window') ? 'time_data' : original?.code ?? 'data_integrity', original?.status, {
    ...scope, ...original?.details, worldRule: rule,
    fieldPath: field && scope.fieldPath && !field.startsWith(scope.fieldPath) ? `${scope.fieldPath}.${field}` : field ?? scope.fieldPath,
    commandIndex: scope.commandIndex ?? original?.details?.commandIndex,
    commandType: scope.commandType ?? original?.details?.commandType,
  });
}

export function requireWorld(ok: unknown, code: 'invalid_output' | 'permission' = 'invalid_output', worldRule?: WorldRule, fieldPath?: string): asserts ok {
  if (!ok) throw new AiError(code, undefined, worldRule || fieldPath ? {worldRule, fieldPath} : undefined);
}
