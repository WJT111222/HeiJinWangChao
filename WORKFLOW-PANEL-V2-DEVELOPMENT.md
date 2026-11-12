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
