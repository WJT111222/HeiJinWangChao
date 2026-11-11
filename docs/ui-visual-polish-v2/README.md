# UI-2「夜幕金印 2.0」验证记录（PR #105）

本目录只存放验证证据与截图，不是产品规则。所有结论以下列日志与当前源码为准。

## 1. 1200px 临界宽度（Review #105-1）

修复：宽屏阅读区与输入区最小内边距 88px → 40px；印章外移改为 ≥1280px；901–1199px 顶部状态条中地点与天气各自截断。

同一长文本存档（长地点路径、长天气、长环境）在 Chrome 中的实测宽度（px）：

| 视口宽度 | 修复前 `a548526` 正文 / 行动区 / 输入区 | 修复后 `361fb6d` 正文 / 行动区 / 输入区 | 横栏溢出（前 → 后） |
| --- | --- | --- | --- |
| 1199 | 909 / 909 / 909 | 909 / 909 / 909 | 是 → 否 |
| 1200 | 570 / 570 / 570 | 662 / 662 / 662 | 否 → 否 |
| 1201 | 571 / 571 / 571 | 662 / 662 / 662 | 否 → 否 |
| 1280 | 650 / 650 / 650 | 662 / 662 / 662 | 否 → 否 |
| 1440 | 662 / 662 / 662 | 662 / 662 / 662 | 否 → 否 |

1199 → 1200 的宽度变化来自布局切换（顶部状态条 → 左栏 + 横栏），两侧都在可读范围内。`e2e/ui2-breakpoints.spec.ts` 固化上述断言：正文 ≥640px、行动区与输入区与正文对齐、横栏不溢出不重叠且不遮挡左右栏、页面与阅读区无横向溢出、1200 与 1201 宽度差 <4px。修复前版本运行该用例失败（1199 横栏溢出），修复后通过。

截图：`breakpoint-1199x800.png`、`breakpoint-1200x800.png`、`breakpoint-1201x800.png`、`breakpoint-1280x800.png`。

## 2. 工程检查（Review #105-2）

**未运行。** 开发会话环境为 Node 22.23.4（项目要求 Node 24），且无法访问 npm registry（`npm ci` / `npm view` 均因 DNS 失败），因此 `npm run check`（lint、vitest、typecheck、build）与 `npm run prompts:check` 均未执行，不能视为通过。需在具备 Node 24 并可 `npm ci` 的环境补跑。

## 3. E2E 环境与 A/B 对照（Review #105-3）

E2E 运行环境（与 CI/本地标准环境不同）：
- 本机 Playwright 1.63.0 + Google Chrome for Testing 153，Node 22。
- 用一个模拟 Vite 按需转译的本地服务器代替 `npm run dev`；zod 使用本机 zod 3.25 内置的 v4 API，并为本地预览补了 `safeExtend → extend` 别名。
- 直接引用 `/node_modules/.vite/deps/*` 的用例在此环境无法运行。

日志：
- `e2e-ab/head-a548526-full-592.log`：PR 首个提交的全量运行（2 workers）。592 条：574 通过、14 失败、4 跳过。
- `e2e-ab/main-49ea869-14-cases.log` 与 `e2e-ab/head-361fb6d-14-cases.log`：上述 14 项失败所在用例在原 main 与当前 PR 代码上，以相同环境、单 worker 各跑一次。
- `e2e-ab/head-361fb6d-layout-suites.log`：当前 PR 代码的布局相关用例（含新断点用例），桌面+手机：61 通过、2 失败（`night-seal.spec:88`，main 同样失败）、3 跳过。

14 项失败在 main 与 PR 上的对照（单 worker）：

| 用例 | 项目 | main `49ea869` | PR `361fb6d` |
| --- | --- | --- | --- |
| `event-lifecycle.spec.ts:59`（known / partially_known / hidden） | desktop、mobile | 失败 ×6 | 失败 ×6 |
| `night-seal.spec.ts:88` | desktop、mobile | 失败 ×2 | 失败 ×2 |
| `world-events-archive-v2.spec.ts:66`（引用 `.vite/deps`） | desktop、mobile | 失败 ×2 | 失败 ×2 |
| `world-observer.spec.ts:48` | desktop、mobile | 失败 ×2 | 失败 ×2 |
| `world-narrative-conditions.spec.ts:37` | desktop | 通过 | 通过 |
| `world-npc-creation.spec.ts:42` | desktop | 通过 | 通过 |

结论：12 项在两边稳定失败、结果一致；`world-narrative-conditions:37` 与 `world-npc-creation:42` 仅在 2 workers 全量运行中失败、单独运行两边均通过，属负载相关的偶发失败。本 PR 未修改这些用例涉及的功能。不应表述为 592/592 通过。
