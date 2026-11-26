# 文学创作权移交 · 浪潮 1118 验收

基线为 `release/1.0` 的 `f6ca1ca8e961652ea8cdb8a490e3e8d653cd0482`。本批使用已有的《我即浪潮 · 1118 peinture》王朝适配版。所有模型数据均为合成夹具，传输验收包含本机 HTTPS 服务。

## 最终整改 · 旧断点续写的单次传输

审查起点为 `82e3a9f`。只有在玩家为来源未知的旧断点确认续写时，游戏才选定本次传输路径。「续写正文」默认直连；渠道端点符合既有中转规则、且设置允许时，玩家可以点「通过本站中转续写」。确认框显示本次路径。两种操作均保留全局设置。

原先的授权包围整个 `AiClient.response`，里面的 `fetchWithRelay` 在直连失败后仍可调用第二次 fetch。现在授权携带选择的路径，经 runtime 传到实际发送回调。完成原有 IndexedDB 草稿、正式版本、页面、取消信号及文学配置核对后，授权只可消费一次。中转路径还会复核中转设置。已发出后使用冻结的文学配置。Worker 对每个有效入站 POST 只发起一次上游 fetch，并拒绝跟随重定向。普通 Story、其他阶段和模型列表继续使用原来的中转策略。

无法确定请求是否受理时，页面提示模型服务可能已受理或计费。协调器记录诊断，保留原草稿和文学归属，等待玩家重新选择并确认。成功的续写才进入已有候选与结算链。实现见 [传输入口](../../src/services/ai/corsRelay.ts)、[一次性确认](../../src/workflows/legacyContinuation.ts) 和 [Worker 转发](../../src/aiRelay.ts)。

### 实际收件及正式状态

同一 V10 浪潮断点、桌面 Chromium 和 Pixel 7 模拟，观察结果在两端一致。第一列 POST 为浏览器发起的直连请求，因此预检被拒绝时它仍可为 1。Worker 列为本站中转收件，模型列由本机 HTTPS 服务读完整请求体后计数。回合和 revision 在本夹具内数值相同。新验收用例开启了阶段自动重试。

| 场景 | 浏览器直连 POST | Worker POST | 模型收到 POST | 回合与 revision |
| --- | ---: | ---: | ---: | --- |
| 直连正常完成 | 1 | 0 | 1 | 1 → 2 |
| 等待 OPTIONS 时另一标签修改节奏，预检失败 | 1 | 0 | 0 | 均保持 1 |
| 直连 POST 已受理，200 响应不允许跨域读取 | 1 | 0 | 1 | 均保持 1 |
| 玩家确认中转，正常完成 | 0 | 1 | 1 | 1 → 2 |
| 玩家确认中转，上游收件后断开连接 | 0 | 1 | 1 | 均保持 1 |
| 全局中转关闭，直连响应无法读取 | 1 | 0 | 1 | 均保持 1 |
| 玩家重新确认，用中转完成上次直连失败的续写 | 1 | 1 | 2，两次独立授权 | 第一次保持 1，第二次到 2 |
| **已知边界**：直连复用 HTTP/1.1 连接，服务读取正文后立即断开 | 1 | 0 | **2** | 均保持 1 |

整改前，预检反例在节奏变化后仍由 Worker 发送 1 次并结算；直连 200 反例让模型收到 2 份相同正文并结算。整改后，两项均保留完整的原始 IndexedDB 草稿。详细计数、请求体哈希、修复前后版本及项目身份见[双端实测记录](literary-ownership/continuation-transport.json)。

### 独立探针与未关闭的浏览器边界

- 原独立中转探针共 12 项。审查版 4 通过、8 失败；修复后原样复跑 6 通过、6 失败。四个旧等待条件分别要求失败后结算或递增草稿版本，与现在的断点保留行为冲突。另两个是双端的原始服务器单收断言，实收 2 次。
- 对照运行保留了服务器收件断言，改用失败提示和完整 IndexedDB 草稿作为等待条件，在发起请求前装好 Worker 路由拦截。12 项均通过。CDP 拦截会改变预检及连接复用，这组结果不能证明浏览器不会自行重放。
- 仓库新增的 16 项双端验收在直连路径上使用真实 TLS、被浏览器信任的临时证书公钥和实际预检；在中转路径上执行仓库 Worker，转发到同一本地模型。14 通过、2 失败、0 跳过。两项红灯均为上表最后一行，严格的服务器单收断言保留在用例中。
- 单独使用 Chromium 原生 fetch、移除游戏与中转后，相同的 HTTP/1.1 复用连接仍导致模型端收到两次同文 POST。Chromium NetLog 记录 `HTTP_TRANSACTION_RESTART_AFTER_ERROR`；让预检服务关闭连接的对照只收到一次。应用能核对发起 fetch 时的授权，无法从浏览器网络错误判断服务商的准确受理或扣费结果。按负责人决定保留现有直连兼容性，该边界继续公开记录。没有调用真实付费服务。

工程检查通过，含全量 Vitest 5,481 项、TypeScript、ESLint 和生产构建；受影响 Vitest 259 项、Prompt 93 项均通过。仓库文学与续写 Chromium 50/50、正式版定向门槛及集成冒烟 44/44、此前独立探针 6/6 和 11/11，各组单列。一次开发服务器热更新使历史屏障探针挂到旧模块，已中止该轮；冷启动后按原断言、零重试完成 50 项。既有的手动重新生成缺标签后出现 TURN_INCOMPLETE 继续列为正式版独立待办。

### 复跑

Node 24、锁文件、Chromium、OpenSSL，5174 端口。预检竞争使用可控 Promise。已知 HTTP/1.1 重放会使严格传输专项在本次 Chromium 版本下返回非零。

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/cors-relay.test.ts src/tests/ai-relay-worker.test.ts src/tests/ai-relay-compat.test.ts src/tests/failure-auto-retry.test.ts src/tests/story-{writing-repair,stage,continuation,continuation-coordinator}.test.ts src/tests/turn-commit.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-continuation-transport.spec.ts --workers=1 --retries=0
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-continuation-consent.spec.ts e2e/story-legacy-writing.spec.ts e2e/story-literary-ownership.spec.ts --workers=1 --retries=0
```

## 第二轮定向整改

在 `628b1d3c2dd85752f8e8fec948081f8f4be2a640` 上分别运行独立审查端的切档、跨标签修改节奏、历史占位文本探针。桌面与手机模拟的六个用例均失败。修复后同六项全部通过，首次独立审查的 11 个原始用例也已复跑通过。两套 V10 断点在独立安装锁文件的发布基线上重新生成，并核实了当时的出站请求。[HTTP 与 IndexedDB 前后对照](literary-ownership/review-round2.json)

| 故障路径 | 修复前 | 修复后 |
| --- | --- | --- |
| A 等待配置摘要时切至 B | B 弹出确认，发出 1 次含 A 断点的 POST，A 的回合和 revision 均由 1 变为 2 | 0 次弹框、0 次 POST，两档均保持 (1, 1)，原断点仍可读 |
| 确认后另一标签保存新节奏，随后才放行历史读取 | 已确认 1 次，仍发送 1 次并结算 A | 确认 1 次、0 次 POST，两档正式状态及草稿保持原值。原文可复制，可重新确认 |
| 仅修改历史占位文本后恢复断点 | 两份请求均为 99,919 字节，SHA-256 相同；v2 指纹相异，阻止续写 | 同一独立探针的请求仍逐字节相同，v3 指纹也相同，合法续写只发 1 次并保留原文 |

**操作与发送边界。** `GameScreen.continueWorkflow` 在摘要计算前为当前操作创建唯一标识，页面卸载、路由变化、存档或草稿更换、主动重写或放弃都会撤销旧操作。重复点击沿用正在等待的交互。离开 A 再返回 A，需要重新确认。`workflows/legacyContinuation.ts` 在展示确认前和发送前复核正式 revision、完整草稿及断点；确认与领取只能各成功一次。草稿绑定覆盖存档、回合、草稿及正文版本和已写片段。

`TurnCoordinator` 和 `StoryStage` 在原有执行锁内领取授权。对这种旧断点，阶段配置的草稿写入延后至成功生成，避免发送前失效导致草稿 revision 变化。提示词、世界书和包装器完成准备后，`AiClient` 在统一传输入口调用授权的 `dispatch`。重新读取 IndexedDB，再同步比较持久化配置与宿主实际配置，核对取消及页面状态后直接调用传输；模型请求计数也从实际发送时开始。合法发送后仍使用原冻结配置，旧片段继续标为 `prefixSource: "unknown"`。该人工授权只放行一个旧断点的首次传输；失败后由玩家决定下一步。其他生成保留原有重试设置。

**指纹与实际装配。** `presets/messages.ts` 的 `literaryEntry` 供消息装配和 v3 指纹共用。历史槽只表示插入历史；八个宿主资料槽使用实际材料、角色及位置；普通条目使用原提示词及角色。绝对插入保留深度与顺序，禁用和锁定关闭的条目不参与。包加载器提供有效条目顺序，已启用脚本按宿主顺序、脚本文本和该预设声明的生成配置投影参与计算。每回合资料、历史、随机展开结果和控制台界面状态均不进入摘要。有效文本、顺序、角色、位置、脚本或节奏变化仍会阻止按旧配置续写。

`presets/library.ts` 的 `canResumeWriting` 分版本验证。对 v1 覆盖摘要、v2 有效条目摘要，以各自旧算法复算当前覆盖，或证明旧摘要来自发行默认且当前 v3 配置与默认等价；同时比对预设 ID 和版本。无法证明的摘要保留断点并提示恢复配置或重新生成。只在产生新内容后写入 v3。以下历史验收段落的“第 2 版”指首次整改时的实现。

**复审复跑。** 在 Node 24、锁文件依赖和独立 Chromium 存储下执行。Playwright 使用仓库配置的 5174 端口、一个 worker 和零次重试。三份浏览器套件分别验证可控摘要及历史读取屏障、旧原生与旧浪潮的四种续写组合、三种模式的实际出站与异常结算。既有的“手动重新生成缺标签导致旧候选仍在但阶段为 failed，提交返回 TURN_INCOMPLETE”在发布基线与修复后均可复现，继续作为正式版单独待办。

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/story-writing-repair.test.ts src/tests/story-stage.test.ts src/tests/story-continuation*.test.ts src/tests/turn-commit.test.ts src/tests/preset-story.test.ts
npx playwright test e2e/story-continuation-consent.spec.ts e2e/story-legacy-writing.spec.ts e2e/story-literary-ownership.spec.ts --workers=1 --retries=0
node e2e/fixtures/story-writing/verify-baseline.mjs /path/to/clean-installed-f6ca1ca
git diff --check 628b1d3c2dd85752f8e8fec948081f8f4be2a640 HEAD
```

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
