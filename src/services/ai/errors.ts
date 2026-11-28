import { withdrawnPresetNotice } from '../../presets/withdrawnPreset';
import { safeStoryDiagnostic, storyDiagnosticMessage } from '../../domain/storyDiagnostics';
import type { StoryDiagnostic } from '../../domain/storyDiagnostics';
import { DataError } from '../../domain/common';
import type { ExecutionDiagnostic } from '../../executors/variableText/diagnostics';
import type { EventEntryReason, WorldRule } from '../validation/worldDiagnostics';
import { domainRuleNames, isTimeDomainRule } from '../../executors/variableText/aggregateDiagnostics';
export const variableStepNames = {
  context: '构造变量上下文', load: '读取正式存档与草稿', draft_start: '保存变量请求版本',
  request: '请求变量模型', response: '读取完整模型响应', envelope: '解析三个标签区块',
  commands: '解析文本命令', mapping: '映射领域命令', simulation: '整批模拟与数据校验',
  candidate_save: '保存变量候选', commit: '正式回合原子结算',
} as const;
export type VariableStep = keyof typeof variableStepNames;
export const isVariableStep = (value: unknown): value is VariableStep => typeof value === 'string' && Object.hasOwn(variableStepNames, value);
export type AiErrorCode =
  | 'concurrency_unavailable'
  | 'storage'
  | 'variable_runtime'
  | 'configuration'
  | 'credentials'
  | 'authorization'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'rejected'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'empty'
  | 'output_limit'
  | 'stream_interrupted'
  | 'schema_fields'
  | 'data_integrity'
  | 'amount_balance'
  | 'time_data'
  | 'candidate_conflict'
  | 'invalid_json'
  | 'variable_text_syntax'
  | 'invalid_output'
  | 'unsupported'
  | 'resource'
  | 'placeholder'
  | 'permission'
  | 'event_entry'
  | 'time_preflight'
  | 'money_unit'
  | 'model_list_format'
  | 'model_list_pagination'
  | 'content_filter'
  | 'parameter_adjusted';
const messages: Record<AiErrorCode, string> = {
  concurrency_unavailable: '当前浏览器无法使用 Web Locks，不能安全确认其他标签页是否正在生成，已阻止重新绑定和模型请求；输入未清除。请使用支持 Web Locks 的浏览器并重新读取存档后主动发送。',
  storage: '浏览器存储读取或保存失败，未接受新的变量候选。请检查存储空间及权限后明确重试。',
  variable_runtime: '变量处理未完成，请查看处理步骤定位错误；合法正文及正式存档仍保留。',
  model_list_format: '模型列表返回格式不受支持，未读取到约定的模型数组。',
  model_list_pagination: '模型列表分页信息无效或不受支持，未能安全读取完整列表。',
  configuration: '渠道、模型或路由配置无效，请检查设置。',
  credentials: '此渠道尚未提供 API 密钥。',
  authorization: '服务返回授权错误，请核对密钥及账户权限。',
  not_found: '服务路径或模型不存在，请核对地址和模型 ID。',
  rate_limit: '服务请求受限，请稍后重试并检查账户额度。',
  server: '模型服务暂时不可用。',
  rejected: '服务拒绝了请求，请检查模型及参数支持情况。',
  network:
    '网络请求失败，可能涉及网络连接、CORS 或 TLS；浏览器无法据此判断密钥是否错误。请检查服务是否允许当前网页直连。',
  timeout: '请求超时，未提交任何游戏状态。',
  cancelled: '请求已取消，未提交任何游戏状态。',
  empty: '服务没有返回可用文本。',
  output_limit: '模型达到输出上限，规划、原生思考与正文可能共享预算；本次结果不完整且未保存。请检查最大输出 Token，程序不会自动提高付费上限或重发。',
  stream_interrupted: '流式响应未完整结束，不能作为有效结果。',
  schema_fields: '候选字段或类型不符合命令Schema，候选未保存。',
  data_integrity: '候选的实体引用、归属、数量或状态不合法，候选未保存。',
  amount_balance: '变量候选的金额、账户余额或债务数据不合法，候选未保存。',
  time_data: '候选日期无效、时间倒退或结构化时钟发生冲突，候选未保存。',
  candidate_conflict: '存档版本、命令或候选存在冲突，请重新读取后继续。',
  invalid_json: '响应不是完整合法的 JSON。',
  variable_text_syntax: '变量文本命令区块或JSON值格式不合法，候选未保存。',
  invalid_output: '模型输出未通过结构或状态校验，候选未被接受。',
  unsupported: '当前协议不支持此请求特性，请检查兼容配置。',
  resource: '提示词资源缺失或与注册校验值不符。',
  placeholder: '提示词缺少必需参数或仍有未解析占位符，已阻止发送。',
  permission: '候选超出本阶段允许的命令或对象范围。',
  event_entry: '正文遗漏或未正确处理待入场事件，候选未接受。请检查正文并明确重试；已保存的入场安排仍保留。',
  time_preflight: '时间预检与正文或变量停止时间不一致，候选未保存。请检查行动或重新生成正文。',
  money_unit: '候选金额与证据中的人民币元/分不一致。',
  content_filter: '模型服务的内容审核拦截了这次请求或输出，结果未保存。可以调整行动描述后重试，或换用审核更宽松的模型或服务。',
  parameter_adjusted: '服务明确拒绝了已发送的参数。下次主动生成时，将对符合本次条件的请求使用兼容写法。本次未自动重发、未生成内容，也未改动正式存档。',
};
export const aiErrorCodes = Object.keys(messages);
const fieldMessages = new Map<string, string>([
  ['tavern.writing_unknown', '旧版断点没有记录文学来源。请确认新续写使用的文学设置，或主动重新生成。已写内容保留。'],
  ['tavern.confirmation_expired', '本次续写确认已失效。已写内容保留，请在当前存档重新确认文学设置，或主动重新生成正文。'],
  ['tavern.writing_changed', '这段正文的文学设置与当前选择不同。请恢复原文学设置后续写，或主动重新生成。已写内容保留。'],
  ['worldbook.unavailable', '无法读取本地世界书库。请检查浏览器存储权限，恢复后重试。'],
  ['worldbook.blocked', '旧页面正在占用世界书库。请关闭旧标签页后重试。'],
  ['worldbook.invalid', '主世界书配置、版本内容或回合快照校验失败。请在设置中核对书库，恢复设置或重新导入受影响的书后重试。'],
  ['worldbook.missing_version', '已启用的主世界书缺少对应版本。请重新导入该书，或停用后重试。'],
  ['worldbook.unbound', '这份草稿缺少原生成流程的世界观快照。请重新生成正文，以当前配置开始新的流程。'],
  ['tavern.refresh_required', '正文模式已在其他页面变更，请刷新后再生成。'],
  ['tavern.context_boundary', '正文资料与交付标记冲突，本次未发送。'],
  ['tavern.native_delivery.tools', '未能准备本次正文所需的工具。请关闭破甲模式或检查渠道后再生成。'],
  ['tavern.native_delivery.action', '未能核对当前草稿的行动和背景资料，本次未发送。'],
  ['tavern.native_delivery.response', '渠道未返回可核对的正文工具结果，本次未保存。可关闭破甲模式后手动生成。'],
  ['tavern.initialization', '预设脚本初始化失败，可到运行设置查看实例状态。'],
  ['tavern.wrapper', '预设脚本处理响应时出错。'],
  ['tavern.preset_withdrawn', withdrawnPresetNotice],
  ['channel.confirmed_relay_unavailable', '当前渠道或设置不支持本次中转。断点已保留，请重新选择续写路径。'],
  ['channel.continuation_delivery_unknown', '本次续写确认已失效。模型服务可能已受理请求并计费。已保留原断点；如需再次发送，请重新确认。'],
  ['channel.relay', '本站中转未能完成请求。请检查地址、端点与请求大小，再手动重试。'],
  ['channel.relay_unavailable', '网络请求失败：本站中转接口不可用，未能确认模型服务的响应。请检查站点的 Worker 配置。'],
  ['channel.model', '服务明确报告模型或推理接入点不存在，或当前账户无权使用。请核对模型 ID 和授权。'],
  ['channel.parameter', '模型明确拒绝了本次发送的参数，请核对渠道高级设置。'],
  ['channel.retry_after', '服务要求的等待时间过长，已停止自动重试。请稍后再手动继续。'],
  ['tavern.wrapper.http', '预设脚本返回了失败响应。'],
  ['tavern.unhandled_tool', '预设脚本未将工具结果还原为正文。'],
  ['tavern.upstream.tool', '上游工具数据不完整或结构无效。'],
]);
export const manualRetryOnly = new WeakSet<AiError>();
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    public readonly status?: number,
    public readonly details?: { fieldPath?: string; commandType?: string; commandIndex?: number; relatedCommandIndices?: number[]; worldRule?: WorldRule; eventEntryReason?: EventEntryReason; variableStep?: VariableStep; retryAfterMs?: number; quota?: boolean } & Partial<ExecutionDiagnostic> & Partial<StoryDiagnostic>,
  ) {
    super(details?.storyRule ? storyDiagnosticMessage(safeStoryDiagnostic(details)) : (fieldMessages.get(details?.fieldPath ?? '') ?? messages[code])
      + (isTimeDomainRule(details?.domainRule) ? ` ${details?.commandIndex === undefined ? '整批约束' : `第${details.commandIndex + 1}条命令`}：${domainRuleNames[details!.domainRule!]}。` : '')
      + (details?.fieldPath ? ` 字段：${details.fieldPath}${details.commandType ? `（${details.commandType}${details.commandIndex === undefined ? '' : `，第${details.commandIndex + 1}条`}）` : ''}。` : ''));
    if (details?.storyRule) this.details = safeStoryDiagnostic(details);
    this.name = 'AiError';
  }
}
export function isContinuationDeliveryUnknown(error: unknown) {
  return error instanceof AiError && error.details?.fieldPath === 'channel.continuation_delivery_unknown';
}
// 不返回供应商正文、URL、请求头、原始异常或 Zod 错误内容。
export function safeAiError(error: unknown) {
  return error instanceof AiError
    ? { code: error.code, message: error.message, status: error.status, ...(error.details ? { details: error.details } : {}) }
    : error instanceof DataError && error.code==='EVENT_ENTRY'
      ? {code:'event_entry',message:messages.event_entry,status:undefined}
    : error instanceof DataError && ['STORY_BUSY', 'REVISION_CONFLICT', 'DRAFT_CONFLICT', 'ENTITY_CONFLICT', 'COMMAND_CONFLICT', 'DUPLICATE_COMMAND'].includes(error.code)
      ? { code: 'candidate_conflict', message: messages.candidate_conflict, status: undefined }
    : { code: 'unknown', message: '操作失败，请检查配置或浏览器存储权限后重试。' };
}
