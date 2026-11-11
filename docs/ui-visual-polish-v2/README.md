# UI-2「夜幕金印 2.0」验证记录（PR #105）

本目录只存放验证证据与截图，不是产品规则。所有结论以下列日志与当前源码为准。

## 1. 1200px 临界宽度（Review #105-1）

修复：宽屏阅读区与输入区最小内边距 88px → 40px；901–1199px 顶部状态条中地点与天气各自截断。

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

### 1.1 用户确认：正文放宽（第二次返修）

用户试看后要求正文更宽。宽屏改为正文铺满中栏（两侧至少 40px），上限 1100px，接近 UI-1.1 的阅读宽度。实测正文 / 行动区 / 输入区宽度（px）：

| 视口宽度 | 1199 | 1200 | 1201 | 1280 | 1440 | 1650 | 1920 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 宽度 | 909 | 666 | 667 | 746 | 895 | 1076 | 1090 |

1200–1201 仍受三栏中栏宽度限制（约 666px）。`pc-reading-layout.spec` 的宽屏区间同步更新。布局相关用例日志：`e2e-ab/head-wide-layout-suites.log`（30 通过、3 跳过、3 失败：`night-seal:88` ×2 与 main 相同；`game-window:66` 手机一次失败，单独重跑两次均通过，本次改动只涉及 ≥1200px 样式，判断为负载下的偶发失败）。截图 `breakpoint-*.png` 已更新为放宽后版本。

## 2. 工程检查（Review #105-2）

**此前 Claude 开发会话未运行；后续标准环境已补齐检查，见第4节。** 原开发会话环境为 Node 22.23.4（项目要求 Node 24），且无法访问 npm registry（`npm ci` / `npm view` 均因 DNS 失败），因此 `npm run check`（lint、vitest、typecheck、build）与 `npm run prompts:check` 均未执行，不能视为通过。需在具备 Node 24 并可 `npm ci` 的环境补跑。

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


## 4. 移除正文结算装饰（本轮）

按玩家要求移除已结算正文上的朱砂装饰及专用class/data属性，没有新增替代装饰。章回标题、剧本式对白、1100px中栏上限、紧凑工作流、右侧资料坞和抽屉保持原样。品牌及资料坞的功能图标保留。

`ui2-breakpoints.spec.ts`扩展至1199/1200/1201/1280/1440/1650/1920，并检查已结算正文的伪元素不再生成内容、正常章回标题仍显示；原有宽度、对齐、长地点/天气/环境和无溢出断言均保留。所有当前展示截图重新由真实React页面生成，不沿用带有已移除装饰的旧图。历史日志保留原批次事实，不改写旧测试成绩。

### 实际验证结果（Node.js24.19.0，标准项目依赖）

本轮基于已审查HEAD `7110fead51fd0d8e20ebf6ccf1125f030cc87026`，只删除装饰及其定位上下文；不修改Story/Variables/World、Prompt、Schema、存档或事务。

| 独立批次 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| `npm run check`完整Vitest（117文件） | 3061 | 0 | 0 |
| `npm run prompts:check`（3文件） | 93 | 0 | 0 |
| 开发期间相关Chromium（5文件，桌面+手机） | 31 | 2 | 3 |
| 代码冻结后直接相关Chromium（3文件，桌面+手机） | 11 | 2 | 1 |
| 截图与无装饰补测（含390px） | 2 | 0 | 0 |

`npm run check`的Lint、TypeScript、生产构建均通过；构建仅有既有大于500kB分包提示。`git diff --check`通过。

冻结后最终浏览器批次：desktop为6通过/1失败/0跳过，mobile为5通过/1失败/1跳过。实际命令：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/ui2-breakpoints.spec.ts e2e/story-reading.spec.ts e2e/night-seal.spec.ts \
  --project=desktop --project=mobile --reporter=list,json \
  --output=/workspace/pr105-no-stamp-evidence/final-results
```

两个失败仍为`night-seal.spec.ts:88`的既有定位器冲突：`/来自很远地方/`同时匹配“查看人物”和“取消特殊身份”按钮。此前本次PR工程验收已在未改main `49ea8695c5df17fee07549ed27edd34ab95ea200`的相同Node24标准依赖下，单worker分别复现desktop/mobile两项同样失败；本轮保留原用例与断言，不作无关修复。跳过为原有仅桌面适用用例，不是本轮新增skip。各批次分开记录，不相加冒充全绿。

已目视核对新1440px及390px真实React截图：朱砂装饰消失，首段正文不再被覆盖；其他品牌/资料坞图标保留。九张当前展示图片均重新生成，章节、对白、行动、工作流和抽屉相关回归继续使用本地Mock。没有真实付费模型请求、自动合并或主动部署。
