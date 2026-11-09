# 世界事件 V2 第二批：固定阶段调度、结算与自然承接

## 基线和范围

远端 main `ba661d7eb59a87cd353d686edb48ddd7a9444f9d`（合并 PR #86），分支 `feat/world-event-stages-v2`。本批接入现有 World 一次请求，不新增数组、模型阶段、收费重试、Story 思考步骤、人物/组织/事件 UI 或历史 UI。

## 时间和执行边界

| 类型 | 时间 | 调度与结果 |
| --- | --- | --- |
| main | startAt / estimatedEndAt | 估期只供 AI 参考；超过估期不强制结案、延期或重写日期 |
| sub | startAt / fixedEndAt | 未到期不例行改写；到期/积压进入必须判定集合；正常实际结案时间等于原 fixedEndAt |
| 无 eventKind 的旧 V6 | 原字段 | 保留 estimatedEndAt、合理延期及旧入场语义，不自动分类 |

固定阶段的结果仍由 World AI 决定：resolved 对应 success/failure/changed，cancelled 对应 cancelled。程序要求实际时间、非空 resolutionText 和 outcome；保留已有 resultKnowledge 分类及 sourceTurnIds，绝不将 reported/suspected 自动升级为事实。没有剧情关键词、可信度评分或 prerequisites/blockers 许可。

固定时间不可改写，需要继续则新 ID、新固定范围。新建且已经开始的 sub 若声明 protagonist，复用既有入场机制在本次排队；下一轮 Story 可以在 fixedEndAt 前实际介入，不必等到阶段结束才进入。仅合法 Story 回执和 Variables 现场投影可以提前结束阶段；领域写入检查现有程序维护的入场回执，World 自己不得提前结案。World 对合法 Variables 已结束的 sub 不得再 SaveEvent，允许在成果完整且引用安全时直接退役该结果。

V2 的 sceneState 权限增加一个精确的既有授权来源：正式阶段已有 entry，且本次所选 Story 回执在合法 Variables 投影中处理了同一个 entryId。此时允许远程通话等实际介入改变阶段结果，不要求后台参与者因此全部物理在场；不扩展 NPC/主角命令权限、规划字段或无回执纯场外事件。原 readonly 元数据与固定字段检查仍逐项执行，模型不能自行填写 handledTurnId 获得权限。

`validateStageWrite` 在整批命令执行后检查写入（使用最终时钟，不依赖时钟命令数组位置）。`validateStageSettlement` 在 World 候选最终投影和领域 settleTurn 两个边界检查已知到期阶段必须终结。Variables 时钟模拟允许先越过节点，不能在那里提前要求 World 已完成；正式结算仍必须通过完整三阶段验证。纯历史回顾跳过当前世界调度和结算，旧行为不变。

## 长时间窗口与并行

EVENT_SCHEDULE 按 fixedEndAt 或旧预计时间统一排序，sub 即使 pending/presented 也不会从到期集合消失。main 不进入强制到期集合。不同组织、NPC 可拥有相互重叠的阶段，没有名额或区间互斥规则。

同一 World 输出中每个 ID 仅一个最终对象，可以新建并直接保存已经结束的多个连续阶段。orderWorldCommands 继续只用明确 predecessorEventIds/实体身份/任务交接排序；不从叙事条件猜测因果。sub 的 continuation=world 要求存在真实、明确 ID 引用的后继，可以连接已结案后继，也允许后台阶段与待入场互动并存、不同主事件之间依法引用前序，以适应一个窗口内的多轮发展；没有后续必要使用 end，不强迫续篇。旧事件 continuation=world 的真实非终态后继规则不变。

例如 1 月至 4 月的跳跃，可以同时保存 1 月 3 日失败的阶段、1 月 7 日成功的后继、2 月完成的调查和 5 月才结束的在行阶段。各结案仍使用各自 fixedEndAt，不伪装成 4 月 1 日全部同时结束。新建且本窗口已到期的阶段不能保存为 active 来漏过判定。

## 唯一成果与安全清理

没有新摘要表，也不把子事件摘要再复制进主事件存档字段。完整记录在 events；DeleteEvent 同事务将 V2 终态转换到 retiredEvents.detail 并删除 events 原对象：一个 ID 始终只有一份正式事件记录。沿用原 detail 字段，保存标题、实际起止、参与者、位置、visibility/impact、resolutionText、outcome、resultKnowledge 与原主角知情快照；根部保留 eventKind、parentEventId、startAt、fixedEndAt、来源、任务及前序引用。

`stageResults` 从存续或退役的子事件生成只读聚合，按实际结案时间排序，数组和分类对象复制避免调用方修改正式对象。World 的 EVENT_STAGE_RESULTS 使用这个聚合；其他三阶段完整正式读取范围没有缩减。聚合仅存在于请求上下文，不构成第二份可编辑真值。

V2 的明确任务、历史、前序和父子引用可以解析退休身份，因此不再永久阻止紧凑化。main 尚有非终态子事件时保守保留完整主事件；主事件可以先结案而不要求子事件成功，待必要完整上下文不再需要时紧凑退役。父引用可指向已退役 main，前序验证使用保留的实际 resolvedAt，不用退休时间冒充实际结案时间。所有记录仍参与联合防环和真实引用校验。

无法证明只靠紧凑成果足够的知识/规划字符串引用仍保守保留完整对象，不自动重写记忆。旧 V6 清理规则不变。PR #86 已有不完整历史阶段可以继续读取，但不能补造缺失成果或有损清理；新阶段必须提供完整结案结果。

## 固定阶段与 pending/presented 的冲突处理

到期不允许把 pending/presented 当作无限延期许可，也不能为完成调度而替玩家同意、拒绝或离开。

World 保存阶段结局，同时显式给出一个无 eventKind 的后继互动事件：predecessorEventIds 指向阶段，continuation=protagonist，entry 的 channel/cue/locationId 与原入场一致。程序验证唯一承接目标、拒绝伪造元数据，将旧阶段 entry 标为 invalidated（含义是职责迁移），将原 pending/presented 状态原样转到后继，形成新的 `(eventId, entryId)` 身份。entryId 采用本次合法投影 revision 的短 ID，按事件 ID 定位，沿用现有按 eventId+entryId 校验回执的约定，不拼接可能超长的模型 ID。

这不生成额外模型请求、不替主角做选择、不广播 NPC 私人知识。旧阶段可在同批紧凑退役；终态 sub 如果仍声明 protagonist，也必须有实际后继互动，不能留下永远不会再调度的空计划。后继保留未处理入场/正在参与的信息，下一次玩家行动的 Story 仍用现有 eventInteraction 回执处理。对尚未呈现的 pending，若阶段结束且不再声明 protagonist 后继，可直接使原安排失效；不限制为 cancelled，不迫使 AI 更改成功/失败/变化等剧情结局。这不代表玩家拒绝，也不强造后继。已呈现的参与需要保留合法的后续互动或由 Story/Variables 实际处理。

移交前后都复核程序元数据。两个邀请不能合并进一个承接目标；未提供必要后继会整批拒绝。没有加入文学内容审查或第四阶段。

## Prompt 与兼容

修改实际加载的 shared/03_time_events.md、shared/08_world_output.md、opening/world.md、regular/world.md 和 commandCatalog。明确三类时间、连续阶段、并行、摘要、清理及入场移交。Manifest 刷新四模块字符数/hash；sources.lock 追加 worldEventStagesV2，保留历次来源。实际 composePrompt 的 opening/regular 请求检查新契约及 EVENT_STAGE_RESULTS。

不增加 GameState/IndexedDB 版本、命令种类或顶层 World 数组。旧未分类事件、旧缺规划记录、合法旧候选仍读取。旧客户端虽然可能认识第一批字段，但其引用校验可能不允许父事件退役，不能保证读取第二批形成的事件家族；应统一升级客户端并保留原始备份，不能剥离字段降级写回。没有迁移或操作真实玩家存档。

历史仍使用原 RecordHistory。主事件同轮结案/退休后可依据其实际 startAt 形成重大纪事，resolvedAt 只作结束详情。World 自行从阶段摘要整理主要经过，不复制所有子事件对象。普通史料与历史时间精度/展示没有重构。

## 修改路径

- domain/events/scenePermission.ts：仅对已有入场且有本轮合法 Story 回执的 V2 阶段确认实际介入权限；无回执场外事件仍受保护。
- domain/events/stages.ts：阶段写入、最终结算、成果及只读聚合。
- domain/events/schedule.ts：三类调度。
- domain/events/lifecycle.ts、state.ts：结果保留、可解析退休父子/前序、保守清理。
- domain/commands.ts、turnCommit.ts：领域写入与正式结算再次验证。
- services/validation/stageEntryHandoff.ts、worldOutput.ts、worldEventContinuation.ts：候选、连续后继、入场规范化及角色权限边界。
- services/validation/worldDiagnostics.ts：安全的阶段错误类型。
- prompts/context.ts：只读 EVENT_STAGE_RESULTS；commandCatalog.ts、四个 Prompt 及元数据同步实际协议。
- event-stages-v2.test.ts、fixtures/eventStages.ts、event-hierarchy-v2.test.ts、prompts.test.ts 和 e2e/event-stages-v2.spec.ts：领域、候选、真实 Runtime、Repository 与浏览器回归。

## 执行记录

全部使用合成数据、Mock 网络和 fake-indexeddb，不调用付费模型。不同批次分别记录，不相加冒充最终验收：

- 第一批旧回归首次 82 项中 77 通过、5 失败：旧测试断言 sub 不调度、禁止清理、可缺结案结果，与第二批契约冲突。更新对应断言，仍保留引用环、非法时间、事务失败等反例。
- 新阶段用例首次 16 项中 11 通过、5 失败；第二轮 14/16。发现普通 NPC 没有 activeGoals 时引用保留检查读取 undefined、场景夹具改变了 Variables 不可写的 continuation、候选版本未递增及 Prompt 尚未同步。修复运行代码或夹具后再验证。
- 真实纯历史用例最初沿用含 visibleHooks 的普通 World 夹具，正确触发历史只读保护；改为空 hooks，而非放宽规则。
- 直接相关 6 文件：151/151。首轮完整 Vitest：2815/2815。
- 补充真实 WorldStage、主事件重大纪事、取消 pending 与防重复结案之后，新文件 20/20。
- 浏览器首次：desktop/mobile 共 3 通过、1 失败；失败 Trace 有页面额外导航/重新加载，且当时仍有开发文件变动。代码冻结后独立复跑，不将该批算作通过。Trace 已保留。
- 第一轮冻结后的完整 Vitest：2818/2818；相关 Chromium 六文件 64/64（desktop 32、mobile 32），无失败/跳过。
- 进一步自查补充真实“新阶段排队 → 下一轮 Story → 文本 Variables 提前结案”用例，修复前 1 失败（其余 20 项因 -t 未运行），暴露阶段虽支持预置 entry 却未在真实新建路径排队的问题。补上开始时排队及合法回执的 sceneState 介入权限后，相关两文件 47/47、三类新浏览器场景 6/6（desktop 3、mobile 3）。无回执的纯组织场外阶段仍拒绝；真实调用顺序为首次恢复仅 World，下一轮 Story/Variables/World，没有额外请求。
- TypeScript 实现阶段发现普通 NPC 的 activeGoals 类型、测试命令缺 protagonistId、来源元数据类型守卫及 DeleteEvent 测试 helper 类型问题；已修正类型与夹具，不放宽 Schema。Lint 曾捕获临时诊断包装未保留 cause，已删除临时包装。
- 最终增补还检查“终态 sub 声明 protagonist 必须有实际后继”，防止无法再次排队的终态计划被静默丢弃。
- 提前入场及终态 protagonist 后继验证后的完整 Vitest：2820/2820，101 文件；六文件 Chromium 66/66（desktop 33、mobile 33，266.7 秒），无失败/跳过/flaky。该批先于最后“未呈现邀请不应迫使改变结局”的收尾修复。
- 最后四结局回归修复前：success/failure/changed 3 项失败、cancelled 1 项通过（其余 21 项由 -t 未运行），证明只允许取消会不必要地限制 AI 结局。改为按未呈现状态和结构化后继意图处理，结果不影响能否自然结束邀请。
- 收尾邀请修复后的完整 Vitest：2823/2823，101 文件，0 失败、0 跳过；阶段专用新文件 25 项。
- 收尾邀请修复后的直接 Chromium：8/8，desktop 4、mobile 4，47.3 秒，0 失败/跳过/flaky。 覆盖积压结算清理、失败恢复、真实下一轮提前介入、成功阶段无后继的未呈现邀请失效。没有把 66 与 8 相加冒充一批。
- 最后补充后台阶段与待入场互动并存的真实 parseWorld 用例，修复前 1 失败（25 项由 -t 未运行）；移除不必要的同父/全体后继类型限制，仅保留显式后继及既有父 ID、时间、引用、防环约束。
- **交付代码完整 Vitest：2824/2824，101 文件，0 失败、0 跳过；阶段专用新文件 26 项。**
- **交付代码直接 Chromium：8/8，desktop 4、mobile 4，34.6 秒，0 失败、0 跳过、0 flaky。** 与上述完整 Vitest 对应同一份运行代码；没有将历史批次相加。
- Prompt 检查 93/93，TypeScript、Lint、生产构建、git diff --check 通过，构建仅有既存 chunk 大于 500 kB 提醒。

工程命令：`npm test -- --reporter=json --outputFile=/workspace/stages-final-delivery.json`；`npm run prompts:check`；`npm run typecheck`；`npm run lint`；`npm run build`；`git diff --check`。

较大浏览器批次：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/event-stages-v2.spec.ts e2e/event-entry-feedback.spec.ts e2e/world-handoff.spec.ts e2e/event-lifecycle.spec.ts e2e/turn-undo.spec.ts e2e/history-timeline-v2.spec.ts --project=desktop --project=mobile --reporter=json`。

最后直接浏览器批次：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/event-stages-v2.spec.ts --project=desktop --project=mobile --reporter=json`。

日志和 JSON 报告位于 `/workspace/stages-*.log`、`/workspace/stages-*.json`，首次浏览器失败 Trace 位于 `/workspace/stages-browser-first-failure/trace.zip`。未调用任何真实付费模型，不修改真实玩家存档。

## 剩余边界与成本

程序能确定性要求**正式状态已知**的到期阶段全部处理，并拒绝本窗口内新建但未结算的过期阶段。它无法在不增加语义审查的前提下证明模型是否遗漏了尚未创建的、仅存在于可能剧情中的阶段。Story 文字中已提及但 Variables 尚未落账的事实也不会被关键词核对；程序保护结构化投影和写入权限，文学一致性仍由模型遵守 Story 优先原则。Prompt 要求模型坦诚报告无法容纳的窗口，不假装处理完所有发展；输出截断仍走既有失败路径。缺少已知到期结果时整批拒绝，不自动收费修复。玩家可缩短行动/窗口后手动恢复，程序不自动增加请求。

一个正常 World 请求可能容纳不了极长时间和大量阶段；没有自动分批 AI 调用。阶段原文不被程序自动压缩，retiredEvents.detail 和完整撤回快照仍占存储及上下文；紧凑化减少背景、目标、条件和入场计划等字段，不能声称摘要零成本。EVENT_STAGE_RESULTS 是额外的只读请求表示，也占输入量。

不明确的知识/规划引用会保守阻止清理，尚未实现通用引用重写。提前进入复用已有 entry 和 Story eventInteraction 回执；本批仅在新建且已经开始的 sub 上即时排队，不新增既存未来阶段的 startAt 队列或第三批 Story 主动入场规划步骤。单纯 invalidated 旧邀请不作为已实际入场的提前结案依据。

待呈现互动仍沿用旧事件机制等待玩家，区别是固定阶段本身已经正式结束，不再占用 sub 的到期例外。真实模型能否准确估期、判断剧情结果和选择自然承接未通过付费模型验收；Mock 只证明请求、数据协议和事务行为。
