# M8-P0C-3D-2：正式文本变量工作流接入

基线：`main@623cd2dc3156018d294b611a8f0fa1f17bf112d9`（PR #41）。开发分支：`codex/m8-p0c3d2-live-text-variables`。

## 正式接线

原：Story → Variables JSON模板 / 原生JSON Mode → 模型直接输出DomainCommand → 原领域候选 → World JSON → Commit。

本轮：

```text
Story：原协议、流式显示、保存选定Story
  ↓ 当前正式GameState + 最新TurnDraft + 九组领域选择
runStageRequest(variables)
  → composeTextVariablesPrompt
  → stages.opening.variables.text / stages.regular.variables.text
  → 对应init/update.text资源 + TEXT_COMMAND_CATALOG
  → 原模型路由/凭证/请求快照，一次文本请求
  → parseVariableText
  → compileVariableCommands（程序填commandId、expectedRevision、记忆元数据）
  → validateTimeCommands（复用结构化时间边界，不审判小说措辞）
  → simulateVariablePlan（整批commitCommands内存模拟）
  → 既有现场任务/事件参与者权限底线
  → 原VariableResultSchema {commands, rejectedSuggestions, unresolved}
  ↓ VariableStage原StageGuard / 版本校验 / 草稿CAS
TurnDraft.variables.result.commands：规范化且模拟通过的DomainCommand[]
  ↓ WorldStage / runStageRequest重新验证领域候选
projectTurn（同一正式revision基线）→ 原World JSON请求/验证/候选保存
  ↓ 玩家发送下一行动
SaveRepository.commitTurn → validateTurnCandidates → 原子settleTurn
  → 正式状态、journal、短期记忆、命令回执、下一草稿一起提交
  → 原TurnCoordinator继续下一回合
```

新模型响应没有JSON猜测、JSON回退或第二次修复/审批请求。`parseVariables()`保留为已存领域候选的同步复核器，供World、协调器恢复与Commit使用；它不是新模型响应的备用解析入口。旧JSON候选不需迁移，新旧候选使用同一种持久化领域结构。

## 协议与提示词

- `composePrompt()`对Variables与专用入口选择相同文本协议；模块管理/预览和真实请求不再各显示一套协议。
- 默认模块激活逻辑选择`.text`，文本资源只适用于Variables；开局init与普通update保持独立，九域选择策略沿用原实现。
- `contextFor()`提供真实`TEXT_COMMAND_CATALOG`；Variables没有旧`COMMAND_CATALOG`，World继续使用自己的命令目录和原JSON输出模板。
- 原生JSON Mode仅对World/Memory生效。OpenAI Variables不发送`response_format`，Gemini不发送`responseMimeType`；Anthropic沿用原消息结构。设置本身不被篡改，World/Memory原约束保留。开启JSON Mode的Variables请求附静态诊断`VARIABLE_TEXT_MODE_JSON_DISABLED`。
- Story、Thinking、NSFW、两本世界书、七项写作设置、模型生成地址及模型路由不改。旧JSON提示词作为历史资源保留，但新Variables请求不选择它们。
- 更新输出/组装文档以明确“文本模型输出”与“内部规范化领域候选”的区别。

## 说明、错误与数据边界

`<thinking>`和`<说明>`不作为命令执行。不保存说明原文，不将“计划”“无法处理的建议”伪称为正式事实；若命令区块外出现说明，仅在原`unresolved`记录固定安全提示：

> 模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。

不会复制说明中的私人记忆、密钥或未知状态。命令字符串内部的`<说明>`只是数据，不触发该提示。规范化命令仍由原阶段执行器检查凭证回显后保存。用户主动查看完整变量候选可见固定提示，普通正文/日志不自动发布它。

语法失败为`variable_text_syntax`，诊断只包含静态错误码、行列和命令序号；编译/模拟错误映射到已有`schema_fields`、`amount_balance`、`data_integrity`、`candidate_conflict`。不输出非法值、动态人物ID、模型完整响应或凭证。任何失败均不生成成功候选，不吞掉单条命令，不返回部分执行状态。

保留合法日期、不可倒退、金额整数分、未知余额、余额不足、真实归属、实体引用、命令ID、NPC记忆归属、幂等、CAS和事务。没有新增来源凭据、消费授权、coverage、封印、关键词事实审查或AI裁判。

## 开局时钟规范化

编译器与`variableCommandsForTurn()`复用相同规则：Story结构化开局时间决定唯一程序命令`opening-clock:<storyRevision>`，值为Story `endAt`。合法空命令块也产生这一条规范化命令；模型给出等值时钟不会再增加一条，不同值拒绝。

Variables上下文、模拟、World的`TIME_WINDOW`、投影和正式Commit使用同一候选。`variableCommandsForTurn()`将已保存的等值程序时钟重新规范为同一条，不重复推进、不新建第二份时钟协议。旧草稿仅有旧JSON领域命令时，也沿用原规范化规则。设备日期只用于原有审计字段。

首次提交前`openingTimePending`及正式时钟保持不变。刷新复用已保存候选；重复提交读取持久回执，不再写入命令或记忆。普通回合的合法零耗时规则不变，不补固定步长。

## 现场事件/任务兼容缺口及最小补齐

正式回归暴露：旧Variables用`SaveEvent`记录主角睡眠期间访客实际敲门、事件从scheduled转active。3D-1的38种文本映射缺少`SaveTask`/`SaveEvent`，若直接切换会丢失已有现场能力。

仅增加两条有限入口，目录从38变为40条、覆盖原Variables的23类领域命令：

| 文本入口 | 原生命令 | 值 |
| --- | --- | --- |
| `set events[id] = {...}` | SaveEvent | 原WorldEventSchema去掉id |
| `set tasks[id] = {...}` | SaveTask | 原WorldTaskSchema去掉id |

稳定ID由路径注入；不允许值内再写id。按原命令upsert，不伪造新的任务/事件结构。真实引用、时间、终态、来源回合与Commit校验沿用原规则。文本Runtime提前检查同一现场NPC参与者权限；场外NPC任务/事件不能通过Variables路径进入成功候选。World后台任务和事件仍用原JSON、来源和生命周期规则，不迁入Variables。共享文本协议增加对应说明并刷新Manifest字符数/hash及来源锁。

## 版本、取消、恢复和事务

未修改三个阶段执行器、TurnCoordinator、StageGuard、TurnDraftSchema、正式GameStateSchema、存档迁移或SaveRepository。

- VariableStage保存前复核saveId/turnId/baseSaveRevision/draftRevision/storyRevision/executionRevision/stageRequestRevision；按原CAS写入，保存candidateRevision/requestRevision。
- Story重Roll、变量补算均保留原候选失效关系；World读取匹配最新变量版本的合法投影。
- StageGuard取消及版本检查发生在响应处理与保存之间；迟到响应不能另起下游或覆盖新草稿。网络请求不在IDB事务内等待。
- World失败时只保留已保存上游候选；正式状态不变。Commit不信任`validation: validated`，仍重新解析领域候选、模拟、验证World与整批命令唯一性。
- 精确重放保留原领域和回执语义；跨标签页/正式revision变化仍拒绝旧候选。
- 模型请求数量、既有有限瞬时错误重试及费用授权不变。文本解析失败不自动回退、重新请求或修复；手动恢复仍需玩家明确操作。

## 测试与失败复现

先新增正式`runStageRequest`三协议测试：原main对合法`<命令></命令>`均报`invalid_json`，3/3失败。切换后通过。

新测试文件：

- `live-text-variables.test.ts`：12项，三协议真实Runtime文本请求、空开局唯一时钟及Story/World/Memory格式隔离。
- `live-text-turn.test.ts`：16项，实际TurnCoordinator、三个执行器、真实解析/编译/模拟、fake-indexeddb原子Commit和重载；含开局/普通多域交易、NPC建档/关系/私人记忆、地点/组织、World任务事件、现场任务事件、场外权限拒绝、空块/等值时钟、旧JSON候选恢复、10回合、事务异常、说明脱敏与字符串边界。
- 浏览器`variable-runtime.spec.ts`新增手写文本的NPC状态/私人记忆/消费场景；四阶段选模不改，Variables渠道明确开启JSON Mode验证实际请求仍是文本。

既有测试保留并更新模型响应Mock及正式模块ID。测试专用`fixtures/variableReply.ts`仅把原场景DTO改写成有限文本，生产代码不导入，不解析真实AI响应，不绕过实际编译器。存量持久化JSON候选测试继续使用JSON。原普通回合测试中的“turnNumber=0但草稿regular”改为通过原Commit先建立真实开局历史，未放宽编译器模式校验。

最小开局浏览器原断言“候选没有时钟”调整为“唯一opening-clock:1”；同时继续检查正式时钟提交前不变、回执一次、刷新及多回合不重复计时。说明原文展示断言改为固定非执行提示与秘密不落库。

阶段性结果：全部Vitest 1,885项通过（原1,857保留，新增28）；提示词检查82项通过；完整check构建及最终桌面/移动E2E仍在执行，最终结果将在提交前补录。此前的JSON Mock失败仅作为迁移记录，不视为最终验证。

## 已知缺口与实际影响

1. 原生领域没有未知现金/线上余额初始化、历史已持有资产无交易登记、完整房产购买，以及部分NPC/组织字段更新能力。本轮不增加任意余额覆盖器、假收入或假借款。余额null时不能消费，即使新增一笔收入也不能推断原余额；此类开局交易仍会安全失败，需要后续独立领域设计。合法无交易开局已能空块完成并进入下一回合。
2. 不支持的能力模型可写说明，但说明不自动落实，也不保证保留完整建议文字。玩家主动查看候选只能看到已执行模拟的规范化命令和固定提示。
3. 模型仍须输出合法文本路径和原Schema字段。非法JSON值、无效实体、余额不足等仍会阻断整批；这是数据完整性限制。没有声称任意真实模型都已兼容。
4. 新Variables若仍返回旧JSON会明确失败，不猜测或重发；已有合法JSON领域候选可继续恢复/提交。
5. 全部模型调用均Mock，不验证真实供应商格式遵从、计费、CORS或真机键盘行为。没有调用真实收费模型，没有新付费场景。
6. 未主动部署生产环境；PR预览若发生，由既有Cloudflare自动流程处理。不合并、不部署、不修改main。

## 文件清单

正式接线：`src/services/ai/runtime.ts`、`protocols.ts`、`errors.ts`，`src/services/validation/aiOutputs.ts`，`src/prompts/composer.ts`、`selection.ts`、`context.ts`。

有限现场能力：`src/executors/variableText/entities.ts`、`catalog.ts`。

提示词及契约说明：`prompts/shared/07_command_output.md`、`prompts/manifest.json`、`prompts/sources.lock.json`、`prompts/docs/ASSEMBLY.md`、`prompts/docs/OUTPUT_CONTRACT.md`。

测试：上述两个新测试、`src/tests/fixtures/variableReply.ts`；更新`ai-client`、`opening-time`、`prompt-inspector`、`prompt-runtime`、`text-prompt-readiness`、`time-runtime`、`turn-coordinator`、`variable-commands`、`variable-stage`、`variable-text-executor`测试；更新E2E `action-workflow`、`continuous-turns`、`memory-maintenance`、`npc-memory`、`opening-time`、`time-preflight`、`turn-coordinator`、`variable-runtime`。

本报告为新增文件。正式设计文档、原世界书、NSFW及六套Story/World主模板不改。
