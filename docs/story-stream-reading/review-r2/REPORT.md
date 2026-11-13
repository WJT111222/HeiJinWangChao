# PR #146 复审修复：公开兼容文本思考

对应[复审评论](https://github.com/WJT111222/HeiJinWangChao/pull/146#issuecomment-6865645885)。审查基线 HEAD：`4e5b5b19373faa4e7163f05f753f458f5be5c431`；重新核对的 main：`8b59aa9053b89e195242a0a88b30f5c94aaad30a`，均未变化。

修复及测试提交：`f844ffb75ecc45d5a33111077dc3c00c53ef0f65`。后续仅提交本报告与证据；最终分支 HEAD 在 PR 回复中提供。

## 缺口与最小修复

原客户端已通过 `LeadingThink` 识别响应文本开头的 `<think>`，但该来源进入的是兼容聚合回调，Story 阅读进度只接收独立 provider 字段和项目 `<thinking>`，所以兼容思考虽已收到，阅读区仍等待。

增加只读 `onCompatibilityReasoningDelta`，直接转发既有解析器确认的 `<think>` 增量；不把聚合后的 `onReasoningDelta` 再冒充独立 provider 来源。覆盖 SSE、终止时的已有解析器缓冲内容和完整 JSON 回退。没有重新解析、重算、改写模型响应，没有增加请求，也没有改变旧聚合回调和响应结果。

Story 只把这类文本放在临时 `compatibilityReasoning` 进度中，复用现有凭证及前缀脱敏。阅读区明确标为「兼容文本思考 · `<think>`」，注明它来自响应文本而非独立 `reasoning_content`。与独立 provider 字段、项目 `<thinking>` 不同的内容分别显示。若独立字段以完全相同的文本覆盖兼容内容（包括正在增长的精确前缀），优先显示独立字段，不根据相似性或语义猜测重复。

识别 `<正文>` 后，三类思考进度同时移除，只展示正文。新增滚动依赖以跟随兼容思考增长。原文视图保持不变：完整文本中的 `<think>` 只出现一次，不另建兼容思考副本；实际独立 provider 字段仍按来源单列。

**正式规则未改**：`LeadingThink`、协议参数、`parseStoryEnvelope()`、`storyEnvelopeDiagnostic()`、必需项目 `<thinking>`、StorySchema、提示词、来源锁、存储、结算和撤回均不变。185 个受保护文件与审查 HEAD 和 main 逐字节相同，见[核对记录](validation/protected-files.txt)。仅有 `<think>` 而缺少必需项目规划的响应仍失败，正式状态及原草稿保持一致。

## 本轮实际验证

Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**，使用现有正式依赖；未修改依赖，无离线垫片。全部响应为本机 Mock，未调用付费 API。

| 检查 | 实际结果 | 原始日志 |
| --- | --- | --- |
| Story 流式定向 Vitest | **30 通过，0 失败／跳过**；原20项加强并新增10项 | [unit-green.log.gz](validation/unit-green.log.gz) |
| `npm run check` | Lint、**3565 单测／147文件**、TypeScript、Build 全部通过 | [check.log.gz](validation/check.log.gz) |
| `npm run prompts:check` | **93 通过** | [prompts.log.gz](validation/prompts.log.gz) |
| 本轮双端 Chromium | **6 通过，0 失败／跳过／重试** | [日志](validation/chromium.log.gz)、[JSON](validation/chromium.json.gz) |
| `git diff --check` | 通过 | [空输出日志](validation/diff-check.log.gz) |

30 项定向单测与 93 项 Prompt 检查属于 3565 总数的子集，不能累加。原先已通过的20项独立 Chromium 场景本轮没有重复执行，首轮证据完整保留；本轮仅运行新增三种情况各双端一次。未运行全量 E2E。Build 仍提示大于500kB的 chunk，没有构建失败，本轮未改拆包。

新增回归覆盖：

- OpenAI、DeepSeek 的 `<think>…</think><thinking>…</thinking><正文>` 每个文本切点及 SSE 中文单字节切分，真实客户端回调累计恰好一次，不混淆独立字段，原响应与聚合行为不变。
- 只有 `<think>`，以及 `<think>` 后直接正文：兼容内容先可读，随后分别按原有空正文／严格格式规则失败，不保存状态或草稿。
- 独立 provider 字段先到／后到、内容相同／不同四种组合：三来源实际内容分别保留；重复时独立字段优先；正文开标签后全部清空。
- 完整 JSON 回退、自动工作流进度转发、组件清空及取消时的分块凭证脱敏／不落盘／只请求一次。

本轮 Chromium 三个标题在桌面1440×1000及 Pixel 7 手机各执行一次：

1. `兼容公开思考 all：真实分块来源、原生优先去重和正文清空`：独立原生思考、兼容思考、项目规划并存；长兼容思考自动跟随；分块标签；空正文边界；最终合法草稿与只读原文。
2. `兼容公开思考 only：真实分块来源、原生优先去重和正文清空`：只有兼容公开思考，直接正文可预览，但最终严格校验失败，Repository 状态和草稿完全不变。
3. `兼容公开思考 mirror：真实分块来源、原生优先去重和正文清空`：独立字段覆盖相同兼容文本，读区无重复分区，完整原文仍保留真实标签与实际独立字段。

每项均断言恰好一次 Mock 请求，原文完整且没有重复兼容区、浏览不写入、刷新临时原文清除、无页面横向溢出。

执行命令：

```bash
node --version
npx vitest run src/tests/story-stream-reading.test.tsx --testNamePattern '兼容层提取前的 think 标签'
npx vitest run src/tests/story-stream-reading.test.tsx
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-stream-reading.spec.ts --grep '兼容公开思考' --config playwright.story-reading.config.ts
npm run check
npm run prompts:check
git diff --check
```

执行时 `NPM_CONFIG_CACHE` 与 `STORY_READING_RESULT` 使用可写的独立证据目录；只改变输出位置，不改变运行器及断言。

## 先红后绿与失败记录

- [red.log.gz](validation/red.log.gz)：在原审查 HEAD 上加强既有兼容测试，精确断言阅读进度中已收到兼容文本，实际失败。该次按名称选中1项，另外19项由运行器过滤，不是新增 skip。
- [unit-fixture-initial.log.gz](validation/unit-fixture-initial.log.gz)：27通过／2失败，新增任意切点测试错误地传空 messages，被现有请求配置校验拒绝；改用合法的隔离 user 消息，没有改变配置保护或弱化断言。
- 最终30项单测与6项浏览器均成功，本轮浏览器无失败。无剩余问题，没有扩大为业务规则或格式修复。

## 新截图

真实 React 页面和 Chromium 拍摄，非静态设计图，手机保留设备像素比例；每种场景还保存了正文清空及原文截图。

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 不同来源分区 | [实际公开来源](screenshots/desktop-compat-all-sources.png) | [实际公开来源](screenshots/mobile-compat-all-sources.png) |
| 仅兼容文本思考 | [兼容文本](screenshots/desktop-compat-only-sources.png) | [兼容文本](screenshots/mobile-compat-only-sources.png) |
| 相同文本原生优先 | [去重](screenshots/desktop-compat-mirror-sources.png) | [去重](screenshots/mobile-compat-mirror-sources.png) |
| 正文开始清空 | [空正文](screenshots/desktop-compat-all-body-boundary.png) | [空正文](screenshots/mobile-compat-all-body-boundary.png) |
| 完整文本仍只渲染一次 | [原文](screenshots/desktop-compat-all-raw.png) | [原文](screenshots/mobile-compat-all-raw.png) |

## 本轮修改文件

生产文件仅5个：`src/services/ai/client.ts`、`src/workflows/storyStage.ts`、`src/workflows/turnCoordinator.ts`、`src/ui/game/StoryStreamReading.tsx`、`src/ui/game/GameScreen.tsx`。

回归2个：`src/tests/story-stream-reading.test.tsx`、`e2e/story-stream-reading.spec.ts`。另有本报告、截图和原始日志，并在首轮报告增加本轮链接。

日志使用 gzip 无损保存。JSON 仅将重复截图 base64 换为截图文件引用，结果元数据保留；原始 JSON 哈希见 [JSON_SOURCE.txt](validation/JSON_SOURCE.txt)，材料校验见 [SHA256SUMS.txt](validation/SHA256SUMS.txt)。

推回原 Draft PR #146，不另开PR；未合并、未部署、未发布，等待复审。
