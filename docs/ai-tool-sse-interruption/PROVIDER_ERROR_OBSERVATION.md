# Story Tool Call 供应商错误信号观察

审查基线为 PR #191 的 `2f263aac18954ee91bd3ab1cec13ffb81d69fb25`，核对时远端 main 为 `089723c2e1e0aa608afe9820a87b1f6a36ef385b`。

## 本次真实请求

OpenAI 兼容中转以 HTTP 200 返回 SSE。应用在 112.343 秒收到响应头，在 115.175 秒交出第一帧，在 117.569 秒交出第三帧，随后报 `rejected`。已收到 3 个数据事件、748 字节，工具尚未出现。总时长 117.570 秒，未触发应用的 120 秒总超时。`readerEof=false` 表示拒绝前没有观测到 reader EOF。客户端在失败时结束消费，现有轨迹无法据此判断连接原本会如何结束。

第 3 帧触发拒绝的候选包括顶层真值 `error`、顶层 `type: "error"`、事件名 `error`，以及事件名 `error` 携带 `[DONE]` 的特殊分支。已有轨迹无法在这些候选中选择，也无法区分中转生成、上游故障或安全策略。

## 既有拒绝路径与优先级

| 场景 | 原有行为 |
| --- | --- |
| HTTP 非 2xx | HTTP 层先结束正常事件流。401/403 为 `authorization`，404 为 `not_found`，429 为 `rate_limit`，5xx 为 `server`，其余使用 `rejected`。既有 400/422 JSON 兼容分支可能提前报告 `parameter_adjusted`，不重发。 |
| HTTP 200 完整 JSON | 顶层真值 `error` 触发供应商错误。顶层 `type` 与 SSE 事件名判定只用于 SSE。普通文本 Story 的 JSON 路径会先执行相应 finish 和拒答检查，随后检查供应商错误。 |
| OpenAI 兼容 SSE，`event: error` 加 `[DONE]` | 先进入特殊标记分支。Tool Call 模式直接 `rejected`，从未交出 DONE 边界。普通文本模式保留原有结束处理。 |
| 普通 SSE 数据帧 | 先解析 JSON。无效 JSON 报 `invalid_json`。解析成功后，顶层真值 `error`、顶层 `type: "error"`、事件名 `error` 任一满足即可触发供应商错误。技术上的事件帧计数早于 JSON 解析。 |
| Tool Call 同帧包含供应商错误、拒答或长度信号 | `rejected` 优先于过滤、拒答和工具组装器的结束检查。内嵌错误对象包含已知过滤代码时，也遵循同一优先级。 |
| 不含供应商错误信号的过滤、拒答和输出限制 | Tool Call 中明确过滤或真实拒答仍用 `content_filter`。被组装器识别的 `length`、`max_tokens` 仍用 `output_limit`。普通流式文本也是先检查供应商错误，后继续其现有的拒答和结束处理。 |

定位见 [HTTP 处理](../../src/services/ai/client.ts#L105-L149)、[事件分帧和 JSON 解码](../../src/services/ai/responseEvents.ts#L143-L184)、[客户端优先级](../../src/services/ai/client.ts#L210-L282)、[Tool Call 结束判定](../../src/services/ai/storyToolAssembler.ts#L30-L36) 与 [finish 分类](../../src/services/ai/compat.ts#L4-L18)。模型列表的 [`parseModelPage`](../../src/services/ai/modelListing.ts#L106-L109) 也会用 `rejected` 处理顶层真值 `error`，与本次 Story 调用链无关。

## 新增脱敏信号

现有临时诊断可选输出 `providerErrorFrame` 和 `providerErrorSignals`。帧号取真实 SSE 序号，保存首个观测到的信号帧，同一帧最多保留下列三种信号并按固定顺序导出。

- `error_field` 对应解析对象中的顶层真值 `error`。服务有时返回字符串等非对象值，因此使用能准确描述既有判定的字段名。
- `type_error` 对应解析对象的顶层 `type: "error"`。
- `event_error` 对应已分帧的 `event: error`。事件名在 JSON 解析前已知，`[DONE]` 和无效 JSON 的情形也能记录该信号。最终错误码仍由原判断决定。

无信号时省略字段。非 2xx 与完整 JSON 继续使用已有 HTTP 状态、传输类型和错误结局，无 SSE 帧号。信号只表示客户端看到的协议形状；即使中转转发了上游标记，也无法仅凭这两个字段确认信号由哪一方发出。新增字段不导出嵌套错误对象、消息、供应商错误码或类别推断，也不采集正文、参数、推理、请求地址、密钥或存档标识。记录继续沿用现有内存区和容量约束。 [采样位置](../../src/services/ai/responseEvents.ts#L115-L180) · [封存](../../src/services/ai/storyToolTrace.ts#L205-L210) · [导出](../../src/services/ai/stageResponses.ts#L136-L145)

## 验证

Node 24.19.0，Vitest 5.0.5。新增 16 项正式用例，沿用 StoryStage、AiClient 和隔离 Repository。补丁前 31 项中有 8 项因缺少信号字段而失败。补丁后定向 6 个文件 349 项通过，新增用例已包含在内。首轮补丁后的复测发现，抛错的采样可能阻断同帧下一种信号；将每个新观测点独立容错后通过。同一输入在观察开启、关闭、观察抛错下使用相同请求指纹，各只发送一次 Mock。验证覆盖成功候选、失败草稿元数据、CAS 参数、正式状态不变、取消、120 秒超时、HTTP 消费次数和下载投影脱敏。未调用真实模型，未运行本地全量或 E2E。

```bash
npx --no-install vitest run src/tests/story-tool-sse-observation.test.ts \
  src/tests/story-tool-trace.test.ts src/tests/story-tool-events.test.ts \
  src/tests/story-tool-runtime.test.ts src/tests/response-events.test.ts \
  src/tests/ai-client.test.ts
```

本轮生产变更仅在 SSE 读取到的事件和现有临时记录之间增加观测。请求、错误优先级、SSE 解析、CR 行为、工具结束条件、超时、存档协议、CAS 和 Tool Call 默认开关均保持原规则。下一次自然失败的导出能定位真实信号及其帧，实际责任方及拒绝原因仍需独立证据。
