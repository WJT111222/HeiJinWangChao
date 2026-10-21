# M5-P2：AI 分层记忆压缩与独立模型路由

## 基线与范围

从 `main@d0514af9df59f73f1cfc43717e52b58262ab7c9d`（M5-P1 PR #16 合并）创建 `codex/m5-p2-memory-compression`。交付前再次同步发现 main 新增 PR #17（仅 README 文案），审查差异后将本开发分支快进至 `d279215b99ed9954040b0a487dac485bc9ac1a65`，原样保留其文档更新，未改写 README。复用 M5-P1 的公开来源覆盖、旧档只读投影、永久 journal、即时窗口和正式原子结算；本轮只增加公开分层记忆维护，不改三阶段顺序、领域命令或正式存档 Schema。

原设计中的分层压缩本轮采用集中工程默认参数；NPC 私有压缩、删除恢复、时间调度、Embedding、备份等仍未实现。六套主提示词、用户 NSFW、双世界书、七项写作设置均保持原文/原行为。

## 架构与文件

新增：

- `src/domain/memories/compression.ts`：阈值、预算、严格批次/输出契约、来源选择和纯函数合并。
- `src/workflows/memoryMaintenance.ts`：独立维护执行器、Web Lock、请求冻结、真实资源加载、取消及保存边界。
- `src/ui/game/useMemoryMaintenance.ts`：手动/自动触发、非阻断状态、错误提示和生命周期取消。
- `src/ui/panels/MemoryMaintenanceControls.tsx`：模型、可信条目数量、阈值、费用、执行/取消/结果状态。
- `src/tests/fixtures/compression.ts`：隔离的持久记忆夹具，含不可发送的私有资料。
- `src/tests/memory-compression.test.ts`：路由、压缩、事务、来源/权限、并发和真实 Composer 测试。
- `e2e/memory-maintenance.spec.ts`：桌面/移动浏览器的模型配置、手动/自动维护、请求检查、跨标签互斥和异常。
- 本报告。

修改：

- `src/services/ai/configuration.ts`、`snapshot.ts`：独立 memory 路由和请求快照类型。
- `src/services/ai/inspection.ts`、`src/ui/settings/PromptInspector.tsx`：独立维护任务的真实请求记录、脱敏和 Token 统计显示。
- `src/ui/settings/AiConnections.tsx`：记忆总结跟随正文或独立渠道/模型选择。
- `src/ui/settings/model.ts`、`SettingsPanel.tsx`：默认关闭的自动维护偏好和明确费用说明；保留即时窗口设置。
- `src/services/storage/saveRepository.ts`：记忆局部合并事务。
- `src/domain/memories/publicMemory.ts`：完整保留部分重叠的高层摘要并标注来源范围。
- `src/ui/game/GameScreen.tsx`、`src/app/App.tsx`：记忆面板接入、新正式提交触发自动维护、仅同存档同正式版本同步 UI；版本标记。
- `prompts/memory/short_to_medium.md`、`medium_to_long.md`：原归纳职责保留，对齐严格输出协议与公开输入边界。
- `prompts/manifest.json`、`sources.lock.json`：两项资源版本、字符数、SHA-256 和适配说明；原 sourceSha256 保留。
- `DEVELOPMENT.md`、`src/workflows/README.md`、`src/prompts/README.md`：职责、专用公开输入边界及报告索引。

未新增依赖、数据库、模型客户端、凭证存储、游戏阶段或自由编辑器。

## 路由与旧配置兼容

`AiStage` 继续只包含 story/variables/world；独立 `AiTask` 允许 memory。旧 v1 AiConfig 缺少 routes.memory 时由 Zod 默认解析为 follow-story，保留所有已有渠道、参数和路由。Settings v1 缺少 automaticMaintenance 时默认 false；没有新正式存档字段或版本迁移需求。

记忆总结默认复用 Story 的渠道和模型，也可独立指定已有渠道/模型。删除关联渠道后 memory 安全重置为跟随正文。每次请求冻结实际渠道、模型、参数、凭证；中途改配置不改正在执行的请求，不偷偷回退至其他模型。

复用原 AiClient 的三协议、超时、错误分类、CredentialVault 和实际请求检查。维护记录明确为 `stage=memory, scope.kind=memory, memoryTask=memory.short_to_medium|memory.medium_to_long`，不混进六种游戏阶段预览。快照来源是客户端真实原生 payload；统计区分启发式估算与供应商实际输入/输出/总量，未提供仍显示未提供。记录仅存会话内存、最多12条、刷新清空，完整内容须主动展开，不持久化到 GameState 或普通日志。

## 阈值、批次与预算

集中常量 `compressionPolicy`：可信活跃 short **超过30**、medium **超过50** 才可触发；等于阈值不请求。按源 journal 顺序取最早最多10条，至少2条，保留新的记录。short 优先，每次显式触发只整理一批，不递归发起一串付费请求；后续正式提交或再次手动整理可继续。

原条目必须已经持久化、player_known、具备 journal 中的 sourceTurnIds、可信游戏时间且未被公开上层覆盖。internal/npc_private、无来源、未来时间、旧 M4 journal 只读投影都不进入批次。部分已被上层覆盖的残留条目保留，但不再收费重复总结。

批次数据上限16000字符/12000估算Token，完整消息上限20000字符/16000估算Token；先按完整 JSON（含容器转义）减少批次数，不截断条目或来源。最早条目过长以致不能安全凑满2条时明确拒绝、保留原文、不调用模型。估算不是精确 tokenizer，也不保证所有模型上下文长度，渠道参数仍须合理配置。

## 真实请求与输出契约

加载 Manifest 已注册的唯一对应 memory 模块，使用原 selector、loader、contextMessage、统计和 AiClient。通用 Composer 的历史 memory 分支会带完整 memories/journal，因此维护执行器使用最小的专用消息路径：system=真实资源，user=`MEMORY_TASK:{task,entries}`。不会把完整 GameState、journalProofs、NPC 资料、隐藏事件、凭证或其他记忆发送给模型。API 检查展示的就是这一实际消息，不伪造组装结果。历史文本放在转义的数据容器，不改变消息角色。

输出只接受：

```json
{"entries":[{"text":"一条完整摘要"}],"unresolved":[],"contradictions":[]}
```

严格 JSON/strict Zod，恰好一条非空、最多4000字符的完整文本。任何额外字段、未解决事项或重要矛盾均失败，不删除来源。模型不得自行输出 ID、来源、时间、可见性或引用；程序重建：

- sourceTurnIds：所选输入全部来源的去重并集，不能增减。
- affectedEntityRefs：输入 ActorRef 对象的去重并集，不接收模型字符串或臆造引用。
- createdAtGameTime：批次输入中最晚可信游戏时间，不用系统日期。
- visibility：player_known，只能从授权公开输入产生公开输出。
- ID：冻结批次（含来源凭据）的 SHA-256，幂等可追踪。

输入/输出命中当前凭证原文或常见转义形式时拒绝维护，不把凭证写入摘要或发送到模型；请求快照继续使用已有脱敏机制。归纳语义仍由模型负责，程序无法证明自然语言没有遗漏或幻觉；保留永久原文和完整来源，模型须如实报告 unresolved/contradictions，没有声称确定性校验能够完全理解文本。

## 事务、并发与取消

流程：独立同存档 Web Lock → 重读正式状态 → 选批/冻结来源及路由 → 在事务外调用模型 → 解析 → 单个 IDB readwrite 事务重读最新存档 → 核对存档身份、来源条目指纹、journal 来源指纹、权限/上层覆盖和确定性结果字段 → 同时写目标摘要并移除对应源层条目 → 等待事务 oncomplete。

维护锁为 `heijin.memory:<saveId>`，与三阶段/正式结算锁分开，网络期间不占 IDB 事务或游戏 StageGuard。跨标签使用 ifAvailable，不排队偷偷追加付费；不支持 Web Locks 明确拒绝维护，不降级为只能保护单页的锁。另有执行器和 Hook 同页重复触发保护。

来源未变时允许期间发生新正式回合：事务以最新 GameState 为基准仅合并 memories；**不增加 revision，不改 worldClock/turnNumber/journal/updatedAt/命令回执/草稿/NPC/经济/事件/任务**。正式结算原流程也在事务内读取最新存档，两者不会用旧快照覆盖新数据。来源被其他维护更改/覆盖、存档删除重建、历史变化时拒绝旧结果。已压缩来源不会再次进入可付费批次。

事务失败包括 put/abort/quota 均整体回滚，无只有删除没有新摘要的状态。生成时取消立即中止客户端请求，迟到结果不能保存；进入不可中断保存时取消返回 false，UI 禁用取消直到事务结束，不谎称取消成功。离开游戏取消尚未保存的请求；刷新不会补发维护。

## 部分重叠与上下文

正文仍严格使用 Settings 中最近 N 回合完整正文，不改 N=1/10/20 的语义或 journal。摘要按 long→medium→short 优先，在原6000摘要正文字符/12条预算内注入，另对含来源及重叠元数据的转义JSON整体设置20000字符上限。

压缩记录部分来源已被即时窗口、召回或更高层覆盖时，保留**整条原文语义**及全部 sourceTurnIds，并标记 `overlappingSourceTurnIds`/`uncoveredSourceTurnIds`。不虚构每个 turnId 对应的子摘要，不把重叠来源当新事实；同一记录不重复。完全已覆盖的记录跳过。高层摘要不截断，预算不足跳过并给出有界 omittedSummaryIds；原始存档及来源可在面板阅读。低层不得反向取代已注入高层。既有旧档来源覆盖投影继续跨层生效，不复活已压缩 short。

## UI 与付费触发

设置 → AI连接：记忆总结路由；设置 → 记忆：独立自动维护复选框，**首次默认关闭**并提示额外API费用。手动入口不受自动开关限制；没有可用批次不发请求。

记忆面板保留原短/中/长期数量、结果、来源原文与搜索，增加可信活跃阈值、模型、手动执行、取消和真实状态。查询、打开原文、刷新、改设置、Roll、仅保存候选都不自动维护。

只有新的正式提交成功且不是重复回执，才尝试自动选批；达到阈值才请求，一次一批，不阻塞下一轮三阶段生成。自动失败后当前页面暂停后续自动尝试，提示检查并手动恢复；没有后台自动网络重试/付费回退。保存偏好或刷新不请求，刷新后未来新正式提交仍可按玩家已开启的偏好重新尝试。网络取消/页面中断后服务端可能已收费，后续明确手动重试也可能收费，不能保证供应商计费幂等。

## 验证与限制

最终命令、数量与结果见末节交付验证记录。全部 Fake IndexedDB、Mock 或 Chromium 网络拦截，不调用真实付费模型。

新增测试覆盖旧配置/设置、默认与独立路由/删除/保存/冻结、三种协议实际请求与统计脱敏、30/50边界与批次预算、两层压缩持久化、来源/引用/时间/权限篡改拒绝、JSON/unresolved/contradictions、鉴权/限额/服务/超时/取消、原子失败、并发正式提交和回执、跨执行器互斥及部分重叠 N=1/10/20 真实 Composer。浏览器覆盖模型选择恢复、真实 memory 请求检查、来源原文、取消/迟到/429、真实跨标签锁、不支持锁拒绝和自动维护期间正常三阶段完成。

现有 GameState schemaVersion=2、IDB版本、旧正式提交回执及 TurnDraft 均不变；旧 M4 档案仍只读投影、未知时间不补造，不能自动升级为可压缩条目。原 M4-P5 连续回合、M5-P1旧档和历史窗口 E2E 保留。

本轮不会评价所有模型实际摘要质量，确定性验证约束结构/来源/权限/事务，不能替代语义审查。高层摘要仍受预算限制，未注入的来源可按需历史检索；元数据过大的整条记录也会明确列入有界 omittedSummaryIds，存档来源不截断。超长单条不能安全批处理时停下提示，不自动截断或扩费。Web Locks 需要受支持的安全浏览器环境；不支持时正常游戏继续、记忆维护不可用。

M5-P3 可复用 memory 路由、CredentialVault/AiClient/inspection、独立锁、批次预算/解析和最新状态局部合并方式；本轮入口只授权公开分层记忆，**不能直接用它压缩 NPC 私有知识或升级可见性**。私有来源选择、知识权限和 NPC 事务需 P3 单独设计。

未实现 NPC 私有压缩、独立NPC正文、删除恢复、调度/跳跃、Embedding/云检索、导入导出、DLC 或 UI 重构。不合并或生产部署，交付 Draft PR 等待审查。


## 交付验证记录

- `npm run prompts:check`：3文件、82项通过；两项记忆资源版本均为 `0.1.0-m5-p2`，字符数808/793，Manifest SHA-256与实际资源一致。
- `npm run check`：21文件、704项通过（保留原665 + 新增39），ESLint零警告；TypeScript严格类型检查和Vite生产构建通过。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：最终完整106项通过，桌面/移动各53项；保留原98 + 新增8，约5.9分钟。最终元数据预算改动之前的首轮完整106项也通过。
- `git diff --check`、暂存补丁 `git diff --cached --check`：通过。

新增999来源的边界测试先复现摘要JSON达27906字符、超过20000预算；补齐来源元数据预算后随完整704项通过，永久来源数组没有被截断。部分重叠、N=1/10/20、写库失败、源批次竞争修改、维护期间正式提交、取消迟到、三种协议及权限测试全部通过。

浏览器开发过程中修正了新增测试对select的定位，以及发送按钮需要填写下一行动的前置条件；没有删除原测试或放宽原有安全断言。最终无未通过检查。全部使用Mock/Fake IndexedDB/网络拦截，未调用真实付费API，也未测试真实模型的长期归纳质量。

其他标签已打开的面板不主动订阅记忆变更，重新读取会显示最新数据；维护选批、收费判断和写库始终重读数据库，不依赖过期面板计数。M5-P3及生产部署均不在本次交付范围。
