# NPC V2 第一批：数据基础与永久保留

> 后续状态：第二批已将原始人物记忆统一为 V8 的 `npc.memories`，解除本文当时为长期记忆/人物总结设置的临时切换限制；初始同伴保护不变。本文保留第一批历史设计与实测记录，当前协议见 [NPC_V2_BATCH2.md](NPC_V2_BATCH2.md)。

基线为 `main@05cd3f2b23ef338444ca1888674dc5e5d274b8b0`（PR95 合并后），独立分支 `feat/npc-v2-data-foundation`。本批不提供新 NPC 界面、星标、身份切换按钮或 AI 升降级命令。

## 1. 审计与实现边界

- 原 `NpcSchema` 已只有 ordinary/special 两类，都有 id、identityKey。联系人是另外的 ID 数组，不是第三个人物类型。
- 原 `npc/lifecycle.ts::retireNpc()` 会删除完整 NPC 与 NPC 总结，将选中的记忆搬入公共长期层的内部历史记录；本批删除这条执行实现。
- 原 `WorldResult → validateWorldOutput → projectTurn → commitCommands → SaveRepository.commitTurn` 保持原路径，CAS、幂等、revision、epoch 与原子事务未重构。
- 原 `SpecialNpcSchema.longTermMemories` 与 `memories.npcSummaries` 有真实来源引用。不能直接移动、合并或删除后再宣称安全。本批仅提供有明确限制的内部纯函数，含这些旧数据的人物暂不切换。
- 原 `sharedContext()` 会将正式状态大部分字段加入 SAVE_STATE。本批新增的休眠存储必须显式排除；活动人物的既有完整读取与旧史召回保持原样。

## 2. 持久数据

当前 GameState 为 **V7**；IndexedDB 仍为结构版本 **3**。新增字段均可缺省，不为旧人物猜造资料。

| 位置 | 字段 | 含义 |
| --- | --- | --- |
| 两类 NPC | `phoneContact?: { status, note? }` | status 为 unknown/known/invalid，表示主角掌握电话联系途径的状态；不要求号码，旧联系人不自动变 known |
| 两类 NPC | `usualLocations?: [{ locationId, role, knownToProtagonist }]` | role 为 home/work/frequent；地点 ID 必须真实存在，是否为主角已知须明确；不改变当前位置 locationId |
| 特殊档案 | `relationshipNetwork?: [{ name, relationship, description, affinity?, npcId? }]` | 好感为 -100～100，缺省/null 均表示未知；单向，不推算反向好感；仅有姓名不创建人物 |
| GameState | `dormantNpcProfiles?: Record<npcId, { id, identityKey, profile }>` | 仅保存属于当前普通 NPC 的专属资料，同一人物不能同时有活动与休眠两份专属真值 |

`profile` 复用 `SpecialProfileSchema`：detailedBackground、activeGoals、habits、原 longTermMemories、offscreenTaskIds、privateProfile，以及可选关系网。它不是一个新 NPC 实体，主键与 id 都是所属 NPC 的原 ID，不参与新实体全局 ID 分配。

正式状态检查继续保证全局实体 ID/稳定人物身份唯一；新增常驻地点引用、关系网 NPC 引用（允许已存在的历史退役身份）、非自身关系引用、休眠所属身份和原任务归属检查。姓名不用于字符串身份推断，改名不自动改 ID 或反向关系值。

## 3. 休眠安全操作

`npc/profiles.ts` 提供 `hibernateNpcProfile()` / `restoreNpcProfile()`，只返回验证后的独立状态，不写库、不发请求、不提升 revision，也没有绕过事务的持久化入口。后续正式开放必须经领域命令和 Repository 原有 CAS 事务接入。

本批内部休眠的限制：

1. 仅接受稳定身份匹配的特殊 NPC。
2. 初始同伴仍保留当前 special 保护，不在本批解除。
3. 存在旧 `longTermMemories` 或已有 NPC 总结时拒绝切换，原对象及全部来源不变。即使理论上部分记录可以移动，也不在统一记忆设计前猜测归属或复制一份新真值。
4. 安全休眠只移动专属字段，基础身份、名字、关系、电话、地点、原始个人记忆和已知信息仍留在普通 NPC 上；公共历史、任务、事件、资产等不移动。
5. 恢复时仅取回原专属字段，保留普通阶段更新后的基础信息，ID/identityKey 不变；恢复成功后删除已消费的休眠记录，不保留双份权威。

休眠结构本身能够原样保存旧长期记忆格式并核验其引用，为第二批保留基础；这不代表本批已经允许有来源依赖的任意人物切换。基础个人记忆在安全休眠后仍能沿原总结流程维护；新总结的 provenance 必须指向当前可读的原始来源。休眠人物不允许混入无法核验来源的旧总结，以免间接读取休眠资料。

### 输入隔离

`sharedContext()` 在构建 SAVE_STATE 前移除整个 `dormantNpcProfiles`。SCENE_NPCS、OFFSCREEN_STATE、NPC_KNOWLEDGE、旧史召回和现有记忆维护仍只读取活动 NPC 与正式记忆结构，不读取该表。真实 composePrompt 的开局/普通 Story、Variables、World，以及公共/NPC 记忆请求均有断言。

这不是根据文本内容擦除历史：此前已存在于公共历史、任务、事件或普通基础记忆中的事实仍保留。这里只隔离专属休眠存储本身，不增加任何关键词或文学审查。

## 4. 永久保留与旧联系人

- World 实际命令目录不再包含 RetireNpc；领域层对任何新执行的旧命令抛出 `NPC_RETAINED`。没有替代自动清理命令或隐藏开关。
- RetireNpc 的严格旧结构暂留，供旧草稿/候选查看与历史幂等记录解析。已有提交回执仍按原机制重放；未正式执行的旧删除提案不能因为读取成功而获得提交权限，需要玩家主动重做 World 候选，不自动付费重试。
- 正式 NPC 离场、死亡、失联或离开城市都不再删除完整档案。任务终结、交接、事件后续仍按原规则运行，不以人物删除作为前提。
- contactNpcIds、contactReviewNpcIds、RegisterContact 及其旧显示继续兼容；登记不赋予 phoneContact，也不创造号码或住址。所有人都永久保留，因此待复核或非联系人不再构成可删除许可。
- retiredNpcs 及已有 retiredNpcSource 历史继续读取、校验和被引用，不恢复已丢失的详细人物资料。原有稳定 ID 再出现约束保持不变。
- 撤回整个创建人物的回合仍恢复回合前唯一有效世界；这不是对当前有效时间线已建档人物进行自动清理。

## 5. V6、旧草稿和撤回兼容

V7 避免旧 strict V6 客户端读取并丢弃新字段后覆盖存档；旧版本的 future-version 保护会阻止读取/写回 V7。不要将已写入 V7 的存档强制降为6。

`migrateSave()`：先严格核验原 V6 结构（含原人物字段集），再将 schemaVersion 改为7并验证完整引用；联系人、记忆、时间、回合数、正文、人物 ID 等均不补造或重算。V1～V5 仍按主干现有政策拒绝，未来 V8+ 继续拒绝覆盖。非法数据不会被宽松 strip 成合法档案。

原 `SaveRepository.load/loadGame` 已有事务性迁移写回路径，本批沿用：只有整体状态、草稿及相应检查通过才写回；失败事务不改变原数据。没有新增批量迁移、自动修复或数据库清理。

旧撤回记录编码仍为 version1，控制表、索引、5回合/64MiB限制、epoch 和回执处理均不变。`restoreSnapshot()` 改为调用同一个 migrateSave 读取 stateJSON；旧 V6 完整快照按需转为 V7，再通过原时间线检查和原子恢复。读取/升级正式存档不清除或重写旧快照链，不重算它们的存储描述；撤回成功才原子消费当前恢复点。

旧合法 AI 创建/更新命令结构保持原样：本批单独固定 `NpcCreationSchema` 和文本目录所用旧创建形状，没有向 AI 开放新字段写入、kind 转换或休眠操作。新数据现阶段可持久化和只读进入上下文，正式命令接入留给第三批。

## 6. 测试记录

所有模型调用为 Mock。所有 IndexedDB 数据都是 fake-indexeddb 或新浏览器上下文中的合成数据，没有访问/修改玩家存档。

| 批次 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| 新测试初跑 | 23 | 1 | 0 |
| 人物/记忆/撤回首批定向回归 | 88 | 0 | 0 |
| 首轮完整 Vitest | 2879 | 33 | 0 |
| 保留规则专项第一轮 | 166 | 6 | 0 |
| 专项第二轮 | 195 | 1 | 0 |
| 最终定向（7文件） | 197 | 0 | 0 |
| 最终完整 Vitest（106文件） | 2913 | 0 | 0 |
| 最终 prompts:check（3文件） | 93 | 0 | 0 |
| Chromium 主批次 desktop | 23 | 0 | 0 |
| Chromium 主批次 mobile | 23 | 0 | 0 |
| 新 NPC 数据最终专项 desktop（含真实重启） | 3 | 0 | 0 |
| 新 NPC 数据最终专项 mobile（含真实重启） | 3 | 0 | 0 |
| 最后 V6 总结来源补强（人物/记忆/撤回4文件） | 89 | 0 | 0 |

初次新测试错误地预期 Repository 读取合法 V6 后不写回；实际主干已有事务迁移机制，改为断言只升级版本，迁移失败仍完整保留原始数据。首轮完整失败包括这一旧断言、V6版本硬编码、仍期待 RetireNpc 删除人物的旧产品断言和来源哈希优先级；后续专项还发现漏改的同类删除断言。均按新产品规则替换，未删除测试、跳过断言或放松引用/事务检查。

旧交接、取消、跨标签、回执重放、写入失败、CAS 和来源隔离测试继续存在。确需测试旧 retiredNpcs 的场景使用明确标识的旧 V6 退役状态夹具，不把新回合人物删除模拟成成功。

最终执行命令：

```sh
npm test -- --reporter=json --outputFile=/workspace/npc-v2-full-final.json
npm run prompts:check
npm run typecheck
npm run lint
npm run build
git diff --check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-v2-foundation.spec.ts e2e/npc-memory.spec.ts e2e/turn-undo.spec.ts e2e/world-handoff.spec.ts --project=desktop --project=mobile --reporter=json
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-v2-foundation.spec.ts --project=desktop --project=mobile --reporter=json
```

主浏览器批次46/46通过，后续补充真实浏览器进程关闭/重启后，新数据专项另批6/6通过，均无重试。重启测试使用临时持久配置目录，关闭 Chromium 及其数据库连接后重新启动，检查正式人物、休眠档案及草稿一致，结束后删除临时测试目录。未使用玩家浏览器配置。

TypeScript、ESLint、生产构建及差异检查通过。Vite 仍有既有的 >500kB 分包提醒，不在本批拆分无关模块。没有运行无关 Chromium 全量回归；以上各批次分别记录，不累加为一次结果。

完整批次后，仅将同一个 V6 迁移用例增强为包含实际生成的 NPC 总结及其15条原始来源引用，再次运行人物、记忆、撤回4文件89/89通过，并复核 TypeScript、Lint、差异检查；生产代码未改变，没有将这次定向结果冒充第二次完整 Vitest。

## 7. 修改范围

- 人物领域：npc/schema.ts、npc/profiles.ts、npc/lifecycle.ts；state.ts 与 commands.ts、sceneTransitions.ts 中必要的人物保留/引用接线。
- 存储：migrations.ts 与 turnUndo.ts 的状态读取兼容；不改 SaveRepository 事务实现、IndexedDB stores/结构版本或回执 Schema。
- 命令与上下文：commandCatalog.ts、worldOutput.ts、worldDependencies.ts、worldDomains.ts、context.ts、sharedContext.ts；文本 catalog 固定原创建协议。
- 运行提示词：shared/08_world_output.md，Manifest 与 sources.lock 追加修改来源记录；常驻时间和事件语义不改。
- 合成夹具、新人物单元/集成测试与新 Chromium 数据回归；旧交接/版本断言根据新永久保留及V7政策同步更新。
- 本报告与 WORLD_EVENT_LIFECYCLE.md 的当前版本和人物保留说明。

## 8. 后续批次与限制

第二批必须统一原始个人记忆、旧长期记忆和 NPC 总结的存储/来源规则，再决定它们在身份切换和休眠时的可见性；保留所有稳定记忆 ID、来源回合、认知性质与 epoch 防迟到写入机制。不得以清空旧总结、复制为公共事实或重新付费总结作为默认迁移。

第三批再接入正式的升级/降级领域命令、Variables 与玩家操作。第四批再实施四级上下文读取，第五批再清理联系人旧显示和人物名录；本批没有提前开发这些功能。

永久保留会增加长期人物/记忆存储及正常活动上下文体量；休眠专属数据仍计入正式存档与完整撤回快照的64MiB预算，仅不再作为 AI 输入。没有为省空间删除人物、原记忆或回退记录。未验证真实模型生成质量；本批没有新增模型请求、自动重试或额外收费路径。

## 附：完整修改文件

- `docs/NPC_V2_BATCH1.md`
- `docs/WORLD_EVENT_LIFECYCLE.md`
- `e2e/npc-v2-foundation.spec.ts`
- `e2e/world-handoff.spec.ts`
- `prompts/manifest.json`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `src/domain/commands.ts`
- `src/domain/npc/lifecycle.ts`
- `src/domain/npc/profiles.ts`
- `src/domain/npc/schema.ts`
- `src/domain/sceneTransitions.ts`
- `src/domain/state.ts`
- `src/executors/variableText/catalog.ts`
- `src/prompts/context.ts`
- `src/prompts/sharedContext.ts`
- `src/prompts/worldDomains.ts`
- `src/services/storage/migrations.ts`
- `src/services/storage/turnUndo.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/worldDependencies.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/context-v2-runtime.test.ts`
- `src/tests/event-hierarchy-v2.test.ts`
- `src/tests/fixtures/npcV2.ts`
- `src/tests/npc-v2-foundation.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/recall-v2-runtime.test.ts`
- `src/tests/recall-volume.test.ts`
- `src/tests/scene-text-variables.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/world-handoff-review.test.ts`
- `src/tests/world-handoff-review2.test.ts`
- `src/tests/world-handoff-review3.test.ts`
- `src/tests/world-handoff.test.ts`
