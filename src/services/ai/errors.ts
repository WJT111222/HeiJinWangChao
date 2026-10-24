export type AiErrorCode =
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
  | 'invalid_json'
  | 'invalid_output'
  | 'unsupported'
  | 'resource'
  | 'placeholder'
  | 'permission'
  | 'npc_task_conflict'
  | 'time_preflight'
  | 'money_unit';
const messages: Record<AiErrorCode, string> = {
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
  invalid_json: '响应不是完整合法的 JSON。',
  invalid_output: '模型输出未通过结构或事实校验，候选未被接受。',
  unsupported: '当前协议不支持此请求特性，请检查兼容配置。',
  resource: '提示词资源缺失或与注册校验值不符。',
  placeholder: '提示词缺少必需参数或仍有未解析占位符，已阻止发送。',
  permission: '候选超出本阶段允许的命令或对象范围。',
  npc_task_conflict: 'NPC 已有未终结后台任务，候选存在任务占用冲突；未改写或删除已有任务。',
  time_preflight: '时间预检与正文或变量停止时间不一致，候选未保存。请检查行动或重新生成正文。',
  money_unit: '候选金额与证据中的人民币元/分不一致。',
};
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    public readonly status?: number,
  ) {
    super(messages[code]);
    this.name = 'AiError';
  }
}
// 不返回供应商正文、URL、请求头、原始异常或 Zod 错误内容。
export function safeAiError(error: unknown) {
  return error instanceof AiError
    ? { code: error.code, message: error.message, status: error.status }
    : { code: 'unknown', message: '操作失败，请检查配置或浏览器存储权限后重试。' };
}
