# NPC V2 第四批：四级只读上下文

基线：main `9f7861f2a1492b9b6118d741946677351671b8a3`（PR #98）。分支：`feat/npc-v2-context-tiers`。本批不改 V9 Schema、存储、命令、事务、人物管理、记忆维护及历史召回评分。

## 源码审计与接入

实际链路为 `composePrompt → contextFor → sharedContext → npcContext`，Runtime 使用同一最终 messages。原来 `SAVE_STATE.npc` 包含完整档案，`NPC_KNOWLEDGE` 再抄原文、总结和知晓信息；Story 的 `SCENE_NPCS`、World 的 `OFFSCREEN_STATE.npc` 再次完整序列化人物。仅添加四个数组无法消除这些重复。

已阅读参考仓库 `MoRanJiangHu` 的真实 `hooks/useGame/npcContext.ts`，参考提交 `74aa92722b1ea1304210393679328aed07476972`。该文件 `提取基础数据` / `提取完整基础数据` 与在场、离场列表提供了身份与参与状态决定资料深度的参照。本批不移植它的武侠字段、重返审核或额外模型流程。

新权威人物表仍为 `SAVE_STATE.npc[id]`，不是第二套人物真值。它是由正式状态生成的只读视图，不是可直接保存的 GameState。`SAVE_STATE.memories.npcSummaries[id]` 唯一提供原有总结。`NPC_CONTEXT.groups` 为四组稳定 ID；`selection[id]` 明示展开原因、任务/事件 ID、原文数量、选中数量、总结数量和省略字段。

| 分组 | 来源条件 | 档案与记忆 |
| --- | --- | --- |
| sceneOrdinary | ordinary + onScene | 基础档案、统一原文、总结、知晓、联系方式和常驻地点完整 |
| sceneSpecial | special + onScene | 完整基础及激活专属档案，全部原文和总结 |
| offsceneOrdinary | ordinary + !onScene | 稳定身份、技能、关系、好感、健康、位置、联系、常驻地点、知晓及已有总结；无关长外貌/性格/背景可省略 |
| offsceneSpecial | special + !onScene | 完整基础、详细经历、目标、习惯、关系网、任务关联和激活私密档案，全部原文和总结 |

分类只依据当前 kind/onScene。离场普通人物若被玩家/选定正文/变量规划明确提及，或承担活动任务、事件、组织关键人物职责，则展开完整档案与原文，分组身份不变。匹配姓名/别名/ID只是保守的读取展开；重叠姓名可能使两人都展开，不承担人物绑定或命令授权。没有人数上限、重要性数值系统或筛选 AI。

Story 使用回合开始正式状态，现场辅助列表改为 `SCENE_NPC_IDS`。Variables 使用正式状态加完整选定 Story/规划并保留 `NPC_IMPORTANCE`、profilePending、玩家偏好。World 继续使用既有合法 Variables 投影与正式基线 revision；未验证变量仍为 preview，未经验证命令不进入视图。`OFFSCREEN_STATE.npcIds` 使用原 `worldNpcAllowed()`；原任务、事件、组织、地点、阶段成果及 `PROTECTED_SCENE` 全部保留。可读深度不决定可写权限。

移除重复的 `NPC_KNOWLEDGE` 数组、完整 `SCENE_NPCS` 和 `OFFSCREEN_STATE.npc`。保留知晓边界说明 `NPC_KNOWLEDGE_POLICY`。原始 CREATION_PROFILE.companion 是玩家创角快照，不是当前 NPC 专属档案或记忆的重复表；继续保留。World 的 VARIABLE_RESULT 仍可能带合法 CreateNpc/RecordNpcMemory 命令内容，这是必要候选执行依据，未删除。

## 统一记忆、休眠与完整性

仅离场普通且未展开的人物允许用可靠既有总结覆盖旧原文。复用 `validNpcSummary()` 及 `npcMemoryPolicy.contextRawLimit=20`：保留最近20条、所有未被可靠总结覆盖的原文，以及近期窗口/PR #74 召回来源关联的原文。没有可靠来源的旧总结仍保留，但不能证明原文可省略。未总结资料可以超过20条；不是硬砍记忆预算。所有现有总结原样提供，不另造总结、不请求 AI。所选原文的顺序、ID、文本、来源、认知性质与可见性不变。knownInformation 继续完整提供。

活动特殊人物不新增性别/年龄读取门槛：现有正式 privateProfile 按基线完整保留，原写入资格不变。七字段 bodyDescription、chestDescription、pussyDescription、isVirgin、firstExperienceTarget、firstExperienceTime、firstExperienceText 均测试完整。空的兼容 longTermMemories 标记仅不再展示；原始资料仍以 npc.memories 存储。

休眠档案仍在 sharedContext 边界完全剔除；明确提及、普通人物在场或身份切换不能泄漏 dormantNpcProfiles。恢复特殊身份后按原管理机制取回。未删除正式剧情中已经出现的历史。原私密档案生成提示词未改，七字段提示块固定 SHA-256 为 `830d8711b84f461925e8cb12dfcb64bcee1b8343b932adf6403ed47bbe147e98`。

电话、常驻地点及 knownToProtagonist 原样保留。作者知道住所不等于主角获知；没有把未知联系方式变成真实号码，未将人物私密记忆复制给其他人。

## 真实最终请求体量对照

同一合成夹具在基线 detached worktree 与本分支调用真实 composePrompt，使用现有 contextStatistics/inspectBudget。每人40条原文、2份可靠总结（覆盖前30条），40个正式 journal，含多组织、任务、事件。规模不是产品人数限制，也不代表真实玩家必然有同等数据。四组人数依次为在场普通/在场特殊/离场普通/离场特殊：10人=2/3/2/3；30人=7/8/7/8；60人=14/15/15/16。

字符数是最终 messages.content 的 Unicode 字符统计；估算 Token 是现有启发式算法，不是供应商 usage、真实计费或准确上下文窗口。NPC 分类列为检查器 npc+npcMemory 分类的实际字符合计，JSON键/标点等另属 structure，因此不等于完整序列化对象长度。

| 人数 | 阶段 | 最终字符：基线 → 本批 | 估算Token：基线 → 本批 | NPC分类字符：基线 → 本批 | 最终字符减少 |
| --- | --- | --- | --- | --- | --- |
| 10 | story | 556,514 → 260,236 | 429,821 → 213,157 | 319,821 → 122,737 | 53.2% |
| 10 | variables | 504,240 → 300,601 | 359,315 → 213,365 | 259,261 → 122,670 | 40.4% |
| 10 | world | 639,045 → 343,322 | 444,211 → 227,803 | 319,439 → 122,732 | 46.3% |
| 30 | story | 1,521,079 → 622,151 | 1,125,062 → 467,473 | 959,381 → 360,942 | 59.1% |
| 30 | variables | 1,289,010 → 665,546 | 915,783 → 468,439 | 778,391 → 360,745 | 48.4% |
| 30 | world | 1,603,760 → 705,377 | 1,139,490 → 482,154 | 959,009 → 360,937 | 56.0% |
| 60 | story | 2,949,634 → 1,160,528 | 2,153,969 → 845,377 | 1,906,679 → 715,213 | 60.7% |
| 60 | variables | 2,466,169 → 1,208,482 | 1,750,485 → 847,483 | 1,557,087 → 714,834 | 51.0% |
| 60 | world | 3,069,120 → 1,243,978 | 2,196,363 → 860,115 | 1,930,409 → 715,234 | 59.5% |

相同 NPC ID / NPC 原文及总结 ID 的重复实体族由每阶段430/1290/2580降至0（上述空变量命令测量夹具）。这不代表所有相同文本都消失：不同人物可以有相同内容，世界/任务等兼容容器也仍重复；实际变量命令可能保留必要的执行依据。检查器继续报告它们，不伪装总请求完全无重复。新三阶段专项逐字节/字符分类对账差额均为0。

| 人数 | 阶段 | 仅组装ms：基线 → 本批 | 离线统计分析ms：基线 → 本批 |
| --- | --- | --- | --- |
| 10 | story | 186.72 → 146.38 | 327.9 → 242.45 |
| 10 | variables | 165.97 → 54.89 | 320.88 → 189.12 |
| 10 | world | 81.65 → 113.77 | 305.11 → 254.73 |
| 30 | story | 135.01 → 39.63 | 638.05 → 361.3 |
| 30 | variables | 104.91 → 84.13 | 601.65 → 338.28 |
| 30 | world | 103.64 → 106.5 | 653.83 → 386.71 |
| 60 | story | 143.88 → 220.92 | 1360.86 → 738.23 |
| 60 | variables | 121.15 → 115.99 | 1231.85 → 604.51 |
| 60 | world | 287.51 → 207.93 | 2267.41 → 593.07 |

单次本地合成测量，包含冷启动/并发环境噪声，不作为稳定速度承诺。统计分析单独计时，未加入正常 HTTP 发送关键路径；PR #75 Worker/按需诊断方式不变。

可复现：`NPC_CONTEXT_METRICS=/tmp/npc-context.json npx vitest run src/tests/npc-context-volume.test.ts`。基线对照把同一纯测试夹具与测量文件复制至基线独立工作区运行，不改基线生产代码。30秒是九次完整离线检查的测试期限，不是模型超时设置。

## 验证记录

以下独立批次不相加冒充一次完整通过：

- 新专项首次13项：8通过、5失败。3项统计辅助函数把 ActorRef ID 当作完整档案；1项休眠测试使用了其他活动人物也有的相同合成标记；1项测试草稿来源回合与 Repository 草稿不一致。修正测量/夹具后，相关定向批次63/63通过。
- 既有定向首次109/109通过；另一91项批次90通过、1失败，原断言要求无关离场普通人物总保留已覆盖最旧原文，改为明确查询该人物后验证完整展开。
- 完整 Vitest 首轮2976项：2969通过、7失败。3项旧检查器预期重复记忆，调整为新唯一表示；3项300回合同行测试暴露新读侧资格过滤误隐藏已存 privateProfile，已删除该新过滤（不修改夹具人物性别）；1项原始状态全等断言包含只读视图省略的兼容空字段，改为独立核验非NPC世界全量、人物稳定字段与所选原文不变。
- 修正后定向60/60通过。
- 最终完整 Vitest（补强所有激活特殊人物私密档案/关系网/待完善状态断言后）：2976通过、0失败、0跳过。
- prompts:check：93通过、0失败、0跳过；Manifest及来源锁追加记录核验通过。
- TypeScript、ESLint：通过。生产构建通过，保留现有大于500kB chunk警告。
- 合成测量初次基线九请求检查触及默认5秒测试期限；仅该离线测量测试改30秒，基线/新分支各1项通过。实际请求调用、模型超时和付费策略没有变化。
- 新双端三阶段专项：2通过、0失败、0跳过。
- 首次相关双端 Chromium 批次86项：82通过、4失败、0跳过；desktop/mobile各41通过、2失败。四项均停在旧 memory.spec.ts 夹具的读档：公共短期和NPC原文重复使用private ID，触发现行唯一来源约束。为两份真实独立记录使用独立ID，并在入库前验证夹具；未放宽任何生产校验。失败Trace已保存在独立工作区。
- 该夹具定向复测：4通过、0失败、0跳过（desktop/mobile各2）。
- 冻结代码后的同一86项双端批次：86通过、0失败、0跳过、0 flaky；desktop 43/43，mobile 43/43。相关11个文件，未使用grep/skip/fixme。

浏览器验证使用真实 React、Runtime、Mock网络、候选保存、Commit、IndexedDB重载，区分模型请求发出次数；新流程严格3个请求，无额外记忆/筛选模型。未运行无关全量 Chromium，不调用真实收费 API，不修改玩家存档。第五批UI尚未开发，本批没有新增人物页面或星标按钮。

## 文件与边界

生产逻辑仅涉及 src/prompts/npcContext.ts、sharedContext.ts、context.ts、budgetInspection.ts；三个共享提示词、Manifest、来源锁同步更新。新增四级夹具、真实最终messages测试、体量测试和双端 Runtime测试；旧上下文/召回/World/记忆断言改用新规范路径，保留权限及事务反例。文档追加当前输入表示说明，不改旧批次历史验收成绩。

正式 NPC、所有原始记忆、总结、私密七字段、休眠档案和知晓状态在本批前后持久化机制一致；V6/V7/V8/V9迁移、旧候选、撤回5回合/64MiB、epoch/CAS/幂等与PR #72/73/74能力不改。完整回归与相关浏览器测试验证，不能据Mock推断真实模型叙事质量。

## 残余风险与第五批交接

- 本轮合成负载测至60名NPC，未实测更大人物规模；每名人物关联检查当前任务、事件与组织，超出本轮规模的性能需后续测量。
- 活动特殊人物保留完整资料；离场普通未总结原文也不丢弃，因此长期上下文仍可能很大。没有保证一定适合未知窗口，不自动换模型或裁剪世界。
- 保守姓名/别名匹配可过度展开同名或重叠名称；只影响读取体量，不决定身份/命令。详细历史有特殊需要可明确引用稳定ID或具体旧事，沿用原召回。
- 紧凑离场普通的少量未被本轮展开的长背景不在该请求内；正式存档完整，下次被提及、活动职责或重新在场即展开。
- 必要阶段候选和非NPC世界专项视图仍可重复；本批没有擅自裁剪它们。
- 尚未调用真实模型验证四组索引与新路径的遵循程度、叙事质量及实际费用。均需单独授权。
- 第五批只应在已有正式人物管理入口上开发名录/星标交互，继续使用稳定ID、当前kind/onScene、原epoch/CAS和休眠恢复，不建立重复人物/记忆真值。

## 实际修改文件清单

- `docs/NPC_V2_BATCH3.md`
- `docs/NPC_V2_BATCH4.md`
- `docs/SHARED_MEMORY_RECALL_V2.md`
- `docs/THREE_STAGE_CONTEXT_V2.md`
- `e2e/memory.spec.ts`
- `e2e/npc-context-tiers.spec.ts`
- `e2e/npc-unified-memory.spec.ts`
- `e2e/world-runtime.spec.ts`
- `prompts/manifest.json`
- `prompts/shared/05_context_protocol.md`
- `prompts/shared/07_command_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `src/prompts/budgetInspection.ts`
- `src/prompts/context.ts`
- `src/prompts/npcContext.ts`
- `src/prompts/sharedContext.ts`
- `src/tests/context-budget.test.ts`
- `src/tests/context-v2-runtime.test.ts`
- `src/tests/context-v2.test.ts`
- `src/tests/fixtures/contextAssertions.ts`
- `src/tests/fixtures/npcContextTiers.ts`
- `src/tests/long-companion-recall.test.ts`
- `src/tests/npc-context-tiers.test.ts`
- `src/tests/npc-context-volume.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/npc-unified-memory.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/recall-v2-runtime.test.ts`
- `src/tests/recall-v2.test.ts`
- `src/tests/story-event-arbitration.test.ts`
- `src/tests/world-handoff.test.ts`
- `src/tests/world-structural-reliability.test.ts`
- `src/tests/world-validation.test.ts`

## 本轮执行命令

```sh
npm test -- --reporter=json --outputFile=/workspace/npc4-full-verified.json
npm run prompts:check
npm run typecheck
npm run lint
npm run build
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-context-tiers.spec.ts e2e/npc-importance.spec.ts e2e/npc-unified-memory.spec.ts e2e/npc-v2-foundation.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/world-handoff.spec.ts e2e/memory.spec.ts e2e/world-runtime.spec.ts --project=desktop --project=mobile --reporter=json
git diff --check
```
