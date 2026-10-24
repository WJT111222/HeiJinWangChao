# M5-P6：Thinking、格式确认与原创叙事规划

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
