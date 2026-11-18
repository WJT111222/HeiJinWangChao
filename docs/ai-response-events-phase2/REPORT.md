# AI 协议升级第二阶段：Story 单一结构化输出载体

日期：2026-11-18。沿用 Draft PR #191、`feat/ai-response-events` 分支。开工及交付前核实的 main 均为 `a820f5eadcd18362aa22a2fc51232a186e2ef8f9`，第一阶段已审查 HEAD 为 `686bedc939badc4d24f64c3d9dafca1400ffbfbb`。最终 HEAD 见本 PR 描述与验收评论。

本批已实现默认关闭的 Story 工具输出载体。它只传递完整 Story 协议文本，不执行工具。四协议普通文本模式保留；参数 Schema 通过后，仍必须通过现有 Story 解析、字数、时间、事件、凭证及保存校验。

## 1. 产品与接口

设置 → 运行新增「正文生成 · 结构化输出（实验）」，对应本地 `runtime.storyToolOutput`，默认 `false`。旧设置缺少字段时补默认值，不重置其他偏好、不改设置版本。开关不进入 Prompt、GameState、TurnDraft 或备份 Schema。StoryStage/Runtime 沿用现有设置快照，中途更改只影响后续请求。

唯一允许的工具名：`heijin_story_output`。它与第三方预设无关，参数只允许：

```json
{"content":"原有 Story 协议的完整回复文本，包含原有必需标签"}
```

`content` 包含完整回复，而不是只取 `<正文>` 段。工具不会生成 DomainCommand，也不会获得 Variables/World 权限。没有外部函数注册、工具执行、工具递归或额外请求。

本地使用严格对象 Schema：`content` 必须是非空字符串；额外字段、错误类型、无效 JSON 和重复键拒绝。参数字符串上限 8,000,000 字符，最多 131,072 个非空增量片段；忽略空增量的存储开销，不通过截短参数来获得成功。解码后继续使用现有正文容量、最低字数和业务规则。

## 2. 处理链路与真实事件边界

第一阶段：`wireRequest → JSON/readSse → 统一 response 事件 → 原客户端消费策略 → 原阶段校验/保存`。

第二阶段启用时：`同一请求 + 原生工具声明 → 同一 JSON/readSse → response / tool-start / tool-identity-delta / tool-arguments / tool-end → 单调用组装及参数 Schema → 原 Story 文本解析 → StoryStage → 原草稿 CAS → 原 Variables/World → 原子 Commit`。

关闭时不会构造工具声明，不启用工具投影器或组装器，沿用原文本分支。与第一阶段前 main 捕获的 108 组完整出站请求、回调顺序、结果及错误轨迹仍逐项相等。

新增事件保留原 `ResponseSource`：协议、传输、帧序号、HTTP 状态和 SSE event 名称。参数事件明确区分 `delta` 与完整 `snapshot`；不把一个完整快照再次当作增量拼接。ID 和名称只按真实字段累积，不猜测调用身份、不模糊匹配工具名。

传输 EOF、JSON body 结束、真实 `[DONE]` 继续保持独立边界，均不能替代供应商工具结束。结束原因保持原值，不改写成 stop。`length/max_tokens`、过滤、未知结束、网络错误、取消或超时不作为工具成功；不自动改用普通文本重新发送。

### 四协议适配

| 协议 | 出站声明 | 响应载体与关联 | 必需完成条件 |
| --- | --- | --- | --- |
| OpenAI 兼容 | `tools[].function`、指定 `tool_choice`、`parallel_tool_calls:false` | `message/delta.tool_calls`；真实 ID，流式 index=0；name/ID/arguments 分片 | 实际 `finish_reason:tool_calls`、参数结束及真实传输边界 |
| 原生 DeepSeek | `tools[].function`、指定 `tool_choice`；不添加未经确认的 parallel 参数 | 原生 Chat Completions 的 `tool_calls`，同样严格关联 | 实际 `tool_calls`，不套用普通文本 stop 或自动回退 |
| 原生 Gemini | `functionDeclarations[].parametersJsonSchema`、`toolConfig.functionCallingConfig` | 标准完整 `functionCall{name,args,id?}`；候选/part 位置关联，ID 可选但不伪造 | 完整 functionCall 值与实际 `finishReason:STOP`；不根据 EOF 补完 |
| 原生 Anthropic | `tools[].input_schema`、指定工具；原生 Thinking 开启时使用兼容的 `auto` | `tool_use` / `input_json_delta`；真实 block index、ID、名称、JSON 参数 | JSON 的真实 `stop_reason:tool_use`；SSE 还要求 block stop、tool_use 原因、最后真实 message_stop |

Anthropic Thinking 不支持强制工具选择时，不静默关闭玩家的 Thinking 参数。保留原参数，使用 `auto + disable_parallel_tool_use`；模型如未返回单一工具载体，明确失败，不把普通文本偷偷当作替代输出。

Gemini 不强制提供 call ID，不能为了统一接口虚构 ID。本批处理其标准完整 `functionCall.args`，网络字节可任意分块；不猜测 `partialArgs/willContinue` 等不同 API 版本的增量结构，也不把多次完整快照按最长或覆盖规则合并。这些形态明确拒绝。

## 3. 严格失败与保存边界

以下情况拒绝整份 Story 候选：有普通正文混入工具输出、多调用、未知工具、缺失必需 ID/名称/index、调用顺序损坏、参数不完整/超限/非法、结束原因异常。错误仅携带程序内固定的 `storyTool.*` 字段路径，不回显外部工具名称、ID、原始参数或供应商错误消息。

公开原生思考可继续观察，但不是工具参数或 Story 正文。合法工具参数只在全部完成并通过载体校验后解码；本批不增量解码未闭合的 JSON 字符串到小说区。普通文本模式的实时小说/思考切换不变。设置内已说明“参数完整校验后展示正文”。

原工具参数与公开思考沿用 StageResponseStore、脱敏、容量、请求版本、主动查看和刷新清理。Story「模型原文」仍为一个连续只读文本区，可复制；没有增加单独工具弹窗或默认私密日志。OpenAI/DeepSeek/Anthropic SSE 的原始参数字符串按实际片段保留；Gemini/Anthropic JSON 原生对象显示其 JSON 序列化，**不是原始 HTTP 字节**，也不冒充字段生成时序。

Runtime 明确区分工具原文与正式解析文本：原始 JSON 参数不能成为 storyPartial。参数没有完整时不保存伪正文；完整载体中的 Story 如确实缺尾标签，现有严格解析仍会拒绝，并仅将已经合法解码的 Story 文本交给原手动续写机制。续写响应仍需载体校验、原合并和全部 Story 规则，未改 #177 的规则。

正式保存使用原 StoryStage、StageGuard、Repository 和 CAS；不写新数据库字段。Vars/World/Memory 无工具载体声明或协议变化。合法完整流程仍是 Story、Variables、World 各一次和一次 Commit；Story-only 设置仍由原工作流处理。

## 4. 修改文件

相对第一阶段 HEAD 的实际文件：

| 文件 | 必要原因 |
| --- | --- |
| `src/services/ai/toolResponseEvents.ts` | 原生工具字段投影、真实开始/身份增量/参数/结束，安全原文观察 |
| `src/services/ai/storyToolContract.ts` | 项目自有单一工具名、JSON 参数 Schema、容量与重复键校验 |
| `src/services/ai/storyToolAssembler.ts` | 请求局部单载体组装、身份、顺序、完成状态、参数验证 |
| `src/services/ai/responseEvents.ts` | 可选工具事件投影，关闭时沿用第一阶段行为 |
| `src/services/ai/client.ts` | 同一次请求内消费载体事件，完整后交回原文本接口；无回退重发 |
| `src/services/ai/protocols.ts` | 仅 opt-in Story 添加四协议工具声明，原消息/采样/Token 参数不变 |
| `src/services/ai/errors.ts` | 固定、安全的工具响应错误，不复制供应商内容 |
| `src/services/ai/runtime.ts` | 读取已快照的 Story 开关，分离原文与解析/续写输入 |
| `src/ui/settings/model.ts` | 可选读取默认 false 的本地运行偏好，版本不变 |
| `src/ui/settings/SettingsPanel.tsx` | 双端复用同一开关和简短行为说明 |
| `src/tests/fixtures/storyTools.ts` | 四协议真实 Response/ReadableStream 的合成夹具 |
| `src/tests/story-tool-events.test.ts` | 37 项事件、严格组装、大文本和顺序负例 |
| `src/tests/story-tool-runtime.test.ts` | 41 项真实客户端/Runtime/StoryStage/Repository/协调器回归 |
| `e2e/story-tool-output.spec.ts` | 双端真实 React、设置、SSE、隐私、结算与取消回归 |
| 本目录报告、logs、screenshots | 技术说明及原始执行证据 |

没有修改四阶段正式 Prompt、Manifest、来源锁、Story 解析器、Variables/World/Memory 协议、领域规则、GameState、IndexedDB、Commit、Undo、模型选择、输出 Token 预算或生产配置。未执行或接入上传的第三方脚本。

## 5. 里程碑与失败修正记录

- `88fa81b`：事件与组装。198 项定向测试通过；当时的 TypeScript、Lint 通过。已推回原分支并在 PR 留言。
- `d376805`：默认关闭的运行设置、请求与 Runtime 接入。302 项相关测试通过，已推回原分支并在 PR 记录进度；后续类型检查发现新测试中可选原文字段需要显式确认，收尾时修正。
- 本次交付提交：双端 E2E、补强结束顺序和长参数校验、完整验收与报告。

初始 Runtime 测试的 14 项失败来自新夹具缺少明确 `userInput:''` 和故障注入误写为 `turnDrafts`（真实存储名为 `drafts`）；修正夹具后真正执行到原协议、权限和存储断言。没有为此修改业务代码。之后修正一个新增测试的可选值类型及三处多余转义；原始失败日志保留。

结束顺序审查发现：Anthropic 若先给 message_stop 或 tool_use 原因、之后才给合法参数，初版组装器可能接受。先加两个负例，正式 Vitest **2 失败**；补上实际帧序号、消息结束先后约束后，**243 项定向测试全部通过**。同一帧“最后参数 + finish_reason”的合法情况继续通过。红色批次使用明确名称过滤，35 项未选中并非添加 skip；完整绿色批次没有跳过。

续写原文复核另发现，普通文本路径的“合并旧前缀”不能直接用于工具参数原文。先加精确原文断言，1 项失败；仅在工具模式下保留本次真实参数，正式解析仍合并已解码正文。修正后三文件 243 项通过，并补充 PC/手机刷新后主动续写、Story-only 原子结算与新原文定位，均通过。

另将重复键检查改为 JSON/Schema 验证后的线性字符串扫描，避免大段文字和转义造成正则回溯。包含 20,000 次重复长文本及超容量的测试，未通过修复参数、截短正文或放宽业务规则取得通过。

## 6. Node 24 正式成绩

Node **24.19.0**，npm **11.9.0**，Vitest **5.0.5**，Playwright **1.64.1**，Chromium **154.0.8037.57**。

| 批次 / 命令 | 通过 | 失败 | 跳过 | 退出码 |
| --- | ---: | ---: | ---: | ---: |
| 默认缓存 `npm ci` | — | 环境缓存不可写 | — | 254 |
| 依赖缺失时的 `check` | 文件检查通过 | 找不到 eslint，未进行单测 | — | 127 |
| `npm_config_cache=/workspace/.npm npm ci` | 锁文件正式安装成功 | 0 | — | 0 |
| 里程碑 1 定向 Vitest | 198 | 0 | 0 | 0 |
| Runtime 夹具首轮 | 213 | 14 | 0 | 1 |
| 修正夹具及补充测试后相关五文件 | 302 | 0 | 0 | 0 |
| 中间完整 `check` | 4641，Lint/TS/Build/目录均通过 | 0 | 0 | 0 |
| 新增测试后的 `check-final` | — | 三条多余转义 Lint，未进行单测 | — | 1 |
| Anthropic 顺序负例：红 | 0 | 2 | 35 名称过滤未选中 | 1 |
| 结束顺序修正后定向三文件 | **243** | **0** | **0** | **0** |
| 续写工具原文负例：红 | 0 | 1 | 40 名称过滤未选中 | 1 |
| 最终代码定向三文件 | **243** | **0** | **0** | **0** |
| 最终 `npm run check` | **4652 / 188 文件**，Lint/TS/Build/目录均通过 | **0** | **0** | **0** |
| `npm run prompts:check` | **93** | **0** | **0** | **0** |
| `git diff --check` | 通过 | 0 | — | 0 |

npm 默认缓存路径 `/home/agent/.npm` 在本环境不可写，首次失败不属于依赖内容或应用问题。使用工作区可写缓存完成正式安装，没有改锁文件或使用垫片。`check` 包含全量 Vitest、Lint 和 Build；Build 包含 TypeScript、文件名和 `catalog:check`。Prompt 的 93 项与全量单测重叠，不再累加；243 项也属于同一全量集合。构建只有既有的大 chunk 提示。

### 核心覆盖

- 四协议正常 JSON/SSE，UTF-8 单字节分块，名称/ID/转义 Unicode 分片；四协议 stream 请求返回完整 JSON。
- 重复键、额外字段、错误类型、缺 ID/名称、多个调用、混合文本、缺 finish、未知 finish、长度上限、过滤、未完整参数、非标准 Gemini 增量形态。
- 真实部分 SSE 后网络错误、超时、取消及迟到响应；拒绝工具时只消费一次 HTTP 错误体，不回退重发。
- 开关默认关闭、旧设置其他字段不变、同一 Prompt 开关前后完全一致、发出请求后更改设置不改变模式。
- 工具载体合法但 Story 字数、变量规划 JSON、行动选项、时间非法时仍拒绝；凭证输出仍拒绝并脱敏。
- 合法 Story 只保存一次草稿；原文/复制只读；CAS 冲突和 IDB 故障无部分保存；工具中完整解码后的 Story 缺尾可沿原流程主动续写。
- 完整 Story → Variables → World 各一次及 Commit 一次；下游没有工具声明。Memory 路径和独立维护代码未修改，完整既有记忆、并发、原子结算与撤回测试通过。
- 第一阶段 165 项事件测试继续通过，含 108 组旧客户端行为轨迹；未刷新旧基线或削弱断言。

## 7. Chromium 双端与截图

复用原 Playwright desktop（1440×1000）与 Pixel 7 项目、workers=1、retries=0。使用真实 Vite/React、Repository 和本地 HTTP SSE Mock，https 外部请求在新 E2E 中被阻断。

| 批次 | 结果 | 退出码 |
| --- | --- | ---: |
| 新增六种场景 × PC/手机 | **12 通过、0 失败/跳过** | 0 |
| 既有普通文本自动结算、断点续写、两种思考实时阅读 × 双端 | **6 通过、0 失败/跳过** | 0 |
| 结束顺序补强后工具 SSE/三阶段结算 × 双端 | **2 通过、0 失败/跳过** | 0 |
| 最终原文修正后工具 SSE/三阶段结算及刷新续写 × 双端 | **4 通过、0 失败/跳过** | 0 |

前两批是 18 个独立场景；最后 4 项中有 2 项新增的工具模式续写场景，另 2 项及中间补测均有重叠。因此合计 20 个独立场景有通过证据，不能把各批通过次数简单相加，也不宣称一次浏览器全量通过。本轮没有浏览器失败，无需对无关旧问题扩大 main 对照；没有运行数百项完整 Chromium 套件。

新增场景实际断言：旧设置开关默认关闭、打开设置不写入/不请求、保存刷新恢复；SSE 参数接收中不提前建立 Story；默认 DOM/运行日志不暴露私密参数，凭证脱敏；原文单一 readonly textarea，可复制、无横向溢出；查看前后 Repository 不变；三个模型阶段各一次、Journal/短期记忆/revision 正确且 Commit 一次；mixed/multiple/incomplete 整批拒绝；取消后迟到片段不复活候选或触发下游；刷新不自动收费。

已实际查看截图，设置开关和说明沿用原纸页表单，手机原文仍在原工作流抽屉内、一个连续文本区，凭证显示为隐藏占位。没有重做游戏布局。

| 界面 | PC | 手机 |
| --- | --- | --- |
| 设置开关保存后 | [截图](screenshots/desktop-tool-settings.png) | [截图](screenshots/mobile-tool-settings.png) |
| 最终版本接收中原文与脱敏 | [截图](screenshots/desktop-tool-live-raw.png) | [截图](screenshots/mobile-tool-live-raw.png) |
| 最终版本正式结算 | [截图](screenshots/desktop-tool-committed.png) | [截图](screenshots/mobile-tool-committed.png) |
| 非法多调用被拒绝 | [截图](screenshots/desktop-tool-multiple.png) | [截图](screenshots/mobile-tool-multiple.png) |
| 取消后片段 | [截图](screenshots/desktop-tool-cancelled.png) | [截图](screenshots/mobile-tool-cancelled.png) |
| 刷新后续写及本次参数原文 | [截图](screenshots/desktop-tool-continuation.png) | [截图](screenshots/mobile-tool-continuation.png) |

没有 iPhone/Safari 或 WebKit 真机验证。截图与存档均为合成测试资料，无真实玩家数据或真实密钥。

## 8. 已知限制与后续审查重点

1. 默认关闭，只有玩家主动开启后才改变 Story 请求载体。不能保证所有模型或中转支持原生工具字段；服务器拒绝时明确报错，不自动回退或重发。
2. 工具模式等待完整参数和真实完成状态后才把文本交给小说阅读；公开原生思考和主动打开的参数原文可实时查看。没有承诺尚未合法闭合的工具 JSON 能逐字显示为小说。
3. Gemini 本批只支持标准完整 functionCall，不能声称支持所有 API 版本的原生函数参数增量。它的 ID 可选语义与其他协议不同，使用真实位置关联。
4. Anthropic Thinking 使用 auto，模型可能选择普通文本；本批按单载体契约拒绝，不关闭 Thinking 或隐式降级。
5. 工具参数本身真正截断时，不从半段 JSON 猜出正文，也不把它写成 storyPartial。原普通文本续写不变；已完整解码但 Story 缺尾时才沿原续写路径。恢复不完整工具 JSON 不是本批功能。
6. 原文视图保存的是支持字段的公开参数/思考观察，并非整个 HTTP 响应抓包。原生对象的 JSON 序列化和同帧字段不代表精确生成顺序；未知字段、签名和隐藏推理不额外收集。
7. 请求检查器保留工具声明，供应商实际 usage 仍按原逻辑统计且缓存输入不重复计算。原 Prompt 字符估算不包含新增工具声明，不能当作实付 Token 或节省费用证明。
8. Mock 验证协议结构、错误边界和实际调用次数；没有向真实供应商收费请求，不能保证模型实际遵循工具选择或文学质量。没有修改正式服设置。

未发现剩余可归因于本批的 P0/P1/P2 阻断，仍须独立代码审查。保持原 PR Draft、未合并，不部署、不发布，不开展工具执行或第三阶段。

## 9. 原始证据与复核

日志、退出码与外置浏览器配置在 [logs/](logs/)，`.log.gz` 为原始字节无损压缩，可用 `gzip -dc` 查看。完整浏览器 JSON 报告和所有附件保留在 `/workspace/ai-response-events-phase2-evidence/`。本轮无失败浏览器 trace；没有伪造 trace 文件。

- [最终完整 check](logs/check-final-code.log.gz) / [退出码](logs/check-final-code.exit)
- [Prompt](logs/prompts.log.gz) / [正式 npm ci](logs/npm-ci.log.gz)
- [结束顺序先红](logs/terminal-order-red.log.gz) / [定向全部转绿](logs/terminal-order-green.log.gz) / [最终代码定向](logs/final-code-targeted.log.gz)
- [新增双端 E2E](logs/chromium.log.gz) / [旧模式双端](logs/chromium-legacy.log.gz) / [最终双端重验](logs/chromium-final-code.log.gz)

复核命令：

```bash
npm_config_cache=/workspace/.npm npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/story-tool-events.test.ts src/tests/story-tool-runtime.test.ts src/tests/response-events.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-tool-output.spec.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/story-stream-reading.spec.ts e2e/story-continuation.spec.ts e2e/automatic-settlement.spec.ts \
  --grep '流式阅读 both：|完整原文可读，开局|正文被截断后保留已写部分'
git diff --check
```

测试使用外置配置仅为隔离端口、输出目录及单 worker，正式组件、工作流、Repository 和原业务断言没有被替代。正式源码验收后仅增加报告、压缩日志和截图；测试数量不跨不同阶段累加。
