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

入场ID在事件内以正式revision及Story revision确定（身份是eventId+entryId）；处理命令ID为story-entry:<StoryRevision>:<回执序号>。未新增自由写路径、AI审查或平行命令系统。

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

`preparedVariableCommands()`先模拟模型现场命令，再生成保留该投影的程序回执；`projectTurn()`和`turnCommands()`使用同一结果，避免同事件sceneState覆盖回执，或模拟revision漂移。程序回执不冒充模型原文或模型Variables命令。World命令ID冲突检查包含程序命令。正式提交继续走原SaveRepository.commitTurn及候选复核，不新增直接写库入口。

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
