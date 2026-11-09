# World 自然语言条件门槛修复

## 基线与范围

2026-11-09 从远端最新 `main@80c44e79e675c1648c5247197fa2b088fa01db7f` 创建 `fix/world-narrative-conditions`。基线已包含 PR #84。本轮修复任务／事件的自然语言条件越权判定，不改 V6 Schema、事件生命周期协议、正式事务或模型请求策略。

## 根因与修改

`prerequisites`、`blockers` 原本由 `StringsSchema` 接收自然语言说明，但后续代码将每个字符串解释成任务／事件 ID，再要求其完成。这使“工坊值班员暂未到场”之类正常背景无法解析为已结束实体，进而拒绝 active 事件、成功任务及主角入场安排。

| 位置 | 旧行为 | 本轮处理 |
| --- | --- | --- |
| `src/services/validation/worldOutput.ts` | `readyConditions()` 对旧、新任务和事件说明逐项要求 `conditionEnded()` | 删除 SaveTask、SaveEvent 的文字条件门槛和帮助函数 |
| `src/services/validation/worldEventContinuation.ts` | 到期入场须全部文字条件解除 | 删除该门槛；仍由程序生成 pending，原入场、拒绝、退出等回执权限不变 |
| `src/services/validation/worldDependencies.ts` | 把说明字符串猜作实体 ID，排序或拒绝循环 | 只使用明确的结构化依赖字段；说明即使长得像 `task:id` 也不执行 |
| `src/services/validation/turnCommit.ts` | Variables 已合法结案后，提交重验再次按文字条件抛 `WORK_BLOCKED` | 删除同源条件审批；候选重验、现场权限、时钟和终态边界保留 |
| `src/domain/timePreflight.ts` | 同源检查隐藏公开时间候选；关联任务的 blocked/cancelled 等状态也被当作许可 | 删除文字门槛及关联任务执行状态门槛。仍只是条件候选，不完成任务、不替玩家接受邀请；原时间、场景、知情快照及重复中断保护保留 |
| `src/domain/events/schedule.ts` | `conditionEnded()` 将字符串解析为已结束实体 | 删除已无用途的函数；到期事件调度本身不改 |
| `prompts/shared/08_world_output.md`、`src/services/validation/commandCatalog.ts` | 要求成功前完成所有结构化前提 | 明确说明数组是叙事背景，World 可保留阻碍并推进、结案或延期，无需清空或强制 blocked |
| `prompts/manifest.json`、`prompts/sources.lock.json` | 旧内容哈希 | 刷新实际加载模块的字符数和内容哈希；追加来源记录，保留历史哈希 |

`linkedTaskIds` 只是归属关联，不是事件启动前提；关联任务晚于事件开始也不代表时间倒置（合成场景即先讨论、后离场取件）。因此时间预检不再读取关联任务的 blocked/cancelled、开始先后或文字条件来批准候选。任务自身时间、事件自身时间、真正的前序与交接时间仍独立校验。

同步修改 `src/tests/prompts.test.ts` 验证新增来源哈希。通过真实 `composePrompt()` 检查开局和普通回合最终请求，确保共享模块和生成的命令目录没有互相矛盾的旧要求。

## 明确保留的边界

- `linkedTaskIds`／`linkedEventId` 的真实引用与双向补全不变。
- `predecessorEventIds` 是明确的前序事件引用，仍要求有效终态、实际时间有序且无环。
- `handoff.fromTaskId` 仍要求有实际成果的已结束任务和合法交接时间。这与自然语言阻碍不同。
- 未知实体、非法地点、未来实际结果、非法状态转换、终态改写仍拒绝。
- World 的现场 NPC／初始同伴保护、主角不可直接操作、角色知情快照、入场回执不可伪造仍有效。
- `completionCondition` 仍是已有任务／事件的描述字段，本次没有删除或改写其数据契约，也没有把它变成新的执行审查。
- 模拟通过的候选仍须在正式提交时重新验证；CAS、幂等、原子提交、撤回快照和历史时间轴均未改动。

已搜索运行代码中的同源调用，`readyConditions`、`conditionEnded`、`WORK_BLOCKED` 的执行路径已移除。`worldDiagnostics.ts` 中旧 `completion_conditions` 标签仅保留为历史诊断识别，已无生产校验调用。`events/lifecycle.ts` 对旧 ID 字符串的保守引用保留检查未删除：它只防止清理后丢失引用，不批准或阻止事件推进、成功、失败或入场。记忆召回仍可读取条件文字作为背景。

## 合成复现与真实链路

新增 `src/tests/fixtures/worldConditions.ts`，复用 PR #72 已脱敏的虚构展览筹备状态，不保存玩家人物、地点或会话原文。结构对应：某 NPC 经 Variables 合法离场取材料，后台任务 blocked；现场讨论事件 active，双方保留自然语言前提与阻碍，单侧任务／事件关联由原规则补全。

新增 `src/tests/world-narrative-conditions.test.ts`，覆盖：

- 任务 active／completed／失败／取消；事件 active／blocked／成功／失败／变化／取消；保留旧阻碍并延期。
- 条件文字含 ID 样式或互相提及，不被当作可执行依赖；真实无效关联独立拒绝。
- 到期入场只生成 pending，伪造已处理回执继续拒绝。
- 实体、地点、时间、现场权限、expectedRevision 反例。
- Variables 现场结案 → World → Commit，不在最后一步重新审查阻碍。
- 真实 Runtime／WorldStage → 候选保存 → IndexedDB 写入失败整批回滚 → 手动提交重试 → 重载 → 幂等回执；模型仅一次 Mock 请求。

调整既有 `world-data-boundary`、`world-event-handoff`、`event-handoff-composition`、`time-preflight`、`event-lifecycle-runtime`、`world-handoff`、`world-lifecycle`、`world-validation` 测试中的旧审批断言。保留并区分真正的非法结果字段、未来结案、前序事件时间、现场权限、入场伪造及事务失败反例，没有跳过或删除安全约束来换取通过。

新增 `e2e/world-narrative-conditions.spec.ts`：真实 React + IndexedDB，直接恢复已完成的 Story／Variables，合法 World 自动结算；无效人物引用失败时原存档不变，上游候选保留，刷新无自动请求，玩家重试只调用 World。结算后阻碍原文仍存在，刷新不重复结算。既有 `e2e/event-entry-feedback.spec.ts` 加入未解除的自然语言阻碍，继续检验下一幕入场、拒绝回写和失败恢复。

## 验证记录

各批次单独记录，不相加冒充一次完整验收。全部使用 Mock／fake-indexeddb／本地 Chromium，未调用真实付费模型。

代码提交：`80fe9a4e506402421267766bfa97354edc489f35`（之后只追加本报告）。日志、JSON 报告和必要截图保存在独立结果目录 `/workspace/world-narrative-conditions-results/`，不写入正式存档。

| 批次 | 通过 | 失败 | 跳过 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 初始新测试，修复前 | 9 | 15 | 0 | 24 项；其中普通回合 Prompt 用例的模式夹具有误，随后修正 |
| 单独 Commit 门槛复现，修复前 | 0 | 1 | 24 | 使用 `-t` 只运行新增 Commit 用例；确认真实 `WORK_BLOCKED`，其余未运行 |
| 夹具纠正及 Commit 用例补齐后，修复前 | 9 | 16 | 0 | 25 项；World 条件、Commit、时间候选与 Prompt 旧契约均被复现 |
| 新测试，修复后 | 25 | 0 | 0 | 同一合成状态，不清空阻碍 |
| 6 个直接受影响文件，首轮 | 169 | 1 | 0 | 唯一失败仍断言“阻碍未满足不得成功”；更新为本次正式语义 |
| 同 6 文件最终定向 | 170 | 0 | 0 | 引用、时间、权限、回执和事务安全反例仍通过 |
| 完整 Vitest 首轮 | 2765 | 4 | 0 | 4 项旧审批断言：world-handoff 1、world-lifecycle 1、world-validation 2 |
| 上述 3 文件定向复测 | 119 | 0 | 0 | 分离文本条件正例与结构、时间、终态、目标身份不可改写反例 |
| **最终完整 Vitest** | **2770** | **0** | **0** | 99 个测试文件；新增独立正例导致总数比首轮增加 1，不拼接成绩 |
| 提示词检查 | 91 | 0 | 0 | 3 文件，包括来源哈希和真实组装内容 |
| 新浏览器文件首次启动 | 0 | — | 0 | 测试收集失败，0 项执行：Node 直接导入 JSON 缺少 import attribute；改为在浏览器经真实 Vite 加载夹具 |
| 新浏览器文件复测 | 4 | 0 | 0 | desktop 2、mobile 2；29.1 秒 |
| **最终受影响 Chromium 批次** | **112** | **0** | **0** | **desktop 56、mobile 56；9 文件；441.3 秒；无 flaky、无自动重试** |

TypeScript、Lint（0 警告）、生产构建、`git diff --check` 已通过。构建保留现有大于 500 kB 的 chunk 提醒，未为此改动无关打包架构。

最终受影响 Chromium 在代码提交 `80fe9a4e506402421267766bfa97354edc489f35` 上执行。最终追加的提交只包含本报告，生产代码与测试文件不再变动。完整 Vitest、浏览器、Prompt 等是独立批次，未将定向成绩拼接到完整批次中。

执行命令：

```sh
# 新用例复现及修复后复测
npx vitest run src/tests/world-narrative-conditions.test.ts
# 6 文件直接回归
npx vitest run src/tests/world-narrative-conditions.test.ts src/tests/world-data-boundary.test.ts src/tests/world-event-handoff.test.ts src/tests/event-handoff-composition.test.ts src/tests/time-preflight.test.ts src/tests/event-lifecycle-runtime.test.ts
# 全量发现旧审批断言后的定向验证
npx vitest run src/tests/world-handoff.test.ts src/tests/world-lifecycle.test.ts src/tests/world-validation.test.ts
# 最终完整批次保存 JSON 报告
npm test -- --reporter=json --outputFile=/workspace/world-narrative-conditions-results/full-vitest-final.json
npm run prompts:check
npm run typecheck
npm run lint
npm run build
git diff --check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/world-narrative-conditions.spec.ts e2e/world-runtime.spec.ts e2e/world-handoff.spec.ts e2e/event-lifecycle.spec.ts e2e/event-entry-feedback.spec.ts e2e/time-preflight.spec.ts e2e/variable-runtime.spec.ts e2e/turn-undo.spec.ts e2e/history-timeline-v2.spec.ts --project=desktop --project=mobile --reporter=json
```

未运行无关的全部 Chromium 文件；上述选择包含直接受影响的 World、Variables、时间预检、事件入场、撤回和历史读取。完整 Diff 已逐项自查：生产修改只有删除文字门槛、去除失效函数／参数、同步实际契约；没有修改存储、V6 或正式生命周期结构。

## 限制与风险

模型仍可能提出不符合实体、时间、状态、权限规则的结果，这些错误会被独立拒绝；本修复不承诺接受所有 World 输出。仅验证合成状态和离线链路，没有原玩家正式存档，因此不声称重放了某次真实游戏的全部状态。

自然语言条件不再是程序许可；旧数据若曾用这些字符串充当隐式调度依赖，也会采用本轮语义。需要强结构关系时应使用已有的关联、前序事件和任务交接字段，而非重新引入条件审批。World 对叙事因果与结局的判断质量未做真实模型验收。

无新模型调用、无自动收费重试、无存档迁移；不修改真实玩家数据，不合并或部署。

## PR #85 复审返修：常驻时间事件提示词

复核远端 PR 与七代目 Review `5826795311`，审核及实际分支 HEAD 均为 `b06eccbd6e23e2b332d422a472d04fe5e04c3523`。本轮仅修改常驻提示词、对应元数据、Prompt 测试和本报告，没有改动 `worldOutput.ts`、`turnCommit.ts`、`timePreflight.ts` 或其他生产执行逻辑。

`shared/03_time_events.md` 的旧“条件可用”改为：程序按合法时间范围、事件状态、主角已有知晓范围、实际触达关系筛选 TIME_PREFLIGHT 条件候选；不是已发生事件。prerequisites、blockers 仅是叙事背景，不因文字阻碍或关联任务 blocked/cancelled 取消其他条件合法的候选。Story AI 判断实际发生和中断；程序不代玩家接受邀请、不自动结案或推进。第五节与该句同源的“已有事件 ID 是否完成”也就地改为“不把关联任务完成与否当作事件发生的许可”，避免同一模块内部矛盾。

旧“只有重大且合理获知的结果进入历史”改为：普通 RecordHistory 可独立记录有意义往事、人物陈述、历史披露和世界变化，无需事件结案、重大等级或主角预先知晓。reported/suspected 不自动升级为已确认事实；可选 chronicle 重大性由 World AI 决定，世界重大事件实际结束后归档，主角重大事实实际发生时记录；历史不自动传播人物知识，不恢复 ArchiveEvent、阈值或历史审批。

Manifest 仅更新该模块字符数（2997 → 3408）与 SHA-256（`a5b718ec3f1d895ab77b2fdbb7a9cd07f51b075175fea80606112841adc46f36`）；sources.lock 追加 `worldNarrativeConditions`，原来源哈希及历次记录全部保留。原有来源测试已覆盖该记录类型，无需修改其校验逻辑。

`src/tests/prompt-runtime.test.ts` 新增 2 项参数化测试，实际调用 composePrompt 共 6 次，覆盖 opening/regular × story/variables/world 的最终 messages，检查新边界存在、旧条件许可和旧历史审批不存在，并检查正式输入状态未被修改。这也对照最终加载的共享 World 输出模块与 COMMAND_CATALOG，未发现本轮目标规则互相矛盾。

本轮验证（与上轮批次独立记录）：

- 初次单文件测试在 Manifest 尚未刷新时：13 通过、23 失败、0 跳过，均为资源 SHA 不匹配导致加载被拒绝。完成要求的元数据同步后重新验证，未放宽加载器校验。
- `npm run prompts:check`：93 通过、0 失败、0 跳过。
- `npm test -- --reporter=json --outputFile=/workspace/world-narrative-conditions-results/review-full-vitest.json`：2772 通过、0 失败、0 跳过，99 文件；含本轮新增 2 项，不与上一轮成绩相加。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check`：均通过；构建仅保留现有 chunk 大于 500 kB 提醒。
- 自查最终 Diff：5 文件，无生产逻辑变更。

本轮不运行 Chromium，未修改 UI 或执行逻辑；遵守本次指定的工程检查范围。全部网络模型测试使用 Mock，无真实付费请求。模型对提示词的真实理解仍待独立授权验收；此前失败响应的免费重用入口属于 Review 标明的独立事项，本轮没有开发或宣称解决。保持原 Draft PR，不合并、不部署、不修改玩家存档。
