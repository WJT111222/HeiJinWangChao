# 第二批：变量管理与动态世界独立流式传输

## 基线、范围与行为

开工时远端 main 为 `0e8b75f57a6e3f07b641c76fe09bfcd3cfdf553c`。验证期间 main 新合并了 #160（已合并的文件名大小写修复），交付前将本分支无冲突接到 `5ba35a859853c66501451e1a8cb3a1cdcf221aa0`，并重新执行正式工程、Prompt 和新增双端验收。没有检出、修改、合并或覆盖两个独立开发工作分支。已验证生产及测试代码提交为 `81aab8ea8300b21f7f188ae3f622eba3d77ba69a`，最终 HEAD 另含验收资料，见 Draft PR 和交付答复。

本批新增本地运行偏好 `streamVariables`、`streamWorld`，均默认 false，互相独立。设置版本仍为 1、键仍为 `heijin.settings.v1`。旧设置缺失字段时解析补 false，既有叙事、记忆、超时与其他字段保留，不因读取而写回或整体重置。非布尔值不被隐式转换。

PC 和手机在「设置 → 运行」均可选择两个开关，沿用「保存本地设置」。未保存编辑刷新后丢弃；保存后刷新恢复。关闭开关后使用原来的非流式请求。

手动 `VariableStage`、`WorldStage` 分别读取经 Schema 快照的对应字段，传给同一个 `runStageRequest()`；自动 Coordinator 仍调用这两类执行器，并在尝试开始冻结设置。设置修改不改变已经运行的尝试，也不改变其后续阶段选择。两字段不进入 GameState、TurnDraft 或 Prompt。

## 复用数据流和实时阅读

没有修改 `AiClient`、`sse.ts`、协议转换器或创建新工作流。沿用原四协议及 JSON 回退能力：同一流式请求若直接返回完整 JSON，读取该响应，不另发请求。

沿用 #159 `StageResponseStore`、实际请求 UUID/回合/版本、content/reasoning 分离、白名单诊断、凭证脱敏、取消封存及临时生命周期。

- 主动进入模型原文后，pending 内容每 50ms 最多更新一次，明确标记“响应接收中 · 未完成”；只读、可复制、内部滚动。
- 公开 reasoning 只在玩家主动切换后挂载，普通错误和运行日志不展示私密原文。
- 阅读位于底部且无文字选择时跟随；滚回前文或选择文字时不强行拉回底部。查看内容切换使用同一个原有查看器，不增加弹窗。
- 只有完整响应结束后才走原严格文本/JSON、领域权限、整批模拟和原子候选保存。展示字符串不用于正式解析。
- 失败、取消、超时保留允许展示的实际片段；失败候选不保存。取消后的迟到 JSON 不更新旧记录或覆盖新候选。
- 流式拒绝、中断、缺结束、截断、过滤、reasoning-only 不触发新增非流式回退、模型切换、预算提高或付费重发。原有针对特定服务器错误的重试规则保持原样；新增 UI 说明明确为“不因流式不兼容自动重试”。

## 容量与性能措施

第一批每条极端记录最多约 2801.6 万字符，六条理论上约 1.68 亿字符。本次只限制临时展示，不限制正式解析输入：

| 字段 | Story 单次 | Variables / World 单次 |
|---|---:|---:|
| content | 保留 800 万字符 | 25.6 万字符 |
| 独立公开 reasoning | 保留 200 万 | 6.4 万 |
| 单框合并显示 | 保留 1000 万 | 不建立合并副本 |
| 规范化预览 | 保留 800 万 | 25.6 万 |
| 诊断 JSON | 保留 1.6 万 | 1.6 万 |

共享 Store 保留最多六条，新增 3200 万字符总预算，超限优先淘汰最旧记录，保留当前响应；Story 单条上限之和小于总预算。字段截断有明确提示，普通说明也提醒容量导致的提前淘汰。预算按字符串字符计数，不是 JavaScript 堆字节承诺。

runtime 的观察累积同步使用更小的候选预览上限；正式 `AiClient` 完整响应和原协议限制不变。Store 在脱敏前限制展示输入长度，并继续隐藏裁剪边缘的已知密钥前缀。Variables / World 避免 runtime 与 Store 重复脱敏；Story 保留原观察逻辑。完全相同的安全快照不会重复发布，减少无意义 React 更新。

### 测量

1. 高频专项：600 个 SSE content 事件，观察发布仍受原有 50ms 节流控制，严格断言发布次数与耗时上界；中断后保留实际文本，未产生规范化候选。
2. 同内容重复更新 100 次：只有 begin 与第一次变化共 2 次发布，后续 Store snapshot 引用不变。
3. 六条混合大 Story 记录始终满足 3200 万总预算；15 次大候选更新保留最近六条，content/reasoning/normalized 合计不超过 345.6 万字符。clear 后为空。
4. 长 World JSON 的完整值大于 25.6 万字符、展示尾部已截断，严格校验和候选保存仍取得完整原始 JSON，正式世界不变。这直接验证展示截断未成为解析输入。
5. 同环境主干/分支 Chromium 合成对比：15 次大候选更新，保留字符数从 **2700 万降为 345.6 万（减少 87.2%）**。桌面暖态单次更新中位数约 **2.30 → 0.40ms**；手机视口约 **5.75 → 0.60ms**。原始每次耗时与 heap 采样见 `performance/preview-benchmark.json`。
6. 真实 React 流式阅读的初始 4 个设备/阶段样本：98–105 个文本事件仅产生 3 次 Store 发布；记录到 24–96 个动画帧，Playwright 填入并确认行动的墙钟耗时为 64–169ms。同步 main 后复核样本为 91–664ms，其中手机 Variables 一次为 664ms；均成功输入且未发起额外请求。该时间包含自动化通信、定位和断言，不能当作纯键盘输入延迟或绘制延迟。数字见 `performance/live-performance-summary.json`、`performance/live-performance-integrated.json`，较慢样本未删除。

第 5 项的字符串计数是确定性容量证据。耗时仅是本机单次合成样本，执行时也有其他工程检查负载，不能推广为真实手机性能保证；`performance.memory` 受 GC、共享字符串和模块加载影响，数据未证明实际 heap 同比例下降，也不据此宣称帧率或总内存节省。正式模型响应、解析、Prompt 和 Repository 各自仍可能占用内存，本上限仅约束临时展示 Store。

## 四协议 Mock 与执行一致性

新增 `candidate-streaming.test.ts` 55 项，`response-preview-performance.test.ts` 4 项，共 59 项（均包含于全量 Vitest）。

| 协议 | 关闭两项/仅变量/仅世界/均开启 | 自动与手动 | SSE 中文跨 UTF-8 块 | 非流式 / SSE / 流式返回 JSON 候选一致 | 严格失败 |
|---|---|---|---|---|---|
| DeepSeek | 通过 | 通过 | 通过 | 通过 | 通过 |
| OpenAI | 通过 | 通过 | 通过 | 通过 | 通过 |
| Gemini | 通过，核对原 streamGenerateContent 路径 | 通过 | 通过 | 通过 | 通过 |
| Anthropic | 通过 | 通过 | 通过 | 通过 | 通过 |

16 个开关矩阵用例实际运行四种协议 × 四种偏好 × 自动/手动 × 两阶段，共 64 次 Mock 出站；分别核对 body.stream 或 Gemini endpoint。不是仅测设置布尔值。8 个内容等价用例对每阶段比较非流式、SSE、同请求 JSON 回退。开局与普通模式均有实际执行。

四协议覆盖公开 reasoning、reasoning-only empty、缺结束、输出上限、过滤和明确流式拒绝；失败仍只请求一次，不保存候选。真实取消、超时和 Web Locks 缺失覆盖两个执行器；没有锁时即使开关打开也为零模型请求，Repository 不变。

运行中设置变更有两层证据：自动阶段间修改原设置仍使用初始偏好；手动生成开始后、异步读库完成前改变设置也不改变出站 stream 值。请求 Prompt 不含两个字段，保存草稿亦不含字段或公开 reasoning。

## 正式工程与 Chromium 成绩

Node **v24.19.0**、npm **11.9.0**、Chromium **154.0.8037.57**。真实 npm、Vitest、Playwright；所有模型响应 Mock，没有收费 API 请求或玩家数据。

| 批次 | 实际结果 | 退出码 |
|---|---|---:|
| 初始 / 同步 main 后 `npm ci --cache /workspace/.npm` | 均安装 143 包，成功 | 0 |
| 同步 main 后 `npm run check` | 161 文件、3965 单测通过；ESLint、文件名检查、catalog、TypeScript、Build 通过 | 0 |
| 同步 main 后 `npm run prompts:check` | 93 通过，0 失败/跳过 | 0 |
| 功能/容量与安全定向 7 文件 | 150 通过，0 失败/跳过 | 0 |
| 稳定源码完整相关 Chromium | **34 通过，0 失败/跳过**，17 桌面 + 17 手机 | 0 |
| 同步 main 后新增功能 Chromium | **10 通过，0 失败/跳过**（上述新增 10 项复核，不叠加） | 0 |
| 真实 UI 性能证据补采 | 4 通过（与上述实时阅读场景重叠，不叠加） | 0 |
| 干净 main 旧用例同条件对照 | 桌面 2 + 手机 1，通过 | 0 |
| `git diff --check` | 通过 | 0 |

完整检查包含 Prompt 93 和定向 150，不能相加成更多独立通过数。未运行无范围全量 E2E。

稳定的 34 项由以下文件构成：

- 新增 `candidate-streaming.spec.ts`：10 项双端，覆盖旧设置读取、默认关闭、独立编辑保存和刷新、未保存丢弃、实时 content/reasoning、未完成标签、前文阅读不被打断、复制、输入、取消重试、断网及正常原子结算。
- `stage-response-observation.spec.ts`：4 项，确认 #159 的非流式默认、reasoning-only、私密内容主动挂载、查看不写 Repository 和临时生命周期。
- `story-raw-continuous.spec.ts`：8 项，确认 Story 单框原文、思考/小说流式切换、排序、脱敏、取消及中断未回退。
- `pr158-rebind-boundaries.spec.ts`：10 项，确认 #158 跨标签 Web Locks、缺锁拒绝、保留行动、取消后恢复及下一回合。
- `story-failure-input.spec.ts`：2 项，确认正文失败后的原行动恢复与编辑重发。

同步已合并 #160 后，生产差异仍仅是下面七个文件；没有修改 GameScreen 或 Windows 修复文件。新 main 的文件名防护也随完整工程检查通过。34 项功能测试的生产实现没有因同步而改变，另对最终基线复核新增双端 10 项。

## 失败与修复记录

- 新测试初稿用第 0 回合状态构造普通回合，被正式编译器拒绝。改为先用 Repository 正式结算开局再构造普通回合；没有放宽校验。
- 超长 Variables 夹具被原有文本协议 inputLength 拒绝。保留该协议限制，将“展示截断但完整解析”的验证改为正式允许的长 World JSON；未扩大 Variables 上限。
- 容量旧测试原先期待 800 万字符；按新候选上限更新为明确的 25.6 万，并精确计入凭证脱敏的长度变化，继续断言脱敏、淘汰、诊断上限及 clear。
- 开发验证时曾在运行中的 Vite / Vitest 批次改动响应模块及新增断言，导致转换产物/热更新混杂。新增浏览器有 4 个手机失败；旧相关批次 21 通过、3 失败（取原文为空/超时）；一次工程批次去重断言收到 102 次发布而期待 2 次。原始日志均保留。
- 已固定源码并重启专用端口后，34 项全部通过，完整 3954 项全部通过；此前旧失败的相同范围在干净 main 上桌面 2、手机 1 均通过。不是把这些失败宣称为主干既有缺陷，也没有删除/skip/放松断言。trace 中可见受污染批次混用了带热更新时间和不带时间的模块 URL。最终日志与污染批次分开保存。

全量、Prompt、定向、浏览器、干净 main 对照、退出码见 `logs/`。完整开发期 trace 和日志原件保留于 `/workspace/variables-world-streaming-evidence`。日志以无损 gzip 保存，`gzip -dc 文件.log.gz` 可读取。

## 修改清单与安全边界

生产七文件：

1. `src/ui/settings/model.ts`：两个可向后兼容的本地布尔偏好。
2. `src/ui/settings/SettingsPanel.tsx`：双端运行选项与说明，显式保存反馈。
3. `src/workflows/variableStage.ts`：使用已快照的 streamVariables。
4. `src/workflows/worldStage.ts`：使用已快照的 streamWorld。
5. `src/services/ai/runtime.ts`：候选观察积累使用展示上限，减少重复脱敏。
6. `src/services/ai/stageResponses.ts`：候选容量、共享预算与重复快照去重。
7. `src/ui/game/StageResponsesPanel.tsx`：未完成提示与不干扰复制/前文阅读的跟随。

测试四文件：新增 `src/tests/candidate-streaming.test.ts`、`src/tests/response-preview-performance.test.ts`、`e2e/candidate-streaming.spec.ts`；更新 `src/tests/stage-response-observation.test.tsx` 的容量期望。其余本 PR 文件为报告、原始日志、性能数据和真实截图；完整列表见 `FILES.txt`。

未修改 Prompt、Manifest、来源锁、正式解析器、GameState / TurnDraft / IndexedDB Schema、领域规则、Repository、Commit / CAS / Undo、渠道地址、模型选择、温度、输出预算或费用重试、Story 阅读区、Memory 执行器或 GameScreen。没有创建新的 SSE 客户端、传输器或并行日志。

## 截图与已知限制

`screenshots/` 包含 PC/手机：运行设置、Variables / World 实时模型原文、取消后中断原文、候选结算。全部来自真实 React + 合成 Mock，不是静态设计稿。`performance/` 包含主干对照的每次耗时、字符计数、heap 采样和真实 UI 采样。

- 超过临时预览容量时只保留前缀并标注，完整解析仍沿用现有协议的大小与验证规则。
- 流式服务拒绝或中断后，玩家自行关闭开关再主动重试。既有特定服务器错误重试策略未改变。
- 没有真实供应商收费调用，因此不宣称所有中转服务实际兼容，也不宣称供应商速度、缓存或费用改善。
- 没有真实手机硬件内存/FPS 测量；手机为 Chromium 的 Pixel 7 视口与触摸模拟。
- 原文仍是临时数据，刷新、切档、退出、撤回、条数及总预算淘汰后不能恢复。

本批完成后保持 Draft，不合并、不部署生产，不开展新功能，等待十二代目及项目负责人审查。

关键截图：

- [desktop-settings-settings](screenshots/desktop-settings-settings.png)
- [desktop-variables-committed](screenshots/desktop-variables-committed.png)
- [desktop-variables-interrupted](screenshots/desktop-variables-interrupted.png)
- [desktop-variables-live](screenshots/desktop-variables-live.png)
- [desktop-world-committed](screenshots/desktop-world-committed.png)
- [desktop-world-interrupted](screenshots/desktop-world-interrupted.png)
- [desktop-world-live](screenshots/desktop-world-live.png)
- [mobile-settings-settings](screenshots/mobile-settings-settings.png)
- [mobile-variables-committed](screenshots/mobile-variables-committed.png)
- [mobile-variables-interrupted](screenshots/mobile-variables-interrupted.png)
- [mobile-variables-live](screenshots/mobile-variables-live.png)
- [mobile-world-committed](screenshots/mobile-world-committed.png)
- [mobile-world-interrupted](screenshots/mobile-world-interrupted.png)
- [mobile-world-live](screenshots/mobile-world-live.png)

最终基线原始日志：[完整工程](logs/check-integrated.log.gz)、[Prompt](logs/prompts-integrated.log.gz)、[新增双端](logs/browser-integrated.log.gz)。同步前稳定全范围：[34 项](logs/browser-verified.log.gz)。
