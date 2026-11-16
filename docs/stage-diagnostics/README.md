# 运行诊断与持久失败摘要修复

基线：`main@8ab4cf0e44829275b7e0bdacd03eb429ae2b0dad`，开工与交付前均重新读取远端确认。调查依据：`/workspace/stage-diagnostics-audit-20261116/REPORT.html`。验证时间：2026-11-16，北京时间。

## 根因与修复

以前自动流程由 `TurnCoordinator` 保存安全失败码，而 `runtimeLogs` 和模型原文只在内存中保留。刷新或清空日志后，草稿仍是 failed，界面却显示“本次页面尚无错误”。手动正文执行器只保存成功稿，失败后甚至没有可供刷新恢复的摘要。

本次将三种数据明确分开：

| 数据 | 保存范围 | 显示方式 |
| --- | --- | --- |
| 持久失败摘要 | 现有 `TurnDraft.stageStatus` / `failures` | 阶段、已有安全码、尝试编号、现有操作是否可继续；不伪装成本页事件 |
| 当前回合临时日志 | React 内存、原有50事件上限 | 本页安全细分类；取消单列、不计错误；清空只影响此处 |
| 模型原始响应 | 原有临时响应 Store | 保持原有主动查看、脱敏、淘汰和刷新清空行为；不写入草稿 |

`SavedFailureSummary` 只选择当前 Story 版本且仍处于 failed 的阶段记录。PC 工作流诊断、手机概要与日志页共用它。没有对应临时错误时说明：“当前回合保留了生成失败记录，但本页没有该次请求的详细运行日志”。正常待生成显示“本页暂无错误”。重试成功后，旧摘要仍可保留在原有草稿尝试记录中，但不再作为当前失败展示。

继续/重试说明读取原有工作流按钮的可用状态和浏览器能力，不新增授权、请求或状态转换。`invalid_output` 的 `storyRule`、安全字段路径等仍只展示实际存在的本页信息；刷新后不推断具体原因。

## 自动与手动正文

- **自动流程**：继续由原 `TurnCoordinator` 保存每次安全失败。没有移动或重复这段写入，也未改变服务器错误的原有重试上限。
- **手动 UI**：`useStoryGeneration` 向 `StoryStage` 提供 `onFailureSaved`，显式选择安全摘要保存。执行器仅对已经捕获的非取消 `AiError`，在原有阶段锁内保存一条失败记录。未选择这一回调的底层调用保留原有行为。
- 摘要只追加阶段、安全码、尝试编号、Story 版本和布尔值；`draftRevision + 1`，`storyRevision`、已绑定行动、正式 GameState 不变。不生成正文候选，不保存原文、请求、密钥、堆栈或任意异常字符串。
- 手动尝试编号沿用同一 Story 版本已有失败的最大编号加一；自动执行仍保留原有本次工作流的尝试编号语义。手动记录的 `retryable:false` 不触发自动重试，不限制玩家现有的主动操作入口。
- 保存前检查原阶段仍有效，使用现有 `saveDraft(next, expectedRevision, signal, basedOn)` 完整基线 CAS。取消、草稿竞争、正式 revision 变化时不绕过验证。摘要写入期间沿用既有 saving 不可取消边界。
- 若摘要自身的存储/CAS 失败，向原安全错误展示路径传播该失败，不报“摘要已保存”，不自动补写或补发请求。

## 临时日志归属、取消和恢复

每次 GameScreen 挂载产生匿名 `saveRef`；草稿回合变化产生匿名 `turnRef`。这些随机标识不是正式存档或回合 ID，不含存档标题、人物资料或玩家输入。请求回调捕获启动时的标识，不在返回时读取新回合标识。

`currentRuntimeLogs` 在展示、计数和工作流状态计算前筛选当前存档/回合；更早回合或迟到的旧作用域不会冒认当前错误。查看与复制只包含原有安全字段和匿名标识，不写库。清空不会删除 `TurnDraft.failures`。

取消异常即使来自 catch，也转换为临时 cancelled 事件，不计入失败，不写手动失败摘要。真正收到阶段完成事件后才将之前的错误移出当前错误列表；不能仅因存在旧 ready 候选就隐藏新的请求前检查错误。自动流程增加的是阶段完成的诊断通知，不是阶段执行或模型请求。恢复成功后，已过期 Hook 提示也不再重开当前失败横幅。

## 修改范围

- `src/workflows/storyStage.ts`：手动 UI 选择的安全失败保存；原锁、取消信号与 CAS。
- `src/ui/game/useStoryGeneration.ts`：接收已保存的安全失败草稿。
- `src/ui/game/useTurnGeneration.ts`：真实阶段完成的诊断通知。
- `src/ui/game/runtimeLog.ts`：匿名作用域、当前回合筛选、取消分类、已恢复错误筛选。
- `src/ui/game/GameScreen.tsx`：捕获作用域、过滤当前日志、继续状态文案、恢复后横幅处理。
- `SavedFailureSummary.tsx`、`RuntimeLogPanel.tsx`、`WorkflowPanel.tsx`、`MobileDiagnostics.tsx`：共用只读摘要与准确空态。
- `src/tests/stage-failure-summary.test.tsx`：12项新增领域/Repository/组件回归。
- `e2e/stage-failure-summary.spec.ts`：6个场景、desktop/mobile，真实 App + Mock。
- `e2e/mobile-batch2.spec.ts`、`pr120-integration.spec.ts`、`workflow-feedback.spec.ts`：适配新的正常空态与清空后仍保留摘要，保留原有隐私、只读与请求计数断言。
- `e2e/turn-undo.spec.ts`：一个既有手机用例先正常关闭自动打开的诊断模态，再继续操作，未改业务断言。
- 本目录：开发报告、真实截图与原始日志。

未修改 Prompt、Manifest、AI 协议、供应商、正文解析、GameState/TurnDraft Schema、Repository、Commit、Undo、Web Locks、收费配置或重发授权规则；未处理手机人物/世界资料弹层。

## 正式 Node 24 验证

Node `v24.19.0`，按锁文件执行 `npm ci`，退出0，安装143包。

| 批次 | 真实结果 | 退出码 |
| --- | --- | --- |
| 修复前新增 Vitest | 2通过、8失败；包含一个后来确认的非法测试夹具 | 1 |
| 定向 Vitest 1 | 190通过、1失败：夹具把只支持变量/世界补算的入口用于 Story | 1 |
| 定向 Vitest 2 | 192通过、0失败、0跳过 | 0 |
| TypeScript 1 | 同一夹具的 `story` 类型错误；未修改领域类型通过测试 | 2 |
| TypeScript 2 | 修正为合法草稿版本竞争，检查通过 | 0 |
| `npm run check` 第一批 | 162文件、3977项 Vitest 全通过；文件名、ESLint、目录契约、TypeScript、Build通过 | 0 |
| `npm run check` 最终批 | 冻结后的生产实现：162文件、3977项通过、0失败、0跳过；其余正式检查全部通过 | 0 |
| `npm run prompts:check` | 3文件、93项通过、0失败、0跳过 | 0 |
| 最后旧E2E交互调整后 | TypeScript及该测试ESLint通过 | 0 |
| `git diff --check` | 通过 | 0 |

新增用例经原基线先红后绿。原主干同环境此前的完整检查为3965项通过，未将缺失的新功能算作主干新增回归。构建只有既有大于500kB chunk提示，没有借本次改变分包。

## Chromium 分批记录

真实 Linux Chromium `154.0.8037.57`，desktop 1440×1000、Pixel 7 412×839。新增测试的手机截图来自 Chromium 设备视口模拟，**不是 iPhone 实机**；未运行 WebKit。不运行全量约700项 E2E。全部模型返回 Mock。

| 批次 | 真实成绩 | 原因与后续 |
| --- | --- | --- |
| 新增场景第一批 | 8通过、2失败、0跳过 | 撤回断言错误要求 revision 回退；干净main同环境复现相同差异。修正为 revision=撤回前当前值+1、更新时间合法，并逐字段比较其余全部正式世界内容，不改Undo |
| 新增场景第二批 | 8通过、2失败、0跳过 | PC长场景在30秒总预算内同时刷新、采集多张截图、切换页签而超时。保留原日志；将新文件多步骤场景预算设60秒、单worker，仍为0重试，未改产品规避失败；未宣称main也复现这两个超时 |
| 新增场景第三批 | 10通过、0失败、0跳过 | 自动/手动失败、复制、清空、刷新、修改重发、撤回、取消/迟到、切档、无锁/过期草稿双端通过 |
| 关键交互补充批 | 13通过、1失败、0跳过 | 包含新增的手动成功恢复双端，以及既有变量/世界续跑、保存不可取消、无锁、输入保留、撤回恢复。旧手机撤回用例被已自动打开的诊断模态阻挡 |
| 干净main旧撤回对照 | 0通过、1失败 | 同一旧文件、同一Node/Chromium手机环境，在相同行复现模态拦截点击；完整trace保留在独立证据目录 |
| 旧撤回适配后 | 2通过、0失败、0跳过 | 只增加真实Esc关闭诊断步骤；原扣款、请求4次、新分支、刷新和原输入回填断言全部保留 |
| 既有手机诊断 | 3通过、0失败、0跳过 | 单条复制/脱敏、清空后摘要、纯浏览不写库、不请求模型、非模态两层导航 |
| 既有双端布局 | 2通过、0失败、0跳过 | 候选/原文/诊断、嵌套弹窗、非模态输入边界及390/392/901/1440等既有视口 |

以上是独立批次，不相加冒充一次全绿。当前所有选定场景均取得通过证据；首批失败、修正与精确复测范围分别保留。没有删除/skip失败场景，没有自动重试。

## 安全验收证据

- `stage-failure-summary.test.tsx` 使用真实 Repository + fake-indexeddb + Composer/Runtime/Mock transport：手动失败新增恰好一条安全摘要，重新打开Repository仍在，正式世界完全相同；自动流程不重复保存；成功后不新增失败。
- 挂起请求期间取消、改写草稿版本、独立更新正式状态：旧失败不能覆盖新数据，回调不收到伪造成功；摘要存储失败同样不部分写入。
- 新增 Chromium 自动和手动失败各只有一次 Story POST，Variables/World未启动；查看、复制、清空和刷新前后，对完整 Repository 状态与草稿做相等比较。
- 清空后错误事件为0，持久摘要仍在；刷新后保留安全码，不出现捏造的 `narrative_short`，原文空态不恢复模型文本。
- 主动取消：持久failures为空、正式世界不变，临时错误数为0；刷新不自动发请求。旧回包放行不新增失败或候选。
- 成功重发只出现 `story, story, variables, world` 四次预期请求；正式结算一次；Undo回填修改后行动，不触发请求。
- 自动失败后手动正文成功：只发第二次Story，变量/世界仍pending；过期错误/横幅消失。再主动继续才生成剩余两阶段。
- 无Web Locks时请求数为0，输入、正式状态、草稿保持原样；不绕过原有安全阻断。过期草稿仍不可用，不伪造模型输出失败。
- 当前回合随机标识与其他存档/回合不同；本页复制内容无原始存档ID、玩家输入或假密钥。底层 StageGuard、token、CAS 和原文 Store 的隔离机制保持原样。

## 截图

全部来自本分支真实 React 页面与上述Mock场景，采集后仅增加报告/证据和测试适配，没有再修改生产实现。

| 模式 | PC | 手机 |
| --- | --- | --- |
| 自动失败、刷新前 | [图](screenshots/automatic-before-refresh-desktop.png) | [图](screenshots/automatic-before-refresh-mobile.png) |
| 自动失败、清空后 | [图](screenshots/automatic-cleared-desktop.png) | [图](screenshots/automatic-cleared-mobile.png) |
| 自动失败、刷新后 | [图](screenshots/automatic-refreshed-desktop.png) | [图](screenshots/automatic-refreshed-mobile.png) |
| 手动失败、刷新前 | [图](screenshots/manual-before-refresh-desktop.png) | [图](screenshots/manual-before-refresh-mobile.png) |
| 手动失败、清空后 | [图](screenshots/manual-cleared-desktop.png) | [图](screenshots/manual-cleared-mobile.png) |
| 手动失败、刷新后 | [图](screenshots/manual-refreshed-desktop.png) | [图](screenshots/manual-refreshed-mobile.png) |

## 原始日志与边界

[logs](logs) 中以 `.gz` 原样压缩保存stdout/stderr，包含失败批次和main对照；解压后字节不变，SHA-256、退出码和环境见 [evidence.json](evidence.json)。工作区完整trace、旧兼容截图和原始日志位于 `/workspace/stage-diagnostics-fix-evidence/`；旧截图的自动重写未混入PR。

尚存的明确边界：

1. 刷新不能恢复详细 `storyRule`、字段路径或模型原文，原Schema没有保存它们；不会从安全码猜测。
2. 浏览器存储失败或CAS过期时，不能保证持久失败摘要写入。保留原存档并显示安全错误，不盲目补写或自动重发。
3. 匿名日志标识只在本页关联，刷新后变化，不是用于跨会话追踪玩家的持久身份。
4. 取消后的pending不代表以前发生过模型失败；不补造持久取消记录。
5. Mock证明诊断、存储和执行链行为，不能证明所有供应商异常或真实模型输出表现；没有真实付费调用。

保持Draft，未合并、未手动部署、未发布。等待十二代目复审。
