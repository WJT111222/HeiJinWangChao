# M5-P6：Thinking、格式确认与原创叙事规划

> 前半部分保留初版交付记录（`0bb9aa0`）。最新产品规则及本轮验证见文末“最终针对性完善”；新渠道默认值、原生自动启用与输出预算说明以该节为准。

## 开发前勘查

- 基线：远端 main@41a1c23df114b3d411173ec2a3c640db4b36a3cf（已合并 PR #22）。开始工作区干净；独立分支 codex/m5-p6-thinking-planning，不修改 main。
- 复用 Manifest/Loader/Composer、三协议 AiClient、RequestSnapshot/CredentialVault、StoryStage/TurnCoordinator、StageGuard、CAS 和回合事务。正式 GameState/TurnDraft/Story Schema 不需要改变，不增加模型调用阶段或玩家设置。
- 原 parseStory 明确拒绝 thinking，StoryStream 仅接受正文开头；原客户端丢弃 Gemini thought/Anthropic thinking，未提取 OpenAI reasoning 字段；必须在这些边界局部适配。
- 原 cotMode=off 为新渠道默认；confirmation 仅对列在 cotModels 中、非 DeepSeek/GLM 的 OpenAI 模型生效，Prefix 跳过。新渠道默认完整确认历史，旧字段和旧 off 配置保留；cotModels 不再决定能力。不使用模型白名单，不将格式确认视为原生 Thinking 能力声明。
- 消息使用 system → user 数据 → assistant 完整格式确认 → user 执行请求。三协议都以 user 收尾，不依赖尾部预填充或 Prefix 扩展；旧 prefix 配置降级为普通完整历史并诊断，不追加付费兼容重试。
- 原生内容只能来自供应商公开响应字段：OpenAI-compatible reasoning_content/reasoning/reasoning_text、Gemini thought=true 的文本 part、Anthropic thinking/thinking_delta。签名与 redacted_thinking 不作为可读推理。接口未声明具体模型能力时保留服务端默认，不盲目发送 thinking/reasoning_effort/disable_thinking 或探测请求；无原生内容正常运行，不能声称读取隐藏推理。
- 现有 timeoutSeconds 是整次请求的硬超时，没有正文空增量的 idle 超时。保留硬上限；原生增量作为活动单独报告，不能因尚无正文误报网络闲置，也不无限延长玩家超时。
- 当前 maxOutputTokens 默认4096，用户可自行调整，程序不擅自提高。规划、正文、摘要与原生思考可能共享供应商预算，需给出预算诊断和明确长度截断错误，不删减审定步骤、不按文学内容验收。
- 项目规划与公开原生内容仅用于当前页面内存中的临时查看，默认折叠；不进入 Story、草稿、journal、记忆、变量/世界输入或证据。刷新清除查看内容，已保存正文和草稿继续按原机制恢复。
- 正式旧设计中的强制灾难开局与本次产品决定冲突，以本次指令为准，仅调整有关开局/输出提示词；不改正式设计原文、世界书、NSFW 或无关模板。

## 参考研究

只读研究 ypq123456789/MoRanJiangHu 的 mainStoryRequest、openingStoryWorkflow、thinkingContext、promptRuntime、chatCompletionClient、storyResponseParser、defaults 与 TurnItem。借鉴原生/文本分流、有效流式活动、完整 assistant 历史及 user 收尾，未复制其业务代码、修仙规划、模型白名单、预设导入或专属设置。文件来源校验记录在 sources.lock。

## P6-A～F 实施结果

| 模块 | 实现 |
| --- | --- |
| P6-A | planning.opening，prompts/planning/opening.md，完整附录A，Step 0–8 / 27个方向；仅opening/story，固定350。 |
| P6-B | planning.regular，prompts/planning/regular.md，完整附录B，Step 0–14 / 45个方向；仅regular/story，固定350。 |
| P6-C | 三协议公开原生内容独立接收，流/非流式与混合增量兼容；无原生输出正常成功。 |
| P6-D | 原创完整assistant格式确认历史，所有协议以user收尾。无模型名单，无Prefix依赖，无收费探测/兼容重试。 |
| P6-E | thinking→正文→短期记忆→变量规划→可选行动选项严格结构；临时规划/原生与Story永久隔离，流式只读正文，截断拒绝。 |
| P6-F | 新增48项单元/集成和2个浏览器场景（桌面/移动各执行，共4项）；旧934项及148项浏览器执行保留。 |

附录两份原文逐段保留，只规范文件末尾换行。来源锁记录原用户附件SHA-256、两份资源hash及参考仓库commit ed7040a34180d058a580d6d7339bd7432c27ae58和八份参考文件hash。未把任务说明或附录外的审核文档注入运行时，也未搬运上游伪装“思考已结束”的文字或任何业务代码。

## 组装顺序与配置兼容

正文固定身份0 → 世界书10/20 → 共享30–70 → 核心叙事80–82 → 写作210–251 → 唯一阶段主模板300 → 当前模式唯一planning模块350 → 输出协议406/409 → user GAME_CONTEXT → 可选assistant确认900 → user执行请求。规划模块不可移动、不可关闭，变量/世界/记忆不会选择它。新类别仅扩展提示词注册元数据，不扩展正式存档。

新渠道cotMode默认confirmation；原off值继续读取和生效，只跳过兼容历史，不关闭项目规划。cotModels原字段与存量内容继续严格读取，但不参与能力判断；界面不再维护名单。旧prefix值映射完整历史并提供COT_PREFIX_FALLBACK_COMPLETE_HISTORY诊断，不向任何端点发送prefix字段，也不进行失败后的额外请求。手动传入尾部assistant且允许确认时，协议层追加正常user执行请求；不允许的尾部仍拒绝。真实Composer本身已经以user收尾，协议层不会重复注入。

三协议都保留原模型路由、请求快照、密钥、温度/输出上限兼容配置，不添加Thinking开关或支持名单。原生Thinking的提取与是否主动启用具体模型参数分开：现有配置无法可靠证明任意model ID支持某个专用参数，所以保留服务端默认；不强发thinking、thinkingConfig、reasoning_effort或disable_thinking。默认已输出的公开内容可直接使用；若模型服务默认关闭且需要专用启用参数，本轮不猜测开启，可能只有项目规划。不能将此报告为所有模型原生Thinking已经开启。

## 解析、展示与隔离

parseStoryEnvelope只验证标签、顺序、唯一、非空规划、JSON和原有正文最低长度等结构，parseStory仍仅返回原StorySchema。没有9步/15步内容审判器，不规定完成每一步才准许剧情通过。think/judge或嵌套顶层标签不能伪装进正文；纯自然语言内容真实性仍不能由程序关键词保证。

StoryStream作为临时投影按任意delta及UTF-8边界处理规划开闭标签，只有在合法规划闭合后才开始显示正文，遇到后续尖括号边界停止预览，完整输出仍须最终解析。规划不计最低字数，原生内容从不加入content解析。只有规划、缺正文、未闭合JSON或网络未完整结束均不能保存；失败Roll、取消、迟到响应继续保留已有合法正文。

临时查看位于现有输入区，外层默认折叠且展开前不把私有文本渲染进DOM；项目规划与公开原生内容分别查看。storyInspections是内存最多4个请求的受客户端输出大小约束的环形记录，按saveId、turnId、正式revision和正文版本匹配；同回合新尝试替换旧查看记录，失败标为未验收，旧回包不能覆盖新记录。对当前已知凭证做脱敏。刷新、页面重载、clear或淘汰清除；不写localStorage/sessionStorage/IndexedDB，不将这些内容并入Story、TurnDraft、journal、MEMORY_CONTEXT、变量/世界输入或事实来源。刷新后只恢复既有合法草稿，临时规划不承诺跨刷新恢复，界面如实说明。

新增调试数据是请求局部返回/内存，不增加正式Schema或迁移。旧已保存正文无thinking仍可读、可继续补算/提交；新AI响应缺thinking才会被拒绝。没有改原子存储、领域命令、回执和三阶段状态机。正常正文变量规划本身仍按原Schema送下游，与项目thinking文本是不同资料。

## 原生协议、活动、用量和截断

- OpenAI-compatible分别读取message/delta的reasoning_content、reasoning、reasoning_text，别名仅取真实非空字符串；同一帧含reasoning和content时两者都保留。
- Gemini只把thought=true的text part列为公开原生内容，其余text part继续正文；finishReason=MAX_TOKENS明确失败。
- Anthropic读取thinking块、content_block_start及thinking_delta；text块首段和text_delta仍独立正文，签名及redacted_thinking不能读取或混入。max_tokens明确失败。
- length/MAX_TOKENS/max_tokens统一安全错误output_limit，不接受“正文已有但结构化尾部截断”。供应商即使错误结束也保留已提供usage，未知仍未知；原生计数只取实际reasoning_tokens或thoughtsTokenCount，不推算真实费用、不重复叠加total。
- onActivity对有效reasoning/content分别报告。没有新增“无正文即闲置”的超时；timeoutSeconds仍是整次硬上限，reasoning持续活动不无限延长。纯原生输出结束但无可解析正文仍失败。
- storyBudget是粗略规模提示：正文按现有Unicode启发式估计，再加开局1800/普通3000规划及600结构余量；不是精准tokenizer，也未假装能预测原生消耗。4096对15步+1500字符可能不足，UI主动查看时提示；不自动提高既有预算、不删审定步骤。长度错误明确提示玩家检查上限并手动决定，不自动为预算错误重发。实际供应商共享预算方式、模型最大窗口和CORS差异仍须真实试玩。

## 测试与开发中发现

- 初次提示词检查暴露旧“禁止thinking/只有阶段主模板不同/原两篇正文只换身份”的断言与新批准协议冲突，已保留原用例并更新结构与来源期望。
- 初次全量check为976通过、1失败：PromptInspector模式差异仍只列阶段模板，未列planning；已补入两份新模块并继续检查NSFW及七设置不变。不是删除测试换绿。
- 第一轮完整Chromium为150通过、2失败：旧拆分流夹具从单独的“<正”开头，批量适配未识别这个拆分形式，缺少规划被新解析器正确拒绝；在原分片前补合法规划块，保留所有流式/资料面板/刷新断言，不放宽解析器，然后重新执行完整套件。
- 原有合法HTTP Mock只在响应前补项目规划块；原非法/取消/恢复/原子性断言继续执行。旧结构化Story夹具不用添加thinking，验证存档读取与新响应解析不是同一契约。
- 新48项覆盖精确9/15步资源及27/45方向、阶段模式隔离、三协议流/非流/别名/混合/缺失原生、有效活动和硬超时、原生usage、结构缺失/重复/嵌套/截断、任意流切点、真实StoryStage保存与下游隔离、凭证脱敏、失败Roll保留旧档及预算不自动变化。
- 新2场景在桌面/移动执行：规划/原生默认不在DOM、主动查看脱敏/刷新清除；长度截断保留旧正文与正确错误提示、无原生重试正常成功。原完整opening/regular三阶段、连续回合、CAS、StageGuard、幂等、NPC知识、事件分层、M5记忆及旧存档测试都继续执行。
- 全部模型Mock，没有真实付费API调用。通过代表工程协议和隔离测试，不代表真实模型质量或所有供应商已验证。

| 命令 | 结果 |
| --- | --- |
| npm run prompts:check | 82/82通过，属于全量测试子集 |
| npm run check | 982/982，ESLint/TypeScript/Vite通过 |
| Chromium针对P6场景 | 4/4通过，14.5秒 |
| Chromium旧分片夹具修复验证 | 2/2通过，14.5秒；保留原全部断言 |
| CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e | 152/152通过，桌面/移动完整 Chromium，8.3分钟 |
| git diff --check | 通过，交付前复核 |

构建只有既有主bundle超过500kB的非阻断提示（现505.71kB，gzip159.64kB）；本轮不以此扩大打包重构。

## 真实试玩关注与剩余限制

1. 不承诺读取私有隐藏推理；没有可靠模型能力证据时不主动开启专用原生参数。需要开启才能返回公开内容的服务可能不返回原生资料，但项目规划照常要求。未进行供应商实测。
2. 通用完整assistant历史比尾部预填充适用面广，但个别中转可能禁止assistant历史或忽略格式指引；遇到400安全失败，不偷偷改体重发或承诺Prefix兼容全覆盖。
3. 9/15步生成质量、是否过度占用预算、对NPC与因果塑造的实际改善需要长期试玩。默认4096上限没有被提高，用户可能需自行调整预算；程序不会删步骤降低要求。
4. 结构验证不能识别任意自然语言把规划/秘密复述为正文或摘要的语义泄漏。保留原知识提示词与事实校验，未引入新审判阶段；源码保证独立字段不被自动混用。
5. 规划/原生不永久留档，刷新后无法查看之前的临时文本；合法正文、记忆与草稿不受影响。取消/失败后的临时片段带未验收标识，不能用于正式提交。
6. 不开发外部预设导入、新联系人UI、新AI阶段或M6。GameState、领域命令、世界书、NSFW、七项写作设置均未修改。

## 文件清单


本次49个文件（其中多数原测试仅适配新响应前缀，保留原断言）：

- `M5-P6-DEVELOPMENT.md`
- `e2e/continuous-turns.spec.ts`
- `e2e/memory-maintenance.spec.ts`
- `e2e/memory.spec.ts`
- `e2e/npc-memory.spec.ts`
- `e2e/prompt-inspector.spec.ts`
- `e2e/story-runtime.spec.ts`
- `e2e/time-preflight.spec.ts`
- `e2e/turn-coordinator.spec.ts`
- `prompts/compatibility/cot_format_ack.md`
- `prompts/docs/ASSEMBLY.md`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/planning/opening.md`
- `prompts/planning/regular.md`
- `prompts/shared/06_story_output.md`
- `prompts/sources.lock.json`
- `prompts/stages/opening/story.md`
- `prompts/stages/regular/story.md`
- `src/app/styles.css`
- `src/prompts/composer.ts`
- `src/prompts/manifest.ts`
- `src/prompts/selection.ts`
- `src/prompts/statistics.ts`
- `src/services/ai/client.ts`
- `src/services/ai/configuration.ts`
- `src/services/ai/errors.ts`
- `src/services/ai/inspection.ts`
- `src/services/ai/protocols.ts`
- `src/services/ai/runtime.ts`
- `src/services/ai/snapshot.ts`
- `src/services/ai/storyInspection.ts`
- `src/services/validation/aiOutputs.ts`
- `src/tests/ai-client.test.ts`
- `src/tests/prompt-inspector.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/story-stage.test.ts`
- `src/tests/summary.test.ts`
- `src/tests/thinking.test.ts`
- `src/tests/time-runtime.test.ts`
- `src/tests/turn-coordinator.test.ts`
- `src/ui/game/GameScreen.tsx`
- `src/ui/game/StoryInspectionPanel.tsx`
- `src/ui/settings/AiConnections.tsx`
- `src/ui/settings/ContextInspection.tsx`
- `src/ui/settings/PromptInspector.tsx`
- `src/workflows/storyStage.ts`
- `src/workflows/storyStream.ts`


## 最终针对性完善（2026-10-24，北京时间）

本轮在原分支 `codex/m5-p6-thinking-planning`、原 Draft PR #23 上继续；开始核对远端和本地均为 `0bb9aa0fe1077e6b49a6243157708d9e9bd36fa8`，工作区干净。只处理输出档位、原生自动启用、移除输出需求预测和每请求完整输入统计，不重做 P6。

### 输出档位与预算原则

- 使用既有 `parameters.maxOutputTokens`，提供 4K/4096、8K/8192、16K/16384、自定义；自定义仍由原 Zod Schema 校验 1～1,000,000 的整数。
- 仅 `newChannel()` 的新渠道默认值改为 8192。旧渠道的 4096、8192、16384、自定义值及未配置值原样读取；没有配置迁移或加载时补写。切换渠道独立显示和保存，切换至自定义本身不改数值，非法输入不覆盖已保存配置。
- 完整删除 `storyBudget`、StoryInspection 的 budget 字段、StoryStage 的预算预测调用及临时面板预测提示；不再估计规划/最低字数需要多少输出 Token。保留通用输入估算器和供应商实际 usage。
- 不根据输入规模或输出需求阻止请求，不自动调大上限、不增加弹窗、不自动补发预算不足的请求。已有 length/MAX_TOKENS/max_tokens 截断拒绝、结构完整性检查和旧草稿保护继续有效。

### 原生 Thinking 的自动启用与兼容矩阵

自动选择依据是**原生协议 + 官方已核实型号契约，或当前渠道 Models 返回的明确官方能力元数据**，不是端点域名、模糊关键词或玩家填写的名单。OpenAI-compatible 的模型即使名为 Claude/Gemini/DeepSeek/GLM，也不会因此收到非标准启用参数。

| 原生协议 / 已核实契约 | 本轮请求行为 |
| --- | --- |
| Gemini 2.5 Pro / Flash | `thinkingConfig.includeThoughts=true`，保留模型默认思考机制，不指定固定预算。 |
| Gemini 2.5 Flash-Lite | `includeThoughts=true`、`thinkingBudget=-1`，启用其默认关闭的动态思考，不更改 maxOutputTokens。 |
| Gemini 3 Pro/Flash、3.1 Pro/Flash-Lite（包括对应 preview ID），3.5 Flash-Lite、3.6/3.8 Flash、4 Argon | 请求公开摘要，保留各模型原生默认预算/level，不向新系列套用 2.5 的预算字段。 |
| Claude Opus 4.6/4.7/4.8、Sonnet 4.6；已核实 5/5.5 Opus/Sonnet/Haiku、5/5.1 Fable/Mythos 和 Mythos preview | `thinking={type:adaptive,display:summarized}`，请求公开摘要，省略不兼容的 temperature。 |
| Claude Opus/Sonnet/Haiku 4.5、Opus 4.1、Opus/Sonnet 4、3.7 Sonnet（对应日期 ID） | `thinking={type:enabled,budget_tokens:1024}`，且必须小于实际发送的 max_tokens；上限不超过 1024 时采用普通请求，不提高玩家预算、不阻止生成。 |
| 官方格式 Models 能力声明 / 原生协议中转别名 | Gemini 读取 `thinking` 与可用的 `baseModelId`；Anthropic 读取 `capabilities.thinking.supported/types`。服务明确不支持优先于型号契约；未知别名只有在明确能力声明后启用。 |
| 未知、旧版或无法可靠启用的型号；OpenAI-compatible | 保留兼容请求。继续被动读取 OpenAI 的 reasoning_content/reasoning/reasoning_text、Gemini thought 文本、Anthropic thinking 增量；没有公开原生内容仍可正常生成。 |

已有的手动 Models 查询可以提供能力声明；本轮不为探测增加任何网络调用或付费调用。能力缓存仅在本页内存，按渠道 ID、协议、URL、模型隔离，最多 500 项；请求快照冻结其能力，查询取消后的迟到回包不能更新后续请求的能力。新渠道及原生中转遵循相同规则，没有新增开关或持久化名单。

如果服务返回 JSON 400/422 并明确指出 thinking 参数不支持，本次请求安全失败，**不自动修改请求重发**；仅缓存该渠道型号的拒绝，下一次玩家手动发起的新请求采用普通兼容路径。普通 400 不猜成 thinking 失败；取消请求的迟到错误不改变新请求能力。未知错误保持原错误处理，不能保证不合规中转的所有错误文本均可自动识别。页面重载会清除能力缓存，后续新的明确 Models 声明也可更新能力。

这不是读取模型隐藏内部思维。只显示服务公开返回的摘要/推理字段，项目 9/15 步规划仍独立启用。没有新增 AI 阶段、付费探测、额外玩家设置或暗中兼容重试。

### 完整输入统计与供应商用量

- `AiClient.generate` 在 `wireRequest` 完成**最终消息改写**之后、transport 之前建立真实 RequestInspection。统计从最终 payload 还原消息，包含系统提示词、世界书、阶段/规划模块、上下文数据、角色/NPC/记忆、玩家输入、assistant 确认和协议层追加的 user 尾消息；不只计算输入框，也不另组一份假请求。
- 输入规模复用原 `contextStatistics/estimateTokens` Unicode 启发式，脱敏前计算数值；界面明确标注“估算输入 Token”。该算法不含厂商消息包装/隐藏控制 Token，不使用模型精确 tokenizer，误差依模型、语言和服务端处理而异，不能用作账单或上下文容量保证。无论估算多少都不据此阻断请求。
- 上限读取实际序列化请求的 max_tokens/max_completion_tokens/generationConfig.maxOutputTokens；未发送时标为服务默认，不把配置中已被兼容层跳过的数值冒充已发送参数。
- 新的简洁 `RequestUsage` 位于生成操作附近及记忆维护控制区；按存档和阶段过滤，分别显示最近各请求的模型、状态、估算输入、实际发送上限和供应商 usage，不合并三阶段。原 AI 上下文查看器继续提供完整实际请求记录。
- 供应商未提供的实际输入/输出/总量/思考计数显示“未提供”。Anthropic 完整输入按其官方 usage 语义汇总 input_tokens（未缓存部分）+ cache_creation_input_tokens + cache_read_input_tokens；缺失或非法基础计数不臆测。其 output_tokens_details.thinking_tokens 仅在提供时读取，不与已含思考的 output_tokens 重复相加。没有 total 就保持未知，不以输入加输出伪造供应商总量或费用。
- 简洁面板只渲染脱敏模型和数值，不渲染 NPC 身份、私有记忆或请求正文。真实请求记录沿用最多 12 条的页面内存容器，不写正式存档/普通日志；项目规划与原生查看仍独立折叠、最多 4 次临时记录、刷新清除。

### 官方协议核对

核对日期：2026-10-24（北京时间）。型号契约是代码内的已核实协议适配规则，不是玩家维护名单；未列入的新版本不外推能力，可由明确的 Models 元数据确认。

- [Gemini Thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)：公开摘要、默认启用差异与动态预算。
- [Gemini Models](https://ai.google.dev/api/models)：thinking 与 baseModelId。
- [Claude Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) / [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)：adaptive、summarized、手动最小预算和 temperature 限制。
- [Claude Models](https://platform.claude.com/docs/en/api/models)：能力声明。
- [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) / [Thinking usage](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)：缓存输入、公开思考用量与不重复计数。
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)：本轮未将现有 Chat Completions 客户端重构成 Responses，也不对未知中转猜测专用参数。

### 本轮测试与保护证据

新增 `thinking-refinements.test.ts` 共 37 项，覆盖档位底层兼容、无预算阻断、原生/中转协议参数、Models 别名与明确拒绝、快照冻结、取消迟到、真实 wire 完整输入、四类独立请求及供应商缓存/思考用量。旧 `thinking.test.ts` 保留原截断、分流、隔离等断言，仅同步移除已取消的预测要求；原新渠道默认断言从 4096 改为 8192，旧值兼容另有测试。

新增 3 个浏览器场景，在桌面/移动各执行，共 6 项：4K/8K/16K/自定义与旧值恢复、范围校验与渠道隔离、完整三阶段的每请求输入及真实 usage。既有记忆维护场景补充输入与实际用量断言，没有新增付费调用。初次定向浏览器测试发现新增控件缺少精确的可访问名称，已补 aria-label；新增测试对旧“当前渠道”选择器改用语义 combobox 定位，保留原有结构与安全断言。定向重跑 6/6 通过。

| 最终命令 | 结果 |
| --- | --- |
| `npm run prompts:check` | 82/82 通过（全量测试子集）。 |
| `npm run check` | 1019/1019 通过；32 个测试文件，原 982 项 + 新增 37 项。ESLint、TypeScript 和 Vite 生产构建均通过。 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 158/158 通过；原 152 项 + 新增 6 项，完整桌面/移动 Chromium，9.0 分钟；`.last-run.json` 为 passed、无失败。 |
| `git diff --check` | 通过，应用代码与报告完成后最终复核。 |

构建保留既有大于 500kB chunk 的非阻断提示（主包 509.81kB，gzip 161.06kB）；没有为本轮引入打包重构。

所有模型调用均为 Mock，不曾使用真实付费 API。通过表示适配、UI、事务和隔离回归成立，不代表真实供应商/第三方中转已实测或生成质量已验证。中转可能隐藏摘要、忽略 Models 能力字段或拒绝合法原生参数；未知能力保留普通路径，明确拒绝不暗中重发。没有精确 tokenizer，统计不是费用报价。

本轮 `git diff 0bb9aa0` 的 prompts/、src/domain/、src/services/storage/、TurnCoordinator 与七项写作设置模型均无改动，保留两份审定规划原文、六套主模板、NSFW、世界书、GameState/TurnDraft、领域命令、正式事务与 M5-P5。未新增 M6、部署、发布或合并。

### 本轮文件清单（相对 0bb9aa0）

新增 4 个文件：

- `src/services/ai/thinking.ts`：协议能力、官方已核实契约、页面能力缓存与原生请求参数。
- `src/ui/settings/OutputTokenLimit.tsx`：四档输出上限控件。
- `src/ui/game/RequestUsage.tsx`：按请求显示完整输入规模和实际用量。
- `src/tests/thinking-refinements.test.ts`：37 项针对性回归。

修改 19 个文件：

- `src/services/ai/configuration.ts`：仅新渠道默认 8K。
- `src/services/ai/snapshot.ts`：冻结本请求的原生能力。
- `src/services/ai/protocols.ts`：差异化原生参数、兼容温度及实际 usage。
- `src/services/ai/client.ts`：复用已有 Models 元数据、明确拒绝缓存、不额外重发。
- `src/services/ai/inspection.ts`：记录实际发送的输出上限。
- `src/services/ai/storyInspection.ts`、`src/workflows/storyStage.ts`：删除输出需求预测。
- `src/ui/settings/AiConnections.tsx`：接入档位、更新原生能力说明。
- `src/ui/settings/ContextInspection.tsx`：明确输入估算标签。
- `src/ui/game/StoryInspectionPanel.tsx`：删除预算预测展示。
- `src/ui/game/GameScreen.tsx`、`src/ui/panels/MemoryMaintenanceControls.tsx`：展示独立请求用量。
- `src/app/styles.css`：请求统计紧凑滚动及窄屏换行。
- `src/tests/ai-client.test.ts`、`src/tests/thinking.test.ts`：适配新默认值及已取消的预测，保留原用例。
- `e2e/ai-settings.spec.ts`、`e2e/turn-coordinator.spec.ts`：3 个新增场景，双视口 6 次执行。
- `e2e/memory-maintenance.spec.ts`：原记忆请求增加估算/实际数值验证。
- `M5-P6-DEVELOPMENT.md`：本轮决策、官方依据、验证与限制。
