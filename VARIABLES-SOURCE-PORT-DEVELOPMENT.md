# Variables 独立变量生成系统源码移植

## 基线与源码审计

目标：HeiJinWangChao main@ab56de7b82fced60588eb23309a087efca495714（已含#51、#52、#53）。开发分支codex/variables-source-port。
参考：MoRanJiangHu main@74aa92722b1ea1304210393679328aed07476972，只读，未修改或推送参考源码。

直接阅读的对应关系：

| 源码 | 实际行为 | 目标复用/适配位置 |
| --- | --- | --- |
| prompts/runtime/variableModel.ts | 身份/职责/状态+选定正文+变量规划，三个标签，set/add/push/delete，删除索引倒序 | 原模块化Variables Prompt、Composer、context、TEXT_COMMAND_CATALOG |
| prompts/runtime/variableCot.ts | 变量域分析、开局与当回合对齐，分析不执行 | 共享Variables分析/输出说明；不复制武侠与其他题材字段 |
| prompts/runtime/variableGeneration.ts | Story提供自然语言变量规划，不是命令 | 保留STORY_RESULT、VARIABLE_GUIDE |
| prompts/runtime/openingVariableGenerationInit.ts | 开局角色/同伴/配置承接，逐域最小初始化 | 原opening文本模块、合法Story开局时间唯一注入 |
| services/ai/storyTasks.ts:839–1115 | 独立generate分支一次生成三块，分离reports/commands/rawText | runStageRequest、原文Store、正式文本解析 |
| services/ai/storyResponseParser.ts:1536–1830 | 标准四操作、引号/多行对象数组、delete无操作数；还有宽容别名/JSON修复分支 | 扩展现有文本解析器，不启用第二种JSON协议、eval/Function或静默跳过坏行 |
| hooks/useGame/variableModelWorkflow.ts | 当前状态+正文+规划，路径目录、去重、完整性保护、失败恢复 | 原目录+严格领域映射+单批模拟+原协调器 |
| hooks/useGame/variableCalibrationCoordinator.ts | 冻结快照、取消、分段进度、错误保留正文与恢复 | 原VariableStage、StageGuard、草稿CAS、失败诊断 |
| hooks/useGame/variableCalibrationMerge.ts | 将生成命令/说明独立合并到响应 | 只将规范化DomainCommand保存到既有VariableResult；说明与分析仅临时展示 |
| hooks/useGame/variableCommandValidation.ts | 已登记路径/动作/类型与NPC保护；含源项目专有审查 | 保留目标严格Schema、稳定ID/引用/知识边界；不移植额外剧情审查器 |
| hooks/useGame/responseCommandProcessor.ts | 顺序应用状态缓冲，最后落地；还有源项目业务净化/回填 | 原commitCommands/projectTurn/commitTurn，保留原子性，不移植武侠/自动改剧情逻辑 |
| utils/variableRegistry.ts | 显式根与路径索引，不自造路径 | 原TEXT_COMMAND_CATALOG按真实领域Schema注册 |
| utils/stateHelpers.ts:180–282 | set对象合并/数组替换、数值add、push数组、delete属性或splice索引 | 白名单DomainCommand映射，数组操作保持文本顺序与倒序删除语义；不能任意状态深合并 |
| hooks/useGame/streamIntegrity.ts | 缺终态拒绝结构化半成品，源可降级重发一次 | 原AiClient/SSE终态保护；目标默认非流式、失败显式恢复，不新增隐式付费重发 |

源仓库当前还包含独立review分支、JSON修复后保留子集、Function算术求值、语义校验自动再请求。它们不是本任务指定的单次三标签标准协议，不复制为新的审核阶段或第二条执行链。目标已有的保存、角色认知和事务机制优先保留。

## 最小实施范围

1. 在现有文本解析器支持标准delete语法，正式Variables入口按源协议分离thinking/说明/命令，完整闭合后才解析。
2. 将源数组/对象操作适配到现有领域白名单；源支持但没有安全领域操作的路径明确拒绝并列出，不默默跳过或任意修改状态。
3. 同一次现有Variables请求加载真实模块化Prompt、正文、规划和目标路径目录；不新增独立分析/审核请求。
4. 沿上下文、请求、协议、解析、映射、模拟、候选保存、正式提交提供静态安全步骤诊断；保留WorldRule和两规则NPC ID白名单。
5. 正式持久候选仍为原VariableResultSchema/DomainCommand[]，不改GameState/TurnDraft Schema或迁移。选定Story修订、StageGuard、CAS、幂等、开局时钟与自动结算全部复用。

## 实测记录

待实现后补充：先记录失败复现，再填写本轮实际执行结果。历史测试成绩不作本轮验收。

没有用户故障那次的完整响应/异常栈，不能声称还原该次线上故障。只根据源码与本地Mock验证可复现路径，剩余实机验证单列。

## 正式路径与既有领域命令（实际目录导出）

普通标量/对象使用set，数值增减使用add，数组追加一个值使用push，delete无操作数；NPC/实体表只用稳定ID，普通数组才使用[index]。

| 操作 | 路径 | 既有DomainCommand |
| --- | --- | --- |
| set | `protagonist` | UpdateProtagonist |
| push | `protagonist.skills` | UpdateProtagonist |
| set | `protagonist.skills[index]` | UpdateProtagonist |
| delete | `protagonist.skills[index]` | UpdateProtagonist |
| push | `npc[id].activeGoals` | UpdateNpc |
| set | `npc[id].activeGoals[index]` | UpdateNpc |
| delete | `npc[id].activeGoals[index]` | UpdateNpc |
| set | `npc[id].affinity` | UpdateNpc |
| add | `npc[id].affinity` | UpdateNpc |
| set | `items[id].quantity` | UpdateItem |
| delete | `items[id]` | UpdateItem |
| set | `protagonist.currentWear.topItemId` | SetEquipment |
| delete | `protagonist.currentWear.topItemId` | SetEquipment |
| set | `protagonist.currentWear.bottomItemId` | SetEquipment |
| delete | `protagonist.currentWear.bottomItemId` | SetEquipment |
| set | `protagonist.currentWear.shoesItemId` | SetEquipment |
| delete | `protagonist.currentWear.shoesItemId` | SetEquipment |
| set | `protagonist.currentWear.primaryWeaponItemId` | SetEquipment |
| delete | `protagonist.currentWear.primaryWeaponItemId` | SetEquipment |
| set | `protagonist.currentWear.secondaryWeaponItemId` | SetEquipment |
| delete | `protagonist.currentWear.secondaryWeaponItemId` | SetEquipment |
| set | `protagonist.currentWear.currentVehicleAssetId` | SetEquipment |
| delete | `protagonist.currentWear.currentVehicleAssetId` | SetEquipment |
| push | `protagonist.currentWear.accessoryItemIds` | SetEquipment |
| delete | `protagonist.currentWear.accessoryItemIds[index]` | SetEquipment |
| set | `events[id].sceneState` | SaveEvent |
| set | `tasks[id]` | SaveTask |
| set | `protagonist.locationId` | UpdateProtagonist |
| set | `protagonist.healthText` | UpdateProtagonist |
| set | `protagonist.emotionText` | UpdateProtagonist |
| set | `protagonist.profession` | UpdateProtagonist |
| set | `protagonist.publicStatus` | UpdateProtagonist |
| set | `protagonist.legalStatus` | UpdateProtagonist |
| set | `protagonist.skills` | UpdateProtagonist |
| set | `worldClock` | SetWorldClock |
| set | `locations[id]` | CreateLocation |
| set | `npc[id].locationId` | UpdateNpc |
| set | `npc[id].onScene` | UpdateNpc |
| set | `npc[id].relationshipText` | UpdateNpc |
| set | `npc[id].healthText` | UpdateNpc |
| set | `npc[id].lastInteractionAt` | UpdateNpc |
| set | `npc[id].gender` | UpdateNpc |
| set | `npc[id].privateProfile` | UpdateNpc |
| push | `npc[id].memories` | RecordNpcMemory |
| push | `npc[id].longTermMemories` | RecordNpcMemory |
| push | `npc[id].knownInformation` | RecordNpcMemory |
| set | `npc[id]` | CreateNpc |
| set | `npc[id].affinityChange` | UpdateNpc |
| set | `npc[id].activeGoals` | UpdateNpc |
| set | `npc[id].contact` | RegisterContact |
| set | `organizations[id]` | CreateOrganization |
| set | `organizations[id].protagonistRelation` | RecordOrgRelation |
| add | `economy.cash` | SpendFunds |
| add | `economy.onlineBalance` | SpendFunds |
| set | `economy.incomes[id]` | ReceiveIncome |
| push | `economy.transfers` | TransferFunds |
| set | `economy.debts[id]` | Borrow |
| push | `economy.debts[id].repayments` | RepayDebt |
| set | `items[id]` | AcquireItem |
| set | `items[id].purchase` | PurchaseItem |
| set | `items[id].transfer` | TransferItem |
| set | `items[id].loss` | LoseItem |
| add | `items[id].quantity` | UpdateItem |
| set | `items[id].conditionText` | UpdateItem |
| set | `items[id].locationId` | UpdateItem |
| set | `protagonist.currentWear` | SetEquipment |
| set | `economy.vehicles[id].purchase` | PurchaseVehicle |

可选gameState.前缀仅归一化已有根域，不创建中文根域或第二套协议。set protagonist只接受UpdateProtagonist白名单局部对象，不能覆盖id/身份。原有set NPC整对象仍仅用于CreateNpc，不是自由更新器。

源对象深合并被适配为已有领域白名单（例如privateProfile已有的受限合并），不引入任意深合并。数组set替换、push单项追加、set[index]改项、delete[index]用splice移除；多个删除按模型原始顺序执行，Prompt要求倒序，程序不擅自重排。原系统时钟先执行的例外保留。

新数组操作在既有evidence中保存程序生成的操作输入摘要，用于删除后仍能区分精确重放与同ID不同输入；这是命令幂等身份，不是要求AI提交的剧情证据、候选封印或审批许可。无新持久化字段。命令ID仍使用原text-v1:s<storyRevision>:c<ordinal>，记忆ID机制未修改。

### 明确未支持

- 不删除整个NPC、NPC唯一原始记忆/长期记忆、地点、组织、收入/债务/资产记录；不存在能维持引用/知识/记忆覆盖的原生命令。返回unsupported_path/unsupported_operation，整批失败，不默默忽略。
- 不把正数add economy现金解释成收入：仍须完整IncomeRecord；不初始化未知余额，不伪造收入/借贷/历史购买；房产购买等缺口不在本轮发明。
- 不移植源武侠根域、可变NPC数字索引、境界/内力/门派字段、名单审查和任意脚本表达式。目标NPC稳定ID及四类组织/经济语义保持原样。
- 不移植源parser的JSON备用输出、坏行跳过、Function算术求值、字符串到数字的宽容强转；本任务指定标准JSON值及完整文本协议，数据错误必须整批拒绝。
- 源默认流式可降级非流式自动重发，语义校验也可再请求。目标继续默认一次非流式Variables请求，显式流式调用缺终态/Token截断整体失败；保留已有协调器瞬时服务错误政策与玩家明确恢复，不新增隐式付费重发、AI裁判或独立分析请求。

## 失败复现与诊断

新增7项最小复现，修复前6失败、1通过：delete被原parser禁止；数组push/delete无映射；缺thinking/说明仍被当作成功；模拟真实候选保存QuotaExceededError后safeAiError确实为unknown。修复后7项通过。后续新增完整网络/事务回归，最终成绩在下文填写。

静态variableStep白名单覆盖context/load/draft_start/request/response/envelope/commands/mapping/simulation/candidate_save/commit。错误类别保留原JSON/Schema/引用/金额/时间/冲突分类，增加storage和variable_runtime；不复制异常消息、堆栈、响应正文、Key或动态字段到日志。WorldRule、scene_transition/scene_location两规则NPC ID白名单保留。

VariableStage保留原STORY_BUSY、DRAFT_CONFLICT、REVISION_CONFLICT等执行器错误契约和CAS行为；日志层转安全分类。保存失败仍可保存不含内容的失败元数据，正式GameState不变；失败元数据也不能强行覆盖新版本。

## 本轮验证（进行中）

- 新源码协议/适配/真实请求集成两文件39项通过（涵盖三协议、流缺终态、Token截断、完整开局与普通回合自动结算）。
- 初步相关4文件82项及旧parser/执行器回归已实跑；旧过时能力断言已按新增映射调整，保留非法类型、保留字段、无权限和原子性断言。
- 提示词检查82/82通过；定向桌面/移动12/12通过。
- 完整工程check已通过：60文件、2102/2102，含Lint、TypeScript和生产构建；完整Chromium324项仍在执行，不预报通过。
- 仅更新旧Mock为三标签新协议；生产解析器不会补标签或自动猜JSON。

阶段性代码在2102项工程、82项提示词和12项定向桌面/移动浏览器通过后提交推送；完整324项未完成前不声称最终验收。

本轮采用源streamIntegrity已存在的强制非流式分支：源在没有onStreamDelta时也如此，一次请求生成三标签。显式流式调用仍按目标AiClient检查终态，半截输出整体失败；不额外复制源审核重发分支。
