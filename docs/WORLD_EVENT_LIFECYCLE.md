# 动态世界事件生命周期（当前权威契约）

本文件为当前 V6 契约，覆盖历史设计稿中历史必须重大且结案、单 NPC 单任务、每幕清空入场队列等旧规则。Task仍使用dueAt或completionCondition，不套用Event的新规划要求。

## 世界事实、角色认知、玩家观察

世界事实是正式结算的客观结果；转述、推测和计划不自动成为事实。主角与每个NPC的认知分别维护，observed/reported/suspected/unknown、ownerNpcId、knowledgeSource、来源回合与原始记忆覆盖凭据保持不变。

玩家可以只读浏览全部正式世界资料：NPC（含未联系/不在场人物）、组织、物品/资产、任务、事件/排程、各层记忆与人物总结。打开、搜索、翻页不调用模型、不修改GameState，也不将资料写入主角或其他NPC的知识。internal表示世界内部记录，不表示所属NPC知道。凭证、API Key、请求认证和系统内部数据不属于游戏变量。

visibility及记忆权限字段为旧档兼容和角色认知继续保存；不把hidden改known，也不把npc_private/internal改player_known。它们不限制玩家面板或独立历史记录。三阶段读取完整正式世界上下文；可读不代表角色知晓或命令可写。不得使用playerView作为模型上下文。World不构造内容审批来源池，NPC认知按人物分组。

已有known/partially_known事件的客观变化不要求主角先获知。程序保留主角原知情快照；World不通过正文、来源标签或证据关键词审批事件结果。模型根据上下文自行决定新记录的认知性质，按人物档案和可见性写入，不能自动传播私人资料。

当World更新此前known事件而无新的主角知情依据时，程序在可选`protagonistKnowledge`中保存此前Story投影（title/startAt/status/resolutionText）及本次worldUpdateTurnId；不修改主角或NPC记忆，不把visibility统一改known。Story继续读取旧投影，OFFSCREEN_STATE提供最新客观记录供世界推演，不自动更新任何人物的记忆或认知。TIME_PREFLIGHT沿用既有规则，仅排除尚未告知的新进展。玩家观察仍读取完整最新事件。

快照仅由程序维护，模型只能沿用原元数据或重放相同规范化结果。World追加当前来源回合，后续Variables现场更新和Story结构化入场回执沿原机制记录角色新知。取消了World按正文引用解除旧快照的途径。本次不迁移 V1–V5 测试存档，也不转换旧时间线；新存档使用 V6。

## 数据、时钟与职责

新WorldEvent规划必须有id/title/startAt/estimatedEndAt/backgroundText/goalText、非空actorRefs、status、关联任务、阻碍、前置条件、来源回合、角色知晓标记和影响程度。estimatedEndAt不早于startAt，是AI根据背景估计的时间，不用completionCondition代替，也不是自动完成证明。禁止固定时长或设备日期决定剧情。

Story呈现场内经历。Variables仅通过`set events[id].sceneState`改变已有现场事件的status/resolvedAt/resolutionText/outcome/resultKnowledge。sourceTurnIds只能保留原顺序去重后追加当前回合。其余规划、影响、地点、背景、目标、参与者、引用等不可由Variables改写；文本模拟、规范化候选复核、World前置检查和正式Commit共用同一字段边界。现场由正式快照与整批合法投影的在场并集确定，必须正向关联主角或现场NPC，且全部NPC参与者在本幕现场。纯组织事件和空参与者不因地点相同获得权限。

World负责新事件、场外发展、到期推演、延期、自然承接及清理。EVENT_SCHEDULE来自同一正式状态到变量投影时钟，due包含窗口内和积压的可处理场外事件，按预计时间排序；scenePending保护现场及开局同伴；unplannedLegacy不补造旧日期。按依赖拓扑顺序验证，未来不能提前完成，条件/时间/引用与状态转换继续校验。World 可以更新活动事件当前 actorRefs，但不能改写原 startAt、已结案结果或伪造主角行动；参与者须为有效实体，可来自本批合法创建。

到期意味着推演，不意味着自动成功。可成功/失败/改变/取消，或因阻碍重新安排estimatedEndAt到窗口之后。不强制造冲突或后继，也不增加逐事件AI调用。World关闭则不请求、不收费、不处理；积压保留至恢复。无合法变量时仍只有preview，纯过去视角不结算当前世界，但可通过 RecordHistory 留下历史记录，不推进现在的时钟。TIME_PREFLIGHT只给Story可被主角合理感知的条件，不从玩家观察面板取得秘密。

## 入场、现场与并行任务

Story 只对本幕实际处理的事件提交回执；未处理者保留 pending。重复、过期或与当前 entryId/status 不匹配的回执拒绝，不自动拒绝或消费未提及的事件。

主角移动后，未明确同行的原在场 NPC 自动 onScene=false，保留其地点、关系、任务与记忆。明确同行者由 Variables 更新地点/在场状态，按整批最终状态校验引用及地点一致性；不要求每人重复输出离场命令。

同一 NPC 可同时持有多个 planned/active/blocked 任务，不设数量名额或精确执行区间的重叠禁令。仍保留任务 ID、所属人物、起点与职责身份、实际结果和交接引用、终态与时间顺序；没有新增任务冲突评分器。

## 保留、清理与独立历史

- scheduled/active/blocked 记录继续支持调度。影响等级是描述属性，不决定历史写入、保留或展示权限。
- DeleteEvent(eventId,expectedStatus,reason) 只清理终态且无未处理入场/必要引用的事件。重要性与主角参与不再成为独立拒绝理由。保留最小 retiredEvents 身份防止重建同一 ID，不自动创建历史或后继。
- 有新发展才通过 predecessorEventIds 自然承接；有任务、人物知识或其他事件的必要引用时保守保留完整对象，避免悬空引用。
- ArchiveEvent 与 timelineCandidates 已删除，没有兼容分支。World 通过 worldCommands 中的 RecordHistory 创建独立历史。普通史料无需创建 WorldEvent、结案或获得 major 等级，可关联现有活动事件；可选重大纪事遵循文末 V2 规则。

```json
{
  "type": "RecordHistory", "commandId": "record-disclosure", "evidence": "本幕披露往事",
  "entry": {
    "id": "history-university", "title": "大学时期的合作分歧",
    "summary": "同事声称，大学时期曾与朋友因合作发生分歧。",
    "occurredTimeText": "大学时期", "knowledgeKind": "reported",
    "sourceRef": {"kind":"npc","id":"npc-colleague"},
    "actorRefs": [], "relatedEntryIds": []
  }
}
```

HistoryRecord 可含 occurredAt（准确发生时间）、occurredTimeText（年份/模糊时期/原始相对描述），均未知时均可省略。不以设备时间或记录时间替代未知发生日期。程序注入 recordedAt=当前游戏时钟与 sourceTurnId，不接受 AI 改写这两个字段。准确发生时间不能晚于记录时间；新的披露不倒退 worldClock。

knowledgeKind 为 established/reported/suspected，由模型声明；程序不判定可信度。sourceRef 可记录正式人物/组织，sourceText 可记录未建档来源。普通史料的可选 eventId 与 relatedEntryIds 只作引用，不要求事件重大或结案。普通史料按记录顺序展示，保留不同时间的新说法；只检查 ID 与明确重放，不做文字相似度去重。记录不会广播角色认知，World 上下文可查看历史，Story/Variables 通过完整上下文读取历史，不代表角色自动获得知识。

## 单一排程与事务

World 输出仅有 worldCommands、taskCommands、eventCommands、visibleHooks、unresolved 五个数组。futureEvents 已删除；未来计划从实际 SaveEvent/正式 events 的 scheduled 状态读取、显示和调度，没有第二条事件写入渠道。

V6 新开局、候选、存档和重载采用同一结构。V1–V5 明确拒绝读取，不自动迁移/补造历史；已有无法读取卡片的原始导出及确认删除功能仍可使用。本次不修改真实玩家存档。旧 World 输出或候选包含已删除字段时明确失败，不自动猜测或兼容旧协议。

沿用 StageGuard、CAS、版本快照、projectTurn 和 SaveRepository.commitTurn；事件、独立历史、journal、短期记忆、命令和下一草稿原子提交，失败全回滚，回执重放不重复结算。模型请求数量、记忆维护及费用授权不改。正式 Commit 重新使用同一领域投影验证，不信任前端完成状态。

程序验证结构、引用、时间与命令权限，不证明 AI 自然语言事实。必要引用检查可能保守保留记录；没有实现高级因果引用重写。Mock 不代表真实模型的因果推演已实测。后台资产等尚无合法命令的变化继续 unresolved，不用事件文字冒充财务更新。

## 历史时间轴 V2

普通 RecordHistory 行为不变。可选 `entry.chronicle` 将World认定的重大事实加入统一时间轴：世界类需声明影响范围、实际结束时间；关联正式事件时在整批最终投影检查终态，以实际开始时间定位。取消未开始计划只能记录真实撤销决定。主角类于重大事实发生时记录。旧史料不自动升级；同轮结案与历史命令的数组顺序不改变校验结果。详情与排序、V6兼容风险见 [HISTORY_TIMELINE_V2.md](HISTORY_TIMELINE_V2.md)。
