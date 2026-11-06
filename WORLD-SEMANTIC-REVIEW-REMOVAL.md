# World 内容审查移除报告

## 基线与范围

远端main核对为ea9cd1e60831a2cc8bbf60d40c7e75eb1d26b91e，已包含PR59；从该提交建立codex/remove-world-semantic-review。未改main、玩家存档、AI调用次数、渠道、版本或三阶段协议。

## 已删除的执行机制

删除worldEvidence.ts、worldFactNature.ts、worldSceneRecord.ts、validation/evidence.ts。移除World证据JSON Schema、来源池、事实/计划/传闻/否定分类器、旁白与名字锚点、目标句/助动词规则、结束/取消谓词、来源所有者审批与逐字成果交接检查。worldOutput不解析evidence，也不从decision生成成果。worldDependencies只读取结构化实体依赖，不解析证据或证据时间。

GameState的handoff正文子串检查已删除。World事件入场仍用eventId/entryId与唯一回执，去掉textEvidence和cue的逐字正文比对；不改变Story标签、规划结构或生成请求。timelineCandidates取消facts审批门槛，保留重大终态要求，现有分类可用于历史展示，缺少分类时保留实际resolutionText。

旧source_*/fact_*/completion_evidence/cancellation_evidence/player_knowledge/timeline_fact诊断退出执行链。未保留始终成功的验证器、审查开关或隐藏备用协议。

## 实际数据流

Story → Variables → 同一projectTurn投影 → 现有单次World请求 → JSON与WorldResultSchema → 命令分组/字段权限、ID/引用、依赖、时间、任务占用与事件生命周期 → 整批projectTurn → WorldStage/CAS候选保存 → Commit再次parseWorld及候选一致性检查 → SaveRepository原子写入与回执 → 等待玩家输入。

evidence仍是既有非空字符串字段，只作说明，旧JSON字符串无需迁移。终态任务直接输出已有resolution，事件直接输出resolvedAt/resolutionText等字段。没有新增数据库或状态Schema。

## 保留的底线

World不能直接修改主角、扣款、移动或推进时钟；受保护现场NPC及开局同伴仍不能被后台更新。事件actorRefs记录参与身份不执行这些行为。保留稳定ID、地点层级、版本、数量、引用、字段范围、终态不可复活、任务占用、真实结束时间、前置依赖、清理保护、轻量历史、StageGuard、CAS、幂等和整批回滚。

NPC_KNOWLEDGE仍按ownerNpcId分组、仅向适用阶段提供，Story不读取私人原始档案或内部总结；记忆命令只写指定NPC，不自动复制到其他人。World客观更新保持主角旧知情快照，visibleHooks保持内部候选。语义上哪些消息真实/人物实际知道什么由AI决定，程序不再声称可用小说字符串证明其正确性；明确设置可见性的模型命令仍可能判断错误，需要真实模型单独验收。

## 兼容与限制

V1–V5读取、旧事件及旧候选结构不变。已保存完整resolution的旧候选保留非执行evidence并重验。未规范化、只有旧decision但没有实际resolution的原始输出不再是可执行候选，需要玩家明确重新生成；不为兼容复活审批器。旧程序知情快照若不满足当前确定性元数据约束仍会安全拒绝，而非偷偷迁移或自动请求。

历史报告仅保留为历史，当前规范见docs/CURRENT_ARCHITECTURE.md、docs/WORLD_EVENT_LIFECYCLE.md和prompts/docs/OUTPUT_CONTRACT.md。无真实付费API验证，不能保证模型因果判断正确。

## 本轮验证记录（开发中）

新增world-data-boundary.test.ts，修改前24项中17失败、7通过：自然说明触发旧source_format，真实数据错误仍被拒绝。删除仅保护旧语义审批的测试；引用/金额/时间/权限/CAS/原子性测试保留并按新直接成果字段更新Mock。

第一批受影响回归：264通过、110失败；失败主要是旧证据生成成果的Mock、已删除的语义拒绝断言及修改后尚未刷新Prompt哈希。第二批325通过、50失败，正在逐项处理；这些不是最终成绩。

代码冻结后的完整工程/提示词/Chromium结果待填写，当前不宣称验收通过。
