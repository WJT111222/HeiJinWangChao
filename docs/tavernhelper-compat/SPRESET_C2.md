# SPreset 核心运行时原型（C2）

## 联合复审整改

**存储隔离已通过双端 Chromium 实测。工具终端完整性仍阻断合流。** 在发布基线 `607ebdb` 上，#252 当前提交 `0c6e1e0` 尚未包含公共解析器修复。下文的首次验收统计来自原型初版。复审另测了同包重复调用及借用其他协议结束原因两类反例。[本轮隔离与真实收据、IndexedDB 证据](spreset-c2-review-evidence.json)

旧版 Worker 能枚举同源的合成游戏库。新版为每次 Story 建立仅允许脚本的不透明来源 iframe，内部从审核过的本地源码启动独立经典 Worker。处理器的 `self.origin` 为 `null`。桌面与手机上，`indexedDB.open('heijinwangchao')` 和 `indexedDB.databases()` 都抛出 `SecurityError`。Worker 没有 DOM、父窗口、Web Storage、Cache Storage 或 OPFS 入口。iframe 访问游戏 DOM、Cookie 和 Web Storage 被浏览器拒绝。实际 Worker 发起的网络探针在交付前失败，测试端收件为零，合成正式档与草稿逐项相同。

父页面只向自己创建的窗口移交一次私有 MessagePort。iframe 检查窗口、父来源和本次会话标识，端口按顺序只接受一次 prepare、一次 finish。响应必须匹配会话和序号；桥接层仅返回处理结果或错误。实际请求超时、取消、切档、刷新和卸载均有生命周期探针。C2 版本随审核核心、Worker 与桥接脚本共同变化。生产资源检查覆盖实验标识、入口、工具名称及处理器文件。

SPreset 专属入口先完成公共帧校验，再检查本地唯一允许的工具名称、调用 ID 和严格的单字段参数。无工具的完整文本有独立交付路径，收据为空。目前公共帧解析会合并同一 Gemini 响应中的重复同 ID 调用，也会接受跨协议的工具结束原因。双端按四协议和 JSON/SSE 运行 16 个浏览器用例，每个用例都分别测试两个输入。32 个畸形响应中，12 个在进入处理器前被拒绝；其余 20 个实际取得了本地收据、保存了候选，显式提交后回合和 revision 各增加 1。对应单元 16 项中 6 通过、10 失败。上述探针保留严格失败断言。

#252 合入后须继承公共工具完整性实现，保留两个浪潮注册与独立防截断，并将仅限开发环境的 C2 注册放在公共注册查询入口。复跑全部异常用例，逐项核对零 finish、零收据、零候选及零正式状态增量，同时复跑正常工具交付与纯文本。#252 合入前保持 Draft。

本轮 Node 24 锁定依赖安装成功。全量 Vitest 为 5507 通过、10 失败，全部失败均是上述公共解析反例；因此 `npm run check` 当前返回失败。单独执行的 ESLint、生产构建（含 TypeScript、命令目录检查）与 Prompt 专项 93 项通过。原有 22 项双端 Story 用例和 6 项隔离操作通过。16 个严格浏览器反例用例均保留红灯。统计按范围列出，不能相加。

C3 的分发前置条件分别是：开发者在本机运行已审核组件；仓库对修改后的 GPL 组件随源码提供许可、署名、版本和构建方式；若将组合产物分发给玩家，负责人须确认其他组件的授权与整体 GPL 义务相容并确定对应源码交付方式。浏览器隔离只解决执行权限。C3 的工具历史、正则、消息配置及神域控制台仍须逐项完成权限与许可审核。原生、独立防截断、1118 及 1124 的手动重新生成后 TURN_INCOMPLETE 继续独立跟踪，本轮验证限定于 C2。

## 复跑入口

基线为 `release/1.0@607ebdbfc986115ebea5f22fb5759d2b8a2bb1d2`。使用 Node 24、锁定依赖、合成存档和拦截在 HTTP 边界的 Mock 模型。Playwright 会启动端口 5174 的本地开发服务。

```sh
npm ci
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/spreset-prototype.spec.ts e2e/spreset-isolation.spec.ts e2e/spreset-terminal.spec.ts --workers=1 --retries=0
git diff --check
```

开发入口为本机 Vite 上的 `/?spreset=prototype`。它只在未启用其他模式时生效，安全模式始终优先。普通设置不展示此入口。刷新后由页面地址与当前选择重新判定。请求执行的是现有 StoryStage、IndexedDB 候选与 commitTurn。只在测试中注入模型响应。截断、权限、时钟与结算的决定权都在游戏侧。

## 原包及许可

- Meowssiah-2.1.7 原包有 56 条提示词、8 条主正则、SPreset 内 8 条绑定正则，以及 SPreset 加载器、菜单两份 TavernHelper 脚本。菜单版本为 3.0-Preview-01，ID 301。适配许可由项目负责人确认，保留小猫之神署名。
- 固定网页源码提交 `53bd585da14248ba10baaede7fc7ed0cebe1eeeb`。逐字节比较，附件加载器与该提交的 `regex_bind/index.js` 只差末尾 LF。加载器指向可变地址，原作者当时线上部署过的 inject.js 字节仍无法从附件证明。
- SPreset 的 `regex_bind/LICENSE` 为 GNU GPL 第三版。实验按 GPL-3.0-only 保留作者署名、修改说明、完整许可、可编辑源码和固定来源。许可证不授予更改其他作品许可的权利。王朝仓库没有整体再许可声明。分支仅以源码提供独立消息式组件，常规生产构建不交付该 Worker。若 C3 计划一起向玩家分发，须核实整套组合作品的权利及对应源码交付方式；独立进程或消息接口本身不能证明许可兼容。 [固定源码树](https://github.com/starowo/starowo.github.io/tree/53bd585da14248ba10baaede7fc7ed0cebe1eeeb/regex_bind) · [上游与本地文件 SHA-256](../../experiments/spreset/SOURCES.json) · [完整许可](../../experiments/spreset/COPYING)
- 本地 `core.mjs` 保留了 `normalizeSPresetOutputProcessorResult`（916–943 行），适配了 `processSPresetFinalRequest`（1695–1720 行）的请求复制、静态处理、序列化及传输字段保护。`worker.mjs` 是新增的请求级宿主。两者独立于 React、ST、TavernHelper 及第三方包。配置版本中包含核心、Worker 和 frame.mjs 三个文件的组合 SHA-256。提示词与条目顺序继续参与 #247 v3 指纹。
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
| 结算 | 现有解析器校验正文、来源及候选。生成成功只写草稿。显式 commit 后正式档版本和回合各前进一步。Variables、World、Memory、小剧场均继续经过既有路径。 |

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
