# 三阶段工作流 UI 精简

基线：最新远端 `main@c01eed35dfbbcbb30dced66711d2c71d00635994`（PR #66 合并后）。分支：`codex/compact-workflow-ui`。

## 改造范围

生产代码只修改 `src/ui/game/GameScreen.tsx` 与 `src/app/styles.css`。

原来折叠区外仍有自动执行按钮、错误块、运行日志和模型原文入口，手机端状态条也会换行。展开后还有流程介绍、候选保留说明、重复的手动操作说明和常驻 Token 信息。

现在默认只有状态与「详情」箭头。自动开始、恢复、取消、单阶段生成与重新 Roll 都在详情中；三阶段在桌面为三列，窄屏为紧凑纵向排列。阶段开关、候选查看和本回合已绑定输入仍可访问。日志、原始模型响应、Token 用量和叙事规划统一放在已有的「重试与变更详情」中。

删除流程介绍、自动保留上游说明、按钮旁候选失效说明、绑定输入说明与底部重复结算状态，保留简短费用提醒及真实错误、阶段关闭/预览/过期草稿的处理指引。行动选项仍在正文阅读区域尾部，自由输入与发送按钮保持可见；详情内容使用原有内部滚动区。

## 状态与交互

- 状态由现有 `automatic.progress`、手动阶段 `phase`、草稿状态、运行日志和 `awaitingPlayerAction()` 派生。正文/变量/世界分别显示 `1/3`、`2/3`、`3/3`；保存和重试显示其真实阶段状态，不制造时间进度。
- 正式结算中显示「正在正式结算」，完成后显示「本回合已结算 · 等待行动」。提交下一条行动时显示「正在发送行动」。没有有效草稿或阶段被关闭时不伪装成生成完成。
- 失败在状态条标出阶段与「查看详情」，不强制展开。详细安全错误、单条诊断复制、原文和恢复操作均保留。
- 仍使用原生 `details/summary`，支持键盘 Enter/Space。展开只切换 DOM 展示，内部组件持续挂载；没有新增生成 effect、请求、重试、Hook、持久化状态或开关。
- `send()`、创角启动授权、各阶段 Hook、协调器、领域命令、候选校验、原子 Commit、CAS、存档/Prompt/模型路由均未修改。使用同一批现有操作回调与禁用条件。

## 截图

全部由隔离浏览器测试存档生成，不包含玩家正式数据。改造前截图来自上述 main 基线，改造后截图来自本分支测试。每组使用相同长正文夹具与视口。

| 视图 | 修改前 | 修改后 |
| --- | --- | --- |
| 桌面收起 | [查看](docs/screenshots/compact-workflow/before-desktop-collapsed.png) | [查看](docs/screenshots/compact-workflow/after-desktop-collapsed.png) |
| 桌面展开 | [查看](docs/screenshots/compact-workflow/before-desktop-expanded.png) | [查看](docs/screenshots/compact-workflow/after-desktop-expanded.png) |
| 移动收起 | [查看](docs/screenshots/compact-workflow/before-mobile-collapsed.png) | [查看](docs/screenshots/compact-workflow/after-mobile-collapsed.png) |
| 移动展开 | [查看](docs/screenshots/compact-workflow/before-mobile-expanded.png) | [查看](docs/screenshots/compact-workflow/after-mobile-expanded.png) |

## 测试修改

新增四个浏览器场景，各在 desktop/mobile 执行：

1. 暂停三个真实 Mock 请求，检查阶段状态、默认收起、键盘展开、取消入口、绑定输入、折叠时请求数和存档不变；完成后只结算一次，刷新不请求。
2. 默认工作流不超过 44 CSS 像素、无外置按钮/日志/原文入口、被删除的说明不再存在于 DOM；展开保留操作、折叠恢复正文空间，输入不被遮挡，并输出对比截图。
3. 手动正文失败后再恢复，若 World 失败，状态条必须标出最新的 World 错误，而非旧 Hook 留下的正文错误。
4. 另一标签已经绑定草稿时，当前界面发送触发真实 CAS 冲突；状态条显示行动发送失败，保留输入与正式存档，不发出新模型请求。

既有浏览器测试改为在需要操作时显式展开详情/诊断，并将旧的冗长阶段文字断言换成指定阶段列的「已完成」，不会仅凭其他阶段成功判定目标阶段完成。原有请求次数、存储快照、候选内容、余额、错误码、CAS 和事务断言保留。

开发过程中，首轮探索运行发现旧测试仍从折叠区外寻找阶段关闭提示或点击隐藏的诊断入口；已调整测试导航。该批次中途停止（44 通过、7 失败、2 中断、11 未执行），不作为最终验收结果。另一个早期类型检查发现项目 TS 目标不支持 `Array.findLast`，已改用数组副本反向查找，不改变原日志顺序。未为这些问题修改业务校验。

补查时，本轮 UI 初稿的两处显示优先级问题被真实浏览器链复现（两个定向用例均失败）：旧手动错误盖住新的 World 错误；行动绑定发生 CAS 冲突后仍显示等待行动。只在 GameScreen 使用最新运行结果决定错误阶段，并将当前发送失败放在空闲状态之前。既有 `bindTurnAction` 和 CAS 原样保留。两项修复在 desktop/mobile 的 4 次执行均通过。一个暂停请求的新增测试曾在 Mock 收到网络请求前即断言次数，改为先等待实际请求到达，再严格断言折叠前后请求数和数据不变。为完成这些状态显示检查，中间 236 项批次在 55 通过、2 中断、179 未执行时停止；最终结果以下面的生产代码冻结后分批验证为准。

## 最终验证

- `npm run check`：76 个测试文件、2311 项测试通过；Lint、TypeScript 与生产构建均通过。构建仍有大于 500 kB 的 chunk 提示，本轮不改打包架构。
- `npm run prompts:check`：82/82 通过。
- `git diff --check`：通过。
- 相关 Chromium desktop/mobile 回归采用分批验证，不宣称全库或单一全绿批次。主批次 240 项：230 通过、10 失败、0 跳过（desktop 111/120，mobile 119/120）。失败均是旧 UI 文案或隐藏诊断入口断言，下面列出修正与复测。
- 三文件修正复测 66 项：64 通过、2 失败、0 跳过（desktop 31/33，mobile 33/33）。两个失败均是同时运行两批浏览器时，等待「已结算」超过既有 5 秒；快照停在「正在正式结算」，无领域拒绝。未修改超时、事务或数据断言，随后单 worker 原样复测。
- 最后单 worker 复测：6/6 通过（desktop 3、mobile 3），0 失败、0 跳过；两项超时用例未修改断言及超时时间。上述主批次及连续回合专项去重后，共 252 个场景（desktop 126、mobile 126）均有通过结果。不得把重叠的 66 和 6 项与主批次相加，或称主批次零失败。
- 连续正式回合专项 `continuous-turns.spec.ts`：12/12 通过（desktop 6、mobile 6），包括两个端各连续十回合、失败恢复、事务回滚、跨标签竞争、刷新资金与时间一致性。

浏览器均使用 Mock，执行范围覆盖 16 个直接相关文件，另单独执行 `continuous-turns.spec.ts` 的桌面/移动端连续回合回归；不将这些定向结果描述为全库 E2E。

### 失败与修正记录

| 场景 | 首批失败原因 | 最小修正 |
| --- | --- | --- |
| P6 截断 Roll / 原生输出检查 | 点击已移入「重试与变更详情」的隐藏入口 | 显式打开原诊断入口 |
| 变量失败与刷新恢复 | 仍断言已删除的上游保留说明文字 | 断言精确变量失败状态，并实际读取存储验证正文保留 |
| 取消/阶段关闭、两阶段关闭 | 仍断言旧跳过说明 | 断言「阶段已关闭」，原存档与请求数断言保留 |
| 开局/普通自动执行 | 仍断言「整理变量」 | 断言真实阶段「变量生成中 · 2/3」 |
| 瞬时失败重试 | 仍断言旧费用段落 | 断言保留的短费用提醒，原重试次数检查保留 |
| 正文失败刷新 | 仍断言旧失败段落 | 检查正文列的失败状态 |
| 双开关关闭后的世界预览 | 仍断言旧预览长文 | 检查世界列「仅预览」，原 preview 与正式数据检查保留 |

两项并行等待超时是桌面长睡眠不中断、桌面瞬时服务失败重试；移动端同场景已通过。失败日志分别保留在 `/tmp/compact-workflow-frozen-e2e.log`、`/tmp/compact-workflow-updated-tests.log`，Trace 在工作区 `test-results/` 及 `/tmp/compact-workflow-updated-tests/`。这些是当前执行环境诊断材料，不含真实玩家存档，未作为生产文件提交。

### 浏览器执行命令

所有命令均设置 `CHROMIUM_PATH=/usr/bin/chromium`，模型网络请求由测试 Mock。

```sh
npx playwright test e2e/action-workflow.spec.ts e2e/automatic-settlement.spec.ts e2e/game-window.spec.ts e2e/turn-coordinator.spec.ts e2e/story-runtime.spec.ts e2e/variable-runtime.spec.ts e2e/world-runtime.spec.ts e2e/opening-time.spec.ts e2e/opening-life.spec.ts e2e/event-lifecycle.spec.ts e2e/world-handoff.spec.ts e2e/world-scene-contract.spec.ts e2e/story-reading.spec.ts e2e/memory.spec.ts e2e/time-preflight.spec.ts e2e/event-entry-feedback.spec.ts --project=desktop --project=mobile
npx playwright test e2e/story-runtime.spec.ts e2e/time-preflight.spec.ts e2e/turn-coordinator.spec.ts --project=desktop --project=mobile --output=/tmp/compact-workflow-updated-tests
npx playwright test e2e/time-preflight.spec.ts e2e/turn-coordinator.spec.ts e2e/world-runtime.spec.ts --grep '长睡眠interrupt=false|瞬时服务失败|双开关关闭' --workers=1 --project=desktop --project=mobile --output=/tmp/compact-workflow-final-recheck
npx playwright test e2e/continuous-turns.spec.ts --project=desktop --project=mobile --workers=1 --output=/tmp/compact-workflow-continuous
```

## 修改文件

- `src/ui/game/GameScreen.tsx`：展示状态、折叠内容、操作位置和删除冗余文字。
- `src/app/styles.css`：单行状态栏、紧凑阶段布局、焦点样式和移动适配。
- `e2e/helpers/gameLayout.ts`：显式打开详情及诊断的测试辅助函数。
- `e2e/action-workflow.spec.ts`、`e2e/game-window.spec.ts`：新增布局/状态回归及现有交互适配。
- `e2e/automatic-settlement.spec.ts`、`e2e/continuous-turns.spec.ts`、`e2e/event-lifecycle.spec.ts`、`e2e/opening-life.spec.ts`、`e2e/opening-time.spec.ts`、`e2e/story-reading.spec.ts`、`e2e/story-runtime.spec.ts`、`e2e/time-preflight.spec.ts`、`e2e/turn-coordinator.spec.ts`、`e2e/variable-runtime.spec.ts`、`e2e/world-handoff.spec.ts`、`e2e/world-runtime.spec.ts`、`e2e/world-scene-contract.spec.ts`：仅调整新展示入口及对应阶段文字断言。
- 本报告及 `docs/screenshots/compact-workflow/` 下的桌面、移动端前后截图。

## 验证边界

只使用本地 Mock，不调用真实付费 API，也不新增付费场景。Chromium 手机项目及 VisualViewport 测试覆盖窄屏与模拟键盘，未宣称完成真实 iOS/Android 浏览器或第三方模型实机验证。没有改动玩家正式存档，不合并，不主动部署生产环境。
