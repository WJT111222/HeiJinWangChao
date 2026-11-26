# 文学创作权移交 · 浪潮 1118 验收

基线为 `release/1.0` 的 `f6ca1ca8e961652ea8cdb8a490e3e8d653cd0482`。本批使用已有的《我即浪潮 · 1118 peinture》王朝适配版。所有模型传输均由浏览器路由或测试传输层返回合成数据。

## 首轮开发验收的出站与结算

同一份合成存档、同一普通回合，玩家设置为第一人称、冷硬黑色、4000～5678 字。Playwright 截取页面真实脚本和协议转换之后发向模拟渠道的 HTTP POST。每种模式各在桌面和手机模拟环境执行，先返回一份完整短正文，再依次返回空正文、截断、拒答及标签错误。

| 模式 | 在实际请求中命中的文本 | 工具 | 完整短正文 |
| --- | --- | --- | --- |
| 原生 | 4000～5678 字、第一人称镜头、冷硬黑色 | 无 | 拒绝保存，记录 narrative_short |
| 独立防截断 | 同原生 | wave_context_reference、actual_content | 拒绝保存，记录 narrative_short |
| 文学预设 | 800至1000字，来自浪潮默认篇幅条目；上述三个原生指纹均未出现 | wave_context_reference、actual_content | 保存为候选；其余四次失败后原候选仍可显式提交，正式回合前进一次 |

每种模式在每个视口均为五次主动操作、五次出站；模型输出预算均为 8192 Token。四类失败保留提交前的正式版本和先前候选。开局和普通回合的另一组 169 字响应，在基线的真实运行入口均因最低 4000 字失败。改动后两者均可通过文学预设校验。

[分视口出站字段与五次尝试结果](literary-ownership/wire.json) · [桌面截图](literary-ownership/desktop.webp) · [手机模拟截图](literary-ownership/mobile.webp)

## 归属与恢复

- `src/presets/library.ts` 以实际生效的预设标识确定文学归属。`src/services/ai/runtime.ts` 对本次选定的设置、预设及覆盖配置取快照，组装、格式提醒、正文校验和失败留存使用同一次选择。
- `src/domain/storyWriting.ts`、`drafts.ts`、`src/workflows/storyStage.ts` 在候选和截断文本上分别记录归属。原生记录篇幅、文风、人称与自然文风设置；预设记录标识、版本以及文学条目、脚本和变量配置的 SHA-256。草稿不保存自定义提示词。相同 Story 版本的候选及其归属受原有版本保护。
- 主动重新生成使用新请求的设置；已生成的完整候选继续使用当时的校验结果。关闭、切档、刷新后从对应草稿恢复。文学续写需要相同的预设、版本和文学配置，变动时在发送前提示恢复设置或主动重新生成。原生续写保留原先允许玩家调整原生篇幅后重试的行为。V10 未记录来源的断点保留原文；玩家选择本次续写来源后，在发送前校验该次确认。详见下方复审整改记录。
- `src/domain/storyContinuation.ts`、`src/ui/game/GameScreen.tsx` 对预设正文只显示实际进度，无原生字数差额。空白、截断、未完成工具参数、拒答、内容过滤、标签和领域校验、续写上限、保存事务仍由既有链路执行。

## 提示词与控制台

| 位置 | 改动 |
| --- | --- |
| composer、literaryStory、formatTail、共享正文协议 | 在文学模式移除原生篇幅、人称、文风、纯写作模板与规划步骤。混合模块另取游戏规则投影，保留行动可行性、角色知情、关系、同意边界、因果和事件入场等约束。原生两种模式仍展开原有模板。 |
| 预设资料与最终提醒 | 保留内置世界书、存档和角色事实、当前玩家行动、短期记忆、行动选项、开局 time:opening 与事件回执。原生 PROMPT_SETTINGS 不进入预设消息。API 输出上限仍由渠道控制。 |
| 浪潮包、控件及锁定清单 | 恢复原版的固定 800～1000、动态较多、动态较少三项互斥篇幅选项，交付提示读取对应宏。维持附页、自定义标签、时间栏及第二套变量等现有禁用项；主脚本内容沿用原版王朝适配文件。 |
| SettingsPanel、PromptInspector、TavernAssistant、PeintureLauncher、PeintureSettings | 接管时禁用原生文学设置，保留原值；玩家行动权限、难度和选项仍可设置。文学入口按选中的预设打开。现有创角步骤仅编辑剧情难度。 |

## 首轮验证与边界

Node 24.19.0，锁文件依赖。完整工程检查、全量 Vitest（229 个文件、5461 项）、提示词专项（93 项）、八个正文及预设相关单测套件（233 项）通过。专项数字属于全量单测的子集。

桌面 Chromium 与 Pixel 7 视口均使用合成存档。额外执行生产构建下四协议 JSON/SSE、响应诊断和控制台布局共 28 项；四组正式版定向门槛共 16 项；总集成 PR 的城市、小剧场、提示音、势力及后宫各一项双端冒烟共 10 项。开局时间与结算恢复在 Story 专项中单独验证。

首次运行 128 个浏览器用例时 113 通过、15 失败。对 15 个失败身份另起独立 Vite 进程逐项复跑，全部通过。相同基线下另外执行八个宿主对照用例，也全部通过。接管界面、独立模式可编辑性、刷新还原在桌面和手机模拟共四项通过。各次运行含重叠用例，不能相加作为独立覆盖数。

真实模型对文学选项的遵从程度、物理手机上的阅读体验及其他文学预设均未在本批验证。

## 独立审查后的三项整改

发布基线为 `f6ca1ca8e961652ea8cdb8a490e3e8d653cd0482`，独立审查复现于 `19d62de2cc01b6f6cb0e173201a6d9a854c46889`。以下结果来自本轮重新运行的合成测试。原始玩家数据和真实模型均未参与。

| 缺陷 | 修复前的可观察结果 | 修复及检查位置 |
| --- | --- | --- |
| P1 不可见正文可结算 | 浪潮收到只含 U+200B 的正文。实际一次 POST，保存候选，显式提交使回合数增加 1，历史正文唯一的码点为 8203。 | `domain/storyContent.ts` 的 `hasVisibleNarrative` 检测 Unicode 空白、控制、格式、默认可忽略字符和空白盲文。解析、候选写事务、正式就绪及提交均有检查。有效性与原生篇幅下限单独判断。单个「行」、组合音标、Emoji 序列及有连接符的文字逐码点保留。 |
| P1 V10 断点错认归属 | 基线正式 Story 生成的浪潮断点在原选择下续写零传输并报配置变化；关掉浪潮反而发出 1 次请求，候选被记为全篇原生。 | `GameScreen.continueWorkflow` 展示当前选择并确认。`StoryStage.generate`、`TurnCoordinator.generate`、`runStageRequest` 在发送前校验。缺少来源时允许阅读、复制、取消、显式重新生成。新续写记录实际来源，并用 `prefixSource: "unknown"` 标明旧片段；确认保存在本次操作中。截断后再次刷新仍保留这两项归属。用于主动重写旧断点的请求失败时，保留原断点。 |
| P2 恢复默认后指纹变化 | 原始 SHA-256 为 `03ee833b…`，设置由固定篇幅改为动态再恢复，解析后的有序条目完全相同，SHA-256 变为 `e6ed672b…`，续写被拒绝。 | `presets/library.ts` 的 `effectiveConfiguration` 读取包加载器合并过、执行过锁定规则的有序条目和实际启动脚本，保留文本、角色和插入位置。每包可声明脚本用于生成的配置。浪潮主脚本归一化交付模式和转义选项，控制台的纯界面状态排除。互斥切换复用已有编辑器。有效配置相同得到相同的第 2 版指纹。 |

### 旧草稿及失败保护

- 没有 `writing` 的片段可来自原生或文学预设。确认对话框只决定增补部分。点击取消、确认后实际文学设置变化、已知预设 ID 或版本不匹配都不会产生新的模型传输。原生的已知来源允许调整原生篇幅后继续写。
- 对已经有第一版指纹的预设草稿，先验证包 ID、版本及旧算法摘要。旧摘要可以由当前覆盖记录精确复算，或者由发行默认值精确复算且当前有效配置也等于该默认值。两条均无法证明时保留原文并阻止续写。草稿通过验证并写入新内容后，使用第 2 版指纹。仅剩旧摘要时，不能反推出任意一组历史编辑。
- V10 档、草稿和历史仍按原有格式读取。历史上已经写入的不可见候选可以读取，但通过正式提交时会得到 `TURN_INCOMPLETE`。此次没有批量改写历史正文或提高 GameState 版本。
- 独立审查另在发布基线和审查 HEAD 均复现一项既有问题。先保存合法候选，再以手动失败保存回调重新生成，返回缺失标签的内容：旧候选仍在，但 Story 阶段被写成 `failed`，显式提交报 `TURN_INCOMPLETE`，正式版本不变。建议单独区分“最近一次尝试失败”与“已选候选就绪”。本次对不可见响应保留已选合法候选的原状态，未整体改动失败保存工作流。

### 文件与复跑

| 文件（仓库相对目录） | 职责 |
| --- | --- |
| `src/domain/{storyContent,storyDiagnostics,drafts,turnCommit}.ts`、`src/services/validation/aiOutputs.ts` | 正文可见性、错误分类、新候选写入、结算 |
| `src/domain/storyWriting.ts`、`src/presets/{library,peintureSettings,scriptOrder}.ts`、`src/presets/tavern/scriptHost.ts` | 快照格式、旧指纹核对、按实际脚本及有效文学配置取摘要；宿主和指纹共用脚本执行顺序 |
| `src/services/ai/{runtime,errors}.ts`、`src/workflows/{storyStage,turnCoordinator}.ts`、`src/ui/game/{useTurnGeneration.ts,GameScreen.tsx}` | 请求前归属核对、续写确认、恢复入口、失败时保留正文 |
| `src/tests/{story-writing-repair,story-stage,story-continuation,story-continuation-coordinator}.test.ts` | 可见文本、原子提交、指纹等价、配置变化、已知原生途中调整篇幅 |
| `e2e/story-legacy-writing.spec.ts`、`e2e/story-literary-ownership.spec.ts`、`e2e/fixtures/story-writing/` | V10 真实断点及重采脚本，双端来源确认、三模式最终 HTTP 与候选对照 |

Node 24 安装锁文件依赖后，在 PR 工作区运行以下命令。Chromium 可用 Playwright 安装版本；使用系统 Chromium 时设置 `CHROMIUM_PATH`。

```sh
npm ci
npx vitest run src/tests/story-writing-repair.test.ts src/tests/story-stage.test.ts src/tests/story-continuation*.test.ts src/tests/turn-commit.test.ts
npx playwright test e2e/story-legacy-writing.spec.ts e2e/story-literary-ownership.spec.ts --workers=1 --retries=0
npm run check
npm run prompts:check
```

核实两份 V10 夹具来源时，在独立目录检出发布基线并按锁文件安装依赖。以下命令检验基线 HEAD 和已跟踪源码，然后启动本地服务，分别通过原生以及真实浪潮 iframe 执行 Story 请求，从 IndexedDB 读取草稿，并比较完整草稿和工具声明。模型端点由浏览器路由返回合成响应。

```sh
node e2e/fixtures/story-writing/verify-baseline.mjs /path/to/clean-installed-f6ca1ca
```

### 本轮实际结果

环境为 Node 24.19.0 与 Chromium 154.0.8037.57。浏览器使用 Desktop Chrome 和 Pixel 7 模拟配置、一个 worker、零重试。比较范围均为合成响应。

| 检查 | 通过 | 失败 | 跳过 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 完整 Vitest | 5,474 | 0 | 0 | 230 个文件；已计入 `npm run check`。锁文件安装、ESLint、TypeScript、生产构建及差异空白检查通过。 |
| Prompt 专项 | 93 | 0 | 0 | 3 个文件。 |
| 正文修复、续写、候选及结算定向 Vitest | 163 | 0 | 0 | 5 个文件，含确认后保存的候选仍标有旧片段来源未知的断言。 |
| Chromium 扩展验收 | 171 | 1 | 0 | 桌面 86/86、手机模拟 85/86。包含正式版四组门槛 16/16、已集成功能冒烟 10/10。唯一失败见下。 |
| 修正手机测试操作后，重新完整运行旧档升级及三模式出站两套 | 14 | 0 | 0 | 桌面 7/7、手机模拟 7/7。与前一行重叠 14 项。其余 158 个身份在扩展验收中均通过。 |
| 同一独立探针在两个版本录制的故障与修复证据 | — | — | — | 审查版 8 项观测脚本按预期完成，含两个真实基线夹具。修复版 6 项探针通过，初次即收到纯 U+200B 的三种模式，正式回合增量全部为 0。另在两个旧版本各复现一次手动失败回调问题。 |

初次双端专项为 13/14，新测试的两次确认框操作存在竞争。在点击前注册并等待对话框处理完成后消除了竞争。一次扩展验收在 30 项通过后主动停止，以加入旧断点重新生成失败的保护。随后完整的 172 项验收中，手机用例在失败详情抽屉仍可见时尝试点击背后的续写按钮，trace 显示 `mobile-diagnostics-sheet` 持续拦截点击。用例现先核对 `invalid_output`，通过真实关闭按钮收起详情，再继续确认。社区模型、物理手机和全仓 Playwright 均未在本轮测试。

本轮三模式每个视口各六次主动生成，HTTP POST 次数与操作次数相等。原生和独立防截断仍拒绝不足 4000 字的正文。文学预设保存完整短正文，随后五次失败均保留候选，显式提交一次。默认篇幅往返的第 2 版指纹在实测中两次均为 `0c1b84c5…`，总共两次传输分别对应首次生成及玩家主动续写。[修复前后探针、最终出站与草稿结果](literary-ownership/review-repairs.json)
