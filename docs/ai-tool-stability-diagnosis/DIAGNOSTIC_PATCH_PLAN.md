# 最小诊断补丁方案（待审查，未实施）

目标是解释一份具体请求如何结束，**不改变其发送、接受、超时、取消、重试或保存行为**。沿用 #191 的单一 reader、统一事件层及原有临时记录，保持 Story Tool 默认 false。诊断本身不探测 API，不索取原始请求/剧情，不读取生产密钥。

## 1. 必要文件与职责

| 文件 | 拟定最小修改 |
| --- | --- |
| client.ts | 请求局部 monotonic 时钟、实际 dispatch/HTTP/最终结果采样；operation 超时/取消失败相位；finally 一次封存；观察异常不影响业务 |
| sse.ts | 在现有 reader.read 成功后观察首个非空 body chunk；在完整 SSE 帧交出前观察白名单元数据；不复制/tee/额外读取响应体 |
| responseEvents.ts | 同一 wire sequence 的结构/结束白名单观察、实际 transport、DONE/EOF；区分原生帧与内部派生事件；projector 抛错也保留失败 source |
| toolResponseEvents.ts / storyToolAssembler.ts | 为现有 guard 添加固定枚举的拒绝 site 观察，工具事件计数；仍抛原来的 tool_response 与 fieldPath，不放宽一项校验 |
| responseContent.ts | 为现有 ResponseDiagnostics 增加严格类型的 transport/tool 摘要，避免 any/任意供应商对象 |
| runtime.ts / stageResponses.ts | 附加到现有 responseId/版本，复用六条记录与诊断容量；清除/淘汰后不能被迟到事件恢复 |
| 现有阶段详情/请求检查器相关组件 | 只增加主动“导出诊断”入口；序列化专用白名单投影，不序列化原文/完整 inspection；双端同源，不重做工作流 |

如可在上述现有文件中容纳，不新增公共传输器、生成工作流或独立响应日志 Store。纯投影/类型辅助可单独小文件，但不持有第二套请求历史。

## 2. 精确观察点

以 performance.now() 为相对时钟。墙上时间最多留一次 startedAt 便于对照日志；未知字段为 null/absent，不能填 0 伪装成即时返回。

- operationStartedMs：现有超时开始计时处；timeoutSeconds 使用请求快照。
- dispatchMs：真正调用现有 transport 的时刻，与前面的统计/准备分开。
- httpHeadersMs：fetch resolve 且拿到可读取 Response；状态码、ok，不记录 headers 内容。
- firstBodyChunkMs：现有单一 reader 第一次交出非空字节的时刻。称为“浏览器首次可读正文 chunk”，不冒充服务器 TTFB/网卡时刻。
- firstSseFrameMs：第一个完整 SSE data 事件；ping/注释不算 data 事件，可另计心跳次数但不存文本。
- firstToolEventMs、firstArgumentsMs、lastArgumentsMs：内部工具事件实际投影/收到时刻；明确其 wire sequence。第一次参数事件和第一次非空参数可各一项，避免空增量制造“已开始正文”。
- providerFinishMs：实际收到的结束原因，可保留有界序列，不用最后一项覆盖前一项。
- lastWireEventMs / lastToolEventMs：分别统计，不能混为同一事件时间。
- doneMs / eofMs / messageStopMs：分别表示真实观察到的标记，未观察则缺省，不合成。
- finishedMs / totalMs / phaseAtFailure：整个 generate 成功/失败返回；明确 finished 不代表原子 Commit。

**完整 JSON 的首字节**：当前 response.json() 不暴露 chunk 时刻，不能用 JSON 解析完成时间代替首字节。若需完整覆盖，在同一响应体单消费链上增加纯透传字节观察，并验证 Response.json 的 UTF-8/BOM/空体/错误/取消行为完全一致；不允许 clone/tee 后额外消费。若不能证明等价，先给 firstBodyChunkMs=null 与 unavailable 原因，仍提供 HTTP 与 JSON 完成时间；这个限制必须在界面/导出中准确标注，不能宣称已测到。

## 3. 事件摘要与拒绝 site

每项摘要只能有枚举、布尔、受限整数与相对时刻：wire sequence、事件类型、slot、是否有 ID/名称、是否符合预期工具名、参数 delivery 是 delta/snapshot、finish 是否存在及合法值、边界类型。

**不得保存**：arguments 文本/片段、JSON.content、公开或私密推理、思考签名、调用 ID 原值、任意工具名原值、供应商错误描述、提示词/消息、实体内容、请求头、URL 查询参数、Authorization 或任何密钥。是否有 ID/名称与合法性足以诊断本轮顺序，不需要原值。

现有 tool-end 要标明来源：choice-finish / content-block-stop / complete-value，它不是独立原生结束帧。记录“收到 frame N → 内部 response/tool-arguments/tool-end 均来自 N”，不伪造内部同帧事件的网络先后。

建议固定 site 枚举，例如：

```text
reasoning_after_finish
duplicate_provider_finish
tool_event_after_finish
tool_event_after_message_stop
missing_or_closed_slot
snapshot_delta_conflict
projector_reopened_slot
projector_arguments_without_open_slot
projector_end_without_open_slot
message_stop_before_required_boundaries
duplicate_message_stop
```

由真正命中的 guard 填入；不能根据最终错误码反推一个 site。保留原 errorCode=tool_response、fieldPath=storyTool.ordering，site 放在诊断摘要，不进入 GameState/TurnDraft/普通运行日志。参数是否完整仍由既有解析器决定，不引入为了诊断而“修复”参数的解析器。

projector.project() 可能在返回其事件数组前抛错，必须在输入帧白名单投影时留 source/形状，并在该 guard 记录 site；否则仅监听成功 yield 的工具事件会漏掉关键失败帧。导出应区分 observed frame、projected event、accepted state，不能把已观察内容说成已接受内容。

## 4. 结束原因、模型与渠道的隐私投影

- 请求协议、requestedStream、observedTransport、请求时的模型 ID；模型 ID 使用原合法标识并再次隐藏所有已知凭证及授权样式，限制长度，异常值显示已隐藏。不导出玩家自定义渠道名称和完整地址。
- endpointKind 可为官方/中转/本地/未知，基于明确配置或严格主机规则，不根据模型名推断。不记录完整 host/path/query 作为默认导出内容；需要进一步定位时由玩家另行提供不含密钥的信息。
- 供应商 finish 原因：在已知有限枚举内保留实际大小写/取值和来源字段，不把 tool_calls 改成 stop。未知任意文本不能未经筛选导出，记录 unrecognized/type；若未来确需原始未知值，必须先制定单独安全规则。
- 最终仅导出安全 errorCode、fieldPath/StoryRule 白名单及 guard site，不包含整个 error.message、堆栈或响应 JSON。
- 可包含真实 usage 的合法数值；没有 usage 时保持未知，不能由已接收字节数反推 Token/费用。

## 5. 请求身份、容量和生命周期

- 内部复用 stageResponses.begin() 的 responseId、save/turn/version 范围；每次请求独立，不能只按 turnRef 覆写。
- 对外导出独立 attemptId，并用页面内匿名 turnGroup 关联同回合的重试，不导出真实 saveId、turnId 或正文摘要。导出里明确 request 与 scenario 的区别，不能自动计算“独立回合成功率”。
- 计数器可累计全部事件；有界轨迹建议最多 128 条（保留开头与末尾），超出时写 dropped/traceTruncated，不改变接收或校验。最终常量应能装入现有 16000 字符诊断容量，并计入原总内存预算；不扩大记录数量。
- 高频事件只更新请求局部数值/有界 ring，不逐帧触发 React 渲染；复用 50ms 观察节流或在关键里程碑/终结时发布。
- 成功、失败、超时、取消后只封存一次；迟到回调不能改变最终错误或覆盖新请求。取消后允许一次无内容的终结元数据封存，但不恢复原文回调或已被 clearSave/clear/淘汰的记录。
- 只在玩家点击后创建本地 JSON Blob/下载；不 fetch、不上传、不打 telemetry。关闭/刷新/清除仍按现有临时记录生命周期；不写 IndexedDB、GameState、草稿或普通日志。
- 诊断代码自身异常、容量满、下载失败不能改变模型请求的结果、次数或保存结果。

## 6. 拟议验收（实施后执行，当前尚未完成）

1. 重用本目录 28 项 Mock，以原真实 client/runtime 为基线，打开/关闭观察器的请求 body、调用次数、终结错误和候选逐项完全一致。
2. 七种时间相位准确，缺失观察点为 null；120 秒 timer 不被参数或心跳重置；超时不增加请求。
3. 四协议 JSON/SSE，任意 UTF-8/标签/参数分块，stream→JSON、MIME 错误、中断、过滤、length、缺结束、重复尾帧和多工具。顺序 site 来自命中的 guard，不由码推断。
4. 同帧最后参数+finish 保持通过；纯 usage 尾帧保持通过；真正提前/迟到/冲突继续拒绝。
5. 注入合成密钥、Authorization、私人剧情哨兵、原生 reasoning、恶意 model/finish/eventName，最终导出没有任何值泄漏；不把完整 RequestInspection/StageResponse 塞进 JSON。
6. 同回合多个 attempt、取消/超时迟到、清空/切档/撤回/Commit 后定位，不串记录；128 轨迹上限、16000 字符和原 Store 总预算被实际覆盖，高频不产生逐帧 React publish。
7. 正式 Repository 失败状态不变，正常 Story→Variables→World→Commit 仍恰好一次；诊断与导出不写库、不启动自动请求。
8. Node24 npm ci、完整 check、prompts:check、diff check；PC/手机 Chromium 主动导出、关闭、复制/滚动、刷新生命周期，原文仍只有原连续文本区域。无需扩展无关全量 E2E。

## 7. 暂不实施的行为修复

- 不延长或动态重置总超时；如未来需区分首响应/空闲/总时限，应单独作为产品决定，不混入观察补丁。
- 不因参数 JSON 可解析就提前成功，不把 finish 当 EOF，不编造 done/tool-end，不忽略 finish 后的数据。
- 不因“可能只是重复”而去重所有 finish。若真实轨迹证明某中转只有等价、无新内容且无矛盾的尾帧，才提出单独的最小容错规则及反例，等待审查。
- 不修改 Story 协议、Prompt、续写、Variables/World/Memory、CAS、Commit 或费用重试规则。

**本方案待独立审查后实施；真实对照仍需负责人批准预算。当前默认关闭不变。**
