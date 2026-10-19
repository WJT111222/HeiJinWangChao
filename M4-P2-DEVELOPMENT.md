# M4-P2｜变量管理阶段运行与领域命令完善

## 开发基线和交付边界

基于 GitHub 最新 main@`dac41b7`（PR #10 已合并），建立独立分支 `codex/m4-p2-variable-runtime`。审查正式 V0.1 设计/技术计划及既有 M1～M4-P1 源码：领域、草稿、存档、AI runtime/校验器、Manifest/Composer/context、九组变量规则与游戏界面。

本轮实现“已保存正文 → 程序选择领域 → 现有 Composer → 变量阶段模型 → 严格解析/证据/权限/整批模拟 → 候选草稿保存 → UI”。不执行世界阶段，不自动协调三阶段，不执行正式回合结算、不自动重试。没有增加运行依赖，没有修改其它仓库、Issue #6、两本世界书或用户 NSFW 正文。

运行 `npm ci`、`npm run dev`，配置既有 AI 渠道与变量路由，生成正文后主动点击「生成变量候选」。启用此前关闭的变量阶段时按钮为「启用并补算变量」，不要求重新 Roll 正文。每次主动调用可能产生供应商费用；本轮验收只用 Mock。

## A/B｜领域命令

从 14 类扩展为 22 类，八类新增命令如下。均保留 commandId/evidence，采用严格 Zod 白名单，不接受任意路径、任意字段或深度合并。

| 新命令 | 解决的问题 | 主要约束 |
| --- | --- | --- |
| UpdateProtagonist | 地点、身体、情绪、职业/社会/法律状态、已有合法文字技能 | protagonistId、expectedRevision；只允许固定字段；技能变更要求长期学习/资质类证据，不能改 ID/背景/传统属性 |
| UpdateNpc | 已有人物的在离场、地点、关系、健康、最近互动及特殊 NPC 目标 | npcId、expectedRevision；affinityChange 有 from/to/reason 与关系描述，范围仍 [-100,100]；普通 NPC 不接受特殊目标 |
| RecordNpcMemory | 当回合有意义记忆及可选知晓信息 | 稳定记忆 ID、当前唯一 turnId、时间、来源、受影响人物、visibility、knowledgeKind；特殊 NPC 可选择长期事实层，不进行压缩 |
| CreateLocation | 真实剧情所需的增量地点 | 稳定 ID、父级引用、全局唯一和无环层级；不预建地理数据库 |
| SpendFunds | 餐饮等已完成普通消费 | 正值整数分、明确账户、已知且足额余额；不创建物品/收入等永久经济实体 |
| AcquireItem | 有依据的无偿获得重要物品 | 新实体 ID、合法归属/类别/数量；拒绝明确车辆房产或资产同名的重复登记 |
| UpdateItem | 合法数量、状态和位置变化 | expectedRevision/expectedQuantity；consumption/gain 明确方向；消耗至0删除并解除装备，不修改 ID/类别/归属 |
| LoseItem | 重要物品遗失 | 前持有人必须匹配；保留同一实体 ID、解除持有与装备，未知地点不猜测 |

原交易、收入、借还款、装备、事件、任务、组织创建/关系和时钟命令仍有效。TransferItem 的 from 兼容扩展为 ActorRef 或 null：null 只可取回已经存在且确实无持有人的物品，支持遗失后拾回；不能抢走已有持有人的物品或重新复制实体。原 ActorRef → ActorRef 调用不变。

组织没有新增通用补丁。四类原 Schema 保留，现场明确变化优先用 RecordOrgRelation；未支持的房产/其它资产创建或估值、组织其它字段等列 unresolved，不假装具备任意资产/组织更新能力。

### 场景、身份和关系

主角跨地点时，批次必须明确为每个原在场 NPC 提供 UpdateNpc.onScene 结果。程序不自动决定其离场或跟随；最后一条空间更新的证据必须以可识别的明确句式关联 NPC、主角、移动动作与目的地，不能仅凭 onScene=true 和相同地点判定同行。原地留守和离场至另一个已知地点也需要各自的实际依据；去向不明时使用 onScene=false、locationId=null 显式清除地点，而不推定等候或跟随。null 仅是 UpdateNpc 命令层的清除指令，正式 NPC 仍按原 Schema 省略未知地点字段，无存档迁移。最终由原 GameStateSchema 校验同场一致性，冲突整批失败。

NPC ID/identityKey 原有去重保留；新增别名重叠及初始同伴重建防护。不同身份 NPC 可以同名，保留原 M1 测试。别名重叠的真实不同人可能被保守拒绝，需要在模型结果中列 unresolved，不能由程序猜测身份。

初始同伴仍保留创角 affinity=0 占位，没有自动计算初值。NPC Schema 仅增加可选 `affinityConfirmed: true`：旧档没有该字段继续显示未确认，不迁移猜数；有具体叙事原因的 UpdateNpc.affinityChange 使用 from=null 提出首次确认，后续则核对真实数值前值。关系说明和原因缺失、普通问好寒暄或范围越界拒绝。该标记在本轮只出现在模拟结果语义中，正式 NPC 仍不改变；M4-P5 将来提交合法命令后，现有玩家/正文投影才会识别确认值。没有通过 React 或创角硬编码好感，也没有放开 NPC 内部身份/关系可见性规则。

这是向后兼容的可选字段扩展，原 schemaVersion=2 存档可原样读取，不添加默认真值、不写迁移后的新猜测值。GameState 顶层、TurnDraft、四类组织、七项设置和依赖锁均未重构；未宣称旧版本应用可读取未来新命令存档。

### NPC 知识边界

RecordNpcMemory 仅记录本回合事实，sourceTurnIds 必须只含当前 turnId；来源文本须出现在 evidence，时间不能超出本批执行至该命令时的 worldClock，受影响实体必须合法。需要推进时钟时先列 SetWorldClock，再记录对应新时间的记忆/互动。记忆 ID 与已有记忆重复拒绝。

reported/suspected 分别要求文本保留 `[转述]` / `[推测]` 标记；“NPC 听到某个说法”不变成“说法为客观事实”。保留原 visibility/knowledgeSource，未公开记忆不会进入普通记忆界面。变量阶段禁止通过 CreateNpc 内联 memories/knownInformation/longTermMemories 绕过来源检查，新知识改用专用命令。既有记忆不覆盖、不压缩；特殊 NPC 可追加当回合重大长期事实和更新目标，不运行 M5 总结或场外行动。

## C/F/G｜运行、版本和存档边界

1. UI 显式触发，复制当前设置/配置；与 StoryStage 共用 StageGuard，按存档互斥并分配不可复用尝试身份和取消信号。
2. 从 SaveRepository 重读正式状态和草稿，比较完整预期草稿、saveId、turnId、baseSaveRevision、已保存 ready 正文和 opening 边界；已归档 turnId 拒绝。预先校验变量开关、路由与凭证，无效配置不清空旧候选。
3. 使用既有 startStageAttempt(current,['variables'],新开关配置)，持久化新尝试，再开始网络。保留正文、storyRevision、turnId 和绑定输入；executionRevision 递增，两个 stageRequestRevisions 按原依赖重置，旧变量及世界候选失效。世界开关仍独立快照，不发世界请求。
4. 通过原 runStageRequest(stage='variables')，按草稿模式选 opening/regular，使用现有变量阶段独立/跟随路由、排序和 Composer。变量上下文补入 TURN_CONTEXT 与实际 SELECTED_VARIABLE_DOMAINS，模型能给记忆/命令写真实 turnId，不另拼简化提示词。
5. 复用 parseVariables、VariableResultSchema 和 commitCommands 在脱离仓库的副本中整批模拟。任何非法命令让整批候选失败，不丢弃坏命令后部分接受。
6. 返回后核对请求依据的全部正式/草稿/正文/执行/阶段请求版本。保存 variables.validation='validated'、result、storyRevision、requestRevision；candidateRevision 取旧候选+1 与新执行版本的较大值，draftRevision 再加一，stageStatus.variables='ready'。validated 只是程序规则通过的候选，绝非已结算。
7. saveDraft 使用原 expectedDraftRevision 与 AbortSignal 原子替换。事务再次核对正式 revision；跨标签页新尝试、正文 Roll 或正式状态变更使迟到响应拒绝，不强制覆盖。网络不进入 IndexedDB 事务。

本轮工作流只调用 load/loadDraft/saveDraft，绝不调用正式 SaveRepository.save。模拟的资金、NPC、装备、时钟、appliedCommands 等不会写回正式对象；worldClock、turnNumber、journal 和所有正式实体保持不变。领域命令能力可单独确定性测试，但没有新增正式 UI 提交入口。

重新生成变量是明确的新尝试，原变量与世界候选在启动时失效；失败不恢复旧候选冒充新结果，正文始终保留。普通失败只在仍活跃、版本未变时保存 failed 和安全错误码/执行版本；不存供应商原文。取消/卸载不追加迟到失败写入；若启动尝试已持久化，刷新恢复 pending，允许再次手动生成。取消不能撤销已完成的原子提交；最终保存时按钮禁用，离开页面仍可在事务完成前中止。

不实现自动三次重试；单次失败可手动重新生成。StageGuard 仅提取 M4-P1 既有锁/取消逻辑以复用，StoryStage 的正文、安全 Roll、流式解析、保存路径与测试全部保留，不新增第二套客户端或三阶段协调器。

## D｜九组提示词绑定

选择直接读取真实 Manifest 域 ID，保留 init/update/offscreen 注册与固定排序。变量运行只选择对应 opening.init 或 regular.update，不注入 offscreen/正文输出协议或 NSFW。

- 主角、普通 NPC、特殊 NPC、物品、经济是现场五组安全底座。variableGuide 可能漏写消费、人物或物品，不能因此省去规则。
- 四类组织依据正文中的真实实体名/ID、指导 subjectHint、类别关键词选择；开局、指导泛称组织、类别不明或此前领域权限失败时保守加载四类。
- 普通公司场景可只加商业组；没有可靠分类线索时九组全加载，函数返回每组可解释原因，不额外调用分类模型。
- 候选还经过 assertVariableCoverage：创建/更新关系所需组织类别没有装配时明确失败，不让命令绕过专属规则；下一次手动尝试按已记录 permission 失败保守覆盖，绝不自动增加付费请求。

程序启发式不是完整语义分类器。五组底座与不确定时多加载会增加上下文 Token，这是首版为防遗漏作的取舍；未来可在回归覆盖下优化。实际加载顺序仍由 M3 Composer/Manifest 决定，合法排序偏好继续应用；请求快照可核对实际域与唯一阶段模板。

## E｜证据、权限及失败

- evidence 必须是正文原文；检查其所在句子而非只信裁出的子串。明确的计划、未来、条件、否定、取消、NPC自称/传闻、人物对白标签与引号语境不被提升成客观状态。行内角色标签止于换行，独占一行的标签仅约束紧接的下一行；空段及显式旁白重置归属，跨行未闭合引语仍拒绝。正常新行旁白不继承整篇前文的角色身份。非 observed 记忆例外仅用于记录转述/推测本身，仍保持知识性质。
- 经济命令要求已完成标志、一处明确数字元/分金额、现金/线上渠道，继续核对整数分、账户、足额已知余额和业务意义；未知余额不猜0，账户内部转账仍不是收入。
- 时钟推进要求正文实际耗时/时间锚点，禁止倒退；计划明天出发不推进。星期仍从正式/投影 worldClock 确定性计算，没有独立星期字段。
- NPC 写入只限原/新在场人物，或 evidence 明确联系到的电话/视频/短信/来信对象；仅在正文想起某离场人物不授予写权限。物品转移和获得也检查允许参与者。
- 类型、实体、合法字段、前值、唯一性、引用、场景、记忆来源、幂等和最终整体状态由严格 Schema/领域模拟校验。相同命令 ID 的重放不重复执行；改内容拒绝冲突。完全相同交易仅换命令 ID 也不能重复放入同一候选。
- rejectedSuggestions/unresolved 由模型如实返回，合法的空 commands 允许保存。无安全命令、证据不足、未知账户/金额、未支持能力必须拒绝或列 unresolved，不能发明任意路径。程序发现非法候选则整批失败，不伪造一份成功结果。

这些检查只能确定性拒绝一部分明确反证，不能证明所有自然语言事实。复杂转折/否认/引号可能被保守拒绝；中文大写金额、多个金额、隐含账户等会要求 unresolved。不同 ID、不同措辞但语义相同的事实不能保证完全自动去重；语义、合理耗时、归属与关系幅度仍须模型按上下文判断和未来提交审查。本轮不声称已解决通用事实证明或模型提示注入问题。

## H｜文件清单及提示词保留

新增：

- M4-P2-DEVELOPMENT.md：本报告。
- src/domain/variableCommands.ts：八类命令、白名单及确定性执行。
- src/services/validation/evidence.ts：证据反证、账户/金额完成性、参与者权限。
- src/prompts/variableDomains.ts：固定九域选择、原因及候选覆盖检查。
- src/workflows/stageGuard.ts：正文/变量共用锁、取消和尝试身份。
- src/workflows/variableStage.ts：变量请求、显式尝试、候选/失败保存。
- src/ui/game/useVariableGeneration.ts：UI 生命周期与手动取消。
- src/ui/game/VariableCandidates.tsx：宽敞只读候选面板，完整内部信息主动查看。
- src/tests/variable-commands.test.ts、src/tests/variable-stage.test.ts：55 项新增自动化。
- e2e/variable-runtime.spec.ts：3 个场景 × 桌面/移动。

修改：

- src/domain/commands.ts：接入八类命令、明确场景转换、身份防重、无主物转移及装备共用逻辑；保留原紧凑格式以缩小无关 diff。
- src/domain/npc/schema.ts：兼容的可选好感确认标记。
- src/services/validation/aiOutputs.ts：沿用原解析/模拟并增加证据、权限、重复事实防护。
- src/prompts/context.ts：真实回合/阶段版本容器、已选领域和已确认好感读取。
- src/workflows/storyStage.ts：使用提取后的共用阶段锁，正文流程不变。
- src/ui/game/GameScreen.tsx、src/app/styles.css：最小变量按钮、进度、失败、未结算候选入口，不改三栏结构。
- src/ui/panels/playerView.ts：初始同伴仅在确认标记存在时显示数值，其余信息隔离保持原样。
- src/app/App.tsx、src/ui/settings/PromptInspector.tsx：准确的 M4-P2 能力文案。
- src/tests/prompt-runtime.test.ts、src/tests/prompts.test.ts：原目录断言更新为22类，原14类批次仍测试14条，交易证据从通用占位升级为明确金额/账户；原测试未删除。
- prompts/shared/07_command_output.md、prompts/docs/OUTPUT_CONTRACT.md：只在原文末尾追加 M4-P2 当前目录/知识/候选说明，旧正文完整作为前缀保留，历史14类能力不再被误认成当前上限。
- prompts/manifest.json、prompts/sources.lock.json：对应两个资源版本/hash/字符数和来源追加记录，使用 npm run prompts:refresh，不篡改来源为逐字上游复制。
- DEVELOPMENT.md、src/workflows/README.md：阶段入口与边界更新。

受保护范围核对：原 94 个文件中仅有上述6项必要变化（两份追加协议、两个注册/来源 JSON、commands.ts 和 NPC Schema），其余88项保持字节一致。正式 docs、全部世界书/NSFW、原九组专属规则、六套阶段主模板、七项设置 Schema、其它领域 Schema 和依赖锁均未修改。NSFW SHA-256 仍为 `7fb4f10a265d3a95a3eb3ac2da1f6ade78fb46698616ce5258f3b57854a7f3ed`，没有新开关；旧版逐字移植验收缺口保留。

## I｜实际验收

| 命令 | 结果 |
| --- | --- |
| npm run prompts:refresh | 原75项资源元数据更新，无重复模块或无效路径 |
| npm run prompts:check | 82 项通过 |
| npm run check | 410 项通过：原281项 + 首轮55项 + 首次审查39项 + 否定作用域复审35项；ESLint 零警告、TypeScript 与生产构建通过 |
| CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e | 50 项通过：原32项 + 首轮6项 + 首次审查4项 + 否定作用域复审8项（新增场景均覆盖桌面/移动） |
| git diff --check | 通过 |

新增自动化覆盖请求闭环与三协议独立路由/usage、无 ready 正文、错误 JSON/越权/余额、普通消费/计划付款、关系/寒暄/初始同伴占位、私有记忆与传闻来源、稳定身份防重、人物移动/无环地点、非法引用、获得/数量/遗失/拾回/装备、幂等/内容冲突、原子批次回滚、显式重算与世界失效、正文 Roll/执行版本/正式 revision 冲突、取消/超时/迟到/共用锁、运行开关快照、无效配置保留旧候选、凭证回显拒绝及实际领域/阶段模块绑定。

真实 Chromium 示例：隔离测试存档正式现金100元，正文“已经用现金支付30元吃饭”；变量独立模型 variable-browser-model 返回 SpendFunds(3000分)。候选程序校验通过并刷新恢复，左栏现金仍100元，正式状态序列化前后相同，turnNumber=0、journal不增。候选有1条命令、1条拒绝和1条未解决事项；内部未解决文字默认隐藏，主动查看才显示。查看器记录实际 opening.variables、真实模块与 Mock usage input=61/output=12/total=73，严格区分估算。这是 Mock 预设返回，不是真实计费或 tokenizer 校准。

桌面/移动截图已实际查看，位于本地忽略目录 test-results/variable-runtime-变量正常生成…-{desktop|mobile}/variable-runtime.png。无明显溢出，三栏/手机堆叠、取消、候选面板和键盘关闭可用。首轮新 E2E 的请求查看器定位名写成“AI阶段”，已改为实际“检查阶段”并全套重跑；没有为通过而削弱功能校验。所有测试均拦截 Mock HTTP，不调用付费模型。

## J｜尚未实现与限制

- M4-P3 动态世界执行、M4-P4 完整协调/自动三次重试、M4-P5 正式回合事务提交仍未开发。世界开关只记录新尝试配置，不调用世界模型。
- M5 记忆压缩/智能检索/调度、M6 稳定性扩展、M7 重构、V0.2 小剧场/独立 NPC 正文/迷雾/作弊、DLC/自由 Schema/世界书编辑器未开发。
- 未提供玩家主动改变量的管理器。候选面板只读，完整内部查看不改变主角认知、普通日志或正式数据。
- 未支持的组织/资产或其它字段仍 unresolved；未知余额无法直接消费/转账，也不会因本轮开局自动填财富。复杂证据、类别误判或身份歧义可能失败，需要模型修正后的手动再生成。
- 真实供应商的 CORS、权限、参数和语义服从没有付费实测；沿用 M3 原生兼容范围，不保证所有服务可用。取消不能撤销供应商已经产生的费用。
- 取消/刷新不续传 HTTP，不永久保留原始模型响应。失败保留正文；重新生成变量会按显式尝试规则废弃旧候选，而非保留旧候选作为新结果。

本阶段代码以独立 PR 提交，等待最终人工审查，不合并、不部署、不发布。

## PR #11 定点审查修复

同步现有远程分支 `codex/m4-p2-variable-runtime` 后实施，原提交 `e40d81f` 完整保留，没有创建新 PR、切换 main 或重新开发工作流。

### 修复文件与回归

- `src/services/validation/evidence.ts`：移除全文 priorSpeaker 继承，按当前行、独行标签、空段和显式旁白限定角色归属。相邻角色对白不污染旁白的句内证据，否定/计划/取消/角色自述与跨行引语仍拒绝。
- 新增 `src/domain/sceneTransitions.ts`，并由 `src/domain/commands.ts` 在整批模拟结束时调用：检查最后一次空间更新的明确行动依据，拒绝“主角独自进诊所”却把 NPC 搬到诊所的候选；明确同行、实际会合、留守、独立离场、未知去向分别处理。歧义同名人物不能用于确认同行，稳定 ID 仍可关联；离开某地不被当成抵达某地。
- `src/domain/variableCommands.ts`：仅扩展已有 UpdateNpc.locationId 命令字段支持 null 清除。动态 COMMAND_CATALOG 自动展示该含义；NPC 正式 Schema/schemaVersion/已有存档不变，旧命令仍可解析，没有增加命令类型。仍在场时禁止清除地点；旧档缺少地点的非空间更新保持兼容。
- 新增 `src/tests/variable-review.test.ts`：39 项正反回归，包含 LF/CRLF、空段/独行标签/显式旁白、跨行引语、转账自述、否定/计划、错误跟随、真实同行/会合、留守/离场/未知去向、拆分覆盖、同名歧义、旧档兼容和九域兜底。
- `src/tests/variable-commands.test.ts`：原移动正例补充真正的同行/留守证据，原测试全部保留。
- `e2e/variable-runtime.spec.ts`：新增2个场景 × 桌面/移动。实际浏览器验证店员对白后的换行消费成功、错误跟随失败且无候选、修正留守后可手动重试；正文与正式 GameState 始终保持不变。
- `M4-P2-DEVELOPMENT.md`：本次修复、成本评估及最终验收记录。

### 无组织线索时九域加载的成本

从当前 Manifest 路径读取四类组织资源，按现有 `unicode-heuristic-v1` 分别估算并求和：

| 额外组织规则 | 字符数 | Token 估算 |
| --- | ---: | ---: |
| 开局 init 四组 | 1,311 | 1,870 |
| 普通回合 update 四组 | 1,338 | 1,910 |

这里仅统计四组资源原文，不含模块标题、其它规则、动态上下文或消息协议开销；估算不是供应商实际用量或计费数字。各模型 tokenizer 会有差异。

`variableDomains.ts` 本轮保持不变。没有组织关键词只能表示分类证据不足，不能证明没有组织相关事实；直接删掉四组会使新组织/别名场景静默缺少规则。保留现有开局/不确定性兜底，以及已知类别明确时仅加载对应组织组的优化，不增加分类 API 请求。进一步减少默认组织成本需有可靠相关性证明和回归覆盖，本轮没有为减少 Token 放宽安全边界。

### 仍有的边界

同行校验是有意保守的明确句式白名单，不是通用语义推断器。代词、复杂修辞、只用地点简称、间接转述或不能确定参与者的真实行为可能被拒绝，需要模型用正文中可核验的明确证据，或记录 unresolved 后人工再试；程序不会改写正文、自动让 NPC 跟随或自动补齐地点。原正式存档、草稿版本校验、取消/迟到防护及候选未结算边界均不变。没有新付费 API 调用，也没有提前开发后续阶段。

## PR #11 最终复审：否定作用域

从原远程分支同步，基于 `657f110` 定点修复；不创建新 PR、不修改 main。

- 新增 `src/domain/factPolarity.ts`：正文证据与场景命令共用明确否定的范围判断。以分句与转折划定作用范围，用证据/实际行动句式的字符区间关联否定；不是在两个整句关键词黑名单中继续加词。逗号后的省略主语（如“不是主角，已经……”）保守延续否定，“但/而是/却”等转折可开始另一事实。有限识别“这并非事实”“但没有成功”等紧邻回指，不把“同事没有完成工作”错误关联到主角的付款。
- `src/services/validation/evidence.ts`：保留证据在原正文中的精确位置，再检查相应分句，拒绝“没用现金支付”“不是主角已经支付”等及其裁剪证据。无关人物/其它分句的否定不再封禁当前已完成事实。既有计划、条件、取消、对白、引号、转述、账户/金额等保护仍保留。
- `src/domain/sceneTransitions.ts`：针对匹配到的具体同行、会合或留守句式检查否定范围；“不是/并非同事和主角一起进诊所”不能通过领域模拟，“不是同事留在重庆”也不能确认为留守。不同分句的无关否定不直接否决真实同行。
- `src/tests/variable-review.test.ts`：新增35项正反回归。先在旧实现复现19项失败，再修复；新增测试覆盖四个指定反例、完整/裁剪证据、省略主语、后置否定、转折/并列已完成事实及留守否定。既有全部测试保留。
- `e2e/variable-runtime.spec.ts`：四个反例各覆盖桌面/移动，共新增8项。真实浏览器验证否定证据让变量候选整批失败；修正为同句的实际线上付款或同段的明确留守后可手动重试；正文和正式 GameState 均不改变。
- `M4-P2-DEVELOPMENT.md`：更新最终验收记录。

最终重跑 `npm run prompts:check`（82项）、`npm run check`（410项，含 Lint/TypeScript/生产构建）、`CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`（50项）及 `git diff --check`，全部通过。全部使用 Mock，不调用真实付费 API。没有修改命令类型、存档 Schema、提示词资源或世界书。

边界：这是确定性的有限句法检查，不是通用中文否定、反讽、跨句指代或双重否定推理器。命令应引用精确的已完成事实；证据横跨多个事实并混入否定、或无法可靠确定作用域时仍应保守失败/列 unresolved，不自动反转事实或改写正文。没有把计划和传闻改成可信事实。
