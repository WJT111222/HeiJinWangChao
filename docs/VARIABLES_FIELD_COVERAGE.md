# 天气、环境与 GameState 写入覆盖盘点

基线为 main `0d3fc3525bcfccb08d497faf7dcbbb9085839ca5`。本表覆盖 V10 的 30 个顶层字段。复合字段按子字段的实际写入权限拆分。「玩家」指设置里的变量管理器；创角、人物管理、记忆维护、回合撤回各有自己的入口。表中「只读」指没有相应的直接编辑入口。

## 两项修复

| 普通回合 Variables 的输入 | 执行与保存 |
| --- | --- |
| `set weatherText = "小雨，微风，略有凉意"` | 编译为 `SetSceneDescription`，目标为 `weatherText` |
| `set environmentText = "傍晚的商业街人流渐密，店铺灯牌陆续亮起，路面还留着雨后的水迹。"` | 同一领域命令，目标为 `environmentText` |
| 只写一项／同批写两项／空命令块 | 分别替换指定值；省略的字段继续沿用。模拟发生在副本上，正式结算时才写入存档。 |

两个目标由枚举限定，值按字符串原样执行。普通回合的提示词目录建议天气约 10 字、写清天气状态，环境约 30 字、概括场景的主要特征。是否有实质变化由 Variables 结合玩家行动、正文及存档判断。没有增加字段字数门槛、自动截断、天气词表、原文匹配或现实时间触发。文本协议原有的整包大小、JSON 类型与嵌套保护继续适用。开局仍用一次性的 `opening.initialState`，领域层也会拒绝在开局用普通回合命令覆盖初值。存档和数据库版本均沿用现有版本。

**核查链路**　正式提示词的 `TEXT_COMMAND_CATALOG` → 文本解析与编译 → 领域投影 → 保存候选 → Commit 重验与原子入库 → 下一回合 `GAME_CONTEXT.SAVE_STATE`。各阶段共用的状态投影本来就包含天气和环境。 [正式文本目录](../src/executors/variableText/catalog.ts) · [编译器](../src/executors/variableText/compile.ts) · [候选校验](../src/services/validation/aiOutputs.ts) · [领域执行](../src/domain/commands.ts) · [回合结算](../src/domain/turnCommit.ts) · [存档事务](../src/services/storage/saveRepository.ts) · [Story 状态投影](../src/prompts/sharedContext.ts)

## 字段与权限

| GameState 字段 | Variables 的实际路径与限制 | World、系统或只读归属 | 玩家变量管理器 |
| --- | --- | --- | --- |
| `weatherText`、`environmentText` | 普通回合分别 set；开局仅在初始化标记有效时补缺 | World 无写权限；后续阶段可读合法投影 | 两项均可编辑 |
| `worldClock` | 普通回合 set → SetWorldClock，不能倒退 | 开局使用 Story 选择的时间；历史回顾与程序停止时间受时间协议约束；World 只用合法时间窗 | 只读 |
| `openingTimePending`、`openingInitializationPending` | 可在授权窗口提交开局时间、初始化数据，无标记赋值命令 | 创角、时间选择及首次结算维护 | 只读 |
| `protagonist` 日常状态 | UpdateProtagonist 更新 locationId、healthText、emotionText、profession 及其说明和长期影响、publicStatus、legalStatus、skills；支持有限数组操作。SetEquipment 修改 currentWear 中的衣着、武器、饰物、车辆引用 | World 无权修改；物品转移或耗尽时领域层维护装备引用 | 上述字段可编辑，引用仍须有效 |
| `protagonist` 身份与建档资料 | 无普通回合直接命令修改 id、talentId、name、age、gender、appearance、personality、background | id 与天赋选择保留稳定身份；基础描述属于创角资料 | 姓名、年龄、性别、外貌、性格与背景可修订；id、talentId 只读 |
| `npc` 普通档案 | CreateNpc 建档；UpdateNpc 修改 name、aliases、identity、gender、locationId、onScene、healthText、relationshipText、addressing、phoneContact、usualLocations、lastInteractionAt。affinityChange 同时更新好感、关系与确认标记。age、appearance、temperament、background、skills 可随建档提供，现无逐项日常更新 | World 可建场外 NPC；对获准人物仅可更新允许的场外字段，无权借冲突处理改身份称呼、关系好感、互动或重新入场。场景转换另有正式维护 | 可改公开资料、上述建档描述与当前处境。id、identityKey、affinity、affinityConfirmed、lastInteractionAt 只读 |
| `npc` 专属档案、`dormantNpcProfiles`、`npcManagementRevision` | PromoteNpc 通过 specialProfile 升级、补齐或恢复；UpdateNpc 可写详细背景、目标、习惯、人际网络及已有权限内的 privateProfile。offscreenTaskIds 可在创建／提升档案时提供，没有任意改写列表的普通命令 | 玩家重要性意图 importancePreference、休眠、恢复、profilePending 及管理版本由专用流程维护。World 受人物权限限制 | 活动专属档案可修订 detailedBackground、activeGoals、habits、relationshipNetwork；私密字段、任务 ID 列表、身份种类、休眠表及版本只读 |
| `npc[*].memories / knownInformation / longTermMemories` | push 原始记忆或知晓信息 → RecordNpcMemory；后一条同时建立原始记忆。旧 longTerm 输入兼容写入统一原文表 | World 可在授权人物与时间窗内记录记忆；人物归属、回合、时刻、确认信息受领域校验。旧 longTermMemories 数组不再积累新数据 | 只读 |
| `initialCompanionId`、`contactNpcIds` | 前者无命令；联系人通过 RegisterContact 登记已有 NPC | 初始同伴为稳定引用；World 无联系人写权限 | 仅联系人列表可改 |
| `locations` | set locations[id] → CreateLocation，建立 name、parentId；同 ID 不能当作覆盖 | World 也能创建；树无环、父地点有效 | 可改已有地点名称与父节点 |
| `items` | AcquireItem、PurchaseItem、UpdateItem、TransferItem、LoseItem。数量、状态、地点、描述、估值、分类、任务标记及明细有相应操作；归属按移交处理，购买联动扣款 | World 不能更改主角物品；id、来源回合没有普通覆盖命令；失去或耗尽会维护装备 | 已有物品可改 name、description、conditionText、itemDetails、questItem、locationId；数量、估值、归属等只读 |
| `economy.cash / onlineBalance` | 开局补未定值；普通回合消费、内部转账、收入、借还、购买走专用交易命令 | 余额与交易一起提交；World 的组织金额不能当作主角资金 | 只读 |
| `economy.incomes / debts` | 开局 expectedIncomes，日常 ReceiveIncome 新建已到账记录；Borrow 新建借款，RepayDebt 减少未偿本金并可结清。没有任意修改旧账的命令 | 到账、扣款与状态联动；旧账 ID 和原始记录保留 | 只读 |
| `economy.vehicles / properties / otherAssets` | PurchaseVehicle／PurchaseProperty／PurchaseOtherAsset 扣款并登记车辆、房产、其他资产；AcquireAsset 登记原本持有或无偿得到的资产（不改余额）；没有出售或任意重估入口 | 资产估值、产权、位置、抵押／归属引用不是可直接调整的余额；World 不管理个人资产 | 只读 |
| `organizations` | CreateOrganization、UpdateOrganization、RecordOrgRelation。共有 name、description、keyNpcIds、currentTaskIds、leadership、relations，四类组织各有自己的产业、职能、地域及运营字段；资金、资产或流动性估计要求财务依据；关系操作联动 relationHistory | World 可在其权限内建档和更新。Variables 的同轮同字段优先，保留 World 的独立合法更新。id、kind 与旧关系历史不允许任意改写 | 仅已有组织的 name、description 及适用的 internalStatus、missionText、operatingStatus |
| `tasks` | SaveTask 处理现场任务，字段包括承办人、目标、起止安排、状态、地点、关联事件、前置／阻碍、结果和交接；既有目标、起点与终态受限 | 场外任务归 World，稳定引用和事件反向关联由领域维护 | 只读 |
| `events` | 仅已有现场事件的 sceneState → SaveEvent，有限更新 status、resolvedAt、resolutionText、outcome、resultKnowledge。不能借此建新事件或改写整个计划 | World 负责新建、后台进展、时限、父子／承接及终结。protagonistEntry 和 protagonistKnowledge 受回执、已知快照与领域权限约束 | 只读 |
| `retiredEvents`、`timeline` | 无直接写入 | World 的 DeleteEvent 触发终态归档，程序保留身份、引用及必要细节；RecordHistory 追加历史，程序绑定 recordedAt 和 sourceTurnId。无任意覆盖旧条目的入口 | 只读 |
| `memories` | 无覆盖公共短／中／长期记忆或 npcSummaries 的文本命令 | Commit 将合法 Story 摘要写入 short，记忆维护处理 medium、long、npcSummaries 及来源。immediateWindowSize 为已有存档字段，请求组装读取玩家设置的即时窗口 | 只读 |
| `schemaVersion`、`saveId`、`openingCityId` | 无模型赋值路径 | 格式版本、存档身份与开局地点由系统维护 | 只读 |
| `title`、`createdAt`、`updatedAt`、`revision`、`turnNumber` | 无直接命令 | 标题为玩家元数据；时间戳、版本与回合序号由仓库和结算维护 | 仅标题可改 |
| `journal`、`appliedCommands` | 领域命令与合法 Story 间接产生记录，无法用文本指令任意改写 | 结算写入历史正文、场景、摘要与处置结果；命令账本绑定回合、命令 ID 和幂等指纹 | 只读 |

核对表以状态 Schema、实际编译分支、执行器、World 原始分组检查和管理器**保存时**的白名单为准。九个管理分区能展示的路径多于允许保存的路径。 [存档字段](../src/domain/state.ts) · [复合交易](../src/executors/variableText/transactions.ts) · [实体创建与关系写入](../src/executors/variableText/entities.ts) · [数组与前值语义](../src/executors/variableText/sourceSemantics.ts) · [变量领域命令](../src/domain/variableCommands.ts) · [组织分型字段表](../src/domain/organizations/schema.ts) · [World 分组与校验](../src/services/validation/worldOutput.ts) · [现场权限校验](../src/services/validation/variableWork.ts) · [玩家编辑白名单](../src/domain/playerVariables.ts)

## 已有覆盖边界与后续建议

- **明确缺失且本次已补齐**：普通回合有剧情变化时，天气和环境此前只能沿用开局值或由玩家手动改。新增的两条路径独立生效。
- **经济领域已有明确记录的缺口**：购房和登记既有资产没有对应事务。已有 expected 收入也不能用同 ID 的 ReceiveIncome 转为到账，后者要求新 ID。若要表达这些业务，建议先界定预期与实收的关联、余额影响和幂等条件，再添加专用事务。当前模型可把无法执行的事项写进说明。[经济提示词](../prompts/variableGroups/economy/update.md) · [收入与资产结构](../src/domain/economy/schema.ts) · [交易执行](../src/domain/commands.ts)
- **需要产品确认的字段**：既有人物的外貌、基础技能及已有地点名等可以由玩家修订，目前没有普通 Variables 更新命令。若产品需要持续追踪这类变化，应逐项确认归属。特殊人物的场外任务仍可通过 task.actorRef 查询，不能仅因 offscreenTaskIds 缺少独立写入口就判定任务丢失。[人物结构](../src/domain/npc/schema.ts) · [人物面板任务读取](../src/ui/panels/NpcPanel.tsx)
- **保留只读**：正式回合、历史、总结来源、稳定身份、幂等账本、管理版本与回执都有各自的维护流程。覆盖盘点没有发现把它们开放为通用 set 的依据。V10 旧档继续使用原有字段；此前已经不支持的旧主版本仍按仓库既有策略处理。[存档兼容测试](../src/tests/saveRepository.test.ts) · [回合结算](../src/domain/turnCommit.ts)
