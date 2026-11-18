# PR #191 Story Tool Call 诊断导出审查

2026-11-19（北京时间）。基线为 PR #191 的 `df0a6e0ca6c1f9279cfc39b23a704b9fd1e03cac`，main 为 `a820f5eadcd18362aa22a2fc51232a186e2ef8f9`。[前一轮诊断及获批方案](../ai-tool-stability-diagnosis/REPORT.md)

PC 和手机都可以在「阶段详情 → 正文 → 模型原文」下载本次请求的诊断 JSON。开启 Story 结构化输出后，诊断随该请求采集，结束后才显示下载按钮。观察器开关是请求内选项，玩家界面无需另存一项设置。Story Tool Call 仍默认关闭。

## 怎样判读摘要

| 字段 | 实际观测 |
| --- | --- |
| `startedAt`、`operationStartedMs`、`dispatchMs` | 墙上时间锚点和同一个单调时钟下的计时起点、传输调用时刻 |
| `httpMs`、`httpStatus`、`observedTransport` | 浏览器收到可读 HTTP 响应及实际选择的读取路径 |
| `firstBodyChunkMs`、`firstSseFrameMs` | SSE 现有读取器第一次交付非空字节，以及第一帧完整 SSE data。心跳可产生字节，注释不计入 data 帧 |
| `firstToolEventMs`、`firstArgumentsMs`、`firstNonEmptyArgumentsMs`、`lastArgumentsMs` | 内部工具事件和参数增量的观测时点 |
| `firstProviderFinish`、`firstProviderFinishMs`、`counts` | 可识别的供应商实际结束值、来源字段、输入帧号和总数。未知值标为 `unrecognized` |
| `boundary`、`boundaryMs` | 实际观察到的 `done-marker`、干净 `eof` 或完整 `json-body` |
| `outcome`、`stage` | 传输和载体验收结果、最终错误发生的帧与阶段。另列 Story 后续校验规则和失败状态 |
| `attemptId`、`turnGroup` | 本页面生成的匿名请求 ID 和回合组。同一临时回合的重试可区分，存档和草稿 ID 不参与导出 |

相对时刻单位为毫秒。JSON 保留原来的单次 `response.json()`，首个正文数据块时间为 `null`，可用 HTTP 时刻和完整值解析时刻。不额外读取响应体。未观察到 HTTP 或结束边界时保留 `null`。HTTP 无响应不能用来区别 CORS、断网或远端仍在等待。

同一 SSE 帧内的工具参数与 finish 共用帧号。工具结束事件通过 `derivedFrom` 标明来自 choice 完成、内容块关闭还是完整工具值。导出按客户端处理次序排列，同帧内没有更细的供应商生成时序。

事件按固定类型保留前 32 条和后 32 条，计数覆盖全部观测事件，`omittedEvents` 提示省略量。使用原有六条临时响应容量、单条诊断容量和总内存预算。录制过程不逐帧通知 React，结束才随原阶段记录封存。刷新、切档、清理和淘汰继续受原有临时记录边界约束。下载后的本地文件由玩家保管。

导出只投影允许的元数据。模型名称仅保留符合标识形式的值，并检查已知凭证及存档、草稿标识。渠道只写官方、中转或本地分类。文件不含 API Key、Authorization、完整 URL、提示词、故事正文、工具参数、调用 ID、公开思考或供应商任意错误文字。没有遥测和自动上传。

## 顺序失败如何区分

公开错误仍是 `tool_response / storyTool.ordering`。新增的 `orderingSite` 只保存在临时诊断内。

| 原路径 | 诊断枚举 |
| --- | --- |
| 组装器拒绝结束后的思考或重复 finish | `reasoning_after_finish`、`duplicate_provider_finish` |
| 组装器拒绝 finish 或 message_stop 后的工具事件 | `tool_event_after_finish`、`tool_event_after_message_stop` |
| message_stop 重复或早于工具和模型结束 | `duplicate_message_stop`、`message_stop_before_required_boundaries` |
| 工具作用域不匹配，或快照和增量冲突 | `missing_or_closed_slot`、`snapshot_delta_conflict` |
| 投影器发现已关闭 slot 重开、未开始即收到参数或结束、重复块关闭 | `projector_reopened_slot`、`projector_arguments_without_open_slot`、`projector_end_without_open_slot`、`duplicate_content_block_stop` |

OpenAI 兼容中转在工具已经关闭之后追加参数，会先被投影器拦下，实际诊断为 `projector_reopened_slot`。失败帧的 `argumentsPresent`、`toolIdentityPresent` 可以区分仅补参数和重发工具身份，观察值只保留布尔类型。重复 finish 仍拒绝。同帧最后参数与合法 finish、随后只有 usage 的尾帧仍可通过。没有 DONE/EOF 的流在总时限到期时仍失败。

## 修改范围

- `storyToolTrace.ts` 新增有界、请求局部的元数据收集器。`client.ts`、`responseEvents.ts` 和 `sse.ts` 在现有读取与终止点观察。
- `storyToolContract.ts`、`toolResponseEvents.ts` 和 `storyToolAssembler.ts` 为已有拒绝分支标注固定枚举。
- `runtime.ts`、`stageResponses.ts` 将封存摘要放入原有临时响应记录并生成下载投影。`StageResponsesPanel.tsx` 提供双端入口。
- `story-tool-trace.test.ts` 和 `e2e/story-tool-output.spec.ts` 验证等价性、脱敏、失败、下载和回归。

## 验证方法与证据

定向原生 Vitest 27 项。四协议的 SSE、JSON 对照逐项比较出站 URL、请求头、序列化请求体、响应与小说回调。虚拟时钟覆盖 HTTP 前、HTTP 后、心跳后、工具参数后及结束边界缺失，确认开启与关闭观察时使用同样的 120 秒和取消结果。协调器测试对比三个阶段的请求体 SHA-256 和正式存档，只有随机下一回合 ID 与操作时间戳从比较投影中排除。成功流程各执行 3 次 Mock 模型请求、1 次 Commit。失败流程各执行 1 次 Mock 请求、0 次 Commit，正式状态和合法失败草稿一致，无正文候选或可续写片段。

首轮新单测的五项失败源于夹具或期望。分别是把投影器拒绝写成组装器拒绝、usage 夹具使用了错误字段、取消前未给出合法终止帧的处理机会、两个对照夹具的创建时间不同导致两项哈希/存档比较失败。修正的是测试条件。浏览器首轮误连已被其他工作区占用的 5174 端口，两个用例实际发送普通文本请求。正式双端验证使用 5368 专用端口，关闭服务器复用，继承项目的桌面和移动端配置。

测试全部使用合成资料与 Mock。实际中转的失败原因仍须用这次补丁获得的脱敏轨迹判断。当前没有真实模型对照或默认开启的验收结论。

| 正式命令 | 结果 | 退出码 |
| --- | --- | --- |
| npm ci | Node 24.19.0 / npm 11.9.0，安装 143 个锁定依赖包 | 0 |
| npm run check | Vitest 5.0.5，190 文件 / 4755 通过，0 失败或跳过；ESLint、TypeScript、目录、catalog、Vite Build 通过 | 0 |
| npm run prompts:check | 93 通过，属于全量测试集合 | 0 |
| vitest run src/tests/story-tool-trace.test.ts | 27 通过，属于全量测试集合 | 0 |
| playwright test e2e/story-tool-output.spec.ts | Playwright 1.64.1 / Chromium 154.0.8037.57，PC 8、手机 8，0 失败或跳过 | 0 |
| git diff --check | 通过 | 0 |

浏览器覆盖默认关闭、开关保存、合法 SSE 原文和原子结算、混合文本、多工具、不完整参数、取消迟到、主动续写以及主动下载。实际下载 JSON 中两次 finish 分别来自第 3 帧和第 4 帧；第 4 帧触发 `duplicate_provider_finish`，`boundary` 为 `null`，只执行了一次 Mock 请求，正式存档保持不变。手机为 Chromium 移动配置。

- [PC 脱敏下载示例](./desktop-redacted-example.json) · [截图](./desktop-diagnostic-entry.png)
- [手机脱敏下载示例](./mobile-redacted-example.json) · [截图](./mobile-diagnostic-entry.png)
- [原始执行日志与隔离端口配置](./logs/)

复现浏览器批次时，复制日志目录中的配置为 `playwright.config.mjs`，按本地目录调整绝对路径和端口，使用项目依赖运行 `CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-tool-output.spec.ts --config <配置路径>`。所有模型响应来自测试运行时启动的本机 Mock 服务。
