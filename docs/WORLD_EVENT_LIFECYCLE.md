# 动态世界事件生命周期（当前权威契约）

本文件记录本次确认的产品规则，优先于V0.1历史设计稿中事件“预计时间或条件”的表述。Task与Event不同，Task仍可使用dueAt或completionCondition；不推翻既有三阶段与知识隔离机制。

## 数据、时钟与职责

新WorldEvent规划必须有id/title/startAt/estimatedEndAt/backgroundText/goalText、非空actorRefs、status、关联任务、阻碍、前置条件、来源回合、可见性与影响程度。estimatedEndAt不早于startAt，是AI根据实际背景估计的时间，不能用completionCondition替代，也不是自动完成证明。禁止统一固定时长或读取设备时间。

Story呈现场内经历；Variables通过`set events[id].sceneState`更新已有现场事件的有限状态字段，不再通过文本根路径创建全新排程；World独立负责新事件、场外发展、到期推演、延期、自然承接及清理。Variables仍可更新现场NPC、经济等，旧缺规划记录不阻塞无关操作。旧规范化SaveEvent候选保持可读，仍受原权限、时间和来源验证。

World输入的EVENT_SCHEDULE来自同一正式状态到变量投影时钟，due包含窗口内和积压的可处理场外事件，按预计时间排序；scenePending包含不可越权替主角/现场人物执行的节点；unplannedLegacy是旧缺预计时间的记录。真实执行再根据来源依赖拓扑排序。依赖成环、未来提前结案或缺少原事件来源均拒绝。

同一World请求评估全部可处理到期事件：结束（success/failure/changed）、取消、阻碍或合理延期。结束不等于成功；failure不要求成功条件已满足。未结束的到期对象必须给出下一预计时间，晚于当前窗口。取消保留原有明确终止来源规则，可在未来安排正式开始前撤销；如填写实际终止时刻，可早于计划startAt，但不能在当前时钟以后。正常resolved仍不得早于startAt。Scene仍待实际事实时不替人物行动，旧缺时间记录不补造历史。

World关闭不调用模型、不结算，到期事件留待恢复。无合法变量时仍只能preview。纯过去视角仍不能执行当前世界变化，也不消费到期队列；积压留待下一正常世界回合。TIME_PREFLIGHT只使用已有可公开、可触达的实际依据；预计到期不直接中断或向主角泄露秘密。跨长时间行动后，World收到完整窗口中的到期队列。

## 结束、承接、清理与历史

SaveEvent保留稳定身份、参与者、开始时间及既有完成条件。后继事件仅在确有新发展时建立，通过predecessorEventIds和event:来源关联已结束的实际结果；不是每个结束事件都必须有后继。

DeleteEvent(eventId,expectedStatus,reason)仅清理终态完整对象，不创建时间线。ArchiveEvent(eventId,title,summary)要求重大、实际结束，并有独立主角已知事实支持本次公开标题及摘要；写时间线并清理完整对象。已知重大结案仍可使用timelineCandidates。仅到期、计划、隐藏结果、普通事务不能入历史。cancelled没有实际resolvedAt的记录不能伪造历史结案时间。

Schema V5新增retiredEvents：最小身份/终态/retiredAt/sourceTurnIds/linkedTaskIds/predecessorEventIds防止ID重复复活；重大或仍被任务、后继、历史、知识/记忆来源引用者保留紧凑detail。detail只包含历史身份、实际时间、参与者、位置、可见性和成果，不保留完整背景、目标、阻碍。必要公开内容在publication独立记录，原隐藏detail不转为公开。清理后保留的引用仍能用于合法任务与因果判断，不能把event-result转述变为事实或授予其他NPC秘密。普通无引用对象不再保留完整事件资料，也不进入后续AI活跃事件列表。

正式journal和既有幂等命令凭据不在本轮删除；命令凭据可能仍含旧事件快照，本轮不重构命令账本。事件不再无限堆积于活跃events，但最小历史身份会随经历增长。

## 兼容与事务

StoredWorldEventSchema读取旧可选字段；新规划使用严格WorldEventSchema；新写入领域边界检查规划。V1–V4链式迁移到V5只加空retiredEvents；不补日期、完成条件或结果，不修改原有时钟、revision、journal及候选。旧档缺预计时间可继续读取、显示及现场更新，World重新规划继续时提供真实合理估计；旧缺项事件实际结束/取消时可保留缺项，避免为清理伪造过去排程，新创建绝无此例外。

所有世界操作只是TurnDraft候选，WorldStage、StageGuard、版本快照、CAS、projectTurn与SaveRepository.commitTurn复用原机制。执行、清理、时间线、journal、记忆及下一回合草稿同事务；失败全回滚，精确回执重放不重复结算，不在IDB事务中等待网络。

语义与现实估计由AI负责，程序验证结构、引用、时间、权限、来源性质与状态转换；Mock全绿不代表真实模型因果推演已获验证。后台资产、经营等不支持的变化继续列unresolved，不能用事件文字冒充正式财务更新。
