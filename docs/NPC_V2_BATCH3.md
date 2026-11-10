# NPC V2 第三批：建档、重要性与正式变量写入

## 基线与边界

基于重新fetch核对的 `main@e4faf4bb07d5ba519cf2a801cb9e20558b8bf4b1`（PR #97已合并），独立分支 `feat/npc-v2-importance`。本批没有正式星标/人物名录UI，没有四级上下文、额外AI阶段、专用人物筛选模型或新增自动重试。所有人物仍只有ordinary/special。

## 建档与升级职责

真正加载的共享Variables说明及ordinary/special init/update提示词要求：Story/正式设定明确姓名，且有后续接触、持续关系或事件追踪价值时才建档；不能为无名路人编造姓名，也不能用职业/外观称呼冒充姓名。不设互动次数、好感、职位、性别或重要性评分阈值。不建档不影响正文、主角损失/伤害/情报或事件的正常记录。

这些是给AI的创作与状态管理指令，不是程序对姓名或文学内容的关键词审批。合成Mock可证明指令实际进入composePrompt及相应候选的正确处理，不能证明真实模型一定作出合适的建档判断。

创建仍使用原CreateNpc，普通/特殊都支持；重复稳定ID、identityKey、已有别名和初始同伴身份仍按原规则拒绝。新命令PromoteNpc只允许升级普通人物或完善明确待补的特殊资料，没有DemoteNpc，也没有通用kind赋值入口。重要性变化不会更换人物ID/identityKey、关系、好感、记忆或总结。

## V9 数据与兼容

为持久化玩家意图与待完善状态，GameState升级 **V9**；IndexedDB结构仍为 **3**，没有新表、产品版本修改或批量清理。

| 字段 | 含义 |
| --- | --- |
| npc.importancePreference? | ordinary=玩家取消，special=玩家指定；缺省=未干预，不能解释为玩家拒绝 |
| special/profile.profilePending? | true明确标记专属资料待完善；取消后随专属档案休眠 |
| state.npcManagementRevision? | 玩家管理独立CAS计数，缺省按0比较，不是世界时钟或正式回合数 |
| saveControls.lastNpcManagement? | 会话无关的最后一次管理操作回执，仅ID/请求结构指纹/管理版本，不注入AI |

V6/V7/V8使用严格旧字段集解析再升级；V6/V7继续执行上一批的两层原始记忆无损整合，V8只沿用原统一来源和档案。旧数据不补造玩家意图、电话、住址、记忆或人物。旧版初始同伴必须special的原约束仍在旧格式解析后检查；只有新V9正式管理可以改变它。非法旧档、未来V10+与坏引用拒绝覆盖，Repository仍在全部验证通过后事务写回。V1～V5保持主干既有不支持政策。

旧V6/V7/V8完整撤回快照仍在消费时通过同一migrateSave按需读取，不清空已有撤回链、不预先改写快照。旧客户端不能读取V9，应依未来版本保护停止写回；不要手动降低版本号。

## 玩家管理与事务

`SaveRepository.setNpcImportance()`是第五批UI未来接入的正式持久化入口。参数包括saveId、正式expectedRevision、expectedManagementRevision、当前draftRevision/turnId、npcId/identityKey、choice、operationId。调用方必须使用返回的最新state/draft刷新本地视图。

- 使用原同页StageSession与跨标签Web Lock；模型执行期间若锁被占用则明确冲突，保留当前工作，不取消请求或偷偷重试。未来UI应等待或由玩家明确取消后再操作。
- 在原IndexedDB事务内，校验正式版本、管理版本、当前草稿身份/版本和人物稳定身份；读最新状态以保留已完成的后台总结。
- 即时保存玩家选择及实际身份；首次手动升级创建带profilePending的空专属框架，不把空白当作已知人生，不请求模型。存在休眠资料时直接恢复，不重做。
- 保留整份Story、Variables/World候选、已绑定输入与失败现场，仅递增草稿CAS版本。旧生成响应无法覆盖新草稿，旧Commit提交也会冲突；重新读取后的候选仍须原Commit完整重验。如果玩家取消使原升级候选变得非法，拒绝提交并保留Story/候选供现有重试功能恢复，不自动Roll。
- 管理不提升世界revision、回合数或时钟；这不是撤销CAS：新入口必须匹配独立管理计数及草稿CAS。正常三阶段的expectedRevision、版本校验和事务均保持原机制。
- 旋转持久化epoch阻止旧总结写入，不清空本地付费尝试、失败或限流账本，不自动重试。成功保存的总结仍在最新状态中保留。
- 最新管理回执保证相同operationId/请求不重复修改，冲突/失效回执拒绝。事务任何写入失败均回滚档案、草稿和control；不修改正式Turn回执及撤回记录。

玩家取消后importancePreference=ordinary，PromoteNpc会结构性拒绝AI重新升级。玩家再次升级设为special并恢复档案；没有玩家意图的普通人物仍允许AI判断升级。

## 撤回与初始同伴

V9初始同伴只要求原稳定身份仍存在，不再要求永远special。取消时专属经历、目标、习惯、关系网、私密资料进入原休眠结构；基础身份、关系、统一记忆、总结与未确认好感语义留存。创角不会重建同伴。

撤回依旧原子消费完整快照、提高正式revision、防止Redo和旧时间线结果复活，5回合/64MiB不变。新增的唯一恢复衔接是 `retainNpcChoices()`：对恢复点内仍存在且identityKey相同的人物重新应用当前玩家选择，资料只能来自恢复点本身，不把当前未来专属档案带回过去。恢复点不存在的人物不会因选择被复活。管理计数保持当前值，旧请求不能借撤回回到旧CAS版本。

## Variables 正式路径

| 文本路径 | 正式操作 |
| --- | --- |
| set npc[id].specialProfile={detailedBackground,activeGoals,habits,offscreenTaskIds,relationshipNetwork?} | PromoteNpc，原身份升级/待完善核心资料补齐；已存在非空资料不能被补齐操作覆盖 |
| set npc[id].specialProfile={} | 仅恢复已有休眠档案；无档案时不能用空对象虚构完成 |
| set npc[id].phoneContact | UpdateNpc，unknown/known/invalid，旧RegisterContact不推断电话 |
| set npc[id].usualLocations | UpdateNpc，真实地点、home/work/frequent及独立knownToProtagonist |
| set npc[id].detailedBackground/habits/relationshipNetwork | 已有特殊人物UpdateNpc，关系网可只记未建档姓名，好感单向且未知可缺省/null |
| set npc[id].privateProfile | 原七字段入口与原资格/不可覆盖初次经历规则，未替换 |

任务引用必须真实且归属当前NPC，人物引用与地点仍通过正式Schema核验。普通人物不能写入休眠专属字段，World不取得以上新增写权限，实际World命令Schema也排除了新UpdateNpc字段。完整私密资料恢复仍遵守原成年女性资格；不符时保留档案并拒绝恢复，不删除内容。

文本目录由74项变为80项（5个新增UpdateNpc字段及specialProfile），领域命令总数27→28，Variables可用24→25。原VARIABLE_TEXT_V1三标签四操作不变。旧候选、旧文本别名与幂等指纹继续兼容；新命令中identityKey由编译器从稳定表解析，同批新建人物也维护该映射。

## 实际上下文与香闺秘档

Variables增加仅含身份/选择/待完善/可恢复标记的NPC_IMPORTANCE；休眠正文不在其中。共享SAVE_STATE、NPC_KNOWLEDGE和召回仍排除dormantNpcProfiles，普通人物统一记忆照常读取；没有提前改造四级上下文，没有裁剪正式世界资料。

香闺七字段bodyDescription、chestDescription、pussyDescription、isVirgin、firstExperienceTarget、firstExperienceTime、firstExperienceText完整保留，覆盖升级后的实际Variables文本→编译→候选→Commit→重载、初次经历不可覆盖、玩家休眠恢复、总结来源不变。原privateProfile提示词块逐字未变，init/update块SHA-256仍为 `830d8711b84f461925e8cb12dfcb64bcee1b8343b932adf6403ed47bbe147e98`。

Manifest使用原脚本刷新；sources.lock追加npcImportanceV2记录，保留旧来源。prompts/docs/OUTPUT_CONTRACT只追加当前命令契约，没有重新加载废弃JSON提示词。

## 测试记录

全部为合成状态、fake-indexeddb、真实Repository与本地Mock；无真实玩家存档、无付费API调用。各独立批次分别记录，不相加：

| 批次日志名 | 总数 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| first | 16 | 14 | 2 | 0 |
| target-second | 123 | 115 | 8 | 0 |
| target-third | 181 | 181 | 0 | 0 |
| new-expanded | 22 | 20 | 2 | 0 |
| new-final | 24 | 22 | 2 | 0 |
| new-fixed | 24 | 24 | 0 | 0 |
| prompts-target | 117 | 115 | 2 | 0 |
| target-fixed | 183 | 182 | 1 | 0 |
| last-target | 57 | 57 | 0 | 0 |
| full-first | 2962 | 2956 | 6 | 0 |
| full-final | 2962 | 2962 | 0 | 0 |

初跑问题：World目录替换含refinement的Zod对象须用safeExtend；新建特殊NPC夹具误带创建Schema不接受的关系网字段，改为现有创建格式，关系网单独通过UpdateNpc写入。后续失败主要是V9/命令数量/初始同伴旧断言与两处测试文案字面不一致，逐项同步产品规则；没有降低实体、时间、来源或事务校验。TypeScript曾发现safeExtend联合类型窄化、fake-indexeddb构造类型、可选导出数组访问；ESLint曾发现3个未使用导入，均已修正。

完整Vitest最终2962通过/0失败/0跳过。构建存在主干已有的>500kB bundle警告。最终 `npm run prompts:check` 93通过/0失败/0跳过；`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 均成功。E2E夹具修正后再次执行TypeScript/ESLint。

首批相关Chromium：70项，desktop33通过/2失败，mobile33通过/2失败，0跳过/自动重试。四项失败均为新增发送测试：旧summary合成状态没有待输入TurnDraft，界面正确显示“草稿不可用”并禁用发送，因此模型请求未发出。夹具通过正式createTurnDraft/saveDraft补齐合法待输入回合；没有修改生产界面保护、超时或业务断言。首批Trace保留于 `/workspace/npc3-evidence/browser-first/`。修正后新增定向6/6通过（desktop3/mobile3），0失败/跳过/重试。最后重新执行相同完整相关集合：**70/70通过，desktop35/mobile35，0失败/跳过/自动重试**，耗时342.2秒。此为独立完整批次，未将66与6相加冒充最终结果。

最终浏览器命令：

```sh
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-importance.spec.ts e2e/npc-unified-memory.spec.ts e2e/npc-v2-foundation.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/world-handoff.spec.ts --project=desktop --project=mobile --reporter=json
```

工程命令：`npm test -- --reporter=json`（最终2962/2962）、`npm run prompts:check`（93/93）、`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check`。最终完整Diff自查通过。未运行无关Chromium全量；未调用真实付费模型，未操作真实玩家存档。

验证覆盖：实际Runtime请求与三阶段自动Commit；首次AI创建/升级、玩家先行待完善、下一轮拒绝重升与直接恢复；V6/V7/V8迁移及完整撤回快照；旧回执重放、写入配额故障原子回滚、旧草稿CAS拒绝、旧总结epoch拒绝；七字段原文/来源不丢失与新属性引用/数值边界。

## 剩余边界与第四批

- 不提供正式星标UI；本批持久化API已具备，第五批接入返回状态和忙碌/冲突提示。模型运行中管理遇锁会拒绝，不能伪装立即成功或自动取消收费请求。
- 旧候选受玩家选择影响时可能合法失效；保留原始候选和Story，继续现有阶段重试，不自动付费重做。
- 大量手动标记人物时，撤回需逐人应用选择并完整校验，尚未做1000个人物管理选择的性能压测。
- 有冲突ID/坏来源的旧存档继续安全拒绝，不开发自动修复。旧客户端不能处理V9。
- Mock不证明真实模型的建档或人物重要性判断质量。没有新增文学审查或自动“纠错”请求。
- 第四批承接在场普通/特殊、离场普通/特殊的上下文层级；统一记忆、玩家优先权和档案休眠边界应继续保留。第五批再实现星标与完整人物名录。

## 修改文件清单

共44个文件，含必要的数据协议、编译器、存储与恢复接线、提示词、测试及文档；无NPC页面/UI改造。

```text
docs/NPC_V2_BATCH2.md
docs/NPC_V2_BATCH3.md
docs/WORLD_EVENT_LIFECYCLE.md
e2e/npc-importance.spec.ts
e2e/npc-unified-memory.spec.ts
e2e/npc-v2-foundation.spec.ts
e2e/world-handoff.spec.ts
prompts/docs/OUTPUT_CONTRACT.md
prompts/manifest.json
prompts/shared/07_command_output.md
prompts/sources.lock.json
prompts/variableGroups/npc_ordinary/init.md
prompts/variableGroups/npc_ordinary/update.md
prompts/variableGroups/npc_special/init.md
prompts/variableGroups/npc_special/update.md
src/domain/npc/profiles.ts
src/domain/npc/schema.ts
src/domain/state.ts
src/domain/variableCommands.ts
src/executors/variableText/catalog.ts
src/executors/variableText/compile.ts
src/executors/variableText/diagnostics.ts
src/executors/variableText/entities.ts
src/prompts/context.ts
src/services/storage/migrations.ts
src/services/storage/saveRepository.ts
src/services/storage/turnUndo.ts
src/services/validation/commandCatalog.ts
src/services/validation/worldOutput.ts
src/tests/context-v2-runtime.test.ts
src/tests/domain.test.ts
src/tests/event-hierarchy-v2.test.ts
src/tests/npc-importance.test.ts
src/tests/npc-unified-memory.test.ts
src/tests/npc-v2-foundation.test.ts
src/tests/prompt-runtime.test.ts
src/tests/prompts.test.ts
src/tests/recall-v2-runtime.test.ts
src/tests/recall-volume.test.ts
src/tests/text-prompt-readiness.test.ts
src/tests/turn-commit.test.ts
src/tests/variable-commands.test.ts
src/tests/world-handoff-review.test.ts
src/tests/world-handoff.test.ts
```
