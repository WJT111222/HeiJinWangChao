# PR #191：真实 Tool Call 失败专项只读诊断

日期：2026-11-18（北京时间）。本轮先完成源码诊断、隔离 Mock 复现及补丁设计；**未修改生产源码、未放宽校验、未实施诊断导出功能**。没有真实模型调用，不合并、不部署、不发布。

## 结论与证据等级

**尚未锁定这三条玩家失败的唯一根因；具备实施最小诊断补丁的条件，不具备默认开启 Tool Call 的证据。**

已证实：120 秒是整次请求的总时限；多个不同状态会抛相同的 `storyTool.ordering`；当前临时记录没有分阶段耗时、工具事件序列和具体拒绝分支，无法事后消除歧义。Mock 已复现这些机制，不能据此宣称玩家的中转一定重复发了结束帧或一定忘记发 DONE。

推荐先审查并实施 [DIAGNOSTIC_PATCH_PLAN.md](./DIAGNOSTIC_PATCH_PLAN.md) 中的**纯观察补丁**，保留既有解析及失败策略；取得玩家主动导出的脱敏轨迹后，再针对确证的协议形态讨论最小修复。无需也不允许先发送新的收费探测请求。

## 固定代码与已知玩家环境

- 代码审查 / 全部本轮测试 HEAD：`39676ec8e58b219360ab28b879f1e1f138821c0a`。
- main：`a820f5eadcd18362aa22a2fc51232a186e2ef8f9`。
- 原 PR #191，分支 `feat/ai-response-events`，Draft、未合并。开工核实 HEAD/main 没有变化。
- 负责人补充：**OpenAI 兼容协议，模型别名 `gemini4argon`，第三方中转，流式开启，超时 120 秒**。
- 中转地址、实际后端型号/版本、浏览器、当次出站参数、原生 SSE 轨迹、HTTP/首字节时间均未知；没有读取真实设置、密钥或玩家存档。

`gemini4argon` 是此路由请求中的模型标识，**不能据名称断言它就是官方某款 Gemini**。该请求实际走 OpenAI Chat Completions 的 `/chat/completions`、`tools/tool_choice/tool_calls`，不是原生 Gemini `functionCall`。OpenAI 分支不因模型名称带 gemini 就注入原生 Gemini thinkingConfig，也不因此改用 Gemini 事件解析。

### 玩家提供的观察

以下时间保持原始 UTC 标识，不混淆本地时区：

| 时间 | 观察 | 可推断内容 |
| --- | --- | --- |
| 2026-11-18T13:18:21.698Z | timeout | 触发客户端总超时；不能判断停在 HTTP、正文首字节、参数还是结束边界 |
| 2026-11-18T13:25:36.083Z | tool_response / storyTool.ordering | 命中多个顺序拒绝分支之一；原文多或 JSON 包含 content 不足以证明工具身份/结束有效 |
| 2026-11-18T13:32:41.927Z | timeout | 同上；与上一条有相同 turnRef |

后两条必须归入同一回合组，进一步用独立 attempt/response ID 区分，不能当独立场景计算成功率。现有材料没有完整请求分母，也不能排除重复记录，因此本报告**不计算真实成功率、失败率或平均响应时间**。关闭工具时能成功是重要对照线索，但缺少同时固定的实际模型、上下文、预算、代理转换及事件记录，不能据此判定某一层就是唯一根因。

## 实际调用链及超时语义

```text
StoryStage.generate()
  -> 快照 settings.runtime.streamStory / timeoutSeconds / storyToolOutput
  -> runStageRequest() 装配原 Story 提示词
  -> AiClient.generate() / wireRequest()
  -> operation() 启动总超时
  -> 原 fetch transport -> HTTP Response
  -> readAiResponseEvents()
  -> readSse() 或完整 JSON
  -> ToolEventProjector -> StoryToolAssembler
  -> 严格参数 JSON/Schema
  -> 原 parseStoryEnvelope / 时间与事件业务校验
  -> StoryStage 候选 CAS 保存
  -> 已启用下游阶段 -> 原 Commit
```

### 1. 超时覆盖整次接收，不是首字节或空闲超时

位置：`src/services/ai/client.ts:56-95`，`runtime.ts:144-145`，`workflows/storyStage.ts:74-75,128`。

`operation()` 在真实请求之前设置一次 timer，覆盖等待 HTTP、响应读取和客户端处理，没有因收到 SSE、公开 reasoning 或工具参数而重置。正常设置允许 1～3600 秒，本环境本次实际指定 120 秒。本轮不修改上限、默认值或计时策略。

若长篇工具请求持续输出但超过总时限，仍然 timeout；这与当前实现一致，不能把“有输出”当自动延长授权。Mock 中用虚拟时钟复现 120000 ms 到期，不等于真实浏览器 timer 在所有主线程负载下都精确按毫秒执行。

请求提示词装配在 `runStageRequest()` 中先完成；`operation` 内的检查器统计/发送准备也占用此计时窗口。未来诊断应分别记录 timeout 起点和真正调用 transport 的时间，不将整个阶段耗时冒充模型生成时间。

### 2. HTTP Response 与首字节、首个 SSE 事件是不同观察点

位置：`client.ts:99-110`、`responseEvents.ts:99-126`、`sse.ts:18-30`。

fetch resolve 表示 JS 收到可读取的 HTTP 响应，不能代替正文首字节。`readSse()` 通过单一 reader、流式 UTF-8 decoder 和空行边界输出完整 SSE 事件。`: ping`、注释、尚未凑齐的 data 帧可有字节但没有事件。不能用当前 `onRawTextDelta` 的第一次回调当“首字节”或“首个工具事件”：它只观察提取到的实际文本/工具参数。

浏览器未暴露 HTTP Response 也不能证明服务器没有响应，网络/CORS/连接中断等在客户端可能不可区分。浏览器可观察的首 chunk 不是网卡物理到达时刻或服务器开始生成的时刻。

### 3. 完整工具内容仍需真实完成边界

位置：`responseEvents.ts:115-128`、`storyToolAssembler.ts:64-73`、`client.ts:277-287`。

OpenAI 兼容流中，工具参数完整及 `finish_reason:tool_calls` 之后，当前消费器仍等待实际 `[DONE]` 或 HTTP body EOF；收到 DONE 可结束读取并取消 reader，无需继续等 TCP/body 自然关闭。若二者都不出现，body 一直开着，即使参数已经足够，也会最终 timeout。

这是一个**可复现的候选机制**，不是已经证明玩家代理缺失终止符。未结束传输还可能有后续矛盾数据；本轮不将 JSON 可解析、长时间静默或任意 finish 自动当作 EOF，不提前提交部分参数。

### 4. 小说阅读区的静默不能证明传输没有数据

工具模式在组装完成前只保留临时原文观察，`onDelta` 的正式内容在 `carrier.complete()` 后一次交付（`client.ts:277-287`）。参数增量不会被当小说拼接，更不会直接保存。传统文本模式在严格接收过程中已有可读增量，因此两者的等待观感不同；这不是证实模型没有工作，也不代表只要有原文就可正式保存。

## storyTool.ordering 的具体分支

| 条件 | 位置 | 说明 |
| --- | --- | --- |
| finish 后更晚帧又有公开 reasoning | storyToolAssembler.ts:21 | 不是 `<thinking>` 标签字符串检测 |
| message_stop 过早、重复，或缺少已关闭工具/finish | storyToolAssembler.ts:23 | Anthropic SSE，不能当作本次 OpenAI 中转已发生的事实 |
| 第二个被认可的 finish 原因 | storyToolAssembler.ts:34 | 重复 tool_calls 的尾帧也会命中 |
| finish 后更晚帧又有工具事件 | storyToolAssembler.ts:38 | 包括迟到参数、身份或重开调用 |
| 参数/身份/结束事件没有对应 open slot，或调用已关闭 | storyToolAssembler.ts:46 | 合法 JSON 内容不能补足生命周期 |
| 快照与参数 delta 混用 | storyToolAssembler.ts:51 | 主要涉及原生 Anthropic 非空初始 input；不默认套用到本次路由 |
| projector 重开已关闭 slot、对非 open slot 写参数/结束 | toolResponseEvents.ts:32-40 | 可能在投影完成前抛错，单看已发出的工具事件会漏证据 |
| 重复 content_block_stop | toolResponseEvents.ts:93 | Anthropic 路径 |

### 同一帧的投影顺序不是原生事件先后

普通 OpenAI 兼容结束帧的正常内部过程是：

```text
wire frame N: finish_reason=tool_calls（可同时有最后 arguments delta）
  -> response(sequence=N)：组装器记录 finish
  -> 同一个 frame N 投影 tool-arguments（如有）与 tool-end
wire frame N+1: [DONE]（或之后真实 EOF）
```

`tool-end` 是从该帧原生 finish **派生**的内部事件，并不是服务端另外发出的一条原生消息。组装器使用 `sequence > finishSequence`，允许同帧参数/结束，因此这条正常顺序当前可通过。不能把它错误修成“凡 finish 前没 tool-end 都拒绝”，也不能把内部回调次序宣传为同一帧内真实生成时序。

## Mock 复现结果

使用真实 `AiClient`、`readAiResponseEvents`、`ToolEventProjector`、`StoryToolAssembler`、`runStageRequest`、`StoryStage` 和正式 Repository；只替换 transport 与 IndexedDB factory，不发送网络请求。

### OpenAI 兼容顺序矩阵

| 合成事件轨迹 | 当前实际结果 |
| --- | --- |
| 最后参数与 tool_calls finish 在同一帧 | 成功 |
| tool_calls finish 后只有 choices=[] 的 usage 尾帧，再 DONE | 成功 |
| usage 尾帧重复携带 tool_calls finish | tool_response / storyTool.ordering |
| finish 后追加参数片段 | tool_response / storyTool.ordering |
| finish 后追加独立 reasoning | tool_response / storyTool.ordering |
| finish 后才开始工具 | tool_response / storyTool.ordering |
| 已关闭 slot 重开 | tool_response / storyTool.ordering |
| 普通 delta.content 仅输出形似 {content:...} 的 JSON 文本 | storyTool.mixed_text，不是原生工具 |
| 工具内容合法，但 finish_reason=stop | storyTool.finish，不是 ordering |
| 参数合法但没有原生 finish | storyTool.incomplete |
| 正确完整 JSON 原生工具响应 | 成功，无跨帧顺序概念 |

这些拒绝中有些是必要保护，有些可能是中转重复终止的兼容问题；**必须拿真实轨迹分清后再决定是否容忍某个等价尾帧**。本轮不去重、丢弃或改写结束帧，不允许多工具/缺身份/参数不完整通行。

### 虚拟时钟的 120 秒总超时矩阵

| 合成情况 | 实际结果 | 额外请求 |
| --- | --- | --- |
| HTTP Response 在 121 秒才出现 | 120 秒 timeout | 0 |
| 1 秒收到 HTTP，正文首 chunk 晚于总时限 | 120 秒 timeout | 0 |
| 持续收到 SSE 注释 ping，没有有效数据事件 | 120 秒 timeout | 0 |
| 3、60、119 秒仍收到参数，未及时结束 | 120 秒 timeout | 0 |
| 4 秒前已有完整参数及工具 finish，但没有 DONE/EOF | 120 秒 timeout | 0 |
| 同上，119 秒出现真实 EOF | 119 秒成功 | 0 |
| 5 秒出现 DONE，而 HTTP body 未自然关闭 | 5 秒成功，不等后续关闭 | 0 |

每项仅 1 次 Mock transport。额外验证取消为 cancelled、超时前收到的参数不交给正式小说回调；流式请求被 `application/json` 完整响应回答时正确走 JSON 兼容路径。

`MOCK_TRACES.json` 是 **18 条合成元数据记录**，包含上述 11 条顺序轨迹及 7 条时序场景，不是玩家响应、真实耗时或成功率样本。只保存白名单事件类型/sequence/边界/布尔值/时间/错误码，没有正文、参数文本、thinking、真实工具 ID/名称、提示词或凭证。源测试中的故事均为合成资料；生产诊断导出尚未实现。

## JSON / SSE、四协议边界

| 路径 | 当前支持与风险 | 本轮证据边界 |
| --- | --- | --- |
| OpenAI 兼容 + `gemini4argon` 第三方中转 | 期待标准单 tool_calls、arguments 字符串增量、tool_calls finish；强制指定工具并 parallel_tool_calls=false | 本次核心 Mock；不能确认代理后端能力或实测延迟 |
| 原生 DeepSeek | 使用同类 Chat Completions 工具字段；独立 reasoning 可观察 | 既有定向用例复核通过，不推断和该中转等价 |
| 原生 Gemini | 期待标准完整 functionCall 对象，STOP；本 PR 不猜 partialArgs/willContinue | 本次玩家未使用此协议；既有定向兼容回归通过 |
| 原生 Anthropic | tool_use block start/input_json_delta/block stop + tool_use finish + message_stop；Thinking auto 可能选择文本并被严格拒绝 | 不是玩家当前路径；既有顺序安全用例继续通过 |
| 完整 JSON | 参数快照与整个响应已收完后验证，不存在 SSE 跨帧时序；仍有 HTTP/读 body/参数格式失败 | 本轮有正确 JSON 及 stream→JSON 控制；未真实请求非流式对照 |

`responseEvents.ts:101` 依据请求 stream 和实际 Content-Type 选路径。错误 MIME、代理缓冲、断帧、原生字段漏译都需要诊断实际 observed transport；不能只记录开关值。JSON 的字段排列也不是生成顺序。

## `<thinking>` 与协议故障分开判断

本轮通过正式运行时验证：

- 工具 `content` 字符串内部带合法项目 `<thinking>...</thinking>`，原严格 Story 解析正常通过。
- 工具 `content` 前导兼容 `<think>...</think>` 按既有规则处理，正文不混入这段推理。
- 工具参数对象新增独立 `thinking` 字段，严格工具 Schema 拒绝为 storyTool.arguments。
- `<thinking>` 被输出在整个工具参数 JSON 之外，参数 JSON 解析拒绝为 storyTool.arguments。

因此“出现 thinking 字样”不是 ordering 的充分原因，不应通过改标签或提示词去修复未知的事件顺序。上述正例不代表任意额外标签/内容均合法；其他不合法 Story 结构仍走原校验。

## 保存与请求安全

新增 4 项用真实 `StoryStage` 和合成 Repository 验证：重复 finish、finish 后参数、过滤、残缺 arguments 全部拒绝；每项仅 1 次 Mock 请求，**Story 候选保存 0、Commit 0，正式状态与草稿前后完全相同**，临时原文状态为 failed。测试使用未配置失败元数据写回 hook 的直接 Stage 调用；不能由此宣称自动协调器连合法失败元数据也不保存。

已有 `story-tool-runtime.test.ts` 中的取消迟到、CAS/IDB、请求身份、原子结算等回归继续通过。没有在本轮引入新的写库路径、重试、续写、参数清洗或费用行为。工具参数仍不伪装成可续写的 Story 前缀。实际玩家每份存档是否已变化不能从本地合成测试证明；本轮没有接触它们。

## 诊断盲点与最小方案

现有 `responseContent.ts:ResponseDiagnostics` 有协议结构、结束原因白名单、HTTP 状态和 complete；`StageResponseStore` 有请求 ID/版本范围与失败原文；`requestInspections` 有请求设置、模型及统计，但包含主动查看的完整请求内容。它们没有能够解释当前 timeout/ordering 的时间轴和拒绝分支。

**不能直接序列化 RequestInspection、StageResponse 或普通运行日志作为“安全诊断”**：这些对象含原文、提示词、规范化候选、save/turn 等标识。应复用既有临时记录的请求身份和生命周期，新增白名单摘要，不新建平行响应日志。

推荐修改点、字段与隐私/容量/生命周期约束详见补丁方案。先新增观察与主动导出，保持所有错误码及接受条件。真正的协议容错、超时政策变动需要在真实脱敏轨迹证明之后单独审查；不通过延长总时限、自动换非流式或二次付费请求“修好”。

## 本轮正式执行记录

环境：Node **v24.19.0**，npm **11.9.0**，Vitest **5.0.5**，复用本 PR 锁文件真实已安装依赖；原生 Vitest，不使用替代运行器。

| 批次 | 结果 | 退出码 | 证据 |
| --- | --- | ---: | --- |
| 新建传输/顺序复现首轮 | 20 通过，0 失败/跳过 | 0 | logs/transport-ordering.log.gz |
| 加入 Repository 复现 R2 | 24 通过、4 失败、0 跳过 | 1 | logs/diagnostic-repro-r2.log.gz |
| 修正外部夹具后最终 R3 | **28 通过，0 失败/跳过**，2 文件 | 0 | logs/diagnostic-repro-r3.log.gz |
| 既有定向回归 | **271 通过，0 失败/跳过**，4 文件 | 0 | logs/existing-targeted.log.gz |

R2 的 4 失败是新增复现脚本把 `SaveRepository.open(name,factory)` 参数顺序写反，尚未进入业务；已修正为正式调用并使用 create/saveDraft(null)。没有改生产实现或削弱业务断言，原始日志保留。首轮进程退出钩子未在 Vitest worker 写出轨迹，改用 afterAll 后导出成功；不将不存在的首轮轨迹冒充已有证据。

28 项最终新增复现包含首轮 20 项，不能相加；271 为另一次定向执行，不宣称一次全量 299 项。既有 4 文件：story-tool-events、story-tool-runtime、response-events、ai-client。日志是独立运行，不与此前 4728/18 成绩累计。

本轮**未重跑 npm ci、全量 check、Build 或 Chromium**：没有生产源码/正式测试/UI 修改，本阶段只做诊断与外部 Mock 复现，不重新认证旧全量成绩。诊断补丁实施后应按方案执行完整 Node24 与双端回归，不能用本轮只读结果替代。

## 风险与下一步

1. 当前真实根因证据不足：仍缺 HTTP/首字节/结束轨迹及 precise failure site；不判断服务商归责。
2. 实施诊断必须保证无正文/推理泄露、单消费响应体、观察器异常不改变错误、超时/取消后不串台；每点需新测试。
3. 不默认容忍重复 finish，不能忽略 finish 后的参数/思考，不推断工具 ID、补全参数或制造结束信号。
4. 真实预算仍未批准：本轮 0 次真实调用，不以自动对照去“收集证据”。可先由负责人独立审查元数据补丁，再让玩家在正常自愿游玩中主动导出；任何另行安排的真实比较需预算批准。
5. 默认开启策略必须按**协议 × 具体接入方式 × 模型标识/版本**建立证据；不能把官方 Gemini Mock 通过当作该 OpenAI 中转已认证，也不能用这一条别名的结果代表全部模型。

**最终判断：已找到并复现多个可能触发机制，以及确定的诊断可观察性缺口；尚未证明哪一个对应玩家原始失败。建议先批准最小诊断补丁，不批准默认开启，也不批准放宽协议或自动重试。**

## 本机复现命令

```bash
node --version
npm --version
npm_config_cache=/workspace/.npm npx vitest run \
  --config /workspace/pr191-tool-stability-evidence/reproduce/vitest.config.mjs
npm_config_cache=/workspace/.npm npx vitest run \
  src/tests/story-tool-events.test.ts \
  src/tests/story-tool-runtime.test.ts \
  src/tests/response-events.test.ts \
  src/tests/ai-client.test.ts
```

外部复现脚本最终版本在 `reproduce/*.txt`。其他机器可复制到仓库外再执行；须将其中 `/workspace/ai-response-events` 和 `/workspace/pr191-tool-stability-evidence` 替换为实际代码/证据目录。配置只扫描这两份外部测试；不要通过复制到 src/tests 意外扩大全量测试集合。所有 transport 都是函数注入，不连接配置中的 `.mock.invalid` 地址。
