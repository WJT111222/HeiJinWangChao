# Issue #193 · 动态世界候选稳定性和恢复

## 基线与合流范围

开发基线为 `main@089723c2e1e0aa608afe9820a87b1f6a36ef385b`，包含 PR #195。本轮复用 #195 的任务身份原值、顿号旁空格、全角数字和同一时刻比较规则。Issue 评论所报告的排版差异已由 #195 处理，本轮使用合成数据复现其他路径。

开工时 #191 已关闭且未合并。当前 main 的 World 没有 Tool Call 路由。#192（`a03f4b24`）的世界书改动与本轮文件无交集。#198（`01f30ef6`）与本轮都涉及 `worldOutput.ts`、`worldDiagnostics.ts` 和 `GameScreen.tsx`。这三处以相同 main 为基线的逐文件三方试合均成功。试合只验证文本，后续实际合流仍应运行 #194 的新版收悉、旧档恢复和本轮事件、诊断及双端恢复用例。两个 PR 的事件入场协议与业务代码各自留在原分支。 [Issue #193](https://github.com/WJT111222/HeiJinWangChao/issues/193) · [PR #191](https://github.com/WJT111222/HeiJinWangChao/pull/191) · [PR #192](https://github.com/WJT111222/HeiJinWangChao/pull/192) · [PR #198](https://github.com/WJT111222/HeiJinWangChao/pull/198)

## 候选失败路径审计

| 路径 | 分类与对应处理 |
| --- | --- |
| 已有任务，同一稳定 ID，只有 #195 支持的目标或完成条件排版差异，或同一开始时刻的表示差异 | **可安全归一化**，继续沿用正式字段。现有 `task_immutable` 和旧候选重验覆盖继续通过。 |
| 已有任务改变目标、行动者、开始时刻、完成条件或终态成果，用新 ID 复建正式任务 | **必须拒绝**。沿用 `task_immutable`、`actor_permission`、`task_state` 和 `task_duplicate`。续办应根据真实职责选用原任务更新或合法交接。 |
| 同批两个新任务，除任务 ID 外完整任务对象相同 | **必须拒绝**，原始命令位置归为 `task_duplicate`。程序无法决定下游引用应该指向哪个 ID。目标相同但截止时间、范围或其他事实不同的对象不会被合并。 |
| 任务开始太早或太晚、非法状态回退、缺成果或交接，任务和事件反向引用冲突 | **必须拒绝**，复用 `task_state`、`event_time`、`task_event_link`、`task_event_reference` 和 `task_plan`。交接诊断定位 `task.handoff.fromTaskId` / `task.handoff.at`。合规的活动推进、阻碍保留、结案和后续任务继续成立。 |
| `SaveEvent` 完整复述正式已结束事件 | **可安全归一化**，本次新增。整个事件与已有正式记录和合法 Variables 投影都完全一致，且不存在开放的主角入场时，从候选删除这条复述。 |
| 事件真实变更，包含改写时间、终态成果、无效前序、未结案前序、不同 ID 复制已有事件或未完成必要到期事项 | **必须拒绝**。复用 `event_immutable`、`event_transition`、`event_time`、`event_reference`、`entity_id` 与到期规则。到期业务有合法新成果时照常结案。 |
| 入场仍等待处理、World 承接歧义或 Story 缺收悉 | **依赖合法的上游事实或承接**。现行入场拒绝和程序生成的入场元数据保持。相关的新收悉与旧档恢复属于 #198。 |
| 组织、NPC、记忆、历史、地点 | **按现有权限和引用检查**。#186 既有现场写入冲突处理仍先验证原候选。组织重名与 NPC 字段缺权限得到更精确位置。不同 NPC／组织、记忆性质、历史记录、地点层级没有可泛化的等价证明，保留原规则。正式命令目录已解释应复用稳定 ID、保留来源及避免重复返回终态，可继续从提示词和有效上下文研究高频样本。 |
| JSON/Schema 失败或单条写入导致整批无效 | **玩家主动恢复**。有合法上游时复用它们，只补跑 World。现有公开诊断使用规则、序号和安全路径。跨记录状态错误若无法唯一归因，维持批级诊断。 |
| 语义近似、翻译后的目标、时区书写不同的事件时间、候选输出部分有效 | **目前无法安全归一化**。保留正式时间和真值边界，完整候选与正式提交仍采用同一套校验。 |

## 实际根因与改动

终态子事件的结构化复述原先一律触发终态拒绝。旧式或主事件如果复述保留原来源，会缺少当前回合来源。给复述补当前来源又会实质改变终态记录。处理发生在严格 Schema、原始命令分组、命令 ID、效果重复、任务／事件单写检查之后，且在实际事件调度、承接和领域投影之前。只要正式事件、Variables 投影或候选有一个字段不同，即按正常写入执行完整校验。候选过滤没有改写任何事件字段，不给复述新增命令收据。其他保留命令和必须到期事件仍执行完整投影、提交前重验与原子 Commit，并维持拒绝时零正式写入。 [World 验证](../src/services/validation/worldOutput.ts) · [领域命令](../src/domain/commands.ts) · [提交前验证](../src/services/validation/turnCommit.ts)

诊断使用原始分组位置和扁平命令序号，即使之前移除了无变化事件。命令 ID、分组、效果重复、同一实体多次更新使用 `command_structure`。同批等价新任务用 `task_duplicate`，终态改写报告实际差异字段，事件前序缺失使用 `event_reference`，固定结案时刻报 `event_time`，NPC 或组织权限问题报告已知字段。公开日志保留规则名、命令类型、序号和安全路径，不包含实体 ID、候选正文、密钥或世界秘密。终态复述的处理说明仅进现有临时候选检查器，使用命令位置和固定文本。 [诊断规则](../src/services/validation/worldDiagnostics.ts) · [原始位置映射](../src/services/validation/worldProjectionDiagnostics.ts) · [运行日志](../src/ui/game/runtimeLog.ts)

正文、变量和世界职责按原流程执行。Story 唯一判断角色的叙事认知，Variables 应用已成立的事实，World 可以读取完整的世界投影、独立运转场外业务。现有参与、现场权限、理解信息与采取玩家行动的区别没有增加新的认知门槛。沿用现有 World Composer、命令目录和 JSON 解析链，提示词及 Manifest、来源锁无文件差异。World 的普通 JSON、兼容 SSE 与原生 JSON 响应经过相同 `parseWorld`。当前没有 World Tool Call 可供端到端验证，之后若接入该适配方式，工具参数也应送经同一解析和结算链。 [请求运行时](../src/services/ai/runtime.ts) · [Composer](../src/prompts/composer.ts) · [命令目录](../src/services/validation/commandCatalog.ts)

## 仅补跑 World 的真实恢复

原有 `TurnCoordinator` 已能重新读取正式存档与同一份草稿，在 Web Locks 下复验已 ready 的正文和已 validated 的变量，再只请求缺失的 World。界面改动是给现有「继续未完成阶段」及行动区加明确说明，展示本次只重试动态世界、保留上游内容以及重发可能收费。只在正式版本有效、阶段设置未变化、上游齐全且当前 Story 有 World 失败时显示。刷新后沿用持久失败摘要，取消后可再次由玩家主动补跑。发生版本冲突需重新读档，另一标签持锁时先等当前操作完成。成功后的保存仍通过已有提交前重验、CAS 和幂等回执。 [界面](../src/ui/game/GameScreen.tsx) · [请求协调](../src/workflows/turnCoordinator.ts) · [动态世界阶段](../src/workflows/worldStage.ts) · [候选结算](../src/workflows/automaticTurn.ts)

双端 Mock 对照中，普通回合首次执行依次发出 Story、Variables、World。重复新任务只拒绝候选，合法的同行组织命令也没有写入正式存档。刷新没有请求，之后两次主动操作各发一条 World；首条由玩家取消，第二条完成结算。双击与第二个标签均未生成额外请求。最终 Journal 只增加一条，已选正文保持完全相同。绑定输入和变量候选在失败、取消、刷新时保持原值。 [浏览器用例](../e2e/automatic-settlement.spec.ts)

## 自动修复与费用评估

**方案 A · 带候选和安全诊断做一次结构修复。** 同一世界投影与规范仍需要发送，确认失败的原候选只能作为数据，修正版需完整重验。相对全新重抽，模型有机会就地修正一个字段并保留其他内容，也可能固守原错误、携带被拒绝的身份，或改写合法世界结果。历史消息、角色与流式输出边界都需要针对不同服务和中转站验证。若适配 Tool Call，也要坚持结束边界、结构完整，修复不能从部分工具片段推定成功。

**方案 B · 重新生成完整 World。** 正常再次提交当前 World 请求，用原 Story、原 Variables 与正式投影。每次只新增 World 的输入与输出成本。新的模型采样可以改变世界结果，也可能再次生成重复对象或不可变字段漂移。当前玩家可手动选择此路径，失败时不会产生部分正式写入。

两种方案都要依靠稳定的回合／候选版本和原子保存。以实际 Composer 生成本库两组非玩家夹具（`worldState()+worldDraft()`，以及 `teahouse()`），用 `contextStatistics` 估计；A 以同一消息追加合成候选 JSON 和一条只含规则、路径、命令类型的修复请求。

| 合成请求 | B 的输入估算和序列化消息字节 | A 的输入估算和序列化消息字节 |
| --- | --- | --- |
| 最小夹具 | 52,187 token / 139,229 B | 52,360 token / 139,765 B |
| 多命令茶楼夹具 | 52,509 token / 140,730 B | 53,654 token / 144,328 B |

这是 Unicode 启发式估算，未包含新输出和协议开销。真实计费还取决于服务方 tokenizer、缓存前缀命中、输出和推理。采用自动修复会多一次独立的模型请求。本轮保持玩家主动触发路径，沿用协调器原有 HTTP 500/502/503/504 瞬态策略；`invalid_output` 不进入自动重试。未来可单独提供可关闭、明确显示可能费用与次数的选择。 [本地估算实现](../src/prompts/statistics.ts)

## World Temperature

`newChannel()` 默认没有 temperature。实际请求经 `resolveModelRoute()` 解析到渠道，对应设置位于「设置 → AI 连接 → 渠道 → Temperature」。跟随正文时使用正文渠道；World 选独立渠道时使用该渠道自己的值。同一渠道上的不同阶段共享这个参数。OpenAI 兼容 Mock 确认未设置时省略，显式 `0` 和 `0.35` 原样发出；协议不兼容及针对模型记住的参数兼容设置继续生效。当前不存在强制 `0.9` 或独立于渠道的 World 温度默认值。如果未来需要一个阶段专用覆盖，最小方案是在现有 World 路由上加可选 temperature，只在用户显式配置时参与请求快照，兼容能力仍在出站协议层决定。本次未改变默认值或参数传递。Mock 无法证明真实模型成功率变化。 [默认渠道](../src/services/ai/configuration.ts) · [路由快照](../src/services/ai/snapshot.ts) · [协议参数](../src/services/ai/protocols.ts) · [设置入口](../src/ui/settings/AiConnections.tsx)

## 回归和已知限制

验证环境为 Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。仓库锁文件、真实 React 和正式 Repository，所有供应商请求均为 Mock。

| 运行批次 | 通过 / 失败 / 跳过 | 退出码 |
| --- | --- | --- |
| 干净 main 逻辑加专项复现 | 3 / 5 / 0，精确终态复述、重复任务或原诊断未满足预期 | 1 |
| `npm ci` | 143 个依赖安装完成 | 0 |
| Node 24 `npm run check` 首个完整绿批次 | 187 文件，4436 / 0 / 0，含文件名、ESLint、命令目录、TypeScript 和生产构建 | 0 |
| World、事件、工作流、Commit、Undo 定向 Vitest | 28 文件，637 / 0 / 0 | 0 |
| `npm run prompts:check` | 93 / 0 / 0 | 0 |
| 双端 Chromium 定向大组 | 12 / 0 / 0，桌面、手机各 6 项 | 0 |
| 确认手机抽屉可见费用提示后，双端 #193 恢复复测 | 2 / 0 / 0，桌面、手机各 1 项 | 0 |
| 工作树和暂存区 `git diff --check` | 通过 | 0 |

定向大组运行 `npx playwright test e2e/automatic-settlement.spec.ts e2e/event-stages-v2.spec.ts`，使用 `--grep` 选择 #193、#190 错误分组和已有固定阶段控制组。最后两条浏览器复测用 `--grep '#193'`，证明费用说明在实际抽屉中可见。各批次独立计数。没有已知旧浏览器用例在该范围内失败。首次新增浏览器组的 2 个失败来自测试引用不存在的 Journal 字段，两端均已当时完成了保存。复测按正式 `journal[].story` 和 `turnId` 检查结算，按草稿检查行动与变量。第一次扩大 Vitest 为 634 通过、2 失败，两条旧断言仍期待整个命令路径。已分别加强到实际禁写字段 `changes.relationshipText` 和 `npc.affinityConfirmed`。最终定向回归同时保留这些情况的拒绝及脱敏。截屏复核发现手机抽屉隐藏桌面说明，因而将同一句提示接入现有手机费用区，新增真实可见断言并复测。最终 HEAD 的完整复验与 CI 证据在 PR 描述更新。

改动文件为 `src/services/validation/{worldOutput,worldDiagnostics}.ts`、`src/ui/game/{GameScreen,WorkflowPanel}.tsx`、`src/tests/{world-stability-193,world-npc-creation-contract,world-scene-write-safety}.test.ts`、`e2e/automatic-settlement.spec.ts` 和本报告。后续阶段沿用同一 Draft PR，最终固定提交及 CI 见 PR 描述。

尚未使用真实付费模型、真实玩家数据或真机。无法承诺生产模型的失效率变化或供应商重试费用。等价判定有意保守，剩余事件承接与通知语义仍依 #198 的审查结论。对无明确单条责任的批级错误保留通用诊断。公开 Beta 版本、生产存档、部署和公告未在本轮操作。
