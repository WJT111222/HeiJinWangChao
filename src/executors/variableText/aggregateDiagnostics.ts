import { z } from 'zod';
import { DataError } from '../../domain/common';
import type { ExecutionDiagnostic } from './diagnostics';

// 固定代码词典，不把异常消息、Zod路径、实体ID、自由文本或非法数据带出模拟器。
export const domainRuleNames = {
  npc_scene_location: '在场 NPC 与主角的地点不一致',
  missing_location: '所引用地点不存在',
  missing_actor: '人物或组织引用不存在',
  missing_reference: '命令引用的实体不存在',
  duplicate_entity_id: '实体 ID 重复',
  duplicate_npc_identity: 'NPC 身份重复或与历史身份冲突',
  npc_kind: 'NPC 类型不允许该操作',
  npc_task_ownership: 'NPC 或组织任务归属不一致',
  scene_transition: '主角移动时缺少原在场 NPC 的状态更新',
  scene_location: '在场 NPC 缺少明确地点',
  equipment_ownership: '装备类别或归属不符合要求',
  task_event_links: '任务与事件的关联不一致',
  missing_completion_condition: '任务或事件缺少截止时间或完成条件',
  premature_result: '未完成任务或事件不能预填成果',
  illegal_transition: '任务或事件状态变更不合法',
  invalid_time: '游戏时间或事实发生时间不合法',
  invalid_balance: '资金余额或交易金额不合法',
  invalid_ownership: '资产或物品归属不合法',
  duplicate_memory: '记忆来源或身份发生冲突',
  invalid_memory_origin: '记忆来源、时间或认知类型不合法',
  revision_conflict: '草稿与存档版本不一致',
  invalid_relationship: '关系变更缺少必要依据',
  invalid_domain_state: '领域状态结构校验失败，无法进一步定位',
  multiple_domain_rules: '整批状态触发多个领域校验条件',
} as const;

export type DomainRule = keyof typeof domainRuleNames;
export function isDomainRule(value: unknown): value is DomainRule {
  return typeof value === 'string' && Object.hasOwn(domainRuleNames, value);
}

const dataErrors: Record<string, DomainRule> = {
  DUPLICATE_ID: 'duplicate_entity_id',
  DUPLICATE_NPC: 'duplicate_npc_identity',
  NPC_IDENTITY: 'duplicate_npc_identity',
  AMBIGUOUS_NPC: 'duplicate_npc_identity',
  NPC_KIND: 'npc_kind',
  SCENE_TRANSITION: 'scene_transition',
  SCENE_LOCATION: 'scene_location',
  OWNERSHIP: 'invalid_ownership',
  UNKNOWN_BALANCE: 'invalid_balance',
  INSUFFICIENT_FUNDS: 'invalid_balance',
  DEBT_AMOUNT: 'invalid_balance',
  SAME_ACCOUNT: 'invalid_balance',
  FUTURE_INCOME: 'invalid_time',
  TIME_REVERSED: 'invalid_time',
  NPC_TIME: 'invalid_time',
  OPENING_TIME: 'invalid_time',
  MEMORY_SOURCE: 'invalid_memory_origin',
  KNOWLEDGE_KIND: 'invalid_memory_origin',
  DUPLICATE_MEMORY: 'duplicate_memory',
  RELATION_REASON: 'invalid_relationship',
  TERMINAL_EVENT: 'illegal_transition',
  TERMINAL_TASK: 'illegal_transition',
  REVISION_CONFLICT: 'revision_conflict',
  ENTITY_CONFLICT: 'revision_conflict',
  NOT_FOUND: 'missing_reference',
};

// 只识别 GameStateSchema.superRefine 中的固定静态消息；
// 未知或带动态数据的消息不传播，统一退回一般领域校验。
const stateIssues: Record<string, DomainRule> = {
  '在场 NPC 与主角地点不一致': 'npc_scene_location',
  '地点引用不存在': 'missing_location',
  '参与者引用不存在': 'missing_actor',
  '实体 ID 必须在存档内全局唯一': 'duplicate_entity_id',
  'NPC 稳定身份重复': 'duplicate_npc_identity',
  'NPC 任务归属错误': 'npc_task_ownership',
  '在场 NPC 必须有明确地点': 'scene_location',
  '装备类别或物品归属错误': 'equipment_ownership',
  '载具引用归属错误': 'equipment_ownership',
  '事件关联任务错误': 'task_event_links',
  '任务关联事件错误': 'task_event_links',
  '任务缺少截止时间或完成条件': 'missing_completion_condition',
  '事件缺少预计结束时间或完成条件': 'missing_completion_condition',
  '未结案事件不能预存成果分类': 'premature_result',
  '未终结任务不能预存成果': 'premature_result',
  '任务成果时间在未来': 'invalid_time',
  '已完成事件缺少合法结案时间或结局': 'invalid_time',
  '初始同伴必须是特殊 NPC': 'npc_kind',
  '组织成员不存在': 'missing_actor',
  '组织任务归属错误': 'npc_task_ownership',
};

export function aggregateDomainDiagnostic(error: z.ZodError | DataError): ExecutionDiagnostic {
  let rule: DomainRule = 'invalid_domain_state';
  if (error instanceof DataError) {
    rule = dataErrors[error.code] ?? rule;
  } else {
    const distinct = new Set(error.issues.map((issue) =>
      Object.hasOwn(stateIssues, issue.message)
        ? stateIssues[issue.message] : 'invalid_domain_state',
    ));
    if (distinct.size === 1) rule = [...distinct][0];
    else if (distinct.size > 1) rule = 'multiple_domain_rules';
  }
  return { validationRule: 'domain_schema', domainRule: rule };
}
