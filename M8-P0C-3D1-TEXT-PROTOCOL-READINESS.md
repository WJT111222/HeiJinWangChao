# M8-P0C-3D-1：文本变量正式协议准备

## 基线和范围

基线：`93f6b2febebf09568f5008f16d2406c5cd3345b9`（PR #40）。分支：`codex/m8-p0c3d1-text-protocol-readiness`。

本轮只补文本表达能力与提示词准备。正式 runStageRequest、VariableStage、WorldStage、TurnCoordinator、提交事务和存档Schema均不切换。没有新增来源审批、覆盖许可、审查封印、剧情正则或模型调用。

## 覆盖审计

原DomainCommand共有24类，正式JSON变量目录含23类（RetireNpc仅World）。原文本已支持17类。此次补齐CreateNpc、RegisterContact、CreateOrganization、RecordOrgRelation及UpdateNpc/RecordNpcMemory原有子能力后，文本覆盖21类；SaveTask、SaveEvent、RetireNpc留给World/3D-2，不在现场Variables中伪造后台结果。

| 旧JSON领域操作 | 文本路径/操作 | 说明 |
| --- | --- | --- |
| UpdateProtagonist | set protagonist.healthText/emotionText/locationId/profession/publicStatus/legalStatus/skills | 原有白名单，技能为字符串数组 |
| SetWorldClock | set worldClock | 普通回合合法ISO时间、不倒退；开局由Story程序时钟统一注入一次 |
| CreateLocation | set locations[id] | 原有name/parentId对象，ID来自路径 |
| CreateNpc | set npc[id] | **新增**，原NpcSchema完整对象去掉id，ordinary/special，开局和普通回合均可 |
| UpdateNpc | set npc[id].healthText/relationshipText/locationId/onScene/lastInteractionAt | 原有现场字段 |
| UpdateNpc.affinityChange | set npc[id].affinityChange | **新增** {from,to,reason,relationshipText}；同一命令包含关系说明，保留[-100,100]/真实前值；同伴未确认from=null |
| UpdateNpc.activeGoals | set npc[id].activeGoals | **新增** 字符串数组，仅special |
| RegisterContact | set npc[id].contact | **新增** {reason}；永久联系人保护不撤销 |
| RecordNpcMemory | push npc[id].memories | 原有个人记忆 |
| RecordNpcMemory.longTerm | push npc[id].longTermMemories | **新增** 仅special的长期原始记忆，不是压缩 |
| RecordNpcMemory.addToKnownInformation | push npc[id].knownInformation | **新增** 同时保存原个人记忆及知晓条目，保持认知性质 |
| CreateOrganization | set organizations[id] | **新增** 原四类组织Schema完整对象去掉id |
| RecordOrgRelation | set organizations[id].protagonistRelation | **新增** {relation,reason}开放关系文字，记录原relationHistory |
| SpendFunds | add economy.cash/onlineBalance = 负整数分 | 原有消费 |
| ReceiveIncome | set economy.incomes[id] | 完整原收入记录去掉id，received正金额 |
| TransferFunds | push economy.transfers | {from,to,amount} |
| Borrow | set economy.debts[id] | {account,debt:原债务去掉id} |
| RepayDebt | push economy.debts[id].repayments | {account,amount} |
| AcquireItem | set items[id] | 原ImportantItem去掉id |
| PurchaseItem | set items[id].purchase | {account,price,item:原物品去掉id} |
| UpdateItem | add items[id].quantity / set items[id].conditionText/locationId | 数量前值由程序生成 |
| TransferItem | set items[id].transfer | {from,to} |
| LoseItem | set items[id].loss | {expectedOwner,conditionText,locationId?} |
| SetEquipment | set protagonist.currentWear | 完整原Equipment |
| PurchaseVehicle | set economy.vehicles[id].purchase | {account,price,vehicle:原车辆去掉id} |
| SaveTask / SaveEvent | 暂无现场文本路径 | World任务/事件生命周期不在本轮接线 |
| RetireNpc | 无Variables路径 | 原JSON也仅允许World |

新增8种路径，原30种保留，共38种。所有创建稳定ID由路径注入，值中不重复提供id；不支持数字NPC索引、任意补丁、整表覆盖或未知字段。

## 原生命令缺口（不伪造初始化）

- 未知现金/线上余额仍是null。原命令没有SetBalance/InitializeEconomy，不能直接赋值，也不能用无记录正add冒充收入；ReceiveIncome/Borrow要求余额已知。这是正式切换前必须决策的实际开局缺口，旧JSON同样不能安全完成该操作。
- 原领域层没有现有房产/车辆/其他资产的无交易登记、房产购买或任意债务初值登记命令；不能用PurchaseVehicle或Borrow冒充历史已持有资产/旧债。已有合法初始数据保留。
- CreateNpc能写完整普通/特殊NPC档案；已有NPC的姓名、年龄、身份、外貌、性格、技能、习惯、detailedBackground、offscreenTaskIds等没有对应UpdateNpc字段，本轮不提供自由覆盖器。目标、关系、健康、地点、最近互动与原始长期记忆可以更新。
- 组织创建保留四类原结构；已有组织的经营、资金、任务等无通用更新能力，仅关系可变。

## 执行语义

仅对已解析稳定ID和有限字段进行映射；新NPC加入本批可引用集合，使后续现场更新、记忆、联系人、装备归属及组织keyNpcIds可使用新ID。最终整批仍由原commitCommands执行并校验；引用先后、身份重复、好感前值、类型、归属和场景一致性由原领域语义处理。编译不写库。没有按NPC在场状态增加审批。

记忆继续由程序生成确定性memoryId、sourceTurnIds、affectedEntityRefs和游戏时间；AI选择observed/reported/suspected及visibility/knowledgeSource，转述与推测保留原标记。knownInformation路径复用RecordNpcMemory的addToKnownInformation，不给其他NPC自动复制记忆。

## 失败复现和验证（阶段性记录）

先运行7项新验收（普通回合新NPC+同批更新、特殊目标/长期/知晓、好感/联系人、四类组织创建关系），原实现7/7均因unsupported_path失败。随后才新增有限映射。

最终检查、提示词准备、完整实例与3D-2接线清单将在实现完成后补录，当前不声称尚未执行的检查已通过。
