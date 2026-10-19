# M4-P1｜AI 正文生成系统、流式阅读与重新 Roll

## 基线、范围与使用

PR #9 已合并；从 GitHub main@`4f2b7a5` 创建 `codex/m4-p1-story-runtime`。阅读正式 V0.1 游戏规范/技术计划、M3-P2/P3 报告、ASSEMBLY、OUTPUT_CONTRACT，并检查 GameScreen、App、草稿/正式状态、SaveRepository、AI runtime/client/inspection、验证器、Composer/context 和设置。

本轮仅开放正文：开局生成、已有合法 regular 草稿生成、SSE 阅读、取消、手动重试、重新 Roll、草稿保存/恢复和行动建议填入。沿用 M1～M3 的数据与客户端，不增加依赖。正式回合提交和自动执行下游不在本阶段。

运行 `npm ci`、`npm run dev`，在「设置 → AI 连接」保存渠道、模型/路由和凭证，保存七项提示词偏好，创建/读取存档，再主动点击「生成开局正文」。请求可能产生供应商费用；验收全部采用 Mock，没有真实付费调用。未配置时显示现有安全配置/凭证错误，不模拟生成成功。

## 正文生成链路

```text
GameScreen / useStoryGeneration
  → StoryStage（同页互斥、尝试身份、设置快照）
  → SaveRepository.load + loadDraft（正式来源、草稿版本核对）
  → runStageRequest(stage=story, mode=draft.turnKind)
  → 已有 Composer / 保存的排序 / 七项偏好 / 合法上下文
  → AiClient 原生 HTTP + SSE / M3-P3 脱敏请求快照
  → 临时正文投影（不落库）
  → 原有 parseStory（硬最低字数、协议、JSON、选项）/ StorySchema
  → 请求依据核对 / rerollStory / TurnDraftSchema
  → saveDraft(expectedDraftRevision, signal) 原子替换
  → App 更新已保存草稿引用
```

使用创角现有 opening 草稿，不另外创建开局。`saveId/turnId/baseSaveRevision/turnKind/userInput` 绑定与运行开关不变，空开局偏好可正常生成。GameScreen 增加只读「本回合已绑定输入」，下方编辑和点击建议不会修改它。普通生成仅接受仓库中已经存在的合法 regular 草稿；没有草稿时提示条件缺失，不创建下一回合。未结算开局不能通过发送/继续推演进入下一回合，两项按钮仍禁用。

设置在请求开始时复制，AI 渠道使用既有 requestSnapshot，保存的提示词排序继续由 runStageRequest 读取并由 Composer 校验。中途切换运行偏好不重写当前草稿的独立开关。后续真正补算仍须现有显式执行尝试操作，本轮不执行补算。

## 流式解析与阅读

AiClient 原 SSE 处理 UTF-8 网络字节、三种原生协议及 terminal 事件，不创建第二套客户端。新 StoryStream 是单向临时投影：先匹配开头的 `<正文>`，只累加其中的文本，遇到下一处尖括号边界即停止预览。开标签、结束标签及其他结构块可在任意 delta 拆分，标签和后续 JSON 永不作为正文展示。前置思考/未知前缀不进入预览。含字面尖括号的正文可能提前停止临时预览，完整合法响应仍会在最终校验后正常显示；这是保守的展示选择，不改正式输出协议。

UI 每 50ms 合并一次高频进度更新，不重复拼接 delta，使用原 prose 的 pre-wrap 保留段落与换行。阅读器默认跟随最新内容；手动上滚暂停，按钮可恢复跟随。查看七个资料面板或设置不会卸载 GameScreen/中断请求。游戏界面按需加载，避免首页预先加载正文运行链路；没有重构三栏布局。

流式部分明确标为「临时预览 · 完整校验前不保存」。完整响应必须通过原 parseStory；只有 narrative 去空白后的 Unicode code point 参与最低字数，摘要、指导与选项不计入。行动选项启用时仅在合法草稿保存后显示 3～5 条；关闭时不显示，不接受额外选项块。点击只填输入框，可编辑，绝不发送。

## 版本与重新 Roll 安全

StoryStage 每次从仓库重读状态和草稿，核对调用方期望的完整草稿、正式 revision、turnId 未归档与 opening 边界。模型完成后再检查 runStageRequest 的 saveId、turnId、baseSaveRevision、draftRevision、storyRevision 和 executionRevision。

重 Roll 期间不预先保存 pending/failed 草稿、不删除旧正文或旧候选。失败时原始草稿保持不变，取消后立即恢复旧文。新 StoryResult 完整合法后，复用 rerollStory 使 draftRevision/storyRevision 各加一，正文与摘要/variableGuide/actionOptions 一起替换，变量和世界旧候选同时清除。turnId、已绑定输入、执行配置与原有失败历史不被悄改。

SaveRepository.saveDraft 仅增加向后兼容的第三个可选 AbortSignal：现有调用无须修改。其原单事务仍在写入前读取正式 revision、草稿 expectedDraftRevision，校验全部更新关系；信号可在事务提交前中止并回滚，监听器随后释放。网络请求不进入事务，不把单条 put 成功视为事务成功。没有 GameState 或 TurnDraft Schema 修改，不需要迁移。

最终保存是短暂原子操作，UI 此时显示「正在保存」并禁用主动取消；离开界面仍发送中止信号。IndexedDB 已完成提交后无法撤销，此时已保存的是完整有效草稿，刷新可恢复；本轮不实现回退历史版本。

## 取消、并发与错误恢复

同页按 saveId 互斥，UI 另有同步点击锁，控制层每个尝试具有 Symbol 身份与 AbortController。取消/卸载使尝试失效并释放锁；旧请求即使忽略网络取消，仍不能通过后续身份检查。跨页面并发由原 expectedDraftRevision 和正式 revision 仲裁，不用最后写入覆盖其它窗口。

取消只显示固定提示，401/403、429、5xx、网络/CORS/TLS、超时、空返回、流中断、非法 JSON/输出沿用现有安全错误。不回显供应商正文、URL、请求头、Zod 错误或原始异常。流式输出对已配置凭证做脱敏，完整结果若回显凭证则拒绝保存。

失败不自动循环，不向 TurnDraft 写入半成品或虚假的失败回合；可以手动单次重试。刷新后恢复已持久化的合法正文，未完成流式文本和页面内错误不持久化，没有合法正文则恢复原 pending 草稿。切档/返回首页卸载请求控制器，旧结果不能写入新档。存档删除、正式版本变化、其它窗口草稿更新都会让保存明确失败。

正式 GameState 的 worldClock、turnNumber、journal、资金、NPC、组织/事件和 appliedCommands 完全不变。UI 成功明确为「正文已生成 · 未正式结算」；变量/动态世界是待执行或草稿原有跳过状态，不伪装完整回合。

## M3-P3 查看器与实际运行示例

没有第二套请求日志。所有正文继续经过 AiClient 原发送边界，捕获同一 wire.init.body 的脱敏快照，记录 opening/regular、story、实际模型、模块/加载顺序、字符/估算和供应商 usage。完整内部上下文仍须主动查看；不写入普通阅读区、正式 journal 或玩家认知。快照仍最多 12 条页面内存，刷新清空，不保存模型响应正文或内部思维链。

真实 Chromium + 本机 Node HTTP/SSE 验收示例：

- 通过真实 createProfileSave 创建 opening 草稿，空开局偏好；输入框另写文字不会进入当前请求。
- localhost Mock 接收实际 POST，返回跨标签片段。正文逐步显示，完整校验前 IndexedDB 没有 story。
- 完成后 storyRevision=1，summary/variableGuide/3 个选项一起保存；正式 GameState 序列化与创建后完全相同，刷新仍显示正文。
- 查看器显示模型 `browser-story-mock`、`stages.opening.story`，并实际应用 emotion_guard → conflict_pacing 的已保存合法排序。
- Mock 返回 usage input=42/output=7/total=49；查看器区分其与估算。数字是测试响应预设值，不是真实计费，也不能用来校准 tokenizer。密钥和内部正文容器值默认不展示。
- 第二次 Roll 先后经历授权失败、字数不足和非法格式，原有效正文保持不变；再成功后同 turnId 的 storyRevision=2。

桌面/移动 screenshot 在本地忽略目录 `test-results/story-runtime-真实开局…-{desktop|mobile}/story-runtime.png`，已实际查看。界面无横向溢出，正文换行、工作流面板、Roll 和禁用的新回合发送状态清楚；不自动发布截图或部署。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| npm run prompts:check | 82 项通过，原静态/运行时/查看器检查保留 |
| npm run check | 281 项通过：原 251 项全部保留，新增 30 项；Lint 零警告，类型检查与生产构建通过 |
| CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e | 32 项通过：原 22 项保留，新增 5 个场景 × desktop/mobile |
| git diff --check | 通过 |
| main@4f2b7a5 字节比对 | 94 个受保护文件无差异：全部 prompts、正式 docs、domain、七项设置 Schema 与依赖锁 |

新增单元/集成覆盖：所有标签拆分位置、前置内部块/漏结束标签、三协议真实 SSE/Composer/parseStory/保存链、合法 regular 模板、正式状态不变、完整校验与字数、两个下游候选失效、失败保留正文和候选、选项关闭、401/403/429/500、网络/空返回、凭证回显、并发锁、取消与超时、迟到、跨档、草稿冲突、正式版本冲突、保存失败及事务中止（包含 put 排入后回滚）、请求时设置快照。

新增浏览器覆盖：实际分时 SSE、跨片段标签、结构 JSON 隔离、校验前不保存、资料面板不打断、刷新恢复、行动建议只填入、快照与排序/usage、失败及成功 Roll、重复点击、取消重试、切档与刷新、现有 regular/no-draft 边界、长文本自动/手动滚动和移动宽度。原创角 E2E 仅把旧「生成开局按钮禁用」断言更新为本阶段真实开放；没有删除或削弱其余创角、存档、隔离与设置检查。

首轮新浏览器 fixture 在 App 启动后写入设置但没有刷新，短 Mock 正文被默认 1500 字检查正确拒绝；修复 fixture 初始化刷新。另修正新增测试对 select 的定位，未因此降低正式输出校验。

## 文件清单

新增：

- M4-P1-DEVELOPMENT.md：范围、实现、验收和限制。
- src/workflows/storyStage.ts：独立正文请求与合法草稿替换，不编排下游。
- src/workflows/storyStream.ts：保守流式正文投影。
- src/ui/game/useStoryGeneration.ts：React 进度合并、取消与卸载生命周期。
- src/tests/story-stage.test.ts：30 项确定性单元与集成测试。
- e2e/story-runtime.spec.ts：本机 HTTP/SSE 的 5 个桌面/移动场景。

修改：

- src/ui/game/GameScreen.tsx：开局/已有回合生成、预览、Roll、取消、绑定输入、滚动和状态。
- src/app/App.tsx：传入仓库/接收保存后的草稿、按需加载游戏界面、版本文案。
- src/services/storage/saveRepository.ts：草稿事务可选取消信号，原存档事务语义保留。
- src/app/styles.css：小范围错误和绑定输入样式。
- src/ui/creation/CreationWizard.tsx：确认后可主动生成正文的准确文案，创角逻辑不变。
- src/ui/settings/SettingsPanel.tsx：偏好用于下次正文请求的准确文案，七项字段不变。
- src/ui/settings/PromptInspector.tsx：无请求时区分正文已开放、变量/世界未开放。
- e2e/game.spec.ts：更新本阶段开放按钮的验收断言。
- src/workflows/README.md、DEVELOPMENT.md：阶段入口与边界更新。

## 保留问题、未实现与真实服务限制

- M4-P2/P3 的变量/动态世界执行、候选变更展示、补算和正式回合结算未实现；M4-P4 的首次 + 2 次自动重试/完整失败恢复编排未实现。本轮按用户分阶段要求只做手动重试；不悄然实现技术总计划的完整 M4。
- 不创建第二回合，不推进 turnNumber，不在关闭阶段时暗中提交。无既有草稿时没有新建回合按钮，后续生命周期需要正式结算能力。
- 初始同伴 affinity=0 仍是 M2 占位，现有正文/玩家投影对初始同伴返回未确认；十四类命令目前没有 NPC 关系更新命令。本轮不硬编码确认或改值，后续 M4 应结合明确领域命令处理。
- 世界时间预检、记忆压缩/检索、长期事件调度、回退、导出、M5/M6、V0.2 与 DLC 没有开发。
- 三协议完整链路使用确定性 Mock，不代表所有真实供应商已兼容。浏览器直连仍受 CORS/TLS/权限限制；参数支持、终止事件与模型是否严格服从标签/最低字数均取决于服务，返回不合格时保留旧文并提示失败。没有精确全模型 tokenizer 或收费量校准，不为验证主动调用付费模型。
- 不持久化未完成网络任务、原始供应商输出或失败临时正文；刷新后只恢复最后的合法草稿，不从 SSE 中途续传，不声称请求取消能撤销供应商已产生费用。
- 两本世界书、NSFW 正文及其常驻条件、七项设置、现有输出协议、存档 Schema 和十四类命令未改。NSFW SHA-256 仍为 `7fb4f10a265d3a95a3eb3ac2da1f6ade78fb46698616ce5258f3b57854a7f3ed`；旧版全文逐字移植缺口继续保留原记录。

独立 PR 提交验收，不自动合并，不部署。
