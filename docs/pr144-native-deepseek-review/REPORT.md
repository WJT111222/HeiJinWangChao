# PR #144 原生 DeepSeek：正式审查与验收

验收日期：2026-11-14（中国标准时间）。原始测试日志时间戳保留执行环境 UTC。

审查起点：`dbdfaf110935a20a8ca58153250e91bddc1f01d2`（与用户给定 HEAD 一致）。main / PR 基线：`675309cb4d8c98b9a9b5e8b39104b3ac8e213935`。所有修改推回原分支 `feat/native-deepseek-protocol`，不新建 PR。

## 审查结论

在本次代码及 Mock 验证范围内，未发现阻断合入的协议传输或密钥安全问题。新增 deepseek 作为第四种配置标识，复用兼容传输和响应读取，同时保留独立协议/缓存身份。旧渠道保存结构及三个旧协议的规则保留。

本轮修复两类问题并补强证据：

- **既有手机测试导航失配**：多渠道和授权/取消两个场景打开设置后未进入「AI 连接」分类，停在寻找「新增渠道」按钮，未执行后续断言。在未修改 main 上同条件运行两项，均以相同原因失败。仅补齐真实导航，包括刷新后再次进入；没有删断言、放宽请求计数、跳过测试或增加重试。
- **过时的“三协议”说明**：改为“各协议”，不再与新增的第四协议矛盾。没有修改请求逻辑或配置语义。
- 原8项 DeepSeek 测试保留，增加5项：官方流式尾块用量、四阶段独立模型/旧渠道保存、OpenAI 参数学习隔离及不重发、SSE 截断、SSE 内容过滤。另增双端真实设置 E2E，验证官方地址、四阶段选择、保存/刷新、会话凭证及纯设置零 POST。

## 逐项核对

| 重点 | 结论与证据 |
| --- | --- |
| 四协议与旧渠道 | 完整单测通过；E2E 对四协议分别保存、查询模型、Mock 连接并核对8个精确请求端点及鉴权头。旧渠道参数/自定义值及刷新回归保留 |
| 官方端点与鉴权 | 默认 `https://api.deepseek.com`；生成 `/chat/completions`、列表 `/models`、Bearer 鉴权；不误走 Anthropic，不在URL/正文中放密钥 |
| 模型列表 | 从服务返回的 data[].id 获取；生产默认模型仍为空，不硬编码演示模型。GET 模型列表测试同时核对URL和鉴权 |
| max_tokens | deepseek 保留 max_tokens；max_completion_tokens 的字段替换及不支持参数学习仍限 openai。新增测试用明确的 OpenAI 参数拒绝响应证明 DeepSeek 不学习替换、不丢温度、不自动重发 |
| 正文/思考 | 非流式和分块 UTF-8 SSE 正确读取 content、reasoning_content、DONE；JSON 整段回退、内容过滤与长度错误保持原类别 |
| Token统计 | 输入/输出/总量及 completion_tokens_details.reasoning_tokens 均覆盖；官方最后单 choice 块携带 usage 的 SSE 格式通过 |
| JSON边界 | World 可选原生 JSON 模式，Variables 保持正式文本协议，不强制 JSON |
| 四阶段路由 | Story、Variables、World、Memory 各自模型经保存/重载后正确解析；新增桌面和手机 UI 用例实际选取四种不同模型并刷新恢复 |
| 凭证保护 | 输入框保持password；密钥仅在Mock鉴权头及会话凭证中，未进入AI配置正文、普通localStorage、请求正文或诊断结果；截图只显示掩码 |
| 未授权请求 | 新增真实设置用例只允许 GET /models，断言 POST=0；所有生成与连接响应均由Mock提供，未发起真实付费API调用 |

### 官方规范核实

使用只读 Web 工具核对官方文档（未调用模型接口）：

- [首次调用](https://api-docs.deepseek.com/quick_start/agent_integrations/)：官方根地址、Chat Completions 格式及 Bearer 鉴权。
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：max_tokens、temperature、reasoning_content、usage 字段及流式结束格式。
- [模型列表](https://api-docs.deepseek.com/api/list-models/)：GET /models 与 data[].id。

尤其核实了一个容易误判的细节：**当前官方规范说明，无论是否设置 include_usage，最后一个内容块都携带用量；没有独立的 usage-only 块。** 因此无需修改生产请求增加 stream_options。审查初期一项新增 Mock 错误地模拟“未显式 opt-in 就不返回用量”，产生12通过/1失败；核对官方规范后纠正为真实尾块格式，未用这条错误假设改生产代码。原失败日志保留，并明确不将其认定为产品缺陷。

执行环境 curl 访问文档曾被 CONNECT 403 拦截；这是环境代理访问限制，不是 DeepSeek 服务故障。随后只读 Web 工具成功取得官方页面。浏览器直连的实际 CORS、真实模型可用性及真实账单未验证；全程遵守 Mock 限制。

## 正式命令及成绩

环境：**Node.js v24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57**。使用真实项目依赖及 Playwright，没有离线垫片。

| 命令/阶段 | 结果 |
| --- | --- |
| `npm ci`（PR工作树） | 退出0，安装143包 |
| 原HEAD定向 DeepSeek Vitest | 8通过 / 0失败 |
| 原HEAD `npm run check` | Lint、145文件/3524项Vitest、TypeScript、Build全部通过 |
| 原HEAD `ai-settings.spec.ts` 双端 | 8通过 / 2失败 / 0跳过 / 0重试；两个手机导航失败详见对照 |
| 未修改main，仅复核两个手机失败 | 2失败 / 0跳过 / 0重试，同样停在「新增渠道」查找 |
| 最终定向 DeepSeek Vitest | **13通过 / 0失败** |
| 最终 `npm run check` | **Lint、145文件/3529项Vitest、TypeScript、Build全部通过** |
| 最终 `ai-settings.spec.ts` 双端 | **12通过 / 0失败 / 0跳过 / 0重试**（桌面6、手机6） |
| `git diff --check` | 通过 |

13项 DeepSeek 单测包含于3529项完整单测，不能相加计为额外独立数量。其他 AI 相关测试均在完整检查中执行，包含 ai-client、ai-route-persistence、ai-relay-compat、protocol-reliability、model-list-compat、model-list-hardening、thinking、thinking-refinements 等，最终无失败。没有运行全量浏览器套件。

浏览器使用仓库原配置的同一 desktop / Pixel 7 项目、相同断言及零重试。5174端口已有其他任务的旧服务，故以仅改端口/报告输出的隔离配置在5354运行PR、5355运行main，`reuseExistingServer: false` 保证页面来自正确工作树。没有关闭其他任务服务，也没有把旧服务的结果当作本PR验收。

实际浏览器命令：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/ai-settings.spec.ts --config playwright.pr144.config.ts
# 未修改main的同条件最小对照
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/ai-settings.spec.ts --config playwright.pr144.config.ts --project mobile --grep 'AI 多渠道|连接授权错误'
```

临时配置的完整内容见 [browser-config.txt](browser-config.txt)，未提交为项目运行配置。普通空闲环境可直接使用用户指定的 `npx playwright test e2e/ai-settings.spec.ts`。

## 原始证据

- 命令/退出码：[初始](initial-results.json)、[最终](final-results.json)。浏览器机器统计：[browser-summary.json](browser-summary.json)。
- 原始日志无损gzip：[npm ci](logs/npm-ci.log.gz)、[初始check](logs/check-initial.log.gz)、[最终check](logs/check-final.log.gz)、[最终13项](logs/deepseek-final.log.gz)。
- 浏览器：[原HEAD](logs/ai-settings-initial.log.gz)、[main对照](logs/ai-settings-main-control.log.gz)、[最终](logs/ai-settings-final.log.gz)；对应完整JSON reporter同名 `.json.gz` 在logs内。
- 失败trace和无损压缩页面快照：[PR初始](failure-artifacts/pr-head)、[main对照](failure-artifacts/main)。可用 `npx playwright show-trace <trace.zip>` 查看；所有凭证均为虚构Mock值。
- 用量Mock错误假设的原始失败：[日志](logs/deepseek-review-red.log.gz)；按当前官网纠正后的绿色结果：[日志](logs/deepseek-review-green.log.gz)。
- 所有压缩前日志大小及SHA256：[logs/sha256.json](logs/sha256.json)。用 `gzip -dc <file>` 查看原始输出。

完整构建的非阻断大块体积提醒及 Node 的 NO_COLOR/FORCE_COLOR 提示保留在日志中。

### 真实React截图（虚构值，密钥掩码）

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 原生DeepSeek、官方地址及密钥输入 | [截图](screenshots/desktop-deepseek-settings-key-masked.png) | [截图](screenshots/mobile-deepseek-settings-key-masked.png) |
| 独立模型路由恢复 | [截图](screenshots/desktop-deepseek-settings-routes.png) | [截图](screenshots/mobile-deepseek-settings-routes.png) |

## 本轮追加修改文件

- `e2e/ai-settings.spec.ts`：补齐两项既有场景及刷新后的AI分类导航；官方DeepSeek地址加入Mock拦截；新增双端四阶段/凭证/零生成请求用例。
- `src/tests/deepseek-native.test.ts`：保留原8项，新增5项实际生产调用链验证。
- `src/ui/settings/AiConnections.tsx`：仅“三协议”改为“各协议”。
- `docs/pr144-native-deepseek-review/`：本报告、原始日志、main对照、trace及截图。

未修改协议传输实现、API参数语义、玩家存档、领域规则、AI提示词或任何其他功能。原PR的11个功能文件详见GitHub完整diff；上述是本轮审查追加内容。

保持原PR #144 Draft，未合并、未主动部署、未发布或打标签，等待正式确认。
