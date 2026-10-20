# M4-P3 动态世界运行阶段

基线：`main@6bf9e258114a3f4a6c8cbd4a80eaee527066d497`。开始前 fetch 核对一致，独立分支 `codex/m4-p3-world-runtime`。本报告对应候选运行实现，尚待用户审查；没有合并、部署或真实付费 API 调用。

## 已实现的运行流程

1. 玩家手动生成/补算，WorldStage 冻结设置与 API 配置，复用 StageGuard 同页互斥、取消身份。
2. 从 SaveRepository 重读正式状态和草稿，核对存档、回合、正式版本、正文 ready、完整草稿指纹及开局资格。变量候选的 `validated` 标记不能代替重新 parseVariables 校验。
3. 配置预检后用 startStageAttempt 显式创建世界尝试；保留正文和合法变量，废弃旧世界候选。保存新的执行版本、世界请求版本及开关配置。
4. 从正式基线计算变量输入投影，真实 Manifest/Composer 按 opening/regular 装配独立 world 主提示词、共享协议和相关领域模块。复用 Runtime、三协议客户端、独立/继承模型路由、凭证保险箱和内存请求检查器；不增加 AI 分类调用。
5. 严格 JSON → WorldResultSchema → 命令分区白名单 → 来源、时间、逐字段权限 → 任务/事件状态和引用 → commitCommands 整批模拟。任意非法项使整批失败，不悄悄丢弃非法命令再保存剩余结果。
6. 返回时核对 saveId、turnId、baseSaveRevision、draftRevision、storyRevision、executionRevision、stageRequestRevision、basedOnVariableRevision 及 preview 标记；saveDraft 再在 IndexedDB 中检查正式 revision、草稿 CAS 和版本转换。
7. 只保存 TurnDraft.world 及阶段状态。网络不在数据库事务内等待。生成中可取消，保存原子阶段不能取消；错误只保存安全失败码，冲突或取消不强制写回。刷新可手动重新生成，不提供自动协调/重试。

## 正式状态与兼容性

**WorldStage 的仓库依赖只含 load/loadDraft/saveDraft，不含 save。正式 GameState 的经济、NPC、物品、任务、时间、历史、记忆与幂等账本均不受世界候选影响。** 临时投影脱离仓库，正式提交仍待 M4-P5。

没有改动 GameStateSchema、TurnDraftSchema、领域命令 Schema 或存档版本，无需迁移。没有新增命令；仅将已有八种命令授权给世界阶段的受限分区。原有变量命令和 evidence 原文契约保持不变。

世界请求允许复用已经合法校验的变量候选，即使本次变量开关关闭。没有合法变量时返回 `preview`、stageStatus.world=preview，不能冒充 ready。补算世界保留选定正文及变量；补算变量使旧世界失效；重新 Roll 使两类旧候选失效。相同存档的跨标签页修改、删除、正式版本变化和迟到响应都受乐观锁保护。

## 命令与权限

| 分区/type | 允许范围 | 拒绝范围 |
| --- | --- | --- |
| worldCommands / UpdateNpc | 已有场外 NPC 的 locationId、healthText、onScene=false；特殊 NPC 的 activeGoals | 主角/现场、onScene=true、affinityChange、relationshipText、lastInteractionAt；开局同伴更新 |
| RecordNpcMemory | 当回合、人物自身来源、时间与知识性质一致的记忆；兼容 personal/longTerm 容器 | 把他人私密来源写入自身知识、转述当 observed、derived 标记 player_known；不做压缩 |
| CreateNpc | 合法独立场外人物、稳定身份、无内联记忆；好感0未确认、关系“尚未与主角接触” | 现场互动、重复身份/别名/初始同伴、已确认好感、主角互动时间 |
| CreateLocation | 合法稳定 ID、父级和引用、增量地点 | 循环、缺失引用、批量全国数据库 |
| CreateOrganization | 四类独立 Schema 的合理初始化 | 资金/资产/流动估值、内联主角关系历史；不添加经营更新命令 |
| RecordOrgRelation | 已有组织、明确 established 来源与原文理由/关系 | 自主编造主角已参与交易或承诺 |
| taskCommands / SaveTask | 场外 NPC/组织自身任务；旧行动者/目标/开始时间/完成条件不变 | 主角任务改派、现场人物任务、未来提前完成、清除旧阻碍、自证循环、终态改写 |
| eventCommands / SaveEvent | 合法场外参与者、时间、状态、来源回合；主角参与的执行结果仅 established | 自主替主角行动、现场重复执行、非法来源回合/终态/提前结案 |

受保护现场采用正式快照与变量投影的并集。本轮刚离场人物也暂不二次调度；需要更精细的离场时刻调度时留后续，不用额外字段猜测。开局同伴受保护，普通回合已离场同伴仍可按正常边界自主行动。

主角资金/装备/物品、后台经济与物品变化、组织经营更新不在权限内，写入 unresolved。事件描述不代表正式资产已经发生变更。

## 自主性、来源与语义边界

在原有 evidence 字符串中编码严格 `WORLD_EVIDENCE_V1` JSON，不增加正式字段：

```json
{"version":1,"kind":"derived","at":"2026-10-18T08:05:00+08:00","sources":["goal:npc-a:0"],"fact":"同事整理了诊室。","rationale":"依据独立工作目标，在十分钟空档内整理器材。"}
```

真实来源目录由程序生成：story:current、npc:ID、goal:ID:index、memory:ID:ID、knowledge:ID:index、org:ID、task:ID、event:ID。来源记录携带 fact/plan/motive/statement、参与者、私有所有者及适用时间；模型不能发明来源 ID。

- established：提供的客观原文通过现有对白、否定、计划/传闻反证检查。
- derived：允许未逐字存在于旧正文的新场外行动；必须有已有事实或动机，时间在窗口内，不能只有计划或使用未验证陈述。引用任务/事件不得绕过其开始时间、取消状态和关键阻碍。
- planned：只表达计划、目标、排程，不表示执行。可基于传闻计划核实，但不能升级成结果。
- reported/suspected：只记录对应类型 NPC 记忆，保持前缀、来源、时间和可见性；不作为世界客观完成依据。

人物自身动作不能仅引用主角私密正文作为自主依据；私有 NPC 来源不能越过所有者进入另一人物知识。世界上下文不包含待选 actionOptions 或未来玩家输入。人物面板的现有可见性不变，未开发角色迷雾或认知切换。

完成任务/事件须已开始、在本轮时间内且无未解决前置条件/阻碍。derived 完成还需提供非空具体 outcome，区别于笼统“完成/到期”宣告。程序只对已完成 task 或已 resolved event 的稳定 ID 条件作确定性判断（支持 task:/event: 前缀）；自然语言条件或同批才能消除的依赖保守拒绝，应 unresolved，不能通过删除旧阻碍绕过。

这些验证不是通用中文语义求真器；模型仍须判断资源、耗时、动机和实际成果，结构合法不代表叙事语义绝对正确。不支持的或无法可靠证明的操作应 unresolved。正式提交阶段仍须重新校验；本阶段不以“validated”声称永久事实。

## 时间、futureEvents 与内部候选

统一窗口为正式 worldClock → 合法变量投影 worldClock；世界阶段没有 SetWorldClock。at 在窗口内，实际开始/执行/结案不能在未来，derived 位置/健康变化必须经过时间。未来 dueAt/estimatedEndAt 可存在，但到期不构成完成依据。

futureEvents 必须是本批已校验 SaveEvent 的完全相同镜像：新 ID、scheduled、startAt>=投影时间。没有对应命令、旧终态重新放入、不同内容、重复 ID 均拒绝；只模拟一次。

visibleHooks、revealAfter 和 timelineCandidates 都留在内部候选。revealAfter 到达不发布线索，不写普通正文/日志/历史，不更新主角认知；时间轴只接受已 resolved 的重大事件 ID，正式揭示与归档留后续。

## 提示词绑定与成本

沿用真实注册资源，没有提示词副本；顺序为：

1. 世界观(10)、现代现实逻辑(20)。世界阶段不注入正文身份/NSFW/COT/正文标签协议。
2. agency(30)、knowledge(40)、time_events(50)、state_authority(60)、context_protocol(70)。
3. `stages.opening.world` 或 `stages.regular.world`(300)，二选一。
4. `shared.08_world_output`(408)。
5. 九域 offscreen(502/512/522/532/542/552/562/572/582)；opening 额外保留四类组织 init(550/560/570/580) 的既有加载设计。
6. 最后为真实本轮上下文 user 消息。

九域 offscreen 合计 3,384 Unicode 字符；保守全覆盖避免新场外 NPC/组织在正文没有关键词时静默漏规则。主角/物品/经济 offscreen 是权限边界说明，并不赋予对应命令。这里优先安全覆盖，不增加分类请求；后续可根据真实规模优化，不能删掉约束换取 Token 下降。实际规模和估算可在既有提示词管理中心查看，供应商真实 usage 独立记录。

两套世界主提示词仅追加当前阶段接入说明，保留原职责，开局不强迫创建全国阴谋；普通回合不复用灾难式初始化。共享世界输出契约对齐受限八类命令、JSON 字符串来源凭据与 futureEvents 镜像。使用 prompts:refresh 同步字符数/哈希/占位符，来源锁保留历史 SHA，明确是契约更新而非逐字资源。两本世界书、用户 NSFW、七项写作设置均未改动。

## 界面

现有三栏内新增手动生成/补算、生成/保存状态、取消与错误提示；世界候选弹窗默认仅版本/计数/未结算说明，主动展开才读取完整脱敏 JSON。支持仅开启世界预览、变量关闭时复用合法候选、重新生成且不 Roll。既有提示词管理可查看真实 world 请求快照及 usage；预览与真实发送仍分开。没有把内部 hooks 输出到普通正文或日志，没有改变原玩家人物面板。

## 验证记录

| 命令 | 结果 |
| --- | --- |
| `npm run prompts:check` | 3 文件、82 项通过；真实资源、Manifest/哈希、六模式与原协议回归 |
| `npm run check` | Lint 零警告；15 文件、482 项测试通过；TypeScript 和 Vite 生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 56 项通过（桌面28、移动28），包含全部既有 E2E 与新增世界场景 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- e2e/world-runtime.spec.ts` | 最终权限细化后复验，桌面/移动6项通过 |
| `git diff --check` | 通过 |

新增世界验证与工作流测试共72项（51+21），保留原有410项。覆盖三协议、正常链路/preview/合法变量复用、现场及逐字段权限、主角任务改派、未来/到期/阻碍/终态、futureEvents镜像、来源/转述/私有记忆、地点引用、同一基线模拟、幂等冲突、坏JSON/网络/存储错误、取消/重生成/跨标签页/正式版本/删除/迟到与正式全状态不变。浏览器覆盖手动生成、补算、取消、仅世界预览、只读候选、实际请求快照/usage、刷新与移动无横向溢出。

全部网络结果使用 Mock/浏览器拦截，没有真实付费调用。浏览器截图由测试生成于 `test-results/world-runtime-*/world-candidates.png`，未混入正式资源或存档。开发中曾因提示词正文更新而元数据尚未刷新触发资源保护，以及测试未选择 regular 模式找不到快照；同步元数据和纠正测试模式后全部通过，没有删除安全校验或原测试。

## 文件清单

新增：

- src/domain/turnProjection.ts：统一正式基线的副本投影。
- src/services/validation/worldEvidence.ts：来源目录、严格凭据与来源性质验证。
- src/services/validation/worldOutput.ts：世界分区、权限、时间、状态、镜像与合并模拟校验。
- src/prompts/worldDomains.ts：真实注册的领域选择与覆盖核验。
- src/workflows/worldStage.ts：手动世界运行与候选保存。
- src/ui/game/useWorldGeneration.ts、WorldCandidates.tsx：取消/补算状态与只读内部候选。
- src/tests/fixtures/world.ts、world-validation.test.ts、world-stage.test.ts：隔离数据与验证/工作流回归。
- e2e/world-runtime.spec.ts：桌面/移动真实交互、Mock 网络与 IndexedDB。
- M4-P3-DEVELOPMENT.md：本报告。

修改：

- src/prompts/context.ts：时间窗口、版本、来源和受保护现场上下文。
- src/services/ai/runtime.ts：真实世界请求前重验变量。
- src/services/validation/aiOutputs.ts、commandCatalog.ts：解析委托和真实受限目录。
- src/ui/game/GameScreen.tsx、src/app/App.tsx：最小世界操作与开发版本。
- src/ui/settings/PromptInspector.tsx：阶段已接入的准确空状态文案。
- src/workflows/stageGuard.ts：共享锁注释；既有锁行为未重写。
- src/tests/variable-commands.test.ts：保留原测试，更新三类已获场外授权命令的目录期望。
- prompts/shared/08_world_output.md、stages/opening/world.md、stages/regular/world.md：现行世界执行契约。
- prompts/docs/ASSEMBLY.md、OUTPUT_CONTRACT.md、manifest.json、sources.lock.json：接入说明及元数据/来源追踪。
- README.md、DEVELOPMENT.md、src/workflows/README.md：更新当前能力与后续边界。

## 已知限制与后续依赖

- 没有真实付费调用，仅三协议 Mock 和浏览器拦截；真实供应商对本轮复杂 JSON 契约的遵守度需要后续授权验证。
- 世界结果为非流式 JSON；当前只支持手动一次尝试，不自动运行其他阶段、不自动重试。
- 不做自然语言条件求解或同批依赖调度；不能精确模拟城市交通耗时与资源足够性。来源/结果的语义一致性仍有模型与人工审查边界。
- 世界来源目录基于已存在正式/变量投影的实体。新人物可创建并关联任务/事件，但需要其自身来源的后续更新/记忆留到下一次合法投影，不用本批新来源自证。
- M4-P4 协调和自动恢复、M4-P5 正式结算/重新验证、M5 记忆压缩与调度仍未实现。preview 不会自动升级为 validated，变量补算后需要显式重新生成世界候选。
- NPC 角色迷雾、私人档案、作弊编辑器及其他 V0.2 功能没有开发。

## PR #13 二轮审查修复

本轮继续原分支及 PR，不改 main，不合并或部署。下列为本轮变化，前面的验证记录保留为首轮记录。

### 当前实现 A1–A5

1. **地点事实**：CreateLocation 不再接受 planned，只接受 established/合法 derived。现实地点可补录、新场外事实可自主生成；计划建设进入任务或未来事件，未知实体进入 unresolved。ID/父级/循环引用沿用原有整批模拟。
2. **估计与实际结案**：scheduled/active/blocked 的 resolvedAt 和 resolutionText 必须缺失，空串也拒绝；resolved 须合法时间及非空实际结局。estimatedEndAt/dueAt 仍可由 AI 估计、保留或调整，到期只重新评估，实际结案可晚于估计。cancelled 保留现有可选说明/终止时间组合，时间不得晚于当前事实时点；未来安排可在开始前取消而不伪造 resolvedAt。futureEvents 镜像没有旁路。
3. **一人一任务**：确定性检查 actorRef.kind=npc 的正式状态、变量投影及本批候选；planned/active/blocked 占用，completed/cancelled 不占用。占用 ID 用 Set 去重，不能换 ID 或负责人绕过，同批终结不释放新任务名额；本批新建并终结 A 再给同人创建 B 也拒绝。组织可多任务。正式状态/变量投影已有旧冲突不自动删改；允许没有冲突性新占用的其他候选，但在内部 unresolved 追加程序诊断。冲突候选整批失败，并保留安全 npc_task_conflict 错误码与说明。
4. **完成来源**：已有任务/事件完成必须引用对应 task:<id>/event:<id>，established 也不豁免；仍可结合人物目标、能力、组织背景自主生成新成果。新建任务/事件不伪造尚未存在的自身来源，继续沿用合法动机/事实和窗口约束。完成条件、旧目标、行动者及已知阻碍保护不变；增加正式行动者核对，不能继承变量投影的改派绕过旧任务归属。
5. **终止与失败**：成功 completed；暂时受阻 blocked 且占位；实际失败并终止/合理取消用 cancelled，真实原因及结果保留在本轮 evidence.fact/rationale/outcome 中。对“未能/没能完成清点，行动已终止”，仅肯定的终止分句能支持取消，否定完成不支持成功、否定终止不支持取消。沿用分句否定作用域，没有添加语义通用推断器。笼统“时间到了/任务完成了”不能作为 derived 的具体成果。

### 本轮无法确定性验证的情况

- 组织任务的实际执行人没有结构化引用。程序只能核验 actorRef，不能识别自由目标文字中是否偷偷使用同一忙碌 NPC；提示词禁止借组织名义规避并要求不确定项 unresolved，不能宣称此处已完成硬校验。
- task 没有独立 failed 状态、实际结束时间及结果字段。当前 cancelled + 原有 evidence 能在 TurnDraft 保留真实失败/取消原因，但不能让任务状态本身区分全部失败类型。后续结算须把需要长期保留的结果衔接到合法事件/记忆，必要结构扩展另行设计审查。
- 任意复杂资源、耗时、自然语言成果与行动者指代仍需模型和人工判断；时间/状态/来源结构检查不是完整语义求真。没有为了减少 Token 取消九域约束，没有修改现有玩家资料面板可见性。

### 生命周期规范仅记录，未实现

正式产品规范完整记录于 DEVELOPMENT.md 的“动态世界生命周期正式决策”：NPC 任务接力不重指派旧任务；无继续职责时真正从正式活跃实体表删除，不设休眠池或永久完整备份；重要信息由现有记忆保存、重大事件由时间线保存；恢复人物优先依据可靠历史记忆；删除必须处理全部引用、保留历史并原子执行，不安全则阻止，保留重要同伴/剧情角色。上下文只重点模拟当前有职责对象，不永久模拟所有历史人物。

M4-P4 负责自动协调、到期重新评估、任务接力与调度范围；M4-P5 负责正式结算（重验变量+世界整批占用/引用，不只相信旧 validated）、成果交接及安全原子退场；M5 负责重要信息提取/记忆保存/人物恢复及长期规模控制。依赖不满足时不强行删除。当前没有 DeleteNpc、休眠字段、调度数据库、自动到期调用或正式状态提交。

### 本轮文件

- src/services/validation/worldOutput.ts：地点/事件校验、任务占用、旧对象完成来源、旧冲突诊断。
- src/services/validation/worldEvidence.ts、src/domain/factPolarity.ts：失败与肯定终止的分句边界、没能否定、任务冲突错误类型。
- src/services/validation/commandCatalog.ts、src/services/ai/errors.ts：真实阶段约束与安全错误说明。
- src/tests/world-lifecycle.test.ts（新增）、world-stage.test.ts：实体/估计/终态/来源/任务占用与真实 Runtime 不落正式状态回归。
- e2e/world-runtime.spec.ts：桌面/移动计划地点、预结案、任务冲突与合法估计重试。
- prompts/shared/08_world_output.md、docs/OUTPUT_CONTRACT.md、manifest.json、sources.lock.json：同步运行契约、版本、字符数与 SHA；保留历史来源记录。
- DEVELOPMENT.md、M4-P3-DEVELOPMENT.md：后续生命周期正式规范、阶段分工及本轮记录。

### 本轮最终检查

| 命令 | 本轮结果 |
| --- | --- |
| `npm run prompts:check` | 3 文件、82 项通过；Manifest/真实资源/哈希及既有协议回归 |
| `npm run check` | ESLint 零警告；16 文件、531 项通过；TypeScript 与 Vite 生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 58 项通过，桌面29、移动29，包括原有56项和本轮2项 |
| `git diff --check` | 通过 |

本轮新增49项自动化测试（world-lifecycle 47项、world-stage 2项），保留原有482项；新增一个浏览器场景在桌面/移动各运行一次。测试覆盖计划地点拒绝与存在事实、父级/重复ID、预计时间保留/延期/晚于估计的实际结案、非法实际结案字段及futureEvents旁路、兼容取消、planned/active/blocked占用、terminal释放、多NPC/多组织任务、同批接力与旧档冲突、正式/变量投影占用、旧完成自身来源、失败终止与分句否定、网络到草稿安全失败及正式整对象不变。原三协议、补算/取消/迟到、opening/regular及既有M0–M4-P3回归保留。

无未通过测试。全部使用 Mock 或浏览器拦截，没有真实付费调用。正式 Schema/版本、世界书、NSFW原文、七项写作设置、玩家资料面板、Runtime/Composer/StageGuard/SaveRepository实现保持不变。世界结果仍仅存候选，不提交正式 GameState。
