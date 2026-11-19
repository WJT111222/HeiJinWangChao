# Issue #194 · 子事件到期与未处理入场

Refs #194

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
