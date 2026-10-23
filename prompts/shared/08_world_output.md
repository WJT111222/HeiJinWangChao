只输出一个可解析JSON对象，顶层字段固定为：worldCommands、taskCommands、eventCommands、futureEvents、visibleHooks、timelineCandidates、unresolved；前五项为数组，timelineCandidates和unresolved为字符串数组。没有变动时全部为空数组。不要输出前言、代码围栏或内部推理。
worldCommands、taskCommands 与 eventCommands 使用实际 COMMAND_CATALOG 中的 type 专属同级字段结构 {commandId,type,evidence,...类型专属字段}，不接受 group/entityId/payload 包装或旧命令别名。worldCommands 仅可 CreateNpc（onScene=false）、UpdateNpc、RecordNpcMemory、CreateLocation、CreateOrganization、RecordOrgRelation、RetireNpc（均需下述逐字段场外校验）；taskCommands 仅 SaveTask，eventCommands 仅 SaveEvent。禁止推进主角自主任务、主角交易、独立修改时钟或重复结算现场 NPC。不存在的补丁操作列入 unresolved。evidence 使用下述 WORLD_EVIDENCE_V1 来源凭据；既有事实引用原文，新场外推演不要求逐字存在于旧正文。
futureEvents 必须满足完整 WorldEventSchema：id、title、status(scheduled/active/resolved/blocked/cancelled)、startAt、actorRefs、linkedTaskIds、prerequisites、blockers、visibility(hidden/partially_known/known)、impact(minor/significant/major)、sourceTurnIds 必填；数组无内容时仍提供 []。estimatedEndAt/resolvedAt/completionCondition 至少提供符合状态的一项；结案需 resolvedAt 和 resolutionText。SaveTask 使用完整 task，状态为 planned/active/completed/blocked/cancelled，不混用事件状态。遵从目录中的字段与正式状态引用校验。
visibleHooks的每项为 {text,revealAfter}，只记录主角有合理知晓途径的线索。完全私密的后台行动放在事件/任务私有状态，不能放进visibleHooks，也不能写入玩家可见日志摘要。
timelineCandidates仅可引用 **已resolved且重大** 的事件ID；它是内部候选，是否实际展示还需程序验证玩家可见性。严禁虚构已经结案以凑时间轴数量。
如果世界生成依据的变量阶段状态标记variablePending=true，所有提案只作为暂存预览；先保守保持行动与旧状态不矛盾，不宣称永久落库，并在unresolved指出受依赖影响的环节。


## M4-P3 世界阶段执行契约（现行）

### 唯一时间窗口与来源

TIME_WINDOW.from 为正式基线 worldClock，to 为合法变量候选的时间投影。星期由程序计算；不得 SetWorldClock，也不能结算 to 之后的行动。没有合法变量时窗口为零，只保存 preview；运行开关关闭不使已有合法变量候选失效。主角的未来选项、计划不是已经发生的世界时间。

每条命令的 evidence 是 JSON 字符串：JSON.stringify({version:1,kind,at,sources,fact,rationale,outcome?})，字段定义以 COMMAND_CATALOG.worldEvidenceSchema 为准。at 必须在窗口内。sources 只使用 WORLD_SOURCES 中的真实 id，不发明 ID 或依赖本批次自证来源；本批 task:/event:/handoff: 必须先按依赖顺序验证，无环才可引用。rationale 简述可核查的因果依据与耗时，不要求内部思维链。

- established：已有客观事实，fact 必须出现在提供的 fact 来源中，通过正文反证与对白边界检查。
- derived：依据已有动机、已成立事实、合法时间和条件生成的新场外行动候选。fact 描述已发生结果，可以不逐字存在于旧正文；来源不能只有计划，也不能包含传闻/猜测。不是“时间到了所以成功”。
- planned：未来计划、目标或排程，不表示执行成功。可基于传闻计划调查，但不得将传闻变成客观结果。
- reported / suspected：仅用于 RecordNpcMemory，保持 [转述] / [推测] 前缀与知识性质，必须对应原有 statement 来源。不能据此修改客观状态或结案。

例如一名场外医师在十分钟空档中整理诊室，可引用 goal:npc-id:0 与 npc:npc-id，生成 derived 候选及具体耗时。不得要求旧正文提前逐字描述该行动。新建人物与地点须符合因果、稳定 ID、引用和层级约束，不扩充全国数据库。CreateLocation 仅接受 established 或有充分依据的 derived；纯 planned 的修建计划不能创建现实地点，可记录任务/未来事件，无法确认是否存在则 unresolved。

### 场外字段权限

PROTECTED_SCENE 是正式基线与变量投影的现场人物并集，本轮刚离场人物也不重复调度。开局同伴不由世界阶段改写；普通回合中已离场同伴按普通场外边界处理。

UpdateNpc 仅限已有场外 NPC 的 locationId、healthText、onScene=false，以及特殊 NPC 的 activeGoals。禁止 onScene=true、affinityChange、relationshipText、lastInteractionAt；不能伪造主角已参与互动。planned 只允许更新 activeGoals（changes={}），位置/健康的新推演必须实际经过时间。

CreateNpc 必须场外、affinity=0 且不设置 affinityConfirmed、不设置 lastInteractionAt；relationshipText 固定为“尚未与主角接触”；不得内联 memories、knownInformation、longTermMemories。不得重复建档已有身份或初始同伴。

RecordNpcMemory 保留自身合法来源、当前回合与时间，来源 ID 写入 knowledgeSource，文本对应 fact（转述/推测加前缀）。不得读取别人的私有来源，derived 不得标记 player_known。这只是当回合事实记录，不是记忆压缩。

CreateOrganization 保留四种独立结构，不设置资金、资产或流动估值；protagonistRelation 为“尚未与主角接触”，relationHistory=[]。已有组织的 RecordOrgRelation 仅接受已成立的明确关系事实与理由，不推演主角交易或承诺。

财务、后台物品、组织经营字段不在本阶段命令权限内，真实不支持的变化列入 unresolved。事件文字不得冒充正式资产更新。

### 任务、事件与未来计划

SaveTask 不得更换既有 actorRef、goal、startAt、completionCondition；原来是主角的任务不能改给 NPC。SaveEvent 保留原参与者、startAt、completionCondition 与历史 sourceTurnIds，新增当前 turnId；不得重写终态或把 active/blocked 回退为计划。

active / completed / resolved 必须已开始且在窗口内，所有旧、新 prerequisites/blockers 都须可确定性验证已满足。当前程序只认识已完成任务或已结案事件 ID（可加 task: / event: 前缀）；文本条件、未解决条件条件应 unresolved；本批前序成果只有先经独立来源、实际时间和权限验证，才可供后序依赖，不擅自清除阻碍。

已有任务完成必须引用自身 task:<id> 来源，已有事件结案必须引用自身 event:<id> 来源；不能仅凭任意人物动机或另一任务/事件的来源完成它。允许同时引用人物目标、能力、组织背景及有关事实，以自主推演正文尚未出现的新结果。

derived 完成还必须提供 outcome，说明可观察的实际成果，区别于 fact 的结果宣告。必须确实执行、具备足够时间与资源，不能只有到期或计划。任务/事件完成条件保持有效；未来开始的任务不能提前完成。程序检查结构、来源、时间、终态和已知阻断，但不声称完整理解自然语言；无法可靠证明的事项保持 unresolved。

futureEvents 仅是 eventCommands 中同 ID、完全相同的合法 SaveEvent 的镜像，必须新建且 scheduled，startAt>=to；不能作为独立执行命令、不能复制既有终态。预计结束/dueAt 可以在未来，但绝不证明当前已完成。

visibleHooks、revealAfter、timelineCandidates 全部仅为内部候选；revealAfter 到达也不自动发布，不写普通正文/日志/历史，不改变主角认知。正式揭示与原子提交等待后续阶段。


### 二轮确认：估计、任务占用与终止

AI 可以根据难度、准备、资源和现实耗时自主估计 estimatedEndAt 与 dueAt，不预先决定成功或失败。estimatedEndAt 是事件预计结束，dueAt 是任务预计截止；resolvedAt 与 resolutionText 仅描述实际结案。scheduled、active、blocked 不得携带 resolvedAt/resolutionText（含空串），可保留或有理由地调整估计。到期只触发后续重新评估，可能完成、失败、受阻、延期或取消，不自动成功。实际结案时间可以早于或晚于原估计，但必须在当前合法时间窗口内。

cancelled 保留现有取消语义：允许合法的取消说明、可选实际终止时间，不强制与 resolved 使用同一字段组合；取消未来安排不必假装该事件已经开始。取消的实际时间不得在未来。非终态不能借取消说明提前存放实际结案字段，futureEvents 镜像同样遵守。

每个 NPC 最多一项未终结后台任务。planned、active、blocked 均占用唯一名额；completed、cancelled 不占用。可以有多个长期目标，一个任务内部可包含调查/谈判/执行等连续步骤，不把每个动作拆成独立任务。正式状态、变量投影与本批候选均检查；同批真实终结后可按实际 resolution.at 释放名额，新职责不得早于释放及实际交接时间，无固定等待回合。不得换 ID、换负责人或借组织名义绕过。同一组织可以有多任务；组织任务实际执行人缺少结构化引用时必须说明无法可靠验证，不伪造程序硬校验。旧数据有多任务冲突时不能静默删改，冲突候选拒绝；内部 unresolved 会保留已有冲突说明。

任务成功完成使用 completed。实际失败且终止、合理取消使用 cancelled，在 evidence.fact/rationale/outcome 中保留真实原因与结果，不冒充成功。暂时无法推进使用 blocked，继续占用。明确失败后已经终止的肯定分句可支持取消；“没能完成”或被否定的终止不支持成功完成。不发明 failed 状态；实际成功、失败或取消的结果通过 resolution 保留，必要事件和记忆仍分别记录。世界阶段仍仅保存候选，不做自动到期调用或正式结算。

### A5 取消/终止证据补充

SaveTask.cancelled 必须引用目标自身 task:<id>，SaveEvent.cancelled 必须引用目标自身 event:<id>；可以同时引用动机与其他事实，但不能用它们替代目标来源。fact 必须明确表达肯定成立的取消、撤销、终止、放弃或失败后已经停止执行；普通的整理资料、仅提到取消通知、临时失败后准备重试都不等于终止。

derived 取消必须另提供 outcome，说明具体终止原因或实际后果，不能留空、复述 fact 或只写“任务取消了/行动已终止”。例如 fact=“同事未能完成清点，行动已经终止”，outcome=“关键器材损坏导致清点失败，负责人撤销排程并保留已核对清单”。“未能终止行动”不支持终止。复杂且无法可靠识别的表述应 unresolved，不声称程序能验证全部自然语言因果。

合理主动取消未来安排不要求 startAt 已到，也不要求满足原任务/事件的全部完成条件或解除全部阻碍；cancelled 事件仍不强制 resolvedAt/resolutionText，填写时沿用已有合法时间约束。本次只生成候选，不立即释放正式世界中的任务名额。


### M5-P5 自主承接与安全退场（最新产品契约）

不要强制每项任务产生后续人物、组织或任务。AI在同一世界请求内判断是否已解决、是否需要继续、谁具备职责/权限/资源、什么实际成果已传递。没有继续的合理必要就自然结束；不设接力层数、固定持续回合或强制升级。不要只因到期就结案。后台费用、物资和资产没有通用结算权限，无法安全入账的变化写unresolved，事件文字不冒充账本变化。

优先在 WORLD_EVIDENCE_V1 使用可选 decision：{targetId,status,reason,result,conditionsSatisfied,continues,failure?}。status为completed/resolved/cancelled/blocked/retired，必须与目标命令一致。它是模型在同次请求内的明确决策和具体结果说明，不是内部思维链。completed/resolved需要实际成果、条件满足、continues=false；cancelled说明实际取消或失败原因、后果且continues=false，未来安排可以提前取消；blocked仍承担职责，continues=true。不要求正文或fact含指定的“完成/终止”字样，不能把普通动作或暂时失败伪装成终结。旧凭据仍按原保守规则兼容；新决策不绕过实体、权限、来源、时间和阻碍检查。

任务终态的resolution={at,outcome,result,reason,sourceTurnId}由程序依decision和当前回合确定性建立，outcome为success/failure/cancelled。若模型提供该对象，必须完全吻合；不能伪造来源回合或时间。原任务actorRef、goal、startAt和completionCondition不可改写。终态不再作为活跃任务反复调度，历史成果仍可供有权限的因果分析。

需要承接才新建任务，并提供handoff={fromTaskId,at,channel,content,necessity,knowledgeKind}：前序必须已合法completed/cancelled并留有resolution；逐字交接的content引用其result原文片段；忠实概括可提供summaryBasis={mode:"faithful_summary",resultExcerpt}，resultExcerpt锚定实际原文，content可整理、概括，fact可另行叙述实际交接动作；channel说明实际通信/见面/报告/文件等途径，necessity说明为何接收方有必要接手，knowledgeKind=observed/reported。另引接收方自身npc:/org:或已验证新人物/组织来源说明职责。resolution.at<=handoff.at<=新任务startAt，交接已发生且不超出本轮窗口。允许同批交接，必须先验证前序，不得自证或成环。不能为重复相同成果、对象、目标换ID造任务；不要循环移交来延长已解决的事情。

执行者知道、世界事实成立、接收者收到与主角已知是不同状态。已验证交接生成handoff:<新taskId>供接收者自己的记忆/计划引用，reported只代表转述，不能提升为已验证事实或player_known。隐藏event来源仍不得代替NPC/组织实际获知；其他私有记忆不能搭便车传递。组织可承接自身持续职责，不必立即创建人物；不能借组织名义掩盖忙碌NPC实际执行的职责。

RegisterContact只由变量阶段据正文实际联络事实登记；联系人和初始同伴永久保留完整档案，人物面板可见不等于联系人；旧档contactReviewNpcIds仅表示身份待确认、暂缓清理，不是正式联系人。RetireNpc仅世界阶段可提议，字段npcId、expectedIdentityKey、reason、retainMemoryIds，decision必须targetId=该NPC、status=retired、conditionsSatisfied=true、continues=false，reason与命令相同，并交代必要成果处理。只清理非联系人、非现场且无未终结任务/长期目标/组织职务/当前资产持有或未交接重要事件职责的人物。不要为了删除强行清除其合理职责。

必要成果先保留任务结果/事件。retainMemoryIds只选确需保留的原始私有记忆；公开记忆自动保留，必要私有材料仅转成internal历史，绝不授予其他角色或公开。完整NPC和所属私人总结删除，retiredNpcs仅留稳定ID、identityKey、name、aliases、retiredAt、sourceTurnIds，不是完整休眠备份。未来再出现须复用可信历史身份，不能编造旧关系或恢复不存在的旧经历。历史回顾回合仍禁止任何任务推演或退场；全部只是候选，正式回合事务提交前不改GameState。


### PR #22 首轮审查修订：来源性质、旧档复核与概括性交接

WORLD_SOURCES不再把整个任务JSON标为fact：task:<id>的成果事实仅包含实际resolution.result及程序状态/时间；目标、条件等在task-plan:<id>中仍是plan，理由不充当事实；handoff:<id>只表示接收者实际收到的内容，reported仍是statement。任务B完成其他职责不证明A报告的内容属实。其他人物不能通过task JSON、任务目标或隐藏事件ID绕过NPC知识边界。缺少独立核实来源时保持转述、计划调查或unresolved，不将其记录为客观事实。

忠实概括与原文锚点分工：summaryBasis.mode固定faithful_summary，resultExcerpt为来源成果的真实片段，由程序核验；content由同次世界AI忠实概括、转述，不机械要求逐字子串，fact可描述通信本身。AI必须保持原始认知性质，不添加原来源没有的人物、金额、结论或秘密；不确定性不能丢失。不存在/越权来源、伪造原始片段、时间越界仍拒绝；程序不声称能仅凭字符串证明任意概括的语义正确，不增加额外裁判请求。未声明summaryBasis的旧逐字交接保持兼容。

V1/V2迁移仅确认初始同伴为联系人，其余旧人物进入contactReviewNpcIds；V3预览误标也会修复，真实RegisterContact命令凭据与初始同伴继续永久保护。待确认不是非联系人，不自动清理。若确需RetireNpc，另提供contactReview={conclusion:"non_contact",basis,reason}：no_known_connection仅适用于沿用系统“尚未与主角接触”中性标识、无既往互动/已确认关系倾向/公开记忆或历史引用的人物；存在联系痕迹时继续保留，除非player_confirmed有当前正文中的明确主角确认及可靠公开来源。不能仅凭NPC动机虚构主角确认。此复核不能解除正式联系人的永久保护。复核、成果留存和删除仍只在正式提交同一事务中生效，不增加玩家设置或联系人管理界面。
