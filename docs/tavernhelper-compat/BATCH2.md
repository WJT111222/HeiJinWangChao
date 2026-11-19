# 第二批 · 预设 Story 的虚拟后端

基线为第一批复审提交 `e96761403e929025d47d8a5f3235b55eb9cd049c`，main 为 `ebcf6951a2de0b3c3446f72965ceb12cd5c2e3c2`。范围是内置预设 Story。所有验证使用自写监听器、包装器和合成模型响应。

## 一次生成经过哪里

1. StoryStage 捕获全局预设选择、游戏设置、渠道和凭证，照常取得草稿锁并核对版本。runtime 冻结组装输入。既有候选或失败记录的重新生成使用 regenerate，主动续写使用 continue，其余为 normal。
2. 启动时 `installTavernFetch` 保存绑定到页面的原始 fetch。原生 Story、Variables、World、Memory 使用原始传输。兼容 Story 在实际发送时读取页面当前的 fetch，因此晚安装的包装器可以修改请求和响应。测试注入的上游 transport 同样有效。
3. 每次尝试通过本地请求头关联到一次性处理函数。分派器仅拦截同源 POST 到 `/api/backends/chat-completions/generate`，在第一个异步读取前领取该次上下文。包装器可传相对地址、Request 或 init，须保留关联头；缺失或重复使用会失败。其他路径与方法沿用原始 fetch。未领取的关联在完成或取消时删除。
4. 虚拟后端解析**包装器最终发送的 body**，用冻结渠道生成 wire，保留实际生效的 messages、tools、tool_choice 和采样期望值，复用第一批对真实出站字段的省略、参数学习和请求检查。渠道控制模型、地址、凭证和最大输出量。无需部署请求代理。
5. 原始 HTTP/流经同一个读取链归一化。包装器先读归一化 Response，游戏再消费包装器最终返回的 Response。只将得到的普通文本送回原来的 Story Envelope、时间及领域校验、候选版本与 Repository CAS。该层没有写正式世界或执行工具的入口。

## 事件与工具

在两个生成起始事件之后，正式组装包含预设、宏、当前游戏资料和发送正则。固定版本的 Chat Completions 会先在 prepareOpenAIMessages 内发 Prompt Ready，之后 Generate 才发 After Data。两处分别传入 `{chat,dryRun}` 和 `{prompt},dryRun`。干跑到此返回实际 messages。正式请求再等待工具注册条件与 Settings Ready，然后才序列化。监听器对 data 的最终改写优先。终止通知按兼容聊天投影给出条目数，不代表正式结算。[Generate](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/script.js#L5285) · [Prompt Ready](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/scripts/openai.js#L1619) · [Settings Ready](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/scripts/openai.js#L3146)

`tavernEvents.on/remove/emit/emitAndWait` 支持 first、last、once、停止监听和重入。emit 顺序等待监听，emitAndWait 同步分派。宿主在影响出站的 emit 中也等待 once 的返回值，监听失败阻止本次发送；这点有别于上游的 once 包装和异常后继续分派。取消与结束通知不改变既有结果。`tavernTools.register/unregister/apply` 管理声明，按次等待 shouldRegister；continue 不自动注册。监听器可自行指定、替换或清空工具。没有工具执行或 follow-up 请求循环。[固定版事件分派](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/lib/eventemitter.js#L129) · [工具注册](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/scripts/tool-calling.js#L400)

## 四协议 Mock 矩阵

| 渠道 | JSON 和 SSE | 工具选择与声明 | 中途 system |
| --- | --- | --- | --- |
| OpenAI 兼容 | 文本、工具、错误均有定向用例 | 保留 OpenAI 函数、Schema、choice、并行选项 | 原角色、顺序 |
| 原生 DeepSeek | 同上，使用 DeepSeek 渠道快照 | 保留函数与 choice，显式并行参数拒绝 | 原角色、顺序 |
| 原生 Gemini | candidates、独立 thought、functionCall 与 usageMetadata | functionDeclarations 使用 parametersJsonSchema；auto/none/required/指定分别映射 AUTO/NONE/ANY/ANY+名单。显式 parallel 或 strict 拒绝 | 起始 system 进入 systemInstruction，后续 system 按原位置以带 [system] 来源标记的 user 文本发送 |
| 原生 Anthropic | content/tool_use、input_json_delta、message_delta 和 message_stop | input_schema，选择映射 auto/none/any/tool，显式并行映射 disable_parallel_tool_use。开启 thinking 时拒绝强制工具 | 起始 system 进入 system，后续同 Gemini |

矩阵分别验证未指定、auto、none、required、指定工具。中途 system 的转换保留内容、位置和来源标记，其指令优先级会降为用户消息。首期支持单候选文本消息；assistant prefill、未经支持的工具选择和结构化图文消息会报错。Gemini 接收完整 functionCall 快照，可按 ID 去重；缺少上游 ID 时生成仅供下游引用的本地编号，无法确定的跨帧重复或部分参数协议明确拒绝。Anthropic 保留工具块索引到调用索引的映射。Schema 关键字随声明传输，真实供应商是否接受特定 Schema 未经验证。[酒馆的 Claude 转换](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/prompt-converters.js#L232) · [Google 转换](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/prompt-converters.js#L432)

## 结束、计量和下一批接口

每次尝试的临时阶段响应记录带有 tavern 摘要，包括生成调用数、成功响应读取字节、HTTP 状态、上游结束原因、边界、真实 usage、归一化格式、包装器是否返回及上游错误。HTTP 错误体沿用原参数兼容处理，不将其字节冒充可读的生成内容。SSE 逐帧读取，中文按 UTF-8 解码。只有真实结束且工具参数完整才允许包装结果进入正文校验。包装器留下工具、提前返回成功、上游过滤或断流均不能生成候选。真实 length 保留给现有完整性及续写规则。计量来自上游，包装器合成的 usage 不进入实际用量。

第三批可连接上述事件与工具注册入口，在启动分派器之外包装页面 fetch，通过 `previewTavernStory` 取得预览。真实社区脚本、iframe 生命周期、完整全局对象、真实模型和供应商收费均未验证。

## 验证证据

Node 24.19.0 定向 Vitest 共 11 个文件、389 项通过，ESLint、TypeScript、Vite Build 和差异检查通过。最终提交的全量 CI 单独计数，见 PR 验收留言。Playwright 在桌面与手机 Chromium 检查实际页面 fetch、监听器和包装器双重改写、工具还原正文、正式 Repository 草稿、取消及原生四阶段旁路。首次运行出现开发服务器的预设模块加载失败；在隔离端口运行当前提交，两端均通过。没有运行无关的全量浏览器套件。[协议与事件用例](../../src/tests/tavern-backend.test.ts) · [草稿与续写](../../src/tests/story-stage.test.ts) · [双端浏览器](../../e2e/tavern-backend.spec.ts)

## 第二批独立复审返修

复现基线为 `8b7f73c641c7e4e3dc67eb9a961d0ba9d358d7c9`。在 Node 24.19.0 的正式 Vitest 中，新增 11 个用例先得到 4 失败、7 通过。Anthropic 的文本与工具流在真实 `message_stop` 后保持 HTTP 响应体打开，两个用例均触发防挂看门狗。Gemini JSON 和 SSE 的无参调用都提前报 `tavern.upstream.tool`，包装器无法取得合法调用。

| 路径 | 修复与验证 |
| --- | --- |
| Anthropic SSE | 虚拟后端先逐帧收集文本、工具增量、真实 finish 和 usage。解析到顶层 `message_stop` 后立即执行原结束检查，包括工具块闭合和参数完整性。成功时归一化流只交付一次 `[DONE]`，现有 SSE 迭代器在退出时取消上游读取并释放锁。保持连接打开的测试验证了这些结果，并检查底层取消恰好一次、原始流已解锁、诊断无错误。缺少真实边界、未闭合工具块、损坏 JSON、上游报错与完成前取消分别验证。 |
| Gemini JSON、SSE | 完整 `functionCall` 仅在自身缺少 `args` 时按空对象序列化，再按原规则去重和分配索引。正式 AiClient 和页面包装器收到同 ID 的单一空参数调用，另两个匿名工具的身份、顺序和参数也与输入相符。原样返回这些调用时，客户端报 `tavern.unhandled_tool`，每次尝试只有一次 Mock 上游传输。显式非法值、部分参数、空名称和缺少结束原因继续失败。 |

生产修改限于 [协议归一化](../../src/presets/tavern/upstream.ts)。新增 11 项全部转绿，随后运行的 15 个定向测试文件共 474 项通过，包含这 11 项。该批还覆盖四协议、原客户端、第一批预设采样、Story 续写、取消和正式保存。ESLint、TypeScript、生产构建与差异检查通过。既有 [Chromium 冒烟](../../e2e/tavern-backend.spec.ts) 桌面、手机各 1 项通过。完整 CI 以本次提交对应的 PR 检查为准。本轮使用合成响应，未验证真实供应商及第三方包装器，未运行无关的全量浏览器套件。
