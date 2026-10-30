# 动态世界事件生命周期（当前权威契约）

本文件覆盖历史设计稿及本PR早期报告中事件“预计时间或条件”、玩家只能查看主角已知资料、隐藏重大结果先清理再公开的旧规则。Task仍使用dueAt或completionCondition，不套用Event的新规划要求。

## 世界事实、角色认知、玩家观察

世界事实是正式结算的客观结果；转述、推测和计划不自动成为事实。主角与每个NPC的认知分别维护，observed/reported/suspected/unknown、ownerNpcId、knowledgeSource、来源回合与原始记忆覆盖凭据保持不变。

玩家可以只读浏览全部正式世界资料：NPC（含未联系/不在场人物）、组织、物品/资产、任务、事件/排程、各层记忆与人物总结。打开、搜索、翻页不调用模型、不修改GameState，也不将资料写入主角或其他NPC的知识。internal表示世界内部记录，不表示所属NPC知道。凭证、API Key、请求认证和系统内部数据不属于游戏变量。

visibility及记忆权限字段为旧档兼容和角色认知继续保存；不把hidden改known，也不把npc_private/internal改player_known。它们不限制玩家面板或事实历史归档。Story仍独立使用主角已知投影；不得使用playerView作为模型上下文。WORLD_SOURCES中worldEventOnly保留事件事实与人物知情的隔离，不因玩家阅读而失效。

## 数据、时钟与职责

新WorldEvent规划必须有id/title/startAt/estimatedEndAt/backgroundText/goalText、非空actorRefs、status、关联任务、阻碍、前置条件、来源回合、角色知晓标记和影响程度。estimatedEndAt不早于startAt，是AI根据背景估计的时间，不用completionCondition代替，也不是自动完成证明。禁止固定时长或设备日期决定剧情。

Story呈现场内经历。Variables仅通过`set events[id].sceneState`改变已有现场事件的status/resolvedAt/resolutionText/outcome/resultKnowledge。sourceTurnIds只能保留原顺序去重后追加当前回合。其余规划、影响、地点、背景、目标、参与者、引用等不可由Variables改写；文本模拟、规范化候选复核、World前置检查和正式Commit共用同一字段边界。现场由正式快照与整批合法投影的在场并集确定，必须正向关联主角或现场NPC，且全部NPC参与者在本幕现场。纯组织事件和空参与者不因地点相同获得权限。

World负责新事件、场外发展、到期推演、延期、自然承接及清理。EVENT_SCHEDULE来自同一正式状态到变量投影时钟，due包含窗口内和积压的可处理场外事件，按预计时间排序；scenePending保护现场及开局同伴；unplannedLegacy不补造旧日期。按依赖拓扑顺序验证，未来不能提前完成，条件/时间/来源与状态转换继续校验。

到期意味着推演，不意味着自动成功。可成功/失败/改变/取消，或因阻碍重新安排estimatedEndAt到窗口之后。不强制造冲突或后继，也不增加逐事件AI调用。World关闭则不请求、不收费、不处理；积压保留至恢复。无合法变量时仍只有preview，纯过去视角不结算当前世界。TIME_PREFLIGHT只给Story可被主角合理感知的条件，不从玩家观察面板取得秘密。

## 保留、清理与历史

- 所有scheduled/active/blocked完整事件保留，玩家可查全部字段。
- significant/major终态保留完整对象。主角参与或关联主线的终态、具有必要任务/因果/知识/组织/历史引用的终态也保留。没有独立主线字段，因此主角参与及其前序承接链采用保守保护；不能靠自由文字判定“已脱离主线”。
- DeleteEvent(eventId,expectedStatus,reason)仅允许minor、终态、无主线/重要性及必要引用的独立杂事。保留最小retiredEvents身份以防重复重建，删除完整活跃表对象，不自动进入时间线。无需继续就结束，不强制后继。
- 有新发展才通过predecessorEventIds与event:来源自然承接。被后继、任务、人物知识等引用的原事件不清理，避免丢失必要背景与成果。
- ArchiveEvent(eventId,title,summary)只归档重大、已实际结束且时间合法的可信fact内容。来源可以是该事件本身的已分类facts；无需主角知晓、无独立披露流程。不清理重要完整对象。现有retiredEvents.detail也可用同一事实规则归档，保留旧publication兼容字段但不作为玩家可见资格。
- timelineCandidates只接受重大实际结束且有resultKnowledge.facts的事件，程序将facts写入历史标题/摘要/结果，不将自由resolutionText的举报或推测升级为真相。旧历史时间线原样可读；缺少分类的旧终态不补造facts，可在有独立可信事实来源时通过ArchiveEvent归档。时间到期、转述或计划不构成结案证明。

## 兼容、事务与限制

不增加本次Schema版本。V1–V4沿既有迁移到V5，只添加空retiredEvents，V5原样读取。旧hidden/partially_known和npc_private/internal不重写。缺规划旧事件继续读取与现场更新；World确需继续排程时再提供真实估计，实际结束时不为清理编造过去日期。旧retiredEvents的detail/publication/引用和原时间线继续保留可查，已经移除的历史背景无法凭空恢复。

旧规范化Variables候选如果改写sceneState外字段，读取仍兼容但正式重验拒绝，须重新生成；不让“兼容”绕过权限。候选只在TurnDraft保存。沿用StageGuard、CAS、版本快照、projectTurn和SaveRepository.commitTurn；事件、journal、短期记忆、命令和下一草稿仍原子提交，失败全回滚，回执重放不重复结算。记忆压缩、来源覆盖、检索和维护费用授权均不改。

程序验证结构、引用、时间、权限及来源类别，不声称证明AI所有自然语言事实。主线保护和引用检查有保守误保留风险；没有删除所有有引用事件的高级引用重构。Mock验证不代表真实模型因果推演已经实测。后台资产、经营等不支持变化继续unresolved，不用事件文字冒充财务更新。
