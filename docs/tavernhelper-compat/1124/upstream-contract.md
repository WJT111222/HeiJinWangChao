# 供应商原始响应契约

#252 的公共解析器在包装器投影前读取原始协议。错误、过滤、缺少完成标记、未闭合的工具参数以及 Anthropic 流缺少块结束或消息结束，均阻止正文交付。仅收到 SSE 的 DONE 不能证明模型完成。

| 原始协议 | 正常正文结束 | 工具结束 | 输出上限 |
| --- | --- | --- | --- |
| OpenAI 兼容、DeepSeek | stop | tool_calls | length |
| Gemini | STOP | STOP，有 functionCall | MAX_TOKENS |
| Anthropic | end_turn、stop_sequence | tool_use | max_tokens |

工具 ID 属于请求。Gemini 在同一候选的 parts 内重复 ID 会报错。不同 SSE 事件允许同一 ID、名称及等价 JSON 参数的累计快照。OpenAI 和 DeepSeek 按不同事件中的 index 拼接参数，Anthropic 按块索引拼接。部分 Gemini 参数扩展仍使用现有 unsupported 分类。过滤、拒答、截断和取消继续保留各自的诊断。

normalizeUpstream 的最后一个可选参数约束本次交付。省略时保留通用多工具能力，传入 null 表示本次只声明文本交付，传入工具名则要求工具响应只含该名称的一次调用及唯一非空字符串 content 参数。单次交付允许正常纯文本，独立防截断另按既有规则核对工具还原正文。正文与工具并行竞争将失败，公开思考与工具前的排版空白不构成竞争正文。1118 和 1124 仅对实际声明的交付工具启用该路径。

C2 接收原协议时应先走同一帧解析器的 project / finish，在处理器执行或签发本地收据前检查错误。SPreset 的单终端工具使用 submit_scene，未来有多工具需求的注册项可单独定义自己的交付规则。已有工具输出不能替代上游完成标记。

回归入口为 src/tests/tavern-provider-integrity.test.ts 与 src/tests/tavern-backend.test.ts。
