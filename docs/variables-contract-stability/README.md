# Variables 文本契约稳定性

基线：重新获取 `main@a8334e8f9429b0423eab01690f3751dce96a227c`，其提交为已合并 PR #115（squash）。不改 World 提示词及诊断。

## 真实路径与归因边界

本次只有用户描述的错误和可疑命令，没有对应完整正式存档、所选 Story 与失败响应，**不能确诊真实样本唯一根因**。没有把玩家人物、事件 ID 或私人剧情写入测试。

实际路径是 `composePrompt → composeTextVariablesPrompt → selectPromptModules/contextFor`，加载 opening/regular Variables 模板、共享 `07_command_output.md`、所选 variableGroups 和 `TEXT_COMMAND_CATALOG`。模板本来已要求仅更新实际变化、后台交给 World；普通/特殊 NPC 模块本来已有 from/to/reason/relationshipText 和四字段记忆。问题集中在共享协议以“正文实际涉及”配上 active 示例，易把提及理解成必须更新，且没有强调 active 保持不变无需命令。共用规则集中在共享协议和目录，不在各人物模块重复堆积。

`parseTextVariables` 解析协议、编译并调用 `simulateVariablePlan`；编译 `sceneState` 复用正式事件并由程序保留规划/生成来源。模拟先应用本批时钟和命令，再调用 `validateSceneEventUpdate`，检查正式及投影在场身份、既有事件入场回执和 Story 的明确 enter 裁定。mention 本身不授权（仍可能具备其他合法现场身份条件）。正文中的讨论、关键词和事件标题不参与权限判断。

已复现的**同类路径**：纯场外 NPC 事件、没有有效入场授权，本批最后附加 `sceneState={status:active}` → `SCENE_PERMISSION`。原诊断词典未映射该码，故变成 `invalid_domain_state`；模拟后的逐事件检查丢失单条来源，返回整批 relatedCommandIndices。本轮添加固定 `scene_event_permission`，在这个检查现场使用已有 origins 精确返回文本命令位置、SaveEvent 类型和 `events[id].sceneState` 安全路径。没有输出事件 ID、私密文本或堆栈。组合错误无法确定单条归因时仍保留原保守机制。

不删除、过滤或修正模型输出：非法命令依旧整批失败，不能为了让其他命令成功而静默丢弃事件命令。模型在没有事件变化时主动省略这一条，其他合法人物命令才可以正常独立提交。

## 提示词前后与示例

- 原：正文实际涉及的现场事件 + active 示例。现：本轮实际成立且满足已有权限的**状态变化**；active 仍 active 不必输出；提及、风险讨论和等待不授予介入；明确 enter/mention、原 eventInteraction；合法现场更新与提前结案继续支持。
- 原：好感示例缺少集中提醒。现：from 匹配正式前值，同批连续更新用上一笔结果，未确认用 null；reason/relationshipText 必填。记忆与好感可同批独立执行。
- 四字段记忆仍为 `{text,knowledgeKind,knowledgeSource,visibility}`；程序生成 ID、当前来源回合、记录时间和人物引用。没有新记忆格式，没有自动补写旧记忆。
- 普通回合按照 Story 实际经过提供时钟，不倒退/跳时；程序先应用时钟，再按原顺序执行其他命令。开局使用既有 Story 时间注入。无交易不输出经济命令，无变化不输出事件命令，不减少已经成立的人物经历记录。

最终 TEXT_COMMAND_CATALOG 增加以下短示例，实际 Compose messages 测试确认其规则进入请求：

```text
set npc[example-npc].affinityChange = {"from":0,"to":5,"reason":"共同核对材料","relationshipText":"愿意继续协作"}
push npc[example-npc].memories = {"text":"自己与对方核对材料并约定继续合作，尚有问题待确认。","knowledgeKind":"observed","knowledgeSource":"本人参与本轮交谈","visibility":"npc_private"}
```

示例 ID、数值和剧情仅用于解释结构，必须依据实际人物与 Story 替换，不能复制成真实事实。

## 验证

新增 11 项测试：无事件变化时全批人物更新及程序记忆来源；无授权/mention 拒绝并精确定位、enter 合法；好感前值错和互动倒退/未来拒绝；开局/普通回合最终 messages；文本编译/模拟/候选保存/Commit/IndexedDB 重载；失败保留 Story/正式状态；授权提前结案不改变原规划时间；安全 RuntimeLog。

各批结果独立记录：

| 批次 | 通过 | 失败 | 跳过 | 说明 |
|---|---:|---:|---:|---|
| 初次新测试 | 7 | 3 | 0 | 开局模式夹具不一致、提示词元数据尚未刷新、错误地用已提交状态调用 create；均为测试设置问题 |
| 三文件定向 | 112 | 1 | 0 | 已有 World 候选后更改 Variables 未失效；保留原约束，改为先编译候选再按正式顺序保存 |
| 修正后新测试 | 11 | 0 | 0 | 补授权提前结案；没有削弱领域断言 |

最终验证（Node v24.19.0）：

- npm ci：143 packages，成功。
- npm run check：Lint、完整 Vitest（129 文件 / 3246 通过 / 0 失败 / 0 跳过）、TypeScript、生产构建全部通过。构建保留非阻断的大 chunk 提示，不扩大为拆包重构。
- npm run prompts:check：93 通过 / 0 失败 / 0 跳过。
- Chromium：`e2e/variable-runtime.spec.ts`、`e2e/story-event-arbitration.spec.ts`，desktop/mobile 共 24 通过 / 0 失败 / 0 跳过，2.7 分钟；使用 /usr/bin/chromium、CI=true 启动本分支服务器。
- git diff --check 和完整 Diff 自查通过；明确对比领域、存储、工作流及 PR #115 World 文件无差异。

命令输出摘要见 [VALIDATION.txt](VALIDATION.txt)。所有网络模型请求为 Mock。

## 范围与风险

只修改共享 Variables 提示词/目录说明、安全错误映射与来源定位、元数据、测试和本报告。`scenePermission.ts`、领域 Schema、生命周期、Repository、撤回、事务、模型路由和三阶段协议均未改动。原 57 个 World requireWorld 判断及 PR #115 改动保留。

Mock 证明协议、拒绝边界、执行与存储链路；不能证明真实模型首次成功率提升，也不能排除用户原批次还有好感前值、互动时间等独立问题。精确确诊仍需同一次生成的正式状态、Story 和完整 Variables 原文。本轮零付费模型调用、无自动重试。

修改清单：`prompts/shared/07_command_output.md`、`prompts/manifest.json`、`prompts/sources.lock.json`（追加来源，不覆盖旧记录）、`src/executors/variableText/{catalog,index,aggregateDiagnostics}.ts`、`src/tests/{prompts,variables-contract-stability}.test.ts`、本报告及验证摘录。
