# M3-P3｜提示词管理中心、AI 上下文可视化与 Token 统计

## 开发基线与范围

从 GitHub 最新 `main`（合并 PR #7 后的 `0b1a7b4`）建立 `codex/m3-p3-prompt-inspector`。本轮仅 M3-P3，复用现有 React / TypeScript / Zod、Manifest、原文加载器、Composer、原生三协议客户端与 SaveRepository，不新增依赖，不修改其他仓库。

已审查正式 V0.1 游戏规范/技术计划、M3-P1/M3-P2 报告、Manifest、ASSEMBLY/OUTPUT_CONTRACT，以及现有提示词、API 与设置代码。没有重新创作提示词；原 75 项注册资源和正式设计文档保持原字节。

## 使用入口与界面

运行 `npm ci`、`npm run dev`，打开终端给出的地址，进入「设置 → 提示词管理」。没有存档或密钥也可以查看完整资源库、筛选及原文，不会调用模型。已有七项写作设置仍在原「提示词」类别，不加 NSFW 开关。

管理中心按宽度显示三个区域：模块库；模块原文和当前选取顺序；上下文与统计。桌面三列、较窄屏幕两列、手机一列，长原文/内部 JSON 独立限高滚动。管理组件按需加载，原提示词文件也通过现有 Vite raw import 延迟读取；无须重构三栏游戏主界面。

- 模块库直接来自真实 Manifest，按类别、适用阶段、名称/ID/路径和激活状态筛选。点击后通过现有加载器读取原文并核对 hash，不复制显示用正文。
- 展示 ID、名称、版本、文件路径、角色、类别、阶段/模式、激活条件、默认与当前选取顺序、原文字符数及估算 Token。
- 状态明确区分当前配置「启用」「未启用」「不适用」，不表示请求已发出。never 文档/参考可供阅读，仍永不注入。
- 「开局与普通回合的模块差异」从同一个选择器计算双方独有及共有模块，并提供对应原文入口。不是另建一套开局/普通规则。
- 当前阶段可为正文/变量/动态世界，当前模式可为开局/普通，共六种组合。相关变量域只属于本次预览筛选，不是新写作设置或新玩法开关。

## 排序配置与验证

排序保存在独立 localStorage 键 `heijin.prompt-order.v1`，严格结构为 `{version:1,overrides:{模块ID:顺序槽位}}`，不进入 GameState、存档导出或七项写作设置。

沿用 M3-P2 的授权约束：narrative_core 三个模块只在 80/81/82 内置换；writing 四个可配置规则只在 224/225/226/227 内置换。身份、两本世界书、NSFW、亲密边界、阶段和输出协议等固定模块不显示移动按钮，程序同时拒绝固定/跨组/重复槽位/未知 ID。无法通过直接改本地 JSON 绕过校验。

需要兼容的实际边界：全局保存顺序可能包含当前关闭的写作模块，而 P2 的 orderOverrides 只接受当前选中的完整槽位置换。本轮保留该 P2 校验，新增 orderPreferences：先验证全组偏好，再将启用模块的相对顺序投影到其原合法槽位。关闭、再开启模块不会丢掉排序，也不会移动固定边界。旧 orderOverrides 调用继续有效；两种参数同时提供会明确拒绝。

管理窗口切换阶段/模式保留尚未保存的合法排序；保存后预览和浏览器 runStageRequest 都应用新顺序。恢复默认会明确保存空偏好，重新组装与 P2 原始顺序一致。纯 composePrompt 调用者可显式传 orderPreferences；非浏览器服务不会隐式读取浏览器存储。损坏配置阻止请求或提示主动恢复，不自动覆盖原数据。

已验证的具体例子：将 writing.conflict_pacing 下移一位，80/81/82 变为 emotion_guard → conflict_pacing → action_feasibility；其余固定模块不变。保存、刷新仍生效，恢复默认回到 conflict_pacing → emotion_guard → action_feasibility。另有 NoControl 关闭后保留全组偏好、重新开启恢复相对顺序的回归。

## 组装预览与真实请求快照

### A. 无网络的组装预览

点击「生成三阶段组装预览（不联网）」才读取所选真实存档/草稿，复用现有 Composer。展示当前模式三个阶段各自的字符/Token 估算；侧栏查看选中阶段的角色、模块顺序、路由、实际组装文本及阶段资料。路由直接复用 P2 解析/COT 兼容判定，不要求提供密钥；无可用路由如实标为未知。

没有存档时禁用组装。变量/世界没有已选定正文、草稿模式不匹配、草稿阶段已关闭或版本不合法时明确显示缺少条件，不造一份草稿来冒充成功。正文可以对现有状态选择另一种模式的模板进行诊断预览，但不等于执行该回合；其他阶段不能因此绕过其合法草稿条件。

预览使用本设置窗口当前编辑的七项偏好与未保存排序，不自动保存偏好。存档、模式、相关域或排序改变后清除旧预览；异步完成时使用 generation 标识丢弃过期结果，避免跨存档或旧配置覆盖。只有切换检查阶段时复用同一轮三阶段预览。

### B. 来自真实发送边界的快照

AiClient 在传输前，从同一个 wire.init.body（已经完成原生协议序列化的 JSON）捕获脱敏副本，角色显示也由该原生 payload 派生；不会再次调用 Composer 模拟一份「已发送」内容。Gemini/Anthropic 的 system 合并、Gemini model 角色映射可在原生体中核查。独立阶段入口附带阶段/模式/存档版本/模块元数据，连接测试单独标为「非游戏阶段」，不借用 opening/regular 标签。

捕获的是客户端发送尝试，不证明服务器已收到。状态为进行中、完整文本响应已收到或失败；收到文本不代表候选校验成功/正式提交。超时后迟到的响应不会把失败改为成功。请求前已取消或在组装/协议校验前失败，不制造发送记录。

最多在当前页面内存保留最近 12 条。用户可清空，刷新后清空；没有写入 IndexedDB、localStorage、存档、普通日志或游戏历史。模型列表 GET 不包含游戏阶段提示词，不作为阶段请求快照记录。现阶段没有 M4 自动回合，正常游戏未产生阶段请求时如实显示「尚无实际快照」；已有主动连接测试可单独选择查看。

## 默认安全与内部视图

默认仅显示角色、模块、顶层资料容器名称、计数、路由和统计，不展示后台资料正文。查看完整消息、状态资料或原生请求体须主动点击「主动查看完整内部上下文」。切换阶段/模式/存档/请求来源或重新组装会关闭旧的内部视图。原文模块阅读不授予角色任何世界知识。

不保存或展示真实请求头、Authorization、服务 URL、供应商响应正文或模型隐藏思维链。快照在捕获时脱敏当前请求凭证和其他已配置渠道的凭证；预览在生成时脱敏，展示时再次脱敏。嵌套常见鉴权字段和 Bearer/Basic 字符串也隐藏。删除渠道或轮换密钥不会使旧记录恢复凭证。查看器显示的是脱敏副本，原始提示词文件与正式状态不被改写。

后台 NPC 私有资料只在本来允许的变量/世界内部上下文出现，不能自动进入普通界面。没有更新主角认知、player_known 标记或 NPC 数据；没有新角色迷雾、私密档案或变量作弊入口。完整内部内容是明确主动查看的开发工具资料，不代表主角或 NPC 已知。现有普通 NPC/记忆面板的隔离回归继续通过。

## Token 统计逻辑与限制

- 原文字符数沿用 Manifest 的 Unicode code point 计数；组装后各模块字符数与估算值来自实际替换后的正文。
- 阶段字符数为消息 content 的 Unicode 字符数之和；估算基于消息文本，ASCII 每 4 字符约 1 Token，其他字符每字符约 1.5 Token，向上取整，方法 ID 为 unicode-heuristic-v1。
- 这不是模型 tokenizer，不包含供应商协议固定开销，可能明显高估或低估，不能用于计费或证明请求可容纳。不同协议的 system 拼接会增加分隔符，因此实际原生消息字符数与逻辑预览可能略有差别。
- 输入/输出/总 Token 只展示供应商实际返回的相应 usage 字段，没有返回就显示「未提供」。不把估算当真实消耗，不自行求和补出未提供的总量；真实零值保持 0。
- 不为了统计发起付费 API，不建立自动模型请求。M4 可复用 statistics.ts 与原生请求记录接口。

## 可复核的运行示例

浏览器 E2E 使用隔离 fixture 存档，并对 `inspector.mock.invalid` 完整拦截请求，没有真实外部付费调用。

1. regular/world：调用原 runStageRequest，经过实际 Composer 与 AiClient，Playwright 捕获同一个原生 POST；改变渠道默认模型后，查看器仍显示该请求开始时的 mock-before。
2. 后台秘密默认不出现在界面；主动查看后可在 OFFSCREEN_STATE 中看到测试标记。关闭设置、打开普通 NPC 面板，秘密仍不可见；正式存档前后序列化完全一致。
3. 请求快照刷新后消失，localStorage 没有后台秘密或会话密钥。密钥不在查看器或原生体显示中，Authorization 请求头没有被保留。

该 Mock 请求的实际记录摘要（来源为浏览器 test-results 中的 request-summary.json）：

- 模式/阶段：regular / world；协议：openai。
- 原生消息字符：35158；启发式估算：22645 Token。
- Mock 响应 usage：input=42，output=7，total=49。这些是 Mock 预设字段，用于检验展示与归一化，不是一次真实收费调用，也不能用于校准 tokenizer 精度。

### 六种组合的实际加载顺序

以下来自现有真实 Chromium 组装测试的 prompt-order.json：默认七项写作设置、默认顺序、COT 关闭，相关域仅 protagonist/economy。全部 system 模块后接一个 user GAME_CONTEXT；COT 仅在原协议明确允许时另加 assistant 格式确认一次。

#### opening.story（23 模块）

```text
identity.fusheng
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
writing.conflict_pacing
writing.emotion_guard
writing.action_feasibility
writing.min_length
writing.perspective_third
writing.style_general
writing.no_control
writing.natural_prose
writing.action_options
writing.real_world
writing.nsfw
writing.intimacy_boundaries
stages.opening.story
shared.06_story_output
shared.09_dialogue_labels
```

#### opening.variables（11 模块）

```text
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
stages.opening.variables
shared.07_command_output
variableGroups.protagonist.init
variableGroups.economy.init
```

#### opening.world（11 模块）

```text
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
stages.opening.world
shared.08_world_output
variableGroups.protagonist.offscreen
variableGroups.economy.offscreen
```

#### regular.story（23 模块）

```text
identity.fusheng
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
writing.conflict_pacing
writing.emotion_guard
writing.action_feasibility
writing.min_length
writing.perspective_third
writing.style_general
writing.no_control
writing.natural_prose
writing.action_options
writing.real_world
writing.nsfw
writing.intimacy_boundaries
stages.regular.story
shared.06_story_output
shared.09_dialogue_labels
```

#### regular.variables（11 模块）

```text
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
stages.regular.variables
shared.07_command_output
variableGroups.protagonist.update
variableGroups.economy.update
```

#### regular.world（11 模块）

```text
worldbooks.heijin.worldview
worldbooks.heijin.modern_underworld
shared.01_agency
shared.02_knowledge
shared.03_time_events
shared.04_state_authority
shared.05_context_protocol
stages.regular.world
shared.08_world_output
variableGroups.protagonist.offscreen
variableGroups.economy.offscreen
```

相关截图由浏览器测试生成在 test-results/prompt-inspector-…/prompt-inspector.png，覆盖 desktop/mobile，默认隐藏内部内容。它们是可重新生成的本地验收产物，不进入正式存档或自动发布。测试目录已在 .gitignore 中排除。

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| npm run prompts:check | 82 项通过：27 项原资源静态、34 项 P2 运行时、21 项 P3 检查 |
| npm run check | 251 项通过，保留 P2 全部 230 项；Lint 零警告，类型检查和 Vite 生产构建通过 |
| CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e | 22 项通过：保留原 14 项，新增 4 场景 × 桌面/移动 |
| git diff --check | 通过 |
| 受保护文件字节比对 | 95 个既有文件与 main 一致：正式设计文档、全部 prompts 资源、领域/存储与七项设置 Schema |

新增覆盖：75 个真实原文的一致性、状态/模式选择器、合法保存/恢复排序与关闭模块投影、固定/跨组/重复/未知排序拒绝、六组合组装与无条件提示、三原生协议的同一传输体快照、usage 与估算区分、跨渠道密钥脱敏、超时迟到响应、内存容量与清空、无存档/无草稿、内外视图隔离、手机和桌面交互。没有删除原测试，也没有修改付费 API 配置来测试。

## 文件清单

新增：

- `M3-P3-DEVELOPMENT.md`
- `e2e/prompt-inspector.spec.ts`
- `src/prompts/order.ts`
- `src/prompts/preview.ts`
- `src/prompts/selection.ts`
- `src/prompts/statistics.ts`
- `src/services/ai/inspection.ts`
- `src/tests/prompt-inspector.test.ts`
- `src/ui/settings/ContextInspection.tsx`
- `src/ui/settings/PromptInspector.tsx`

修改：

- `DEVELOPMENT.md`
- `package.json`
- `src/app/App.tsx`
- `src/app/styles.css`
- `src/prompts/README.md`
- `src/prompts/composer.ts`
- `src/prompts/context.ts`
- `src/services/ai/client.ts`
- `src/services/ai/credentials.ts`
- `src/services/ai/runtime.ts`
- `src/services/ai/snapshot.ts`
- `src/ui/settings/SettingsPanel.tsx`

selection/order/preview/statistics 提供共用逻辑；inspection 提供脱敏内存记录；PromptInspector/ContextInspection 提供设置界面。现有 Composer 保留执行契约，AiClient 仅加发送记录与 usage 生命周期，runtime 默认应用保存顺序；snapshot 提取无凭证路由/COT 判定供预览共用。App 只传只读仓库入口并更新版本标识；未重构游戏主界面。依赖锁文件不变。

## 尚未实现与兼容边界

M4 的自动三阶段回合、重试与失败恢复编排、候选正式提交、世界结算仍未开发；M5 记忆压缩/检索与调度、M6 地图/公告/压力测试也未开发。没有 V0.2 NPC 私密档案/角色迷雾/作弊编辑器或 DLC。

现有十四种命令、GameState Schema、M1 原子提交、七项设置、两本世界书、NSFW 原文/加载条件与已有三协议能力保持不变。NSFW SHA-256 仍为 7fb4f10a265d3a95a3eb3ac2da1f6ade78fb46698616ce5258f3b57854a7f3ed；旧版未经修改的全文逐字移植仍保留原 not-completed 记录，不误报完成。

没有保存历史请求档案、任意修改提示词、精准全模型 tokenizer 或自动上传诊断内容。当前快照仅覆盖原生生成请求；模型列表不是阶段请求。真实供应商 CORS/参数/账户限制仍沿用 P2 报告，未做未经授权的真实联调。原文资源可以浏览不等于被注入，完整上下文可查看不等于被任何人物知晓。

提交独立 PR 等待审查，不合并 main、不部署。
