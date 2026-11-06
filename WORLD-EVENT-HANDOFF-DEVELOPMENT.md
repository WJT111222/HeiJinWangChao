# 世界事件记录、到期承接与主角反馈

基线：main@42823bbb98ebee485035874963a2144ca82f7014（PR #55已合并）。独立分支codex/world-event-handoff-feedback。

## 审计与第一阶段

Variables只能更新已有现场事件；World原本将SaveEvent的现场参与者引用也视为后台行动授权，形成新现场事件无人可记录的职责缺口。planned即使引用本幕已经收到的未来通知也无法提升visibility。

修复前新增8项测试实跑：6通过、2失败。完整原始响应在明确合成的、具有相关原文来源的现场状态下仍触发actor_permission；移除通知来源的测试亦先被同一权限拒绝挡住。未获得用户的原始GameState/TurnDraft/Story，不能声称复原线上故障。最新日志的eventCommands.0指第一个事件；全局序号不证明参与者身份。

现场SaveEvent必须established+story:current，对应每个受保护参与者；新增/改写的描述字段在正文来源内可核验。此例外不授权UpdateNpc、交易、关系或记忆写入，也不允许派遣主角。场外自主事件仍用原来源/因果/时间/状态保护。现场摘要若与原文措辞不符可能保守拒绝，不能以程序完全理解中文的名义放行虚构的现场行动。

未来安排的知晓与执行分离。planned引用实际主角已知来源时，程序保存受限reported通知快照，不泄露事件内部目标/排程。可选快照字段向后兼容，不改版本；旧事件缺字段不推造通知。futureEvents原始镜像先核对，再同步程序规范化后的元数据，提交重验结果一致。

原始world-school-original.json保持字节不变，SHA256为53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb。合成测试明确添加现场描述原文作为前提，不能说这些是用户真实正文。新非空候选测试走候选保存、Commit、重载与重复回执。

## 验证记录（进行中）

第一阶段定向world-scene-record + world-event-knowledge：35通过；补充事务测试后scene-record 9通过。类型检查通过。全量/最终浏览器结果待代码冻结重新记录，历史成绩不作为本轮成绩。

## 第二阶段

承接计划、待入场及正文反馈将使用可选字段，并通过原有命令投影与原子提交，不新增AI请求或直接写库通路。

## 承接数据契约与执行链

本轮只在现有严格Schema增加向后兼容的可选字段，不增加存档版本、不新建数据库。缺字段的旧事件/正文/草稿不造交接历史，也不自动调用模型。

| 字段 | 内容/所有权 |
| --- | --- |
| event.continuation | 同次World的阶段计划：protagonist + reason + entry(channel,cue,locationId?)；world + reason + followup；end + reason |
| event.protagonistEntry | 程序生成的入场身份、来源回合、排队游戏时间和冻结cue；状态pending/presented/declined/left/interrupted/invalidated；处理后保存handledTurnId和本幕textEvidence |
| Story.variableGuide[].eventInteraction | 仅group=event可用；eventId、entryId、action。语义由同次Story决定，程序核对身份、重复、已关闭状态和正文实际片段 |
| event.protagonistKnowledge | 仍是程序快照；可仅保存notice及reported性质，不为不完整的通知补造精确日期/世界状态；旧完整快照保持可读 |

入场ID在事件内以正式revision及Story revision确定（身份是eventId+entryId）；仅无模型事件写入时，独立回执命令ID为story-entry:<StoryRevision>:<回执序号>；同事件模型现场写入与回执合并后沿用该模型命令ID。未新增自由写路径、AI审查或平行命令系统。

```text
N Story → 文本Variables → World记录/到期评估
  → World候选含pending入场 → 既有commitTurn事务
  → 下一草稿为空，等待玩家行动（不请求N+1 AI）
玩家下一次行动 → N+1 Story读取最小EVENT_ENTRIES，正文实际呈现/处理
  → 原变量规划块提供eventInteraction回执
  → Variables原有现场修改 → 程序从同一正式基线计算回执SaveEvent
  → World读取合并投影和eventInteractions，调整同一事件
  → 既有Commit重新计算和复核 → 同事务保存事件、正文、记忆、下一草稿、回执
```

`preparedVariableCommands()`在执行前将模型现场变化与程序回执组合：同一事件的回执合并进最后一条模型SaveEvent，没有对应模型写入才追加独立程序命令；不先执行“终态事件＋pending”的中间状态。Variables模拟、已保存候选复核、`projectTurn()`和`turnCommands()`使用同一计算结果。程序回执不冒充模型原文或模型Variables命令。World命令ID冲突检查包含程序命令。正式提交继续走原SaveRepository.commitTurn及候选复核，不新增直接写库入口。

`pending`表示待下一幕实际呈现，`presented`表示已经入场且等待玩家后续行为，两者不要求凭到期自动结案，也不要求编造新预计时间。`EVENT_SCHEDULE`以截止时间、ID排序；主角方向的现场事件可以做行政性排队，不能借排队改变现场状态、描述、人物行动或认知。其他受保护现场事件仍需实际正文依据。Story必须逐项处理所有pending，并保持cue实际出现在正文；不能只在规划中提到。活跃presented只提供最小参与身份，不重复发入场；已终态事件不继续要求退出回执。

World方向终态必须同批产生有真实前序、合理耗时的非终态后继；不能连造已完成链。end无续篇要求。旧缺计划的事件仍能按原来源与时间规则记录/终结，不默认补成任一方向；新World提示词要求建立/启动时规划，只有明确给出protagonist方向的事件才会自动排队。

计划调整仍需原事件及本次正文/真实行动者来源。既有入场已关闭时不能凭原计划自动重排；再次邀请需不同cue及本幕已成立的新邀请来源。拒绝/退出回执只关闭这次接触；事件是否延期、受阻、取消或继续由World依据实际发展决定，不扫描玩家输入关键词，不预设报复/惩罚。pending或presented不能提前清理。

## 权限与知识边界

1. 现场SaveEvent引用人物只表示有来源的记录，不能授权World修改现场NPC、主角、金钱、位置、关系或个人记忆。新改写描述须有本幕正文片段；身份可用稳定ID、既有人名/别名和明确“主角”指称，不新建人物消除引用错误。
2. 场外自主变化保持原WORLD_EVIDENCE、行动者、时间、条件、生命周期及终态校验，未扩展#55词法规则。
3. 已收到未来安排可保留scheduled+known/partially_known；只投影原始notice为reported，不泄露内部背景、完整目标、预计结束时刻或未来结果。合法已知的传闻保留转述性质。
4. Story的EVENT_ENTRIES是“本幕将处理的外部情境”，不是已知事实；只给channel/cue/合法地点，不给完整隐藏事件。人物知情只在实际正文及正式结算后推进。NPC知识仍由各自来源确定，worldEventOnly和ownerNpcId不变；玩家全量只读观察不改变角色认知。

## 失败、恢复、兼容与费用

- Story未实际处理入场：以固定event_entry失败码停止，协调器持久保存安全失败状态；不启动Variables/World、不自动付费补发。新增真实Runtime测试曾发现直接抛DataError不进入协调器的Story失败保存分支，现已在Runtime边界转为固定AiError，沿用原机制修复。
- Story/Variables保存成功但World失败、取消、刷新或提交事务回滚：正式pending不消费，保留合法上游候选；明确恢复后只补必要阶段。Roll使旧下游失效，新的回执仍以正式身份核对。
- 回执和世界结果都在原正式事务生效；CAS、旧版本冲突、幂等回执、跨标签锁及回滚不变。重复调用Commit不会二次呈现/记忆/交易。自动结算后下一草稿待输入，不替玩家行动。
- V1–V5读取和升级继续使用现有迁移。新增字段均可选，旧档没有通知/入场时不造来源/游戏时间；现实设备日期不参与排程。
- 仍是原Story/Variables/World请求。无额外AI阶段、逐事件调用、费用授权或自动重试；NPC/公开记忆维护默认行为不变。

## 原始响应逐项证据

原文件始终未修改，固定SHA256检查保留。

| 原始项目 | 在明确合成、具有对应正文/知晓来源的状态中 |
| --- | --- |
| taskCommands.0（原SaveTask） | 原derived“迎检准备”通过；未修改事实性质函数 |
| eventCommands.0（原现场SaveEvent） | 现场引用及原文描述有对应来源时可记录；缺少描述或夹带新决定则拒绝 |
| eventCommands.1（原scheduled SaveEvent） | 主角实际获知安排时保存有限reported快照；删去通知来源仍拒绝player_knowledge |
| futureEvents.0 | 先验证与原SaveEvent相同，再同步程序规范化元数据，提交重验一致 |
| 三条visibleHooks | 保留为原候选结构；不新增公开或知识传播通道，未发布到普通正文 |
| 整批保存/结算/重载 | 非空原始命令进入正常草稿和事务；角色、NPC状态不因事件记录被额外修改，重复Commit重放 |

合成Story特意提供字段对应的事实前提，不能称其为用户真实正文。仅凭新日志的eventCommands.0/全局序号不能还原那次具体参与者；未取得原始存档，因此不能声称用户真实整批结果已在原档中验证成功。

## 测试证据与最终验收入口

- 开发中第一次整体验证：2237项工程测试通过；随后补充身份、现场排队、终态参与和Runtime失败恢复测试。这不是最终冻结成绩。
- 冻结前目标回归：`npx vitest run src/tests/world-event-handoff.test.ts src/tests/live-text-turn.test.ts src/tests/world-scene-record.test.ts`，64/64通过；TypeScript通过。
- 提示词检查82/82通过；修改提示词后已刷新Manifest。原始夹具SHA256固定检查通过。
- 新桌面/移动浏览器场景4/4通过。首次尝试因沙箱禁止本地端口listen EPERM无法启动，授予本地测试所需网络权限后正常运行；初跑发现测试误假设可选NPC.healthText默认“健康”，已改为完整比较初始NPC快照，断言更严格，未改产品以迁就夹具。
- 最终冻结SHA将按顺序执行`npm run check`、`npm run prompts:check`、`git diff --check`及`CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile`。完整单批结果、准确数量、最终SHA、Workers Builds状态附于本Draft PR的最终验收评论；不在本文件预填未运行成绩，也不拼接旧批次。

新增安全测试还覆盖提前排队、无条件到期、缺失/重复/错ID/仅分析回执、旧计划重排、后台无后续/同批后续、角色/NPC知识不变、事务写入失败回滚、刷新和精确重放。已有M4–M8、Variables/World权限、经济、时间、NPC记忆隔离检查继续执行。

## 仍需实机验证的边界

- 全部AI网络为Mock，未调用付费模型，未证明真实供应商一定遵守新计划和回执契约；未调整timeout、路由或重试。
- 程序检查结构、身份、来源对应、顺序和事务；不声称能理解全部中文、判断所有因果和反讽。scene记录的自由摘要若非可定位原文会保守拒绝；提示词明确了此约束。Story对“实际拒绝/退出”而非条件假设的语义判断仍由原模型承担。
- 兼容缺continuation的旧响应/事件，不虚构方向；此类记录不会凭空产生自动入场。World后续真实规划后才具备该能力。
- 新字段不能让旧客户端理解承接；旧档在新版读取不必重写历史。本PR不处理版本降级写回。
- 不修改玩家正式存档、不合并、不主动部署生产环境；PR预览如发生，由仓库现有Cloudflare自动流程负责。


## PR #56 复审收尾：R1、R2（基线23f0ba8）

本轮只修同回合事件/回执组合及本批因果前置读取；不改提示词、Schema、中文判断、API协议、费用或重试、UI、记忆维护，不放松终态、角色认知和现场权限。

### 修复前真实复现

新增`event-handoff-composition.test.ts`，首先在原HEAD实跑核心22项：10失败、12通过。R1三项presented＋本幕取消/解决在真实VariableStage保存后进入projectTurn，触发`TERMINAL_EVENT`；pending＋取消/解决及其事务测试在VariableStage的真实文本模拟阶段触发`text.domain_validation_failed`。R2的任务/事件前置完成场景及重排序场景经真实parseWorld仍触发`completion_conditions`。首轮测试曾错误把已有正式存档交给create、把已带正文的草稿作为初始草稿保存，随后修正为正常开局提交→领域事务设置已有事件→依CAS保存所选Story/Variables；这些夹具错误不算业务漏洞复现，不以绕过存储校验处理。

### R1：统一组合，不放开终态

原实现先模拟模型Variables，再追加回执SaveEvent：presented事件被先写成终态后不能再改回执，pending事件则在第一次模拟中产生矛盾中间状态。现在只在内存命令层构造最终事件候选，执行前合并为一条SaveEvent。

- 先依据正式基线和所选Story验证回执身份、正文对应、重复与历史终态；模型原始事件的protagonistEntry/protagonistKnowledge必须与正式基线相同，不能借组合隐藏字段伪造。
- 同事件模型SaveEvent承载场景状态变化，程序将回执、知情快照及来源合入该事件，沿用模型稳定commandId与原顺序；无模型事件命令才追加既有story-entry命令。多条互相冲突的终态改写仍按领域规则拒绝。
- 文本编译协议及保存的模型候选不变；`simulateVariablePlan`、`parseVariables`、正式投影/World输入/Commit统一调用同一组合器。候选中的模型部分仍按原scenePermission检查，程序字段不能变为模型自由写权限。
- 不删除pending、不临时更改GameState约束、不允许历史终态继续改写；只避免把同一事实拆成两个先后冲突的领域更新。最终GameState仍完整校验，正式状态只在commitTurn同一事务更新。

### R2：区分正式基线与已验证因果状态

`normalizeEventContinuation`明确接收base和causal两个输入。base继续用于地点存在性、正式时钟/截止判断；旧事件/已有入场身份仍来自base中的old，入场ID仍由正式revision和Story revision确定。只有前置/阻碍的完成判断读取当前命令之前已验证的causal。

既有orderWorldCommands依赖排序不变，不把整份未验证输出或最终状态当来源。已知的前置实际完成时间必须不晚于交接proof.at，避免DFS先验证了“稍后才完成”的结果就允许更早的入场。该时间参数只由入场条件调用；旧已完成记录没有成果时间时不补造日期，其余既有conditionEnded调用语义保持不变。未完成、取消、缺失、前序本身失败、非法依赖、后续越权仍整批拒绝。

### 本轮新增测试与覆盖

新增27项测试，使用真实解析器、Variables/World Stage与Runtime、fake-indexeddb事务；不调用真实付费模型。

- presented取消并退出、取消并实际中断、解决并退出；pending取消/解决并使原入场失效。各场景使用匹配的不同正文与动作。
- 验证候选保存、普通JSON候选复核、单一最终SaveEvent/稳定ID、World读取、Commit、刷新重载、持久回执精确重放。
- 缺失、重复、伪造、不对应正文及历史终态回执继续拒绝；模型伪造程序字段不能被合并掩盖；正式版本变化阻止旧候选。
- 同批任务/事件完成后入场；事件数组和JSON分组顺序改变仍按依赖正确处理；缺失/取消/未完成/非法前序、循环、交接早于实际完成及后续越权均拒绝。
- R1、R2分别覆盖写库故障整事务回滚；World失败后保留Variables，仅明确恢复World，提交前不提前完成任务或消费/排队入场。
- 原有单纯退出不取消整个事件、现场记录、未来安排知情、NPC隔离及原始整批响应测试继续运行。world-school-original.json未改，固定SHA256检查保留。

本轮定向命令：`npx vitest run src/tests/event-handoff-composition.test.ts src/tests/world-event-handoff.test.ts src/tests/world-scene-record.test.ts src/tests/live-text-turn.test.ts`，91项通过；Lint和TypeScript通过。代码冻结后重新执行check、prompts:check、diff检查及完整desktop/mobile同一批次。最终SHA及该批准确结果发布于PR #56最新R1/R2验收评论；上一轮2243/82/330仅作历史记录。

本轮实际修改7个执行/验证文件、1个新增测试文件及本报告。不更改正式Schema、存储事务或持久回执结构；旧提交依旧先走原持久回执幂等路径，无迁移/重写历史。仍无原始玩家GameState/TurnDraft/Story，也未实测付费供应商，不能将本地链路复现宣称为原档实机修复证明。
