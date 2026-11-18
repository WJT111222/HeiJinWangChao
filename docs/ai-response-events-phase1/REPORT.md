# AI 响应协议升级第一阶段：统一内部响应事件

日期：2026-11-18。开发基线及最后核实的远端 main：`a820f5eadcd18362aa22a2fc51232a186e2ef8f9`。

本批完成内部事件适配，保留现有请求和消费策略。没有实现 Tool Call 输出载体或工具执行，没有接入参考预设脚本。分支为 `feat/ai-response-events`；最终提交以 PR HEAD 为准，不合并、不手动部署、不发布。

## 1. 实际修改

| 文件 | 原因 |
| --- | --- |
| `src/services/ai/responseEvents.ts` | 新增请求局部、具有判别联合类型的异步事件读取器，复用现有 JSON 提取和 `readSse` |
| `src/services/ai/client.ts` | 改为消费上述事件；保留既有结束策略、思考处理、回调顺序、使用量、超时及错误分类 |
| `src/tests/response-events.test.ts` | 165 项正式 Vitest：旧客户端轨迹等价、来源、任意分块和异常终止 |
| `src/tests/fixtures/responseEvents.ts` | 四协议合成响应和真实客户端调用夹具，不发送网络请求 |
| `src/tests/fixtures/ai-response-events-baseline.json` | 未修改 main 实际运行所得的 108 组静态轨迹，不使用被测新代码动态生成期望 |
| `e2e/candidate-streaming.spec.ts` | 只将结算按钮限定到“三阶段详情”，消除 main 已有的同名按钮冲突，业务断言全部保留 |
| 本目录 `REPORT.md`、`logs/`、`screenshots/` | 中文报告、原始日志、失败对照和真实 React 截图 |

生产代码仅修改 AI 客户端并新增事件模块。没有修改 Runtime、StageResponseStore、UI、SSE 字节解码器、提示词、Manifest、来源锁、业务输出协议、领域 Schema、Repository、CAS、Undo、自动重试或生产配置。

## 2. 新旧处理链路

旧链路：

`wireRequest → 既有 HTTP 请求/兼容错误处理 → AiClient 内联 JSON 或 readSse → 公开内容观察 → checkFinish / LeadingThink / usage → runStageRequest → 阶段严格校验 → 草稿 CAS → 原子 Commit`

新链路：

`wireRequest → 同一个 HTTP 请求/兼容错误处理 → readAiResponseEvents（JSON 或原 readSse）→ AiClient 消费事件并执行原策略 → 原回调与 runStageRequest → 同一严格校验与保存链路`

请求构造、重试决策、付费调用、响应诊断存储和正式保存都没有另建通道。事件读取器是客户端唯一的生成响应读取路径，不是额外日志或第二个消费者。模型列表流程保持原样。

### 类型与来源

`AiResponseEvent` 是 `opened | response | end | aborted | error` 的判别联合。每个事件携带协议、请求是否要求流式、实际传输类型、帧序号、已知 HTTP 状态及 SSE event 名称。一个读取器对应一次现有请求；现有 Runtime 请求版本和存档身份绑定保持不变，不建立跨请求共享事件池。

一个 `response` 保留完整 JSON 或单个 SSE 帧的：

- 原消费策略接受的 `content`、显示观察用的 `rawText`，以及独立公开的 `nativeReasoning`。
- 原有 `RawResponseObservation` 和白名单 `ResponseDiagnostics`，保留字段/同帧顺序语义。
- 本帧合法 usage，不凭空补计数或二次累加缓存 Token。
- 原值 `finishReason: unknown` 与原字段路径，不将未知原因改成 stop，不把未知类型强转字符串。
- 实际 Anthropic `message_stop`、供应商 error 和过滤标记。

同一 JSON/SSE 帧仍是原子载体；reasoning 与 content 字段的读取顺序不冒充模型生成顺序。JSON 的原文顺序仍标为 `unknown`，同帧多字段为 `same-event`。

### 结束与异常

`end` 的 `json-body / eof / done-marker` 只描述实际传输边界，**不是成功判定**：

- 仅收到兼容协议真实 `[DONE]` 才有 `done-marker`；EOF 不补 DONE。
- Anthropic 的 `message_stop` 与传输 EOF 分开保留；前者不虚构 `stop_reason` 或 usage。
- 原客户端继续判断正常结束、缺少结束标记、截断、过滤和拒绝。Story 原有 `validateStoryOutputLimit` 严格校验交接保持不变；其他阶段仍按原规则拒绝输出上限。
- HTTP/JSON/UTF-8/网络错误和取消不生成成功信号。超时与主动取消仍由原 `operation()` 分类；取消后迟到内容不能继续触发回调。
- 复用同一个 Response reader，不重读 HTTP 错误正文，不增加兼容回退请求。现有 400/422 兼容诊断仍位于原 HTTP 层。

### 隐私与容量

事件只在请求局部迭代，没有新增持久化、普通日志、默认 DOM、订阅或公开原文入口。完整文本及未知结束值不可直接当作安全日志。进入 UI 的内容仍经过原 Runtime 脱敏、主动查看、容量淘汰和临时生命周期。没有把签名、隐藏思考、供应商任意错误对象或凭证加入事件元数据。

原 SSE 缓冲上限、8,000,000 字符正文上限及 2,000,000 字符公开思考上限保持原样。读取器逐帧消费，不累计第二份全帧历史。显示文本仍与正式解析输入区分，不使用“最长文本”选稿。

## 3. 行为等价证据

在干净 worktree `ai-response-events-main-control` 的固定 main 上，用真实 Vitest 与旧生产 `AiClient` 运行同一合成夹具，记录完整出站请求体、回调执行轨迹及最终响应/安全错误。临时捕获测试和夹具副本已移除，控制 worktree 保持干净。

静态夹具的 SHA-256：`c672a584a5db248215f1eddc0ecd6fa8fd87e01ac68740e4c014685df1a891ab`。

矩阵是四协议 × 三种响应模式 × 九组策略，共 **108 组**。模式包括普通 JSON、SSE、请求流式但服务返回完整 JSON；策略包括正常、输出上限、过滤、未知结束原因、空响应、供应商错误、非法 JSON、无结束原因，以及 Story 专用输出上限交接。

新客户端的 108 组结果与静态基线逐项深相等：请求地址/完整 body、回调次序与内容、usage、返回值或错误均一致。夹具只使用合成内容和虚构凭证，未记录请求头。捕获脚本保存在 [日志目录](logs/baseline-capture.test.ts.txt)，不作为运行测试生成期望。

| 协议 | 正常 JSON/SSE/JSON 回退 | reasoning / usage | 结束与错误 | 出站请求次数 |
| --- | --- | --- | --- | --- |
| OpenAI 兼容 | 轨迹等价 | 保留原生公开思考和既有 `<think>` 提取 | 保留 finish / DONE 策略 | 每例 1 次 Mock |
| 原生 DeepSeek | 轨迹等价 | 独立 reasoning_content，缓存 usage 不重复计数 | 原输出上限及严格失败语义 | 每例 1 次 Mock |
| 原生 Gemini | 轨迹等价 | thought 与正文分开，usageMetadata 语义不变 | 原 finishReason / blockReason 策略 | 每例 1 次 Mock |
| 原生 Anthropic | 轨迹等价 | thinking/text 及分帧 usage 不丢失 | stop_reason、message_stop、EOF 分开 | 每例 1 次 Mock |

另外覆盖 1/2/5/7/13/97/65536 字节分块、中文及 emoji 跨 UTF-8、多行 data、CRLF、末尾未补空行、同帧增量和结束原因、非法 UTF-8、真实 DONE 后停止、HTTP 503、取消、超时、reader 释放，以及尚不支持的工具返回仍按原规则拒绝。

## 4. 正式工程检查

环境：Node **24.19.0**、npm **11.9.0**、Vitest **5.0.5**、Playwright **1.64.1**、系统 Chromium **154.0.8037.57**。依赖使用仓库锁文件正式 `npm ci`。

| 批次 / 命令 | 通过 | 失败 | 跳过 | 退出码 |
| --- | ---: | ---: | ---: | ---: |
| `npm ci` | 安装成功 | 0 | — | 0 |
| 固定 main 捕获脚本 | 1 个捕获测试（内含 108 组） | 0 | 0 | 0 |
| 初始 AI / DeepSeek / 思考 / 观察定向 Vitest | 154 | 0 | 0 | 0 |
| 新增事件测试首轮 | 164 | 1 | 0 | 1 |
| 新增事件测试修正后 | 165 | 0 | 0 | 0 |
| 首次 `npm run check` | 文件检查通过，Lint 阻断 | 1 条 Lint | — | 1 |
| 最终 `npm run check` | **4574 项 / 186 文件**；Lint、TS、Build、文件名与目录检查通过 | **0** | **0** | **0** |
| `npm run prompts:check` | **93** | 0 | 0 | 0 |
| `git diff --check` | 通过 | 0 | — | 0 |

最初事件测试错误地假设最后一帧必有 usage；Anthropic 实际 `message_stop` 不一定有 usage，已改为断言实际携带 usage 的帧，保留结束帧本身。首次 Lint 指出重构后的 `delta` 空字符串初始赋值永远未使用，改成明确 `string` 类型声明。两次初始失败和修正日志全部保留，没有删除或降低业务断言。

`check` 包含完整 Vitest、ESLint、生产 Build；Build 包含 TypeScript、`catalog:check` 和文件名检查。93 项 Prompt 同时属于完整 Vitest 的重叠子集，不能再加到 4574 上。构建只有原工程的大 chunk 提示，不是失败；没有为消除此提示修改打包架构。

完整 Vitest 包含既有 Story、断点续写、Variables/World、Memory、Commit、CAS、Undo、存档和请求并发用例；没有修改这些生产模块或安全断言。

## 5. 双端 Chromium 与干净 main 对照

只运行 5 个相关文件的定向场景，不运行全量浏览器套件。复用原桌面 1440×1000 与 Pixel 7 手机项目，workers=1、retries=0，真实 React/Vite 和正式 Repository，全部生成请求为本地 Mock。

首轮：**18 个场景，16 通过、2 失败、0 跳过，退出码 1**。

| 每端各一项，共 18 项 | 首轮结果 |
| --- | --- |
| 开局及下一行动各自动结算一次、刷新不请求 | PC/手机通过 |
| Variables 实时原文、独立思考、复制/滚动、候选校验及 Commit | PC/手机通过 |
| World 实时原文、独立思考、复制/滚动、候选校验及 Commit | PC/手机在结算按钮定位失败，详见下文 |
| Variables 取消、显式重试、迟到隔离及中断保留 | PC/手机通过 |
| World 取消、显式重试、迟到隔离及中断保留 | PC/手机通过 |
| Variables reasoning-only，默认隐私、主动查看/复制、刷新生命周期 | PC/手机通过 |
| World reasoning-only，默认隐私、主动查看/复制、刷新生命周期 | PC/手机通过 |
| 截断保留、刷新、手动续写、去重、结算 | PC/手机通过 |
| Story 两种公开思考实时阅读、正文清空切换、连续完整原文与脱敏 | PC/手机通过 |

失败位于原 `e2e/candidate-streaming.spec.ts:139`。全局 `getByRole('button', {name:'完成本回合结算', exact:true})` 同时命中工作流和行动台按钮，报 strict mode violation；失败前实际已生成合法 World ready 候选，未执行提交点击。

在干净最新 main、相同 Node/依赖/浏览器配置/两个项目及同一具体用例上，**2 项同样失败，退出码 1**，断言位置与两个同名按钮完全一致。第一次控制环境端口冲突未启动任何测试，日志另外保留；换空闲端口后才取得有效 main 对照。

最小测试兼容修复：把这一个定位限定到现有 `role=region`“三阶段详情”，不使用 first/nth，不修改请求次数、存档相等、最终 turnNumber 等业务断言。

修复后针对两阶段 × 两端复测：**4 通过、0 失败/跳过，退出码 0**，均真正到达候选验证与 Commit。该 4 项与首轮有重叠；不能声称执行了一次 20 项全绿。最终 18 个独立场景均有通过证据，无可归因于事件层的新增浏览器阻断。

复测长响应样本：

| 项目 | 正文字符 | 分片 | Store 发布 | 输入填入耗时 |
| --- | ---: | ---: | ---: | ---: |
| PC Variables | 19600 | 98 | 3 | 108ms |
| PC World | 21000 | 105 | 3 | 137ms |
| 手机 Variables | 19600 | 98 | 3 | 95ms |
| 手机 World | 21000 | 105 | 3 | 162ms |

这些是受控环境单次样本，不代表真机性能基准或内存上限证明。没有新增存储，原节流和容量设置保持不变。

### 关键真实截图

- [PC Story 连续完整原文](screenshots/desktop-unified-raw.png)
- [手机 Story 连续完整原文](screenshots/mobile-unified-raw.png)
- [PC World 接收中](screenshots/desktop-world-live.png)
- [手机 World 接收中](screenshots/mobile-world-live.png)
- [PC World 已提交](screenshots/desktop-world-committed.png)
- [手机 World 已提交](screenshots/mobile-world-committed.png)

截图使用合成存档和 Mock 文本。实际检查了 PC 连续原文及手机长文本原文：原文可读、在原区域滚动，行动输入仍可操作；测试同时检查无横向溢出和查看前后 Repository 不变。

## 6. 原始证据与复核

[logs/](logs/) 保留正式命令日志、退出码、main 对照、失败定位、复测性能样本与配置文本。核心入口：

- [完整工程检查](logs/check-final.log) / [退出码](logs/check-final.exit)
- [Prompt](logs/prompts.log) / [事件专项](logs/events-corrected.log)
- [浏览器首轮](logs/chromium.log) / [干净 main](logs/main-chromium.log) / [定位修正后](logs/chromium-repeat.log)
- [旧 main 静态轨迹捕获](logs/baseline-capture.log)

完整 JSON 浏览器报告、全部附件和失败 trace 仍在隔离证据目录 `/workspace/ai-response-events-evidence/`，包括 `browser-results/`、`main-browser-results/`、`browser-repeat-results/`。未把大型 trace 存入 Git，也未上传私人玩家数据。报告与复测是同一代码基线；后续仅增加文档和证据，不修改受验收代码。

复核命令：

```bash
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/response-events.test.ts
git diff --check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/story-stream-reading.spec.ts e2e/candidate-streaming.spec.ts \
  e2e/stage-response-observation.spec.ts e2e/automatic-settlement.spec.ts \
  e2e/story-continuation.spec.ts \
  --grep '流式阅读 both：|实时只读、主动公开思考|取消后显式重试不串台|reasoning-only failure|完整原文可读，开局|正文被截断后保留已写部分'
```

受测期间仅使用外置配置更换独立端口、输出目录和单 worker；项目的视口、测试实现及断言未被替代。外置配置原文见 logs 中 `.mjs.txt`。

## 7. 已知限制与回归风险

1. 这是内部适配层，不是供应商完整原始 JSON 日志。保留现有受支持的第一 choice/candidate、公开文本/思考和结束字段；不新增多候选择稿、隐藏推理、签名或未知内容提取。
2. 读取到完整 JSON 或 EOF 不表示协议/业务成功；原客户端与阶段校验继续决定结果。没有借本批改变未知结束原因、过滤或截断的现有政策。
3. HTTP 错误的安全白名单与兼容检测仍在原 HTTP 方法，不为“统一”额外读取或发送。异步取消/超时仍依赖原请求锁、身份与原子保存保护。
4. Mock 等价证据覆盖当前支持形态，不能保证所有中转的非标准返回，不能证明真实供应商的缓存费用或隐藏推理行为。没有付费调用。
5. Chromium PC/手机通过不等同于 Safari/iPhone 真机验收；没有运行 WebKit、真实设备或与本批无关的全部浏览器场景。
6. 主要风险在回调顺序和结束处理。固定旧客户端 108 组轨迹、原阶段/存档全量测试及双端实际工作流用于约束该风险；未发现剩余新增阻断。

## 8. 第二阶段建议接口（未实施）

在现有判别联合上单独评审 `tool-call-start / tool-arguments-delta / tool-call-end` 一类载体事件，携带原生协议、choice/block 索引、真实 call ID、名称、参数增量及原始结束信息。必须明确增量与快照，不能按最长字符串选取结果或猜工具身份。

输出载体解码器应与工具执行分离，只允许经过独立授权的精确名称及严格参数 Schema；解码所得文本仍交给现有阶段协议和领域校验。混合文本、多个调用、缺失 ID、参数未闭合、工具结束及传输 EOF 的处理需先定规则。未支持形态保持明确失败，不默认执行、不自动发起后续请求，也不将工具结束改写为 stop。

第一阶段没有添加这些事件、工具声明、Prompt、执行器或自动重试。下一阶段需另行批准。
