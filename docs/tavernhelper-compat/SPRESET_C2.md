# SPreset 核心运行时原型（C2）

## 合法工具调用前的排版空白

独立复审使用同一份 `submit_scene` 参数，分别直接交付和在交付前增加空格与换行。在 `82dca2fe` 上，四协议各自在桌面和手机复现误拒。公共解析器已确认唯一完整调用，C2 却将排版空白填入处理器的独立正文字段。处理器收到两种交付后拒发收据。每份失败样本只发送了一次请求。

C2 现在把公共解析器针对原始帧建立的 `matchesDelivery` 核对函数带到 `PrototypeSession.read`。只有已验证的工具参数与伴随文本共同通过核对时，宿主才把传给 `finish` 的独立正文字段设为空串。工具参数和原文观察器继续接收原字串，收据仍按实际输出的 UTF-8 字节数和调用 ID 校验。纯文本保留原有空白。真实竞争正文在进入处理器前失败。[响应读取](../../src/presets/spreset/response.ts) · [处理器入口](../../src/presets/spreset/session.ts) · [公共契约](1124/upstream-contract.md)

| 同一组合的实测结果 | 整改前 | 整改后 |
| --- | --- | --- |
| 直接工具交付，四协议 × 双端 | 8/8 结算 | 8/8 结算 |
| 工具前增加空格与换行，四协议 × 双端 | 0/8 收据，0/8 候选 | 8/8 收据，8/8 候选并结算 |
| 四协议真实竞争正文 × 双端 | 本轮未重新采集旧树此组 | 8/8 在 `finish` 前拒绝，回合与 revision 增量均为 0 |

本地 Mock 服务记录实际收到的 POST，浏览器通过私有端口观察 `finish` 及收据，再从 IndexedDB 读取候选与正式回合。原配对样本的逐份响应哈希在修复前后相同。一个工具正文为 122 UTF-8 字节的样本，旧宿主发送的 `finish.text` 为一个空格和换行，新宿主发送空串，收据为 `local-call / 122`。候选保存前后回合和 revision 都是 1，显式提交后两者都是 2。另有 8 个多段 SSE 样本检查工具参数首尾、正文内部换行与缩进、原文观察顺序及收据字节数。[逐样本证据](spreset-c2-padding-evidence.json) · [四协议浏览器断言](../../e2e/spreset-prototype.spec.ts)

最新发布基线为 `3be381f64808b16d46ed54c6cf1fb0065555c0ed`。合流提交保留 #248 的完整署名文件，在其后附回原 #251 的 SPreset 署名、GPLv3 许可和对应源码说明。1118、1124、文生图及既有许可记录保留。C2 处理器、Worker、许可文本和 iframe 四个文件的 SHA-256 均与原清单相符。[合流提交](https://github.com/WJT111222/HeiJinWangChao/commit/ed4067fa9b524f4ad9fd87be9cab175f84fbd7ed) · [双方署名](../../THIRD_PARTY_NOTICES.md) · [源码指纹](../../experiments/spreset/SOURCES.json)

### 复跑范围

Node 24.19.0、锁文件依赖、Chromium 154.0.8037.57，5174 端口。所有浏览器用例使用独立上下文和 Mock 模型，单 Worker、零重试。

| 检查 | 实测结果 |
| --- | --- |
| `npm run check` | 241 个文件的 5,665 项 Vitest、ESLint、TypeScript、命令目录和生产构建通过 |
| `npm run prompts:check` | 93 项通过，属于全量单测子集 |
| 协议、处理器、指纹及图片定向单测 | 156 项通过，含 8 项四协议 JSON/SSE 纯文本原样交付、收据为空。另跑三段变量定向 25 项通过，均计入全量单测 |
| 正式版与图片 Chromium 定向 | 172 项通过，0 失败、跳过或不稳定。覆盖此前 144 个测试身份、8 个新增分段 SSE 身份和 20 个文生图、人物图库及相册身份 |
| 三段变量与文生图共同结算 | 双端另测 2 项通过，核对阶段顺序、正式版本与资金、单次图片请求及跨标签去重 |
| C2 三个套件单独复跑 | 52 项通过，0 失败、跳过或不稳定，包含原 44 项及新增 8 项。34 份畸形响应的处理器调用、收据、候选及正式状态增量均为零 |
| 独立审查探针 | 原配对 16/16、补充探针 20/20、原解析探针 45/45、Anthropic 关闭块 3/3。各组有重叠 |
| 历史兼容与生产入口 | 双端从实际 v3 断点继续到 v4，回合与 revision 各加 1。扫描 141 个生产文件，六个实验特征均无命中。双端生产预览中的实验 iframe 和 Worker 均为 0 |

复跑本批维护的浏览器断言：

```sh
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/spreset-prototype.spec.ts e2e/spreset-terminal.spec.ts e2e/spreset-isolation.spec.ts --workers=1 --retries=0
```

本轮采用合成数据。全量 Playwright、物理手机和真实付费渠道未执行。其他模式的 `TURN_INCOMPLETE`、Chromium 底层 POST 重放，以及 C3 组合分发许可继续作为独立待办。

## 联合复审整改与正式版合流

#251 的代码合流提交为 `a390d9ad55b3778485d2a6e46df1c693f8cb6c60`。它保留了原 C2 开发历史，第二父提交为 `release/1.0@46b1009f06f17ab610aadd4082e25c4d4cbac0c9`，包含 #252 和 #250。#252 的合并提交为 `d4d35f77930992b78821e3966c02588e257542e1`。[合流源码](https://github.com/WJT111222/HeiJinWangChao/commit/a390d9ad55b3778485d2a6e46df1c693f8cb6c60) · [本次双端 HTTP、收据、IndexedDB 与构建证据](spreset-c2-merge-evidence.json)

### 上游响应与正式结算

整改前，两端交付的 32 份畸形响应中有 20 份进入本地处理器，取得收据并在显式提交后推进了存档。原始红灯记录保留在前次证据中。[整改前证据](spreset-c2-review-evidence.json)

合流后，C2 将期望的工具名 `submit_scene` 传给 #252 的 `UpstreamFrames`。共用帧解析、工具调用唯一性、供应商结束原因和 Anthropic 内容块关闭校验全部通过后，C2 才能读取唯一的完整调用并进入 `PrototypeSession.read` 的本地处理器。宿主核对收据中的调用 ID 与 UTF-8 正文字节数。无工具的完整纯文本可以交付，收据为空。公共解析器相对发布分支只增加了 C2 所需的导出及只读调用访问器。[公共校验](../../src/presets/tavern/upstream.ts) · [C2 响应入口](../../src/presets/spreset/response.ts) · [收据核对](../../src/presets/spreset/session.ts)

桌面和手机 Chromium 的 16 个终端异常用例共发送 34 份畸形响应。它们覆盖四协议 JSON/SSE 的重复工具、错配结束标记，以及 Anthropic SSE 收到合法 `tool_use` 但关闭块索引为 `null` 的反例。每份均在处理器 `finish` 前失败，实测收据、已保存候选、正式回合及 revision 增量全部为零。正常工具交付共 16 份，每份实测仅一次 Mock HTTP POST，候选保存后正式版本不变，显式提交后回合和版本各增加 1。另用 8 个四协议 JSON/SSE 单测验证正常纯文本交付和空收据。[浏览器断言](../../e2e/spreset-terminal.spec.ts) · [成功样本与重新生成保护](../../e2e/spreset-prototype.spec.ts)

### 数据隔离与公共接口

在两个 Chromium 项目的真实处理器中，Worker 的来源均为 `null`。打开合成正式库及枚举 IndexedDB 都得到 `SecurityError`。游戏 DOM、Cookie 和 Web Storage 访问被拒绝，Cache Storage 与 OPFS 不可用。主动测试的网络请求被阻止，接收端为零。销毁实例后，合成正式档和草稿与操作前逐项相同。另测了错误或过期会话、重复序号、未授权操作，以及取消、超时、切档和刷新。[沙箱、私有端口与生命周期探针](../../e2e/spreset-isolation.spec.ts)

保留 1118、1124 的公开注册及各自许可署名。仅开发环境的 C2 注册复用正式版 v4 文学归属与配置投影。独立防截断继续使用原生文学设置。共享 runtime 保留 #250 的三段变量生成，`entities`、Variables、World、Memory 和小剧场经原渠道执行。双端各验证五次独立请求，均无 C2 工具或处理器。已有合法 C2 候选时，手动重新生成失败后仍可提交旧候选。其他模式的 `TURN_INCOMPLETE` 保留为全局发布待办。

### 本次验收

| 范围 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| Node 24 完整工程检查内的全量 Vitest（239 文件） | 5624 | 0 | 0 |
| 五个受影响的 Vitest 套件（上述子集） | 118 | 0 | 0 |
| Prompt 专项（上述子集） | 93 | 0 | 0 |
| 原联合审查解析探针 / Anthropic 内容块关闭探针 | 45 / 3 | 0 | 0 |
| 桌面与手机 Chromium，含 C2、文学归属、续写、1118/1124 控制台与正式版定向门槛 | 144 | 0 | 0 |
| 单独复跑 C2 双端（原 22 项、隔离 6 项、终端反例 16 项） | 44 | 0 | 0 |

各行有交叠。Chromium 均使用 5174 端口、单 worker、零重试。原联合审查探针分别直接接入合流后的 C2 解析器和实际本地收据生成逻辑。生产构建的 136 个文件保留两套浪潮资源，按文件名和文件内容扫描六个实验标识均为零命中。实验核心、Worker、桥接脚本和许可文件通过固定 SHA-256 清单核验。完整工程检查、生产构建与两侧 Git 差异空白检查均已通过。[联合审查原始探针](1124/anthropic-block-evidence.tar.gz) · [构建及测试分项](spreset-c2-merge-evidence.json)

C3 仍需分别完成原版工具历史权限、正则及消息处理、神域控制台和组合分发许可审核。本地开发实验与当前仓库的 GPL 源码分发保留署名、修改说明、完整许可及对应源码。面向玩家分发组合产物前须核对各组件权利，落实对应源码提供方式。浏览器沙箱的隔离证据仅涉及运行权限。真实模型效果、实际缓存收益及物理手机表现均未测量。

## 复跑入口

本次合流基线为 `release/1.0@46b1009f06f17ab610aadd4082e25c4d4cbac0c9`。使用 Node 24、锁定依赖、合成存档和拦截在 HTTP 边界的 Mock 模型。Playwright 会启动端口 5174 的本地开发服务。

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/{spreset-terminal,spreset-prototype,tavern-provider-integrity,tavern-anthropic-blocks,peinture1124}.test.ts
mapfile -t cases < <(node -e "console.log(require('./docs/tavernhelper-compat/spreset-c2-merge-evidence.json').playwright.selection.join('\n'))")
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test "${cases[@]}" --workers=1 --retries=0
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/spreset-prototype.spec.ts e2e/spreset-isolation.spec.ts e2e/spreset-terminal.spec.ts --workers=1 --retries=0
git diff --check
```

独立复跑联合审查原探针时，在已执行 `npm ci` 的仓库根目录运行以下命令。两份 JSON 会写入临时目录的 `evidence/`。

```sh
probe_dir=$(mktemp -d)
mkdir "$probe_dir/evidence"
ln -s "$PWD" "$probe_dir/c2"
tar -xzf docs/tavernhelper-compat/1124/anthropic-block-evidence.tar.gz -C "$probe_dir" --strip-components=1 probes/parser-probe.mjs probes/c2-close.mjs
(cd "$probe_dir" && node parser-probe.mjs && node c2-close.mjs)
```

开发入口为本机 Vite 上的 `/?spreset=prototype`。它只在未启用其他模式时生效，安全模式始终优先。普通设置不展示此入口。刷新后由页面地址与当前选择重新判定。请求执行的是现有 StoryStage、IndexedDB 候选与 commitTurn。只在测试中注入模型响应。截断、权限、时钟与结算的决定权都在游戏侧。

## 原包及许可

- Meowssiah-2.1.7 原包有 56 条提示词、8 条主正则、SPreset 内 8 条绑定正则，以及 SPreset 加载器、菜单两份 TavernHelper 脚本。菜单版本为 3.0-Preview-01，ID 301。适配许可由项目负责人确认，保留小猫之神署名。
- 固定网页源码提交 `53bd585da14248ba10baaede7fc7ed0cebe1eeeb`。逐字节比较，附件加载器与该提交的 `regex_bind/index.js` 只差末尾 LF。加载器指向可变地址，原作者当时线上部署过的 inject.js 字节仍无法从附件证明。
- SPreset 的 `regex_bind/LICENSE` 为 GNU GPL 第三版。实验按 GPL-3.0-only 保留作者署名、修改说明、完整许可、可编辑源码和固定来源。许可证不授予更改其他作品许可的权利。王朝仓库没有整体再许可声明。分支仅以源码提供独立消息式组件，常规生产构建不交付该 Worker。若 C3 计划一起向玩家分发，须核实整套组合作品的权利及对应源码交付方式；独立进程或消息接口本身不能证明许可兼容。 [固定源码树](https://github.com/starowo/starowo.github.io/tree/53bd585da14248ba10baaede7fc7ed0cebe1eeeb/regex_bind) · [上游与本地文件 SHA-256](../../experiments/spreset/SOURCES.json) · [完整许可](../../experiments/spreset/COPYING)
- 本地 `core.mjs` 保留了 `normalizeSPresetOutputProcessorResult`（916–943 行），适配了 `processSPresetFinalRequest`（1695–1720 行）的请求复制、静态处理、序列化及传输字段保护。`worker.mjs` 是新增的请求级宿主。两者独立于 React、ST、TavernHelper 及第三方包。配置版本中包含核心、Worker 和 frame.mjs 三个文件的组合 SHA-256。提示词与条目顺序参与正式版 v4 指纹，旧摘要沿用各自的兼容核对。
- 原包 `OutputPreprocessing.toolCallFormatter.script` 第 87–92 行的单字符串 content 分支用于完整工具参数；`OutputPreprocessing.script` 仅采用完整前导兼容思考块的收尾处理及 output/hold/state 契约。保留正文内部的标签。原生公开思考、正文 `<thinking>`、原始文本和正式正文分别处理。
- 原包 `FinalRequestProcessing.script` 包含 3127 行，依赖酒馆聊天元数据、菜单配置及其他请求变换。本实验使用静态注册的无害文学任务与本地终端工具，不运行该脚本整体、加载器、动态脚本编译器或远程编辑器。

## 宿主契约

| 阶段 | C2 权限与证据 |
| --- | --- |
| 选择与快照 | library 继续生成带预设 ID、固定版本和配置指纹的 StoryWriting。#247 的草稿、续写匹配、旧断点确认和最终传输授权继续生效。现有预设优先，实验不会注册进玩家预设列表。 |
| 初始化与卸载 | 每次请求单独创建沙箱和 Worker。只接受一次 prepare 和一次 finish。失败、取消、请求超时或结束均终止 Worker，清除事件监听；无页面级单例及跨档账本。 |
| FinalRequestProcessing | Worker 收到本次会话的消息、流式标记和固定协议元数据。宿主验证处理结果只能新增批准的工具声明和 auto 选择，禁止改动已有消息、提供商与生成设置。密钥、渠道地址、凭证仓库、事件总线及数据库对象均不传入。 |
| 工具与协议 | 宿主通过 tavernWire 转译一个受控函数 `submit_scene({content})`。OpenAI/DeepSeek 使用 tools + tool_choice:auto，Gemini 使用 functionDeclarations + AUTO，Anthropic 使用 input_schema + auto。保留原有渠道温度、Token 上限与凭证管理。 |
| 实际执行 | 真正完整的模型调用经原协议帧校验后，Worker 检查名称、ID 和唯一字符串参数，执行本地正文交付并返回关联 ID 与输出 UTF-8 字节数；宿主核对收据。纯文本正常完成亦可交付。整个过程一次请求，无工具回传、自动中转重发或隐藏补全。旧断点玩家显式选定的单次传输仍经过原授权检查。 |
| 流与完整性 | 复用酒馆的格式识别、四协议帧累积/校验及原生 SSE 读取器。在原始响应上检查取消、拒答、过滤、错误帧、finish reason、工具参数结构及 Anthropic 消息结束。仅有 DONE 或可解析的参数不构成完成。工具分片不进入原文缓存、断点或正式候选；普通文本经现有公开观察接口进入临时阅读与恢复。 |
| 权限隔离 | 不透明来源及专用 Worker 隔离正式数据，CSP 限制网络。仅允许已审核的本地处理器，独立端口按请求销毁。 |
| 结算 | 现有解析器校验正文、来源及候选。生成成功只写草稿。显式 commit 后正式档版本和回合各前进一步。变量阶段（含 entities）、World、Memory、小剧场均继续经过既有路径。 |

## 模块取舍及 C3 依赖

| 原包能力 | C2 处置与 C3 条件 |
| --- | --- |
| RegexBinding | 审核了八条绑定。显示折叠/HTML 面板属于 C3 控制台，发送侧对思考、旧小总结的过滤依赖原文学模板。C2 合成历史只有已结算正文，使用现有 historyForSending，不执行这八条正则或改写正式历史。C3 逐条核对 placement、深度与作用域后绑定。 |
| ChatSquash、MacroNest、MessageInjections | 附件中前两者关闭，消息注入表为空。C2 保留原顺序与角色，沿用现有宏装配；不引入聊天合并或任意宏执行。ForcedPostProcessing 虽启用，mode 为空。 |
| ToolBindings | 原包具名工具及外部插件依赖未获本实验执行权限。终端工具由专门的静态函数实现，使用经过上游验证的实际调用。本批不开放持久工具、任意多工具会话或二次生成。 |
| 工具历史 | 出站历史继续限于真实文本消息。终端工具只需要声明和一次真实的模型调用，结果在本地消费。C3 若确需后续工具轮，应另行传输经核对的原始 assistant 调用、真实执行结果和原厂关联信息，包括 Gemini 的签名、Anthropic 的 tool_use_id；须单独获得下一次请求授权。 |
| 缓存、历史及外部日志 | 不接入 ST chatMetadata、LogUpload、IndexedDB 副本、独立 MVU 或其他状态写入。缓存统计来自渠道 usage；固定相同请求前缀不等同于实际缓存命中。 |
| 神域控制台与文学包 | 本批仅合成文学条目。C3 接入获许可的原条目、互斥组与控制台时，为文学有效设置注册自己的投影。上述接口无需改动浪潮脚本，公共协议扩展保留了原调用的默认行为。 |

正式版下一步应先独立复审本地运行组件、版本锁与失败样本，再决定 C3 分发方式。真实渠道工具支持、文学质量、缓存收益及物理手机体验尚待单独授权实测。

### 手动重新生成的候选保护

最初的实验在旧候选上重新生成，使用 UI 的 onFailureSaved 回调时，首次上限失败将草稿的 Story 状态写成 failed。旧正文仍然存在，但无法显式提交。桌面和手机的探针均得到「期望 ready，实际 failed」。C2 在当前已有合法候选时保留原候选及其就绪状态，失败诊断仍进入本次请求记录。无候选时继续沿原流程记录失败和可保留的普通文本断点。相同探针逐次核对 IndexedDB 中的完整草稿、正式档、实际 POST、零中转和旧候选的显式提交。其他模式沿用原规则。

## 初版合成验收记录（24e6134）

环境为 Node 24.19.0、Playwright 1.64.1、Chromium 154.0.8037.57。Desktop Chrome 和 Pixel 7 模拟分别使用独立上下文，5174 端口、单 worker、零重试。以下请求来自同一合成存档、回合、玩家行动与文学配置。浏览器记录序列化后的请求，Mock 端记录实际交付的响应字节；游戏端独立断言临时原文、finish reason、候选和显式结算结果。[脱敏请求、响应 SHA-256 与状态证据](spreset-c2-evidence.json)

| 协议 | 请求字节 JSON / SSE | 响应字节 JSON / SSE | 原始结束原因 | 工具声明估算 Token |
| --- | ---: | ---: | --- | ---: |
| OpenAI 兼容 | 62193 / 62192 | 362 / 461 | tool_calls | 80 |
| DeepSeek | 62193 / 62192 | 362 / 461 | tool_calls | 80 |
| Gemini | 61893 / 61893 | 304 / 312 | STOP | 82 |
| Anthropic | 61749 / 61748 | 304 / 744 | tool_use | 73 |

四协议均保留 `temperature=0.42` 和 4321 的渠道输出预算。每次生成 HTTP POST 一次，候选保存时正式 revision 增量为零，显式提交后回合与 revision 各增加 1。相同输入两端请求的字节数和 SHA 可按协议核对。Token 采用仓库的 unicode-heuristic-v1 估算，完整 HTTP JSON 约 28419–28530 个估算 Token（含序列化开销）。未连接计费服务；DeepSeek 单测使用明确标注的合成 usage（90 输入、8 输出、32 缓存读取）验证字段传递，真实缓存命中率、费用及性能收益未测。

| 测试范围 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| 完整 npm run check（含 TypeScript、ESLint、全量 Vitest 与构建） | 5501 个用例 / 231 文件 | 0 | 0 |
| Prompt 专项（上述 Vitest 子集） | 93 | 0 | 0 |
| C2 单元专项（上述 Vitest 子集） | 20 | 0 | 0 |
| C2 双端 Chromium，含上述 16 个正式工具交付用例 | 22 | 0 | 0 |
| 正式版定向门槛、集成功能及旧模式的续写/归属 | 94 | 0 | 0 |
| 单独复跑的既有 #247 HTTPS 严格诊断 | 14 | 2 | 0 |

既有严格诊断的两项红灯分别出现在 Desktop 和 Mobile 的「直连受理后断开连接」。均为一次应用直连、零中转、零 Worker 上游、模拟服务两次收件，与 #247 的 Chromium 复用连接边界一致。保留严格断言。上述范围有交叠，数量分别报告。实际 C2 正常交付样本一次收件，无法推广成所有浏览器和渠道的端到端幂等保证。[基线传输记录](literary-ownership/continuation-transport.json)

开发中的一次混合回归为 109 通过、5 失败。1 项记录了页面运行环境因刷新销毁，4 项在直接调用酒馆宿主初始化时失败；当时开发服务仍在热更新。固定文件后，4 项酒馆用例及 C2 相应用例均独立通过，正式版门槛另行完整复跑。另一次证据采集在手机 SSE 结束后从 CDP 取响应体，3 项得不到已释放的响应；改为在 Mock 实际交付字节处记录哈希，并继续在游戏端独立核对原文和真实结束状态。未修改请求次数、结算断言、等待时间或重试次数。生产构建已检查资源清单，不包含实验 Worker、GPL 处理器或合成文学条目。
