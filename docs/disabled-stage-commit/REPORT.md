# 关闭阶段后的正式结算修复

2026-11-17（北京时间）。交十三代目复审；不合并、不部署、不更新公告。

## 基线与结论

- 基线、交付前再次 fetch 的 `origin/main`：`6e013f47db4ae7947e8218e44f1f917b1fc1f976`，含 #177、#178、#179。
- 已验证的代码提交：`fd5ed0b8132c7e89d411b7c72480b09416217e80`。其后仅增加本报告及证据；最终 HEAD 记录于 PR 与交付消息。
- 独立分支：`fix/disabled-stage-commit`，目标 `main`。
- 结论：本轮 Mock 工程验收通过，未发现新增 P0/P1/P2 阻断。纯小说模式可以连续保存章节，关闭阶段不再阻止正常回合保存。

## 根因与修改

旧 `completeTurnDraft()` 硬性要求两阶段开启、两个候选 ready；Coordinator 只要跳过阶段就返回 skipped；提交验证直接访问两个候选，投影默认存在 World。界面设置与已有草稿开关又可能不同，因此只改提示或自动执行分支不能修通正式结算。

现在先在现有执行锁内，通过 `saveDraft()` 的既有 CAS 保存本次开关快照，再生成缺少的已启用阶段。正式完成条件要求合法 ready Story，以及所有已启用阶段的有效候选；关闭阶段只能合法 skipped（或保留既有验证候选），不能把 failed、pending、preview 或版本失效当完成。

提交使用只读 `settlementDraft()` 投影，**不创建空 Variables/World 候选**。关闭阶段的已验证旧候选可以保留在原草稿供现有补算复用，但纯小说结算完全不应用它们。开启 World 时仍须有真实的合法 Variables 依赖，不提升 preview 权限。

`generateAndSettleTurn()`、Repository 的事务/CAS/回执/Undo 实现均未改动；Coordinator 返回 complete 后走它们原有的正式入口。正文、短期记忆、Journal、revision、turnNumber 同事务提交；下一草稿行动为空，等待明确输入，不自动请求下一章。

纯小说只使用既有 `variableCommandsForTurn()` 完成必要的 Story 开局时钟初始化。普通回合即使含结构化 `time:pause` 也不更新时间；不从小说推导钱、人物、物品或事件。关闭 World 不强制执行其到期事项结算；实际启用 World 时仍保留原规则。Story 时间与事件证据仍在提交边界重验。

UI 显示“已关闭”及模式说明；关闭阶段时正文入口继续通过自动工作流正常结算。已有完整候选再切换设置时，“发送”不能绕过设置同步；先通过“应用阶段设置并继续”合法处理当前草稿。提交失败可重试正式结算，不重复 Story 请求。

## 四种组合

| Variables | World | 执行与结算 |
|---|---|---|
| 开 | 开 | Story → Variables → World → 原有正式结算 |
| 开 | 关 | Story → 严格验证 Variables → 正式结算，不执行后台世界更新 |
| 关 | 关 | 仅 Story → 严格验证 → Journal/记忆与回合原子保存；普通世界状态与时钟不变 |
| 关 | 开 | 无合法 Variables 依赖时 World 只能 preview，不结算；明确提示补算或关闭 World |

World-only 若草稿已经有真实、版本匹配的 validated Variables，仍按原有合法依赖复用规则执行；没有新增变量候选或权限捷径。运行中修改设置不影响本次冻结的方案，后续明确执行才应用新设置。

## 修改文件清单

生产代码仅 5 个文件：

- `src/domain/drafts.ts`：设置转换纯函数与精确版本转换校验；没有更改任何 Schema 字段。
- `src/domain/turnCommit.ts`：完成条件、只读结算投影、可选阶段命令与结算。
- `src/services/validation/turnCommit.ts`：按实际启用候选重验；独立保留 Story 时间/事件校验。
- `src/workflows/turnCoordinator.ts`：锁内 CAS 同步开关、合法完成判断。
- `src/ui/game/GameScreen.tsx`：模式说明、状态及恢复入口、阻止设置不一致时直接发送提交。

测试 7 个文件：

- 新增 `src/tests/disabled-stage-turns.test.ts`（21 项）。
- `src/tests/automatic-turn.test.ts`（新增连续三回合，更新 World-off 产品预期）。
- `src/tests/turn-coordinator.test.ts`、`live-text-turn.test.ts`、`time-runtime.test.ts`（按新规则更新完成预期，保留请求计数、状态与权限保护）。
- 新增 `e2e/disabled-stage-turns.spec.ts`（8 场景 × 双端）。
- `e2e/action-workflow.spec.ts`：更新两种关闭阶段的产品预期及现行移动导航；仍检查真实候选、存档、请求计数、刷新和下一章。

其他变更仅为本目录报告、日志和 Mock 截图。未修改 Prompt、天赋目录、#178 规则、#177 续写/字数规则、AI 输出协议、运行设置 Schema、GameState/IndexedDB/Repository、模型路由、公告或 Cloudflare。

## 正式环境与测试

Node **24.19.0**；npm **11.9.0**；Chromium **154.0.8037.57**（Debian 13）。真实锁定依赖、Vitest、Playwright，没有替代运行器。桌面 1440×1000；手机使用仓库 Pixel 7 项目（393×727 CSS 像素，设备缩放比 2.75）。所有模型为 `.mock.invalid` Mock，未调用收费模型、未使用真实玩家存档。

| 批次/命令 | 结果 | 退出码 | 原始日志 |
|---|---|---|---|
| `npm ci` | 安装 143 个包 | 0 | [npm-ci](logs/npm-ci.txt) |
| 最终 `npm run check` | **176 文件、4270 单测通过，0 失败/跳过**；Lint、TypeScript、filenames、catalog、Build 通过 | 0 | [check-complete](logs/check-complete.txt) |
| `npm run prompts:check` | **93 通过，0 失败/跳过** | 0 | [prompts](logs/prompts.txt) |
| 13 个核心文件定向 Vitest | **375 通过，0 失败/跳过** | 0 | [core-complete](logs/core-complete.txt) |
| 新增专项 Chromium 双端 | **16 通过，0 失败/跳过** | 0 | [browser-complete](logs/browser-complete.txt) |
| 旧 action-workflow 定向双端 | **6 通过，0 失败/跳过** | 0 | [browser-action](logs/browser-action.txt) |
| `git diff --check` | 通过 | 0 | [diff-check](logs/diff-check.txt) |

93 项 Prompt 与 375 项核心测试是完整 Vitest 的子集，不额外累加。浏览器最终独立场景共 **22 项**；开发中的重跑不计入。没有运行无关全量 Chromium，也没有声称真机 Safari 验收。

核心范围：disabled-stage-turns、turn-commit、turn-coordinator、automatic-turn、drafts、saveRepository、story-stage、story-continuation、story-continuation-coordinator、opening-time、time-runtime、turn-undo、undo-summary-recovery。

浏览器新专项（各 PC/手机）：

1. 通过真实开关关闭两阶段；合法开局与连续三章，Journal/短期记忆/revision 连续；刷新零请求；再开启后完整三阶段。
2. Variables-only 严格执行并结算，World 已关闭。
3. World-only preview 不能提交；关闭 World 后不额外请求并完成章节。
4. 截断不提交，刷新保留；一次续写完成后一次结算。
5. 自动提交失败，关闭诊断后使用现有重试入口，只提交不重新生成。
6. 已有完整候选切换纯小说，先同步开关；禁止旧设置直接发送，关闭阶段结果不落库。
7. 真实浏览器双标签 Web Locks：第二标签 **0 请求**；取消及迟到返回不提交，刷新不重发。
8. 无 Web Locks：**0 请求**，正式状态、草稿、玩家输入不变，明确说明原因。

单元专项另外覆盖真实创角待定时间的缺失/非法拒绝、普通 time:pause 不改变世界、导出/导入、候选复用、运行中设置变化隔离、正文空/短/中断、过期 CAS、双提交幂等、实际 Undo、IDB 回执故障整批回滚、非法变量拒绝。原有 Memory、三阶段、续写及权限测试包含在完整检查中，未删断言。

## 失败、修复和 main 对照

保留首次失败，不将开发过程写成从未失败：

- **先红后绿**：[red](logs/red.txt)，未修复生产链时新规则的两个 automatic-turn 用例失败（10 通过/2 失败）。修复后纳入最终完整检查通过。
- 初版配置转换错误地展开整个 runtime，严格 Schema 拒绝多余字段：[core-first](logs/core-first.txt)，136 通过/7 失败。改为显式传两个开关；[core-second](logs/core-second.txt) 143 通过。
- 首轮完整检查：[check-first](logs/check-first.txt)，4266 通过/4 失败。3 项是旧“关闭阶段不准提交”的产品预期（live-text 1、time-runtime 2）；另 1 项是新增缺锁测试的浏览器环境 Mock 缺 localStorage，提前报 configuration。按真实浏览器形态补齐 Mock，未更改生产缺锁规则。
- 干净 main 同 Node/锁定依赖运行原版 live-text、time-runtime：[main-old-rules](logs/main-old-rules.txt)，**45 通过**。本分支按用户新规则更新结算断言，同时保留到期事件不清理、preview 不提交、请求计数与正式状态校验；[targeted-fixed](logs/targeted-fixed.txt) 66 通过。
- 新测试早期把 Undo `available` 数量误当布尔、参数表类型写错；分别修正为真实数量并实际执行 Undo、规范参数表；日志 [new-tests](logs/new-tests.txt)、[typecheck-pre](logs/typecheck-pre.txt)。没有降低生产安全限制。
- 首次新 Chromium：[browser-first](logs/browser-first.txt)，9 通过/1 手机失败。错误诊断自动弹出后测试点到背后结算按钮；补上诊断关闭操作，[browser-final](logs/browser-final.txt) 10 通过。后续新设置与锁场景合入最终 16 项全绿。
- 新锁测试首轮：[browser-locks](logs/browser-locks.txt)，2 通过/2 失败。错误期待取消后持久状态为 failed；现行取消保留 pending。改为先确认取消执行结束，再精确断言 pending、无正文、正式状态完全不变、单请求及刷新不重发；最终双端通过。未改取消实现。
- 干净 main 的原版关闭阶段 E2E：[browser-main-old-rules](logs/browser-main-old-rules.txt)，PC 2 通过、手机 2 失败。手机提示位于当前非模态工作流容器，旧查询限定在原 region 中，报 `element(s) not found`。本批修改同一组阶段产品测试时复用现行导航并正确限定提示；[browser-action](logs/browser-action.txt) 6 项通过。没有通过跳过来处理。
- Build 有既有的大 chunk 警告，退出码 0；未扩展到打包优化。

## 截图与可复核命令

全部为真实 React 页面与隔离 Mock 数据，非静态设计图：

| 场景 | PC | 手机 |
|---|---|---|
| 连续三章，等待下一行动 | [PC](screenshots/desktop-three-chapters.png) | [手机](screenshots/mobile-three-chapters.png) |
| Variables-only 已结算、World 关闭 | [PC](screenshots/desktop-variables-only.png) | [手机](screenshots/mobile-variables-only.png) |
| World-only preview 与依赖提示 | [PC](screenshots/desktop-world-preview.png) | [手机](screenshots/mobile-world-preview.png) |
| 截断保存 | [PC](screenshots/desktop-partial.png) | [手机](screenshots/mobile-partial.png) |
| 续写成功并结算 | [PC](screenshots/desktop-continued.png) | [手机](screenshots/mobile-continued.png) |

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/disabled-stage-turns.test.ts src/tests/turn-commit.test.ts src/tests/turn-coordinator.test.ts src/tests/automatic-turn.test.ts src/tests/drafts.test.ts src/tests/saveRepository.test.ts src/tests/story-stage.test.ts src/tests/story-continuation.test.ts src/tests/story-continuation-coordinator.test.ts src/tests/opening-time.test.ts src/tests/time-runtime.test.ts src/tests/turn-undo.test.ts src/tests/undo-summary-recovery.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/disabled-stage-turns.spec.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/action-workflow.spec.ts -g '关闭阶段时|发送行动只结算一次'
git diff --check
```

本次浏览器沿用仓库两个项目、2 workers、0 retry，仅在外部配置改为独立端口 55809、禁用旧服务器复用，并保存截图/失败 trace；main 对照端口 55810。原始全部运行证据和 trace 位于隔离环境 `/workspace/disabled-stage-evidence/`，报告收录原始日志副本（`.log` 改名 `.txt`，内容不改）。失败 trace 子目录：`browser-first/`、`browser-locks/`、`browser-main-old-rules/`；未包含真实玩家数据或凭证。

## 已知限制与边界

- 纯小说不负责世界数据同步，普通章节的档案时间可相同；这是本次明确产品规则。重新启用阶段后不自动追补已经跳过的历史更新。
- 原有独立记忆维护配置、权限与费用保护继续保留；本批没有新增自动请求。章节专项关闭自动总结以精确断言只有授权的 Story 请求，维护体系由既有测试验证。
- World-only 没有合法变量依赖仍不能正式结算；不伪造候选。
- 未做真实收费模型、真实玩家存档、生产部署或真实 iPhone 测试。Mock 只能证明执行、保存与请求边界，不能保证模型实际文学输出质量。
- 无 Schema 变更，没有迁移或私自改写玩家存档；Draft 只通过既有 CAS 合法更新。保留 #177 断点续写和 #178 天赋叙事规则。
