# M5-P3：NPC 私有记忆总结与认知边界

## 基线、范围和审查结论

从实际最新 `main@9dbd45a`（PR #18 的 M5-P2 及 PR #19 文档更新已合并）创建 `codex/m5-p3-npc-memory`。保留主仓库 README 的现有免费策略及其他用户提交。本轮只新增记忆维护，不实现 NPC 独立正文、删除恢复、时间跳跃、DLC、角色迷雾或新模型渠道。

审查发现四类数据不能混同：

- `npc.memories`：普通/特殊 NPC 都有的原始个人记忆，包含稳定记忆 ID、知晓来源、世界时间和可见性。
- `special.longTermMemories`：特殊 NPC 的重要原始记忆，不是 AI 压缩输出；同样需要永久保留。
- `RecordNpcMemory`：当回合事实记录领域命令，原来 knowledgeKind 只存在于命令及文本前缀，本轮把已验证类型保存到新原始记忆，不新增命令种类。
- `memories.npcSummaries[npcId]`：本轮的私人归纳输出，不能作为另一份公开历史或 NPC 新获知信息。

正式设计将 NPC 总结阈值列为待实测参数，未给出不可变玩家规则。本轮按照任务建议集中采用超过20条未覆盖、来源有效的原始记忆才可维护，最早一批最多10条、至少2条，不新增阈值设置，也没有声称照搬参考项目业务代码。

## 来源模型与兼容性

### 可选严格字段

`NpcMemorySchema.knowledgeKind?: observed|reported|suspected`：新 RecordNpcMemory 从命令重建此字段，拒绝与命令不一致或与明确文本前缀冲突的类型。旧档缺少字段保持原样；仅已有 `[转述]`/`[推测]` 前缀可确定相应声明性质，其余归为运行时 unknown，不猜测亲历、不回写旧档。

NPC 总结专用 `NpcSummarySchema` 继承原 MemoryEntry，增加可选 `npcProvenance`，内部字段全部必填且严格：

- `npcId`、`identityKey`：对应唯一所属人物及稳定身份。
- `sourceMemoryIds`：本组实际原始记忆 ID，非空、无重复、最多10条。
- `knowledgeKind`：observed/reported/suspected/unknown。
- `sourceVisibility`：原始分组的 player_known/npc_private/internal。

该字段仅允许出现在 npcSummaries 的专用 Schema，不扩大普通公开 MemoryEntry 的任意字段。GameState 校验所属身份、实际原始来源、认知类型、可见性、回合来源并集、对象引用并集和最晚来源时间，拒绝总结跨行重复覆盖同一原始记忆。

没有新数据库、IDB版本或 GameState schemaVersion 迁移；schemaVersion仍为2。新字段可选，读取旧 v1/v2 不补造来源或时间；旧数据保留旧结构，原迁移链及提交回执不变。此兼容是新代码读取旧档；旧客户端不保证能识别新增字段，但原严格存储校验会拒绝覆盖不识别的数据。

### 与公开记忆不同的覆盖规则

来源以 `(npcId, identityKey, sourceMemoryIds)` 关联具体原始条目，不以 sourceTurnIds 判定已覆盖。一回合可以产生多条 NPC 记忆，NPC 也可能拥有没有 journal turnId 的历史记录；只要原始 ID、所属引用、knowledgeSource 和游戏时间真实可验证，就无需伪造 journal 回合或时间。

原始个人及特殊 NPC 长期记忆全部保留；保存总结只追加到所属 npcSummaries。后续批次排除已经有效覆盖的 sourceMemoryIds，新近原始记忆不在最早批次中。跨 NPC 原始 ID 重复、无所属依据和未来时间不用于凑阈值。

既有无 npcProvenance 的旧总结原样可读，但无法确定其覆盖哪些原始条目。为避免假造来源或重复收费，保守暂停该 NPC 的新付费归纳，且不把旧无来源总结升级成内部事实依据。它不影响存档读取或其他人物/公开记忆维护；自动补链或人工修复工具未在本轮开发。

## 认知与权限分组

一次只选择一名 NPC；内部世界真相不因存放在人物容器而成为人物知识，internal记录不参与NPC维护。其余输入按 `knowledgeKind + visibility` 分组，各组原始条目带原知晓来源、时间和来源 ID。模型必须每组恰好输出一条文本，不能合并不同认知性质或权限的组。unknown 保持来源未分类，不能宣称确定亲历。

输出严格 JSON：

```json
{"summaries":[{"groupId":"输入提供的分组ID","text":"此组的完整归纳"}],"unresolved":[],"contradictions":[]}
```

每个 groupId 与输入一一对应，不能缺失、重复或新增，全部正文合计最多4000字符；其他身份、来源、时间、引用、权限字段均拒绝。unresolved/contradictions 非空时失败。新总结保留原始各组时间顺序、来源差异及纠正过程；无法忠实整理重大矛盾时不假装成功。

程序重建每组 sourceMemoryIds、sourceTurnIds 并集、ActorRef 对象引用并集及最晚可信原始游戏时间，不使用系统日期。程序添加 `[亲历]`、`[转述]`、`[推测]` 或 `[来源未分类]` 标签。player_known 与 npc_private 输入产生 npc_private 总结。internal 记录保留原样，但不等同该NPC已获知，不能用于凑阈值、送入NPC维护模型或注入其认知，没有任何内部→私有或私有→公开的升级。

标签、分组和程序权限可以防止结构性认知升级，但不能证明自然语言归纳绝无幻觉、遗漏或错误修正。模型按提示词承担语义归纳，所有原始记录始终可追溯，不把 Schema 校验宣传成万能语义理解器。

## 内部使用与信息隔离

`npcKnowledgeContext` 按 ownerNpcId 构造所属人物的内部知识：最多10条有效总结和最近20条未覆盖原始记忆，并设16000字符预算。同一游戏时间内优先较晚原始记录，避免最新纠正被旧窗口挤出，不补造时间或序号。只读取player_known/npc_private的合法所属知识，不把internal后台资料变为人物认知。保留整条记录，不虚构切分文本；过预算不注入，原始数据仍在存档。未来记忆不进入当前认知。

变量阶段只提供在场人物的知识分区；动态世界只提供符合既有保护规则的场外人物知识分区。SAVE_STATE / OFFSCREEN_STATE 的 NPC 原始数组和 NPC 总结副本移出，避免与分区重复注入；与原始记忆完全重复的 knownInformation 不再重复作为另一条证据。独立知晓信息仍按原所属人物保存，不改写正式状态。

WorldSources 给总结登记专用 source ID、ownerNpcId 与“动机”类型，绝不把 AI 总结登记为 objective fact。总结来源仅可支持所属人物的 planned 任务或其个人目标计划，不能用来证明完成、到账、关系变化、更新健康/位置、创建公开事件或让另一 NPC 获知内容。即使 affectedEntityRefs 提到 B，来源权限仍属于 A。NPC 任务来源也保留 actor 的 ownerNpcId，防止通过任务再借用别人的私人计划。

额外复核并先用测试复现：既有 established 只表示客观成立，不能表示主角已知。现在公开记忆及事件可见字段的新增/变化还需来源可公开投影中的肯定事实（playerKnownText）；私人亲历不得直接提升为 player_known，也不能借已知事件的字段更新泄露私人进展。已有公开来源的正例继续允许，模型可将缺少公开依据的事项保留为私有/hidden或unresolved。

后续真实动作仍由既有世界/变量执行器、证据、权限、时间及正式回合事务单独验证。本轮维护本身不产生领域命令，不生成世界真值。候选 visibleHooks 继续保持内部状态，不作为记忆正文、公开日志或 journal 来源。

正文公开 MEMORY_CONTEXT、在场 publicNpc、普通记忆面板及历史检索继续使用既有公开投影，不读新私人总结，不因为 NPC 在场而公开私人经历。没有改变普通人物面板的既有显示策略或新增角色迷雾模式。

维护实际 payload 仍由原请求检查器记录于短暂会话内存，供内部测试验证；普通提示词管理界面对 NPC 维护请求只显示模块结构、模型及 Token 用量，不开放人物身份/私人请求正文。既有变量/世界的主动内部调试查看边界保留，普通玩家资料界面不会自动复制它们的内部上下文。

## 运行、费用与事务

复用 M5-P2 的 MemoryMaintenance：新增 npc 任务选项，仍使用同一 memory 模型路由、三协议 AiClient、CredentialVault、超时取消、凭证扫描/脱敏和请求快照。请求开始冻结配置/凭证，只发送指定 NPC 的本次分组，身份核对凭据留在本地，不提供整份 GameState、其他人物档案、对方秘密或旧完整总结。

复用输入16000字符/12000估算Token及完整请求20000字符/16000估算Token预算；输入过长只减少完整条目数量，不截断来源。无法安全形成至少2条批次则不调用模型。统计仍区分估算与供应商实际用量，没有模型回退、自动付费重试或额外分类请求。

同一 `heijin.memory:<saveId>` Web Lock 排斥公开/NPC维护及跨标签重复执行，不在事务中等待网络；不支持互斥的环境明确拒绝。每次手动操作至多一批一名 NPC，不连环调用。

生成后在单个 saves readwrite 事务中重读最新状态，核对存档身份、npcId/identityKey、原始条目完整指纹、未覆盖状态及全部重建字段，然后只追加私人总结，等待事务 oncomplete。新正式回合及其新 NPC 记忆可以并发追加，旧批次仍一致时合并最新状态；来源改动、身份替换或删除拒绝旧回包。

维护不提升 revision，不修改 journal、worldClock、updatedAt、经济、任务、NPC身份/原始记忆、主角状态、草稿或提交回执。写入失败/配额/abort整体回滚；取消和迟到不能写入。保存阶段不可中断，取消返回false，UI不宣称已经取消成功。

原“公开自动维护”偏好不授权 NPC 收费，Hook 即使收到 automatic+npc 也拒绝。普通游戏只新增通用手动入口，显示是否有任务、模型、费用及执行结果，不显示 NPC身份、秘密条数或总结正文。自动公开维护与三阶段继续运行，私人成功也不会擅自解除此前公开自动维护失败后的暂停。

## 修改文件

新增：

- `src/domain/memories/npcMemory.ts`：来源选择、分组、解析、校验、合并及内部知识投影。
- `src/tests/fixtures/npcMemory.ts`：明确隔离的普通/特殊 NPC 私人记忆夹具。
- `src/tests/npc-memory.test.ts`：来源、认知、事务、权限、协议和兼容测试。
- `e2e/npc-memory.spec.ts`：桌面/移动手动维护、隐私、跨标签、取消、429和自动费用授权测试。
- `M5-P3-DEVELOPMENT.md`：本报告。

修改：

- `src/domain/memories/schema.ts`：可选认知类型与严格可选总结来源。
- `src/domain/state.ts`：总结归属、来源、时间及权限不变量。
- `src/domain/variableCommands.ts`：原记录命令持久化实际认知类型，不新增命令类型。
- `src/services/storage/saveRepository.ts`：最新状态的私人总结追加事务。
- `src/workflows/memoryMaintenance.ts`：复用维护生命周期接入 NPC 任务。
- `src/prompts/context.ts`：安全 NPC 维护批次及内部分区，不把全部 NPC 记忆用于正文。
- `src/services/validation/worldEvidence.ts`、`worldOutput.ts`、`commandCatalog.ts`：所属来源/计划边界，以及事实成立与玩家已知的独立校验及运行说明。
- `src/ui/game/useMemoryMaintenance.ts`、`GameScreen.tsx`：通用手动入口及安全状态，不授权 NPC 自动收费。
- `src/ui/panels/MemoryMaintenanceControls.tsx`：不泄露身份/秘密数量的入口。
- `src/ui/settings/PromptInspector.tsx`：私人维护请求仅展示结构和统计。
- `src/app/App.tsx`：开发阶段标记。
- `prompts/memory/npc_summarize.md`：最小契约对齐，保留单NPC、独立认知、来源、最新原文保护与纠正要求。
- `prompts/manifest.json`、`prompts/sources.lock.json`：仅NPC资源版本/字符数/hash及适配溯源，保留原sourceSha256。
- `DEVELOPMENT.md`、`src/workflows/README.md`、`src/prompts/README.md`：阶段索引、职责与输入权限说明。

没有新增依赖。六套主提示词、双世界书、用户 NSFW 原文、七项写作设置和已有正式三阶段顺序均未改写。

## 验证记录

所有测试使用 Mock、Fake IndexedDB 或 Chromium 网络拦截，没有真实付费模型调用。

- `npm run prompts:check`：3个文件、82项测试通过，真实资源路径、哈希、注册和六种阶段组装保持有效。
- `npm run check`：ESLint零警告；22个测试文件、740项测试通过；TypeScript类型检查和Vite生产构建通过。保留原704项测试，新增36项单元/集成场景。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：112项全部通过（桌面56、移动56，含新增6项NPC用例），原有106项全部保留。
- `git diff --check`及暂存差异检查：通过。

先以回归测试复现同时间新纠正被旧窗口挤出及私人事实被提升为公开记忆/事件的3个失败，再修复通过；另增加internal后台记录不能当作NPC认知的阻断测试。

覆盖普通/特殊 NPC（含实际选中的长期原始记忆）、20/21边界、最早批次、新近原文、同回合多条记忆、A/B知识隔离、私有/内部/公开混合、三种认知与旧unknown、严格输出、身份/来源/权限篡改、重复收费、JSON/取消/超时/429/503/存储失败、来源修改/删除/身份替换、新正式回合产生记忆时的合并，以及旧档无字段读取。真实 Composer 检验正常正文/公开历史不泄露，变量/世界按所属分区且不重复注入已总结原文。

浏览器验证普通面板没有隐藏人物身份、秘密条数或总结；维护快照只显示安全结构及真实 Token；取消/迟到/跨标签互斥、手动恢复及公开自动维护不触发 NPC 请求；原 M4-P5 连续回合及 M5-P1/P2 全部回归继续保留。

## 限制与后续边界

- 自然语言归纳质量未经真实模型长期试玩验证；分组/来源安全不等于语义绝对正确，重大矛盾依赖模型如实报告。
- 没有来源凭据的旧总结无法安全补链，暂停对应NPC的新付费归纳。没有伪造来源、补造时间或静默改写旧档。
- 原始 NPC 记忆永久增长；本轮仅有界注入，不实现 NPC 私有语义检索、摘要再次分层、NPC自动总结或删除恢复。较老总结可因预算/条数上限不进入本次上下文，存档仍完整。
- 跨标签显示不做实时广播；请求及保存始终重读最新存档。不支持 Web Locks 时不调用模型。取消后服务端可能已经收费，明确手动重试可能再次收费。
- NPC 总结仅作为本人计划参考，不作为客观事实/公开传播证据；更丰富的信息传递需后续正式机制及事实校验，不能绕过权限。
- 新字段不改变现有游戏版本/存储事务；未来 M5-P5 删除/恢复 NPC 时须处理身份与原始来源依赖，本轮未提前实现。

不合并、不部署或开始M5-P4；交付独立Draft PR等待审查。
