# 世界事件 V2 第一批：主子事件数据基础

基线：远端 main `4e5057653e6b7c2d12205e155b85c3a2823ae38e`（已合并 PR #85）。工作分支 `feat/world-event-hierarchy-v2`。本批只建立数据身份、时间语义与正式引用；不增加模型请求、语义审批、UI 或到期结算策略。

## 协议

所有记录继续使用 `GameState.events` 和 `SaveEvent`，没有第二套真值、派生子事件列表或新表。

| 字段 | 主事件 | 小事件 | 旧 V6 事件 |
| --- | --- | --- | --- |
| eventKind | `main` | `sub` | 缺省，不推断类别 |
| startAt | 整体开始时间 | 确定开始时间 | 保留原值 |
| estimatedEndAt | AI 预计结束时间，可在非终态更新 | 禁止填写，不作固定时间别名 | 沿用旧协议；旧档缺规划读取仍兼容 |
| fixedEndAt | 禁止填写 | 必填，合法 ISO 时间且不早于 startAt；建立后不可改写 | 禁止孤立填写 |
| parentEventId | 禁止填写 | 必填，指向当前正式事件表中 eventKind=main 的真实 ID | 禁止孤立填写 |

主事件及小事件新建均沿用背景、目标、参与者、状态等完整规划字段。参与者复用 actorRefs（主角/NPC/组织），按原有真实 ID、权限和归属规则验证；不同小事件可以有不同人物或势力，并不要求参与者与主事件列表相同。小事件 startAt 不早于父事件 startAt；不按父事件的**预计**结束时间限制子事件范围。

身份建立后 eventKind、parentEventId、startAt 和 fixedEndAt 不可改写；旧事件不会被隐式升级为主事件或小事件。主事件的 estimatedEndAt 可按已有非终态规则更新，不改变子事件固定时间。

同一父事件可有多项并行、重叠的小事件，不按数量或时间区间拒绝，不推断顺序。只有显式 predecessorEventIds 才要求合法已结束前序及实际结案时间不晚于后继开始。父归属边与前序边一起检查环，防止“主事件依赖自己的子事件”等组合环。自然语言 prerequisites/blockers 始终只是背景，不参与这些判断。

status/resolvedAt/outcome/resolutionText/resultKnowledge 及原终态、角色认知、入场回执规则保持原义。本批不新增固定结束时间的自动结案、延期、结果摘要、父事件自动聚合或父子状态联动规则；也不要求小事件一定在固定时刻成功。

## 写入、读取与清理

- `events/schema.ts` 增加三个可选字段；新规划 WorldEventSchema 区分旧协议、main、sub 三种合法形状。StoredWorldEventSchema 保持可扩展严格对象，完整 GameState 和领域写入通过 validateEventLinks 再校验类别/字段组合、引用和时间。
- `events/lifecycle.ts` 维护不可变身份、最终批次父引用、父/前序联合无环验证。父事件仍被存续或已清理子事件引用时不得删除；没有新增自动清理政策。
- 在正式阶段摘要持久化机制完成前，DeleteEvent 禁止清理任何 eventKind=sub 的终态记录，返回现有 EVENT_RETAINED。完整子事件是唯一权威阶段成果，包含 resolvedAt/outcome/resolutionText/resultKnowledge；不能仅保留轻量身份而丢失结果。旧 V6 事件的原清理行为及主事件的引用保护不变。RetiredEventSchema 中已有身份字段保留用于读取，不借此允许新的有损清理。
- `state.ts` 补充父 ID、固定时间的字段定位；`worldDiagnostics.ts` 仅增加安全路径白名单字段名，避免诊断输出不受控实体键。
- `worldOutput.ts` 的非终态候选准入原先只接受未来 estimatedEndAt。最小适配为 sub 检查其 fixedEndAt，其他事件仍按原预计时间规则；不改正式 due 队列、主角行动授权或结果判定。未结束且固定时间已过的子事件不能伪装成未来候选，本批未实现如何自动召回它们结案。
- `schedule.ts` 仅令 unplannedLegacy 辅助诊断排除有明确类别的新记录。due 筛选、顺序、处理和正式时间窗口不变，仍不扫描 fixedEndAt。新小事件不会通过复制预计时间来偷偷接入旧调度。

## V6、候选与撤回兼容

没有增加 GameState 顶层字段、数据库版本或存档版本，没有迁移旧字段。旧 V6 事件、缺规划旧记录及合法旧候选均不补默认分类、不重写时间或所有权。新旧记录可以同批存在。

新增字段会由既有候选 Schema、DomainCommand、projectTurn、commitCommands 和原子 Commit 原样保留。结构和跨表引用在最终合法投影验证，父事件与子事件同批创建时可先给出子事件，顺序不影响结果。非法引用或写入失败全回滚。

撤回继续使用 PR #83 的完整状态快照，新字段随正式状态一起进入快照和恢复，没有额外历史真值或特殊撤回分支。测试覆盖 Commit 重放、后续回合、撤回恢复与 IndexedDB 重读。

**旧客户端风险：** 可选字段只保证新客户端读取旧 V6 数据。旧版本采用 strict Schema，会拒绝带新字段的 V6 存档/候选/撤回快照，不能声称旧客户端可读取新数据。不得手工剥离字段后降级写回；应使用更新后的客户端并保留原始导出。新旧客户端混用的发布兼容问题仍需部署前统一处理，本批不做有损迁移、Schema 降级或兼容旁路。

## 修改文件

- src/domain/events/schema.ts：可选身份字段、新规划形状、退役轻量身份字段。
- src/domain/events/lifecycle.ts：身份、引用、时间、环与必要清理保护。
- src/domain/state.ts：父引用和固定时间的状态完整性检查。
- src/domain/events/schedule.ts：只修正缺规划旧档诊断分类。
- src/services/validation/worldOutput.ts：接纳固定结束时间的候选结构，不改正式调度。
- src/services/validation/worldDiagnostics.ts：安全字段路径白名单。
- src/tests/event-hierarchy-v2.test.ts：新协议与真实 Repository 集成回归。
- docs/WORLD_EVENT_LIFECYCLE.md、本报告：现行边界与第二批交接。

## 验证

全部使用合成状态、fake-indexeddb 和本地 Mock，无真实付费模型请求或真实玩家存档操作。

- 初始已有生命周期/Prompt 定向：56/56。
- 新用例首轮：20 通过、1 失败；集成夹具的旧事件预计时间已经过期，且候选回合 ID 与 Repository 草稿不一致。修正夹具，不放宽规则。临时诊断抛错写法触发 Lint 的 preserve-caught-error，随后删除临时包装。
- 修正后直接回归：4 文件 100/100。
- 完整首轮：2794 通过、1 失败、0 跳过。失败为旧事件缺少 estimatedEndAt 的字段诊断因联合 Schema 变成对象级；新增 plannedEventSchema 按声明类型选择校验分支，保持联合 JSON 契约同时恢复原字段定位，未修改原反例断言。
- 诊断与新数据协议定向复测：2 文件，31/31。
- 最终完整 Vitest：2795 通过、0 失败、0 跳过，100 文件（新文件 23 项）。
- Prompt 检查：93/93；TypeScript、Lint、生产构建、git diff --check 均通过。构建保留原有大于 500 kB chunk 提醒。
- 未运行 Chromium：本批没有 UI、请求执行顺序或浏览器交互改动；真实 Repository/fake-indexeddb 覆盖持久化、写入失败、提交重放及完整快照撤回。所有批次独立记录，不合并成绩。

执行命令：`npx vitest run src/tests/event-hierarchy-v2.test.ts src/tests/event-lifecycle-runtime.test.ts src/tests/world-narrative-conditions.test.ts src/tests/turn-undo.test.ts`；`npx vitest run src/tests/automatic-settlement-diagnostics.test.ts src/tests/event-hierarchy-v2.test.ts`；`npm test -- --reporter=json --outputFile=/workspace/event-hierarchy-full-final.json`；`npm run prompts:check`；`npm run typecheck`；`npm run lint`；`npm run build`；`git diff --check`。

第二批仍需设计 fixedEndAt 的到期读取、结果结案/摘要、延期如何承接、主事件估期的聚合与事件族清理策略；当前不应宣称 V2 自动调度已实现。World 命令目录由真实 Schema 生成，三种形状会增加目录体量；未新增模型调用，也未做真实模型输出质量验收。

本批没有改写 World 创作 Prompt 来要求 AI 自动组织主子结构。正式提示词仍指导默认旧事件规划；新字段由命令目录的真实 Schema 暴露，本地构造的合法候选可执行，但不能据此宣称真实模型已能稳定生成 V2 主子事件（尤其不应同时生成两个结束时间）。下一批正式启用 V2 生成时，必须同步 World Prompt、固定时间调度及其调用方，而不是只依赖数据字段。


## PR #86 合并前返修：子事件结案成果保留

复核实际远端 HEAD 为 `5b3c3751809aeb8fe062935cc817417837094f99`。审查确认旧 DeleteEvent 路径只保存轻量身份而丢失实际成果。本轮选择临时禁止 sub 清理：在 `deleteEvent()` 的终态检查后、任何状态修改前，以现有 `EVENT_RETAINED` 拒绝。没有建立新的摘要表、复制结果或新增 AI 调用，也不检查剧情措辞。主事件的必要引用保护保持原样，旧 V6 无引用终态和无子引用主事件仍可按原规则清理。

测试覆盖 resolved/cancelled 子事件完整成果不丢失、父事件仍受保护、正式输入状态不变、旧事件及无引用主事件正常清理。另通过真实 Repository + fake-indexeddb 同批先推进时钟再尝试 DeleteEvent，验证失败后正式状态、草稿和回执均不改变。

第二批必须完成两个交付目标：

1. 子事件结案的实际时间、经过、结果、已确认认知分类及来源，必须在唯一权威的阶段摘要机制中稳定持久化，并能由主事件读取。只有在验证摘要完整且无必要引用丢失后，才可以原子保存摘要并清理完整子事件；不能把两个可独立修改的对象当作互相冲突的结果真值。
2. 主事件最终归档后，整个事件家族必须有合法清理路径，明确转移/保留必要父子、前序、历史、任务和知识来源引用，避免永久引用锁；清理、Commit、撤回与重载必须保持一致。本轮仅保护成果，不提前设计或实现这套完整归档摘要系统。

已被旧实现清理且没有备份的成果不能由本补丁恢复，不从退役时间或轻量身份编造结案信息。本次没有操作真实玩家存档。

本轮独立验证记录：补丁前新增测试为 23 通过、3 失败（26 项），确认已结案、取消及 Repository 同批清理风险。补丁后相关回归 5 文件共 133/133 通过，0 失败、0 跳过（本文件 26 项）；TypeScript、Lint、生产构建及 git diff --check 均通过。构建仅有已有 chunk 大于 500 kB 提醒。不复用上一轮成绩，也未重复运行无关完整 Vitest 或 Chromium。

本轮命令：`npx vitest run src/tests/event-hierarchy-v2.test.ts src/tests/event-lifecycle-runtime.test.ts src/tests/world-event-handoff.test.ts src/tests/turn-undo.test.ts src/tests/world-data-boundary.test.ts`；`npm run typecheck`；`npm run lint`；`npm run build`；`git diff --check`。
