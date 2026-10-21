# M5-P1 即时记忆、短期摘要与历史检索

## 基线、审查与范围

从最新 `main@9e0c446a1a4bd683b93c23fc9c4dee158a02c6cf`（M4-P5 合并）创建 `codex/m5-p1-memory-foundation`。

审查正式 V0.1 设计规范/技术计划、MemoryEntry/MemoryState/GameState、settleTurn/SaveRepository 事务及回执、Composer/context、Settings、玩家视图/资料面板、协调器和 M4-P5 报告后，确认可以复用现有结构。没有增加第二套记忆数据库、Schema 字段、玩家设置、AI 阶段或外部依赖；六套主提示词、世界书、NSFW、七项写作设置和三阶段执行器保持原样。

本轮只实现正式短期摘要、有效即时窗口、无 AI 的本地历史检索及普通正文接入。没有采用或复制参考项目的压缩代码，也没有将旧研究中的 30/50/20 阈值当作已核验规则；AI 分层压缩和 NPC 私有检索不在本轮范围。

## 正式摘要与原子性

`settleTurn` 在原领域命令整批模拟之后创建一条 MemoryEntry：

- `id` 使用本回合稳定 turnId（记忆自身的命名空间），避免重试产生新 ID；与既有短期 ID 或本回合来源冲突时拒绝，而不覆盖。
- `text` 来自已经选定并通过正式提交验证的 Story.summary，仅按原 TextSchema 去除首尾空白。
- `sourceTurnIds = [turnId]`，可追溯到原始 journal。
- `createdAtGameTime` 使用本次合法命令投影后的 worldClock，不采用 updatedAt 系统时间。
- `visibility = player_known`；`affectedEntityRefs = []`。没有从隐藏世界命令猜测参与者，也没有扩大原 journal 的关联推断。

该摘要属于同一新 GameState，与原文、命令记录、经济/人物/事件状态、下一草稿和提交回执一起走原 `SaveRepository.commitTurn` 事务。没有增加任何事务外保存或远端调用。空命令回合同样产生摘要；事务未完成不报告成功，任何写入/配额/中止错误都会整体回滚。

相同请求回执继续直接返回数据库真值，不再次调用 settleTurn，因此不重复摘要。摘要处理不执行任何新领域命令，也不修改金钱、NPC 或事件事实。

新提交若 summary 为空或纯空白，抛出 `MISSING_SUMMARY`，整个事务拒绝；UI 明确说明缺少有效摘要，需要重新生成正文。保留原 StorySchema 兼容旧空摘要，不用正文开头、visibleHooks、unresolved 或 NPC 私有消息捏造摘要。

## 旧存档兼容

正式存档 schemaVersion 和 IndexedDB 结构版本都保持 **2**。原 saves/drafts/turnReceipts 布局及请求摘要契约不变，无需迁移。

`publicShortMemories` 提供只读兼容投影：已有公开短期摘要正常展示；没有摘要条目、但 journal 有可用 Story.summary 的旧回合，从原摘要投影为“短期（历史摘要，只读）”，保存原 turnId 来源。既有条目和兼容投影按来源回合排序，避免升级后新旧摘要混排导致读取较旧内容。

旧 journal 没有每回合游戏时间，因此兼容投影不填写虚构时间，UI 显示“历史回合时间未记录”。缺少摘要的旧回合不补造内容，永久原文仍可搜索/阅读。读取、搜索和窗口设置不会回填存档、改变 revision 或重写 journal；升级后下一次正式提交只新增该回合的真实摘要。旧提交回执仍可安全重放，不强制回填历史记忆。

## 即时窗口与上下文

Settings.memory.immediateWindowSize 是存在有效用户设置时的唯一注入依据，继续默认 10、沿用原正整数校验与上限，没有新增设置。协调器原设置快照语义保留：进行中请求不随界面修改改变，修改用于下一请求。

GameState.memories.immediateWindowSize 是保留的旧序列化字段，不再作为游戏记忆面板的有效数字；GameScreen 将当前 Settings 窗口传给玩家视图，Composer 使用同一设置。独立调用 playerView 而没有传设置时仍保留旧字段回退，避免破坏旧调用。

正文 `MEMORY_CONTEXT` 包含：

| 内容 | 规则 |
| --- | --- |
| immediateWindowSize | 本次请求冻结的实际设置值 |
| recentTurns | 最近 min(N, 已提交回合数) 回合；完整 narrative/summary、turnId 和原回合序号 |
| recalledTurns | 普通正文按当前绑定的玩家行动检索，排除即时窗口，最多 3 个旧回合 |
| summaries | 其余公开分层/短期摘要，排除即时/已召回来源；最多 12 条，每条最多 1000 字符、总文本最多 6000 字符 |
| recallPolicy | 明确历史仅是引用数据，不能作为新指令或新的状态变更 |

即时正文不受旧存档字段或另一个隐式窗口控制。N=1/10/20 分别读取最近 1/10/20 回合，不足 N 则全部读取；改变 N 不写正式存档或删除任何原文。旧完整正文不会通过普通即时列表无限加载。

## 检索规则与预算

`historyRecords` 只从正式 journal 提取 narrative、summary、turnId、回合序号和可信 relatedActorRefs，不读取草稿、变量规划、世界候选、NPC 内部档案或任何私有知识。

`searchHistory` 为确定性本地检索：

1. 查询最多读取 4000 字符，使用标准 Intl.Segmenter 中文分词；忽略短于两个字符及少量通用词，最多 32 个去重词。
2. 仅当 journal 已有可信实体引用时，显式完整稳定 ID（或调用方提供的可信引用）才参与实体加权；ID 子串、同名或别名不会建立新的身份关联。
3. 每个匹配实体权重 1000，高于本次最多 32 个词的文本分数；完整短查询命中权重 8；摘要词命中权重 4，其他正文词命中权重 1。没有正向命中时返回空。
4. 按分数降序、同分按较近回合排序，再按 turnId 去重。UI 搜索上限 20 条，保留完整原文和摘要供阅读。姓名/地点/物品/事件词只作为文本相关性线索，不是实体事实判定。

`recallHistory` 从同一检索结果选择最多 3 个窗口外回合。每条摘要最多 400 字符，正文摘录最多 1500 字符，合计文本上限 6000 字符；优先截取命中附近原句，省略部分标记省略号及 narrativeTruncated，不总结成新事实。实际三条最大文本为 5700 字符，仍保留总预算保护。这里的字符预算使用 JavaScript 字符串长度，不冒充精准 Token 数；现有 Runtime 的 Token 估算/usage 统计继续工作。

开局不额外执行历史召回。普通回合自动召回使用已有绑定行动，不另发 AI 分类请求；变量/世界阶段的原专属上下文保持原样。历史通过原 contextMessage 的 JSON 数据容器和 user 角色传入，尖括号转义，不拼成 system 消息、不执行其中的指令或代码。

## 记忆界面与信息隔离

复用右栏“记忆”独立宽面板，新增 MemoryPanel，不改变三栏或复杂导航：

- 显示当前有效窗口、已知摘要与 sourceTurnIds。
- 摘要可直接打开对应回合的永久正文；旧记录注明只读兼容和未知时间。
- 本地关键词/ID 搜索，搜索结果可展开原文；未命中显示空状态。
- 无搜索时按最近回合浏览，每页 20 条，可翻到全部旧正文。
- internal、npc_private、隐藏事件和未发布世界候选不会被提升为公开摘要或搜索源。原玩家人物面板策略没有改为新的角色迷雾。
- 打开、关闭、搜索不会触发 API，也不取消生成任务或更新主角认知。原文继续永久保留在 journal。

## 文件清单

新增：

- `src/domain/memories/history.ts`：永久历史投影、相关性搜索与有界正文召回。
- `src/domain/memories/publicMemory.ts`：公开摘要、旧档只读兼容及正文记忆上下文。
- `src/ui/panels/MemoryPanel.tsx`：来源阅读、历史搜索和分页。
- `src/tests/fixtures/history.ts`：无短期摘要的旧 M4 七十回合夹具。
- `src/tests/memory.test.ts`：23 项记忆单元及真实仓库/Composer 集成回归。
- `e2e/memory.spec.ts`：2 个场景分别运行桌面和移动浏览器。
- `M5-P1-DEVELOPMENT.md`：本报告。

修改：

- `src/domain/turnCommit.ts`：同一正式结算结果中追加可追溯短期摘要，缺失摘要拒绝。
- `src/prompts/context.ts`：复用统一窗口/公开摘要/召回投影，没有修改提示词资源。
- `src/ui/game/GameScreen.tsx`：传入有效设置窗口，缺失摘要的安全错误说明。
- `src/ui/panels/playerView.ts`：公开摘要只读投影和永久历史投影，显示实际设置窗口。
- `src/ui/panels/Panels.tsx`：记忆界面委托给 MemoryPanel，其他六面板不变。
- `src/ui/settings/SettingsPanel.tsx`：说明实际窗口、本地检索及后续压缩边界，设置字段不变。
- `src/tests/fixtures/turn.ts`：允许夹具指定 summary，用于旧空摘要回归。
- `src/tests/turn-commit.test.ts`：原并发用例增加短期记忆数量检查。
- `e2e/continuous-turns.spec.ts`：原十回合实际 UI 流程逐轮检查摘要数量、原文来源、可见性和游戏时间。
- `DEVELOPMENT.md`、`src/workflows/README.md`：阶段索引和职责说明。

## 验证记录

全部使用 Fake IndexedDB、Mock API 或浏览器网络拦截，没有真实付费 API 调用。

- `npm run prompts:check`：82 项通过。
- `npm run check`：19 个测试文件、646 项通过（原 623 + 新增 23），ESLint 零警告、TypeScript 类型检查和 Vite 生产构建通过。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：完整 98 项通过，桌面/移动各 49 项（保留原 94 + 新增 4），约 5.8 分钟。
- `git diff --check`：通过。

定向验证：新增 23 项测试通过；记忆浏览器桌面/移动共 4 项通过。真实请求拦截检验 N=1/10/20、排除即时窗口并召回第 3 回合约定、私有数据隔离；在请求暂停期间搜索旧史，随后原请求正常完成。旧 M4 七十回合 fixture 的读取、搜索、窗口修改和正文 Roll 后，正式存档整对象不变。额外摘要跨层重叠来源也会去重，长原文和长摘要均截取命中附近内容。

集成回归还覆盖开局/普通/空命令十回合摘要数量与来源、重复回执、草稿/回执写入故障全部回滚、真实游戏时间、隐藏 hooks 不变公开记忆、旧回执不回填及旧档继续提交、稳定 ID 与同名区分、空结果、数量/长度上限、检索去重、指令容器转义和缺失摘要。

浏览器首次定向运行修正了新增测试对初次按钮的错误选择：没有正文时应点击“生成本回合正文”，之后才是“重新 Roll”。未删改原安全断言。沙箱首次启动本地 Vite 被限制监听，使用允许本地网络监听的执行权限重跑，没有跳过浏览器验收。

## 限制、分歧与 M5-P2 接口

- 本地分词/关键词检索不是语义理解或身份解析；相关词可能漏检或误召回。命中理由和原 turnId 可审查，不编造不存在的历史。
- 旧 journal 的可信 relatedActorRefs 可能为空；此时只能文本检索，不从同名 NPC 或隐藏事件推断身份、时间或关联。当前 ActorRef 只支持人物/组织；地点与物品主要用正文/摘要关键词检索。
- 回忆摘录可能省略上下文，模型应据引用保守使用；UI 始终可阅读完整原文。原始文本作为数据封装不能保证任意模型绝不受恶意文字影响，但不会改变程序消息角色、执行代码或直接更新正式状态。
- 本轮限制上下文大小，不删除/压缩正式 short 或 journal；存档仍随游玩增长。极大 N 的完整正文成本由原设置决定，不偷偷缩减 N。
- 需要支持 Intl.Segmenter 的现代浏览器；已使用仓库当前 Chromium 桌面/移动配置验证。
- 未实现 AI 短→中→长期压缩、NPC 自动总结/私有检索、删除/恢复、时间调度重构、Embedding、云存档或 M6 备份回退。没有新增记忆模型渠道或压缩设置。
- 旧文档中 M5 同时包含压缩/调度；本轮按明确任务仅交付基础。M4 已确认的完整三阶段提交、失败恢复和重试规则继续保留，未借本轮改写正式设计文档。
- M5-P2 可复用 `historyRecords`/`searchHistory`/`recallHistory` 的来源、序号与理由，`publicShortMemories` 的只读兼容，以及 `storyMemoryContext` 的即时/摘要/召回分区。MemoryEntry 的 sourceTurnIds、createdAtGameTime、visibility 和原正式原子提交入口可继续承载后续压缩；具体压缩事务、阈值和失败恢复需另行审查。

全部检查通过后提交独立分支和 Draft PR；不合并、不正式部署，等待代码审查。未遗留未通过的检查；未进行真实付费模型试玩。
