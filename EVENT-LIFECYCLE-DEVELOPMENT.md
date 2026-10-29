# 动态世界事件生命周期

## 基线与审计

从 main@9d930cf6b2e5197149f6dc89634f478089228c27 创建 codex/world-event-lifecycle。
PR #49 当前 open/Draft、未合并；其“预计时间或完成条件满足其一”方案不采用，不 cherry-pick。

已审计总文档、V0.1 设计/技术计划、World/Variables/Story、领域命令、存档迁移、来源和时间线投影。
冲突：事件 estimatedEndAt 可选；全局 OR 校验使无关旧记录阻断 Variables；没有到期批次输入/处置检查；没有事件清理；时间线强依赖完整事件；resolved 默认成功，失败结案受旧成功分支阻挡；blocked 更新可能被自身未满足条件阻挡。
历史文档“预计结束时间或条件”由本次产品指令覆盖，Task 不同于 Event，不改变 Task 新写入的 dueAt 或 completionCondition 规则。

## 最小实施方案

- 明确新事件规划 Schema 与旧记录读取 Schema；新事件需要预计结束时间、背景、目标及参与者，条件不能替代时间。
- V5 增加轻量 retiredEvents。迁移只增加空表，不补日期/事实、不改 revision、journal 或 worldClock。
- 旧缺预计时间的事件仍可读取，单列待规划；新/重新规划写入需合理估计。新写入规则放领域命令边界，不以无关旧资料缺失拒绝现场更新。
- 基于正式→变量投影窗口创建内部到期队列，包含恢复后的积压，按时间及依赖处理，同一 World 请求。到期不是完成证明。合法结果可结束、失败、取消、延期/受阻或自然承接；未处理者不能被称为完成。
- DeleteEvent 清理终态完整记录，保留最小身份/终态/清理时间与必要引用；重要或有来源职责者保留紧凑成果材料。ArchiveEvent 只把已结束重大事件的合法公开内容归入时间线；内部秘密不会因归档自动变为他人知识。
- 后续事件可通过 predecessorEventIds 明确承接，不能成环或提前承接未发生结果，不强迫后继。
- 全部变化仍经候选、CAS、整批模拟及原子回合提交，关闭 World 不请求、不写入，失败/重 Roll 保留正式状态。

测试计划覆盖用户14类验收及旧档、知识隔离、经济、NPC、任务、失败回滚、跨标签、真实 Mock Runtime/Coordinator 和桌面/移动 Chromium。

以下记录实际实现、验证结果及仍存在的边界。

## 实际数据流与决策

1. Variables照常解析文本、编译领域命令、从同一正式revision内存投影。事件文本根创建入口改为有限的`set events[id].sceneState = {status,resolvedAt?,resolutionText?,outcome?,resultKnowledge?}`，只合并到已存在的现场事件；排程和参与者不允许覆盖，来源回合由程序追加。其他39个文本入口保留；不新增凭据、文学审查、coverage或候选封印。
2. World的真实Composer在原上下文中加入`EVENT_SCHEDULE{from,to,due,scenePending,unplannedLegacy,policy}`。due按预计时间排序，包括关闭/旧时钟造成的积压；真实命令处理再结合来源拓扑排序。同一次原有World模型请求处理，不增加分类、逐事件调用、重试或收费任务。
3. 已验证变量投影供World读取；World通过SaveEvent进行自主正常结束、失败/变化结束、取消或有因延期/受阻。到期处理不能只返回空结果宣称成功：每个可处理到期对象必须已经终结，或下一预计时间晚于本轮窗口。未满足条件可失败或继续阻碍，不能将到期当成功。futureEvents仅作新计划SaveEvent的相同镜像，不是第二个写入入口。
4. DeleteEvent和ArchiveEvent属于World的eventCommands；不向Variables授权。SaveEvent与清理具有不同依赖键，先验证结果再清理。原commandId幂等、StageGuard、请求版本、草稿CAS、取消和迟到响应机制原样复用。
5. projectTurn仍从同一正式基线模拟全部变量+世界命令。正式提交再次解析与验证世界候选，然后在原SaveRepository事务中原子保存状态、清理、时间线、journal、短期记忆、回执与下一草稿；没有新增第二个存储事务或IDB事务内网络等待。

### 为什么增加Schema V5

原timeline、linkedEventId、前序/知识来源均依赖完整events对象。直接删除会悬空；永久保留完整对象违背新设计。V5只增加retiredEvents（实体身份/终态/清理时间/必要来源和关系），有职责或重大结果才带紧凑detail；公开时另存publication。不同NPC仍不会因事件ID自动获得知识，event-result保持statement，隐藏事件继续worldEventOnly。重大隐藏成果清理后仍可在未来有独立公开依据的回合归档。

V1–V4迁移仅添加空表并升版本，不补日期、事实、条件或结果，不修改worldClock、revision、journal、NPC或经济。读取旧缺排程记录不报无关全局规划错误；新事件创建必需完整规划。旧缺项事件真实终结/取消可保留缺项，不为清理编造过去预计日期；继续/延期时由World合理重新规划。已保存旧World候选如含不完整新事件，仍可读取，但正式重验可能要求重新生成该World候选；不绕过新写入要求。

### 公开、历史和长时间行动

- 普通结束不强制归档、后继或永久完整记录；重大且已知才可时间线。取消若没有真实终止时间，不伪造时间线日期。
- 已知重大可继续timelineCandidates；ArchiveEvent允许为过去已清理的重大隐藏结果单独发布合法公开标题/摘要，不把原内部详情整体公开。
- 普通无引用清理后不再进入World完整事件上下文。任务、后继、时间线或记忆/知识来源仍需要的成果保留引用；最小身份防止复用ID。
- 时间预检可提示已开始公开事件的预计节点，但仍为conditional；实际可感知中断才停止长行动，不因预计完成而自动打断。隐藏/受阻/已终结记录不进入公开中断候选；已实际使用的同一节点在重载后不重复触发。后台到期队列只给World，长跨度窗口不静默跳过场外到期事项。
- 现场参与者由Variables实际事实处理，World不代主角/现场NPC行动。没有可感知依据的隐藏场外事件不会倒灌进已经生成的Story。

## 失败复现及测试调整依据

修复前先运行两个最小反例：新事件只有completionCondition没有estimatedEndAt被接受；旧无关事件/任务缺规划使合法emotionText更新模拟失败。两项均真实失败，记录在本次执行日志`/tmp/event-lifecycle-before.log`（环境临时文件，不含真实模型数据）。

保留全部1901项原工程用例，新增32项，共1933项：新规划、Task独立OR、延期/受阻/失败/取消、积压、多事件依赖、承接环、清理引用、隐藏重大未来公开、时间线与取消实际日期、V1–4读取、时间预检节点去重，以及真实Runtime→TurnCoordinator→World候选→原子Commit→重载→下一轮。

原用例更新仅适配明确产品变化：领域命令数量24→26；旧版本夹具显式去除V5新字段；需继续的事件提供未来预计时间/背景/目标；隐藏重大事件不再凭timelineCandidates提前发布；文本事件测试使用已有sceneState入口。没有删除经济、NPC认知、事务、取消、CAS或幂等断言。World运行时浏览器的计划事件夹具补足backgroundText/goalText。

## 本次验证记录

- 解析/Runtime/事件生命周期定向：48/48通过。
- `npm run prompts:check`：82/82通过；100项资源路径/正文/hash等静态约束保留。
- `npm run check`：52个文件、1933/1933通过；包含ESLint、TypeScript和Vite生产构建。Vite仅有既有大包体积建议，无构建错误。
- 完整Chromium初轮：300项中296通过、4失败；两项World夹具缺新字段，补齐后定向通过；两项记忆保存屏障用例在重启Vite后通过，记忆业务/用例均未修改。开发期间Vite HMR会使测试原型屏障不再对应原实例，不以该次结果冒充全绿。
- 失败用例桌面+移动定向重跑：4/4通过。
- 最终冻结代码后执行 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：300/300通过（桌面150、移动150，20.3分钟）；保留原294项，新增6项。本次最终运行退出码0，无失败、跳过或中断。开发期为补充边界回归曾主动中断运行，未计入通过结果。
- `git diff --check`：通过。
- 所有模型请求均为Mock；未调用真实付费模型，未操作正式玩家存档，未修改main、合并或主动部署。

## 已知限制与费用边界

- AI负责预计耗时、现实因果与结果分类。确定性校验不声称证明自然语言真实，也不增加AI裁判。真实模型遵循效果尚未经付费实测。
- 旧缺预计时间的活跃事件不会被程序自动补造为到期；World可合理重新规划，不能静默将历史计划认定成功。
- World单次输出仍受现有Token预算限制，大量积压可能需要玩家显式重试；本轮不增加逐事件收费或自动连环请求。由于候选整批验证，不能保存半批清理。
- 最小retiredEvents身份、永久journal与原有appliedCommands凭据继续增长；凭据内可能包含旧命令快照。本轮不重构幂等账本，普通事件不会继续堆积于完整活跃events表。
- 无独立公开依据的重大秘密保持内部；不实现角色迷雾、额外披露AI、后台财务操作或NPC任务成果重构。自由文本中的任意非规范引用不可能由程序完整识别，正式结构引用和已采用来源格式保持可追溯。
- PR #49仍是未合并Draft；本实现以独立分支替代其错误Event OR方向，没有关闭、合并或挪用该PR。

## 文件清单

- `EVENT-LIFECYCLE-DEVELOPMENT.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/README.md`
- `docs/WORLD_EVENT_LIFECYCLE.md`
- `e2e/event-lifecycle.spec.ts`
- `e2e/world-handoff.spec.ts`
- `e2e/world-runtime.spec.ts`
- `prompts/docs/ASSEMBLY.md`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/03_time_events.md`
- `prompts/shared/07_command_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `prompts/stages/opening/world.md`
- `prompts/stages/regular/world.md`
- `src/domain/commands.ts`
- `src/domain/drafts.ts`
- `src/domain/events/lifecycle.ts`
- `src/domain/events/schedule.ts`
- `src/domain/events/schema.ts`
- `src/domain/npc/lifecycle.ts`
- `src/domain/state.ts`
- `src/domain/timePreflight.ts`
- `src/domain/turnCommit.ts`
- `src/executors/variableText/aggregateDiagnostics.ts`
- `src/executors/variableText/catalog.ts`
- `src/executors/variableText/compile.ts`
- `src/executors/variableText/diagnostics.ts`
- `src/executors/variableText/entities.ts`
- `src/prompts/context.ts`
- `src/services/storage/migrations.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/turnCommit.ts`
- `src/services/validation/worldDependencies.ts`
- `src/services/validation/worldEvidence.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/domain.test.ts`
- `src/tests/event-lifecycle-runtime.test.ts`
- `src/tests/fixtures/game.ts`
- `src/tests/fixtures/variableReply.ts`
- `src/tests/live-text-turn.test.ts`
- `src/tests/npc-memory-review.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/opening-time.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/saveRepository.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/variable-commands.test.ts`
- `src/tests/world-handoff-review.test.ts`
- `src/tests/world-handoff-review2.test.ts`
- `src/tests/world-handoff-review3.test.ts`
- `src/tests/world-handoff.test.ts`
- `src/tests/world-validation.test.ts`
- `src/ui/panels/playerView.ts`

### 最后边界复核

新到期队列曾使纯过去视角（已有严格限定的只读模式）被迫处理当前积压事件。先新增真实parseWorld失败测试复现，再仅在此既有只读模式跳过到期消费，并给World明确readOnly上下文。积压原记录不删除，下一正常回合仍调度；不是普通World跳过到期的开关。新增一项回归，未新增Schema或请求。完整最终测试结果见以上验证记录。

另一项到期队列权限一致性回归确认：开局同伴即使离场仍受原World保护，不能因新队列而被强制场外结算。该节点单列scenePending，不扩大World权限；普通后续回合仍按原在场/场外规则判断。两次最后复核均先新增失败测试，再最小修补。

取消时间边界也先通过真实World+Archive回归复现：旧通用startAt≤resolvedAt会拒绝未来安排的提前取消。现仅cancelled允许实际终止早于原计划开始，但仍不得晚于正式候选时钟；resolved正常结束维持原顺序。清理后的紧凑记录使用同一规则，公开重大取消可按真实时刻归档，不伪造未来日期。

## 最终交付状态

基于main@9d930cf的独立分支codex/world-event-lifecycle；所有业务代码在最后完整浏览器验证期间保持不变，后续提交仅补录本报告。32项新增工程回归、6项新增E2E全部通过；未删除原有测试。`git diff --check origin/main...HEAD`与工作区diff检查均通过。

正式GameState在任何World候选、取消、失败、刷新或预览阶段均保持不变；仅现有正式回合事务能应用结果。没有真实付费API测试、合并或生产部署操作；PR预览由现有Cloudflare自动流程处理，不等同于生产发布。
