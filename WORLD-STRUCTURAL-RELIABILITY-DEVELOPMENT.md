# P0：World 结构关联、当回合离场与错误定位

## 基线与复现材料

- 基线：`main@abcd6e6b7584dec21cf8117d6b9871899e74ac28`（PR #71 已合并）。独立分支 `codex/world-structural-reliability`。
- 用户提供的完整茶楼 World JSON 保存于 `src/tests/fixtures/world-teahouse-original.json`，保留全部字段和值，仅整理 JSON 空白。文件 SHA-256：`e1268967db1893078e0458757e61d5ee38f37a4f50a6190e928f5bed55a7d669`。
- 样例包含 2 条 worldCommands、1 条 SaveTask、1 条 SaveEvent、1 条 visibleHook；没有 API Key、请求头或服务端认证信息。人物与组织为游戏记录；未接触正式玩家存档。
- **没有获得原始 GameState、Story 或 Variables 候选**。`fixtures/teahouse.ts` 明确构造测试上下文：15:30 的正式时钟、已存在的茶楼/老街/组织/两名现场 NPC；Variables 将时钟推进到 15:40，并合法将陈志远标记为离场。不能据此声称还原了用户那次完整存档。

## 修复前证据与根因

先在未改业务代码时执行 `npx vitest run src/tests/world-structural-reliability.test.ts`，5/5 失败：

| 复现 | 原行为 | 根因 |
| --- | --- | --- |
| 完整原始响应 + 合法离场 Variables | SaveTask 第 3 条 `actor_permission` | `actorAllowed` 仍无条件检查回合开始时的 `onScene` |
| 将测试正式状态设为已离场，隔离关系问题 | 空 fieldPath 的 `schema_fields / schema` | event 填 `linkedTaskIds`，task 未填 `linkedEventId`，最终 Schema 要求重复输入两侧 |
| 去掉事件，仅保留离场任务 | 仍拒绝 SaveTask | 与事件无关的旧现场权限阻断 |
| 不存在的父地点 | 根 Schema 错误，无命令和字段 | superRefine 没有提供结构路径，投影异常未映射回命令 |
| 重复地点 ID | `domain_state`，无命令序号 | CommandDataError 已有实际执行序号，但 World 丢掉了该信息 |

后三类失败为在样例上明确构造的定向反例，不宣称原始存档一定存在无效父地点或重复 ID。

## 1. 任务—事件关系确定性补全

在现有 `commitCommands` 的整批克隆状态上，所有命令应用后、最终 Schema 校验前运行 `completeTaskEventLinks`。该路径同时用于 Variables/World 投影和正式 Commit，无第二套保存机制。

- 模型可以填写 `task.linkedEventId` 或 `event.linkedTaskIds` 一侧；程序只补齐该明确 ID 边的反向字段。
- 两侧均提供时必须一致；一个任务不能属于多个事件。相互冲突、对象不存在、需要修改既有终态对象时整批拒绝。
- 可连接本批创建或已存在的活动对象；不创建缺失实体、不推断人物、事件结果、时间或新关系。
- 没有关系时保持无关系。单侧省略不能静默删除另一侧的既有关联；活动对象解除关系仍须提交两侧一致的最终状态。
- 正式 GameState 仍保留原有双向一致性 Schema；**没有把读取旧档变成自动修复**，没有 Schema 版本或迁移变更。
- 模型候选命令、原始 commandId、顺序和命令指纹保持不变；反向 ID 是同一事务内的结构派生。相同候选在模拟和提交中走相同补全过程；命令回执及回合回执继续防止重复执行。

例：茶楼原始 SaveEvent 中 `linkedTaskIds=["task_chen_fetch_credentials"]`，成功模拟及正式提交后，对应任务得到 `linkedEventId="event_jumingxuan_standoff"`。不要求模型重新生成整份响应。

## 2. 离场权限以合法 Variables 投影为准

复用 `projectTurn` 后的现场状态，通过 `worldNpcAllowed` 统一 World 权限与实际 Prompt 上下文：`PROTECTED_SCENE`、`OFFSCREEN_STATE`、`NPC_KNOWLEDGE`。

- NPC 回合开始在场、Variables 合法标记离场后，可由 World 启动后台任务、更新独立后台状态。
- 仍在场的 NPC、开局初始同伴继续受保护；World 不获得主角移动/交易/同意权限，不允许 NPC 入场、改写好感或主角互动字段。
- 对刚离场 NPC，World 不得重写本轮 Variables 已写入的 NPC 字段，避免同一现场更新被执行两次。其他独立后台字段仍可更新。
- 已退场 NPC 的终态任务继续提供给 World 作为承接历史；这不赋予已退场人物再次执行命令的权限。
- 每个 NPC 的知识仍按 owner 分组。未广播私人记忆，未修改 Story/Variables 协议或增加事实审批。

## 3. 可定位的安全诊断

`GameStateSchema.superRefine` 的相关原有条件增加结构路径和有限 `integrityRule`，不放宽条件。涵盖任务/事件关联、父地点/地点循环、参与者引用、实体身份、任务状态/结果/交接时间、事件时间/状态及历史引用。

`worldProjectionDiagnostics` 将最终状态字段映射回实际写入命令；命令执行错误使用现有 CommandDataError 序号，扣除 Variables 前缀。World 三个数组的诊断序号统一按 worldCommands → taskCommands → eventCommands 排列。

- 缺失父地点：`location_reference / worldCommands.0.location.parentId / CreateLocation / 第1条`。
- 任务截止早于开始：`event_time / taskCommands.0.task.dueAt / SaveTask / 第3条`。
- 两个事件争用一个任务：`task_event_link`，指向冲突关联字段。
- 无法可靠归因单条命令时返回 `state.*` 整批路径，不编造序号。状态表键统一遮蔽为 `field`。
- 仅输出静态规则名称、允许的 Schema 字段、数字序号和真实命令类型；不输出异常原始消息、任意实体键、模型原文或密钥。
- 沿用 RuntimeLog、临时响应面板和 Commit 重验，没有新 UI。通用 `data_integrity` 文案去掉误导性的“变量”限定，避免 World 错误被称为变量错误。

## 4. 实际 Prompt 同步

- `COMMAND_CATALOG` 增加单侧关联、真实引用、终态不可借补全改写及 ID 复用说明。
- World 共享输出模块与普通/特殊 NPC 场外模块明确以合法 Variables 投影判断离场，不重写刚离场人物的现场字段。
- 更新这 3 个 Markdown 资源的 Manifest 哈希及字符数。实际 `composePrompt` 测试确认这些规则和正确的 NPC 上下文进入请求。
- 不增加 AI 阶段、模型请求、自动重试或中文语义判断；任务和事件的原有日期、权限、生命周期检查继续执行。

## 5. 测试与修复记录

新增 **36 项**测试：`world-structural-reliability.test.ts` 30 项，`world-structural-workflow.test.ts` 6 项。

覆盖：完整用户响应、两个方向的单侧关系、已有活动对象、冲突/缺失引用/终态保护、幂等、不修改输入、仍在场/未验证离场/开局同伴、实际 Prompt、主角权限、字段重复写入、日期与状态诊断、命令序号、无可靠归因时的整批诊断，以及真实 Runtime → 候选 → 原子 Commit → fake-indexeddb 重载、明确重试、取消迟到响应、跨标签 CAS、伪造 validated 候选和旧式双方已填候选。

现有测试仅做两处符合新行为的更新：

1. `world-validation.test.ts`：旧的“本轮刚离场一律禁止”替换为合法独立后台字段可写、已写现场字段仍禁止；未取消其他权限断言。
2. `world-fact-runtime.test.ts`：错误路径从命令级提高到 `.task.actorRef`，仍断言拒绝、无泄密、只明确重试 World。

开发验证记录：

- 初始 5 项反例：5 失败，确认旧实现问题。
- 首轮直接回归：113 通过、1 失败，为上述旧离场规则断言。
- 扩展集成测试初跑：77 通过、1 失败；测试伪造候选未递增 candidateRevision，提前触发正确的版本保护。修正测试夹具，不改变版本规则。
- 直接 World / Commit 回归：7 文件、178 通过。
- 第一轮 `npm run check`：2526 通过、2 失败。其中一项为诊断字段变精确；另一项是真实上下文回归，终态任务随其已退场 NPC 被排除。已恢复终态任务历史上下文，原多回合承接断言不变。
- 上述修复定向复测：4 文件、87 通过。
- 最终 `npm run check`：**82 文件、2528/2528 工程测试通过，0 失败、0 跳过**；Lint、TypeScript 与 Vite 生产构建均通过。
- 最终 `npm run prompts:check`：**3 文件、82/82 通过**（也是工程测试的子集，不重复计入总数）。
- `git diff --check`：通过。

没有调用真实模型，所有模型请求使用 Mock。本轮未执行 Chromium（全量和定向均未运行），采用真实 Runtime/Commit 加 fake-indexeddb 测试；遵循本次优先结构、执行、Commit 定向回归且不重复无关浏览器集的要求，本轮没有改 UI。

## 6. 修改文件

- 领域：`src/domain/commands.ts`、`state.ts`、新增 `events/taskLinks.ts`、`npc/worldAccess.ts`。
- World 校验/诊断：`src/services/validation/worldOutput.ts`、`worldDiagnostics.ts`、新增 `worldProjectionDiagnostics.ts`、`src/services/ai/errors.ts`。
- 实际 Prompt：`src/prompts/context.ts`、`src/services/validation/commandCatalog.ts`、`prompts/shared/08_world_output.md`、`prompts/variableGroups/npc_ordinary/offscreen.md`、`prompts/variableGroups/npc_special/offscreen.md`、`prompts/manifest.json`。
- 测试：新增两个结构稳定性测试文件、`fixtures/teahouse.ts`、`fixtures/world-teahouse-original.json`；更新 `world-validation.test.ts`、`world-fact-runtime.test.ts`。
- 本开发报告。

## 7. 保留边界与未验证风险

- 原始用户正式存档未提供。测试假设中的父地点、参与人物/组织 ID 必须与真实存档一致；真实存档若缺少这些实体或已存在同 ID，新提案仍会被拒绝，并给出结构诊断。
- 不承诺所有模型一定遵守新契约；只证明固定样例及正反例走真实执行链时的行为。未做付费模型或线上玩家存档验证。
- 单侧关系规则不修复已经损坏的存档；已有终态关系不允许新加/改写。要求改写终态或同一任务确需多个事件时，现有一对多数据模型仍会拒绝，不自动猜测产品含义。
- 刚离场 NPC 的同字段连续变化保守拒绝，AI 应将现场最终状态留给 Variables，World 使用独立后台命令；未加入叙事措辞审查。
- 未扩展为全部领域错误都可精确归因；没有足够字段/命令归属的既有聚合异常仍按整批报告。
- 保持 V6、原三阶段执行、事务/CAS、幂等、候选失效及回滚。不会读取或修改用户真实存档；没有新付费行为。不合并、不主动部署生产环境。
