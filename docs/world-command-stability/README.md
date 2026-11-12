# World 提示词与命令契约稳定性优化

## 基线与实际请求审计

基于重新 fetch 的 `main@ac5942f541ac0ef751357c5fb101f8bb8a65b02a`，独立分支 `fix/world-command-contract-stability`。本轮收到的是失败类型描述，没有可配对的真实存档/响应；回归使用仓库现有合成状态，不能称为逐字重放玩家失败原文。

实际路径：`WorldStage.generate → AiRuntime → composePrompt → selectPromptModules/contextFor → AiClient`。开局/普通回合模板、共享 `08_world_output.md`、World 相关领域模块进入 messages；`contextFor` 将真实 `commandCatalog('world')`、TIME_WINDOW、BASE_SAVE_REVISION、TURN_CONTEXT、合法 Variables 投影等序列化进 GAME_CONTEXT。测试既检查 Composer 最终 messages，也在真实 WorldStage 的 Mock HTTP body 中检查契约。

审计发现：

| 失败类型 | 原规则及说明缺口 | 本轮修改 |
| --- | --- | --- |
| UpdateNpc.activeGoals 放入 changes | `variableCommands.ts` 的字段在命令顶层；目录文字却把 locationId/healthText/activeGoals 混列，缺完整命令示例 | World 专用 `commandGuides.UpdateNpc` 给出完整合法结构，注明仅 special 可写、正式版本来源和示例替换要求 |
| NPC 记忆时间越界 | `worldOutput.ts` 已严格检查正式起点与投影终点；提示仅说“时间与引用合法”，错误被归为事件时间 | 说明四种时间的区别、包含端点的窗口；`memory_time_window` 定位 `memory.createdAtGameTime` |
| SaveTask 缺结束依据 | COMMAND_CATALOG 已有 dueAt/completionCondition 的 anyOf；领域 `TASK_PLAN` 拒绝，但自然语言说明与诊断不够直接 | 紧贴命令说明真实截止/非空完成条件、活动任务无成果、合法且必要的 handoff；`task_plan` 定位 task 对象，不伪造缺失字段编号 |
| SaveEvent 来源/不可变字段冲突 | 原循环检查要求当前 turnId、所有旧来源、仅当前或已提交 journal ID；组合失败给出通用 constraint | 说明完整最终对象、保留全部旧来源并加入当前回合、不可变字段及主子时间；增加来源/不可变字段诊断 |
| 重复建档风险 | ID 唯一性、人物稳定身份、组织同类同名、事件同标题/起点/参与者已有检查 | 在选择命令前查询正式及合法投影，复用已有 ID，创建与更新分开；不新增去重算法 |

目录还残留 `NPC_KNOWLEDGE每项` 描述，实际第四批 NPC 上下文已经使用 `SAVE_STATE.npc[id].memories/knownInformation`；本轮只纠正文字，不改读取范围。`prompts/examples/world_sample.json` 是 `activation=never`、空 applicableStages 的旧参考资源，不进入 World messages，本轮未接入或用其旧格式举例。

## 模型可见结构和提示词组织

开局、普通回合模板将核心五数组输出要求提前；具体字段规则集中在 World 的 `COMMAND_CATALOG.commandGuides`，不复制到四份 NPC 模块。共享协议提供填写顺序、任务结束依据与末尾内部结构自检。自检不要求输出报告，不调用额外阶段。空结果仍合法，但不能省略 EVENT_SCHEDULE 要求的到期处理。

实际目录中的 UpdateNpc 示例：

```json
{
  "commandId": "example-update-npc",
  "type": "UpdateNpc",
  "evidence": "合法场外状态变化",
  "expectedRevision": 1,
  "npcId": "example-npc",
  "changes": { "healthText": "本轮发生的状态变化" },
  "activeGoals": ["当前行动目标"]
}
```

示例通过 DomainCommandSchema；Composer 测试用实际 npcId/BASE_SAVE_REVISION 替换占位值，再通过真正的 parseWorld。示例 ID、版本、内容都不得直接套入正式命令。

其余模型可见重点：

- `TIME_WINDOW.from ≤ memory.createdAtGameTime ≤ TIME_WINDOW.to`，按时间戳包含两端。待定开局 from 是 Story 已确认起点；to 是投影停止时间，变量未验证保持原预览语义。历史发生时间不同于本轮记录/获知时间；转述仍标注真实来源，不把旧事伪装成本轮亲历或伪造当前时间。
- SaveTask 须有 `dueAt` 或非空 `completionCondition`；没有真实期限时用有依据的条件；活动态不填 resolution。交接引用有成果的终态前序，时间依现行窗口/先后约束；无必要不交接。
- SaveEvent 是完整对象，复用 event.id；保留 `startAt/completionCondition/eventKind/parentEventId/fixedEndAt` 及原缺省状态。sourceTurnIds 保留旧集合并包含 TURN_CONTEXT.turnId，不能放命令/事件 ID 或虚构历史回合。
- main 的 estimatedEndAt 是估期；sub 使用原 fixedEndAt；并行允许重叠，不强加前序关系；既有终态不重复输出。程序入场和主角知情字段保持原边界。

与基线相比，三个 Markdown 资源 Unicode 字符数分别增加：共享协议 +662、开局 +60、普通回合 +61。目录另增加四条结构化指南和一个示例，带来额外上下文成本；没有扩充重复 NPC 资料、引入收费重试或压缩世界资料。

## 诊断与安全范围

`worldOutput.ts` 只有三处 requireWorld 的诊断参数变化，原布尔判断不变：

1. 记忆越界：`time_data / memory_time_window`，精确字段和命令索引。
2. 事件 startAt/completionCondition 变化：`event_immutable`，定位实际冲突的其中一个字段。
3. 事件来源集合不合法：`event_sources`，定位 `event.sourceTurnIds`。

`worldDiagnostics.ts` 对既有 TASK_PLAN/EVENT_CONTEXT 错误细化说明；无法将组合约束可靠归因到单字段时只指向 task/event。EVENT_CONTEXT 还用于父子字段组合错误，因此说明同时覆盖组合不合法与既有字段改写，不猜测具体剧情原因。

沿用 safeWorldPath、原命令类型/索引映射和安全日志。新增测试确认日志只有受控规则和路径，不携带记忆正文或堆栈。没有静默修正 JSON、补字段、改时间、改 sourceTurnIds 或放宽 Schema。原世界验证中的历史兼容错误码未另作清理。

正式 GameState/Schema、数据库/Repository、领域命令执行器、生命周期、CAS、Commit/撤回、AI 路由、费用配置、公告、三阶段输出协议及人物权限均未改动。Changes 里的原性别/私密档案兼容能力未删减或扩张。

## 回归与执行记录

全部本地/Mock。新增 `src/tests/world-command-stability.test.ts` 共 32 个用例：

- 正确/错误 UpdateNpc 层级，合法 special 目标与真实投影。
- 记忆窗口起点、内部、终点通过；前后一秒拒绝并精确诊断。
- 任务 dueAt 或完成条件通过，两者缺失/空白与提前成果拒绝。
- 事件历史来源追加通过；缺当前、丢旧来源、虚构回合拒绝；startAt、完成条件与主子身份、固定时间、终态保护。
- 现场权限、正式 revision、重复 NPC/组织/事件仍拒绝；输入状态均不被改写。
- 空结果合法，到期 sub 不能省略。
- 两模式最终 messages、Schema 层级、可执行示例、窗口/版本、指南可见性。
- 真实 WorldStage → Mock HTTP → 候选 → 原子 Commit → 幂等 → IndexedDB 重载；同批创建 NPC、记忆、组织、任务与主子事件引用；错误不污染正式状态、不丢 Story、每个场景只有一次模型请求。
- 原安全 RuntimeLog 的规则与命令序号、不泄露正文。

开发期记录（各批次独立，不合并为一次成绩）：

| 批次 | 通过 | 失败 | 跳过 | 解释 |
| --- | ---: | ---: | ---: | --- |
| 初始夹具两次检查（每次） | 17 | 12 | 0 | journal 首次字段形状错误，第二次补形状后遗漏 turnNumber；修正测试夹具以符合真实正式状态，未改生产约束 |
| 合法夹具在修改前 main 的新断言 | 18 | 11 | 0 | 正例通过；新诊断和模型可见指南尚不存在，作为修复前红灯依据 |
| 初次修改后的五文件定向 | 148 | 0 | 0 | 新用例、World NPC 创建、World 校验、结构可靠性、V2 阶段 |
| 补充真实 HTTP/提交/安全日志 | 32 | 0 | 0 | 新文件完整通过；失败夹具先校验正式 GameState，避免因其他无效状态误算负例 |

工程检查曾发现新增测试的 `empty()` 空数组被推断为 `never[]`：当时完整 Vitest 128 文件 / 3234 用例通过，但随后 TypeScript 失败，因此该批 `npm run check` **未通过**，构建和串联的 prompts:check 未执行。另一次定向 32 用例及 Lint 通过，同样在 TypeScript 失败。修复是为测试辅助函数添加 `ReturnType<typeof worldResult>` 返回类型，不修改运行行为或任何断言。修复后的检查结果单独记录，不与失败批次合并。

最终结果见下表。原始日志保存在本任务 `/workspace/world-contract-evidence/`；此路径是工作区证据，不声明为长期保存。公开报告仅包含合成测试信息。

| 最终验证 | 结果 |
| --- | --- |
| Node / 依赖 | Node v24.19.0，`npm ci` 成功（143 packages），未改 lockfile |
| 完整 `npm run check` 复测 | Lint、TypeScript、生产构建通过；128 文件 / 3234 通过 / 0 失败 / 0 跳过 |
| `npm run prompts:check` | 3 文件 / 93 通过 / 0 失败 / 0 跳过 |
| 相关 Chromium | 14 通过 / 0 失败 / 0 跳过；desktop 7、mobile 7，1.8 分钟 |
| `git diff --check` 与 Diff 自查 | 通过；没有改动领域、Schema、Repository、工作流、AI 路由与 UI |

构建有大于 500 kB 的 chunk 提示，未阻止构建；本轮不扩大为拆包重构。终轮命令输出摘录见 [VALIDATION.txt](VALIDATION.txt)。

Chromium 使用 `/usr/bin/chromium`，运行 `e2e/world-runtime.spec.ts` 和 `e2e/world-npc-creation.spec.ts`，覆盖候选、正式提交、失败、取消、刷新恢复、预览与 NPC 创建权限。没有运行无关全量浏览器回归，没有真实收费请求。

使用 TypeScript AST 对比基线与分支 `worldOutput.ts` 中所有 **57 个 requireWorld 的首个判断表达式**，逐项相同；变化只有上述诊断参数。新增测试最后强化了正式历史 revision 和到期错误类型的断言，保留全部原有安全断言。

## 后续真实模型对照方案（未执行）

Mock 证明契约进入请求、合法输出能落账、非法输出仍拒绝；不能证明真实模型一次生成成功率已经提高。

后续可由用户单独授权：固定相同模型/渠道/参数，取五个脱敏且结构合法的状态（已有 special 更新、记忆窗口、条件任务、旧事件更新、同批引用），每个状态基线/修改版各一次，合计最多 **10 个请求**，禁用自动重试。两组共用状态与玩家输入；保存 Prompt SHA、模型 ID、供应商 usage 和原验证器的错误分类，任何结果仅在独立副本校验，不提交玩家存档。按供应商明确单价和 max_output_tokens 先估总费用并设置停止上限；窗口/价格未知时先由用户确认模型及预算。上下文只允许脱敏合成数据。

比较首次结构接受数、权限/时间/状态错误分布、真实 usage；小样本可能波动，不将一次成功视为普遍保证。扩样另行授权，本 PR 未运行这一方案。

## 修改文件

- 三份 World Markdown 与 `prompts/manifest.json`、`prompts/sources.lock.json`（新增来源条目，历史哈希不覆盖）。
- `src/services/validation/commandCatalog.ts`（World 模型说明，不改正式 Schema）。
- `src/services/validation/worldOutput.ts`、`worldDiagnostics.ts`（诊断）。
- `src/tests/world-command-stability.test.ts`、`src/tests/prompts.test.ts`（真实请求/回归与来源版本校验）。
- 本开发报告。
