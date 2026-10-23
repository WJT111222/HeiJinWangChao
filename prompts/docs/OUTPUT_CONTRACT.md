# 输出协议、命令类型与校验要求

## 阶段① 正文输出
结构顺序必须为 `<正文>...</正文><短期记忆>...</短期记忆><变量规划>[{...}]</变量规划>`，若开启行动选项再加 `<行动选项>3～5行</行动选项>`。最终解析成 `StoryResult{turnKind,narrative,summary,variableGuide,actionOptions?}`。其中变量规划条目的 `group` 属于 `protagonist|npc|items|economy|organization|time|event`；字段为`group,subjectHint,observedFact,textEvidence`。
叙事流式显示时，只能实时展示解析明确落入正文标签的文本；`【旁白】`代表普通叙述，`【角色名】`只代表角色直接对白（详见`shared/09_dialogue_labels.md`）；任何变量变更可见信息都属于候选，不能在流式时写库。仅`narrative`参加硬最低字数校验，`minNarrativeChars`由玩家任意合法正整数设置，具体字符口径须统一。

## 阶段② 变量输出
返回JSON对象`{commands: DomainCommand[],rejectedSuggestions:{reason,reference}[],unresolved:string[]}`。
`DomainCommand` 是严格的 `type` 判别联合，包含 `commandId/type/evidence` 及类型专属的同级字段，不接受旧 group/entityId/payload 包装。真实 COMMAND_CATALOG 由程序从 DomainCommandSchema 生成，JSON 解析后须通过结构与副本业务验证；候选不直接写库。

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

**M3-P2 状态：真实目录、严格解析和副本候选校验已实现。** 下面保留 P1 差异清单供追溯；采用直接对齐真实类型并拒绝旧包装的策略，没有旧别名或任意 payload 展开适配器。正式回合编排和写库仍属 M4。 本节依据 `src/domain/commands.ts` 的 DomainCommandSchema、`src/domain/drafts.ts` 的 VariableResultSchema/WorldResultSchema、`src/domain/events/schema.ts` 及 common.ts 核对。P1 保留既有输出段落和正式 Schema，不能宣称模型响应已能直接落库。

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
- [ ] 解析/规范化后仍须经过 Schema、业务语义、引用、版本、证据与幂等校验。候选不直接写库，保持 M1 的补算版本依赖及最终原子提交边界。M3-P2 用真实命令目录、解析器及 Mock API 请求验证差异；候选不直接写库，后续仍需 M4 正式事务编排。


## M3-P2 当前接入边界

上节“ M3-P2 待办”是 P1 的历史差异清单。当前已实现其中的命令目录、严格解析、结构/引用/整批业务验证与阶段权限限制；不支持操作明确拒绝或要求列 unresolved。清单保留用于溯源，不代表新增通用更新命令。M4 正式提交编排和更强的事实语义判断仍待后续实现。

目录直接从现有 Zod 命令 Schema 生成，变量接受十四类真实命令；世界三类数组按实际类型白名单和场外对象进一步限制。未支持类型与旧包装明确失败；不存在的更新应由模型列 unresolved，不做猜测映射。

正文解析严格检查标签顺序、JSON 变量规划、行动选项开关/3～5 条，以及正文移除空白后的 Unicode code point 最低数量（标点和对白标签计数，摘要及其它块不计数）。未知附加顶层标签/内部思考不接受。

金额必须为整数分；证据只有一处明确“元/分”金额时，校验其与命令数值一致。多金额、折扣、税费或缺少数字的证据不能仅靠字符串推断单位/交易真实性，仍需后续更强的事实校验与人工审查，不能声称已自动识别所有语义错误。

候选通过 M1 commitCommands 在脱离仓库的副本上模拟，检查归属、余额、引用、时间和整批回滚，不写 SaveRepository；世界变量 pending 时只读旧快照，不冒充正式结算。正文上下文保守选择现场与公开资料，不把 NPC 后台知识作为玩家可见内容；最终玩家视角仍非本阶段的新玩法设置。

## M4-P2 当前命令能力与候选运行

原十四类保留，新增八类：UpdateProtagonist（白名单人物状态）、UpdateNpc（稳定 ID 的现场变化及有依据关系）、RecordNpcMemory（当回合来源/可见性/知识性质）、CreateLocation（合法层级）、SpendFunds（普通消费）、AcquireItem（无偿获得）、UpdateItem（数量/状态/位置）、LoseItem（遗失解除持有）。每种字段严格来自 COMMAND_CATALOG，不接受任意路径或深合并。
初始同伴新增向后兼容的可选 affinityConfirmed=true 标记；缺失仍表示创角占位，不迁移猜测数值。只有明确的 UpdateNpc.affinityChange 可在候选副本中确认，正式落库仍待 M4-P5。RecordNpcMemory 的转述/推测保留文字标记，不提升成客观事实。
变量阶段每次手动执行先保存 startStageAttempt，保持正文版本与输入；按已选正文、正式 revision、执行/请求版本验证，再保存 validated 变量候选。此处 validated 仅表示程序校验通过的草稿，不是正式世界结算。不执行世界阶段或自动重试，不调用正式 SaveRepository.save。


## M4-P3 世界候选运行契约

本阶段复用原有八种受限命令，不增加领域命令或正式存档字段。世界命令 evidence 在原字符串字段中编码 WORLD_EVIDENCE_V1 JSON，详见 shared/08_world_output.md 和运行时 COMMAND_CATALOG；变量命令 evidence 仍引用正文原文，二者不能混用。新场外 derived 候选根据可信来源、时间窗口及动机形成，不要求逐字出现在正文。futureEvents 只镜像已验证的 scheduled SaveEvent，不是独立命令入口。visibleHooks、revealAfter、timelineCandidates 不自动披露。无合法变量时世界只能 preview；已有合法变量即使本次变量开关关闭也可复用。所有结果只保存 TurnDraft；正式状态、时间和历史不受影响。


## M4-P3 二轮审查：实体、估计与任务状态

- CreateLocation 仅接受 established 或合法 derived 存在事实，不能将 planned 建设直接建成实体；计划或不确定项进入任务/未来事件/unresolved。
- estimatedEndAt/dueAt 允许 AI 自主估计、调整，但到期只重新评估。scheduled/active/blocked 事件不得有 resolvedAt/resolutionText；真实 resolved 要有合法实际时间和非空结局，允许晚于预计。cancelled 保留兼容的可选说明/时间组合，不能预存未来实际终止时间。futureEvents 无旁路。
- NPC 的 planned/active/blocked 任务占用唯一名额，completed/cancelled 释放；正式、变量投影和候选合查，本批终结不能立即接新任务。组织可多任务，实际执行者未被 actorRef 表达的情况不假装能硬校验。
- 既有完成必须明确关联自身 task:<id>/event:<id>，可结合动机生成新结果，不要求正文预先证明。失败终止使用 cancelled 并在原 evidence 来源凭据中保存真实结果，blocked 不算成功。
- 正式状态不变，旧冲突不静默清理；冲突候选安全失败，旧任务冲突在内部 unresolved 报告。后续生命周期与阶段分工见 DEVELOPMENT.md，仅作规划，不注入删除/休眠功能。

## M4-P3 A5 取消证据定点修复

取消与完成都需目标自身来源：SaveTask.cancelled 引用 task:<id>，SaveEvent.cancelled 引用 event:<id>。取消还需 fact 中肯定成立的终止谓语；无关普通场外动作或人物动机不能替代。derived 必须有区别于取消宣告的具体 outcome 原因/后果，空缺或仅“任务取消了”不能自证。明确失败后终止允许；否定终止和准备重试不允许借取消释放名额。继续保留未来安排提前取消、完成条件无需满足、事件实际结案字段可缺失的语义。详见 shared/08_world_output.md，正式 Schema/状态字段不变。

## M5-P4 时间预检的变量规划约定

不新增标签或阶段，也不改变 StorySchema。普通正文输入 TIME_PREFLIGHT 存在 targetAt 或 endWindow 时，在原变量规划数组内输出唯一 `group: "time"` 的时间事实：

```json
{"group":"time","subjectHint":"time:interrupt:已提供的候选ID","observedFact":"2027-01-01T03:00:00+08:00","textEvidence":"凌晨03:00，实际敲门声将你唤醒。"}
```

`time:end` 表示实际完成到明确目标或估计窗口内；`time:pause` 表示有正文事实的其他提前停止，不假冒已有事件；`time:interrupt:<id>` 只能指本次合法候选，并停在该节点时间。时间事实的 observedFact 使用 ISO 时间，textEvidence 必须完整引用正文既成事实。候选是条件分析，模型仍要判断是否真实可感知、能否打断；没有中断时不得强行制造。时间与实际行为、日期和星期须一致，不可先写完原目标再倒叙补中断。正文流只显示正文，结构化时间事实不混入普通日志。

程序重新计算预检、校验范围/候选/证据，并在变量解析及正式事务提交处复核所有 SetWorldClock。预检及正文都不直接改存档。未知时长不编造精确窗口；普通旧正文没有该约定仍可读取，不被静默补造为已预检。开局主提示词及现有四段标签协议保持不变。

## M5-P4 正向耗时与纯历史视角（最新产品规则）

每个正式剧情回合（开局和普通）必须从正式基线正向推进时间。SetWorldClock.evidence 引用实际动作或对话，不要求带时间词；耗时由变量AI根据规模和状态推算，不能使用固定步长。正文只需自然叙事；普通短行动不必新增时间规划记录。明确的长行动仍使用原 time:end/time:pause/time:interrupt 约定，实际中断点不能被变量越过。程序不对小说建立时间关键词白名单。候选未包含正向时钟时可以检查/补算，但正式提交必须拒绝，不默认补一分钟。

唯一零耗时例外是玩家明确要求切换到其他已有NPC视角，且仅回顾此前已发生的事情。同一次正文请求在变量规划声明：

```json
{"group":"time","subjectHint":"time:retrospective","observedFact":"{\"npcId\":\"npc-a\",\"perspectiveRequest\":\"切换到陈宁的视角\",\"pastRequest\":\"描写他昨天晚上独自经历的事情\",\"temporalScope\":\"past_only\",\"currentPlotAdvances\":false}","textEvidence":"昨天晚上，陈宁独自回顾了此前已知的约定。"}
```

两段Request必须分别是玩家原输入的不同子串，人物必须存在且不是主角，人物身份需在视角请求中明确。不能拿AI自己写的回忆当玩家要求。语义分类由本次正文模型完成；程序严格验证声明、人物和原请求/正文来源，不声称能证明所有自然语言语义。现在的他人视角、NPC当前讲述往事、AI自行闪回或混合当前剧情不得声明past_only。没有有效声明仍按正常正向耗时提交。

纯回顾不推进或倒退当前时钟，不接受当前状态变量变更、世界命令、futureEvents、visibleHooks或时间线候选；可保留内部unresolved说明，正文/摘要按原原子事务归档，不将回忆事件再结算为现在事实。不开新设置、阶段或Schema字段，原七项设置、六套主提示词及输出标签不变。旧档和回执仍可读取/重放；尚未提交的旧零耗时候选需补算变量，不能绕过新正式提交规则。
