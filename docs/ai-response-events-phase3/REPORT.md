# 第三阶段：四协议 Story 兼容性矩阵与隔离验收

日期：2026-11-18。原 Draft PR #191，分支 `feat/ai-response-events`。

审查起点为第二阶段 HEAD `5efb8c65f8cf14a7e2fa90173cf2b1e3304377a4`。开工及交付前远端 main 均为 `a820f5eadcd18362aa22a2fc51232a186e2ef8f9`，没有默默更换或合并基线。矩阵首个提交为 `0318795c19f652b6cbd14f05627b062e72940149`，最终 HEAD 见 PR 描述与验收评论。

**结论：本轮 Mock 工程兼容与联合流程通过。真实模型遵循率、生成稳定性、文学质量和实付 Token/费用仍是证据缺口，未获预算批准，因此未执行。** 不能据本报告声称具体供应商、型号或中转已实测通过。继续保持实验功能默认关闭、Draft、未合并。

## 1. 本轮实际修改与隔离

只新增四类材料，没有修改生产代码：

| 文件 | 用途 |
| --- | --- |
| `src/tests/fixtures/storyCompatibility.ts` | 四协议独立、标准形状的 JSON/SSE 合成响应，短文、18442 字符长篇、公开思考和安全异常 |
| `src/tests/story-compatibility-matrix.test.ts` | 76 项矩阵测试，经真实客户端、Runtime、StoryStage、Repository、协调器执行 |
| `e2e/story-compatibility-matrix.spec.ts` | 四协议 × PC/手机共 8 项真实 React、原生 HTTP SSE 与正式 Repository 回归 |
| 本目录报告、计划、JSON 结果、日志和截图 | 兼容范围、已知差异与可复核证据 |

`git diff` 相对第二阶段审查 HEAD 的生产目录为空。没有修改 Claude 世界书核心、Prompt、模型参数、Schema、存档、Commit/CAS/Undo、现有测试断言或外观代码。没有真实玩家存档、私人历史和生产密钥。Node 使用独立 IDBFactory，浏览器使用全新测试上下文和合成存档；全部模型请求由注入 transport 或 localhost Mock 接收。

配置中的型号名称仅用来覆盖现有路由及原生 Thinking 分支：OpenAI `gpt-4.1`、DeepSeek `deepseek-chat`、Gemini `gemini-2.5-flash`、Anthropic `claude-sonnet-4-6`。**没有调用这些真实模型。** 官方/中转对照只验证请求构造，未对真实端点做认证、CORS 或生成请求。

## 2. 中文兼容性矩阵

以下“通过”均指可控、满足既定协议形状的 Mock，不是供应商认证或真实模型成功率。

| 协议 | 普通文本 JSON | 普通文本 SSE | 单工具 JSON | 单工具 SSE | stream 请求收到 JSON | 完整三阶段原子结算 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Chat Completions 兼容 | 通过 | 通过 | 通过 | 通过 | 两模式通过 | 四组合通过 |
| 原生 DeepSeek Chat Completions | 通过 | 通过 | 通过 | 通过 | 两模式通过 | 四组合通过 |
| 原生 Gemini generateContent | 通过 | 通过 | 通过 | 标准完整 functionCall 通过 | 两模式通过 | 四组合通过 |
| 原生 Anthropic Messages | 通过 | 通过 | 通过 | 原生工具完整生命周期通过 | 两模式通过 | 四组合通过 |

每一核心组合分别读取无独立思考、带公开思考、长篇带公开思考三个样例，共 48 组无损结果。正文源、标点、中文、emoji、反斜杠、引号、换行、对话及 `3<5` 在正式 Story 投影中精确相等，哈希一致；独立 reasoning 和项目 planning 不混入正式小说。

### 原生结构与完成条件

| 协议 | 实际核对的载体 | 身份及结束要求 |
| --- | --- | --- |
| OpenAI / DeepSeek | `message/delta.tool_calls[].function.arguments` | 唯一项目工具，真实 call ID、流式 index；`tool_calls` 原因，不用 EOF 替代 |
| Gemini | `functionCall{name,args,id?}`、SSE complete-value | 使用真实候选/part 位置，ID 原生可选；完整值与实际 STOP；不猜 partialArgs |
| Anthropic | `tool_use`、`input_json_delta`、`content_block_stop` | 原生 ID/block index；tool_use 原因及正确顺序的 message_stop |

源 API 的公开思考、完成原因和 usage 均保留。OpenAI/DeepSeek 的 `[DONE]`、Anthropic 的 block stop / message stop、Gemini 的 finishReason 不能互相伪造。本轮没有新增完成信号或接受路径。

8 组 stream→JSON 回退由同一次响应消费完成；8 组官方/中转请求构造对照只添加第二阶段已有的工具元数据，原消息、角色、模型、温度、输出预算、原生 Thinking、Claude 官方缓存标记行为均保持原样。没有自动追加模型请求。

## 3. 失败矩阵与存档安全

| 场景 | 普通文本 | 结构化工具 | 状态保护 |
| --- | --- | --- | --- |
| 真正正文截断，原生 length / max_tokens / MAX_TOKENS | 原严格校验拒绝 | 拒绝，真实上限原因保留 | 正式状态和候选不污染 |
| content_filter / SAFETY / refusal | 拒绝 | 拒绝 | 不提交 |
| SSE 缺真实结束标记 | stream_interrupted | tool_response | 不补造完成 |
| 损坏的完整 JSON 响应体 | invalid_json | invalid_json | 不接受候选 |
| `<变量规划>` 非法 JSON | invalid_json + guide_json | 同一原校验失败 | 不修改正式状态 |
| HTTP 400 | 原拒绝分类 | 原拒绝分类 | 单次请求，不回退重发 |
| 工具模式收到普通文本 | 不适用 | 明确 mixed_text 拒绝 | 不偷偷换输出模式 |
| 多工具、缺必需身份、参数类型非法 | 不适用 | 整批拒绝 | 不猜 ID、不选最长稿 |

正式 StoryStage 错误矩阵包含 16 个协议/模式/传输组合，各 5 种失败，共 80 组。每组实际读取 Repository 前后正式状态和草稿，结果完全相同。这里调用未配置 UI 失败元数据写入回调；自动协调器的额外 4 个失败流程允许保留原有合法失败元数据，但正式状态不变、无 Story/Variables/World 候选、无 Commit、无下游请求。

32 组单工具约定负例验证供应商可能不遵循要求时明确失败；其中 Gemini 缺失的是必需名称，不把其合法缺省 ID 当成错误。这些是人为构造的负例，**不能据比例计算真实模型的单工具遵循率**。

原有网络中断、取消迟到、超时、凭证、CAS、IDB 故障与续写保护继续由既有定向 243 项和全量测试验证。本轮浏览器还重新执行取消、混合载体拒绝、文本续写及工具续写，没有通过删除或跳过旧断言取得通过。

## 4. Story → Variables → World → Commit

16 个正常流程覆盖四协议 × 文本/工具 × JSON/SSE，均使用正式协调器和 Repository：

- 各发一次 Story、Variables、World，共三次 Mock 生成请求。
- Variables、World 无工具声明，仍为现有非流式文本命令/五数组 JSON。
- 变量更新经原模拟/校验；用餐现金从 10000 分降为 7000 分，与合成正文中的已成立事实一致。
- Commit 恰好一次，revision 和 turnNumber 各推进一次，Journal 和短期记忆各保存一条。
- 下一草稿为空行动，重开 Repository 精确恢复，不自动发起请求。
- 错误工具载体的 4 个协调器流程只发 Story 一次，不启动下游或 Commit。

没有修改世界书、NPC/组织权限、事件生命周期或时间规则。沿用前两阶段的隔离保存链路，没有把载体 Schema 当成业务授权。

## 5. 质量与 Token 对照：本轮能证明什么

### 可复核的传输质量底线

48 组对同一合成正文的恢复哈希全部一致。长篇为 **18442 个 Unicode 字符**、240 个编号段及对话；Node 矩阵和四协议双端浏览器均验证末段完整、原文可滚动复制、思考不进入小说及一次结算。

这只能证明编码/解析/存储无损，不能证明模型的创造力、都市写实文风、事实遵循或多轮文学质量。Mock 已给定回复，不可能检验“模型是否愿意按工具约定生成”。没有给出虚构的文学评分、成功率或供应商性价比排名。

### 静态包装开销

以下来自实际 `wireRequest` 序列化前后对照，同一模型/消息/参数，不是 Tokenizer 结果：

| 协议 | 工具模式额外请求 Unicode 字符 | 额外 UTF-8 字节 | 官方/中转差异 |
| --- | ---: | ---: | --- |
| OpenAI | 378 | 466 | 本夹具增量相同 |
| DeepSeek | 350 | 438 | 本夹具增量相同 |
| Gemini | 381 | 469 | 本夹具增量相同 |
| Anthropic | 308 | 396 | 本夹具增量相同；Thinking 使用 auto |

短样例原回复 367 UTF-8 字节，工具参数 JSON 为 383 字节（+16）。原生对象和字符串参数的服务商生成/计费方式未必相同，**不能把序列化字节直接换算成模型输出 Token**。完整合成游戏请求体约 39350～40278 Unicode 字符、91141～92157 UTF-8 字节，同样不是供应商输入 Token。

Mock usage 固定注入：OpenAI/DeepSeek/Gemini 为输入 100、输出 200、总量 300、缓存读 10；Anthropic 为未缓存输入 100 + 缓存读 10 + 创建 5 = 总输入 115，输出 200，未伪造供应商缺失的 total_tokens。结果及请求检查器实际记录均通过断言，缓存细分没有再次累加成另一份输入量。这些数值是测试夹具，**不是实付用量，也不能跨协议比较费用**。

## 6. 正式执行结果

环境：Node **24.19.0**，npm **11.9.0**，Vitest **5.0.5**，Playwright **1.64.1**，Chromium **154.0.8037.57**。

| 批次 | 通过 | 失败 | 跳过 | 退出码 |
| --- | ---: | ---: | ---: | ---: |
| 正式锁文件 npm ci | 安装成功 | 0 | — | 0 |
| 新矩阵首轮 | 60 | 16 | 0 | 1 |
| 修正新测试错误码后，矩阵及既有专项四文件 | **319** | **0** | **0** | **0** |
| 最终 npm run check | **4728 / 189 文件** | **0** | **0** | **0** |
| npm run prompts:check | **93** | **0** | **0** | **0** |
| 四协议长篇真实 React，PC/手机 | **8** | **0** | **0** | **0** |
| 相关旧流程双端回归 | **10** | **0** | **0** | **0** |
| git diff --check | 通过 | 0 | — | 0 |

`check` 内含文件名、ESLint、完整 Vitest 和生产 Build；Build 包含 TypeScript 与 catalog:check。Prompt 93 项、专项 319 项均属于完整 4728 的重叠子集，不能再累加。

矩阵新增 76 项。其首轮 16 项失败来自新测试误将非法变量规划的既有错误码写成 invalid_output；源码明确返回 invalid_json/guide_json。只修正新测试的精确预期，并增加 guide_json/tag 断言，没有改解析器或削弱存档保护。最终全部通过。

没有出现新增或既有浏览器失败，因此没有为不存在的失败额外跑 main 对照；没有运行完整数百项 Chromium。构建只有既有大 chunk 提示，不为此修改无关架构。

### 浏览器实际内容

四协议各 PC、手机 1 项，共 8 项。由本地 HTTP 服务器按原生 SSE 形状返回长篇，使用真实 React/Repository，不替换工作流。检查了：

- 原生公开思考及测试凭证脱敏；主动打开前私密 planning 不在默认 DOM。
- 接收中无 Story 候选；完成载体/Story 校验后才形成候选。
- World 请求暂挂时正式状态仍不变，原文只有一个 readonly 区域，可原生滚动到底、全选复制，无横向溢出；查看不改 Repository。
- 释放 World 后完整结算、准确 Journal/记忆/金额/版本、请求恰好三次且下游无 tools。
- 刷新后存档一致，不额外请求。

10 项旧场景为普通文本连续结算、普通正文刷新续写、工具 mixed 拒绝、工具取消迟到、工具 Story 缺尾刷新续写，每项双端。与本轮新增 8 项不重叠，共 **18 个本轮独立场景**，分两批记录，没有累加前两阶段的历史通过数。

## 7. 问题清单与推荐支持范围

| 项目 | 证据与结论 | 处理 |
| --- | --- | --- |
| 新测试错误码预期错误 | 首轮 16 失败、精确修正后全绿 | 仅修测试，无生产修改 |
| 真实模型/服务遵循率 | 真实请求 0，无法从 Mock 得出 | 等待预算授权 |
| 完整 Story + length 的模式差异 | 16 组实测：普通文本可严格复核接受，工具模式均 output_limit | 保留已审查政策；不能宣称工具更稳定 |
| Anthropic 原生 Thinking 与强制工具冲突 | 现有适配保留 Thinking、使用 auto；普通文本返回会拒绝 | 真实模型是否调用工具待实测，不静默降级 |
| Gemini 增量函数参数 | 本批仅标准完整 functionCall；不猜 partialArgs/willContinue | 不将未实现 API 版本列为支持 |
| 费用与文学质量 | 包装增量已测，真实 Token/文学评测缺失 | 不宣称节费或质量提高 |
| 首次小说可读延迟 | 工具需完整参数后展示，原文/公开思考可实时看 | 真正体验需批准后记录两种首字延迟 |

建议继续默认关闭、作为明确实验选项，仅在满足上述单工具、完整参数、原生结束语义的接口中试用。工程支持范围是：

- OpenAI/DeepSeek **Chat Completions** 单一 `tool_calls`，不是 OpenAI Responses API。
- Anthropic **Messages** 的单一 tool_use 原生生命周期。
- Gemini **generateContent / streamGenerateContent** 的标准完整 functionCall；ID 可选，真实位置关联。
- 保留四协议原文本路径与单请求 JSON 回退。

不支持外部工具执行、并行多工具、旧 function_call 别名、工具递归、server tool、任意多模态载体或预设专有输出包装。没有做请求扰动、外部检测规避或安全过滤绕过。真实端点认证/CORS、具体模型版本、真实 cache/billing 及长期稳定性均未获本轮认证。

**本轮未发现需要修复的生产代码阻断。Mock 工程门槛通过；真实模型验收证据不足，不能标记为真实供应商/模型全面验收完成。**

## 8. 证据与后续准备

- [机器可读矩阵结果](MATRIX_RESULTS.json)：212 条结果记录、236 次 Mock 生成调用（含每个完整流程三次）；不是 212/236 个独立测试，不含真实模型调用。
- [定向测试](logs/matrix-targeted.log.gz)、[完整工程检查](logs/check.log.gz)、[Prompt](logs/prompts.log.gz)。
- [四协议双端](logs/chromium-matrix.log.gz)、[旧流程双端](logs/chromium-regression.log.gz)、[原始首轮失败](logs/matrix-initial.log.gz)。
- [真实试测计划及预算表](LIVE_TRIAL_PLAN.md)：只准备，不执行。未填写真实模型价格、输入/输出与总金额限额前，不发请求。

日志及退出码在 `logs/`；`.log.gz` 无损保存原始字节。全部原始浏览器 JSON/截图保留在 `/workspace/ai-response-events-phase3-evidence/`，本轮没有浏览器失败 trace。所有截图为合成存档，并非真实模型生成质量展示：

| 协议 | PC 长原文 / 结算 | 手机长原文 / 结算 |
| --- | --- | --- |
| OpenAI | [原文](screenshots/desktop-openai-long-raw.png) · [结算](screenshots/desktop-openai-committed.png) | [原文](screenshots/mobile-openai-long-raw.png) · [结算](screenshots/mobile-openai-committed.png) |
| DeepSeek | [原文](screenshots/desktop-deepseek-long-raw.png) · [结算](screenshots/desktop-deepseek-committed.png) | [原文](screenshots/mobile-deepseek-long-raw.png) · [结算](screenshots/mobile-deepseek-committed.png) |
| Gemini | [原文](screenshots/desktop-gemini-long-raw.png) · [结算](screenshots/desktop-gemini-committed.png) | [原文](screenshots/mobile-gemini-long-raw.png) · [结算](screenshots/mobile-gemini-committed.png) |
| Anthropic | [原文](screenshots/desktop-anthropic-long-raw.png) · [结算](screenshots/desktop-anthropic-committed.png) | [原文](screenshots/mobile-anthropic-long-raw.png) · [结算](screenshots/mobile-anthropic-committed.png) |

实际看过 PC Anthropic 原文、手机 Gemini 已结算截图，确认脱敏与原有连续原文界面；自动断言同时验证滚动、复制、全文及存档一致性。本轮未覆盖 Safari/WebKit/真实手机，不将 Chromium 手机模拟称为真机。

复核：

```bash
npm_config_cache=/workspace/.npm npm ci
npm run check
npm run prompts:check
HEIJIN_COMPAT_EVIDENCE=/tmp/heijin-compat.json npx vitest run \
  src/tests/story-compatibility-matrix.test.ts src/tests/story-tool-events.test.ts \
  src/tests/story-tool-runtime.test.ts src/tests/response-events.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-compatibility-matrix.spec.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/automatic-settlement.spec.ts e2e/story-continuation.spec.ts e2e/story-tool-output.spec.ts \
  --grep '完整原文可读，开局|正文被截断后保留已写部分|非法工具载体 mixed|取消工具SSE后|工具载体中的Story缺尾'
git diff --check
```

实际浏览器执行沿用项目视口、原测试及真实组件，仅用外置配置选择独立端口、单 worker 和证据目录，原文配置见日志目录。本轮不创建新 PR、不合并、不部署、不发布。
