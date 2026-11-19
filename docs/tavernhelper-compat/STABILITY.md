# 预设 Story 请求稳定性复核

复核对象为 PR #201 的 `a5b6de3ea8f61ba26d7ffc92958cb273e6aaf8f3`，main 基线为 `5358a36196206e9bad9b06367eaf3fa3768a0db2`。实际传输全部使用合成数据和 Mock。

## 两份试玩样本

| 样本 | 浏览器已经证明的事实 | 归因边界 |
| --- | --- | --- |
| A | 一次上游请求，HTTP 200，识别出 SSE，共读取 449 字节。截止时上游未完成、包装仍待返回，最终错误为 timeout。 | 旧诊断没有逐阶段时刻，也没有说明字节的用途。后台的 cancelled_no_content、33,168 输入和零输出缺少共同请求标识。无法判断是模型、转发、读取还是包装停顿。 |
| B | 约 50,201 字节，上游 stop，实际完成且包装器已还原。Story 在 guide_json 规则拒绝了变量规划。 | 故障发生在正文业务校验。保持原有严格判定。 |

没有从这两个样本确认浪潮独有的运行缺陷。离线复现了一项独立的共享读取缺陷，触发前提包括上游已经完成，故无法解释样本 A 中的 complete=false。

## 已修复的结果误报

在同一尝试中，脚本可消费合法上游响应，然后提供自己的 ReadableStream。下游遍历读到 DONE 或遇到损坏 JSON 后退出；原 readSse 在 finally 中等待 reader.cancel()。某些包装流的清理 Promise 还要等另一个分支，与正文是否读完无关。两个控制用例保持该 Promise 未决，旧版分别将合法回复和 invalid_json 都报成 timeout。

现仅对预设包装响应启动取消、接住清理拒绝并释放读锁；返回解析结果无需等待该清理 Promise。调用方仍核查真实上游结束、完整性、残留工具、非空内容；随后才进入 Story 校验。测试显式释放构造的未决 Promise。宿主无法保证任意第三方脚本内部都能释放其自有资源。[读取与清理](../../src/services/ai/sse.ts) · [调用和上游核验](../../src/services/ai/client.ts) · [可控复现](../../src/tests/tavern-backend.test.ts)

## 单次尝试如何计时

| 执行边界 | 可从本次诊断读取的证据 |
| --- | --- |
| Story 开始、等待宿主、前置生成事件 | 所有时刻从同一次 StoryStage.generate 入口用 performance.now() 计相对毫秒。waitedForInitialization、assistantReadyMs、generationEventsDoneMs 标识越过相应边界的时间。请求准备在本地完成。 |
| AiClient 开始计预算、实际发送、到达响应头 | timeoutSeconds 和 budgetStartMs 对应原有的单个计时器。settingsReadyMs 标记工具准备和最终设置监听已结束。sentMs、headersMs 标记调用上游传输与其返回 Response。 |
| 单一上游 reader 读字节 | firstByteMs、lastByteMs、byteChunks 对应非空数据块。comments 只统计读到的 SSE 注释行；dataEvents 和首末 SSE 时刻对应解析器交出的数据事件，包含协议终止帧。 |
| 有效生成进展 | 独立标记 firstContentMs、firstArgumentsMs 和 firstReasoningMs，lastProgressMs 只在观测到这些内容时推进。content 可能带标签，正式正文须通过后续校验。完整 JSON 的字段在解析时才能观察，无法反推模型开始生成的时刻。 |
| 上游、包装、业务与保存 | upstreamCompleteMs 为上游完成检查结束。wrapperReturnedMs 是包装 fetch 返回 Response 的时刻，流式时仍可能在生成；restoredMs 为客户端收到可用还原文本。clientEndMs、validationEndMs、draftSavedMs 分别标识客户端结束、严格校验结束、成功保存候选。candidateSaved 只代表草稿候选。 |
| 中止 | 原计时器在 abort 前记录 deadlineMs、deadlinePhase；外部取消独立记录 userCancelMs、userCancelPhase。等响应头、等首字节、已挂起的上游 read、上游未消费完整、上游已完成而包装未交付各有区分。一次快照无法证明暂停由哪台服务器或哪段脚本造成。 |

初始化、生成前置事件、提示词准备在模型请求预算外，可由原请求信号取消。工具声明、最终设置事件、页面 fetch 包装、上游等待、读取及还原共享一次 AiClient 总预算；到达首字节、收到心跳或产生进展均不会重置时钟。Story 严格校验和草稿事务在该预算结束后执行。若在发起请求前初始化即失败，应查看宿主的脚本状态与错误位置；此时可能尚无响应记录。fields 只在相应事件发生时提供，无采样轮询、第二个 reader 或逐帧正文日志。[Story 入口](../../src/workflows/storyStage.ts) · [生成事件](../../src/presets/tavern/events.ts) · [时间字段](../../src/presets/tavern/timing.ts) · [传输](../../src/presets/tavern/backend.ts) · [阶段记录](../../src/services/ai/runtime.ts)

玩家遇到超时时，在刷新前打开 **三阶段 → 正文 → 模型原文 → 复制本次诊断**。手机已打开「重试与变更详情」时，可切到「模型原文」，展开三阶段记录及「正文模型原文」后复制。先看 deadlinePhase、预算起点，再对照首末字节、生成进展和 upstreamCompleteMs。新增字段仅有计数、布尔值、固定阶段与相对毫秒，只随本页临时响应保存。原文、凭证、原始头、地址和存档身份均无需提供。[显示与复制](../../src/ui/game/StageResponsesPanel.tsx)

## 哪些接口供第二个预设复用

- 内置目录负责选择包、读取包资源和按包捕获覆盖配置。实例宿主按声明加载脚本，提供事件、工具注册、变量作用域和页面 fetch；生成前固定快照，一次性关联在首次调用时消费。共享协议层只识别协议内容、参数增量和真实结束边界。[目录](../../src/presets/library.ts) · [脚本宿主](../../src/presets/tavern/scriptHost.ts) · [请求关联](../../src/presets/tavern/fetch.ts) · [上游归一化](../../src/presets/tavern/upstream.ts)
- 浪潮资源、控制表、编辑器及其专属响应还原由该预设提供。通用时钟与协议读取器均无需知道脚本 ID、工具名称或正文标记；接口扩展仅用于传递单次时钟、接入计数和选择包装流清理方式。[设置适配](../../src/presets/peintureSettings.ts) · [专用控制台](../../src/ui/settings/PeintureSettings.tsx)
- 独立合成包只存在于浏览器测试，在测试页的资源导入处替换目录项，使用正式 iframe、事件、客户端与仓库。它增加自己的请求消息，读取普通 content 里的 JSON 成员 folio，独立保存脚本启动次数。它使用 OpenAI 兼容 JSON 与 Gemini SSE，不依赖浪潮工具或还原格式。六次请求复用同一存档、同一回合：首次初始化、再生成、只收注释超时、取消、还原失败、恢复。断言每次恰好一次传输，三次失败完整保留已有草稿、正式状态不变；切回浪潮并刷新后旧实例消失，两个包的覆盖数据分别校验。首次初始化特意超过 1 秒，随后仍可在 1 秒请求预算内完成。[合成资源](../../e2e/fixtures/folioPreset.ts) · [完整流程](../../e2e/tavern-assistant.spec.ts)
- 正式目录仍只有一个玩家预设。玩家导入、附页、全部酒馆 UI／API、任意主动生成、多次模型工具 follow-up 和无刷新热切换均不在当前支持范围。Variables、World、Memory 继续经原生渠道；原有浏览器回归逐字段比较其请求。真实模型成功率、中转的计费与内部排队策略、真机 Safari 均未验证。

## 可重复的比较

在旧 HEAD 的独立工作区与返修版各运行同一份 tavern-backend.test.ts。旧版 82 通过、18 失败；两项暴露清理吞掉结果，十六项缺少新时序记录。返修后该文件 100 通过。下表为两版各 48 次尝试，使用同一组可控时钟、每个场景重复三次，全部均恰好一次上游传输。表内毫秒是合成时间，不用于估算真实网络性能。

| 场景 | 每版结果及虚拟总耗时 |
| --- | --- |
| 完整 JSON、正常 SSE、延迟首个文本、暂停后恢复、分段工具、length 带可校验文本 | 18 次交付客户端，依次为 100、250、830、550、250、250 ms。length 保留标识，由原有业务层判定是否可保存。 |
| 等待响应头、只有心跳、半个数据帧、只有 reasoning、上游完成后包装停顿 | 15 次 timeout，均在 1000 ms；新诊断可区分所处位置。 |
| 玩家取消、网络读取异常、供应商 cancelled_no_content／cancelled、包装抛错 | 3 次 cancelled、9 次 stream_interrupted、3 次 invalid_output，均在 250 ms。 |

运行 `PRESET_MOCK_EVIDENCE=1 npx vitest run src/tests/tavern-backend.test.ts --silent=false` 可逐次查看输入场景、结果和时间。另有原生／预设两条路径，各自验证 JSON、SSE、无输出超时及主动取消。四协议的真实浪潮脚本通过生产预览回放；OpenAI 兼容及 DeepSeek 的工具参数分成两个协议事件交付，再由脚本还原并经游戏校验。[生产浏览器用例](../../e2e/peinture-settings.spec.ts)

生产预览在桌面／手机模拟 Chromium 各通过 15 项。四协议各两种响应格式的 8 次实际浏览器测量，从点击生成到发出上游请求，桌面为 207～586 ms，手机为 269～651 ms；到还原完成分别为 229～665 ms、290～692 ms。只收到一个注释的对照在两端都于预算起点后 1000 ms 超时，记录 upstream_read、一次调用、零数据事件、未保存候选。浏览器宿主及原生旁路的开发模式回归另有 14 项通过。一次在 Vite 热更新期间运行的开发模式检查出现重复模块状态和 9 项失败；冻结源文件、重新启动开发服务器后原样重跑通过。两批浏览器结果分别统计。[26 份浏览器临时时序摘录](stability-browser.json)

本地使用 Node 24.19.0、npm 11.9.0、锁定依赖、Vitest 5.0.5 和 Chromium 154.0.8037.57。安装使用工作区已有的 npm 缓存。定向 Vitest 共 8 个文件 361 项通过，Prompt 专项 93 项通过；这些用例与全量检查有重叠。
