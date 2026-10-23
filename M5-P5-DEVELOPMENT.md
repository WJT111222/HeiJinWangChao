# M5-P5：动态世界自主承接、任务成果与 NPC 安全退场

## 基线与范围

- 从已合并 M5-P4 的 `main@f9c3bc2b8f0e106fdaeec601c856af1d5034474a` 创建 `codex/m5-p5-world-handoff`。
- 继续使用 WorldStage、真实 Manifest/Composer、三协议 Runtime、StageGuard/CAS、IndexedDB 回合事务和提交回执。没有新增 AI 阶段、客户端、模型路由或玩家设置。
- World 只保存候选；任务结果、联系人、身份历史、记忆留存、NPC 删除在现有正式回合提交中一起生效。没有 M5-P6、NPC 小正文、部署或合并操作。

## 审计结论与产品决策

原实现有三处实际缺口：任务没有独立成果记录；同批终结后仍保守占用 NPC 名额；没有持久联系人集合且历史参与者引用强制要求完整 NPC 实体存在。

旧 shared/08 的“同批禁止接力”和仅靠终止谓词的取消校验与本次产品决策冲突。本轮以新指令为准：允许独立来源验证后的同窗口承接，以同次世界 AI 的明确结构化决策判断复杂任务结果；程序继续验证时间、身份、状态、条件、来源、权限与事务。没有强制后续任务、固定接力深度、固定耗时或额外裁判请求。

最先添加并运行两项失败测试，分别复现：当前 Schema 不接受任务成果/决策对象；RegisterContact 不能解析。之后补充真实验证、WorldStage、存储提交和浏览器回归。

## 数据结构与迁移

正式存档 schemaVersion 升级到 4（包含对首版 V3 预览的修复迁移）。数据库 object-store 版本仍为 2，不增加第二套人物或记忆数据库。

| 数据 | 用途与限制 |
| --- | --- |
| `contactNpcIds` | 明确且永久的联系人归属。新档初始同伴自动登记；变量阶段可依据正文实际联络事实执行 RegisterContact。无移除保护命令。人物面板可见不等于联系人。 |
| `contactReviewNpcIds` | 旧档联系人身份待确认的临时保护，不是正式联系人；未复核不删除。无联系证据的临时人物可在RetireNpc中明确复核，存在既往联系痕迹则需可靠的主角确认。 |
| `retiredNpcs` | 仅含 id、identityKey、name、aliases、retiredAt、sourceTurnIds。保留稳定历史身份，不保存职业、性格、背景、目标、关系、原始私人记忆或完整 NPC 备用档案。 |
| `WorldTask.resolution?` | at、outcome(success/failure/cancelled)、result、reason、sourceTurnId。由已校验 evidence 决策和当前回合确定性建立，模型若提供必须完全吻合。旧终态不会静默补造时间或成果。 |
| `WorldTask.handoff?` | fromTaskId、at、channel、content、necessity、knowledgeKind(observed/reported)。只描述实际传递的具体成果和必要职责，不传递发送者全部私有知识。可选summaryBasis(mode=faithful_summary,resultExcerpt)区分可核验原文依据与AI忠实概括。 |
| `memories.long[].retiredNpcSource?` | npcId、sourceMemoryId、knowledgeKind、knowledgeSource。标记退场时选择留存的局部历史材料，保存原始回合、时间、认知性质与权限。不是整回合压缩覆盖。 |

V1 严格验证后补齐原有天气/环境；V1/V2迁移不再把所有NPC永久登记为联系人，仅初始同伴保持确认，其余人物保留完整实体并进入contactReviewNpcIds。V3预览也迁移至V4：真实RegisterContact命令凭据与初始同伴确认正式身份；曾列在contactNpcIds但缺少确认凭据者改为待复核，不能自动删除；原本就未登记的V3非联系人不被无故加锁。所有迁移保持幂等，未知身份不会被默默认定为联系人或非联系人。

待复核与永久联系人分离是本轮审查修复，取代首版“全部旧NPC永久保护”的不合理策略。只有沿用系统中性未接触标识且无既往互动、已确认关系倾向、公开记忆/事件/journal引用等联系痕迹的人物，才允许世界AI明确声明no_known_connection复核；有联系痕迹者继续保留，除非当前正文中存在可靠主角确认(player_confirmed)。真实联系人和初始同伴不能通过该复核解除永久保护。

升级不推进 revision、worldClock，不重写 journal、既有任务、记忆或回执。损坏/未来版本拒绝读取和覆盖。真实 IndexedDB 回归验证升级、旧回执重放以及继续下一正式回合。

历史任务的终态执行者、事件历史参与者、时间线、journal 和记忆引用可以指向最小身份历史。未终结任务的执行者、当前物品/资产所有者、组织关键成员、初始同伴和私人总结所有者仍必须有完整活跃实体。全局 ID 和 identityKey 在活跃及退场集合间仍唯一。

## 世界执行与承接流程

1. 原 WorldStage 重新读取正式存档和最新草稿，复验变量并从同一正式 revision 构造时间投影。
2. Composer 保持 opening/world、regular/world 两套主模板、九域规则、实际命令目录与 WORLD_SOURCES。OFFSCREEN_STATE 的活跃任务列表不再重复调度终态；终态结果仍可作为受权限约束的历史来源。
3. World AI 在同次请求内判断任务终结、实际结果、是否需要承接、接收者是否有职责和资源、原人物是否有后续职责。无必要就自然结束，不建接班人或后续任务。
4. `orderWorldCommands` 按真实来源、任务/事件前置条件及交接来源排序。先独立验证前序，才加入因果投影和来源池；不存在来源、自证、循环依赖拒绝。task-plan来源与原任务使用同一依赖和状态约束。新人物/组织须先验证，才能成为后序身份来源。
5. 完成/取消旧任务继续要求自身 task:id，事件结案继续要求自身 event:id。到期不代表执行、完成条件或阻碍消失。普通行动不能替代目标来源。
6. 现有 `evidence.decision` 使用 targetId、status、reason、result、conditionsSatisfied、continues、可选 failure。完成须条件成立、实际经过时间且不继续；失败终止或取消必须明确结束职责；受阻继续占用。不要求固定完成/终止词语，允许“清单没有遗漏”等合理措辞。旧凭据仍按原保守反证规则校验。
7. 新任务需承接时，前序必须已合法终结并有实际 resolution。旧逐字交接引用result片段；忠实概括使用summaryBasis.resultExcerpt锚定真实结果，content可以整理转述，fact可以另述交接动作，不要求两段正文相同，另需接收者自身职责来源；发送者仍须是合法活跃场外执行者。`resolution.at <= handoff.at <= task.startAt`，新增交接不能回填到本轮正式起点之前，也不能超出本轮窗口。
8. 使用新的确定性任务区间检查替代旧的“同批永不释放”。每 NPC 最多一项 planned/active/blocked；新职责不得早于前项实际释放时间。组织可以承接自身职责，不强迫创建个人。原任务执行者、目标、开始时间、完成条件不变。
9. 候选整批从同一正式基线模拟，保存完整成果元数据后返回。正式提交重新校验，并验证重新解析后的世界结果与已保存候选指纹完全一致；不在提交边界静默补字段。

旧待提交世界候选如缺少本轮要求的完整成果元数据，需要显式补算世界阶段；正文、变量、正式状态及旧提交回执保留。已提交的旧终态仍可读取，不补造成果；没有可靠结果的历史任务不能被用于新交接或冒险退场。没有移除任何 CAS、StageGuard 或回执检查。

## 信息隔离

- 原执行者知道、结果客观成立、接收者获得内容、主角已知分别处理。
- `task:<taskId>`只把实际resolution.result及程序状态/时间投影为成果事实；目标、条件和理由置于task-plan:<taskId>，性质仍为plan。整个任务JSON、收到的报告不再作为fact。旧任务没有可靠resolution时保留为plan，不补造世界真值。
- `handoff:<taskId>` 是接收方独立来源，仅包含实际传递片段。reported 保持转述性质；不能直接据此认定世界真值或标记 player_known。
- 非公开事件的 worldEventOnly 继续禁止作为人物行动/任务/新认知授权；组织任务同样不能通过隐藏事件 ID 洗掉人物私有来源。
- 原人物退场不意味着可以继续以其旧任务 ID 伪造当前私人通信。已有实际交接的接收者可继续履行自己的职责；若人物真实再出现须先以可靠历史身份建档。
- 原 hidden 事件不能因为参与者退场、存在交接或进入内部历史就公开。已有终态事件不改写；公开报告可作为有正文事实的新事件记录，并按既有重大/已知/结案规则进入时间线。
- 所有公开 NPC 原始记忆必保留；AI 选择的必要私有材料以 internal 历史留存，未选的一般私人资料随完整实体清理。所属私人总结一起移除，其他 NPC 原始知识及总结不被改写或授予新认知。
- 局部材料的 retiredNpcSource 不计为 publicShortMemories/compressionCandidates 的整回合覆盖，不抑制原短期摘要；普通正文仍只获取 player_known 资料。未公开退场材料不进入变量认知输入、玩家面板、普通历史检索或其他 NPC 来源。
- 没有变更现有人物面板可见范围；只添加联系人标签，没有引入角色迷雾或全面联系人 UI。

## 安全退场与历史一致性

世界专属 `RetireNpc(npcId,expectedIdentityKey,reason,retainMemoryIds,contactReview?)`；需要针对同一人物的 retired 决策、无继续职责声明、必要成果处理依据与匹配原因。旧档待确认人物还需contactReview={conclusion:non_contact,basis:no_known_connection|player_confirmed,reason}，该受限复核不能解除真实联系人的永久保护。

确定性拒绝：联系人、初始同伴、正式或变量投影现场人物、未终结任务、特殊 NPC 的有效长期目标、组织关键职务、当前物品/资产持有、未安全接续的重要事件引用、缺少独立成果的旧任务、无效/歧义记忆来源。不能为方便删除而自动取消职责或转移财产。

同批先保留结果、实际接班职责和必要材料，最后才删除实体。未完事件若已经有明确的合法接班任务，可保留原历史参与者；后续组织可在不召回原 NPC 行动的情况下正常推进/结案。终态历史执行者不改派。

未来真实再出现可复用已有历史 id/identityKey/name，通过已有 CreateNpc 恢复**当前**实体；换 ID 伪装成另一人拒绝。没有恢复完整旧档或编造旧关系/记忆的机制。

## 原子性、幂等与恢复

未新增后台写库通道。WorldStage 沿用取消、请求版本、正文版本、变量版本、执行版本及 StageGuard；候选保存不改正式状态。正式 commitCommands 对克隆投影整批执行，NPC 清理最后处理；回合提交仍由原 saves/drafts/turnReceipts 一个事务写入。

测试验证：Roll 使旧候选失效但正式人物仍在；取消/迟到/跨标签草稿变化拒绝旧删除结果；提交回执重放不重复交接/删除；drafts 写失败、receipt 写失败和显式事务 abort 全部回滚；重试后仅提交一次。历史只读视角回合不允许任何任务推进、交接或退场。

没有新增经济或后台物品权限；World 依旧不能直接变更主角资金、资产、装备或代替其作决定。未支持的费用或物资变更只能 unresolved，任务结果文字不等于正式账本变化。

## 修改文件

新增：

- `src/domain/npc/contactReview.ts`：区分旧档身份待确认及已知联系保护。
- `src/domain/npc/lifecycle.ts`：任务占用/区间、退场与局部历史留存。
- `src/services/validation/worldDependencies.ts`：验证依赖顺序和循环拒绝。
- `src/tests/fixtures/handoff.ts`：隔离测试数据。
- `src/tests/world-handoff-review.test.ts`：本轮三项审查问题的跨回合反例、迁移复核及概括交接正反回归。
- `src/tests/world-handoff.test.ts`：完整因果、权限、存储、迁移及故障回归。
- `e2e/world-handoff.spec.ts`：桌面/移动候选、查看、刷新、正式存储提交、回执及联系人标签。
- `M5-P5-DEVELOPMENT.md`：本报告。

修改按职责分组：

- 领域：`commands.ts`、`events/schema.ts`、`state.ts`、`turnCommit.ts`、`memories/schema.ts`、`memories/publicMemory.ts`、`memories/compression.ts`。
- 校验/迁移：`storage/migrations.ts`、`validation/commandCatalog.ts`、`validation/evidence.ts`、`validation/turnCommit.ts`、`validation/worldEvidence.ts`、`validation/worldOutput.ts`。
- 提示词接入：`src/prompts/context.ts`、`src/prompts/worldDomains.ts`。
- 小范围展示：`src/ui/panels/playerView.ts`、`src/ui/panels/Panels.tsx`。
- 协议资源：`prompts/shared/07_command_output.md`、`08_world_output.md`、`docs/OUTPUT_CONTRACT.md`、`manifest.json`、`sources.lock.json`。运行资源更新版本、字符数、哈希和来源记录。
- 既有测试适配：`prompt-runtime.test.ts`、`prompts.test.ts`、`saveRepository.test.ts`、`turn-commit.test.ts`、`variable-commands.test.ts`、`world-lifecycle.test.ts`。仅适配新命令数量、V3/V4迁移及程序建立的成果字段，保留所有旧用例与安全断言。

未修改六套主模板、两本世界书、用户 NSFW 正文、七项写作设置、三套执行器/协调器或正式存储事务实现。

## 验证记录

所有 AI 请求使用 Mock，没有真实付费模型调用。

| 命令 | 结果 |
| --- | --- |
| `npm run prompts:check` | 82/82，通过 |
| `npm run check` | 885/885；ESLint、TypeScript、Vite生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 140/140，通过；桌面与移动端，8.2分钟 |
| `git diff --check` | 通过 |

- 基线：817 项单元/集成，134 项 Chromium E2E；本轮保留全部。
- M5-P5累计新增：68项单元/集成、6项浏览器执行（3场景×桌面/移动）；本轮审查修复新增20项单元/集成、2项E2E，并扩充原交接场景验证非逐字概括。
- 最终单元/集成总数：885 项单元/集成、140 项 Chromium E2E；prompts:check 的82项是前者子集，不重复计数。
- 新 E2E 用真实 UI 生成/主动查看/刷新候选，再调用真实 Repository 正式提交，以隔离生命周期验证并避免额外下一轮请求；原完整发送及连续十回合 UI 用例继续保留。
- 一次开发中的 E2E 运行被源码热更新干扰（面板重载），已中止，不计为最终通过；最终整套检查期间冻结应用源码。
- 截图：Playwright 对桌面/移动的新场景生成 `world-handoff-committed.png`，位于对应 `test-results/world-handoff-*` 目录；测试产物不混入正式存档或Git。

## 已知限制与待办

1. 复杂语义（实际成果是否充分、通信是否可信、原人物是否还有隐含职责）由同次世界 AI 判断，程序不声称能证明所有自然语言。结构化决策不是额外裁判或真实内部思维链。Mock 成功不代表真实模型长期稳定性验证。
2. 重复交接按同一前序成果、接收者与目标识别，循环依赖严格拒绝；不能保证识别所有通过改写目标措辞制造的语义循环。没有固定接力深度或机械截断。
3. 未解决的自由文本前置条件/阻碍不会因模型打勾而被程序清除；无法确定性验证时仍 unresolved/blocked。实际组织任务若暗中依赖忙碌个人而没有结构化 actorRef，仍需模型遵循职责规则，不宣称程序能识别所有文字执行者。
4. V1/V2及V3预览中没有可靠联系人凭据的人物保留为待复核；有联系痕迹者不能仅凭AI自称无联系就删除，可能需要正文中的明确主角确认。没有新玩家设置、全面联系人UI或解除永久保护命令。
5. 概括是否忠实由同次世界AI判断；程序核验原始依据、角色权限、时间和知识性质，不能通过字符串证明任意自然语言概括没有虚构。伪造原始片段、越权来源与越时确定性拒绝，不使用额外裁判模型。
6. 未能安全处理资产持有、组织职务或重要职责引用的人物继续保留。后台经营/物品/经济扩展不在本轮，不能以退场名义清空这些引用。
7. 只留最小稳定身份及 AI 明确选择的必要历史材料，不提供完整私密档案恢复、永久休眠池或 NPC 独立叙事。未公开历史材料不自动成为当前人物知识。
8. 旧未提交终结候选缺少完整成果元数据时需显式补算世界；已提交历史和幂等回执继续可用。当前UI仍复用通用结算失败提示，恢复方式是点击“重新生成世界候选”，无需重Roll正文。

完成后停在 Draft PR，等待代码审查与项目负责人批准。


## PR #22 首轮审查的第二轮修复记录

审查依据：[issuecomment-6360952008](https://github.com/WJT111222/HeiJinWangChao/pull/22#issuecomment-6360952008)，审查头提交d6ff7bf。本轮只修复三项问题，不重构原M5-P5。

先增加三个失败测试，实际复现：A报告经B的handoff保存、B完成其他职责并正式提交后，C通过task JSON将报告认定为世界事实；V2迁移永久误标；合理概括被逐字匹配拒绝。三项在修复前均失败。

修复1：任务事实材料不含handoff、目标、理由，收到的报告仅以所属人物的handoff来源保持reported/statement。计划材料独立暴露为task-plan并沿用原任务依赖/权限。新增跨两次正式提交的反例、NPC转述不得变为observed、真实成果继续可引用等正反测试。

修复2：V4新增独立待复核集合，V1/V2/误标V3迁移均不自动删除NPC。真实登记命令凭据及初始同伴仍永久保护；疑似旧联系人继续暂缓。有充分无联系依据的临时人物经明确复核后可在原子提交中安全退出。验证了迁移→候选复核→正式退场、明确主角确认、登记正式联系人、V3纠错、刷新、写入失败回滚和回执幂等。普通UI仅增补待确认标签，无新设置。

修复3：可选summaryBasis保留原始成果片段，交接content允许忠实概括，fact可描述通信动作。程序继续核验原文锚点、稳定ID、合法发送者与接收者、时钟、来源权限与认知性质。旧逐字交接不变；伪造未掌握资料/不存在的锚点、越权、错误来源和时间越界拒绝。浏览器沿真实WorldStage验证概括候选、刷新、提交后仍reported，并验证V3待确认标签。

本轮提示词只更新shared/08和OUTPUT_CONTRACT的增量契约及对应Manifest版本、字符数/哈希/来源锁；双世界书、六套主模板、NSFW正文和七项设置未改。正式提交、CAS、StageGuard、回执和存储事务不变。构建成功，Vite提示主bundle略超过500kB压缩前阈值（gzip约158kB），未为本次修复扩展无关的代码分包重构。全部模型请求Mock，无真实付费调用。
