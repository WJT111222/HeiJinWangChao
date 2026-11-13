# Story 单一连续原文框验收

基于重新获取的最新 main：`1686fe029de19917e42bb3a483b01dda1ec9812b`（已合并 #146）。独立分支 `fix/story-raw-continuous`，不修改 #146 分支。

实现与测试提交：`6714896ae141194383a2c9af75c4c697e2d31008`。随后提交仅记录本报告与验收材料，最终 HEAD 见 Draft PR。

## 结果与边界

Story「模型原文」只保留一个只读 `textarea`。删除供应商思考分区、来源标题及独立思考文本框，没有新增折叠栏、内容分区或思考窗口。原文区域支持原生键盘选择、复制和内部滚动；修正旧行动台 textarea 样式对原文高度的覆盖。Variables、World 继续使用原有 pre 显示。

在同一次客户端响应上新增只读事件观察，连续显示值与正式模型文本分开保存：

- SSE 按实际接收事件顺序追加公开文本值，包括正文前、事件交错时和正文开始后才收到的原生思考，不把所有思考重新搬到开头或结尾。
- 同一事件内的多个公开字段按响应字段／数组排列，注明该排列不代表生成先后，不根据类型猜测时序。
- 非流式 JSON 或没有事件记录的临时数据明确提示「字段间真实返回先后不可知」。这是一条操作说明，不是内容分区；原文值中不插入伪造的来源标题、思考标签或时间戳。
- 模型文本已有的 `<think>`、`<thinking>`、`<正文>` 等字符原样保留，不再次提取或单独复制。API 实际独立返回的公开内容各记录一次；不做语义去重、猜测或生成新的思考文本。
- Gemini 内容块按数组排列，Anthropic 只读取公开 text/thinking，不显示签名或 redacted 隐藏块；OpenAI／DeepSeek 记录实际公开字段。四协议均有生产链回归。

原有 `response.text` 仍是正式解析的唯一模型文本，显示拼接从不传给 `parseStoryEnvelope()`、StorySchema 或后续阶段。只增加临时内存字段 `displayText/displayOrder`，沿用六条容量、clear、刷新及淘汰生命周期。成功、失败和流式中的显示均脱敏，包括完整凭证及末尾凭证前缀。没有 Storage／IndexedDB 写入通道。

**小说阅读区不变**。`StoryStreamReading`、`GameScreen`、两套生成 Hook、`StoryStage`、`StoryStream`、`TurnCoordinator` 全文件与 main 完全相同。思考实时展示，完整识别 `<正文>` 后清空，从空白仅显示小说正文；取消、超时及失败不保存临时内容。

正式校验、必需标签、掉格式处理、提示词、来源锁、Variables／World 协议、存储、结算、撤回及阅读代码共 **192 文件**与 main 逐字节一致，见 [SHA-256 核对](validation/protected-files.txt)。没有额外请求、重试或真实付费模型调用。

## 正式验证

Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**；真实依赖及 Playwright 运行器，见 [versions.txt](validation/versions.txt)。

| 检查 | 最终实际结果 | 原始输出 |
| --- | --- | --- |
| `npm ci` | 成功，143 packages | [npm-ci.log.gz](validation/npm-ci.log.gz) |
| `npm run check` | Lint、**3586 单测／148 文件**、TypeScript、Build 全部通过 | [check.log.gz](validation/check.log.gz) |
| 相关 Vitest | **51 通过**（新增21项＋原阅读30项） | [unit-final.log.gz](validation/unit-final.log.gz) |
| `npm run prompts:check` | **93 通过** | [prompts.log.gz](validation/prompts.log.gz) |
| 新增 PC／手机 Chromium | **8 通过，0 失败／跳过／重试** | [日志](validation/chromium.log.gz)、[JSON](validation/chromium.json.gz) |
| 既有阅读双端回归 | **20 通过，0 失败／跳过／重试** | [日志](validation/reading-regression.log.gz)、[JSON](validation/reading-regression.json.gz) |
| 既有桌面原文入口 | **1 通过** | [日志](validation/legacy-desktop.log.gz)、[JSON](validation/legacy-raw.json.gz) |
| 既有手机诊断入口 | **1 通过** | [日志](validation/legacy-mobile.log.gz)、[JSON](validation/legacy-mobile.json.gz) |
| `git diff --check` | 通过 | [空输出](validation/diff-check.log.gz) |

最终是 **30 个独立 Chromium 场景**通过（PC15、手机15），没有运行全量 E2E。51项相关单测和93项Prompt是3586总数的子集，不累加。构建有 Vite 大于500kB的 chunk 提示，无构建错误，本轮未扩大为拆包优化。

新增四个浏览器场景各双端执行：

1. `连续原文：流式交错和迟到思考真实排序，正文阅读不变，长文本可滚动复制`：请求中的单一原文框持续更新；模型标签跨事件；小说切换为空白；迟到思考只加入原文；长正文真实滚轮滚动及完整复制；刷新后临时原文清空。
2. `连续原文：非流式同框完整复制，明确不知字段间真实时序`：全部实际内容在同一文本框，提示时序不可知。
3. `连续原文：同一SSE事件多字段不伪造生成先后，所有实际值只显示一次`：保留响应字段排列，提示单事件内部不代表生成先后。
4. `连续原文：中断响应单框完整可复制且脱敏，正式状态草稿不变`：失败原文仍可查看；分块凭证不泄露；状态和草稿完全不变。

每项均断言只有一个只读原文框、没有旧独立思考框／来源标题；使用实际 `Ctrl/Command+A/C` 和 Chromium 剪贴板核对全文，尝试输入不改变值；断言恰好一次 Mock 请求，浏览不写库且没有横向溢出。长文本另断言可用高度不小于160px并用真实滚轮验证内部滚动。

既有回归包括完整的 `story-stream-reading.spec.ts` 20项，保留所有思考、正文、取消、超时、中断、严格失败及隐私／存储断言；只把被此次需求取代的双框显示断言改成单框完整值断言。另定向运行桌面 `story-runtime.spec.ts` 的统一原文 P6 场景，以及手机 `mobile-batch2.spec.ts` 的长响应／私有候选／规划诊断场景。此前报告图片从备份还原，没有覆盖其他批次验收材料。

主要命令（全部明确文件范围）：

```bash
node --version
npm ci
npx vitest run src/tests/story-raw-continuous.test.tsx src/tests/story-stream-reading.test.tsx
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-raw-continuous.spec.ts --config playwright.story-raw.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-stream-reading.spec.ts --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-runtime.spec.ts e2e/mobile-batch2.spec.ts --project desktop --grep 'P6：完整文本与原生思考在统一原文查看' --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-batch2.spec.ts --project mobile --grep '长响应、私有候选与规划' --config playwright.story-reading.config.ts
npm run check
npm run prompts:check
git diff --check
```

使用独立5368端口；旧回归使用5356端口。`NPM_CONFIG_CACHE` 指向可写缓存目录，JSON结果写入独立证据目录，仅改变输出位置。

## 失败与修复记录

- [red.log.gz](validation/red.log.gz)：新单框断言在未修复显示上真实失败，证明旧界面仍是双区域。
- [unit-initial.log.gz](validation/unit-initial.log.gz)：27通过／4失败，旧测试还断言分区时序提示；改成一个 textarea、完整事件值和无旧分区，保留请求次数及状态断言。
- [unit-stream-fixture.log.gz](validation/unit-stream-fixture.log.gz)：48通过／2失败，新夹具把项目规划和正文开标签放进同一个事件，却要求观察一个不存在的中间进度；把夹具切在正文开标签之前，未改阅读行为。
- 首次8个新 Chromium 均通过；截图检查发现旧行动台样式使桌面框只有约78px，定向提高只读原文框样式优先级，并增加最小高度断言，见 [首次日志](validation/chromium-before-height-fix.log.gz)。
- [chromium-json-menu-race.log.gz](validation/chromium-json-menu-race.log.gz)：高度修正后7通过／1失败。即时JSON已经保存完成、React移除了手机「回合操作」，测试还在读取已消失的按钮。夹具改为等待真实草稿保存后再收菜单，不添加重试、不改生产逻辑。最终8项全部通过。失败trace原件保留在工作目录 `/workspace/story-raw-continuous-evidence/json-menu-race.trace.zip`。
- [check-initial.log.gz](validation/check-initial.log.gz)：3586单测和Lint已通过，TypeScript发现新测试 Locator 的通用 HTMLElement 类型不能直接调用 `setSelectionRange`；补充 textarea 类型标注（编译后无运行差异），完整重跑全部成功。

无剩余失败；没有删除、跳过或弱化业务断言。

## 真实 React 截图

| 状态 | PC | 手机 |
| --- | --- | --- |
| 请求中的连续原文 | [请求中](screenshots/desktop-pending-raw.png) | [请求中](screenshots/mobile-pending-raw.png) |
| 长文本框滚动末尾 | [流式原文](screenshots/desktop-continuous-stream.png) | [流式原文](screenshots/mobile-continuous-stream.png) |
| 非流式原文 | [JSON](screenshots/desktop-continuous-json.png) | [JSON](screenshots/mobile-continuous-json.png) |
| 同一事件多字段 | [单事件](screenshots/desktop-continuous-same-event.png) | [单事件](screenshots/mobile-continuous-same-event.png) |
| 中断与凭证脱敏 | [失败原文](screenshots/desktop-continuous-interrupted.png) | [失败原文](screenshots/mobile-continuous-interrupted.png) |

## 修改清单

生产6文件：

- `src/services/ai/client.ts`、`responseContent.ts`：只读、逐响应事件的公开值观察，不改变原回调、请求和返回模型文本。
- `src/services/ai/runtime.ts`、`stageResponses.ts`：仅Story临时连续显示值、时序状态及脱敏。
- `src/ui/game/StageResponsesPanel.tsx`、`workflow-feedback.css`：一个只读连续原文框、时序说明及专用滚动高度。

测试／配置6文件：`src/tests/story-raw-continuous.test.tsx`、`story-stream-reading.test.tsx`，`e2e/story-raw-continuous.spec.ts`、`story-stream-reading.spec.ts`、`story-runtime.spec.ts`，`playwright.story-raw.config.ts`。另有本报告、10张截图及原始证据。

日志使用gzip无损保存。JSON仅将截图base64改为图片引用或附件哈希，结果元数据保留；原始JSON留在工作证据目录，哈希见 [JSON_SOURCES.txt](validation/JSON_SOURCES.txt)。[SHA256SUMS.txt](validation/SHA256SUMS.txt) 用于核对材料。

保持独立 Draft PR，未合并、未部署、未发布。
