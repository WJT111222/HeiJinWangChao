# 输出协议、命令类型与校验要求

## 阶段① 正文输出
结构顺序必须为 `<正文>...</正文><短期记忆>...</短期记忆><变量规划>[{...}]</变量规划>`，若开启行动选项再加 `<行动选项>3～5行</行动选项>`。最终解析成 `StoryResult{turnKind,narrative,summary,variableGuide,actionOptions?}`。其中变量规划条目的 `group` 属于 `protagonist|npc|items|economy|organization|time|event`；字段为`group,subjectHint,observedFact,textEvidence`。
叙事流式显示时，只能实时展示解析明确落入正文标签的文本；`【旁白】`代表普通叙述，`【角色名】`只代表角色直接对白（详见`shared/09_dialogue_labels.md`）；任何变量变更可见信息都属于候选，不能在流式时写库。仅`narrative`参加硬最低字数校验，`minNarrativeChars`由玩家任意合法正整数设置，具体字符口径须统一。

## 阶段② 变量输出
返回JSON对象`{commands: DomainCommand[],rejectedSuggestions:{reason,reference}[],unresolved:string[]}`。
`DomainCommand`包含`commandId,group,type,entityId?,payload,evidence`；命令类型是程序内白名单，正文证据必须可回溯。推荐命令类型见`shared/07_command_output.md`。字段对象与最终数据库结构由代码Schema校验；模型输出不是可信SQL和对象路径。

## 阶段③ 世界输出
返回JSON对象`{worldCommands:DomainCommand[],taskCommands:DomainCommand[],eventCommands:DomainCommand[],futureEvents:WorldEvent[],visibleHooks:{text,revealAfter?}[],timelineCandidates:string[],unresolved:string[]}`。`futureEvents`需要稳定ID、开始时间、status、actorRefs、visibility、impact、sourceTurnIds；其它字段以技术文档定义为准。
**与先前技术文档接口的调整说明：** 因开局世界阶段需要真正初始化场外组织，建议将原`WorldStageResult`扩展一个`worldCommands`字段，仅允许操作场外NPC与组织，代码层须严格校验权限。否则由变量阶段预先建组织将违反“只更新在场NPC”的设计分工。

## 三层不同时间与可见性
程序记录的是**世界真值**（所有已合法提交的真实事件）。主角只知道经感知、告知或媒体合理传播的部分；玩家视图只展示主角已知的合法部分。后台JSON中`hidden`字段允许存在，但UI日志、记忆查看和时间轴不能直接复制后台完整JSON。

## 参数占位符（由程序替换，不能让模型自行改）
`{{worldClock}}`、`{{playerName}}`、`{{minNarrativeChars}}`、`{{immediateMemoryTurns}}`、`{{npcSummaryThreshold}}`、`{{npcId}}`。所有占位符必须在最终发出的消息中消失；若缺值应作为组包错误停止，而不是让AI看到原始花括号。

## 校验最低要求
标签平衡与唯一、变量规划JSON解析、命令枚举和对象校验、时间不倒退、同一事实幂等、余额来源、物品归属/数量、NPC在场区分、不同组织Schema、秘密隔离、重大结案时间轴去重。来源证据无法确认时列unresolved或拒绝；不允许生成半段后“尽量提交”。

## 兼容性声明
本协议是面向V0.1的建议可实现格式，与已有技术文档中的数据结构对齐。若Codex实现更可靠的原生JSON schema/工具调用，可以替换传输层，但不能改变已确认的四项正文输出、变量指导性质、六主提示词、世界职责和事务边界。


## M3-P1 补充（不改变以上输出结构）

新增输入占位符 `{{worldWeekday}}`，P2 按 `worldClock` 在 Asia/Shanghai 的日期派生，不能成为 AI 可写状态或独立时钟。当前只注册资源，不替换占位符或发送请求。原版 COT 的额外 thinking/剧情规划仅作非注入参考；兼容模板不得增加任何顶层输出段。

变量协议中的推荐命令仍不是 M1 实际 COMMAND_CATALOG。P2 必须提供真实目录，缺少目录/类型不匹配时阻止请求或明确失败；本轮未修改 M1 的正式命令、Schema 与原子提交。NPC 记忆补丁中暂不支持的变更只能 unresolved，不能靠自由路径写入。

玩家可见视图与主角认知分别建模；本轮不改 M2 展示，也不借本补充确定最终 NPC 全档案开放模式。


## M3-P2 待办：实际命令 Schema 与提示词协议对齐

**状态：待实现，不是已有适配器。** 本节依据 `src/domain/commands.ts` 的 DomainCommandSchema、`src/domain/drafts.ts` 的 VariableResultSchema/WorldResultSchema、`src/domain/events/schema.ts` 及 common.ts 核对。P1 保留既有输出段落和正式 Schema，不能宣称模型响应已能直接落库。

### 1. 命令对象结构与名称

- [ ] 消除通用包装与真实对象的差异：提示词的 `{commandId,group,type,entityId?,payload,evidence}` 不能直接通过现有严格 Schema。真实命令共同字段只有 `commandId/type/evidence`，其他数据位于各类型规定的同级字段；`group/entityId/payload` 是多余字段，会被拒绝。P2 必须确定并测试规范化契约；不得任意丢字段或将任意 payload 合并进存档。
- [ ] 从真实 Schema 生成/核验 COMMAND_CATALOG。下表是**当前实现清单**，不是旧名称的可直接替换表：

| 实际 type | 除 commandId/type/evidence 外的字段 |
| --- | --- |
| PurchaseItem | account、price、item |
| PurchaseVehicle | account、price、vehicle |
| TransferFunds | from、to、amount |
| ReceiveIncome | income |
| Borrow | account、debt |
| RepayDebt | account、debtId、amount |
| CreateNpc | npc |
| SetEquipment | equipment |
| TransferItem | itemId、from、to |
| SetWorldClock | worldClock |
| SaveEvent | event |
| SaveTask | task |
| CreateOrganization | organization |
| RecordOrgRelation | organizationId、relation、reason |

- [ ] 禁止把提示词旧名称当作已支持：NpcCreated/NpcPatched/NpcMemoryAppended、WorldClockSet、EquipmentSet、BalanceChanged、OrgCreated/OrgPatched、EventPatched/TaskPatched 等均不能直接通过当前 Schema。CreateNpc 不是 NPC 更新；CreateOrganization 不是组织补丁，不能盲目改名来模拟更新。当前没有通用主角补丁、位置/天气更新、NPC 关系/记忆更新、物品数量/状态补丁或房产/其他资产 upsert 命令；需先明确不支持时的 unresolved/拒绝路径，未来扩充命令须单独实现和验证。
- [ ] 以 PurchaseItem/PurchaseVehicle 等领域操作表达交易，不把旧 BalanceChanged 与 ItemCreated 任意拼成等价购买。金额使用**整数人民币分**；price/amount 等要求正值，账户只允许 cash/onlineBalance。提示词当前的 account/oldValue/newValue/reason 通用余额提案不是实际可执行命令。未知余额仍为 null，不猜零；借贷、还款、收入与内部转账须保留各自业务语义。

### 2. 结果、事件、任务与阶段权限

- [ ] 变量顶层 commands/rejectedSuggestions/unresolved 和世界顶层七个数组已基本对齐；仍须逐项校验内部对象。rejectedSuggestions.reference、visibleHooks.revealAfter 在实际 Schema 中可选；unresolved 为非空文本数组，timelineCandidates 为有效事件 ID 数组，不是任意标题或说明。
- [ ] futureEvents 必须符合完整 WorldEventSchema。提示词目前只列最小字段，并把 prerequisites/blockers 当可选；实际 linkedTaskIds、prerequisites、blockers 都是必填数组。resolvedAt、completionCondition 等字段也必须按实际状态正确提供，不能靠提示词“最少字段”绕过。正式状态还检查预计结束/完成条件、结案时间、引用与终态事件等约束。
- [ ] SaveTask 使用完整 task，状态为 planned/active/completed/blocked/cancelled；SaveEvent 使用完整 event，状态为 scheduled/active/resolved/blocked/cancelled。不能混用任务和事件的状态词，也不能把 Patch 误当作完整对象保存。
- [ ] WorldResultSchema 的 worldCommands/taskCommands/eventCommands 在结构上均接受 DomainCommandSchema；仅解析成功不代表符合各数组的阶段职责。P2 须定义并测试每类候选的允许命令及对象范围，禁止世界候选越权修改主角、重复结算现场行动或将后台秘密直接公开；正式工作流与提交仍留待后续阶段。

### 3. P2 必须提供的验证

- [ ] 缺少真实目录时阻止发送或明确失败，不能回退使用旧推荐集合；未知 type、多余字段、错误单位/账户、缺少事件数组等均明确报错。
- [ ] 覆盖真实命令正例、旧包装/旧名称反例、未支持更新列 unresolved、交易整体语义及阶段越权；不以“重命名成功”冒充语义等价。
- [ ] 解析/规范化后仍须经过 Schema、业务语义、引用、版本、证据与幂等校验。候选不直接写库，保持 M1 的补算版本依赖及最终原子提交边界。本轮只用确定性 Schema 测试记录差异，不实现解析器、目录生成器或 API 请求。
