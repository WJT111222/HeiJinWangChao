import { DataError } from './common';

/** Failure metadata only: never serialized into Story, TurnDraft or GameState. */
export const storyRuleNames = {
  structure_unrecognized: '正文输出结构无法识别，可检查本页临时模型原文',
  tag_missing: '缺少必需的结构标签', tag_unclosed: '结构标签未闭合', tag_order: '结构标签顺序错误',
  tag_nested: '区块内出现重复或嵌套的保留标签', tag_unexpected: '出现当前设置不允许的结构标签',
  planning_empty: '正文规划区块为空', narrative_short: '正文长度不足', summary_empty: '<短期记忆> 内容为空',
  guide_json: '<变量规划> 不是合法 JSON，解析失败', story_schema: '正文字段未通过 Schema 校验',
  actions_count: '行动选项数量不符合要求',
  opening_context: '待定开局时间与回合状态不一致', opening_protocol: '待定开局混用了普通回合时间声明',
  opening_missing: '缺少结构化开局时间', opening_duplicate: '结构化开局时间重复',
  opening_json: '开局时间不是合法 JSON', opening_format: '开局时间字段、格式或日历日期无效',
  opening_timezone: '开局时间必须使用中国标准时间 +08:00', opening_reversed: '开局结束时间早于开始时间',
  opening_year: '开局年份不是合法公历年份', time_preflight: '正文时间规划未通过现有时间预检，可检查本页临时模型原文',
  time_duplicate: '正文时间结果不唯一', time_invalid_or_reversed: '正文时间结果无效或早于回合起点',
  time_interrupt: '中断事件已失效或不符合当前触达时间条件', time_kind: '正文时间结果类型不受支持',
  retrospective_duplicate: '历史视角声明不唯一', retrospective_json: '历史视角声明不是合法 JSON',
  retrospective_schema: '历史视角声明字段不符合纯过去回顾的结构要求',
  retrospective_source: '历史视角缺少有效人物或玩家原请求的独立依据', retrospective_mixed: '过去回顾混入了当前时间推进',
  receipt_group: '事件回执必须属于 event 变量组', receipt_duplicate: '同一事件的回执重复',
  receipt_reference: '事件回执引用不存在或入场版本已过期', receipt_closed: '事件或入场已关闭，不能再次处理',
  receipt_repeated: '已呈现的事件入场不能再次呈现', receipt_evidence_empty: '事件回执说明为空',
  receipt_status: '事件回执 action 状态不合法',
  request_basis: '当前响应与草稿版本不一致', draft_conflict: '存档或草稿版本已变化，请重新读取后继续',
  credential_output: '模型输出包含凭证内容，已阻止保存；凭证不会显示',
} as const;
export type StoryRule = keyof typeof storyRuleNames;
export const storyTags = ['thinking', '正文', '短期记忆', '变量规划', '行动选项', 'think', 'judge'] as const;
export type StoryTag = typeof storyTags[number];
const issues = ['invalid_type', 'invalid_value', 'too_small', 'unrecognized_keys', 'invalid_format', 'constraint'] as const;
export interface StoryDiagnostic {
  storyRule: StoryRule; storyTag?: StoryTag; fieldPath?: string; guideIndex?: number;
  actualCount?: number; minimumCount?: number; maximumCount?: number;
  storyIssue?: typeof issues[number];
}
export const isStoryRule = (value: unknown): value is StoryRule => typeof value === 'string' && Object.hasOwn(storyRuleNames, value);
const fields = new Set(['narrative', 'summary', 'turnKind', 'variableGuide', 'group', 'subjectHint', 'observedFact',
  'textEvidence', 'eventInteraction', 'eventId', 'entryId', 'action', 'actionOptions', 'openingTime', 'startAt', 'endAt', 'field']);
export function storyFieldPath(path: readonly PropertyKey[]) {
  return path.map(part => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 ? part : fields.has(String(part)) ? part : 'field').join('.');
}
/** Allowlist at both the error and logging boundary; no Zod message, raw value, ID or arbitrary tag. */
export function safeStoryDiagnostic(value: Partial<StoryDiagnostic>): StoryDiagnostic {
  const result: StoryDiagnostic = { storyRule: isStoryRule(value.storyRule) ? value.storyRule : 'structure_unrecognized' };
  if (storyTags.includes(value.storyTag as StoryTag)) result.storyTag = value.storyTag;
  if (value.fieldPath && value.fieldPath.split('.').every(part => fields.has(part) || /^(0|[1-9]\d{0,8})$/.test(part))) result.fieldPath = value.fieldPath;
  for (const key of ['guideIndex', 'actualCount', 'minimumCount', 'maximumCount'] as const) {
    const count = value[key]; if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  if (issues.includes(value.storyIssue as typeof issues[number])) result.storyIssue = value.storyIssue;
  return result;
}
export function storyDiagnosticMessage(raw: StoryDiagnostic) {
  const d = safeStoryDiagnostic(raw);
  const counts = d.storyRule === 'narrative_short' && d.actualCount !== undefined && d.minimumCount !== undefined ? ` 实际：${d.actualCount} 字符；最低要求：${d.minimumCount} 字符（仅统计正文非空白 Unicode 字符）。`
    : d.storyRule === 'actions_count' && d.actualCount !== undefined && d.minimumCount !== undefined && d.maximumCount !== undefined ? ` 实际：${d.actualCount} 条；要求：${d.minimumCount}～${d.maximumCount} 条。` : '';
  return `正文生成失败：${storyRuleNames[d.storyRule]}。${d.storyTag ? ` 标签：<${d.storyTag}>。` : ''}${counts}`
    + (d.guideIndex === undefined ? '' : ` 变量规划第 ${d.guideIndex + 1} 项。`)
    + (d.storyIssue ? ` ${ { invalid_type: '字段值类型错误', invalid_value: '字段值不在允许范围', too_small: '必需内容为空或不足', unrecognized_keys: '存在不支持的字段（名称不公开）', invalid_format: '字段格式无效', constraint: '字段约束不满足' }[d.storyIssue]}。` : '')
    + (d.fieldPath ? ` 字段：${d.fieldPath}。` : '') + ' 本次正文未保存。';
}
export class StoryValidationError extends DataError {
  constructor(code: string, message: string, public readonly diagnostic: StoryDiagnostic) { super(code, message); }
}
// Annotates the existing condition without changing its code, message, truth test or transaction behavior.
export function requireStoryData(condition: unknown, code: string, message: string, diagnostic: StoryDiagnostic): asserts condition {
  if (!condition) throw new StoryValidationError(code, message, diagnostic);
}
