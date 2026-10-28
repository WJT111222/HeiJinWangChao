# M8-P0C-3D-1：文本变量正式协议准备

## 基线和范围

基线：`93f6b2febebf09568f5008f16d2406c5cd3345b9`（PR #40）。分支：`codex/m8-p0c3d1-text-protocol-readiness`。

本轮只补文本表达能力与提示词准备。正式 runStageRequest、VariableStage、WorldStage、TurnCoordinator、提交事务和存档Schema均不切换。没有新增来源审批、覆盖许可、审查封印、剧情正则或模型调用。

## 覆盖审计

原DomainCommand共有24类，正式JSON变量目录含23类（RetireNpc仅World）。原文本已支持17类。此次补齐CreateNpc、RegisterContact、CreateOrganization、RecordOrgRelation及UpdateNpc/RecordNpcMemory原有子能力后，文本覆盖21类；SaveTask、SaveEvent、RetireNpc留给World/3D-2，不在现场Variables中伪造后台结果。

| 旧JSON领域操作 | 文本路径/操作 | 说明 |
| --- | --- | --- |
| UpdateProtagonist | set protagonist.healthText/emotionText/locationId/profession/publicStatus/legalStatus/skills | 原有白名单，技能为字符串数组 |
| SetWorldClock | set worldClock | 普通回合合法ISO时间、不倒退；开局由Story程序时钟统一注入一次 |
| CreateLocation | set locations[id] | 原有name/parentId对象，ID来自路径 |
| CreateNpc | set npc[id] | **新增**，原NpcSchema完整对象去掉id，ordinary/special，开局和普通回合均可 |
| UpdateNpc | set npc[id].healthText/relationshipText/locationId/onScene/lastInteractionAt | 原有现场字段 |
| UpdateNpc.affinityChange | set npc[id].affinityChange | **新增** {from,to,reason,relationshipText}；同一命令包含关系说明，保留[-100,100]/真实前值；同伴未确认from=null |
| UpdateNpc.activeGoals | set npc[id].activeGoals | **新增** 字符串数组，仅special |
| RegisterContact | set npc[id].contact | **新增** {reason}；永久联系人保护不撤销 |
| RecordNpcMemory | push npc[id].memories | 原有个人记忆 |
| RecordNpcMemory.longTerm | push npc[id].longTermMemories | **新增** 仅special的长期原始记忆，不是压缩 |
| RecordNpcMemory.addToKnownInformation | push npc[id].knownInformation | **新增** 同时保存原个人记忆及知晓条目，保持认知性质 |
| CreateOrganization | set organizations[id] | **新增** 原四类组织Schema完整对象去掉id |
| RecordOrgRelation | set organizations[id].protagonistRelation | **新增** {relation,reason}开放关系文字，记录原relationHistory |
| SpendFunds | add economy.cash/onlineBalance = 负整数分 | 原有消费 |
| ReceiveIncome | set economy.incomes[id] | 完整原收入记录去掉id，received正金额 |
| TransferFunds | push economy.transfers | {from,to,amount} |
| Borrow | set economy.debts[id] | {account,debt:原债务去掉id} |
| RepayDebt | push economy.debts[id].repayments | {account,amount} |
| AcquireItem | set items[id] | 原ImportantItem去掉id |
| PurchaseItem | set items[id].purchase | {account,price,item:原物品去掉id} |
| UpdateItem | add items[id].quantity / set items[id].conditionText/locationId | 数量前值由程序生成 |
| TransferItem | set items[id].transfer | {from,to} |
| LoseItem | set items[id].loss | {expectedOwner,conditionText,locationId?} |
| SetEquipment | set protagonist.currentWear | 完整原Equipment |
| PurchaseVehicle | set economy.vehicles[id].purchase | {account,price,vehicle:原车辆去掉id} |
| SaveTask / SaveEvent | 暂无现场文本路径 | World任务/事件生命周期不在本轮接线 |
| RetireNpc | 无Variables路径 | 原JSON也仅允许World |

新增8种路径，原30种保留，共38种。所有创建稳定ID由路径注入，值中不重复提供id；不支持数字NPC索引、任意补丁、整表覆盖或未知字段。

## 原生命令缺口（不伪造初始化）

- 未知现金/线上余额仍是null。原命令没有SetBalance/InitializeEconomy，不能直接赋值，也不能用无记录正add冒充收入；ReceiveIncome/Borrow要求余额已知。这是正式切换前必须决策的实际开局缺口，旧JSON同样不能安全完成该操作。
- 原领域层没有现有房产/车辆/其他资产的无交易登记、房产购买或任意债务初值登记命令；不能用PurchaseVehicle或Borrow冒充历史已持有资产/旧债。已有合法初始数据保留。
- CreateNpc能写完整普通/特殊NPC档案；已有NPC的姓名、年龄、身份、外貌、性格、技能、习惯、detailedBackground、offscreenTaskIds等没有对应UpdateNpc字段，本轮不提供自由覆盖器。目标、关系、健康、地点、最近互动与原始长期记忆可以更新。
- 组织创建保留四类原结构；已有组织的经营、资金、任务等无通用更新能力，仅关系可变。

## 执行语义

仅对已解析稳定ID和有限字段进行映射；新NPC加入本批可引用集合，使后续现场更新、记忆、联系人、装备归属及组织keyNpcIds可使用新ID。最终整批仍由原commitCommands执行并校验；引用先后、身份重复、好感前值、类型、归属和场景一致性由原领域语义处理。编译不写库。没有按NPC在场状态增加审批。

记忆继续由程序生成确定性memoryId、sourceTurnIds、affectedEntityRefs和游戏时间；AI选择observed/reported/suspected及visibility/knowledgeSource，转述与推测保留原标记。knownInformation路径复用RecordNpcMemory的addToKnownInformation，不给其他NPC自动复制记忆。

## 失败复现和验证（阶段性记录）

先运行7项新验收（普通回合新NPC+同批更新、特殊目标/长期/知晓、好感/联系人、四类组织创建关系），原实现7/7均因unsupported_path失败。随后才新增有限映射。

随后补齐了真实提示词组装、示例执行、完整实例与3D-2接线清单。另用2项失败测试复现共享04/05仍要求程序命令元数据及旧JSON错误数组的冲突，才为文本协议单独适配，正式JSON/Story/World共享资源保留逐字快照。

## 模块化Prompt准备与正式入口隔离

直接把原Variables提示词改为文本、同时保留JSON解析器，会使现有正式回合请求失败。因此本轮保留23份原变量及必要共享资源的逐字快照于`prompts/legacy/variables_json/`，原模块ID、角色、顺序、域选择和模式不变；Manifest中标记`variableProtocol=json`。这些快照均与基线git对象逐字核对，不是新写一套JSON规则。

原要求路径已更新为文本版本，使用原ID加`.text`后缀注册，标记`variableProtocol=text`、版本`1.0.0-text-v1`，仅适用于Variables，默认不被现行请求选择。两套资源按协议互斥，不重复注入。源文件、SHA-256、字符数、来源锁和固定顺序都可验证。原六套主模板继续供正式请求使用；另两份文本变量主模板供明确的离线准备入口使用，不是第七/八个AI阶段。开局World仍使用原组织init快照，不误加载新文本Variables指令。

`composeTextVariablesPrompt()`只做真实Manifest选模块/加载原文/占位符替换/上下文组装，无网络、无AI、无存储；不能组装Story或World。它移除旧COMMAND_CATALOG，改用真实38条文本路径的TEXT_COMMAND_CATALOG值结构。目录使用原经济、物品、NPC、组织、地点与变量命令Schema派生，只描述有限值类型，不增加审批。`composePrompt()`和真实runStageRequest仍默认JSON；不新增玩家协议开关，也不自动猜测回复格式或创建双解析执行链。

| 模块 | 本轮变化 |
| --- | --- |
| shared/07_command_output | 唯一命令块、set/add/push语义、38路径目录、无变化可空块、说明不执行；删除旧顶层JSON输出要求 |
| shared/04_state_authority、shared/05_context_protocol | 文本组装由程序生成命令元数据，缺口放说明；避免共享规则重新要求JSON字段；正式入口仍用旧文快照 |
| opening/variables | 只初始化本幕必要现场状态，保留创角及同伴；Story开局时钟由程序应用，不重复计时；显式说明缺少余额/旧资产初始化命令 |
| regular/variables | 普通回合新NPC也可建档，已有ID更新；现场变化与World后续分工；说明未支持操作 |
| protagonist init/update | 白名单主角字段、skills字符串数组、地点增量、完整Equipment；不创建第二主角 |
| npc_ordinary init/update | 完整新人物、现场字段、结构化好感、联系人、个人/知晓记忆；稳定身份去重，不设额外在场授权 |
| npc_special init/update | 继承普通能力；完整特殊字段、目标替换、长期原始记忆；无现成更新字段不假装可改 |
| items init/update | 获得/购买/赠送/遗失、数量/状态/位置、装备，明确车辆房产不重复登记 |
| economy init/update | 整数分、完整收入/借款记录、内部转账/还款、车辆购买；未知金额和旧资产登记缺口写说明 |
| 四类org init/update | 各自原生结构创建，keyNpcIds/currentTaskIds合法引用；开放文字关系更新，未支持经营变化不编路径 |

只更改上述21份变量文本资源及共享04/05两份必要文本资源，offscreen、两本世界书、Story/World原模板、Thinking、NSFW及七项设置未改。原NPC审核补丁的字节保护测试转至冻结JSON资源，依旧验证全部前缀/已审核附录；新文本适配另用真实组装和示例执行验证。原文件没有删除。

## 完整示例

下面示例前提：主角`hero`位于`chongqing`、cash=10000，游戏时间已确定；本轮首次遇到社区同事。

```text
<说明>记录本幕第一次交流、收到报酬和购买手机；不处理后台任务。</说明>
<命令>
set npc[lin] = {"kind":"ordinary","identityKey":"lin-community-worker","name":"林宁","aliases":[],"skills":[],"onScene":true,"locationId":"chongqing","affinity":0,"relationshipText":"初次见面","memories":[],"knownInformation":[]}
set npc[lin].healthText = "健康"
set npc[lin].affinityChange = {"from":0,"to":5,"reason":"共同解决问题","relationshipText":"愿意协作"}
set npc[lin].contact = {"reason":"交换联系方式"}
push npc[lin].memories = {"text":"共同处理社区问题","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}
set organizations[community] = {"kind":"civil","name":"社区志愿团","description":"地方志愿组织","protagonistRelation":"初次接触","relationHistory":[],"keyNpcIds":["lin"],"currentTaskIds":[],"activities":[]}
set organizations[community].protagonistRelation = {"relation":"协作","reason":"完成现场沟通"}
set economy.incomes[pay] = {"source":"已到账报酬","amount":5000,"status":"received","account":"cash","receivedAt":"2026-10-18T08:00:00+08:00"}
set items[phone].purchase = {"account":"cash","price":3000,"item":{"name":"手机","category":"device","quantity":1,"conditionText":"全新","ownerRef":{"kind":"protagonist","id":"hero"}}}
</命令>
```

所得内存副本cash=12000，生成lin与community，关系/联系人/私有记忆正确；正式输入对象不变。记录ID来自路径，commandId保持`text-v1:s正文版本:c原序号`；记忆ID生成机制不变。代码中针对普通回合/开局和各组示例均使用真实解析器与原commitCommands测试，不把Mock AI成功当实模验证。

失败示例（必须整体拒绝，不能先把主角情绪更新落盘）：

```text
<命令>
set protagonist.emotionText = "轻松"
set npc[lin].identity = "自由改写已有身份"
</命令>
```

`identity`没有现成UpdateNpc字段，明确unsupported_path；不会返回部分成功计划或状态。affinity前值错误、普通人物写特殊目标/长期记忆、重复稳定身份、错误组织类型/引用、余额不足等也由原类型/领域约束整批失败。

## 3D-2具体接线清单（本轮未实施）

- `src/services/ai/runtime.ts`：仅Variables改用文本组装和真实文本解析/编译/模拟；Story/World各自原协议继续分离；不能调用两个模型生成同一变量结果。
- `src/workflows/variableStage.ts`：保存新的文本结果对应原领域候选，保持Story/request/execution/candidate版本及世界失效关系，不绕CAS/StageGuard。
- `src/domain/drafts.ts`、`src/services/storage/saveRepository.ts`、`src/domain/turnProjection.ts`、`src/domain/turnCommit.ts`：先审查如何保存/复核确定性编译产物及精确重放，避免重复注入开局时钟；是否需要持久契约改动另行决策。本轮这些文件完全未改。
- `src/prompts/context.ts`、`src/prompts/composer.ts`、`src/prompts/selection.ts`：切换正式Variables目录和选模块入口，明确何时撤下JSON冻结资源；当前离线helper可直接复用。
- `src/services/validation/aiOutputs.ts`、`src/services/validation/commandCatalog.ts`及变量失败诊断：把正式Variables输出解析接至文本入口，保留数据约束及安全错误定位，不恢复剧情审批。
- `src/workflows/worldStage.ts`、`src/workflows/turnCoordinator.ts`：确认世界只读同一变量投影、时间与修订基线，失败恢复不重复上游调用。
- 正式切换前必须决定旧经济/资产初始化缺口如何处理，不能把现有文本可表达21类命令写成全部开局数据都能凭原生命令初始化。

以上为文件级后续计划，不是已完成的接线，也不新增UI协议设置。

## 本次最终验证

- 新增实体映射测试：41项（含最初7项失败复现，新增开局/同伴/跨组测试）；新增文本资源和组装测试：55项，共新增96项。
- 既有1761项全部保留，`npm run check`本次48文件、1857/1857通过，耗时82.50秒；内含Lint零警告、TypeScript和Vite生产构建（1.39秒）。既有大于500kB分块提示不在本轮扩大处理。
- `npm run prompts:check`：原3文件82/82通过，5.48秒（1857工程测试的子集）；新增文本组装/示例/共享协议及目录边界55项另包含于工程测试。
- 单独`npm run typecheck`及`npm run lint`通过。
- 两个新测试文件曾定向91/91通过；后补共享冲突与目录文本边界用例，最终96项均包含于1857项工程测试；初批4文件312/312通过。
- `git diff --check`通过；JSON提示词快照23/23与基线git对象字节一致；领域/存档/正式工作流、UI、解析器、World/Story模板及世界书/写作资源未改。
- Chromium E2E最终完整290/290通过：桌面145、移动145，无失败、跳过或重试。初次启动受沙箱本地监听EPERM阻止，未运行浏览器用例；调整执行权限后的中途运行因发现共享提示词冲突由开发者主动终止，不计完整通过。适配共享资源后完成过一次全套执行，发现两项旧数量断言失败；修正为真实Manifest计数、增加列表数校验后，再次从头完整执行并全绿。未改项目配置、删除用例或放宽断言。

本轮所有模型场景使用Mock，未调用付费AI；没有新增API请求或收费场景。不自动合并，不主动部署生产环境；PR预览由既有Cloudflare自动流程处理。

## 本轮文件清单

共60个文件，其中23个是原提示词逐字快照；不存在无内容占位文件。

```text
M8-P0C-3D1-TEXT-PROTOCOL-READINESS.md
e2e/prompt-inspector.spec.ts
prompts/legacy/variables_json/shared/04_state_authority.md
prompts/legacy/variables_json/shared/05_context_protocol.md
prompts/legacy/variables_json/shared/07_command_output.md
prompts/legacy/variables_json/stages/opening/variables.md
prompts/legacy/variables_json/stages/regular/variables.md
prompts/legacy/variables_json/variableGroups/economy/init.md
prompts/legacy/variables_json/variableGroups/economy/update.md
prompts/legacy/variables_json/variableGroups/items/init.md
prompts/legacy/variables_json/variableGroups/items/update.md
prompts/legacy/variables_json/variableGroups/npc_ordinary/init.md
prompts/legacy/variables_json/variableGroups/npc_ordinary/update.md
prompts/legacy/variables_json/variableGroups/npc_special/init.md
prompts/legacy/variables_json/variableGroups/npc_special/update.md
prompts/legacy/variables_json/variableGroups/org_business/init.md
prompts/legacy/variables_json/variableGroups/org_business/update.md
prompts/legacy/variables_json/variableGroups/org_civil/init.md
prompts/legacy/variables_json/variableGroups/org_civil/update.md
prompts/legacy/variables_json/variableGroups/org_gang/init.md
prompts/legacy/variables_json/variableGroups/org_gang/update.md
prompts/legacy/variables_json/variableGroups/org_government/init.md
prompts/legacy/variables_json/variableGroups/org_government/update.md
prompts/legacy/variables_json/variableGroups/protagonist/init.md
prompts/legacy/variables_json/variableGroups/protagonist/update.md
prompts/manifest.json
prompts/shared/04_state_authority.md
prompts/shared/05_context_protocol.md
prompts/shared/07_command_output.md
prompts/sources.lock.json
prompts/stages/opening/variables.md
prompts/stages/regular/variables.md
prompts/variableGroups/economy/init.md
prompts/variableGroups/economy/update.md
prompts/variableGroups/items/init.md
prompts/variableGroups/items/update.md
prompts/variableGroups/npc_ordinary/init.md
prompts/variableGroups/npc_ordinary/update.md
prompts/variableGroups/npc_special/init.md
prompts/variableGroups/npc_special/update.md
prompts/variableGroups/org_business/init.md
prompts/variableGroups/org_business/update.md
prompts/variableGroups/org_civil/init.md
prompts/variableGroups/org_civil/update.md
prompts/variableGroups/org_gang/init.md
prompts/variableGroups/org_gang/update.md
prompts/variableGroups/org_government/init.md
prompts/variableGroups/org_government/update.md
prompts/variableGroups/protagonist/init.md
prompts/variableGroups/protagonist/update.md
src/executors/variableText/catalog.ts
src/executors/variableText/compile.ts
src/executors/variableText/entities.ts
src/prompts/composer.ts
src/prompts/manifest.ts
src/prompts/selection.ts
src/tests/prompts.test.ts
src/tests/text-prompt-readiness.test.ts
src/tests/text-protocol-readiness.test.ts
src/tests/variable-text-executor.test.ts
```

## 已知语义和准备边界

说明区只是非执行文本，本轮没有将它转成正式unresolved持久记录。文本命令仅形成计划/内存副本；即使所有离线测试通过，现行玩家Variables请求仍使用JSON，不能把本轮描述为已正式接入文本模型输出。原始字段约束仍由编译器和领域命令共同执行，类型目录不是新审批器。NPC的原生长期记录与知晓信息组合若需同一次记忆同时写入两者，当前各路径分别表达，不能假装已提供所有任意RecordNpcMemory标志组合；3D-2接线前可按真实需求再核对该组合及未支持初始化缺口。

第三次阶段性提交：共享04/05的两项实际组装失败测试已验证并修复，最终工程检查1857/1857通过后推送代码；完整浏览器回归后来已完成，详见最终结果；不把中途主动终止的旧运行计作通过。

## E2E注册数量断言适配

第一次完整浏览器执行为288通过、2失败（19.8分钟），两项均是e2e/prompt-inspector.spec.ts在桌面/移动端仍写死77/77；错误上下文显示页面实际100/100，符合77个原模块+23个新文本资源。只将断言改为导入真实Manifest计算总数，并额外核对列表实际按钮数。未删除用例、放宽断言或修改UI。Node24原生JSON导入需要with {type: json}，已按运行环境补齐。该文件8/8定向E2E通过，Lint与类型检查再次通过；完整290项已再次从头重跑并全部通过。

## 最终交付结果

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 48文件、1857/1857（原1761+新增96）；Lint、TypeScript和生产构建通过 |
| `npm run prompts:check` | 3文件82/82；包含全部100个资源的注册/哈希/来源校验，工程测试子集 |
| 新增两文件测试 | 41项实体能力+55项文本资源/真实组装/示例执行，共96项，全部包含于全量通过 |
| 单独Lint / typecheck | 最后E2E断言改动后再次执行，通过 |
| 提示词管理定向Chromium | 桌面4+移动4=8/8 |
| 完整Chromium E2E | 290/290，桌面145、移动145；无失败、跳过或重试 |
| `git diff --check` | 通过 |
| 旧正式Prompt资源 | 23/23与main基线git对象逐字一致，默认正式请求仍用这些原文 |

全套浏览器覆盖的是未改变的正式JSON流程；新文本能力在真实解析器/编译器/领域模拟与实际离线Composer集成测试中验证，不能描述成真实付费模型已经遵从文本协议。没有新增API请求、付费模型、自动维护任务、玩家设置或正式存档迁移。正式三阶段入口和提交机制未改变；未开始3D-2。

剩余限制仍为上文原生命令缺口、部分记忆标志组合及说明尚未持久化等明确项。旧存档无需迁移。未进行真实模型/中转站或物理手机验证。本轮保持Draft等待审查；未合并，未主动部署生产环境，PR预览由既有Cloudflare自动流程处理。

最终完整E2E实际耗时：19.1m。
