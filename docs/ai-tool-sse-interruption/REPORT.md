# Story Tool Call 的 SSE 首帧前中断调查

调查代码为 PR #191 的 `ca9c2af579627cad14cf37db1472c86a2064d27a`，调查时远端 main 为 `089723c2e1e0aa608afe9820a87b1f6a36ef385b`。本批交付调查报告、隔离复现夹具和观察方案。Tool Call 默认关闭，客户端和请求行为保持原样。

## 真实请求确认到哪一步

| 观测 | 附件证据 | 可确定的范围 |
| --- | --- | --- |
| 请求路径 | OpenAI 兼容中转，开启流式，总超时 120 秒 | 客户端选择 SSE 读取分支 |
| HTTP | 200，收到响应头距开始 51.615 秒 | 从发出请求到收到响应头约 51.613 秒，无法分解为服务端推理或网络耗时 |
| 首个非空块 | 距开始 51.616 秒，距 HTTP 响应 1 毫秒 | 本地读到了非空字节，尚未确认解码成功，也未知字节总量 |
| 数据事件 | `firstSseFrameMs=null`、`frame=0`，工具及供应商 finish 时间均为空 | 没有完整数据事件交到响应事件层，未到工具校验 |
| 结束 | 90.753 秒，`stream_interrupted / waiting-sse-frame`、`boundary=null` | 首块至失败约 39.137 秒。未观察到高层 DONE 或 EOF，真实读流结束方式未知 |

这条请求未触发应用的 120 秒总超时，错误也不属于既有 `duplicate_provider_finish`。附件没有证明是否遇到读取异常、正常 EOF、UTF-8 错误、心跳、缺失分隔符、响应类型不符或供应商过滤。HTTP 200 无法回答这些问题，客户端也尚未收到可以识别过滤的结构化事件。本报告只保留附件中上述非标识性字段。

## 调用链及归因

1. `AiClient.response()` 记录 HTTP 状态。对于要求流式的请求，`readResponseEvents()` 只对匹配 `application/json` 的响应头进入 JSON 分支，其余进入 SSE 分支。诊断的 `observedTransport=sse` 表示已选择读取分支，未知实际媒体类型。正确标记的 JSON 错误页可走正常拒绝分支，缺失或错误的媒体类型也可能使 HTML 或普通文本进入 SSE 分支。[client.ts#L105-L115](../../src/services/ai/client.ts#L105-L115) · [responseEvents.ts#L135-L154](../../src/services/ai/responseEvents.ts#L135-L154)
2. `readSse()` 使用一个 reader 和严格 UTF-8 解码器，在解码前记录首个非空块。通常在读到含 `data:` 行的事件及空行后才产生数据事件。解码器可能仍在等待一个跨块字符，缓冲区可能仍在等待一行或空行，也可能收到不产生数据事件的注释。合法分块本身不足以说明有故障。[sse.ts#L8-L36](../../src/services/ai/sse.ts#L8-L36)
3. `reader.read()` 拒绝和严格解码异常共用 `stream_interrupted`。即使读取正常返回 `done=true`，最终解码或非空残尾检查仍可在交出 EOF 前得到同一错误。若最后有 `data:`，现有代码可能在正常 EOF 时交出该事件。随后 JSON 解析失败时，帧数已增加，错误为 `invalid_json`。[sse.ts#L38-L54](../../src/services/ai/sse.ts#L38-L54) · [responseEvents.ts#L155-L174](../../src/services/ai/responseEvents.ts#L155-L174)
4. `wireFrame()` 在收到分帧器产物时计数，早于 JSON 语法校验。`boundary` 只在客户端消费高层结束事件时写入。帧数为零且 `boundary` 为空与底层正常 EOF 可以同时成立。缺失响应体也用 `stream_interrupted`，但与此请求已经收到非空块不符。未识别供应商 finish 也可使用同一公开错误码，但需要先收到事件，与零帧证据不符。[responseEvents.ts#L154-L174](../../src/services/ai/responseEvents.ts#L154-L174) · [client.ts#L188-L202](../../src/services/ai/client.ts#L188-L202) · [compat.ts#L11-L18](../../src/services/ai/compat.ts#L11-L18) · [storyToolTrace.ts#L208-L231](../../src/services/ai/storyToolTrace.ts#L208-L231)
5. 客户端启动一次总计时器，和取消信号竞速，单纯收到块或心跳不会刷新计时器。Tool Call 仍须观察到真实传输结束、供应商 finish、封闭调用和合法参数后才能交给 Story；否则不会保存候选。既有失败元数据仍通过草稿 CAS 保存。 [client.ts#L60-L101](../../src/services/ai/client.ts#L60-L101) · [storyToolAssembler.ts#L78-L87](../../src/services/ai/storyToolAssembler.ts#L78-L87) · [storyStage.ts#L180-L208](../../src/workflows/storyStage.ts#L180-L208)

## 隔离复现

夹具走真实 `AiClient → Response → ReadableStream → StoryStage → SaveRepository`，使用合成存档和隔离的 `fake-indexeddb`。所有列在下表的响应均为 HTTP 200，除明确标记的 JSON 对照外都走 SSE 分支。

| 场景 | 实测结束 | 帧数／高层边界 |
| --- | --- | --- |
| 非空首块之后读取抛错；半个 UTF-8 字符之后读取抛错 | `stream_interrupted` | 0／无 |
| 半个 UTF-8 字符之后正常 EOF；收到非法 UTF-8 字节 | `stream_interrupted` | 0／无 |
| 已收到 `data:` 行，但无空行，接着读流抛错 | `stream_interrupted` | 0／无 |
| 仅注释之后读流抛错 | `stream_interrupted` | 0／无 |
| 仅注释或仅 `event:` 后正常 EOF | `tool_response`，规则 `incomplete` | 0／EOF |
| HTML 或错误页文字进入 SSE，正常 EOF 时仍有未识别的残尾 | `stream_interrupted` | 0／无 |
| HTML 各行均以换行结束；正确标记媒体类型的 JSON 错误页 | 分别为 `tool_response`、`rejected` | 0／EOF；1／无（JSON） |
| 不完整 `data:` JSON 后正常 EOF | `invalid_json` | 1／无 |
| 合法工具帧但缺服务商 finish，之后 EOF | `tool_response`，规则 `incomplete` | 1／EOF |
| 合法 LF / CRLF SSE 与真实 DONE，含中文和 emoji 的逐字节分片 | 成功保存一份 Story 候选 | 3／DONE |
| 工具与 finish 完整，最后一帧缺空行，正常 EOF | 成功保存一份 Story 候选 | 2／EOF |
| 同一合法响应改用单独 CR 换行 | `invalid_json` | 1／无 |
| 无分隔的 `data:` 等到总时限，或玩家主动取消 | 分别为 `timeout`、`cancelled` | 0／无 |

每个流程均执行现有观察器开启和关闭两次。在内存内比较请求指纹、调用次数、完整安全错误和 Repository 结果。两态均仅发出一次 Mock 请求，SSE 只取一个 reader，无 `clone`、`tee` 或二次 JSON 消费。成功只保存合法候选一次，失败不保存候选、部分正文或正式世界状态。非取消失败保留既有草稿失败元数据，取消无草稿写入。独立虚拟时钟对照在 119999 毫秒仍等待，并在 120000 毫秒得到 `timeout`，未发生重发。两态对照覆盖现有观察器，拟议字段的等价性需要在实施时另验。

Node 24.19.0、npm 11.9.0、Vitest 5.0.5。锁文件 `npm ci` 退出 0。隔离夹具 **21 通过，0 失败，0 跳过**，现有五个定向文件 **318 通过，0 失败，0 跳过**，两个批次均退出 0。本地未执行全量工程或 Chromium；本次提交没有产品代码。详见[脱敏 Mock 结果](evidence/MOCK_RESULTS.json)、[隔离测试日志](evidence/mock-portable.log)、[定向回归日志](evidence/targeted.log)和[复现命令](reproduce/README.md)。

## 客户端缺陷与下一步

- **已证实的诊断缺口。** 读取抛错、块解码、EOF 解码和不可识别残尾能产生相同的导出签名。此次真实失败无法定位到其中一支。
- **独立确认的兼容缺口。** [WHATWG SSE 行定义](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)允许单独 CR 作为换行，现有分帧器只查找 LF。相同合法 Tool Call 用 LF 或 CRLF 通过，单独 CR 在 Mock 中失败。这个复现错误为 `invalid_json`、帧数一，与附件签名不同。是否支持单独 CR 可单独审查，不能据此判定玩家故障。
- **建议。** 先审查[最小观察补丁方案](OBSERVATION_PLAN.md)，在仍默认关闭的基础上增加分支级证据。无需为本轮调查发起真实请求。补丁审核通过后，优先收集下一次自然失败时玩家主动导出的诊断，再决定是否需要受控的真实对照和费用授权。仅凭 Mock 无法评估该中转的成功率，也不具备把 Tool Call 改为默认开启的证据。
