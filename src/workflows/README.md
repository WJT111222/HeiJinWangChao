# 工作流

> **当前状态（2026-10-24）**：此文件下方原 M4-P1～M5-P4 段落是分阶段实现说明，而不是最新待开发清单。M5-P5 的任务终态、成果接力及有条件 NPC 安全退场已随 PR #22 合并；M5-P6 的项目 Thinking/9 步开局与 15 步普通回合规划、独立原生 Thinking 已随 PR #23 合并；四阶段模型选择 UI 见 PR #25。当前宏观工作流与严格边界详见 [架构概览](../../docs/CURRENT_ARCHITECTURE.md)。


M4-P1 的 `storyStage.ts` 从 SaveRepository 重读已绑定回合，复用 runStageRequest / Composer / AiClient，完整校验后通过 rerollStory 与 saveDraft 乐观锁原子替换正文草稿。`storyStream.ts` 仅投影明确落入正文块的临时文本，不执行任何命令。

M4-P2 的 `variableStage.ts` 复用同一 runtime 和 SaveRepository，先显式创建执行尝试，再装配九域适用规则、校验并保存变量候选。`stageGuard.ts` 从正文提取共用锁、取消与尝试身份，正文、变量和世界不能在同页同时覆盖同一存档。

正文失败/取消保留旧文。变量重跑明确废弃旧候选及世界依赖，保留正文；网络失败只保存安全失败元数据，取消/迟到不强行回写。三个阶段都不创建新回合、不修改正式 GameState。详见根目录 M4-P1-DEVELOPMENT.md 和 M4-P2-DEVELOPMENT.md。

M4-P3 的 `worldStage.ts` 复用上述 Runtime/StageGuard。重读正文与变量候选、校验来源/权限/时间，在同一正式基线整批模拟，只通过 saveDraft 保存 world（无变量时 preview）。重新补算世界保持正文及合法变量；取消、跨标签页更新或旧回包无法覆盖新草稿。详见根目录 M4-P3-DEVELOPMENT.md。

M4-P4 的 `turnCoordinator.ts` 冻结配置、凭证及排序，预检查全部待执行路由，按顺序调用三个原阶段；恢复时跳过已经合法完成的上游。StageGuard 会话所有权防止嵌套锁冲突，Web Locks 排斥其他标签的自动工作流，IDB CAS 保持最终版本保护。明确瞬时服务错误最多自动重试一次，变量失败不继续世界。协调器本身只生成候选。详见根目录 M4-P4-DEVELOPMENT.md。

M4-P5 的 `SaveRepository.commitTurn` 在玩家发送下一步行动时取得同一会话和浏览器锁，在单个 IDB 事务内重读、重验、整批结算，并保存正式状态、提交回执及绑定行动的 regular 草稿。纯结算见 `domain/turnCommit.ts`，正式边界重验见 `services/validation/turnCommit.ts`。事务完成后 UI 同步更新正式状态和草稿，再把返回的新草稿传给原协调器；重复回执不重新请求 AI。刷新使用 `loadGame` 一致读取两者，不自动付费生成。详见根目录 M4-P5-DEVELOPMENT.md。

M5-P1 在同一 `settleTurn` 结果中建立公开短期摘要，随原正式事务保存，不新增记忆数据库或工作流阶段。正文 Composer 使用当前 Settings 的最近 N 回合完整正文，再通过 `domain/memories/history.ts` 从永久 journal 有界召回相关旧史。`publicMemory.ts` 统一公开摘要和旧档只读投影；查阅或搜索不调用 AI。详见根目录 M5-P1-DEVELOPMENT.md。

M5-P2 的 `memoryMaintenance.ts` 是三阶段之外的独立维护任务，复用真实 memory 资源和 AiClient。独立 Web Lock 覆盖选批、模型请求及保存，网络不占 IDB 事务或游戏锁；SaveRepository 在一次事务重读最新状态，仅合并已核验记忆批次，不推进正式 revision 或使草稿失效。新正式提交可按玩家默认关闭的 opt-in 非阻断触发一批，刷新不运行。详见根目录 M5-P2-DEVELOPMENT.md。

M5-P3 继续复用 `memoryMaintenance.ts`，单次NPC任务仅处理一个人物的一批原始记忆；`domain/memories/npcMemory.ts` 按稳定身份、原始记忆ID及认知/可见性分组验证来源，SaveRepository只追加总结，不删除原文或推进正式revision。NPC自动维护未启用，公开自动偏好不授权NPC收费；私有知识仅在内部按ownerNpcId分区。详见根目录M5-P3-DEVELOPMENT.md。

M5-P4 不增加执行器或付费阶段。普通 Story Context 调用纯函数 `domain/timePreflight.ts` 构造时间窗口和已知条件候选，Runtime 校验既有变量规划中的实际停止时间；变量解析及原正式提交边界再验时钟。最新产品规则在正式提交处强制开局/普通正向耗时（由变量AI估算，无正文时间词门槛），仅有效的他人纯过去视角声明可只读零耗时。Roll、恢复、取消、版本和原子性继续使用上述执行器与仓库机制。隐藏事件不因预检公开。详见根目录 M5-P4-DEVELOPMENT.md。
