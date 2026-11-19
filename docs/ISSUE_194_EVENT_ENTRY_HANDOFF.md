# Issue #194 · 子事件到期与未处理入场

Refs #194

前半部分记录第一阶段的审查与验收。现行收悉协议及结果见「第二阶段：纯通知收悉与自然结案」。

基线为 GitHub `main@089723c2e1e0aa608afe9820a87b1f6a36ef385b`。验证使用独立工作树和合成存档。最终提交以本 Draft PR 的 HEAD 为准。

## 复现和根因

脱敏轨迹中的子事件在 2026-05-17 14:00（UTC+8）到期，原入场已为 `presented`。这回合 Story 描写主角打开消息、播放汇报语音，未给出新的结构化处理回执。World 按时把子事件改成 `resolved` 并选择 `end`，同时没有后继。可在 Issue 的[复现记录](https://github.com/WJT111222/HeiJinWangChao/issues/194#issuecomment-6990385107)及[审查澄清](https://github.com/WJT111222/HeiJinWangChao/issues/194#issuecomment-6995658938)核对。

[World 校验](../src/services/validation/worldOutput.ts)用正式存档与本轮已验证的 Variables / Story 回执构建投影。[承接校验](../src/services/validation/stageEntryHandoff.ts)在常规逐命令诊断边界之前运行，[领域结算](../src/domain/events/stages.ts)再次检查到期结果及入场转移。因此旧版确实拒绝了该候选，但仅提供 `invalid_output / event_entry`。原 `EVENT_SCHEDULE.due` 标出事件到期，没有把 `presented` 入场连到同一条到期事项。模型只能在完整世界状态中自行关联，并且可能把「业务无需后续」读成「入场也可丢弃」。

在未改动生产代码的同一 main 上运行最小专项夹具，合法唯一后继、持久化和 pending/合法回执控制组通过（2 项）。缺少承接时的精确定位、非法后继分类，以及最终出站消息中的入场摘要均失败（3 项，退出码 1）。首个版本的测试夹具误用了两个 journal 字段，已纠正并单独保留日志，未将那轮计为生产问题的复现。

## 事件入场语义审查

| 问题 | 结论 |
| --- | --- |
| A · 汇报还是待决事项 | 脱敏记录只展示工作结果的汇报和播放语音，没有展示还需主角批准、选择或回复的事项。从现有证据，最接近纯通知。正文行为能说明实际播放，资料不足以断定听完、理解全部内容或已作决定。正式入场记录也没有通知／待决分类。 |
| B · 回执能否表达知晓且无需回应 | 不能。[回执 Schema](../src/domain/events/schema.ts)只允许 `presented`、`declined`、`left`、`interrupted`、`invalidated`。[Story 校验](../src/domain/events/interactions.ts)还拒绝对同一已呈现入场再次交 `presented`。失效、拒绝或退出都要求相应事实，不能代写「已读」。`eventNarration: mention`也不消费既有入场身份。 |
| C · 信息已合法送达时为什么要后继 | 若确已送达、仅需通知且无需玩家作决定，产品上没有安排后继的理由。现有流程无法存储这个完成事实，`presented`在投影中仍开放，结算因此把它当作可能待玩家处理的事项。 |
| D · 是否会产生机械后继 | 会有这个风险。模型为了满足校验，可能在一个纯汇报业务结束时人为规划互动。承接生成的是旧式事件，而带开放入场的旧式事件不会因预计时间再次进入到期清单，并无程序自动无限建链的证据。若模型以后又编造其他阶段或邀请，仍可能反复制造虚假后续。 |
| E · 能否安全自然完成 | 可以单独设计。需要由协议明确通知与待决的区别，并以精确关联的收悉证据关闭纯通知。现有数据不足以安全实现。本 PR 保留拒绝与玩家权限，不改变存档或回执动作。 |

既有规则保证 World 不能借业务到期丢弃玩家尚未处理的请求，也不能伪造同意、拒绝或离场。它对无法区分通知与请求的旧记录采取保守处理，会挡住纯通知已经收到但没有对应回执的正常情形。已按现行回执合法关闭的入场仍可直接结束。测试中的明确拒绝是独立控制组，不能用其证明纯通知已可关闭。

独立设计的最小候选是，在新建安排时记录有稳定来源的入场类别（通知或待玩家决定，旧记录默认为未分类），并增加独立「已接收」事实。收悉证据必须引用当前存档的同一事件和入场身份，可来自玩家明确接收操作，或经过验证的本幕 Story 结构化证据。待决事项的收悉只能更新其信息接收标记，不能消费决策，更不能单独授予 Variables 现场介入或提前结案权限。只有原类型明确为纯通知且实际送达的收悉才关闭该通知。类型不能由 World 在结案时改变，旧 `presented` 不能在读档或迁移时推断为完成。

若实施该候选，需要同时更新严格 Schema（含 Story/草稿/Journal 回执）、正式与只读领域投影、认知传播、候选重验、回执幂等、退役/撤回数据兼容及旧客户端读档策略。真正的旧格式可用性和费用影响需独立评审。本 PR 不实施这一数据契约。

## 本轮改动

- [`src/domain/events/schedule.ts`](../src/domain/events/schedule.ts)为到期子事件的 `due[]` 增加可选 `entryHandoff`，仅取合法投影里仍开放的 `pending` / `presented`，提供状态、渠道、提示和可选地点。源事件 ID、固定到期时间沿用同一项。已合法处理、未到期和不相关的事件不增添此摘要。
- [共享 Story 输出](../prompts/shared/06_story_output.md)、[共享 World 输出](../prompts/shared/08_world_output.md)与[普通 World 阶段](../prompts/stages/regular/world.md)区分业务结案、通知已呈现和玩家决定。说明只承接真实待处理互动，证据不足又没有真实后继时保留拒绝。合法合成 JSON 示例经真正的 Composer 和 `parseWorld()` 验证。Manifest 与来源锁同步。
- [阶段承接](../src/services/validation/stageEntryHandoff.ts)与[普通入场规范化](../src/services/validation/worldEventContinuation.ts)在原有断言失败时补充固定原因和命令位置。原因区分缺少后继、不唯一、已有／终态／类型错误、方向错误、入口字段不匹配、伪造回执和重复使用后继。原错误码和 `worldRule: event_entry` 保持兼容。诊断仍沿用已存在的临时日志。
- [诊断字典](../src/services/validation/worldDiagnostics.ts)、[`AiError`](../src/services/ai/errors.ts)与[运行日志](../src/ui/game/runtimeLog.ts)只传递预定义原因及字段路径，不输出原始 `cue`、实体 ID、模型内容或凭证。模型上下文中的最小承接信息不会复制到日志。
- 测试新增合成夹具、专项 Vitest 及双端 Chromium。受影响旧浏览器用例显式打开运行诊断后，将原有断言定位到对应区域。提示词来源测试登记新修订键；整组快照仅更新逐消息核对后受影响的 Story / World 字节。无相关事件的固定输入中，Variables、Memory 和所有上下文对象字节一致。有天赋配置的固定输入中，Variables 和 Story 天赋定义、通用／专属规则也相同。

安全边界由既有条件保持：到期仍按原 `fixedEndAt` 结案，开放入场只由合法的唯一后继承接，程序维持原入场处理状态及认知隔离。允许原始及规范化候选按原规则重验。已有 `pending` 失效例外与合法 Story 回执继续通过。失败回滚、重放、重载和 Undo 验证使用真实 Repository。没有变更存档格式、Commit/Undo、玩家权限、AI 路由或重试策略。

## 验证

验证环境 Node.js 24.19.0、npm 11.9.0、仓库锁文件与真实 Chromium。所有模型请求都由 Mock 拦截。浏览器案例中，初次失败后玩家明确继续才发第二次 World 请求，成功后正式回合只递增一次，测试不发 Story 或 Variables 请求。

| 批次 / 命令 | 通过 / 失败 / 跳过 | 退出码 |
| --- | --- | --- |
| `npm ci` | 安装 143 个包 | 0 |
| 修复前 `npx vitest run src/tests/issue-194-entry-handoff.test.ts` | 2 / 3 / 0 | 1 |
| 最终专项 Vitest，共 8 个文件 | 222 / 0 / 0 | 0 |
| `npm run prompts:check` | 93 / 0 / 0 | 0 |
| `npm run typecheck` | 通过 | 0 |
| `VITEST_MAX_WORKERS=2 npm run check` | 187 文件，4433 / 0 / 0；文件名、ESLint、命令目录、TypeScript 与生产构建均通过 | 0 |
| 定向 Chromium 两项目 | 10 / 0 / 0（桌面 5、手机 5） | 0 |
| `git diff --check`、`git diff --cached --check` | 通过 | 0 |

专项 Vitest：

```bash
npx vitest run src/tests/issue-194-entry-handoff.test.ts src/tests/event-stages-v2.test.ts src/tests/world-event-handoff.test.ts src/tests/event-handoff-composition.test.ts src/tests/world-validation.test.ts src/tests/story-event-arbitration.test.ts src/tests/turn-commit.test.ts src/tests/turn-undo.test.ts
```

定向 Chromium：

```bash
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/issue-194-entry-handoff.spec.ts e2e/event-stages-v2.spec.ts --workers=1 --reporter=list
```

- 第一次 Prompt 检查 92 通过、1 失败，原因是来源测试有修订键优先列表。登记 #194 修订键后复测 93 通过。
- 首次完整检查 4430 通过、3 失败，World 快照在该批 Vite 载入时仍对应中间版排程说明。独立工作树逐消息核对最终 Prompt：干净 main 的 9 组无天赋请求与旧快照完全匹配，8 种天赋的完整组合与旧合并哈希匹配。最终分支仅变化指定 Story/World 提示模块。保留固定上下文、Variables 与 Memory 字节断言。快照与 #194 两文件复测 35 通过。
- Chromium 第一轮 8 通过、2 失败，两项手机诊断断言同时命中两个同名日志节点。干净 main 同环境重跑旧阶段失败用例，复现相同选择器冲突（0 通过、1 失败）。修订选择器后第二轮 9 通过、1 失败，新手机用例启用了自动出现的诊断弹层，点击底层返回按钮被弹层正确拦截。最后改为在手机弹层查看日志并关闭后再实际点击继续，保留所有状态、脱敏和请求次数断言。
- 定向与 Prompt 集合和完整 Vitest 重叠。没有运行全量 Chromium。手机项目为 Chromium 移动视口，真实模型对提示词的遵循程度尚无验证。

构建报告保留 Vite 现有的大包提示，退出码 0。

## 第二阶段：纯通知收悉与自然结案

第二阶段从已审查的 `cc4b763df6d2b01bd119c13388c9f76045f38f78` 继续。执行时 GitHub `main` 仍为上文基线。最终实现与验证以 Draft PR #198 的第二阶段 HEAD 为准。

### 结构与权限

- 新建主角入场计划可在事件顶层声明 `entryIntent: "notification" | "decision"`。纯工作通报、结果告知使用通知，需要批准、回应或实际参与的安排使用待决类型。字段独立于 `continuation`，因此业务结案改成 `end` 时仍保留来源类型。既有事件禁止新增、删除或改变该分类。同批承接也须精确保留原分类。未指定类型的旧数据照原规则读取，未分类事件若以后确有独立通知，须新建相应安排。
- Story 是实际收悉事实的来源。保留原回执对象，加上 `action: "acknowledged"`。只允许当前实际收悉的、类型已标为 `notification` 的开放入场。已经 `presented` 的通知可以确认收悉；同一幕实际完成送达并收悉的 `pending` 通知也可一步处理。仅展示、开始播放、没有对应证据或历史回顾均不能用来补写此回执。类型未知、待决、错 ID、重复和已关闭入场均不能领取这项转换。
- Variables 复用候选投影对 Story 回执的合成。程序保存 `acknowledged`、同一入场 ID、处理回合、Story 的证据及原有 `reported` 快照。回执不写业务状态、不写玩家选择。正式入口用仅存在于内存的授权集合核对来源，模型候选或独立保存不能凭字段写入收悉。已经落盘的收悉状态保持终态，新事实可另建有依据的事件。
- 现场授权采用原有动作的显式白名单。收悉只允许写本次回执元数据、原有的消息快照和来源回合。单凭收悉不能改 `sceneState`、使子事件提前结案或签署、付款、同意、拒绝。既有独立现场条件照常工作。无新增 Variables 或 World 认知判断，既有消息来源和边界继续由 Story 指定。
- World 读取合法投影。已收悉的纯通知从待承接摘要移除，仍由原固定时刻、业务进度和结果要求结案。缺回执的开放通知及待决事项继续受第一阶段保护，真实未处理互动照常唯一承接，不靠编造后继绕过校验。没有开放入场的后台子事件仍正常结案，即使主角完全不知情。

### 旧档、备份与当前限制

本版可原样读取旧 `presented` 及旧草稿，未增加迁移或删除路径。由于旧客户端使用严格 Schema，它不会识别带新分类的存档，或者带 `acknowledged` 的状态和已保存正文回执。该限制也影响用旧客户端恢复含新数据的备份或历史快照。当前版使用原来的备份、历史收藏、草稿、事务、重验和撤回格式，实测了新状态的普通备份导出导入与手动历史收藏预览。事件退役仍用原有详情与知情快照，正文和已提交回执在 Journal 保留。

对第一阶段已卡住的旧草稿，核对 `GameScreen.tsx` 的工作流按钮、`storyGenerationPolicy.ts` 及 `StoryStage.generate`。普通「继续」会复用已完成正文，界面没有可以安全重做已 ready 正文再重新确认下游作废和费用的专用入口。本阶段保留旧记录，未加自动重跑、关键词推断或回填分类。为旧未分类事件提供类型补录或为已 ready 草稿增加显式恢复，需要另行决定交互、候选失效及费用提示。

### 实际修改范围

- 协议、状态与投影：`src/domain/events/{schema,interactions,lifecycle,narration,scenePermission,schedule,stages}.ts`、`src/domain/{commands,state,storyDiagnostics,turnProjection}.ts`、`src/executors/variableText/index.ts`。
- World 边界与编排：`src/prompts/context.ts`、`src/services/validation/{aiOutputs,commandCatalog,stageEntryHandoff,worldDiagnostics,worldEventContinuation,worldOutput}.ts` 和生成的 `commandCatalogSchemas.json`。
- 提示词及来源：`prompts/shared/{06_story_output,07_command_output,08_world_output}.md`、`prompts/{manifest,sources.lock}.json`。
- 测试：`src/tests/issue-194-notification.test.ts`、`src/tests/issue-194-entry-handoff.test.ts`、`src/tests/{prompts,summary,talent-context}.test.ts`、`src/tests/fixtures/talent-issue-194-prompt-baseline.json`、`e2e/issue-194-entry-handoff.spec.ts`。保留第一阶段拒绝与正常承接测试及其诊断断言。

固定请求通过 Composer 对照第一阶段。三阶段各变更一个共享输出模块，World 上下文仅变更 `COMMAND_CATALOG`。其他固定上下文、模块顺序、天赋定义与专属规则、三种 Memory 请求均逐项一致。通知候选的动态上下文单独通过实际模型请求 Mock 检查。生成的命令目录只变更 SaveEvent 和共用的入场定义，SaveTask 及其他命令逐项一致。

### 测试结果

Node 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。依赖由 `npm ci` 按锁文件安装。断言覆盖上一阶段已呈现未处理的安全拒绝、Story 有合法收悉时的无后继结案、待决事项、身份引用、公开诊断、原子回滚、重放、刷新、备份与历史收藏、Undo。

| 批次 | 通过 / 失败 / 跳过 | 退出码 |
| --- | --- | --- |
| 第一期 HEAD 新增最小用例 | 0 / 1 / 0，旧 Schema 拒绝 `acknowledged` | 1 |
| `npm ci` | 143 包安装成功 | 0 |
| `VITEST_MAX_WORKERS=2 npm run check` | 188 文件，4449 / 0 / 0，含文件名、ESLint、命令目录、TypeScript 和生产构建 | 0 |
| `npm run prompts:check` | 93 / 0 / 0 | 0 |
| #194、承接、事件、提交及 Undo 定向 Vitest | 204 / 0 / 0 | 0 |
| 加强备份／历史收藏后的 #194 + 提示词快照复验 | 45 / 0 / 0 | 0 |
| 干净 main 的六组定向控制 Vitest | 182 / 0 / 0，第二阶段相同六组亦全通过 | 0 |
| 双端 Chromium 定向 Mock | 12 / 0 / 0（桌面 6，手机 6） | 0 |
| 干净 main 的双端 Chromium 稳定控制组 | 6 / 0 / 0，与第二阶段相同组一致 | 0 |
| 工作树和暂存区空白检查 | 通过 | 0 |

浏览器使用 `CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/issue-194-entry-handoff.spec.ts e2e/event-stages-v2.spec.ts --workers=1 --reporter=list`。桌面、手机各自从正式玩家输入触发 **Story → Variables → World → Commit → 刷新 → Undo**，各阶段一条 Mock 请求。World 只发一项业务结案命令。已提交状态无新互动、经济或人物变化，撤回未触发请求。未执行全量 Chromium，未调用真实模型。全量与定向 Vitest 数量有重叠，不相加。

中间失败单独记账：初版按 JS 对象字段顺序比对收悉元数据，导致兼容条件误报，并在复用命令指纹时碰到 Vite 模块循环，现改为按同一事件 Schema 归一后比较。浏览器初版测试字符串正则未转义，未执行用例；定向测试夹具另有一项保留原提示字段的反例配置错误，已修正夹具，安全断言保留。首次完整检查有 2 项共享摘要测试仍期待「未处理者继续 pending」，已更新为精确验证 pending 与 presented 都保持原状态。第二批完整检查在运行中补入最终结算的类型检查和用例，已加载旧模块与新断言混用，出现 1 项失败。冻结源码后单独复测相关 56 项及双端完整通知流程 2 项均通过，最终完整批次另计。

剩余限制是旧客户端降级只读能力、旧未分类草稿的恢复入口，以及真实模型按结构化协议输出的稳定性。完整测试、控制组与失败原始日志保存在本次验证工作区。

## 第三阶段：旧存档安全恢复

### 为什么旧草稿会卡住

旧事件的 `presented` 只保存了入场已呈现的事实，没有 `entryIntent`。旧正文只开始播放汇报，也没有证明主角听完。当前 Story 已是 `ready`，Variables 候选已验证。普通「继续」会复用正文并重试 World。直接让 World 结案会丢失仍开放的入场。即使另生成一份带收悉回执的正文，普通校验也会拒绝给未经分类的旧入场写入 `acknowledged`。

### 玩家操作和方案取舍

1. 在三阶段工作流选择「修复旧通知回合」，选中一条具体入场。界面展示事件名称、ID、已呈现状态和入场提示，原正文可展开查看或复制。
2. 只有在确认这是无需批准、选择、回应或参与的纯通知时，才勾选确认。另需确认「在本幕读完或听完」，主角才能执行这项新行动。关闭对话框与放弃修复均不发出请求。
3. 明确点击「确认重做正文」才启动一次现有手动 Story 流程，连接模型时可能收费。原行动保留。取消或校验失败时，全文与下游候选原样保留。新正文合法保存后，旧 Variables 与 World 候选失效。
4. 玩家随后自行选择「继续未完成阶段」。Variables 与 World 使用新正文重验并结算。此时只需要 Variables 和 World 请求，无须再生成 Story。两阶段都须开启，使用原有 Web Locks 请求保护。

采用方案 B，为一条旧入场颁发一次性收悉授权。方案 A 需要在独立维护事务中改变正式事件分类，还要额外维护撤回、旧客户端和并发语义。现有正文不足以证明汇报已听完，仅追加结构化回执会把尚未完成的动作写成既成事实，故采用显式重做。除生产端既有的请求策略外，恢复入口自身不排队、不重试、不自动启动下游。

### 作用域和安全性

- 恢复资格以当前保存版本和本轮已验证的 Variables 投影为依据。只列出当前普通回合中已经到期、两个投影均为开放 `presented` 且缺少分类的子事件。旧草稿可能只保存通用 `invalid_output`，因此这是可尝试恢复的资格，不能据此断言 World 的唯一失败原因，更不能自动分类。 [恢复资格](../src/domain/legacyNotificationRecovery.ts)
- Story 拿到 Web Lock 后先核对正式和草稿版本。只向本次 Story 增加选中身份、玩家明确的新动作和旧正文。Story 负责据本幕事实确认实际收悉，遇到仍需决定的请求不得提供该回执。仓库在同一事务重验完整草稿和资格，在新正文确有目标回执和合法证据、其他事件裁定原样保留时才替换草稿。版本竞争或写入失败全次拒绝，原正式世界未参与写入。 [Story 请求](../src/workflows/storyStage.ts) · [仓库事务](../src/services/storage/saveRepository.ts)
- 授权绑定存档、正式版本、回合、Story 版本、签发草稿版本、事件、入场和玩家的两项确认。普通草稿路径不可创建、替换或将它搬到另一份正文。Variables 只复验这些身份并应用程序生成的回执，无新增认知判断。原入场分类仍为空，正式记录只标记这次收悉的玩家恢复来源。该回执不给予提前结案、批准交易或其他现场介入权。World 仍按原 `fixedEndAt` 结业务，原有非法候选拒绝与独立后台推演照常。 [授权结构](../src/domain/events/legacyNotification.ts)
- 正式提交重走同一投影与重验，保留原子 Commit 和回执幂等。正常完成只推进一次正式版本。撤回恢复原 `presented`，不会复活旧授权。已有事件引用、清理和归档继续使用原机制。
- 正式状态和草稿有可选新字段，GameState 版本与 IndexedDB 结构未升级。现有数据无需迁移。合法的本机恢复草稿可以刷新继续。备份仍可保存原始数据，导入时仅跳过含未消费本机恢复授权的草稿并给出提示，正式状态可照常导入。已正式收悉的存档与历史收藏照常备份、导入和预览。旧严格客户端不能识别新恢复标记或第二阶段的新回执。

### 验证与对照

Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。所有模型请求均 Mock。先红用例确认原候选在 `event_entry` 被拒绝、旧实现没有替换草稿的安全入口。恢复后，唯一目标收到收悉状态，无后继仍按时结案，第二条待决事项及无关 NPC、组织、任务、经济保持原样。负例覆盖未明确确认、模型未返回合格收悉、证据过长、索引不匹配、普通保存尝试伪造授权、第二标签竞争及写入异常。

相同开局和普通回合请求通过真实 Composer 对照第二阶段。Story 只改共享输出说明，普通上下文保持一致。Variables、Memory 的消息不变，World 只改变命令目录中程序生成的入场来源说明。两个浏览器项目都从实际 React 应用、正式 IndexedDB 和旧失败草稿出发，验证重新生成、刷新、三阶段结算和撤回。浏览器也验证查看原正文、请求数、放弃恢复、生成失败、取消和请求中的刷新。

| 批次 | 通过 / 失败 / 跳过 | 退出码 |
| --- | --- | --- |
| 第二阶段 HEAD 上新增旧草稿最小用例 | 0 / 1 / 0，旧候选仍被拒绝，安全恢复路径尚不存在 | 1 |
| `npm ci` | 按锁文件安装 143 包 | 0 |
| 本阶段十组定向 Vitest | 229 / 0 / 0 | 0 |
| `npm run prompts:check` | 93 / 0 / 0 | 0 |
| 本机 Git 子进程与兼容回归复测 | 22 / 0 / 0 | 0 |
| 前一阶段同一干净 main 的双端既有控制组 | 6 / 0 / 0 | 0 |

早期 Chromium 批次中，手机版通过两项新场景。桌面初版错误复用了只在手机显示的对话框页脚，已改用双端共用的对话框内容区。随后双端扩大批次有 14 项通过，两个桌面恢复用例在撤回或重开恢复入口时达到 30 秒测试上限。为这两个包含多页及多次重载的长场景在最终复测单独设定 60 秒上限，保留交互与数据断言。默认沙箱另有一轮无法启动本地浏览器服务，未执行用例。首次全量 Vitest 运行期间加入了阶段开关反馈断言，导致 4451 项通过、1 项因加载旧实现失败。另一个默认沙箱批次的公告测试与同环境 main 同样无法执行本地 shell，报 `spawnSync sh EPERM`。开放本地测试权限后，对应公告及旧通知回归共 22 项通过。最终全量批次、双端成绩及 GitHub CI 链接统一记录在固定提交的 PR 描述；各批次不累计。

改动按路径归类：

- 恢复与投影：`src/domain/{commands,drafts,state,legacyNotificationRecovery}.ts`、`src/domain/events/{interactions,legacyNotification,schema}.ts`。
- 请求、重验及保存：`src/prompts/context.ts`、`src/services/ai/runtime.ts`、`src/services/storage/{backup,saveRepository}.ts`、`src/services/validation/{commandCatalogSchemas.json,turnCommit.ts,worldDiagnostics.ts}`、`src/workflows/storyStage.ts`。
- 双端界面：`src/ui/game/{GameScreen.tsx,LegacyNotificationRecoveryDialog.tsx,useStoryGeneration.ts,useTurnGeneration.ts}`。
- 提示词和回归：`prompts/shared/06_story_output.md`、`prompts/{manifest,sources.lock}.json`、`src/tests/{issue-194-legacy-recovery,prompts,talent-context}.test.ts`、`src/tests/fixtures/talent-issue-194-prompt-baseline.json`、`e2e/issue-194-entry-handoff.spec.ts`。

### 提交与剩余限制

第三阶段基于 PR #198 的第二阶段提交 `399ab887e6f08346dc002e0df03c03e37f055674`，执行时 main 为 `089723c2e1e0aa608afe9820a87b1f6a36ef385b`。最终固定 SHA 和该提交的持续集成链接见 [PR #198](https://github.com/WJT111222/HeiJinWangChao/pull/198)。

恢复按所选的一条入场授权。其他真正开放的互动仍需原协议处理。如果同回合涉及多个待处理入场，恢复不会替玩家批量关闭它们。旧资料没有可靠分类时，以玩家明确选择和 Story 本幕结构化事实为边界，程序不进行第二次剧情语义判断。未使用真实玩家存档或真实模型，旧客户端降级及真实模型对该协议的遵循仍需独立验证。
