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

### Anthropic SSE 内容块

每条消息独立记录内容块的供应商索引、类型和关闭状态。start、delta、stop 使用原始 JSON 索引，均要求其为非负安全整数。索引可以从非零值开始，同一消息中的索引只可建立一次。delta 和 stop 必须指向仍打开的块。所有块关闭且收到供应商结束原因及 message_stop 后，才允许交付。

文本块接受文本与引用增量，思考块接受思考与签名增量，本地工具块仅拼接本块的 input_json_delta。redacted_thinking 可正常开始与关闭。签名和隐藏数据沿用原有展示边界。工具的供应商块索引与归一化后的调用索引分别保存，通用多工具仍可分别完成。异常在公共解析层返回错误，开发原型的工具执行与收据必须等校验通过。[收口测试记录](review-fixes.md#anthropic-sse-内容块收口)

### 单一终端工具的排版空白与块顺序

宿主请求一个命名的正文交付工具时，公共解析器在原始协议上记录可见文本的位置。唯一调用的身份、参数结构、生命周期和供应商结束标记全部通过后，才能用这份记录核对交付。允许的排版字符是 ASCII 空格、Tab、CR 和 LF，顺序及数量都要与实收字串一致。

| 协议形态 | 位置依据 | 处理 |
| --- | --- | --- |
| Gemini JSON 或 SSE | 每个候选内的 `parts` 数组顺序，以及事件之间的先后 | 工具之前的独立文本 part 可以提供证明。工具后面的 part、同一 part 内混放的文本与工具字段均不能提供证明 |
| Anthropic JSON | 同一消息的 `content` 数组顺序 | 只采纳 `tool_use` 之前的 `text` 块 |
| Anthropic SSE | 经块索引、类型和开闭校验的 start/delta 事件到达顺序 | 逐次判断文本实际到达的位置。较早打开的文本块若在工具出现后才发出文本，该段没有前置证明 |
| OpenAI 兼容及 DeepSeek SSE | 不同 SSE 事件有先后，同一 delta 的字段没有时序 | 早先独立事件中的空白可以取得证明。空白与 `tool_calls` 同帧、位于调用分片之间或晚于调用时均无法取得证明 |
| OpenAI 兼容及 DeepSeek 非流式 JSON | 同一消息的 `content`、`tool_calls` 是并列字段 | 两种键排列具有相同语义。没有伴随文本的合法工具照常交付，有伴随文本时不能凭键顺序认定其在工具之前 |

一旦出现后置文本、位置不明的文本或非排版字符，整份伴随文本失去前置证明。供应商公开思考与工具参数中的正文分别沿原通道读取。Gemini 跨事件的合法工具快照仍按原有身份去重，已经看见工具后出现的可见文本不会被追认为前导内容。通用多工具、工具参数分片及纯文本交付继续沿用原契约。

`matchesDelivery(restored)` 核对现有包装器的还原值，也支持经证明的精确前缀与完整正文。`matchesDelivery(body, prefix)` 则同时验证原工具正文和单独送入 C2 的非空前缀。只有二者匹配，C2 才将处理器的独立文本字段置空。没有位置证明的空白原样送达现有处理器，由互斥交付检查拒绝。真实竞争正文在公共解析层拒绝，不进入处理器。[逐项协议矩阵](../../../src/tests/fixtures/toolOrder.ts) · [双端正式 Story 及结算断言](../../../e2e/spreset-tool-order.spec.ts)
