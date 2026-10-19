# M3-P2｜API 接入、真实提示词组装与模型兼容

## 基线与交付边界

基于 `main` 的 M3-P1 合并提交 `40853ed`，在独立分支 `codex/m3-p2-ai-runtime` 开发。沿用 React / TypeScript / Zod / Vite / M1 SaveRepository，未新增运行依赖，也未修改正式游戏存档 Schema、设置 V1 Schema、M1 原子事务或已完成的角色创建及资料面板。

本阶段的独立阶段请求已经能执行“读根目录原文 → 快照与消息组装 → 原生 HTTP / SSE → 解析与候选校验”。游戏发送、开局生成、Roll 和继续推演仍保持后续阶段提示，未包装成完整可玩回合。所有验证均使用 Mock，不使用真实 API Key、不发起付费模型调用。

## 渠道、凭证与原生协议

AI 配置单独存放在 `heijin.ai.v1`；旧七项提示词设置仍使用原 V1 结构，无须迁移。路由可选择正文渠道/模型，变量与世界可分别跟随正文或独立覆盖。请求开始时深拷贝并冻结渠道、模型、参数与兼容能力，凭证通过 WeakMap 关联到该快照。编辑/删除配置或替换密钥不会改变已开始的请求。

API Key 默认仅保存在 sessionStorage。长期保存必须勾选明确的本机记住选项，保存到独立 localStorage 键；撤回选项或删除渠道会清理对应副本。密码框遮盖显示，配置文档、GameState、候选、组装消息、模块记录与错误详情不含凭证。凭证只在请求头使用，不放入查询字符串；请求禁止携带网页 cookies、跳转和 Referrer，不自动使用 CORS 代理。浏览器及同源脚本仍能接触密钥，不能宣称本地加密保险库级别的安全。

| 协议 | 原生路径与系统消息 | 模型列表 | 流式/结构化响应 |
| --- | --- | --- | --- |
| OpenAI-compatible | `/chat/completions`，保持 system/user/assistant 顺序 | `/models` | SSE delta + `[DONE]`；显式支持时才加 `response_format` |
| Gemini | `/models/{id}:generateContent`；systemInstruction + contents | `/models`，支持分页 | `streamGenerateContent?alt=sse`；显式支持时设置 responseMimeType |
| Anthropic | `/messages`；独立 system + messages，固定版本请求头 | `/models?limit=100`，支持分页 | 原生 content/message SSE 事件；不伪装成 OpenAI，不添加假 JSON 模式 |

设置 UI 支持多渠道新增、编辑、确认删除、协议选择、Base URL、密钥、模型获取/手填、可选生成参数、三阶段路由、主动连接测试和取消。请求进度与错误使用固定安全提示；不展示供应商错误正文，也不回显连接测试生成内容。只有玩家主动点击模型获取或连接测试才联网，连接测试明确告知可能产生费用。

能力与限制：

- 三协议完成确定性 Mock 与 Chromium 浏览器验证，未使用真实供应商账号联调；实际站点 CORS、账户权限、模型参数及模型是否服从提示词仍取决于供应商。
- Base URL 填含版本路径的根地址；仅接受 HTTPS，回环地址允许 HTTP；不接受内嵌账户、查询参数或片段。通过浏览器直连，网络/CORS/TLS 失败无法可靠区分，统一准确提示这种不确定性，不误报授权错误。
- 使用 Chat Completions 兼容集，不实现 OpenAI Responses、工具调用、音视频或自动模型能力探测。Temperature / Max Output Tokens / 原生 JSON 支持由渠道声明；不同模型能力不一致时应使用相应渠道配置。当前 OpenAI 字段为 max_tokens；只支持 max_completion_tokens 的模型需关闭该可选字段，本阶段不猜测替换。Anthropic 必须有输出上限，超出其温度范围时跳过并诊断，不静默截断数值。
- JSON 模式不等于 Schema 合法：无论服务是否提供 JSON 模式，都再执行严格解析和领域校验。
- 支持 401/403、404、429、5xx、其他拒绝、超时、取消、空响应、非法 JSON、截断/中断 SSE 分类；UTF-8 按字节边界拼接。仅统计供应商实际返回的 usage，不估算 Token 冒充真实用量。
- 参考 M3-P1 锁定的墨色江湖 defaults/promptRuntime 行为，保留本项目安全格式确认模板，不移植旧武侠 COT。默认不发送；仅对显式列入兼容名单的 OpenAI 模型发送独立 assistant 模板一次，不要求或暴露内部思维链。Gemini / Anthropic、DeepSeek / GLM、特殊 Prefix 当前跳过并诊断；没有强行添加 prefill 或变更角色。

## 真实提示词加载与上下文

`loader.ts` 使用 Vite raw import 读取根目录注册文件，逐次核对原文 SHA-256 与 Unicode code point 字符数。正文没有复制成 TS 常量；模块丢失或漂移明确失败。Composer 按 stage、opening/regular、七项设置、显式相关变量域、单一记忆任务和协议兼容条件筛选；never 文档/示例/旧世界底座/历史参考不会注入。固定前缀和边界不能排序，可调模块仅允许同组现有槽位置换；不开发排序 UI 或排序保存。

三个阶段各选唯一主模板和对应输出协议。变量组按 init/update/offscreen 选择，九个域不会自动变成九次模型调用，也不会全部无条件注入。记忆任务仅实现组装入口，未开发 M5 的压缩、调度或检索。

七个动态占位符均支持：playerName、worldClock、worldWeekday、minNarrativeChars、immediateMemoryTurns、npcId、npcSummaryThreshold。任务缺少必需值或最终残留 `{{...}}` 时阻止发送。每次从调用者快照重新组装，切档无跨存档人物/时钟缓存。worldWeekday 使用 Intl + Asia/Shanghai，从正式时钟或已验证变量的临时投影时钟派生；不写入独立星期字段，不使用真实系统日期。

正文只接收主角/自有资产、当前位置及祖先层级、在场 NPC 的公开材料和玩家创角档案、最近 N 回合完整正文、公开摘要与已知事件，不注入全部 NPC 内部身份/目标/知识/私有记忆。已知事件不直接暴露内部预计结束时间；后台信息仅在相应内部阶段使用。该选择器不改 M2 玩家资料面板，也不锁定未来的玩家全知/主角认知玩法。

变量读取选定正文、变量规划、正式状态和真实目录。世界读取场外人物/组织、后台任务/事件和已验证变量的临时投影；没有已验证变量时明确 variablePending=true。user 数据容器与占位符插值转义尖括号，玩家自由文本不会生成新 system 角色。模块记录仅包含 ID、版本、hash、角色、顺序、字符数；完整请求与后台结果标为 internal，不写玩家日志。转义与权限划分不能保证模型完全抵抗自然语言提示注入，候选仍必须经过程序校验与后续正式事务。

## 实际组装示例与顺序

以下来自 `e2e/ai-settings.spec.ts` 在真实 Chromium 中调用 composePrompt 的 `prompt-order.json` 附件。使用默认七项设置（第三人称、四个增强开启）、COT 关闭、相关域仅 protagonist/economy；状态来自隔离测试 fixture。这里列出模块 ID 与实际逻辑顺序，不复制提示词正文，不把审核资料当运行资源。每个阶段所有 system 模块之后追加一个 user GAME_CONTEXT；仅兼容格式确认开启时在该 user 后追加 assistant 模板一次。

### opening.story（23 个模块）

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

### opening.variables（11 个模块）

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

### opening.world（11 个模块）

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

### regular.story（23 个模块）

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

### regular.variables（11 个模块）

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

### regular.world（11 个模块）

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

在本例中，正文 23 个、变量 11 个、世界 11 个模块；世界变量候选缺失，实际标记为 pending。协议转换保持 system 规则内部顺序，Gemini/Anthropic 仅按原生字段合并 system 内容，不重排模块。

## 命令、输出协议与正式提交

COMMAND_CATALOG 从现有 DomainCommandSchema 动态生成 JSON Schema，不建立第二套手写对象协议。保留十四种类型：PurchaseItem、PurchaseVehicle、TransferFunds、ReceiveIncome、Borrow、RepayDebt、CreateNpc、SetEquipment、TransferItem、SetWorldClock、SaveEvent、SaveTask、CreateOrganization、RecordOrgRelation。

命令使用 {commandId,type,evidence,...类型专属同级字段}；拒绝旧 group/entityId/payload、多余字段、旧别名和未知命令。CreateNpc/CreateOrganization 仍是创建，不能冒充更新；不支持操作应列 unresolved，解析器不会猜测映射。仅精确修订 shared/07_command_output.md 和 shared/08_world_output.md 中的目录/字段/单位/权限与事件完整字段说明，保留外层 JSON 字段与正文标签协议，变更版本及来源记录可追溯。

变量候选校验正文 evidence 引用与现场创建边界。世界候选：worldCommands 仅 CreateNpc（场外）、CreateOrganization、RecordOrgRelation；taskCommands 仅 SaveTask 且不能推进主角/在场 NPC；eventCommands 仅 SaveEvent，事件关联现场 NPC 不被接受；futureEvents 也校验完整事件对象及重复 ID。任务 planned/completed 和事件 scheduled/resolved 不混用。timelineCandidates 只接受已结案重大事件，最终是否向玩家公开仍须后续视图规则验证。visibleHooks 属于内部候选，未直接发送玩家界面。

人民币按整数分。单处明确数字“元/分”证据与金额比较使用整数计算；无法凭简单字符串决定多金额、折扣、税费、缺失数字或复杂自然语言的真实性，不宣称自动覆盖所有单位或事实错误。

候选使用 M1 commitCommands 在脱离仓库的状态副本上模拟整批操作，复用余额、归属、引用、时间、幂等和最终 Schema 校验；失败不会部分修改原状态。不会调用 SaveRepository、自动重试、提交或下游阶段。返回内部结果 commitAllowed=false，并携带 saveId/turnId/baseSaveRevision/draftRevision/storyRevision/executionRevision/阶段请求版本/所依赖变量版本，供 M4 将来检查迟到响应。M1 草稿已有的版本依赖、显式补算及原子提交保持原样；关闭阶段不能直接发请求，须通过现有 startStageAttempt 明确开启补算。

## 三阶段 Mock 请求与回归

每种原生协议均执行同一真实入口 runStageRequest：

| 协议 | 正文 | 变量 | 动态世界 | 状态隔离 |
| --- | --- | --- | --- | --- |
| OpenAI-compatible | 实际组装 → SSE → 标签/最低字数校验 | 实际组装 → 严格 JSON → 目录校验 | 实际组装 → 严格 JSON → 权限校验 | 正式状态与仓库均不变 |
| 原生 Gemini | 原生 SSE → 同一正文解析器 | 原生 generateContent → 同一候选解析器 | 原生 generateContent → 同一候选解析器 | 正式状态与仓库均不变 |
| 原生 Anthropic | 原生事件流 → 同一正文解析器 | 原生 messages → 同一候选解析器 | 原生 messages → 同一候选解析器 | 正式状态与仓库均不变 |

候选测试含十四类真实命令整批正例、资金不足、元/分错误、未知命令/旧包装、字段与阶段越权、时钟投影、过期版本、不完整事件、正文非法标签/内部思考、开关和行动块一致性。时间测试覆盖跨天、跨月、跨年、闰日和 UTC/中国日期边界。API 测试覆盖快照冻结/凭证隔离、三原生消息/响应、使用量、按字节流式分片、失败/取消/超时和不支持参数诊断。

最终验收命令（Node 24.19.0，系统 Chromium）：

| 命令 | 结果 |
| --- | --- |
| npm run prompts:check | 61 项通过（原 27 项静态 + 34 项真实运行时） |
| npm run check | 230 项通过，ESLint 零警告，TypeScript 与 Vite 生产构建通过 |
| CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e | 14 项通过（桌面 7、移动 7，保留原 M2 全部 8 项） |
| git diff --check | 通过 |
| 受保护资源比对 | nsfw.md 字节/hash 与 main 一致；正式 docs、领域/存储及七项设置 Schema 无差异 |

浏览器 Mock 还验证了多渠道创建/删除确认、刷新恢复、路由独立与跟随、密码类型遮盖、会话凭证不入本地配置、模型列表、原生连接端点、错误脱敏、网络错误不误报密钥、取消和窄屏无横向溢出。所有测试域名请求均拦截；没有真实外部模型调用。浏览器测试曾发现默认 fetch 接收者错误，已用 globalThis 包装修复并加入回归。

## PR #7 审阅修复：正文 NPC 连续性

本轮最小修复仅涉及 `src/prompts/context.ts`、`src/tests/prompt-runtime.test.ts` 和本报告：

- 正文人物投影补充已有在场 NPC 的外貌、性格、好感度和上次互动时间；好感只作为人物反应的叙事参考，不变成主角已知数值或恋爱进度。初始同伴仍保守保留未确认值 `null`，不把创角占位好感当作已确认结果。
- 关系和健康文字没有字段级可见性标记，只在与该 NPC 的公开记忆完整原文一致时补入字段；部分提及、否认、传闻不会据此提升内部字段。其余公开描述仍保留在已知记忆中供正文理解，不做自然语言语义猜测。关系还可回退到匹配的玩家创角档案，并显式标记 `player_known_memory` 或 `creation` 来源；公开的新关系优先于旧创角设定。
- 人物已知记忆增加特殊 NPC 的公开长期记忆、公开人物摘要，以及明确关联该 NPC 的公开分层记忆，保留时间与可用的知晓来源。内部身份、私有经历/目标/习惯、NPC 的私有知识、私有/内部记忆和后台任务不随人物对象导入正文。离场 NPC 仍不进入现场列表。
- 不改变 M2 资料面板可见性，不确定未来的玩家全知/主角认知模式，不改 NPC Schema 或十四种命令，不开发 M4，不改 NSFW 资源或其注册信息。

新增 4 项回归测试覆盖普通 NPC 的人物资料及合法零好感、特殊 NPC 的公开长期记忆与秘密隔离、公开记忆的实体归属及否认反例、初始同伴跨回合/串档/新关系优先和正式状态不被修改。最终检查结果见上表。

## NSFW 来源与保留项

prompts/writing/nsfw.md 完整保留用户 690d01d 的所有字节。SHA-256：`7fb4f10a265d3a95a3eb3ac2da1f6ade78fb46698616ce5258f3b57854a7f3ed`。该模块与独立亲密边界各在正文请求加载一次，变量/世界不加载，无 NSFW 开关、无开关联动，未还原 ASD 数值机制。来源与 contentGaps 的用户适配版说明保持不变；“旧版未经修改的全文逐字移植”仍为 not-completed。模型服务规则不由角色声明改变。

## 修改文件清单

新增：

- `M3-P2-DEVELOPMENT.md`
- `e2e/ai-settings.spec.ts`
- `src/prompts/composer.ts`
- `src/prompts/context.ts`
- `src/prompts/loader.ts`
- `src/services/ai/client.ts`
- `src/services/ai/configuration.ts`
- `src/services/ai/credentials.ts`
- `src/services/ai/errors.ts`
- `src/services/ai/protocols.ts`
- `src/services/ai/runtime.ts`
- `src/services/ai/snapshot.ts`
- `src/services/ai/sse.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/commandCatalog.ts`
- `src/tests/ai-client.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/ui/settings/AiConnections.tsx`

修改：

- `DEVELOPMENT.md`
- `package.json`
- `prompts/docs/ASSEMBLY.md`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/07_command_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `src/app/styles.css`
- `src/prompts/README.md`
- `src/prompts/manifest.ts`
- `src/tests/prompts.test.ts`
- `src/ui/settings/SettingsPanel.tsx`

主要职责：services/ai 是协议、凭证与不可变请求；src/prompts 是资源/上下文/组装；services/validation 是真实目录与候选校验；AiConnections 是现有 AI 设置页的实际表单；其余变更为最小输出契约对齐、注册 hash/version、维护文档、测试与 prompts:check 命令。未新增依赖，package-lock.json 不变。

## 尚待后续阶段

- M3-P3：完整提示词浏览/排序/Token 统计 UI、实际 API 上下文可视化；本阶段没有可复制的请求预览。
- M4：可玩回合、阶段自动编排、三次自动重试/失败恢复、迟到响应的持久化接收决策、候选语义复核与正式原子提交、世界结算。本阶段只提供输入快照、版本依据和校验基础。
- M5：长期记忆压缩、检索与后台调度。M6：地图完善、公告和压力测试。
- 真实供应商联调须使用用户主动配置并授权的服务；特殊 Prefix 等未支持能力继续跳过并诊断。
- NPC 私密档案、名器录、武侠数值体系及未经批准的新玩法没有实现。

本次不合并 main、不部署，提交 PR 后等待人工审查。
