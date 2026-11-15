# PR #162 常驻多功能按钮 · Node 24 最终工程验收

验收日期：2026-11-16（Asia/Shanghai，原始日志使用 UTC）。

## 基线与同步

- 原 PR HEAD：`e0a92ccdb8fbd5d65bf3aaa33278a40c83d53a4c`。
- 开始时 main / 首轮对照：`5ba35a859853c66501451e1a8cb3a1cdcf221aa0`，包含 #160；首次同步提交为 `830e7375a4116b3149cdc82b18ab1dc7a625edc6`。
- 验收期间检测到正式 main 前进至 `6a348898de4dd8aa1e87ea819da050feb0511564`，#161 已由本任务之外的操作合并。
- 再次仅同步正式 main，最终验收代码提交为 `d1783625613e273b405e91e91e32b31193321882`；最终对照也更新到 `6a348898…`。
- 分支：原 `feat/persistent-workflow-button`，使用独立工作树。

采用 merge，同步无冲突，保留原常驻按钮、PC/手机样式及输入恢复逻辑。`GameScreen.tsx` 使用 `./StoryReadingView`、`./TurnChangesView` 两条正确 import；组件体和数据逻辑来自 #160，未回退旧文件名。

本轮除两次同步正式 main 外，没有修改生产代码。新增内容仅为定向验收测试、报告和证据。#161 的远端合并不是本任务执行的；本轮未修改其分支或实现，其运行时/设置/阶段文件对最终 main 无差异。主干变化后重新安装依赖、完整检查及双端测试，不沿用首轮成绩放行。

## 环境与正式命令

Node **v24.19.0**；Chromium **154.0.8037.57**；Linux。PC 为 1440×1000，手机为项目 Pixel 7 的 412×839 视口模拟。PR 与 main 对照使用同一 Node/Chromium、独立 `npm ci`、独立 node_modules/Vite 缓存与端口，未共用工作树。

### 最终主干 `6a348898…` 的正式结果

| 独立批次 | 退出码 | 通过 | 失败 | 跳过 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `npm ci` | 0 | — | — | — | 主干更新后重新按锁文件安装 |
| `npm run check` | 0 | 3965 | 0 | 0 | 161 Vitest 文件；文件名、ESLint、TypeScript、命令目录和生产构建均通过 |
| `npm run prompts:check` | 0 | 93 | 0 | 0 | 3 文件 |
| 原常驻按钮文件 + 补充验收文件，双端同一批次 | 0 | 20 | 0 | 0 | 原有 10 项及补充 10 项均实际执行 |
| `git diff --check` | 0 | — | — | — | 无差异格式错误 |
| 当前 PR 的旧 `game.spec:299` | 1 | 1 | 1 | 0 | 桌面通过，手机失败，详见下节 |
| 最终 main 的同一旧用例 | 1 | 1 | 1 | 0 | 同环境同一处失败，新基线重新复现 |

最终完整 Vitest 用时 224.26s。构建仅有既有大 chunk 提醒。没有运行全量浏览器套件，也没有用 Cloudflare Preview Build 替代正式命令。

### 首轮 `5ba35a8…` 记录（保留，不充当最终结果）

- npm ci / check 退出码 0；159 文件、3906 通过、0 失败、0 跳过，Vitest 177.80s，Lint/类型/构建通过。
- Prompt 93 通过；原有双端 10 通过；补充先 8 通过，再增加主动改字 HTTP 失败 2 通过，均为独立批次。
- 追加补充文件后 TypeScript / ESLint 通过。
- 旧设置用例在 PR 和当时 main 上分别都是 1 通过、1 失败，0 跳过。

两轮没有相加冒充一次全绿；首轮原始输出及错误快照仍保存，最终依据 `*-main6a.log` 与最终对照。

## 重点功能的实际证据

最终 20 项中的原有 10 项覆盖常驻禁用完成态、取消/继续切换、正文失败文字回填、成功后仅清除未改动原文、已修改文字保留，以及手机不再折叠进回合操作。

最终 20 项中的补充 10 项，通过真实 App、正式 Repository 和 Runtime 执行：

1. **World 待继续**：已选 Story 与已验证 Variables 保留，只发一个 World Mock POST；随后正式 Commit。没有重新请求 Story/Variables。
2. **Variables → World → Commit**：请求顺序严格为 `variables, world`。World 尚未返回时，正式存档与原状态相等；Variables 候选已验证。完成后 `turnNumber`、`revision`、journal 各只增加一次，新的待输入草稿为空且失败记录为空。刷新不追加请求。
3. **保存中禁止取消**：分别暂停 Story 的真实 `saveDraft` 入口和正式 `commitTurn` 入口。界面进入“正在保存…”且常驻按钮原生 disabled；对 disabled 元素调用原生 click 不会取消。放行后仍调用原 Repository，候选及正式提交正常完成。
4. **主动改字后 HTTP 失败**：常驻按钮仍使用已绑定的原行动；Mock HTTP 401 后，玩家输入的新文字保持原样，正式状态不变，没有 Story 候选或重复请求。
5. **无 Web Locks**：模拟 API 缺失，常驻正文按钮与发送按钮均在 HTTP 前被拒绝。编辑文字保留，草稿与正式状态完全相等，Model POST 为零；刷新不自动请求。

保存期测试只在本地 Vite 响应中为 Repository 方法加等待门，随后将原参数转发原方法，不替换校验、事务或返回值。它验证真实保存入口与 UI 阶段边界；不将等待门描述成已经在活动 IDB 事务中间暂停。模型网络全部 Mock，没有收费服务调用。

[结构化阶段/结算结果](pr162-acceptance/evidence/)记录了请求顺序以及正式回合/版本由 1 到 2 的变化；没有把“调度函数执行”当作真实 HTTP 请求。

## 旧 E2E 的本轮同环境对照

用例：`e2e/game.spec.ts:299`，四类设置可键盘操作、保存恢复。以下为主干更新后重新执行的结果，不引用第一轮成绩代替。

- 最终 PR 与 `main@6a348898…` 的测试文件 SHA-256 均为 `13090a3789f685975518f81008bead111666195c49083803abcea637641375a0`，文件字节完全相同。
- 相同 Node/Chromium、相同项目与 Mock/页面流程、workers=1、retries=0，均为桌面通过、手机失败。
- 失败都在 **第 311 行**：直接寻找精确名称为“提示词”的按钮，等待 30 秒超时。
- 两份页面快照均显示手机已进入“AI 连接”，可见“返回设置”，分类导航此时隐藏。
- `src/ui/settings/SettingsPanel.tsx` 的 `settings-nav` 在手机非目录页设置 `hidden`；应先返回设置目录再选分类。旧用例从 AI 连接直接点击分类，不符合当前手机导航。

归类为已在最终 main 复现的旧测试导航适配问题（P2），不是以历史偶发超时推断“既有”。本轮没有修改这条旧测试、放宽断言或调整设置页。该移动用例在失败后的设置保存断言尚未执行，不能声称移动设置完整链路已经通过。

原始 HEAD/main 日志、完整错误快照分别保留；[对照摘要](pr162-acceptance/evidence/main-comparison.json)列出版本、文件校验值、停止点与未执行范围。这一红项仍需在后续独立测试维护中处理。

## 真实 React 截图

| 场景 | PC | 手机 |
| --- | --- | --- |
| 正文候选保存期间禁止取消 | [截图](pr162-acceptance/screenshots/story-saving-desktop.png) | [截图](pr162-acceptance/screenshots/story-saving-mobile.png) |
| 正式结算保存期间禁止取消 | [截图](pr162-acceptance/screenshots/commit-saving-desktop.png) | [截图](pr162-acceptance/screenshots/commit-saving-mobile.png) |
| 只补 World 后完成回合 | [截图](pr162-acceptance/screenshots/world-settled-desktop.png) | [截图](pr162-acceptance/screenshots/world-settled-mobile.png) |
| 改字后再次失败仍保留输入 | [截图](pr162-acceptance/screenshots/edited-failure-desktop.png) | [截图](pr162-acceptance/screenshots/edited-failure-mobile.png) |

[原始日志与错误快照归档](pr162-acceptance/raw-logs.zip)逐批保留 `.log` 和 `.exit`；归档校验值见同目录 README。失败 trace、所有原始截图及更多中间材料另保存在 `/workspace/pr162-engineering-acceptance/`，可通过验收附件下载。

## 结论与范围

最终主干上的正式工程检查、用户指定 10 项测试及补充 10 项关键交互通过；没有观察到 PR #162 新增失败。不能宣称本次所有 E2E 全绿：旧手机设置用例在当前 main 与 PR 均失败，已明确保留。

本轮没有另行更改 Schema、存档、领域权限、Commit/CAS/Undo、Prompt、模型配置或收费机制；#161 仅随已合并的正式 main 原样保留，未修改其实现或分支；没有修改或删除玩家真实数据。未合并、未执行部署，等待十二代目对最终 HEAD 复审。

测试使用 Chromium 手机视口模拟及 Mock，不代表所有手机真机、Safari 或真实供应商取消/计费表现得到验证。
