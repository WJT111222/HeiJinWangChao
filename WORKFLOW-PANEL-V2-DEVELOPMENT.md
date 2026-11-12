# 三阶段详情面板 v2（PC）

基线：`main@a8334e8`（PR #115 合并后）。

## 改造范围

只改 PC（宽度 > 900px）的「三阶段详情」浮层和收起状态条。移动端仍用原来的折叠卡片，输出不变。

原来的浮层是三张并排的阶段小卡，加上「查看变量/世界候选」两个弹窗，以及「重试与变更详情」「本回合已绑定输入」两个底部折叠区。原文、日志、Token 用量和叙事规划都叠在同一个折叠区里，层层嵌套。

现在合成一个面板：

- **标题**：状态点 + 现有状态文案、跟随最新正文、收起。
- **提示横幅**：错误（含安全失败码、打开 AI 设置）、阶段设置提示、草稿过期，统一放在标题下面。「展开高级设置」改为「前往阶段开关」：直接选中关闭的阶段并聚焦它的开关。
- **左侧导航**：01 正文 / 02 变量 / 03 动态世界，显示各自状态；变量和世界的启用开关在这一行右侧。下方「本回合」有「运行诊断」（错误数徽标）和「已绑定输入」。
- **右侧详情**：
  - 正文：概览 / 模型原文 / 叙事规划 / 校验结果。
  - 变量、世界：概览 / 候选 / 模型原文 / 校验结果。原候选弹窗的内容（计数、版本号、命令列表、「主动查看完整候选」JSON）搬进「概览」和「候选」页。
  - 候选明细只在玩家主动切到「候选」页时渲染，概览只显示计数和版本号，和原来点击才查看的边界一致。
  - 运行诊断：摘要字数、安全失败码、运行日志（单条复制 / 清空）、全部请求 Token 用量。各阶段概览只显示该阶段的请求用量。
- **底部操作栏**：自动生成 / 继续未完成阶段 / 完成本回合结算 / 取消自动执行，以及费用提醒。
- **收起状态条**：三段进度改为按钮，可点击、可 Tab 聚焦，Enter/Space 打开对应阶段（只切换视图，不发请求）。

默认视图：未手动选择时，依次跟随正在运行的阶段、第一个失败的阶段、第一个待生成或仅预览的阶段、关闭的阶段，都没有时显示正文。手动选择后保持不变；收起面板后恢复自动。

## 未改动

数据、草稿、协调器、各阶段 Hook、生成/取消/结算回调、禁用条件、请求、存储、Prompt 都没有改动。阶段按钮的文案和禁用条件从原 JSX 原样提取成 `stageActions`，移动端和 PC 共用。没有删除字段或提示文字；长说明改成小号注释。

代码：

- 新增 `src/ui/game/WorkflowPanel.tsx`。
- `GameScreen.tsx`：PC 分支改用新组件，移动端 `workflowBody` 去掉 PC 专用分支，输出等价。
- `RequestUsage` 增加可选的 `stage` 过滤。
- `StoryInspectionPanel` 增加 `inline` 模式（切到页签即视为主动查看）。
- `workflow-feedback.css`：PC 部分重写，移动端部分不变。

## 测试修改

`e2e/helpers/gameLayout.ts` 新增 `openWorkflowStage`、`openStageTab`、`openStageRaw`、`openStageCandidates`、`openCandidateRaw`、`closeStageCandidates`、`openStoryInspection`、`openBoundInput`。`openWorkflowDiagnostics` 在 PC 上改为点左侧「运行诊断」。移动端保持原流程。

需要先选阶段的地方（生成/重新生成/取消/补算按钮、候选、模型原文、叙事规划），相关用例都改为先调用上述 helper。断言内容不变；只有两处随结构调整：

- PC 收起条可见按钮数从 1 变为 4。
- 多错误分组改用 `.wf-banner-msg > p` 计数。

`.workflow-stages > li`、`getByLabel('变量管理'/'动态世界')`、`data-testid="runtime-log"` / `summary-length`、`region「本次请求 Token 用量」` 都保持可用。

第二轮在 `e2e/workflow-feedback.spec.ts` 新增（只新增，没删任何原有断言）：

1. PC 收起条三段：Tab/Shift+Tab 聚焦、焦点环、Enter/Space/点击打开对应阶段，Esc 后焦点回到「详情」；不发请求，存档不变。
2. PC 页签：`aria-selected` / `tabindex` / `aria-controls` / `aria-labelledby`；←/→/Home/End、Tab 进出页签内容、鼠标点击；概览不渲染候选明细；完整 JSON 需主动展开、可收起；正文阶段的「叙事规划」页。
3. PC 阶段开关：切换阶段不改开关、切换开关不改阶段，「前往阶段开关」聚焦对应开关，Space 切换；Tab 可离开面板（无陷阱），Esc 后焦点回到「详情」。
4. PC 结算状态：ready 显示「未正式结算」「程序校验通过 · 仍未正式结算」和「完成本回合结算」；settled 显示「已结算」「本回合已结算」，没有结算按钮。
5. PC 失败：失败阶段标记、「继续未完成阶段」可用、单阶段「生成世界候选」可用、诊断含安全失败码。
6. 手机：没有 PC 面板和页签；三张卡片、候选弹窗、诊断折叠、三阶段原文块、绑定输入、开关都按原样存在。

取消与恢复的实际流程沿用已有用例（「生成中：浮层关闭不取消请求…」、world/variable-runtime 的取消用例），第二轮没有新增真实请求。

## 键盘与 ARIA（第二轮）

- **收起条三段**：普通 `<button>`，按 Tab 顺序可达，有清晰焦点环（`:focus-visible`）。Enter/Space 打开面板并选中对应阶段；`aria-controls="workflow-pop"`。
- **左侧导航**：`<nav aria-label="三阶段导航">` 内的按钮，当前项为 `aria-current="true"`，`aria-controls="wf-detail"`。它是视图切换，不是页签，所以没用 tab 角色。
- **右侧页签**：标准 WAI-ARIA Tabs。
  - `tablist`（`aria-label`「X内容」）里，每个 `tab` 都有 `id`、`aria-selected`、`aria-controls`；`tabpanel` 有 `id` 和 `aria-labelledby`（指向当前页签），`tabIndex=0`。
  - roving tabindex：只有选中的页签在 Tab 顺序中。
  - ←/→ 循环切换，Home/End 跳到首尾，切换即激活并移动焦点；Tab 从页签进入页签内容。
  - 概览里的「查看候选明细 →」切到「候选」页，并把焦点移到该页签。
- **阶段开关**：`<input type="checkbox">` 与导航按钮是兄弟元素（不嵌套），切换只改启用设置，不切换视图；切换视图也不改开关。
- **前往阶段开关**：PC 上选中提示所指的阶段（变量未启用→变量，否则→世界），并聚焦该阶段自己的开关（`input[data-stage]`）。移动端保持原逻辑。
- **焦点**：Esc、× 或「详情」收起面板时，焦点回到「详情」按钮。面板内没有焦点陷阱，Tab 可以依次离开面板进入输入区。

## 验证状态

**下列工程测试均未在本环境运行，不能视为通过：**

- `npm ci`
- `npm run check`（lint / vitest / typecheck + build）
- `npm run test:e2e`（desktop 与 mobile 两个项目）
- 真实游戏截图

原因：环境无法安装依赖。正式验证由具备完整环境（Node 24、Vitest、Chromium）的 Codex 执行。

已做的仅限辅助性静态检查：用 DefinitelyTyped 的 React 类型、Zod 源码和全局 Playwright 类型临时跑 `tsc --noEmit`。改动文件和全部 e2e 文件没有出现类型错误；剩余报错只来自缺少 vitest、Node 和 Vite 的类型。这项检查不等于项目的 typecheck。第一轮那张静态页面截图只用于核对样式，不代表真实页面。

## Codex 最终工程验收（2026-11-13）

验收基线为远端 `e3dd05436e0cb812d5ae0cdb9610faa079531e6b`，与用户指定一致；原分支 `claude/workflow-panel-v2`，base/main 为 `a8334e8f9429b0423eab01690f3751dce96a227c`，包含合并的 #115。Node v24.19.0，npm ci 实际安装 143 个锁定依赖。此前“未运行”的记录仅描述 Claude 开发环境，以下为本次独立真实执行记录。

新增 `e2e/pr117-acceptance.spec.ts` 在真实 React 游戏、合成存档上检查 1440、1280、1100、901px 桌面及 390px 手机：长正文滚动、候选主动查看、输入框与面板位置、无横向溢出、视图操作零模型请求、正式状态不变、刷新恢复。四个桌面视口截图与重载共用一个测试，因此测试预算为 90 秒，未改原有测试超时或断言。

### 测试编排失败记录

初始全量浏览器批次原计划 700 条：2 通过、2 失败、2 中断、694 未运行。原因是并行截图运行共用默认 test-results，互相清理 trace 产物导致 ENOENT；不能视作游戏业务失败，也不能视作完整验收。该截图批次 2 失败（桌面还发生点击超时），同样不计为成功。已停止受污染批次，后续全量改用独立 `/tmp/pr117-e2e-final-results`，包含新增两条验收测试；不与中断批次拼接成绩。

### 最终结果

- `npm ci`：成功，安装 143 个依赖。
- `npm run check`：退出码 0；Lint 通过，Vitest **128 文件、3234 通过、0 失败、0 跳过**；TypeScript 与生产构建通过。构建仅提示已有的大 chunk 体量警告。
- `npm run prompts:check`：退出码 0，**3 文件、93 通过、0 失败、0 跳过**。
- 完整 Chromium 批次按用户最新指令停止：**276 通过、25 失败、2 中断、1 跳过、398 未运行**，退出码 130，42.5 分钟。详见 `docs/pr117-acceptance/full-interrupted-results.json`；Playwright 汇总 JSON 将未运行项合入 skipped，本报告按终端真实结果明确拆分。不能声称全量通过。
- 按新范围改跑 `workflow-feedback`、`action-workflow`、`automatic-settlement`、`pr117-acceptance` 四文件（桌面/手机，单 worker）。结果：**87 通过、0 失败、7 预期跳过**，退出码 0，8.3 分钟。桌面 46 通过/1 手机专用跳过；手机 41 通过/6 PC 专用跳过（其中 ready/settled 是两个独立用例）。明细见 `docs/pr117-acceptance/targeted-results.json`。所有网络场景使用 Mock，没有调用真实模型。

### 中断批次的未解决项与范围

25 项失败包含旧首页/档案定位（未进入存档馆、未选择事件详情、旧 `.modal-body` / `.detail`）、旧阅读对齐断言，以及 30 秒总时限或 5 秒异步等待超时。失败详情逐项保留在上面的清单。相关生产路径静态对照 main 未变化，但**没有完成独立 main 浏览器对照，不能据此宣称全部都是 main 已有失败**。用户随后明确取消全量、限定工作流相关回归，因此不继续扩张创角、NPC 总结、天气或档案改造，也不删除/跳过/放宽这些失败断言。

本次提交前实际 `git var GIT_AUTHOR_IDENT` 与 `git var GIT_COMMITTER_IDENT` 均使用公开昵称 Wood 和指定 GitHub noreply 邮箱。

### 定向验收结论与真实截图

本轮定向回归全部成功，未发现需要修复的生产 UI 问题；没有修改生产代码、领域逻辑、Schema、Prompt、事务或既有测试断言。新增验收用例只操作合成存档，检查候选、长正文滚动、刷新、面板/输入位置、只读状态与零额外模型请求。此前全量的 25 个失败未因定向通过而被抹除，也没有宣称已全部确诊或修复。

- [1440px](docs/pr117-acceptance/react-1440.png)
- [1280px](docs/pr117-acceptance/react-1280.png)
- [1100px](docs/pr117-acceptance/react-1100.png)
- [901px](docs/pr117-acceptance/react-901.png)
- [390px 手机](docs/pr117-acceptance/react-390.png)

截图均为实际 Chromium React 游戏页面。PC 窄宽度标题/标签换行、详情内部滚动，结算按钮与输入不重叠；手机保留原卡片与候选弹窗。`docs/workflow-feedback/screenshots` 同步保存阶段状态、候选、错误、撤回/设置对话框等实际截图。

最终新增测试后的 Lint 与 `git diff --check` 通过。此前完整工程检查与 Prompt 检查结果独立保留，不与浏览器中断或定向批次相加。构建仅有 chunk 体量提醒；Mock 结果不代表真实模型质量验收。PR 保持未合并，无部署、无真实收费调用。
