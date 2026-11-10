# NPC V2 第二批：统一人物记忆

> 第三批现已扩展为V9人物重要性管理，初始同伴可由玩家取消/恢复特殊身份，原记忆与总结不变。本文保留第二批历史验收，当前契约见 [NPC_V2_BATCH3.md](NPC_V2_BATCH3.md)。

## 基线与范围

开发分支 `feat/npc-v2-unified-memory`，基于并再次核对远端 `main@0fa1ab269280924fab627eda21a3e11f1661d3ff`（第一批 PR #96）。本批不开放身份切换 UI/AI 命令，不开发人物建档判断、联系方式/常驻地点写入和四级上下文；不修改 Story→Variables→World→Commit、费用授权、队列、epoch、CAS、撤回和 IndexedDB 结构。

## 实际职责审计与数据对照

| 原数据/入口 | 本批正式行为 |
| --- | --- |
| 所有 NPC 的 `memories` | 普通/特殊 NPC 唯一原始人物记忆存储 |
| 特殊 NPC 的 `longTermMemories` | 旧原文迁入同一人物 `memories`；字段保留为严格空数组兼容标记，不能再持有原始记录 |
| 休眠 profile 的旧长期记忆 | 迁回该人物的统一记忆；休眠区不再保存任何原始记忆 |
| `memories.npcSummaries` | 沿用原总结结构、来源、阈值及配置，既有总结不生成第二份 |
| `knownInformation` | 保留现有人物知晓状态。不是第二个原始记忆池；总结只读取 `npc.memories` |
| `RecordNpcMemory.layer` | 旧候选输入兼容；personal/longTerm 都写同一 `npc.memories`，不出现在新模型命令 Schema 中 |
| 旧文本 `push npc[id].longTermMemories` | 仅保留旧文本重编译别名，写同一存储；新目录/提示词不再列出该入口 |

此前 `rawNpcMemories()` 合并普通层与特殊长期层，`RecordNpcMemory` 按 layer 分流，身份休眠又将长期层移出可读人物。现在写入和总结来源统一到 `npc.memories`，重要程度不再改变其写入/维护机制。`knownInformation` 旧入口仍将一次知晓写入转换为一条原始记忆及一个知识索引；明确要求不要就同一事实再次 push memories。没有新增语义去重器。

文本协议仍为同次请求的三标签及 set/add/push/delete。新模型创建特殊 NPC 时不要求 `longTermMemories`；领域兼容解析器接受旧 CreateNpc 的该字段并转入统一存储。旧命令对象及已应用指纹不因补默认字段而重写，保留旧回执幂等性。提示词仍要求内联初始记忆为空，再通过原记忆命令记录；World 原有内联记忆检查未放宽，也没有放宽角色权限、来源或时间校验。

Variables 仍依据已选定 Story 记录有保存价值的亲历、转述和判断。普通/特殊采用相同入口，不要求每回合写，也不因 special 强制多写。World 场外记忆仍只能写合法场外人物；临时路人不会因此自动建档。

## V8 与严格无损迁移

GameState 从 V7 升为 **V8**，IndexedDB 结构仍为 **3**。这不是产品版本修改，也没有大规模存储迁移。使用新数据版本明确区分“长期层是可写原始数据”和“长期字段只能为空”的契约，防止旧严格客户端误读并覆盖。V6/V7 客户端不能读取 V8，请勿把版本号手改为旧值；沿用已有未来版本拒绝覆盖保护。

`migrateSave()`：

1. 严格解析原 V6/V7 字段集，允许旧特殊层及休眠层的完整数组；不 strip 未识别字段。
2. 在解析副本中依原各数组顺序拼接到所属 NPC 的 memories，不重排/摘要文本，不使用 AI。
3. 将旧长期字段置空；休眠档案只能归属同稳定 ID/identityKey 的普通 NPC。
4. 通过完整 V8 Schema 校验全局记忆 ID、实体引用、总结来源/归属/认知性质与其他原有状态约束。
5. 全部成功后才允许 Repository 原事务写回。冲突 ID（同人/跨人/公共记录）、来源丢失或非法归属均拒绝，不猜造、不自动去重、不覆盖原始存档、草稿或撤回链。

保留每条原始 ID、完整文本、来源说明、sourceTurnIds、affectedEntityRefs、createdAtGameTime、knowledgeKind、visibility；保留总结全文及 npcProvenance/sourceMemoryIds。旧记忆缺省 knowledgeKind 保持缺省，不补造亲历。原始 NPC 文本/来源和保存的 NPC 总结改为不 trim 的非空字符串，避免解析旧档时丢失首尾空白；认知标记仍使用原有规则并忽略开头空白，不增加文学审查。

`SaveRepository.load/loadGame` 原本就会在事务中持久化成功迁移，本批不将读取描述为永不写入。迁移失败的 raw export 前后完全相同，测试中同时存在真实草稿及撤回记录。V1～V5 维持主干现有不支持政策，V9+ 仍拒绝覆盖。

旧撤回快照编码仍为 version1。既有 `restoreSnapshot()` 按需调用同一 migrateSave，因此 V6/V7 旧快照可恢复为 V8；不清空旧撤回记录、不提前重写全部快照。5回合/64MiB、快照原子消费、回执、epoch 和新时间线保护保持不变。

## 身份休眠、认知与总结

`hibernateNpcProfile()` 不再因存在旧长期记忆或 npcSummaries 拒绝转换。原始记忆、知晓状态、联系方式、基础关系和总结一直留在人物统一机制；详细背景、目标、习惯、关系网、场外任务资料及 privateProfile 仍按原函数休眠/恢复，不进入正常 AI 上下文。公共历史、任务和正式事件不删除。

`restoreNpcProfile()` 沿用原 memories 和 npcSummaries，不付费再生成、不复制旧总结。初始同伴保护保留；两函数仍仅为内部安全操作，本批没有持久化切换命令或玩家入口。浏览器测试对这些纯函数的结果进行夹具写入，不能误称已开放玩家切换。

无来源的旧总结继续保留；既有 `npcSummaryCandidates()` 保守停止该人物重复付费整理，不因降级或升级擅自重做。普通与特殊沿用相同默认20条触发/15条批次及玩家配置、来源核验、分组、预算、取消/并发保护。统一旧层不新增调度入口、请求种类或自动重试；是否总结仍由已有开关、来源、门槛、预算和限流决定。旧特殊长期层条目原先也属于同一总结来源。

### 香闺秘档七字段

`bodyDescription`、`chestDescription`、`pussyDescription`、`isVirgin`、`firstExperienceTarget`、`firstExperienceTime`、`firstExperienceText` 全部原样保留，含 false、换行和首尾空白。覆盖迁移、Variables 实际文本编译/校验、Commit/重载、休眠/恢复、撤回与 Chromium 进程重启。

特殊 NPC 提示词中原私密档案写入段落逐字未改，init/update 对应块 SHA-256 均为 `830d8711b84f461925e8cb12dfcb64bcee1b8343b932adf6403ed47bbe147e98`（从“重要成年女性”至原命令目录句前）。没有删除字段、模糊替换或新过滤器。

## 实际请求与提示词

修改真正加载的 ordinary/special init/update 模块、共享 Variables 命令说明及共享 World 输出规则；Manifest 字符数与 SHA 由原脚本更新，sources.lock 追加 npcUnifiedMemoryV2 来源记录，不覆盖历史。

实际 composePrompt 三阶段验证：统一原始资料仍可读取；休眠详细档案及七字段不可读；新 TEXT_COMMAND_CATALOG 不列长期层，新 World RecordNpcMemory Schema 不含 layer，新 CreateNpc Schema 不要求长期层。文本目录从75项变为74项，删除的仅为旧长期 push 的公开说明，兼容解析保留。完整世界读取、旧史召回评分、预算、公共记忆压缩均未修改。合成长期同行/上下文夹具仅将原有记录移动到统一存储，不减少任何条目或来源。

## 验证记录（独立批次，不相加）

全部使用合成夹具、fake-indexeddb、Mock HTTP 或本地 Repository；零真实付费模型调用。

| 批次 | 总数 | 通过 | 失败 | 跳过 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| 新增测试初跑 | 15 | 12 | 3 | 0 | 修正空公共数组的负例夹具、revision0应使用opening草稿 |
| 首轮定向 | 79 | 79 | 0 | 0 | 统一记忆、来源、身份与撤回 |
| 首轮完整 Vitest | 2928 | 2865 | 63 | 0 | 揭示旧合成长期层、V7断言、公开目录与旧层结果预期需同步；不改业务安全断言 |
| 受影响定向 | 255 | 253 | 2 | 0 | 遗漏的prompt-runtime旧层夹具和原文计数，已修正 |
| 第二轮定向 | 266 | 266 | 0 | 0 | 相关上下文、召回、文本、NPC、World和Commit |
| 扩展新增 | 24 | 24 | 0 | 0 | 旧快照、旧候选、迁移失败、迟到总结 |
| 第二轮完整 Vitest | 2937 | 2936 | 1 | 0 | 唯一失败为目录unique-size残留75，已改为74 |
| 完整 Vitest（共享提示词自查前） | 2938 | 2938 | 0 | 0 | `npm test -- --reporter=json` |
| 最终定向复核 | 99 | 99 | 0 | 0 | 新测试加强实际失败迁移不损草稿/快照，与NPC记忆/撤回/总结恢复 |
| 提示词检查（共享自查前） | 93 | 93 | 0 | 0 | `npm run prompts:check`，3文件 |

TypeScript、Lint、生产构建均通过。构建存在原有超过500kB的 bundle 警告，不影响构建成功。`git diff --check` 通过。

共享提示词自查时扩大真实请求负断言，发现 `shared/07_command_output.md` 两句仍公开旧长期层：新增断言批次25项中24通过/1失败。清理两句并更新来源与Manifest后，175项（新测试、提示词、真实文本组装）全部通过。旧版本原文归档和legacy资源没有重新连接到实际请求。

浏览器首批命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-unified-memory.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/npc-v2-foundation.spec.ts --project=desktop --project=mobile --reporter=json
```

该批50项：desktop 24通过/1失败，mobile 25通过/0失败，均0跳过、0自动重试。失败是 `undo-summary-recovery` 的NPC飞行中撤回后发送，5秒内正式turnNumber仍90（期望91）；Trace显示仍在World生成阶段，Story/Variables Mock已响应，没有结构错误信息。此时完整Vitest与浏览器并行，尚不能仅凭Trace断言确定根因或真实产品错误。保留原断言/代码，将该恢复文件独立复跑：8项（desktop4/mobile4）全通过、0失败/跳过/自动重试。没有通过加超时、删除断言或修改事务来制造通过。

失败证据保留在独立执行工作区 `/workspace/npc-unified-evidence/browser-first/`，原JSON日志亦独立保留。不将49与8相加声称完成一次57项全绿。

最终提示词冻结后：完整 Vitest **2938/2938通过，0失败/跳过**；`npm run prompts:check` **93/93通过，0失败/跳过**；TypeScript、Lint、生产构建再次通过。最终相关 Chromium 冻结批次：**64项全部通过，desktop 32/32、mobile 32/32，0失败/跳过/自动重试**，用时309.7秒。原先5秒等待失败的同一NPC恢复用例在这一完整批次也通过，未修改其断言、等待或业务代码。新迁移/进程重启用例6项均通过。本批与前述首批、独立复测分别记录，不相加。

最终浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-unified-memory.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/npc-v2-foundation.spec.ts e2e/world-handoff.spec.ts --project=desktop --project=mobile --reporter=json
```

最终工程命令：`npm test -- --reporter=json`、`npm run prompts:check`、`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check`，均成功。最终完整Vitest为2938通过/0失败/0跳过（与自查前另一完整批次独立）。未运行无关Chromium全量或真实付费模型。

直接定向复核命令为 `npx vitest run src/tests/npc-unified-memory.test.ts src/tests/npc-memory.test.ts src/tests/npc-memory-review.test.ts src/tests/turn-undo.test.ts src/tests/undo-summary-recovery.test.ts`，99/99通过；随后共享提示词修正的175项定向及最终全量又覆盖新增断言。

## 剩余边界与第三批承接

- 未运行真实模型，不能将 Mock 通过描述为真实生成质量已验证；部署时需升级客户端，旧客户端不可读取V8。
- 有冲突 ID/损坏来源的旧数据安全拒绝，不开发自动修复；玩家原始记录及 raw export 保留。
- 旧总结无 provenance 时不猜测覆盖来源，不自动付费重做；仅保留原数据与原来的保守维护行为。
- 兼容空字段和旧输入别名暂留，防止旧候选/指纹失效；没有第二份权威原始记忆。后续需明确版本化后才能删除这些兼容壳字段。
- NPC原始记忆不因总结被删除；存档和完整世界上下文随实际经历增长，沿用既有预算/检查器，本批不裁剪资料。
- 第三批再接入建档、升级降级权限及新命令；初始同伴保护、联系方式/常驻地点写入、玩家星标均未提前实现。

## 修改文件清单

46 个文件（生产实现、实际提示词、兼容夹具/断言及开发报告）；无 UI、队列、Commit、撤回算法改动。

```text
docs/MEMORY_SUMMARY_V2.md
docs/NPC_V2_BATCH1.md
docs/NPC_V2_BATCH2.md
docs/WORLD_EVENT_LIFECYCLE.md
e2e/npc-unified-memory.spec.ts
e2e/npc-v2-foundation.spec.ts
e2e/world-handoff.spec.ts
prompts/manifest.json
prompts/shared/07_command_output.md
prompts/shared/08_world_output.md
prompts/sources.lock.json
prompts/variableGroups/npc_ordinary/init.md
prompts/variableGroups/npc_ordinary/update.md
prompts/variableGroups/npc_special/init.md
prompts/variableGroups/npc_special/update.md
src/domain/commands.ts
src/domain/memories/npcMemory.ts
src/domain/memories/schema.ts
src/domain/npc/profiles.ts
src/domain/npc/schema.ts
src/domain/state.ts
src/domain/variableCommands.ts
src/executors/variableText/catalog.ts
src/services/storage/migrations.ts
src/services/validation/commandCatalog.ts
src/services/validation/worldOutput.ts
src/tests/context-v2-runtime.test.ts
src/tests/event-hierarchy-v2.test.ts
src/tests/fixtures/contextScale.ts
src/tests/fixtures/contextV2.ts
src/tests/fixtures/longCompanionRecall.ts
src/tests/fixtures/npcMemory.ts
src/tests/fixtures/npcUnified.ts
src/tests/npc-unified-memory.test.ts
src/tests/npc-v2-foundation.test.ts
src/tests/player-memory.test.ts
src/tests/prompt-runtime.test.ts
src/tests/prompts.test.ts
src/tests/recall-v2-runtime.test.ts
src/tests/recall-volume.test.ts
src/tests/text-prompt-readiness.test.ts
src/tests/text-protocol-readiness.test.ts
src/tests/turn-commit.test.ts
src/tests/variable-text-executor.test.ts
src/tests/world-handoff-review.test.ts
src/tests/world-handoff.test.ts
```
