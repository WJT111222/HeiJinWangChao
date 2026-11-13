# Story 原文与流式阅读修复验收

基线与重新 fetch 后的 `origin/main`：`8b59aa9053b89e195242a0a88b30f5c94aaad30a`。

独立分支：`fix/story-stream-reading`。生产实现与测试提交：`f3e47d4b9b5562cba627f147b23930884ea837e5`。后续提交仅保存本报告及验收材料；最终 HEAD 以 Draft PR 分支为准。

## 实现与审查结论

Story 保留「概览／模型原文／校验结果」三个页签，移除桌面和手机诊断中的独立「叙事规划」。模型原文只渲染一次完整文本，保留实际收到的标签、空白和格式；独立的供应商原生思考在同一视图另列，并标注协议来源及独立响应字段。分区顺序明确不代表真实返回先后。不会再次提取并复制原文里的项目 `<thinking>`。

新增的客户端观察回调仅收集同一次响应，不参与验收、修复或重发。完整文本在既有兼容提取之前观察，因此 `<think>` 兼容文本也保留在原文中；它不会冒充 `reasoning_content` 等独立字段。OpenAI、DeepSeek、Gemini、Anthropic 均由真实客户端解析链测试覆盖。非流式 JSON 回退及最终 finish 检查失败也保留实际收到的临时原文。

阅读区在正文前按来源显示实际收到的公开原生思考和项目 `<thinking>` 内容。完整识别 `<正文>` 开标签时立即切换为无文本的正文区；随后仅追加正文，不显示记忆、变量规划、行动选项等尾部内容。即使尚无下一个正文字符，也不会继续保留思考。正文开始后的迟到原生思考只留在原文视图。沿用原有自动跟随、手动上滚暂停和恢复跟随功能，增加思考增长及阶段切换的滚动依赖。

完整标签与中文 SSE 数据经过任意分块的测试。直接 `<正文>` 或空 `<thinking>` 可以流式预览，但最终仍因缺少必需规划而失败；没有改变正式验收规则。取消、中断、超时及最终格式失败后临时阅读内容撤下，正式状态与原草稿保持一致。合法响应仍仅进入原有草稿保存流程，不改变正式结算。

临时原文沿用内存中最近六次请求的容器，刷新、clear 或淘汰后不可恢复，不进入 Storage、IndexedDB、正式故事或普通日志。保留原有脱敏，另保护流式回显的已知凭证前缀；UI 测试使用虚构凭证。既有内部 inspection 的生命周期保持原样，移除的是独立 UI。

`parseStoryEnvelope()`、`storyEnvelopeDiagnostic()`、全部正式验证、领域及存储文件、提示词与来源锁共 184 个文件与基线逐字节一致，详见 [SHA-256 核对](validation/protected-files.txt)。没有修改请求参数、模型路由、自动重试、协议、Schema、结算或撤回机制。

## 正式结果

环境：Node **v24.19.0**、npm **11.9.0**、Chromium **154.0.8037.57**；实际版本输出见 [versions.txt](validation/versions.txt)。真实 npm 依赖和 Playwright 运行器，无离线替代运行器。

| 检查 | 最终结果 | 原始输出 |
| --- | --- | --- |
| `npm ci` | 成功，安装 143 packages | [npm-ci.log.gz](validation/npm-ci.log.gz) |
| `npm run check` | Lint、147 文件 / **3555 单测**、TypeScript、Build 全部通过 | [check-final.log.gz](validation/check-final.log.gz) |
| 相关五文件 Vitest | **165 通过**，含新增 20 项 | [related-final.log.gz](validation/related-final.log.gz) |
| `npm run prompts:check` | **93 通过** | [prompts-final.log.gz](validation/prompts-final.log.gz) |
| 新增双端 Chromium | **14 通过，0 失败，0 跳过** | [日志](validation/browser-final.log.gz)、[JSON](validation/browser-final.json.gz) |
| 既有手机定向回归 | **4 通过，0 失败，0 跳过** | [日志](validation/browser-existing-mobile.log.gz)、[JSON](validation/browser-existing-mobile.json.gz) |
| 既有桌面定向回归 | **2 通过，0 失败，0 跳过** | [日志](validation/browser-existing-desktop.log.gz)、[JSON](validation/browser-existing-desktop.json.gz) |
| 补充截图复跑 both 场景 | 双端 **2 通过**，与上述 14 项重叠 | [日志](validation/browser-screenshots.log.gz)、[JSON](validation/browser-screenshots.json.gz) |
| `git diff --check` | 通过 | [空输出日志](validation/diff-check.log.gz) |

最终 Chromium 验证是 **20 个独立场景**（桌面 9、手机 11），另有 2 次相同场景截图复跑；不将重跑或不同检查中的同一单测重复累计。没有运行全量 E2E。构建只有 Vite 大于 500 kB 的 chunk 提示，没有构建错误，本轮未扩大为拆包优化。

所有模型传输使用本机 SSE Mock 或 Playwright Mock，新增场景逐项断言恰好一次请求。未调用真实付费模型，没有操作私人存档。

### Chromium 场景

新文件 `e2e/story-stream-reading.spec.ts` 的七种场景各在桌面 1440×1000 和 Pixel 7 手机执行一次：

1. `流式阅读 project：实时思考→清空→仅正文，原文统一且严格验收`。
2. `流式阅读 native：实时思考→清空→仅正文，原文统一且严格验收`。
3. `流式阅读 both：实时思考→清空→仅正文，原文统一且严格验收`。
4. `流式阅读 none：实时思考→清空→仅正文，原文统一且严格验收`。
5. `流式cancel：公开思考可读但不保存，错误原文可查看且脱敏`。
6. `流式network：公开思考可读但不保存，错误原文可查看且脱敏`。
7. `流式timeout：公开思考可读但不保存，错误原文可查看且脱敏`。

既有回归只定向运行以下六项，保留业务、权限、请求次数和存储不变性断言：

- 桌面 `workflow-feedback.spec.ts`：`PC 标签页：鼠标、Tab、方向键与 Home/End；候选明细和完整 JSON 需主动展开`。
- 桌面 `story-runtime.spec.ts`：`P6：完整文本与原生思考在统一原文查看，正文/存档隔离，刷新清除临时资料`。
- 手机 `workflow-feedback.spec.ts`：`手机非模态抽屉：两层导航、统一候选原文、诊断与只读绑定输入`。
- 手机 `mobile-batch2.spec.ts`：`新错误自动进入诊断日志，复制单条、清空、原文与规划保持主动查看`。
- 手机 `mobile-batch2.spec.ts`：`诊断纯浏览：不请求模型、不写正式状态或草稿；刷新不持久化临时响应`。
- 手机 `mobile-batch2.spec.ts`：`长响应、私有候选与规划：主动展开、凭证脱敏、全文可达和刷新清除`。

### 执行命令

使用独立 5356 端口，避免复用其他工作树的 Vite。以下命令均带明确测试文件范围：

```bash
node --version
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/story-stream-reading.test.tsx src/tests/story-stage.test.ts src/tests/thinking.test.ts src/tests/thinking-refinements.test.ts src/tests/story-diagnostics-runtime.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-stream-reading.spec.ts --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-batch2.spec.ts e2e/workflow-feedback.spec.ts --project mobile --grep '新错误自动进入诊断日志|诊断纯浏览|长响应、私有候选与规划|手机非模态抽屉' --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/workflow-feedback.spec.ts e2e/story-runtime.spec.ts --project desktop --grep 'PC 标签页：|P6：完整文本与原生思考在统一原文查看' --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-stream-reading.spec.ts --grep '流式阅读 both：' --config playwright.story-reading.config.ts
git diff --check
```

执行时 npm cache 指向可写的 `/workspace/creation-fullscreen-evidence/npm-cache`，Playwright `STORY_READING_RESULT` 指向独立证据目录；仅改变文件输出路径，不替代依赖或运行器。旧测试产生的历史报告图片已从备份还原，没有覆盖此前批次验收材料。

### 失败与修复记录

所有初次日志均保留，不以最终绿色成绩替代失败记录：

- [related-initial](validation/related-initial.log.gz)：144 通过 / 1 失败。删除旧独立面板后，静态防预算回归测试仍读旧路径；改为检查新的统一面板，禁止模式断言原样保留。
- [new-unit-initial](validation/new-unit-initial.log.gz)：16 通过 / 2 失败。完整 `<正文>` 恰好到达时被误当成尚未完成前缀，已修正显示解析器；另一项误期望 `network`，改为核对原有实际 `stream_interrupted`，不改生产错误规则。
- [lint-initial](validation/lint-initial.log.gz)：两个新增测试中的未使用变量，已清理。
- [check](validation/check.log.gz)：3554 通过 / 1 失败。新增自动链测试错误地在同次草稿中修改执行开关，被 Repository 正确拒绝；改为创建隔离草稿时就指定开关，不改存储保护。
- [browser-initial](validation/browser-initial.log.gz)：7 通过 / 5 失败 / 2 中断，排查到相同的手机旧导航误用后停止重复等待。
- [browser-navigation-attempt](validation/browser-navigation-attempt.log.gz)：6 通过 / 8 失败。手机生成按钮实际位于「回合操作」；桌面测试设定 1 秒超时与同期工程检查争抢时间。UI 超时夹具改为 3 秒，仍真实等待超时、不增加重试；单测保留 1 秒超时验证。
- [browser-mobile-overlay-attempt](validation/browser-mobile-overlay-attempt.log.gz)：7 通过 / 7 失败。生成按钮被打开的工作流详情遮住，测试改为先正常收起详情。
- [browser-tools-menu-attempt](validation/browser-tools-menu-attempt.log.gz)：8 通过 / 6 失败。生成后仍展开的「回合操作」遮住跟随／工作流入口，测试改为正常收起菜单，再点击入口，没有 force-click、跳过或放宽断言。

以上问题已在最终结果中全部关闭，无剩余失败。没有发现需要修改领域逻辑的异常。

## 真实 React 截图

均由正式 React 页面、真实 Chromium 和本机 Mock 流式响应拍摄。手机截图保留设备原始像素比例。

| 状态 | 桌面 | 手机 |
| --- | --- | --- |
| 两种实际思考来源 | [思考分区](screenshots/desktop-thinking-sources.png) | [思考分区](screenshots/mobile-thinking-sources.png) |
| 长思考自动跟随 | [长思考](screenshots/desktop-thinking.png) | [长思考](screenshots/mobile-thinking.png) |
| 收到正文开标签，思考清空 | [空正文边界](screenshots/desktop-body-boundary.png) | [空正文边界](screenshots/mobile-body-boundary.png) |
| 仅小说正文及跟随阅读 | [正文](screenshots/desktop-body-reading.png) | [正文](screenshots/mobile-body-reading.png) |
| 完整原文，保留项目标签 | [原文顶部](screenshots/desktop-unified-raw.png) | [原文顶部](screenshots/mobile-unified-raw.png) |
| 同一原文视图中的独立原生思考 | [原文下部与来源](screenshots/desktop-unified-raw-native.png) | [原文下部与来源](screenshots/mobile-unified-raw-native.png) |
| 中断后的临时脱敏原文 | [中断](screenshots/desktop-interrupted-raw.png) | [中断](screenshots/mobile-interrupted-raw.png) |

## 修改文件

生产代码（16 个，包括删除旧组件）：

- `src/services/ai/client.ts`、`responseContent.ts`、`runtime.ts`、`stageResponses.ts`：只读原文／独立原生字段观察、临时存储和流式脱敏。
- `src/workflows/storyStream.ts`、`storyStage.ts`、`turnCoordinator.ts`：显示投影与进度传递；不改变最终验收及执行语义。
- `src/ui/game/StoryStreamReading.tsx`、`GameScreen.tsx`、`useStoryGeneration.ts`、`useTurnGeneration.ts`、`city-night.css`：阅读区切换、节流与跟随。
- `src/ui/game/StageResponsesPanel.tsx`、`WorkflowPanel.tsx`、`MobileDiagnostics.tsx`；删除 `StoryInspectionPanel.tsx`：统一原文及三个 Story 页签。

测试及执行配置（8 个）：

- `src/tests/story-stream-reading.test.tsx`、`thinking-refinements.test.ts`。
- `e2e/story-stream-reading.spec.ts`、`helpers/gameLayout.ts`、`mobile-batch2.spec.ts`、`story-runtime.spec.ts`、`workflow-feedback.spec.ts`。
- `playwright.story-reading.config.ts`（独立端口及双端配置）。

另有本报告、14 张截图和 `validation/` 原始证据。JSON 报告仅将截图的重复 base64 改为同目录截图引用，结果和断言元数据保留；原始 JSON 哈希见 [JSON_SOURCES.txt](validation/JSON_SOURCES.txt)。标准输出日志未经改写。压缩日志可用 `gzip -dc 文件名.log.gz` 查看；[SHA256SUMS.txt](validation/SHA256SUMS.txt) 校验压缩文件及保护核对材料。

保持 Draft，未合并、未部署、未发布，等待正式复审与视觉确认。
