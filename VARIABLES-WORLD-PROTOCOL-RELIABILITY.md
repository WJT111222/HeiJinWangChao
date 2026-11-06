# Variables / World 协议一致性与时间诊断修复

## 基线与证据边界

- 开发基线：`origin/main@458901b807b453b94ad28edffa42950f799667f8`（PR #67 已合并）。
- 独立分支：`codex/variables-world-protocol-reliability`。
- 用户确认的错误形态：Variables 的 `knownInformation` 混入存档字段、缺少 `knowledgeKind`；World 的 `timelineCandidates` 为对象数组；`significant` 事件不满足重大归档条件；新组织的 `relationHistory` 非空。
- 本次没有拿到两份 Variables 原文、一份 World 原文、日志原件或对应正式存档。用户明确说明不能保证原文和日志属于同一次生成。因此本报告中的样例均为依据上述形态构造的中性 Mock，**不是用户原始响应的脱敏副本，也不与日志 ID 4/7/10/13/17 强行配对**。
- **真实 `invalid_time` 尚未确诊**。本轮改进可确定的程序失败分支的诊断，并测试同类冲突；没有证据断言用户当时是哪一条命令失败。

## 已确认的协议问题与修复

| 问题 | 既有数据规则与复现结果 | 本轮处理 |
| --- | --- | --- |
| `knownInformation` 格式混用 | 存档条目为 `{text,source,learnedAt}`；文本 `push` 要求 `{text,knowledgeKind,knowledgeSource,visibility}`。混用会在 `npc[id].knownInformation.knowledgeKind` 被拒绝。 | 共享 Variables 文本输出模块和实时 `TEXT_COMMAND_CATALOG` 明确四个必填字段、枚举、只读存档格式与完整例子。即使本次没有选择 NPC 变量组，也会收到这一说明。 |
| `timelineCandidates` 对象数组 | `WorldResultSchema` 要求 ID 字符串数组，`[{eventId,...}]` 在 `timelineCandidates.0` 失败。 | 共享 World 输出模块明确七个数组的形状；运行时目录从真实 Schema 生成 `timelineCandidates`、`visibleHooks`、`unresolved` 字段结构。 |
| 非重大事件申请归档 | 即使已结束，`impact=significant` 也不符合 `major` 归档规则。 | 明确 ID 必须引用投影中 `major`、`resolved/cancelled` 且有 `resolvedAt` 的事件；无符合项填 `[]`。不让程序提升重要性或删除非法候选来伪装成功。 |
| 新组织带历史 | 原 World 创建约束要求 `relationHistory=[]`，但旧运行时命令目录展示了没有该限制的组织存档 Schema。 | 仅在 World 的请求目录投影里加入 `maxItems:0`；Prompt 明确关系变化使用独立 `RecordOrgRelation`，可引用同批新建组织。原拒绝分支增加 `organization_initialization` 诊断。 |

同时补查并同步了另外两项容易混淆的**既有**规则：`futureEvents` 是同批新建 `scheduled` 事件对象的完整镜像，不是 ID 数组；World 创建 `gang` 不填 `funds`，创建 `business` 不填 `assetsEstimate/liquidityEstimate`（也不填 `null`）。仅使请求目录符合已存在的规则，没有增加新的拒绝条件。

实际请求仍经 `composePrompt()` → 共享模块 + 所选变量组 + 实时命令目录。测试直接检查开局/普通回合组装结果，不仅检查磁盘上的 Markdown。只更新两个共享 Prompt、对应版本和 Manifest 内容哈希；不改 Story 文风、模型参数、输出上限或组选择策略。

### 修正示例

以下原形会失败，不能静默猜填认知性质：

```text
push npc[scene].knownInformation = {"text":"收到值班安排","source":"同事通知","learnedAt":"2026-10-18T08:00:00+08:00"}
```

模型应明确选择认知性质并按已有文本协议输出：

```text
<thinking>记录本轮知晓信息。</thinking>
<说明>记录同事告知的值班安排。</说明>
<命令>
push npc[scene].knownInformation = {"text":"收到值班安排","knowledgeKind":"reported","knowledgeSource":"同事通知","visibility":"npc_private"}
</命令>
```

程序仍仅给指定 NPC 记录个人记忆及其知晓信息，不复制给其他 NPC。同一条不应再重复 `push memories`。

World 没有符合归档条件的事件时使用 `"timelineCandidates":[]`；有合格重大终态事件时使用 `"timelineCandidates":["event_major_closed"]`，不能提交对象。组织初始 `relationHistory:[]`，如确有关系变化另发 `RecordOrgRelation`；不删除其他必要字段。

## 时间诊断的真实执行链

```text
模型文本 → 三标签/命令解析 → 编译（已有的时钟优先规范化）
       → preparedVariableCommands（已有开局系统时钟/事件回执）
       → commitCommands 在副本上整批模拟
          ├─ 单条 apply 失败：记录实际领域命令位置 → commandId 对应编译 origins
          │                 → 原始文本命令序号、类型、固定规则
          └─ 最终整批约束失败：仅报告整批规则和相关命令，不伪造失败序号
       → 保存合法候选 → World 读取投影 → 正式 Commit 重新验证并原子写入
```

`CommandDataError` 是内存异常上的位置元数据，不是领域命令、Schema 字段或持久化协议。仍执行原来的同一次整批模拟；没有拆成多个可部分成功的事务，也没有改变 `apply`、时间判断、命令顺序、资金校验或最终状态校验。

可定位的固定诊断包括：

| 规则 | 对应既有拒绝条件 |
| --- | --- |
| `clock_reversed` | 时钟早于执行该命令时的游戏时间 |
| `npc_interaction_time` | NPC 互动晚于执行时钟，或早于该 NPC 上次互动 |
| `income_received_future` | 实际到账晚于执行时钟 |
| `opening_income_past` | 初始预期收入日期早于候选时钟 |
| `opening_clock_conflict` | 模型文本时钟与 Story 已确定的开局 `endAt` 不同 |
| `opening_time_unavailable` | 开局结构化时间尚未合法确立 |
| `event_time_order` / `event_result_before_end` / `event_predecessor_time` | 既有事件日期顺序、未结束时提前填结果、前序终止时间约束 |
| `state_time_range` / `task_result_future` / `event_result_future` / `task_handoff_time` | 最终整批状态中的日期区间、成果或交接时间约束 |

日志保留已有安全过滤；仅输出固定规则、白名单字段/命令类型及序号，不复制失败值、原异常消息或供应商响应。NPC ID 仍只有 `scene_transition` / `scene_location` 可以携带。原文继续只在既有临时模型响应面板查看。

同一 NPC 的互动时间两种违规仍对应原领域代码 `NPC_TIME`，提示如实列出这两个条件；不会猜测其中哪一个。遇到多个整批规则仍使用 `multiple_domain_rules`，未识别的时间分支仍保留安全兜底诊断。`timelineCandidates.0` 中的 `0` 是数组项下标，不再被标成“第 1 条命令”。

### 排查中排除的一种猜测

文本执行器在本轮之前就会优先应用本批 `SetWorldClock`，因此“互动命令写在时钟前面”本身不会造成这里的时间失败。初写的一条测试错误预期它会失败，检查真实编译顺序后已纠正测试；**没有修改执行顺序，也不将该猜测作为用户故障原因**。新增测试证明：合法重排继续通过；超出最终时钟的互动指向原文本位置；系统开局时钟不会挤错文本序号。

## 复现与验证

开发前先运行新增测试：初版 13 项中 3 项通过、10 项失败。三个已通过用例证明现有非法格式/权限规则确实拒绝相应形态，格式修正后可通过；失败项暴露请求说明缺失和诊断信息缺失，其中一项为上文已纠正的测试假设。没有把这次红灯数等同于 10 个产品漏洞。

最终新增 20 项 Vitest：`protocol-reliability.test.ts` 16 项、`live-text-turn.test.ts` 4 项。新增 2 个浏览器场景，desktop/mobile 各执行一次，共 4 项。原测试与安全断言保留。

新增覆盖：混用记忆格式、时间线对象、非重大归档、新组织非空历史；实际 Composer；时钟倒退、未来互动/到账、互动倒序、开局时钟冲突、初始预期收入过期及整批日期倒置；原文本定位；真实 `runStageRequest`/`TurnCoordinator`/fake-indexeddb 中失败保留 Story、只补失败阶段、World 投影、Commit、重载、精确重放；浏览器安全诊断、完整原文、自动结算、刷新不重发。

模型响应全部 Mock，没有调用真实付费模型。四个集成案例每例共 4 次 Mock 请求（含一次明确恢复）；浏览器连续修正三个错误的案例共 6 次 Mock 请求，没有隐式修复请求。

| 验证 | 本轮实际结果 |
| --- | --- |
| 初次定向：协议 + 文本 Prompt | 70/70 通过 |
| 定向：协议、真实回合、执行器、源码移植、自动结算诊断 | 195/195 通过（补充三个边界测试之前） |
| 最终协议专项 | 16/16 通过 |
| `npm run check`（Lint、全部 Vitest、TypeScript、生产构建） | 最终批次待记录 |
| `npm run prompts:check` | 3 文件，82/82 通过 |
| Chromium `automatic-settlement.spec.ts` | desktop 8/8，mobile 8/8；共 16 通过，0 失败/跳过 |
| Chromium Variables / World / 协调器 / 连续回合 / 开局生活 | 执行中，完成后记录 |
| `git diff --check` | 通过；提交前复查 |

浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/automatic-settlement.spec.ts --project=desktop --project=mobile
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/variable-runtime.spec.ts e2e/world-runtime.spec.ts e2e/turn-coordinator.spec.ts e2e/continuous-turns.spec.ts e2e/opening-life.spec.ts --project=desktop --project=mobile
```

这些是受影响范围的浏览器回归，不冒称完整仓库浏览器套件已运行。构建现有主包大小警告如出现不等同于构建失败，不在本轮改造分包。

## 修改文件

- 请求契约：`prompts/shared/07_command_output.md`、`08_world_output.md`、`prompts/manifest.json`、`src/executors/variableText/catalog.ts`、`src/services/validation/commandCatalog.ts`。
- 诊断：`src/domain/common.ts`、`commands.ts`；`src/executors/variableText/aggregateDiagnostics.ts`、`diagnostics.ts`、`compile.ts`、`index.ts`；`src/services/validation/aiOutputs.ts`、`variableDiagnostics.ts`、`worldDiagnostics.ts`、`worldOutput.ts`；`src/services/ai/errors.ts`；`src/ui/game/RuntimeLogPanel.tsx`。
- 测试：`src/tests/protocol-reliability.test.ts`、`src/tests/live-text-turn.test.ts`、`e2e/automatic-settlement.spec.ts`。
- 本报告：`VARIABLES-WORLD-PROTOCOL-RELIABILITY.md`。

## 保持的边界与尚未解决部分

- 没有新增/放宽 GameState、DomainCommand、TurnDraft、World 输出 Schema；旧存档和候选格式不变，无迁移。没有删除原有引用、归属、资金、角色知识隔离、事件生命周期、CAS、幂等、回滚或正式 Commit 校验。
- 没有加入语义审查、关键词事实判断、额外凭据审批或 JSON/Text 猜测修复。模型原始非法输出仍整批失败；正确的示例经真实解析、模拟及事务链成功。
- 不改模型路由、重试策略、调用数量或付费授权。共享说明增加少量输入文本，按供应商规则可能略增单次输入 Token；没有新增付费请求。
- **原始 `invalid_time` 两条日志仍需各自对应的正式存档、草稿与完整响应才能精确复现**。不得混配不同尝试。本次不能宣称用户那一次开局已成功结算。
- 未测试真实模型遵循新说明的成功率。实际中转站输出/截断/上下文限制仍需用户后续授权验证；本轮只验证本地 Mock 与正式业务链。
- 不修改真实玩家存档，不主动部署生产环境，不自动合并。新建 Draft PR 等待审查。
