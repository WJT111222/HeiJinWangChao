# 输出协议、命令类型与校验要求

## 阶段① 正文输出
结构顺序必须为 `<thinking>...</thinking><正文>...</正文><短期记忆>...</短期记忆><变量规划>[{...}]</变量规划>`，若开启行动选项再加 `<行动选项>3～5行</行动选项>`。最终解析成 `StoryResult{turnKind,narrative,summary,variableGuide,actionOptions?}`。项目规划不加入StoryResult或正式存档，原生公开返回内容也单独处理。其中变量规划条目的 `group` 属于 `protagonist|npc|items|economy|organization|time|event`；字段为`group,subjectHint,observedFact,textEvidence`。
叙事流式显示时，只能实时展示解析明确落入正文标签的文本；`【旁白】`代表普通叙述，`【角色名】`只代表角色直接对白（详见`shared/09_dialogue_labels.md`）；任何变量变更可见信息都属于候选，不能在流式时写库。仅`narrative`参加硬最低字数校验，`minNarrativeChars`由玩家任意合法正整数设置，具体字符口径须统一。

## 阶段② 变量输出
正式新请求使用 `VARIABLE_TEXT_V1`：只执行唯一 `<命令>` 区块内的 `set/add/push 路径 = JSON值`；真实有限路径和类型由 `TEXT_COMMAND_CATALOG` 给出。`<thinking>`/`<说明>` 不执行，不要求整份模型回复为 JSON。

程序解析、编译并整批模拟后，仍保存规范化对象 `{commands: DomainCommand[],rejectedSuggestions:{reason,reference}[],unresolved:string[]}`。已有 JSON 领域候选保持可读可复核；新模型请求不猜测协议、不回退 JSON、不追加修复请求。说明原文不复制到候选，仅记录固定非执行提示。
`DomainCommand` 是严格的 `type` 判别联合，包含 `commandId/type/evidence` 及类型专属的同级字段，不接受旧 group/entityId/payload 包装。旧候选的 JSON 领域命令仍通过结构与副本业务验证；新请求通过 TEXT_COMMAND_CATALOG 的文本映射由程序生成 commandId/evidence/expectedRevision。模型不得自行输出这些程序元数据；候选不直接写入正式状态。

## 阶段③ 世界输出
返回JSON对象`{worldCommands:DomainCommand[],taskCommands:DomainCommand[],eventCommands:DomainCommand[],futureEvents:WorldEvent[],visibleHooks:{text,revealAfter?}[],timelineCandidates:string[],unresolved:string[]}`。`futureEvents`是本批已验证SaveEvent的未来计划镜像，不能单独写库。新事件必需id/title/startAt/estimatedEndAt/backgroundText/goalText/非空actorRefs，以及linkedTaskIds/prerequisites/blockers/visibility/impact/sourceTurnIds。完成条件不能代替预计时间；Task继续使用dueAt或completionCondition。事件终态可outcome=success/failure/changed/cancelled，到期不是成功。
**与先前技术文档接口的调整说明：** 因开局世界阶段需要真正初始化场外组织，建议将原`WorldStageResult`扩展一个`worldCommands`字段，仅允许操作场外NPC与组织，代码层须严格校验权限。否则由变量阶段预先建组织将违反“只更新在场NPC”的设计分工。

## 三层不同时间与可见性
程序记录的是**世界真值**（所有已合法提交的真实事件）。主角只知道经感知、告知或媒体合理传播的部分；玩家视图只展示主角已知的合法部分。后台JSON中`hidden`字段允许存在，但UI日志、记忆查看和时间轴不能直接复制后台完整JSON。

## 参数占位符（由程序替换，不能让模型自行改）
`{{worldClock}}`、`{{playerName}}`、`{{minNarrativeChars}}`、`{{immediateMemoryTurns}}`、`{{npcSummaryThreshold}}`、`{{npcId}}`。所有占位符必须在最终发出的消息中消失；若缺值应作为组包错误停止，而不是让AI看到原始花括号。

## 校验最低要求
标签平衡与唯一、变量规划JSON解析、命令枚举和对象校验、时间不倒退、同一事实幂等、余额来源、物品归属/数量、NPC在场区分、不同组织Schema、秘密隔离、重大结案时间轴去重。来源证据无法确认时列unresolved或拒绝；不允许生成半段后“尽量提交”。

## 兼容性声明
本协议是面向V0.1的建议可实现格式，与已有技术文档中的数据结构对齐。若Codex实现更可靠的原生JSON schema/工具调用，可以替换传输层，但不能改变各正式正文结果字段、变量指导性质、六主提示词、世界职责和事务边界。


## M3-P1 补充（不改变以上输出结构）

新增输入占位符 `{{worldWeekday}}`，P2 按 `worldClock` 在 Asia/Shanghai 的日期派生，不能成为 AI 可写状态或独立时钟。当前只注册资源，不替换占位符或发送请求。原版修仙COT仅作非注入参考。M5-P6以用户审定的两套原创叙事规划替代，新增独立thinking顶层块；不引入旧剧情规划标签或额外世界命令。

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

本阶段复用原有八种受限命令，不增加领域命令或正式存档字段。世界命令 evidence 在原字符串字段中编码 WORLD_EVIDENCE_V1 JSON，详见 shared/08_world_output.md 和运行时 COMMAND_CATALOG；变量命令evidence为来源说明，可概括而无需逐字引用，二者不能混用。新场外 derived 候选根据可信来源、时间窗口及动机形成，不要求逐字出现在正文。futureEvents 只镜像已验证的 scheduled SaveEvent，不是独立命令入口。visibleHooks、revealAfter、timelineCandidates 不自动披露。无合法变量时世界只能 preview；已有合法变量即使本次变量开关关闭也可复用。所有结果只保存 TurnDraft；正式状态、时间和历史不受影响。


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

`time:end` 表示实际完成到明确目标或估计窗口内；`time:pause` 表示有正文事实的其他提前停止，不假冒已有事件；`time:interrupt:<id>` 只能指本次合法候选，并停在该节点时间。时间事实的 observedFact 使用 ISO 时间，textEvidence可概括实际行动，不要求逐字引用正文。候选是条件分析，模型仍要判断是否真实可感知、能否打断；没有中断时不得强行制造。时间与实际行为、日期和星期须一致，不可先写完原目标再倒叙补中断。正文流只显示正文，结构化时间事实不混入普通日志。

程序重算预检并校验明确结构化中断的候选和停止点；日期、单向性与事务在变量解析及正式提交复核，不扫描文学表述。预检及正文都不直接改存档。未知时长不编造精确窗口；普通旧正文没有该约定仍可读取，不被静默补造为已预检。开局主提示词及现有四段标签协议保持不变。

## M5-P4 正向耗时与纯历史视角（最新产品规则）

M8-P0A取代此前“所有回合必须正向耗时”的规则：普通回合由变量AI按实际行动估时，允许零耗时，无固定步长，不要求正文时间词或证据逐字匹配。正常时间线只校验合法日期与非倒退，明确中断不能越过结构化停止点。待定开局以Story同次请求产生的合法{startAt,endAt}为唯一时钟候选，程序以稳定commandId统一投影、世界窗口及原子结算，不要求变量再次SetWorldClock。玩家年代意图通过Prompt优先遵守；程序不再解释小说的年份/季节/星期。旧档无待定标记保持原时钟，不重新解释。


纯历史视角是只读当前世界的特殊语义（普通回合现在也允许零耗时）：玩家明确要求切换到其他已有NPC视角，且仅回顾此前已发生的事情。同一次正文请求在变量规划声明：

```json
{"group":"time","subjectHint":"time:retrospective","observedFact":"{\"npcId\":\"npc-a\",\"perspectiveRequest\":\"切换到陈宁的视角\",\"pastRequest\":\"描写他昨天晚上独自经历的事情\",\"temporalScope\":\"past_only\",\"currentPlotAdvances\":false}","textEvidence":"昨天晚上，陈宁独自回顾了此前已知的约定。"}
```

两段Request必须分别是玩家原输入的不同子串，人物必须存在且不是主角，人物身份需在视角请求中明确。不能拿AI自己写的回忆当玩家要求。语义分类由本次正文模型完成；程序严格验证声明、人物和玩家原请求来源，不再要求正文逐字引用，不声称能证明所有自然语言语义。现在的他人视角、NPC当前讲述往事、AI自行闪回或混合当前剧情不得声明past_only。没有有效声明仍按普通时间规则提交，可零耗时但不可倒退。

纯回顾不推进或倒退当前时钟，不接受当前状态变量变更、世界命令、futureEvents、visibleHooks或时间线候选；可保留内部unresolved说明，正文/摘要按原原子事务归档，不将回忆事件再结算为现在事实。不开新设置、阶段或Schema字段，原七项设置、六套主提示词及输出标签不变。旧档和回执仍可读取/重放；尚未提交的旧零耗时候选需补算变量，不能绕过新正式提交规则。

## M5-P5 成果、交接与生命周期增量（最新产品契约）

新增严格命令RegisterContact（变量阶段，npcId/reason）和RetireNpc（世界阶段，npcId/expectedIdentityKey/reason/retainMemoryIds）。没有任意字段补丁或新付费阶段。WorldTask新增可选resolution和handoff，WORLD_EVIDENCE_V1新增可选decision，具体字段以COMMAND_CATALOG导出的真实JSON Schema及shared/08为准；程序从决策重建确定性成果元数据。旧取消谓词检查仅为旧协议兼容，不作为新决策的唯一语义依据。

同批来源先验证、无环、再使用，不接受自证；允许按真实时间释放占用和按需承接，取代上文M4-P3同批禁止接力的旧限制。新任务不改变原执行者，只有实际传递的内容可以成为接收者知识，隐藏事件参与者不等于知情者。无后续必要时直接结束，不造接班任务。正文标签、六套主提示词、NPC私有认知权限和正式回合原子提交保持原有架构。Save schema为V4，包含contactNpcIds/retiredNpcs/contactReviewNpcIds；旧档联系人身份待确认与永久联系人分开保护，保留revision、journal和回执。已终结任务新增的可选成果与交接字段兼容旧对象，无来源的旧终态不补造实际成果或时间。

退场保留的必要材料使用现有memories.long；可选retiredNpcSource记录npcId/sourceMemoryId/knowledgeKind/knowledgeSource，只标记局部历史来源，不作为整回合压缩覆盖。未公开材料保持internal，不进入普通正文、玩家记忆、变量认知输入或其他人物WORLD_SOURCES。新生成的终态任务（含旧凭据兼容路径）均先补齐来源可验证的resolution并保存候选；正式提交保持完整候选指纹一致性，缺少该元数据的旧待提交候选明确补算，不在提交事务内静默改候选。


### PR #22 第二轮：修复首轮审查三项问题

正式save升级V4，新增contactReviewNpcIds以区分旧档临时保护与contactNpcIds。V1/V2及旧V3预览经过严格迁移；真实登记凭据及初始同伴保持联系人，其余需要复核者保留完整实体。RetireNpc可选contactReview只用于待确认身份的受限复核，不是解除正式联系人保护。

TaskHandoff.summaryBasis?={mode:"faithful_summary",resultExcerpt}允许有可靠原文锚点的忠实概括；保留实体、时间、传递渠道、权限和知识性质，取消fact与content逐字相等要求。task:成果事实不含handoff、目标或理由；task-plan:为计划资料；handoff:为接收者知识，reported不因任务结案变为事实。旧字段和逐字交接仍可读，候选指纹、CAS和正式事务不变。

### PR #22 第二轮审查：成果认知分层及未索引历史

decision.resultKnowledge?与resolution.resultKnowledge?使用同一严格结构{facts:string[],reported:string[],suspected:string[]}。完整result原样保留且只作为task-result:<id>的statement资料；task:<id>只暴露程序终态/时间及明确facts，不能从整段result中截取举报内容充当世界真值。缺少分类的旧成果不补造facts，已提交状态、原文及reported交接仍可使用。observed交接需原始锚点属于明确事实。全部分类在同次世界请求内完成，不增加AI裁判，元数据继续由程序从凭据和当前回合重建。

contactReviewNpcIds中的旧人物只要存在旧journal或公开记忆，就不能用缺少关联ID来证明从未联系，保守暂缓no_known_connection。当前不具备独立可信的玩家删除确认入口，player_confirmed和playerConfirmation仅兼容存量格式，不能授予退场权限；自由文本子串和AI正文均不是删除授权。不增加玩家设置，不解除真正联系人保护。新增字段均可选，保持V4及旧档迁移兼容；旧待提交候选若违反新边界应显式补算，不静默改写。


### PR #22 第三轮审查：事件混合成果与文本授权缺口

WorldEvent.resultKnowledge?沿用任务现有严格分类，不新增AI阶段。resolved/cancelled事件由程序从decision.resultKnowledge重建并核对；非终态不得预存分类。event:只投影结案元数据和明确facts，event-result:保留自由标题、resolutionText及reported/suspected标签，性质始终statement；event-plan:保留计划资料，性质为plan。旧已结案事件缺字段仍可读取，保留原文且不补造facts。隐藏/非完全公开事件的新来源继续worldEventOnly保护，公开事实投影也不包含未经分类的标题或引述。

文本存在不证明玩家肯定授权。没有可信独立确认交互时，待复核旧人的player_confirmed在世界验证和领域模拟两层均拒绝，包括真实肯定文本。旧字段继续可读，历史回执不改写；旧待提交的不安全删除候选须重新生成世界候选。有历史者保留完整实体，无历史且无联系迹象的临时人物仍可按原流程安全退出。未新增玩家设置、中文关键词分类器或联系人管理UI；事实分类语义仍由原世界AI负责，程序验证明确类型、来源、状态和事务边界。

## M5-P6：项目规划与原生公开内容

新请求必须依序完整输出thinking、正文、短期记忆、变量规划及启用时的行动选项；保留标签唯一、不嵌套。缺少thinking的新响应拒绝，旧已保存Story/草稿/journal保持可读，不重解析为新响应。thinking仅为创作提纲，不是私有隐藏推理或世界事实，不计正文长度、不流入下游证据、NPC知识或记忆。只校验结构，不评审每一步的文学内容。原生reasoning/thought/thinking由客户端独立接收，不要求存在，不写进Story。临时调试仅本页内存保留，默认折叠，刷新清除。输出长度终止拒绝保存，不自动提高预算或额外收费重发。

## M8-P0A 变量候选最小必要校验

evidence保持原字符串Schema，作为来源说明，不是逐字引用证明。AI负责计划/否定/事实、关系及技能变化的语义判断；程序不使用factEvidence/completedPayment或金额文本正则拒绝变量候选。严格JSON、命令白名单、整数分金额、余额、归属、引用、场景一致性、NPC知识类型与权限、生命周期和时间完整性、CAS、幂等及原子提交继续保留。任何单条数据底线错误整批拒绝，无静默部分接纳。空commands合法。

失败安全分类：invalid_json、schema_fields、data_integrity、amount_balance、time_data、candidate_conflict，以及既有permission。可查看白名单字段路径/命令类型/序号，不包含值、原始校验异常、NPC私有内容或供应商响应。世界阶段自身的结构化来源与worldEventOnly/ownerNpcId知识隔离契约不因变量减负而关闭。

## 当前事件生命周期（本次产品决策优先）

World 的 eventCommands 允许 SaveEvent、DeleteEvent、ArchiveEvent。DeleteEvent(eventId,expectedStatus,reason)清理已终止的完整对象；ArchiveEvent(eventId,title,summary)仅凭独立公开来源归档重大实际结案的公开文本，同时清理完整对象。两者保留稳定commandId/evidence，仍受权限、来源、版本、整批模拟和原子事务保护。retiredEvents保存轻量身份与必要成果引用，不能自动授予NPC或主角知识。历史时间线不要求保留完整活跃事件。

EVENT_SCHEDULE含正式时间至变量投影时间内（包括积压）的可处理场外到期事件；同一World请求按时间和依赖推演。正常结束、失败、取消、合理延期均可，无需强制后继；延期的下一预计时间必须晚于本轮窗口。futureEvents不能绕过该验证。旧缺预计时间的事件只读兼容并列unplannedLegacy，不补造历史日期。

Variables只通过TEXT_COMMAND_CATALOG的`set events[id].sceneState`更新已有现场事件的有限状态字段，不规划全新后台事件。新事件规划归World。普通Task保留原有独立语义，不因本次Event调度被强制要求dueAt。权威细则见`docs/WORLD_EVENT_LIFECYCLE.md`。
