只输出一个可解析JSON对象，顶层字段固定为：worldCommands、taskCommands、eventCommands、futureEvents、visibleHooks、timelineCandidates、unresolved；前五项为数组，timelineCandidates和unresolved为字符串数组。没有变动时全部为空数组。不要输出前言、代码围栏或内部推理。
worldCommands、taskCommands 与 eventCommands 使用实际 COMMAND_CATALOG 中的 type 专属同级字段结构 {commandId,type,evidence,...类型专属字段}，不接受 group/entityId/payload 包装或旧命令别名。worldCommands 仅可 CreateNpc（onScene=false）、UpdateNpc、RecordNpcMemory、CreateLocation、CreateOrganization、RecordOrgRelation（均需下述逐字段场外校验）；taskCommands 仅 SaveTask，eventCommands 仅 SaveEvent。禁止推进主角自主任务、主角交易、独立修改时钟或重复结算现场 NPC。不存在的补丁操作列入 unresolved。evidence 使用下述 WORLD_EVIDENCE_V1 来源凭据；既有事实引用原文，新场外推演不要求逐字存在于旧正文。
futureEvents 必须满足完整 WorldEventSchema：id、title、status(scheduled/active/resolved/blocked/cancelled)、startAt、actorRefs、linkedTaskIds、prerequisites、blockers、visibility(hidden/partially_known/known)、impact(minor/significant/major)、sourceTurnIds 必填；数组无内容时仍提供 []。estimatedEndAt/resolvedAt/completionCondition 至少提供符合状态的一项；结案需 resolvedAt 和 resolutionText。SaveTask 使用完整 task，状态为 planned/active/completed/blocked/cancelled，不混用事件状态。遵从目录中的字段与正式状态引用校验。
visibleHooks的每项为 {text,revealAfter}，只记录主角有合理知晓途径的线索。完全私密的后台行动放在事件/任务私有状态，不能放进visibleHooks，也不能写入玩家可见日志摘要。
timelineCandidates仅可引用 **已resolved且重大** 的事件ID；它是内部候选，是否实际展示还需程序验证玩家可见性。严禁虚构已经结案以凑时间轴数量。
如果世界生成依据的变量阶段状态标记variablePending=true，所有提案只作为暂存预览；先保守保持行动与旧状态不矛盾，不宣称永久落库，并在unresolved指出受依赖影响的环节。


## M4-P3 世界阶段执行契约（现行）

### 唯一时间窗口与来源

TIME_WINDOW.from 为正式基线 worldClock，to 为合法变量候选的时间投影。星期由程序计算；不得 SetWorldClock，也不能结算 to 之后的行动。没有合法变量时窗口为零，只保存 preview；运行开关关闭不使已有合法变量候选失效。主角的未来选项、计划不是已经发生的世界时间。

每条命令的 evidence 是 JSON 字符串：JSON.stringify({version:1,kind,at,sources,fact,rationale,outcome?})，字段定义以 COMMAND_CATALOG.worldEvidenceSchema 为准。at 必须在窗口内。sources 只使用 WORLD_SOURCES 中的真实 id，不发明 ID 或依赖本批次自证来源。rationale 简述可核查的因果依据与耗时，不要求内部思维链。

- established：已有客观事实，fact 必须出现在提供的 fact 来源中，通过正文反证与对白边界检查。
- derived：依据已有动机、已成立事实、合法时间和条件生成的新场外行动候选。fact 描述已发生结果，可以不逐字存在于旧正文；来源不能只有计划，也不能包含传闻/猜测。不是“时间到了所以成功”。
- planned：未来计划、目标或排程，不表示执行成功。可基于传闻计划调查，但不得将传闻变成客观结果。
- reported / suspected：仅用于 RecordNpcMemory，保持 [转述] / [推测] 前缀与知识性质，必须对应原有 statement 来源。不能据此修改客观状态或结案。

例如一名场外医师在十分钟空档中整理诊室，可引用 goal:npc-id:0 与 npc:npc-id，生成 derived 候选及具体耗时。不得要求旧正文提前逐字描述该行动。新建人物与地点须符合因果、稳定 ID、引用和层级约束，不扩充全国数据库。

### 场外字段权限

PROTECTED_SCENE 是正式基线与变量投影的现场人物并集，本轮刚离场人物也不重复调度。开局同伴不由世界阶段改写；普通回合中已离场同伴按普通场外边界处理。

UpdateNpc 仅限已有场外 NPC 的 locationId、healthText、onScene=false，以及特殊 NPC 的 activeGoals。禁止 onScene=true、affinityChange、relationshipText、lastInteractionAt；不能伪造主角已参与互动。planned 只允许更新 activeGoals（changes={}），位置/健康的新推演必须实际经过时间。

CreateNpc 必须场外、affinity=0 且不设置 affinityConfirmed、不设置 lastInteractionAt；relationshipText 固定为“尚未与主角接触”；不得内联 memories、knownInformation、longTermMemories。不得重复建档已有身份或初始同伴。

RecordNpcMemory 保留自身合法来源、当前回合与时间，来源 ID 写入 knowledgeSource，文本对应 fact（转述/推测加前缀）。不得读取别人的私有来源，derived 不得标记 player_known。这只是当回合事实记录，不是记忆压缩。

CreateOrganization 保留四种独立结构，不设置资金、资产或流动估值；protagonistRelation 为“尚未与主角接触”，relationHistory=[]。已有组织的 RecordOrgRelation 仅接受已成立的明确关系事实与理由，不推演主角交易或承诺。

财务、后台物品、组织经营字段不在本阶段命令权限内，真实不支持的变化列入 unresolved。事件文字不得冒充正式资产更新。

### 任务、事件与未来计划

SaveTask 不得更换既有 actorRef、goal、startAt、completionCondition；原来是主角的任务不能改给 NPC。SaveEvent 保留原参与者、startAt、completionCondition 与历史 sourceTurnIds，新增当前 turnId；不得重写终态或把 active/blocked 回退为计划。

active / completed / resolved 必须已开始且在窗口内，所有旧、新 prerequisites/blockers 都须可确定性验证已满足。当前程序只认识已完成任务或已结案事件 ID（可加 task: / event: 前缀）；文本条件、未解决条件或需要同批次才能证明的条件应 unresolved，不擅自清除阻碍。

derived 完成还必须提供 outcome，说明可观察的实际成果，区别于 fact 的结果宣告。必须确实执行、具备足够时间与资源，不能只有到期或计划。任务/事件完成条件保持有效；未来开始的任务不能提前完成。程序检查结构、来源、时间、终态和已知阻断，但不声称完整理解自然语言；无法可靠证明的事项保持 unresolved。

futureEvents 仅是 eventCommands 中同 ID、完全相同的合法 SaveEvent 的镜像，必须新建且 scheduled，startAt>=to；不能作为独立执行命令、不能复制既有终态。预计结束/dueAt 可以在未来，但绝不证明当前已完成。

visibleHooks、revealAfter、timelineCandidates 全部仅为内部候选；revealAfter 到达也不自动发布，不写普通正文/日志/历史，不改变主角认知。正式揭示与原子提交等待后续阶段。
