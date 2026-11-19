# 一次心跳后读取异常的调查

调查基线为 PR #191 的 `23b7881d6dcbe48c224885d7967d9e31875a308d`。**结论 D。** 客户端确实观察到响应体读取失败，位置已经确定。要回答哪一跳先关闭连接以及为什么关闭，还缺中转上下游的关联记录。两次相近的耗时使固定时限值得优先排查，现有样本不足以选定具体时限或责任方。

## 两次真实观测

| 相对请求开始 | 前次 | 本次 |
| --- | ---: | ---: |
| 收到 HTTP 响应 | 51.615 s | 51.445 s |
| 首个非空数据块 | 51.616 s | 51.448 s |
| 应用报告失败 | 90.753 s | 90.710 s |
| 从首块至失败 | 39.137 s | 39.262 s |

本次成功读到一块 8 字节数据，分帧器识别一行注释和一个空行。这个形状符合心跳，注释内容和生成方未知。随后等待下一次读取时，reader 的 Promise 拒绝。采样时应用信号未中止，未见正常 EOF、完整数据事件、工具参数或结构化供应商错误。浏览器可观测的总耗时包含应用侧处理，并非任一代理的计时器读数。前次记录缺少读取位置和块总数，尤其不能把前次的 39.137 秒也断言为全程无字节。

## 客户端审查

- StoryStage 在请求前快照设置，传入本次尝试的 signal。运行层把选定限时交给 AiClient。客户端使用一个总计时器，同时监听外部取消。若该控制器已中止，错误出口会根据计时器标志返回 `timeout` 或 `cancelled`。收块不会重置计时器。检查这条生成链未发现独立的 90 秒总限或 40 秒空闲计时。UI、临时原文和检查器中的 50ms 定时器负责合并显示。 [StoryStage](../../../src/workflows/storyStage.ts#L72) · [runtime](../../../src/services/ai/runtime.ts#L97) · [请求时限与错误映射](../../../src/services/ai/client.ts#L60)
- 玩家可以提前取消生成。手动阶段由 StageGuard 中止当前尝试，自动流程由 TurnCoordinator 取消或释放阶段。组件卸载时两套 Hook 都会 dispose。App 用存档 ID 和撤回代数作为游戏组件的 key，切档或更换代数可以触发卸载。会话失效也可在检查点产生取消。审查未发现仅因隐藏标签页就中止 Story 请求的监听。浏览器或操作系统自行中止底层网络时，应用未必收到自己的 AbortSignal。仅凭导出无法排除设备网络、浏览器或中间链路故障。 [App](../../../src/app/App.tsx#L426) · [手动 Hook](../../../src/ui/game/useStoryGeneration.ts#L28) · [自动 Hook](../../../src/ui/game/useTurnGeneration.ts#L36) · [阶段互斥与取消](../../../src/workflows/stageGuard.ts#L12) · [Coordinator](../../../src/workflows/turnCoordinator.ts#L73)
- `reader_read` 在真实 `reader.read()` 异常且 signal 未取消时记录，普通底层异常映射为 `stream_interrupted`。UTF-8 和 EOF 残尾有各自分支。前端确实会在收到 abort 时调用 reader.cancel，也会在正常结束、消费 DONE 或错误后在 finally 释放 reader。本例的异常记录先于 finally 清理。高层只在观察到结束边界后才交给工具完整性判定。 [读取与清理](../../../src/services/ai/sse.ts#L14) · [响应事件](../../../src/services/ai/responseEvents.ts#L163) · [临时诊断](../../../src/services/ai/storyToolTrace.ts#L205)
- 出站 URL 根据所选渠道 baseUrl 构造，浏览器通过 fetch 直接请求。仓库的 Cloudflare Worker 为静态资源和公告 KV 服务，仅实现一个公告 API，其他 API 返回 404。Vite 配置也没有模型反代。第三方渠道自己的 CDN、入口网关、出口代理和上游配置均未取得。 [请求构造](../../../src/services/ai/protocols.ts#L29) · [fetch](../../../src/services/ai/client.ts#L103) · [Worker](../../../src/worker.ts#L8) · [Wrangler](../../../wrangler.jsonc) · [Vite](../../../vite.config.ts)

## 两种时限如何区分

若某一跳使用请求总时限，且从相同起点计时，首块来得更晚时，结束时刻仍应接近同一个总耗时。若使用相邻读取的空闲时限，结束应随**该跳最后一次活动**移动。两次真实请求的首块仅相差 0.168 秒，失败总时长只差 0.043 秒。两个参照点过于接近，不能仅靠拟合这两个数值识别计时器。上游和下游的计时起点、各自最后活动，以及代理缓冲都会改变计算结果。

公开文档确认这些是不同配置。NGINX 的 proxy_read_timeout 约束两次上游读取之间的间隔，proxy_buffering 影响响应何时交给下游。Envoy 分别提供流空闲、流最大时长和路由超时。Cloudflare 列出的连接限制针对特定连接段，例如表列的 Proxy Read Timeout 为 125 秒。三者均无法证明该渠道实际部署了这些软件或使用某一限值。本次直接核阅了官方文档源仓库。 [NGINX 官方文档源](https://github.com/nginx/nginx.org/blob/master/xml/en/docs/http/ngx_http_proxy_module.xml) · [Envoy 官方超时说明](https://github.com/envoyproxy/envoy/blob/main/docs/root/faq/configuration/timeouts.rst) · [Cloudflare 官方连接限制](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/fundamentals/reference/connection-limits.mdx)

中转可能生成首个心跳，也可能转发上游心跳。后续可能没有新心跳，也可能在某一跳被缓存或合并。浏览器只证明它成功读到了一个块。响应头已经发出时，中转可在仍可写的流中发送错误事件，也可能直接异常结束响应体。本例未收到完整错误事件，无法据此推断上游曾拒绝、过滤或截断模型输出。

## 受控 Mock

Node 24.19.0、Vitest 5.0.5，使用正式客户端、StoryStage、隔离 IndexedDB 和虚拟时钟。12 项通过。每项只发 1 次 Mock 请求，正式状态逐项与运行前深比较相等，commit 调用均为 0。成功时保存一份合法 Story 候选，非取消失败保存既有草稿失败元数据，取消或 dispose 无草稿写入。外部时限在夹具中人为注入，不涉及真实网络或真实模型。

| 注入条件 | 首块／结束（秒） | failureSite／readerEof | 结局／候选 |
| --- | --- | --- | --- |
| 总时限；首块后空闲时限（两项） | 51.448／90.710 | reader_read／false | stream_interrupted／无 |
| 首块延后 10 秒，总时限 | 61.448／90.710 | reader_read／false | stream_interrupted／无 |
| 首块延后 10 秒，空闲时限 | 61.448／100.710 | reader_read／false | stream_interrupted／无 |
| 工具出现前持续心跳，随后正常完成 | 51.448／110.000 | 空／false | received／有 |
| 一个心跳后正常 EOF | 51.448／90.710 | 空／true | tool_response（不完整）／无 |
| 一个心跳后非定时的模拟读取异常 | 51.448／70.000 | reader_read／false | stream_interrupted／无 |
| 合法工具参数分块并真实 DONE | 51.448／81.000 | 空／false | received／有 |
| 首块后静默 57.552 秒，再开始工具输出 | 51.448／110.000 | 空／false | received／有 |
| 玩家取消；组件清理调用同一 dispose（两项） | 51.448／90.710 | 空／false | cancelled／无 |
| 应用原有总超时 | 51.448／120.000 | 空／false | timeout／无 |

其中两种外部时限在相同首块时间下逐项复现了同一诊断。独立的任意时刻网络错误也能产生同一错误位置。这支持优先向连接链路取证，不能由 Mock 推算真实请求的故障概率。[逐项结果](results.jsonl)

## 最少的外部证据与处理决定

请负责人私下以本次 UTC 请求开始时间关联中转的脱敏请求 ID，对齐浏览器与中转时钟。请运营方只返回以下元数据。

1. 入口接收、开始上游请求、收到上游响应头、首次及最后一次上游读／下游写、失败或关闭的时间戳或相对耗时。只需标明心跳是否读到、是否转发及 flush，不需要行内容。
2. 此路由每一跳**实际生效**的总时限与读写空闲时限、计时起点和重置条件，以及响应缓冲与心跳转发配置。
3. 最先报告异常的方向和事件类型，如本地 deadline、idle timeout、upstream reset、downstream disconnect、正常结束。若上游先终止，再用脱敏关联 ID 获取其终止类型与时间。不要提交请求正文、错误正文、密钥、完整 URL 或原始网络抓包。

若运营方记录有超时命中，可对该路由调整对应时限或转发策略；若上游有心跳而下游无写出，检查流式缓冲与 flush；若上游先重置，核对其模型接口和流式支持，再评估可用的直连或其他接入路线。若运营方只看到客户端方向断开，需结合浏览器或网络侧同刻的连接事件进一步定位。目前没有足以批准王朝生产代码修复的证据。本轮仅交付调查与夹具。

复现命令（在该 PR 工作区根目录执行，使用锁定依赖）：

```bash
mkdir -p .pr191-connection-mock
cp docs/ai-tool-sse-interruption/connection/config.mjs.txt .pr191-connection-mock/config.mjs
cp docs/ai-tool-sse-interruption/connection/timing.test.ts.txt .pr191-connection-mock/timing.test.ts
npx --no-install vitest run --config .pr191-connection-mock/config.mjs --reporter=verbose
```
